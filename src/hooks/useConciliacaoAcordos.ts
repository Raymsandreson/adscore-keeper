// =============================================================================
// Conciliação dos acordos de um POP — "o que foi lançado bate com o acordo?".
//
// A régua mora em `conciliacaoAcordo.ts` e é conferida contra o termo de acordo
// real. Aqui só se lê o dado já somado.
//
// ── POR QUE A SOMA VEM DO BANCO
//
//    A primeira versão lia `process_pop_marcos` cru e filtrava o marco no
//    JavaScript. O POP "Trabalhistas judicial" tem 2.708 marcos, e o PostgREST
//    corta em 1.000 linhas por padrão: a tela via os mil primeiros e mostrava
//    **41 acordos de 91**. Metade da carteira de acordos ficava invisível, sem
//    erro nenhum na tela.
//
//    Os lançamentos tinham o mesmo risco — 91 processos com dezenas de linhas
//    cada estouram o teto de novo.
//
//    `vw_jm_conciliacao_acordos` devolve UMA linha por acordo, com os
//    lançamentos já somados por titular. Some o teto, some a soma no navegador,
//    e a consulta cai de milhares de linhas para dezenas.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { conciliarAcordo, type Conciliacao } from '@/lib/conciliacaoAcordo';

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }
const externo = db as unknown as {
  from: (t: string) => { select: (c: string) => { eq: (c: string, v: unknown) => Promise<Consulta> } };
};

export interface AcordoConciliado {
  processId: string;
  cnj: string;
  titulo: string | null;
  dataAcordo: string | null;
  conciliacao: Conciliacao;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export function useConciliacaoAcordos(boardId: string | null | undefined) {
  const [acordos, setAcordos] = useState<AcordoConciliado[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!boardId) { setAcordos([]); return; }
    setLoading(true); setErro(null);
    try {
      await ensureExternalSession();
      const r = await externo.from('vw_jm_conciliacao_acordos')
        .select('process_id, cnj, titulo, data_acordo, cliente, hc, hs, multa')
        .eq('board_id', boardId);
      if (r.error) throw new Error(r.error.message || 'Falha ao conciliar os acordos');

      setAcordos((r.data || []).map(a => ({
        processId: String(a.process_id),
        cnj: String(a.cnj ?? ''),
        titulo: (a.titulo as string) ?? null,
        dataAcordo: (a.data_acordo as string) ?? null,
        conciliacao: conciliarAcordo({
          cliente: n(a.cliente), hc: n(a.hc), hs: n(a.hs), multa: n(a.multa),
        }),
      })));
    } catch (e) {
      setErro(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  return { acordos, loading, erro, recarregar: carregar };
}
