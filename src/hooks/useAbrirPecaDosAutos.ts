/**
 * Abre, dentro do app, a peça dos autos que uma tela só citou de nome.
 *
 * Serve o painel "De onde saiu (para conferir)" do Dom: lá a peça chega como um
 * retrato gravado no rascunho (título, data, resumo — e, desde 08/09/2026,
 * também o id e o caminho do arquivo). O acervo de verdade está em
 * `jm_documentos` + bucket privado `jm-autos`, e é dele que sai a URL assinada.
 *
 * É o MESMO caminho da aba Documentos do processo (`usePecasDoProcesso`), de
 * propósito: uma peça só, um visualizador só (`MediaLightbox`), zoom igual.
 * A diferença é que aqui a busca é sob demanda — no clique, uma peça por vez —
 * porque o painel lista peças de vários processos e carregar o acervo inteiro
 * de cada um (140 peças no caso 88) para talvez abrir uma seria desperdício.
 *
 * Nunca abre no chute: quando não dá para saber qual peça é, devolve o motivo
 * para a tela dizer isso. Ver `acharPecaDoContexto`.
 */
import { useCallback, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { cnjVariantes } from '@/lib/cnj';
import {
  acharPecaDoContexto,
  type CandidataDosAutos,
  type DocumentoDoContexto,
} from '@/lib/pecaDoContexto';

const BUCKET = 'jm-autos';
/** Curto de propósito: a URL assinada é um link público enquanto vive. */
const VALIDADE_S = 600;

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }
interface Filtro {
  in: (coluna: string, valores: unknown[]) => Filtro;
  eq: (coluna: string, valor: unknown) => Filtro;
  is: (coluna: string, valor: unknown) => Filtro;
  limit: (n: number) => Promise<Consulta>;
}
// O client tipado não aceita `jm_documentos` (tabela do Supabase externo, fora
// dos types gerados) e o `tsc` estoura em TS2589 quando se insiste. O mesmo
// desvio já é usado em usePecasDoProcesso.
const externo = db as unknown as { from: (t: string) => { select: (c: string) => Filtro } };

export interface PecaAberta { url: string; titulo: string }
export interface ErroDePeca { chave: string; motivo: string }

export function useAbrirPecaDosAutos() {
  const [peca, setPeca] = useState<PecaAberta | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroDePeca | null>(null);

  /**
   * `chave` identifica a linha clicada na tela (índice da lista), só para a
   * tela saber embaixo de qual item mostrar o recado quando não der certo.
   */
  const abrir = useCallback(async (
    chave: string,
    cnj: string | null | undefined,
    doc: DocumentoDoContexto,
  ) => {
    setErro(null);
    setCarregando(chave);
    try {
      await ensureExternalSession();

      // Contexto COM `arquivo` (rascunho novo): o caminho já veio e não há o
      // que consultar. Sem ele, vale consultar o acervo — com o filtro mais
      // estreito possível no servidor: o id quando ele existe, senão as peças
      // deste processo que têm este título.
      let candidatas: CandidataDosAutos[] = [];
      if (!doc.arquivo) {
        const titulo = (doc.peca ?? doc.titulo ?? '').trim();
        if (typeof doc.id !== 'number' && (!cnj || !titulo)) {
          setErro({ chave, motivo: 'Este rascunho não guardou de qual peça se trata.' });
          return;
        }
        let q = externo.from('jm_documentos')
          .select('id, titulo, data_documento, storage_path')
          .is('oculta_em', null);
        q = typeof doc.id === 'number'
          ? q.eq('id', doc.id)
          : q.in('processo_cnj', cnjVariantes(cnj)).eq('titulo', titulo);

        const r = await q.limit(50);
        if (r.error) {
          setErro({ chave, motivo: `Não consegui consultar o acervo: ${r.error.message ?? 'erro'}` });
          return;
        }
        candidatas = (r.data ?? []).map(d => ({
          id: Number(d.id),
          titulo: (d.titulo as string) ?? null,
          dataDocumento: (d.data_documento as string) ?? null,
          storagePath: (d.storage_path as string) ?? null,
        }));
      }

      const resolucao = acharPecaDoContexto(doc, candidatas);
      // `=== false` e não `!ok`: com `strict: false` no tsconfig o TS não
      // estreita a união pela negação do discriminante.
      if (resolucao.ok === false) { setErro({ chave, motivo: resolucao.motivo }); return; }

      const { data, error } = await db.storage
        .from(BUCKET).createSignedUrl(resolucao.storagePath, VALIDADE_S);
      if (error || !data?.signedUrl) {
        setErro({ chave, motivo: 'O arquivo está registrado, mas o acervo recusou abri-lo.' });
        return;
      }
      setPeca({ url: data.signedUrl, titulo: (doc.peca ?? doc.titulo ?? '').trim() || 'Peça dos autos' });
    } catch (e) {
      setErro({ chave, motivo: String((e as Error)?.message || e) });
    } finally {
      setCarregando(null);
    }
  }, []);

  const fechar = useCallback(() => setPeca(null), []);

  return { peca, carregando, erro, abrir, fechar };
}
