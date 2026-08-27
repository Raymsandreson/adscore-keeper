// =============================================================================
// Perguntar à peça — a conversa com o documento que sustenta o marco.
//
// Pedido do Raym (27/08/2026): "ter também uma ia para perguntar sobre a peça em
// si que subsidia o marco".
//
// `lerPeca` (usePecasDoProcesso) já existe e faz outra coisa: extrai um JSON
// fechado — espécie, valores, partes, cronograma — para virar número. Aqui a
// pergunta é livre, porque a dúvida que aparece com a trilha aberta nunca é a
// que o prompt previu: "esse não-provimento é de mérito ou de agravo?", "essa
// certidão transitou para as duas partes?".
//
// O CAMINHO É ASSÍNCRONO, e isso não é acidente: a chave da edge mora em
// `jm_config` (só service role alcança), então o disparo sai do banco por
// pg_net e a resposta pousa em `jm_peca_pergunta`. Aqui se dispara e se espera a
// linha ganhar resposta. Mesmo desenho de `lerPeca`.
//
// O efeito colateral bom: pergunta e resposta FICAM na peça. Quem abrir o mesmo
// marco depois lê o que já foi perguntado em vez de pagar a leitura de novo.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

export interface PerguntaDaPeca {
  id: number;
  documentoId: number;
  pergunta: string;
  resposta: string | null;
  erro: string | null;
  marcoRotulo: string | null;
  criadoEm: string | null;
  respondidoEm: string | null;
}

/** Quanto esperar a resposta: o Gemini com o PDF inteiro leva dezenas de segundos. */
const TENTATIVAS = 60;
const INTERVALO_MS = 2000;

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }

const linha = (r: Record<string, unknown>): PerguntaDaPeca => ({
  id: Number(r.id),
  documentoId: Number(r.documento_id),
  pergunta: String(r.pergunta ?? ''),
  resposta: (r.resposta as string) ?? null,
  erro: (r.erro as string) ?? null,
  marcoRotulo: (r.marco_rotulo as string) ?? null,
  criadoEm: (r.criado_em as string) ?? null,
  respondidoEm: (r.respondido_em as string) ?? null,
});

const CAMPOS = 'id, documento_id, pergunta, resposta, erro, marco_rotulo, criado_em, respondido_em';

export function usePerguntasDaPeca(documentoId: number | null) {
  const [perguntas, setPerguntas] = useState<PerguntaDaPeca[]>([]);
  const [loading, setLoading] = useState(false);
  /** Uma pergunta por vez: enquanto a resposta não volta, o campo fica travado. */
  const [aguardando, setAguardando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!documentoId) { setPerguntas([]); return; }
    setLoading(true);
    try {
      await ensureExternalSession();
      const r = await ((db as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: unknown) => { order: (c: string, o: unknown) => Promise<Consulta> };
          };
        };
      }).from('jm_peca_pergunta').select(CAMPOS)
        .eq('documento_id', documentoId)
        .order('id', { ascending: true }));
      if (r.error) throw new Error(r.error.message || 'falha ao carregar as perguntas');
      setPerguntas((r.data || []).map(linha));
    } catch (e) {
      setErro(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [documentoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  /**
   * Manda a pergunta e espera a resposta pousar.
   *
   * A pergunta aparece na lista antes da resposta existir, com `resposta: null`
   * — quem perguntou precisa ver que a pergunta foi aceita, e não uma tela
   * parada. O erro do modelo também pousa na linha: girar para sempre é pior
   * que dizer o que falhou.
   */
  const perguntar = useCallback(async (
    texto: string,
    ctx: { marcoChave?: string | null; marcoRotulo?: string | null } = {},
  ): Promise<{ ok: boolean; erro?: string }> => {
    if (!documentoId) return { ok: false, erro: 'peça sem documento' };
    const pergunta = texto.trim();
    if (pergunta.length < 3) return { ok: false, erro: 'escreva a pergunta' };

    setAguardando(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const rpc = await (db.rpc as unknown as (
        f: string, a: Record<string, unknown>,
      ) => PromiseLike<{ data?: number | null; error?: { message?: string } | null }>)(
        'jm_perguntar_peca',
        {
          p_documento_id: documentoId,
          p_pergunta: pergunta,
          p_marco_chave: ctx.marcoChave ?? null,
          p_marco_rotulo: ctx.marcoRotulo ?? null,
        },
      );
      if (rpc.error) throw new Error(rpc.error.message || 'falha ao enviar a pergunta');
      const id = Number(rpc.data);
      if (!Number.isFinite(id)) throw new Error('a pergunta não foi registrada');

      // Mostra a pergunta imediatamente, sem esperar o banco responder de novo.
      setPerguntas(ps => [...ps, {
        id, documentoId, pergunta, resposta: null, erro: null,
        marcoRotulo: ctx.marcoRotulo ?? null,
        criadoEm: new Date().toISOString(), respondidoEm: null,
      }]);

      for (let i = 0; i < TENTATIVAS; i += 1) {
        await new Promise(res => setTimeout(res, INTERVALO_MS));
        const r = await ((db as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> };
            };
          };
        }).from('jm_peca_pergunta').select(CAMPOS).eq('id', id).maybeSingle());
        const atual = r.data ? linha(r.data) : null;
        if (atual && (atual.resposta || atual.erro)) {
          setPerguntas(ps => ps.map(p => (p.id === id ? atual : p)));
          return atual.erro ? { ok: false, erro: atual.erro } : { ok: true };
        }
      }
      // Não é falha definitiva: a resposta pode chegar depois. Dizer isso é
      // melhor que fingir erro e fazer a pessoa perguntar de novo (e pagar de novo).
      return { ok: false, erro: 'a resposta ainda não voltou — reabra a peça em um minuto' };
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setErro(msg);
      return { ok: false, erro: msg };
    } finally {
      setAguardando(false);
    }
  }, [documentoId]);

  return { perguntas, loading, aguardando, erro, perguntar, recarregar: carregar };
}
