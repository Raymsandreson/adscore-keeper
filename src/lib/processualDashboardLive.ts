// Camada de dados REAIS do dashboard de Acompanhamento Processual.
// Lê tudo do Supabase Externo via `db`. Não faz escrita.
//
// Estratégia:
//  - lead_processes.movimentacoes (JSONB) é a fonte de verdade para SLAs
//    processuais (Sentença, Acórdão, TST, Trânsito) e para a latência
//    entre atualizações.
//  - legal_cases (status/outcome_date/closed_at) alimenta o resumo.
//  - lead_stage_history alimenta as transições de status do workflow.
//  - lead_activities + kanban_boards alimentam as categorias operacionais
//    (Onboarding, Relatório de Acidente, Benefício INSS, Indenização,
//    Inquérito Policial).

import { db, ensureExternalSession } from "@/integrations/supabase";
import type {
  DashboardProcessualData,
  PeriodoProc,
  CategoriaProtocolo,
  TransicaoStatus,
  SlaFase,
  LatenciaSerie,
} from "./processualDashboardData";

const PERIODO_DIAS: Record<PeriodoProc, number> = { dia: 1, semana: 7, mes: 30 };

// SLAs ideais por bloco (mesmos valores do mock, agora aplicados a dados reais)
const SLA_IDEAL_FASE: Record<string, number> = {
  sentenca: 270,
  acordao: 180,
  tst: 365,
  transito: 540,
};

const SLA_IDEAL_CATEGORIA: Record<string, number> = {
  Onboarding: 3,
  "Relatório de Acidente": 7,
  "Benefício INSS": 10,
  Indenização: 10,
  "Inquérito Policial": 5,
};

const COR_CATEGORIA: Record<string, string> = {
  Onboarding: "#6366f1",
  "Relatório de Acidente": "#06b6d4",
  "Benefício INSS": "#ef4444",
  Indenização: "#f59e0b",
  "Inquérito Policial": "#22c55e",
};

const CATEGORIAS_ORDEM = [
  "Onboarding",
  "Relatório de Acidente",
  "Benefício INSS",
  "Indenização",
  "Inquérito Policial",
] as const;

// ============== Classificadores ==============

export function classifyCategoria(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/onboarding/.test(t)) return "Onboarding";
  if (/relat[óo]rio de acidente|\bsrte\b/.test(t)) return "Relatório de Acidente";
  if (/inss|benef[íi]cio|aux[íi]lio|\bbpc\b|maternidade/.test(t)) return "Benefício INSS";
  if (/indeniza/.test(t)) return "Indenização";
  if (/inqu[ée]rito/.test(t)) return "Inquérito Policial";
  return null;
}

function classifyEventoProcessual(mov: any): keyof typeof SLA_IDEAL_FASE | null {
  const blob = `${mov?.tipo_publicacao || ""} ${mov?.conteudo || ""}`.toLowerCase();
  if (!blob.trim()) return null;
  if (/tr[âa]nsito em julgado/.test(blob)) return "transito";
  if (/\btst\b|tribunal superior do trabalho/.test(blob)) return "tst";
  if (/ac[óo]rd[ãa]o/.test(blob)) return "acordao";
  if (/senten[çc]/.test(blob)) return "sentenca";
  return null;
}

// ============== Cache em memória ==============

type CacheEntry = { at: number; data: DashboardProcessualData };
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(periodo: PeriodoProc): string {
  return `proc:${periodo}`;
}

// ============== Helpers ==============

function startOfPeriod(periodo: PeriodoProc): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const days = PERIODO_DIAS[periodo];
  if (periodo === "dia") return d;
  d.setDate(d.getDate() - days + 1);
  return d;
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 86400000);
}

// ============== Fetcher principal ==============

export async function fetchProcessualDashboard(periodo: PeriodoProc): Promise<DashboardProcessualData> {
  const key = cacheKey(periodo);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    await ensureExternalSession();
  } catch (e) {
    console.warn("[processualDashboardLive] sessão externa falhou:", e);
  }

  const inicio = startOfPeriod(periodo);
  const inicioIso = inicio.toISOString();

  // Disparar queries em paralelo. Cada uma com limites razoáveis.
  const [
    processosRes,
    casesRes,
    stageHistRes,
    actsRes,
    boardsRes,
  ] = await Promise.all([
    (db as any)
      .from("lead_processes")
      .select(
        "id, lead_id, status, started_at, data_distribuicao, movimentacoes, workflow_name, case_id"
      )
      .limit(2000),
    (db as any)
      .from("legal_cases")
      .select("id, lead_id, status, outcome, outcome_date, closed_at, created_at, workflow_board_id, title")
      .limit(5000),
    (db as any)
      .from("lead_stage_history")
      .select("lead_id, from_stage, to_stage, changed_at")
      .gte("changed_at", inicioIso)
      .order("changed_at", { ascending: true })
      .limit(5000),
    (db as any)
      .from("lead_activities")
      .select("id, title, activity_type, status, created_at, completed_at, case_id, lead_id")
      .is("deleted_at", null)
      .gte("created_at", inicioIso)
      .limit(5000),
    (db as any).from("kanban_boards").select("id, name").limit(500),
  ]);

  const processos = processosRes.data ?? [];
  const cases = casesRes.data ?? [];
  const stageHist = stageHistRes.data ?? [];
  const acts = actsRes.data ?? [];
  const boards = boardsRes.data ?? [];

  if (processosRes.error || casesRes.error) {
    console.warn(
      "[processualDashboardLive] erros:",
      processosRes.error,
      casesRes.error,
      stageHistRes.error,
      actsRes.error
    );
  }

  // ============== Bloco 1: Resumo ==============

  const processosAtivos = processos.filter((p: any) => p.status === "em_andamento").length;

  let atualizacoesPeriodo = 0;
  let sentencasPeriodo = 0;
  let transitadosPeriodo = 0;

  for (const p of processos) {
    const movs: any[] = Array.isArray(p.movimentacoes) ? p.movimentacoes : [];
    for (const m of movs) {
      const d = parseDate(m?.data);
      if (!d || d < inicio) continue;
      atualizacoesPeriodo++;
      const evt = classifyEventoProcessual(m);
      if (evt === "sentenca") sentencasPeriodo++;
      if (evt === "transito") transitadosPeriodo++;
    }
  }

  // Complementa contadores com legal_cases (caso "outcome" tenha sido marcado manualmente)
  for (const c of cases) {
    const od = parseDate(c.outcome_date);
    if (od && od >= inicio) {
      const o = (c.outcome || "").toLowerCase();
      if (/senten[çc]/.test(o)) sentencasPeriodo++;
      if (/tr[âa]nsito/.test(o)) transitadosPeriodo++;
    }
  }

  // ============== Bloco 2: SLA por fase ==============

  const slaAcc: Record<string, { soma: number; n: number }> = {
    sentenca: { soma: 0, n: 0 },
    acordao: { soma: 0, n: 0 },
    tst: { soma: 0, n: 0 },
    transito: { soma: 0, n: 0 },
  };

  for (const p of processos) {
    const start = parseDate(p.data_distribuicao) || parseDate(p.started_at);
    if (!start) continue;
    const movs: any[] = Array.isArray(p.movimentacoes) ? p.movimentacoes : [];
    // Marca o primeiro evento de cada tipo por processo
    const visto = new Set<string>();
    for (const m of movs) {
      const evt = classifyEventoProcessual(m);
      if (!evt || visto.has(evt)) continue;
      const d = parseDate(m?.data);
      if (!d) continue;
      // Filtra por período: o marco final precisa cair na janela
      if (d < inicio) continue;
      const dias = daysBetween(start, d);
      slaAcc[evt].soma += dias;
      slaAcc[evt].n++;
      visto.add(evt);
    }
  }

  const sla: SlaFase[] = [
    { key: "sentenca", label: "Até Sentença", slaIdeal: SLA_IDEAL_FASE.sentenca, ...mean(slaAcc.sentenca) },
    { key: "acordao", label: "Até Acórdão", slaIdeal: SLA_IDEAL_FASE.acordao, ...mean(slaAcc.acordao) },
    { key: "tst", label: "Até Decisão TST", slaIdeal: SLA_IDEAL_FASE.tst, ...mean(slaAcc.tst) },
    {
      key: "transito",
      label: "Até Trânsito em Julgado",
      slaIdeal: SLA_IDEAL_FASE.transito,
      ...mean(slaAcc.transito),
    },
  ];

  // ============== Bloco 3: Latência ==============
  // Para cada processo com ≥2 movimentações dentro do período, calcula
  // gap em horas entre pares consecutivos e agrega por dia (média).

  const latPorDia = new Map<string, { soma: number; n: number }>();
  for (const p of processos) {
    const movs: any[] = Array.isArray(p.movimentacoes) ? p.movimentacoes : [];
    const datasNoPeriodo = movs
      .map((m) => parseDate(m?.data))
      .filter((d): d is Date => !!d && d >= inicio)
      .sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < datasNoPeriodo.length; i++) {
      const horas = (datasNoPeriodo[i].getTime() - datasNoPeriodo[i - 1].getTime()) / 3600000;
      if (horas < 0 || horas > 24 * 60) continue; // ignora ruído > 60 dias
      const k = datasNoPeriodo[i].toISOString().slice(0, 10);
      const acc = latPorDia.get(k) || { soma: 0, n: 0 };
      acc.soma += horas;
      acc.n++;
      latPorDia.set(k, acc);
    }
  }

  const totalDias = PERIODO_DIAS[periodo];
  const latencia: LatenciaSerie[] = [];
  for (let i = totalDias - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const acc = latPorDia.get(k);
    latencia.push({ data: k, horas: acc && acc.n > 0 ? Math.round(acc.soma / acc.n) : 0 });
  }

  // ============== Bloco 4: Transições ==============
  // Agrupa lead_stage_history por lead em ordem cronológica e mede tempo
  // entre etapas consecutivas. Top 7 pares mais frequentes.

  const histPorLead = new Map<string, any[]>();
  for (const h of stageHist) {
    if (!h.lead_id || !h.to_stage) continue;
    const arr = histPorLead.get(h.lead_id) || [];
    arr.push(h);
    histPorLead.set(h.lead_id, arr);
  }
  const transAcc = new Map<string, { soma: number; n: number; de: string; para: string }>();
  for (const arr of histPorLead.values()) {
    arr.sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
    for (let i = 1; i < arr.length; i++) {
      const de = String(arr[i - 1].to_stage);
      const para = String(arr[i].to_stage);
      if (de === para) continue;
      const dias = daysBetween(new Date(arr[i - 1].changed_at), new Date(arr[i].changed_at));
      const key = `${de}→${para}`;
      const acc = transAcc.get(key) || { soma: 0, n: 0, de, para };
      acc.soma += dias;
      acc.n++;
      transAcc.set(key, acc);
    }
  }
  const transicoes: TransicaoStatus[] = Array.from(transAcc.values())
    .filter((t) => t.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 7)
    .map((t) => ({
      de: shortStage(t.de),
      para: shortStage(t.para),
      tempoMedioDias: Math.round(t.soma / t.n),
      slaIdealDias: Math.max(3, Math.round((t.soma / t.n) * 0.8)),
      amostra: t.n,
    }));

  // ============== Bloco 5: Categorias ==============

  const boardCategory = new Map<string, string | null>();
  for (const b of boards) boardCategory.set(b.id, classifyCategoria(b.name));

  // Mapeia caso → categoria pelo workflow_board_id
  const caseCategory = new Map<string, string | null>();
  for (const c of cases) {
    const fromBoard = c.workflow_board_id ? boardCategory.get(c.workflow_board_id) : null;
    const fromTitle = classifyCategoria(c.title);
    caseCategory.set(c.id, fromBoard || fromTitle);
  }

  const catAcc: Record<string, { soma: number; n: number; fechados: number; protocolados: number; pendentes: number }> = {};
  for (const cat of CATEGORIAS_ORDEM) {
    catAcc[cat] = { soma: 0, n: 0, fechados: 0, protocolados: 0, pendentes: 0 };
  }

  for (const a of acts) {
    const cat =
      (a.case_id && caseCategory.get(a.case_id)) ||
      classifyCategoria(a.title) ||
      classifyCategoria(a.activity_type);
    if (!cat || !catAcc[cat]) continue;
    if (a.status === "concluida" || a.completed_at) {
      catAcc[cat].fechados++;
      const created = parseDate(a.created_at);
      const done = parseDate(a.completed_at);
      if (created && done) {
        catAcc[cat].soma += daysBetween(created, done);
        catAcc[cat].n++;
      }
    } else {
      catAcc[cat].pendentes++;
    }
  }

  // Protocolados: processos com pelo menos uma movimentação ou data_distribuicao
  // dentro do período cuja categoria do caso bate.
  for (const p of processos) {
    const cat = p.case_id ? caseCategory.get(p.case_id) : null;
    if (!cat || !catAcc[cat]) continue;
    const dist = parseDate(p.data_distribuicao);
    if (dist && dist >= inicio) catAcc[cat].protocolados++;
  }

  const categorias: CategoriaProtocolo[] = CATEGORIAS_ORDEM.map((cat) => {
    const acc = catAcc[cat];
    const ideal = SLA_IDEAL_CATEGORIA[cat] ?? 7;
    const tempoMedio = acc.n > 0 ? acc.soma / acc.n : 0;
    return {
      categoria: cat,
      cor: COR_CATEGORIA[cat],
      slaIdealDias: ideal,
      tempoMedioDias: Number(tempoMedio.toFixed(1)),
      amostra: acc.n,
      fechadosNoPeriodo: acc.fechados,
      protocoladosNoPeriodo: acc.protocolados,
      pendentes: acc.pendentes,
    };
  });

  const result: DashboardProcessualData = {
    resumo: {
      processosAtivos,
      atualizacoesPeriodo,
      sentencasPeriodo,
      transitadosPeriodo,
    },
    sla,
    latencia,
    transicoes,
    categorias,
  };

  cache.set(key, { at: Date.now(), data: result });
  console.log("[processualDashboardLive] resultado", {
    periodo,
    processos: processos.length,
    cases: cases.length,
    stageHist: stageHist.length,
    acts: acts.length,
    boards: boards.length,
    resumo: result.resumo,
  });
  return result;
}

function mean(acc: { soma: number; n: number }): { tempoMedio: number; amostra: number; tendencia: number } {
  if (acc.n === 0) return { tempoMedio: 0, amostra: 0, tendencia: 0 };
  return { tempoMedio: Math.round(acc.soma / acc.n), amostra: acc.n, tendencia: 0 };
}

function shortStage(s: string): string {
  // IDs de etapa costumam ser uuids ou slugs verbosos. Encurta.
  if (s.length <= 18) return s;
  return s.slice(0, 16) + "…";
}
