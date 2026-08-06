// Carteira x marcos por pessoa — fonte da vista "Carteira" do telão.
//
// POR QUE existe: a corrida maluca ranqueia VOLUME DE ATIVIDADE. Atividade é
// esforço, não resultado — dá pra registrar trinta atividades num processo que
// não saiu do lugar. Esta vista põe as duas coisas lado a lado: quantos
// processos a pessoa tem e em quantos deles o processo efetivamente andou.
//
// Medido em 06/08/2026, e é o motivo de a comparação existir: uma pessoa com
// 148 processos tinha 11 com marco (7%), outra com 13 tinha 8 (62%). O ranking
// de atividade sozinho não mostra essa diferença.
//
// Lê a RPC `process_owners()` no Externo — já agregada, sem PII de cliente.
// A definição de "de quem é o processo" mora em vw_process_assignment:
// responsável do processo tem precedência sobre o do lead.

import { db, ensureExternalSession } from "@/integrations/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

export interface CarteiraPessoa {
  userId: string | null;
  nome: string;
  processos: number;
  processosComMarco: number;
  /** 0-100. Quantos da carteira efetivamente andaram. */
  pctComMarco: number;
}

export interface CarteiraLinha extends CarteiraPessoa {
  /** Atividades da pessoa no período do telão. null = não veio no ranking. */
  atividades: number | null;
  /** Atividades por processo movido. null quando nada moveu (divisão por zero). */
  atividadesPorMarco: number | null;
}

/** Normaliza nome pra casar com o ranking de atividades, que só tem o nome. */
export function chaveNome(n: string | null | undefined): string {
  return (n || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export async function fetchCarteira(): Promise<CarteiraPessoa[]> {
  await ensureExternalSession();
  const { data, error } = await (db as any).rpc("process_owners");
  if (error) throw error;
  const linhas = Array.isArray(data) ? data : [];
  return linhas.map((r: any) => {
    const processos = Number(r.processos ?? 0);
    const comMarco = Number(r.processos_com_marco ?? 0);
    return {
      userId: r.user_id ?? null,
      nome: String(r.full_name ?? "").trim() || "(sem nome)",
      processos,
      processosComMarco: comMarco,
      pctComMarco: processos > 0 ? Math.round((100 * comMarco) / processos) : 0,
    };
  });
}

/**
 * Cruza a carteira com o ranking de atividades já carregado pelo telão.
 * O casamento é por NOME porque o ranking de atividades não traz user_id —
 * mesma limitação do WackyRaceTrack, que também casa por nome.
 */
export function cruzarComAtividades(
  carteira: CarteiraPessoa[],
  atividadesPorNome: Map<string, number>,
): CarteiraLinha[] {
  return carteira.map((p) => {
    const ativ = atividadesPorNome.get(chaveNome(p.nome));
    return {
      ...p,
      atividades: ativ ?? null,
      atividadesPorMarco:
        ativ != null && p.processosComMarco > 0
          ? Math.round((ativ / p.processosComMarco) * 10) / 10
          : null,
    };
  });
}

export interface UseCarteiraResult {
  data: CarteiraPessoa[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** `refreshMs = 0` desliga o auto-refresh. O telão passa 60_000. */
export function useCarteiraMarcos(refreshMs = 0): UseCarteiraResult {
  const [data, setData] = useState<CarteiraPessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCarteira();
      if (reqId.current !== id) return;
      setData(res);
    } catch (e: any) {
      if (reqId.current !== id) return;
      console.error("[useCarteiraMarcos]", e);
      setError(e?.message || "Falha ao carregar a carteira");
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  return { data, loading, error, refresh: load };
}
