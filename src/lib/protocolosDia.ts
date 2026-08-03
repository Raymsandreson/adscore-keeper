// Protocolos administrativos INSS por dia — fonte única do card do dashboard,
// do bloco em Acompanhamento Processual e da vista do telão.
//
// Lê a RPC `tv_protocolos_dia` no Externo (agregada, sem PII). O motivo dos
// dois números vem do banco e está detalhado na migration
// 20260803120000_rpc_tv_protocolos_dia.sql — resumo do que importa aqui:
//
//   registrados  → comprovantes que chegaram HOJE por e-mail. É o número com
//                  movimento diário, e o que colocamos em destaque.
//   protocolados → cuja data de protocolo é hoje. Quase sempre 0 no próprio
//                  dia e sobe retroativamente (atraso mediano exposto em
//                  `lagMedianoDias`), porque nada é capturado no ato.
//
// Os dois NUNCA devem ser somados nem apresentados como "protocolos de hoje"
// sem rótulo: medem coisas diferentes.

import { db, ensureExternalSession } from "@/integrations/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ProtocolosJanela {
  registrados: number;
  protocolados: number;
}

export interface ProtocolosDiaPonto {
  dia: string; // YYYY-MM-DD
  registrados: number;
  protocolados: number;
}

export interface ProtocolosDiaData {
  geradoEm: string;
  hoje: ProtocolosJanela;
  ontem: ProtocolosJanela;
  semana: ProtocolosJanela;
  mes: ProtocolosJanela;
  serie: ProtocolosDiaPonto[];
  /** Atraso mediano, em dias, entre protocolar e o comprovante chegar aqui. */
  lagMedianoDias: number;
  /** Última execução do gmail-inss-sync. Null = nunca rodou. */
  ultimoSync: string | null;
}

const JANELA_VAZIA: ProtocolosJanela = { registrados: 0, protocolados: 0 };

export const PROTOCOLOS_VAZIO: ProtocolosDiaData = {
  geradoEm: "",
  hoje: JANELA_VAZIA,
  ontem: JANELA_VAZIA,
  semana: JANELA_VAZIA,
  mes: JANELA_VAZIA,
  serie: [],
  lagMedianoDias: 0,
  ultimoSync: null,
};

function janela(raw: any): ProtocolosJanela {
  return {
    registrados: Number(raw?.registrados ?? 0),
    protocolados: Number(raw?.protocolados ?? 0),
  };
}

export async function fetchProtocolosDia(dias = 14): Promise<ProtocolosDiaData> {
  await ensureExternalSession();
  const { data, error } = await (db as any).rpc("tv_protocolos_dia", { p_dias: dias });
  if (error) throw error;
  if (!data) return PROTOCOLOS_VAZIO;

  return {
    geradoEm: data.gerado_em || "",
    hoje: janela(data.hoje),
    ontem: janela(data.ontem),
    semana: janela(data.semana),
    mes: janela(data.mes),
    serie: Array.isArray(data.serie)
      ? data.serie.map((p: any) => ({
          dia: String(p.dia),
          registrados: Number(p.registrados ?? 0),
          protocolados: Number(p.protocolados ?? 0),
        }))
      : [],
    lagMedianoDias: Number(data.lag_mediano_dias ?? 0),
    ultimoSync: data.ultimo_sync ?? null,
  };
}

/** Quantas horas desde o último sync. Null se nunca rodou. */
export function horasDesdeSync(ultimoSync: string | null): number | null {
  if (!ultimoSync) return null;
  const t = new Date(ultimoSync).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

/**
 * Sync parado é a falha silenciosa perigosa aqui: a tela mostra 0 e parece que
 * a equipe não protocolou, quando na verdade o carteiro é que parou. O cron
 * roda a cada 20 min, então acima de 2h já é sinal de problema.
 */
export function syncEstaAtrasado(ultimoSync: string | null): boolean {
  const h = horasDesdeSync(ultimoSync);
  return h === null || h > 2;
}

export interface UseProtocolosDiaResult {
  data: ProtocolosDiaData;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** `refreshMs = 0` desliga o auto-refresh (padrão). O telão passa 60_000. */
export function useProtocolosDia(dias = 14, refreshMs = 0): UseProtocolosDiaResult {
  const [data, setData] = useState<ProtocolosDiaData>(PROTOCOLOS_VAZIO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProtocolosDia(dias);
      if (reqId.current !== id) return;
      setData(res);
    } catch (e: any) {
      if (reqId.current !== id) return;
      console.error("[useProtocolosDia]", e);
      setError(e?.message || "Falha ao carregar protocolos");
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, [dias]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  return { data, loading, error, refresh: load };
}
