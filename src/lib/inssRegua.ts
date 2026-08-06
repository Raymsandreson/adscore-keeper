// Régua do processo administrativo INSS — fonte da tela de acompanhamento.
//
// Lê a view `inss_requerimento_status` (migration 20260806170000), que ancora a
// régua no RESULTADO e não no status. Motivo: o status do INSS não é uma fila
// que só anda pra frente — no histórico um requerimento sai de "Concluída" e
// volta pra "Pendente" 103×, "Exigência" 50×, "Em Análise" 27×. Se a régua
// seguisse o status, mostraria como concluído o que voltou atrás.
//
// Estações: 1 protocolado → 2 concedido | indeferido | encerrado.
// Exigência NÃO é estação: é pendência que vai e volta. Vira alerta com o
// número de dias parados, que é o que gera ação.

import { db, ensureExternalSession } from "@/integrations/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

export type MarcoInss = "protocolado" | "concedido" | "indeferido" | "encerrado";

export interface RequerimentoInss {
  id: string;
  requerimentoNumber: string;
  caseId: string | null;
  leadId: string | null;
  beneficio: string | null;
  servico: string | null;
  protocolDate: string | null;
  marcoAtual: MarcoInss;
  marcoOrdem: number;
  temDesfecho: boolean;
  statusNormalizado: string | null;
  emExigencia: boolean;
  diasEmExigencia: number | null;
  concluidaSemResultado: boolean;
  despacho: string | null;
  ultimoEmail: string | null;
}

export interface ResumoInss {
  total: number;
  protocolado: number;
  concedido: number;
  indeferido: number;
  encerrado: number;
  emExigencia: number;
  /** Exigências paradas há mais de 180 dias — o grupo que exige ação. */
  exigenciaVencida: number;
  concluidaSemResultado: number;
  /** Deferidos ÷ (deferidos + indeferidos). null quando não há desfecho. */
  taxaDeferimento: number | null;
  medianaDiasExigencia: number | null;
}

export const MARCO_INSS_LABEL: Record<MarcoInss, string> = {
  protocolado: "Protocolado — aguardando",
  concedido: "Concessão administrativa",
  indeferido: "Indeferimento administrativo",
  encerrado: "Encerrado sem análise",
};

/** Exigência parada além disso é tratada como crítica na tela. */
export const DIAS_EXIGENCIA_CRITICA = 180;

const SELECT_COLS =
  "id, requerimento_number, case_id, lead_id, benefit_type, servico, protocol_date, " +
  "marco_atual, marco_ordem, tem_desfecho, status_normalizado, em_exigencia, " +
  "dias_em_exigencia, concluida_sem_resultado, despacho, last_email_at";

function mediana(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function resumir(linhas: RequerimentoInss[]): ResumoInss {
  const conta = (m: MarcoInss) => linhas.filter((l) => l.marcoAtual === m).length;
  const concedido = conta("concedido");
  const indeferido = conta("indeferido");
  const comDesfechoDeMerito = concedido + indeferido;
  const diasExig = linhas
    .filter((l) => l.emExigencia && l.diasEmExigencia != null)
    .map((l) => l.diasEmExigencia as number);

  return {
    total: linhas.length,
    protocolado: conta("protocolado"),
    concedido,
    indeferido,
    encerrado: conta("encerrado"),
    emExigencia: linhas.filter((l) => l.emExigencia).length,
    exigenciaVencida: linhas.filter(
      (l) => l.emExigencia && (l.diasEmExigencia ?? 0) > DIAS_EXIGENCIA_CRITICA,
    ).length,
    concluidaSemResultado: linhas.filter((l) => l.concluidaSemResultado).length,
    // Só sobre desfecho de MÉRITO: cancelado/arquivado não é derrota, é ausência
    // de análise — incluí-lo derrubaria a taxa sem que ninguém tenha perdido.
    taxaDeferimento: comDesfechoDeMerito
      ? Math.round((100 * concedido) / comDesfechoDeMerito)
      : null,
    medianaDiasExigencia: mediana(diasExig),
  };
}

export async function fetchRequerimentos(): Promise<RequerimentoInss[]> {
  await ensureExternalSession();
  const { data, error } = await (db as any)
    .from("inss_requerimento_status")
    .select(SELECT_COLS)
    .order("marco_ordem", { ascending: true })
    .order("dias_em_exigencia", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    requerimentoNumber: r.requerimento_number ?? "",
    caseId: r.case_id ?? null,
    leadId: r.lead_id ?? null,
    beneficio: r.benefit_type ?? null,
    servico: r.servico ?? null,
    protocolDate: r.protocol_date ?? null,
    marcoAtual: (r.marco_atual ?? "protocolado") as MarcoInss,
    marcoOrdem: Number(r.marco_ordem ?? 1),
    temDesfecho: !!r.tem_desfecho,
    statusNormalizado: r.status_normalizado ?? null,
    emExigencia: !!r.em_exigencia,
    diasEmExigencia: r.dias_em_exigencia == null ? null : Number(r.dias_em_exigencia),
    concluidaSemResultado: !!r.concluida_sem_resultado,
    despacho: r.despacho ?? null,
    ultimoEmail: r.last_email_at ?? null,
  }));
}

/**
 * CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO. Processo ADMINISTRATIVO guarda número de
 * requerimento em process_number e nunca terá marco do Escavador — a consulta
 * volta 422 (206 chamadas desperdiçadas no backfill de 30/07/2026). É o que
 * distingue "ainda não buscamos" de "não existe fonte para buscar".
 */
export function ehNumeroCnj(n: string | null | undefined): boolean {
  return !!n && /^\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(n.trim());
}

/** Busca o requerimento administrativo por número. null = não capturado. */
export async function fetchRequerimentoPorNumero(
  numero: string,
): Promise<RequerimentoInss | null> {
  await ensureExternalSession();
  const { data, error } = await (db as any)
    .from("inss_requerimento_status")
    .select(SELECT_COLS)
    .eq("requerimento_number", numero.trim())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r: any = data;
  return {
    id: r.id,
    requerimentoNumber: r.requerimento_number ?? "",
    caseId: r.case_id ?? null,
    leadId: r.lead_id ?? null,
    beneficio: r.benefit_type ?? null,
    servico: r.servico ?? null,
    protocolDate: r.protocol_date ?? null,
    marcoAtual: (r.marco_atual ?? "protocolado") as MarcoInss,
    marcoOrdem: Number(r.marco_ordem ?? 1),
    temDesfecho: !!r.tem_desfecho,
    statusNormalizado: r.status_normalizado ?? null,
    emExigencia: !!r.em_exigencia,
    diasEmExigencia: r.dias_em_exigencia == null ? null : Number(r.dias_em_exigencia),
    concluidaSemResultado: !!r.concluida_sem_resultado,
    despacho: r.despacho ?? null,
    ultimoEmail: r.last_email_at ?? null,
  };
}

export interface UseReguaInssResult {
  data: RequerimentoInss[];
  resumo: ResumoInss;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useReguaInss(): UseReguaInssResult {
  const [data, setData] = useState<RequerimentoInss[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRequerimentos();
      if (reqId.current !== id) return;
      setData(res);
    } catch (e: any) {
      if (reqId.current !== id) return;
      console.error("[useReguaInss]", e);
      setError(e?.message || "Falha ao carregar a régua do INSS");
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, resumo: resumir(data), loading, error, refresh: load };
}
