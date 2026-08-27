// =============================================================================
// Conferência de valores de um POP — "o que foi lançado bate com o que os autos
// dizem?".
//
// Entram acordo homologado, liquidação, trânsito em julgado e execução iniciada.
// O Raym pediu os três últimos em 26/08 com o motivo certo: nesses estágios o
// valor por parte está na planilha de liquidação ou nos cálculos da execução —
// peça restrita, que o Escavador raramente traz. São justamente os processos
// onde a carteira tem mais chance de estar errada e ninguém sabe.
//
// A régua mora em `conferenciaAcordo.ts` e é conferida contra o termo de acordo
// real. Aqui só se lê o dado já somado.
//
// ── O NOME
//
//    Isto se chama CONFERÊNCIA, não conciliação (Raym, 27/08/2026). Neste
//    sistema "conciliação" já é outras duas coisas — a conciliação bancária do
//    Open Finance (`useConciliacaoOpenFinance`) e a audiência de conciliação —
//    então o mesmo nome cobria três assuntos diferentes.
//
//    A view no banco ainda se chama `vw_jm_conciliacao_acordos`: renomear
//    objeto em produção é DDL e depende de aval. Só o nome do objeto ficou
//    para trás; todo o código e toda a tela dizem conferência.
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
import { conferirAcordo, type Conferencia } from '@/lib/conferenciaAcordo';

interface Consulta { data: Record<string, unknown>[] | null; error: { message?: string } | null }
const externo = db as unknown as {
  from: (t: string) => { select: (c: string) => { eq: (c: string, v: unknown) => Promise<Consulta> } };
};

/** O estágio mais avançado entre os que pedem conferência de valor. */
export type EstagioConferencia = 'EXECUCAO' | 'TRANSITO' | 'ACORDO' | 'LIQUIDACAO';

export interface AcordoConferido {
  processId: string;
  cnj: string;
  titulo: string | null;
  dataAcordo: string | null;
  estagio: EstagioConferencia;
  conferencia: Conferencia;
  /**
   * Sucumbencial que o banco tem lançado ACIMA da cota da própria parte — o que
   * é impossível, porque o sucumbencial sai de dentro da cota. O número vem
   * somado da view (`jm_partes` onde `hs > cota_parte_cjcm`).
   *
   * NÃO É FILTRO. Nada é descontado por causa disto, nem aqui nem na carteira:
   * o valor continua somando como está no banco. Ele existe para o processo
   * aparecer na fila de conferência com o motivo escrito e o caminho da peça
   * certa. Ver a skill `conserto-estrutural-nao-pontual`.
   */
  hsSuspeito: number;
  /** Quantas partes do processo estão nessa situação. */
  partesSuspeitas: number;
}

export const ESTAGIO_LABEL: Record<EstagioConferencia, string> = {
  EXECUCAO: 'em execução',
  TRANSITO: 'transitado em julgado',
  ACORDO: 'acordo homologado',
  LIQUIDACAO: 'em liquidação',
};

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export function useConferenciaAcordos(boardId: string | null | undefined) {
  const [acordos, setAcordos] = useState<AcordoConferido[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!boardId) { setAcordos([]); return; }
    setLoading(true); setErro(null);
    try {
      await ensureExternalSession();
      const r = await externo.from('vw_jm_conciliacao_acordos')
        .select('process_id, cnj, titulo, data_acordo, estagio, cliente, hc, hs, multa, hs_suspeito, partes_suspeitas')
        .eq('board_id', boardId);
      if (r.error) throw new Error(r.error.message || 'Falha ao conciliar os acordos');

      setAcordos((r.data || []).map(a => ({
        processId: String(a.process_id),
        cnj: String(a.cnj ?? ''),
        titulo: (a.titulo as string) ?? null,
        dataAcordo: (a.data_acordo as string) ?? null,
        estagio: (a.estagio as EstagioConferencia) ?? 'ACORDO',
        conferencia: conferirAcordo({
          cliente: n(a.cliente), hc: n(a.hc), hs: n(a.hs), multa: n(a.multa),
        }),
        hsSuspeito: n(a.hs_suspeito),
        partesSuspeitas: n(a.partes_suspeitas),
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
