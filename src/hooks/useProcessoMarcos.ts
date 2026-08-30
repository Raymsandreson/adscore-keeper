// =============================================================================
// Régua de marcos de UM processo — a medida de ANDAMENTO, que não depende de
// ninguém marcar passo.
//
// Por que existe (12/08/2026): o percentual da ficha vinha de
// calculateHierarchicalProgress, ou seja, de passo marcado à mão. Processo que
// já estava no TST aparecia com 8% porque ninguém tinha marcado os 13 passos da
// fase — e a movimentação que prova o TST estava no banco desde 14/05.
//
// Fonte: RPC `pop_processo_regua` no Externo, que lê process_pop_marcos
// (materializado das três fontes: DataJud/TPU, documento e Escavador).
//
// Percentual null = nenhum marco detectado neste processo. Nesse caso quem
// chama deve CAIR NO CÁLCULO POR PASSOS — nunca mostrar 0%, que seria dizer que
// o processo não andou quando o que falta é dado.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

export type MarcoEstado = 'atingido' | 'presumido' | 'pendente';

export interface MarcoReguaRow {
  marco_chave: string;
  rotulo: string;
  ordem: number;
  stage_id: string | null;
  stage_nome: string | null;
  eventual: boolean;
  terminal: boolean;
  /** Estado (acordo, suspensão…): não disputa posição na régua. A RPC devolve desde 27/08/2026. */
  atravessa_fases: boolean;
  /**
   * Obrigatório anterior ao atual pode ser dado como cumprido sem prova?
   * false só no trânsito em julgado (30/08/2026): na execução provisória ele
   * ainda NÃO ocorreu, e presumi-lo carimbava 122 processos do POP trabalhista
   * com uma prova que não existe. Ver a migration 20260830120000.
   */
  presumivel: boolean;
  estado: MarcoEstado;
  data_detectada: string | null;
  /** movimento | documento | escavador_texto | escavador_grau | campo_processo | email | derivado_* */
  fonte: string | null;
  /** CNJ dos autos APARTADOS que originaram o marco; null = nos próprios autos. */
  origem_cnj: string | null;
  tem_prova_documental: boolean;
  atual: boolean;
  percentual: number | null;
  previstos: number;
  cumpridos: number;
}

export const FONTE_LABEL: Record<string, string> = {
  movimento: 'DataJud',
  documento: 'documento do processo',
  escavador_texto: 'Escavador',
  escavador_grau: 'Escavador',
  campo_processo: 'capa do processo',
  // Quinta fonte (24/08/2026): e-mail do INSS, ligado pelo protocolo
  // administrativo. É a única que alcança requerimento sem CNJ.
  email: 'e-mail do INSS',
  // Derivadas (30/08/2026): não vêm de movimentação nenhuma — são conclusão da
  // régua sobre o que já foi detectado. Dizer "DataJud" nelas seria mentir sobre
  // a origem.
  derivado_mesmos_autos: 'execução sem trânsito',
  derivado_apartado: 'autos apartados',
};

export interface ReguaDoProcesso {
  marcos: MarcoReguaRow[];
  /** Marco mais adiantado com evidência. Null quando nada foi detectado. */
  atual: MarcoReguaRow | null;
  /** 0–100, ou null quando não há marco nenhum. */
  percentual: number | null;
  previstos: number;
  cumpridos: number;
  loading: boolean;
  /** RPC respondeu (mesmo que sem marco). Evita piscar régua vazia no load. */
  pronto: boolean;
  recarregar: () => Promise<void>;
  /**
   * Rematerializa process_pop_marcos deste processo e recarrega a régua.
   * Para quando a evidência acabou de mudar (peça anexada a um marco) e esperar
   * o tick do cron deixaria a tela mentindo por minutos.
   */
  rematerializar: () => Promise<void>;
}

export function useProcessoMarcos(processId?: string | null): ReguaDoProcesso {
  const [marcos, setMarcos] = useState<MarcoReguaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pronto, setPronto] = useState(false);

  const carregar = useCallback(async () => {
    if (!processId) {
      setMarcos([]);
      setPronto(false);
      return;
    }
    setLoading(true);
    try {
      // Sessão anônima do Externo: sem ela a RLS devolve zero linha em silêncio.
      await ensureExternalSession();
      const { data, error } = await (externalSupabase.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => PromiseLike<{ data?: MarcoReguaRow[] | null; error?: { message?: string } | null }>)(
        'pop_processo_regua',
        { p_process_id: processId },
      );
      if (error) {
        console.warn('[useProcessoMarcos] pop_processo_regua:', error.message);
        setMarcos([]);
        setPronto(false);
        return;
      }
      setMarcos(data || []);
      setPronto(true);
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const rematerializar = useCallback(async () => {
    if (!processId) return;
    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => PromiseLike<{ error?: { message?: string } | null }>)(
        'refresh_process_pop_marcos',
        { p_process_id: processId },
      );
      if (error) console.warn('[useProcessoMarcos] refresh_process_pop_marcos:', error.message);
    } finally {
      // Recarrega mesmo se o refresh falhar: o tick pode já ter passado.
      await carregar();
    }
  }, [processId, carregar]);

  const atual = marcos.find(m => m.atual) || null;
  const percentual = marcos.length > 0 ? marcos[0].percentual : null;
  const previstos = marcos.length > 0 ? marcos[0].previstos : 0;
  const cumpridos = marcos.length > 0 ? marcos[0].cumpridos : 0;

  return { marcos, atual, percentual, previstos, cumpridos, loading, pronto, recarregar: carregar, rematerializar };
}
