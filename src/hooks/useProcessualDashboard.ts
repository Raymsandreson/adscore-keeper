import { useEffect, useState, useCallback, useRef } from "react";
import { fetchProcessualDashboard } from "@/lib/processualDashboardLive";
import { DATASET_PROC, type DashboardProcessualData, type PeriodoProc } from "@/lib/processualDashboardData";

export interface UseProcessualDashboardResult {
  data: DashboardProcessualData;
  loading: boolean;
  error: string | null;
  isMock: boolean;
  refresh: () => void;
}

export function useProcessualDashboard(periodo: PeriodoProc): UseProcessualDashboardResult {
  const [data, setData] = useState<DashboardProcessualData>(DATASET_PROC[periodo]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const real = await fetchProcessualDashboard(periodo);
      if (reqId.current !== id) return;
      // Se o resultado vier completamente vazio (sessão sem permissão no Externo),
      // mantém o mock para a UI continuar útil e sinaliza com `isMock`.
      const totalAmostra =
        real.sla.reduce((s, x) => s + x.amostra, 0) +
        real.categorias.reduce((s, x) => s + x.amostra + x.fechadosNoPeriodo + x.protocoladosNoPeriodo, 0);
      if (totalAmostra === 0 && real.resumo.processosAtivos === 0) {
        setData(DATASET_PROC[periodo]);
        setIsMock(true);
      } else {
        setData(real);
        setIsMock(false);
      }
    } catch (e: any) {
      if (reqId.current !== id) return;
      console.error("[useProcessualDashboard]", e);
      setError(e?.message || "Falha ao carregar dados");
      setData(DATASET_PROC[periodo]);
      setIsMock(true);
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, [periodo]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, isMock, refresh: load };
}
