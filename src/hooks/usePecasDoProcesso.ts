// =============================================================================
// As peças dos autos deste processo, prontas para abrir na tela.
//
// Pedido do Raym (24/08/2026): poder abrir o documento — público ou privado —
// que sustenta o marco e os lançamentos financeiros (valor por parte e
// pagamentos), sem sair da tela.
//
// Só SELECT em `jm_documentos` (RLS ligada, policy de SELECT para
// `authenticated`) mais a assinatura de URL do bucket privado `jm-autos`. A URL
// assinada vale 10 minutos: tempo de abrir e baixar, não de vazar em histórico.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { cnjVariantes } from '@/lib/cnj';
import type { PecaDoProcesso } from '@/lib/pecasDoProcesso';

const BUCKET = 'jm-autos';
/** Curto de propósito: a URL assinada é um link público enquanto vive. */
const VALIDADE_S = 600;

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }
const externo = db as unknown as {
  from: (t: string) => { select: (c: string) => { in: (c: string, v: unknown[]) => unknown } };
};

export function usePecasDoProcesso(cnj: string | null | undefined) {
  const [todas, setTodas] = useState<PecaDoProcesso[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!cnj) { setTodas([]); return; }
    {
      setLoading(true);
      setErro(null);
      try {
        await ensureExternalSession();
        const r = await (externo.from('jm_documentos')
          .select('id, titulo, tipo, data_documento, storage_path, paginas, origem, oculta_em, oculta_motivo')
          .in('processo_cnj', cnjVariantes(cnj)) as Promise<Consulta>);
        if (r.error) throw new Error(r.error.message || 'Falha ao carregar as peças');
        setTodas(((r.data || []) as Record<string, unknown>[]).map(d => ({
          id: Number(d.id),
          titulo: (d.titulo as string) ?? null,
          tipo: (d.tipo as string) ?? null,
          dataDocumento: (d.data_documento as string) ?? null,
          storagePath: (d.storage_path as string) ?? null,
          paginas: d.paginas == null ? null : Number(d.paginas),
          origem: (d.origem as string) ?? null,
          ocultaEm: (d.oculta_em as string) ?? null,
          ocultaMotivo: (d.oculta_motivo as string) ?? null,
        })));
      } catch (e) {
        setErro(String((e as Error)?.message || e));
      } finally {
        setLoading(false);
      }
    }
  }, [cnj]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  /**
   * URL temporária do PDF. Volta null quando a peça não foi baixada ou o bucket
   * recusa — a tela precisa poder dizer "não consegui abrir" em vez de abrir
   * um visualizador vazio.
   */
  const assinar = useCallback(async (storagePath: string | null): Promise<string | null> => {
    if (!storagePath) return null;
    await ensureExternalSession();
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(storagePath, VALIDADE_S);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }, []);

  /**
   * Anexa uma peça à mão, amarrada à data do marco.
   *
   * Vai para `<cnj>/manual/<uuid>.pdf` — a pasta `manual` não é enfeite: é ela
   * que a policy do bucket usa para permitir o DELETE. Acervo colhido do
   * tribunal fica fora dela e não pode ser apagado por ninguém.
   */
  const anexar = useCallback(async (
    arquivo: File,
    dados: { titulo: string; dataDocumento: string | null },
  ): Promise<{ ok: true } | { ok: false; erro: string }> => {
    if (!cnj) return { ok: false, erro: 'processo sem CNJ' };
    if (arquivo.type !== 'application/pdf') return { ok: false, erro: 'só PDF por enquanto' };
    // Teto do bucket. Peça de processo passa longe disso; arquivo maior é sinal
    // de que alguém está subindo os autos inteiros como um PDF só.
    if (arquivo.size > 25 * 1024 * 1024) return { ok: false, erro: 'arquivo acima de 25 MB' };

    try {
      await ensureExternalSession();
      const caminho = `${cnj}/manual/${crypto.randomUUID()}.pdf`;
      const up = await db.storage.from(BUCKET).upload(caminho, arquivo, {
        contentType: 'application/pdf', upsert: false,
      });
      if (up.error) return { ok: false, erro: up.error.message };

      const ins = await (db as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message?: string } | null }> } })
        .from('jm_documentos').insert({
          processo_cnj: cnj,
          titulo: dados.titulo,
          tipo: 'RESTRITO',
          origem: 'manual',
          data_documento: dados.dataDocumento,
          storage_path: caminho,
          stored_at: new Date().toISOString(),
        });
      if (ins.error) {
        // Registro falhou: tira o arquivo órfão, senão fica lixo pago no bucket
        // que ninguém encontra porque não há linha apontando para ele.
        await db.storage.from(BUCKET).remove([caminho]);
        return { ok: false, erro: ins.error.message || 'falha ao registrar a peça' };
      }
      await recarregar();
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: String((e as Error)?.message || e) };
    }
  }, [cnj, recarregar]);

  /**
   * Tira a peça de cena SEM apagar o arquivo.
   *
   * NADA SE APAGA — decisão do Raym em 25/08/2026: "em vez de apagar só
   * desvincular". Vale para peça do tribunal e para upload manual igualmente.
   *
   * A peça errada some do casamento e da tela, o arquivo continua no bucket, e
   * desfazer é um clique. Apagar não traria benefício nenhum que isto não traga:
   * a exibição fica igualmente certa, e o que foi recolhido do tribunal (caro:
   * uma solicitação, e ela funciona em um tribunal de oito) continua em casa.
   */
  const ocultar = useCallback(async (peca: PecaDoProcesso, motivo: string) => {
    try {
      await ensureExternalSession();
      const r = await (db as unknown as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message?: string } | null }> } } })
        .from('jm_documentos')
        .update({ oculta_em: new Date().toISOString(), oculta_motivo: motivo })
        .eq('id', peca.id);
      if (r.error) return { ok: false, erro: r.error.message };
      await recarregar();
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: String((e as Error)?.message || e) };
    }
  }, [recarregar]);

  /** Desfaz o ocultar. Errar a correção tem que custar um clique, não um chamado. */
  const reexibir = useCallback(async (peca: PecaDoProcesso) => {
    try {
      await ensureExternalSession();
      const r = await (db as unknown as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message?: string } | null }> } } })
        .from('jm_documentos')
        .update({ oculta_em: null, oculta_motivo: null })
        .eq('id', peca.id);
      if (r.error) return { ok: false, erro: r.error.message };
      await recarregar();
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: String((e as Error)?.message || e) };
    }
  }, [recarregar]);

  // A peça oculta não some do hook: ela sai do casamento e continua alcançável
  // para desfazer. Sumir de vez tornaria o erro irreversível pela tela.
  const pecas = todas.filter(p => !p.ocultaEm);
  const ocultas = todas.filter(p => p.ocultaEm);

  return { pecas, ocultas, loading, erro, assinar, anexar, ocultar, reexibir, recarregar };
}
