// Dataset mockado do Dashboard de Funil de Conversão (BPC-LOAS)
// Todos os números reais para "Este mês"; "Hoje" e "Semana" são subconjuntos
// proporcionais coerentes, derivados do mesmo schema.

export type Periodo = "hoje" | "semana" | "mes";

export type EtapaKey =
  | "recepcao"
  | "viabilidade"
  | "aguardando"
  | "enviada"
  | "assinada"
  | "protocolo"
  | "desqualificado";

export type Etapa = {
  key: EtapaKey;
  nome: string;
  cor: string;
  count: number;
};

export type Acolhedor = {
  nome: string;
  count: number;
  cor: string;
};

export type TimeLead = {
  nome: string;
  acolhedor: string | null;
};

export type Mudanca = {
  de: string;
  para: string;
  casos: number;
};

export type Kpis = {
  totalBase: number;
  aLigar: number;
  chegadasHoje: number;
  chegadasSemana: number;
  chegadasMes: number;
  noWhatsApp: number;
  inviavel: number;
};

export type PeriodoData = {
  kpis: Kpis;
  etapas: Etapa[];
  acolhedores: Acolhedor[];
  procuracaoAssinada: TimeLead[];
  procuracaoAssinadaTotal: number;
  documentosProtocolo: TimeLead[];
  documentosProtocoloTotal: number;
  mudancas: Mudanca[];
  mudancasTotal: number;
  noResponseCount: number;
};

const CORES_ETAPAS: Record<EtapaKey, { nome: string; cor: string }> = {
  recepcao: { nome: "Recepção", cor: "#6366f1" },
  viabilidade: { nome: "Análise de Viabilidade", cor: "#8b5cf6" },
  aguardando: { nome: "Aguardando Documentos", cor: "#06b6d4" },
  enviada: { nome: "Procuração Enviada", cor: "#14b8a6" },
  assinada: { nome: "Procuração Assinada", cor: "#22c55e" },
  protocolo: { nome: "Documentos p/ Protocolo", cor: "#eab308" },
  desqualificado: { nome: "Desqualificado", cor: "#5b6172" },
};

const CORES_ACOLHEDORES: Record<string, string> = {
  Israel: "#6366f1",
  Mateus: "#8b5cf6",
  Karolyne: "#06b6d4",
  Keilane: "#14b8a6",
  Cris: "#22c55e",
  API: "#eab308",
  Andressa: "#f0a3a0",
};

function buildEtapas(
  counts: Record<EtapaKey, number>
): Etapa[] {
  return (Object.keys(CORES_ETAPAS) as EtapaKey[]).map((k) => ({
    key: k,
    nome: CORES_ETAPAS[k].nome,
    cor: CORES_ETAPAS[k].cor,
    count: counts[k],
  }));
}

function buildAcolhedores(
  counts: Record<string, number>
): Acolhedor[] {
  return Object.entries(counts).map(([nome, count]) => ({
    nome,
    count,
    cor: CORES_ACOLHEDORES[nome] ?? "#6366f1",
  }));
}

// ============ ESTE MÊS (números reais) ============
const MES: PeriodoData = {
  kpis: {
    totalBase: 3273,
    aLigar: 3273,
    chegadasHoje: 66,
    chegadasSemana: 171,
    chegadasMes: 2411,
    noWhatsApp: 0,
    inviavel: 0,
  },
  etapas: buildEtapas({
    recepcao: 2687,
    viabilidade: 97,
    aguardando: 107,
    enviada: 7,
    assinada: 132,
    protocolo: 12,
    desqualificado: 220,
  }),
  acolhedores: buildAcolhedores({
    Israel: 1003,
    Mateus: 923,
    Karolyne: 753,
    Keilane: 402,
    Cris: 101,
    API: 47,
    Andressa: 43,
  }),
  procuracaoAssinada: [
    { nome: "PREV 1573 Samuel Henrique…", acolhedor: null },
    { nome: "PREV 1574 Rio de janeiro - RJ…", acolhedor: "Israel" },
    { nome: "Beatriz hernandez", acolhedor: null },
    { nome: "PREV 1576 João Luccas dos…", acolhedor: null },
    { nome: "Michela Corrêa de Ávila", acolhedor: "Israel" },
    { nome: "PREV 1409 ananindeua - PA…", acolhedor: "Israel" },
  ],
  procuracaoAssinadaTotal: 148,
  documentosProtocolo: [
    { nome: "Mateus Santos Saraiva", acolhedor: null },
    { nome: "FAMÍLIA 356 - JP - Felipe…", acolhedor: null },
    { nome: "PREV 1388 - Nicolas - Thayna…", acolhedor: null },
    { nome: "prev 1266 Thiane Borges…", acolhedor: null },
    { nome: "PREV 1395 - Gabriel - Karina…", acolhedor: null },
    { nome: "PREV 1409 Bonito - MS (ZON…", acolhedor: "Mateus" },
  ],
  documentosProtocoloTotal: 19,
  mudancas: [
    { de: "Recepção", para: "no_response", casos: 201 },
    { de: "Recepção", para: "Aguardando Documentos", casos: 22 },
    { de: "Aguardando Documentos", para: "no_response", casos: 9 },
    { de: "Recepção", para: "closed", casos: 8 },
    { de: "Documentos p/ Protocolo", para: "Desqualificado", casos: 1 },
    { de: "Documentos p/ Protocolo", para: "Procuração Assinada", casos: 1 },
    { de: "Recepção", para: "Análise de Viabilidade", casos: 1 },
  ],
  mudancasTotal: 243,
  noResponseCount: 210,
};

// Helper: gera subset proporcional para Hoje / Semana
function scaleSubset(base: PeriodoData, fator: number, kpiOverrides: Partial<Kpis>): PeriodoData {
  const scaleEtapa = (n: number) => Math.max(0, Math.round(n * fator));
  const etapas = base.etapas.map((e) => ({ ...e, count: scaleEtapa(e.count) }));
  // garantir total = chegadas do período + ativos remanescentes não faz sentido aqui,
  // mantemos proporção pura para fins de UI

  const acolhedores = base.acolhedores
    .map((a) => ({ ...a, count: Math.max(0, Math.round(a.count * fator)) }))
    .filter((a) => a.count > 0);

  const mudancas = base.mudancas
    .map((m) => ({ ...m, casos: Math.max(0, Math.round(m.casos * fator)) }))
    .filter((m) => m.casos > 0);

  const mudancasTotal = mudancas.reduce((s, m) => s + m.casos, 0);
  const noResponseCount = mudancas
    .filter((m) => m.para === "no_response")
    .reduce((s, m) => s + m.casos, 0);

  return {
    kpis: { ...base.kpis, ...kpiOverrides },
    etapas,
    acolhedores,
    procuracaoAssinada: base.procuracaoAssinada.slice(0, 4),
    procuracaoAssinadaTotal: Math.max(1, Math.round(base.procuracaoAssinadaTotal * fator)),
    documentosProtocolo: base.documentosProtocolo.slice(0, 4),
    documentosProtocoloTotal: Math.max(1, Math.round(base.documentosProtocoloTotal * fator)),
    mudancas,
    mudancasTotal,
    noResponseCount,
  };
}

const HOJE: PeriodoData = scaleSubset(MES, 66 / 2411, {});
const SEMANA: PeriodoData = scaleSubset(MES, 171 / 2411, {});

export const DATASET: Record<Periodo, PeriodoData> = {
  hoje: HOJE,
  semana: SEMANA,
  mes: MES,
};

export const PERIODO_LABEL: Record<Periodo, string> = {
  hoje: "Hoje",
  semana: "Semana",
  mes: "Este mês",
};

// Helpers de formatação pt-BR
export const fmt = new Intl.NumberFormat("pt-BR");
export const fmtPct = (n: number, digits = 1) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
