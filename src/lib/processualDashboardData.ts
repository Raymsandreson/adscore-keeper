// Dataset mockado do Dashboard de Acompanhamento Processual
// Tempos sempre em DIAS (corridos), salvo indicação em contrário.

export type PeriodoProc = "dia" | "semana" | "mes";

export interface SlaFase {
  key: string;
  label: string;
  tempoMedio: number; // dias
  slaIdeal: number; // dias
  amostra: number; // nº de processos considerados
  tendencia: number; // variação % vs período anterior
}

export interface LatenciaSerie {
  data: string; // YYYY-MM-DD
  horas: number; // latência média em horas entre atualizações
}

export interface TransicaoStatus {
  de: string;
  para: string;
  tempoMedioDias: number;
  slaIdealDias: number;
  amostra: number;
}

export interface CategoriaProtocolo {
  categoria: string;
  cor: string;
  tempoMedioDias: number;
  slaIdealDias: number;
  amostra: number;
  fechadosNoPeriodo: number;
  protocoladosNoPeriodo: number;
  pendentes: number;
}

export interface ResponsavelOption {
  id: string;
  nome: string;
}

export interface EtiquetaOption {
  id: string;
  nome: string;
  cor: string;
}

export interface DashboardProcessualData {
  sla: SlaFase[];
  latencia: LatenciaSerie[];
  transicoes: TransicaoStatus[];
  categorias: CategoriaProtocolo[];
  resumo: {
    processosAtivos: number;
    atualizacoesPeriodo: number;
    sentencasPeriodo: number;
    transitadosPeriodo: number;
  };
}

export const RESPONSAVEIS: ResponsavelOption[] = [
  { id: "all", nome: "Todos os responsáveis" },
  { id: "abderaman", nome: "Abderaman" },
  { id: "luana", nome: "Luana" },
  { id: "israel", nome: "Israel" },
  { id: "mateus", nome: "Mateus" },
  { id: "karolyne", nome: "Karolyne" },
];

export const ETIQUETAS: EtiquetaOption[] = [
  { id: "all", nome: "Todas as etiquetas", cor: "#6366f1" },
  { id: "urgente", nome: "Urgente", cor: "#ef4444" },
  { id: "prioridade", nome: "Prioridade", cor: "#f59e0b" },
  { id: "aguardando-cliente", nome: "Aguardando cliente", cor: "#06b6d4" },
  { id: "em-protocolo", nome: "Em protocolo", cor: "#22c55e" },
  { id: "recurso", nome: "Recurso", cor: "#8b5cf6" },
];

const MES: DashboardProcessualData = {
  resumo: {
    processosAtivos: 1342,
    atualizacoesPeriodo: 4218,
    sentencasPeriodo: 87,
    transitadosPeriodo: 34,
  },
  sla: [
    { key: "sentenca", label: "Até Sentença", tempoMedio: 312, slaIdeal: 270, amostra: 87, tendencia: -4.2 },
    { key: "acordao", label: "Até Acórdão", tempoMedio: 198, slaIdeal: 180, amostra: 41, tendencia: 2.1 },
    { key: "tst", label: "Até Decisão TST", tempoMedio: 421, slaIdeal: 365, amostra: 12, tendencia: -1.5 },
    { key: "transito", label: "Até Trânsito em Julgado", tempoMedio: 547, slaIdeal: 540, amostra: 34, tendencia: 0.8 },
  ],
  latencia: Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const base = 48 + Math.sin(i / 4) * 14 + (i % 7 === 0 ? 18 : 0);
    return {
      data: d.toISOString().slice(0, 10),
      horas: Math.max(8, Math.round(base + (Math.random() * 12 - 6))),
    };
  }),
  transicoes: [
    { de: "Distribuído", para: "Citação", tempoMedioDias: 18, slaIdealDias: 15, amostra: 162 },
    { de: "Citação", para: "Contestação", tempoMedioDias: 22, slaIdealDias: 20, amostra: 158 },
    { de: "Contestação", para: "Audiência", tempoMedioDias: 64, slaIdealDias: 45, amostra: 134 },
    { de: "Audiência", para: "Sentença", tempoMedioDias: 71, slaIdealDias: 60, amostra: 87 },
    { de: "Sentença", para: "Recurso", tempoMedioDias: 12, slaIdealDias: 15, amostra: 54 },
    { de: "Recurso", para: "Acórdão", tempoMedioDias: 198, slaIdealDias: 180, amostra: 41 },
    { de: "Acórdão", para: "Trânsito em Julgado", tempoMedioDias: 89, slaIdealDias: 90, amostra: 34 },
  ],
  categorias: [
    {
      categoria: "Onboarding",
      cor: "#6366f1",
      tempoMedioDias: 4.2,
      slaIdealDias: 3,
      amostra: 148,
      fechadosNoPeriodo: 132,
      protocoladosNoPeriodo: 124,
      pendentes: 8,
    },
    {
      categoria: "Relatório de Acidente",
      cor: "#06b6d4",
      tempoMedioDias: 9.7,
      slaIdealDias: 7,
      amostra: 62,
      fechadosNoPeriodo: 51,
      protocoladosNoPeriodo: 44,
      pendentes: 7,
    },
    {
      categoria: "Benefício INSS",
      cor: "#ef4444",
      tempoMedioDias: 18.4,
      slaIdealDias: 10,
      amostra: 211,
      fechadosNoPeriodo: 189,
      protocoladosNoPeriodo: 142,
      pendentes: 47,
    },
    {
      categoria: "Indenização",
      cor: "#f59e0b",
      tempoMedioDias: 11.6,
      slaIdealDias: 10,
      amostra: 94,
      fechadosNoPeriodo: 78,
      protocoladosNoPeriodo: 69,
      pendentes: 9,
    },
    {
      categoria: "Inquérito Policial",
      cor: "#22c55e",
      tempoMedioDias: 6.1,
      slaIdealDias: 5,
      amostra: 38,
      fechadosNoPeriodo: 31,
      protocoladosNoPeriodo: 28,
      pendentes: 3,
    },
  ],
};

function scale(data: DashboardProcessualData, fator: number, latenciaDays: number): DashboardProcessualData {
  const round = (n: number) => Math.max(1, Math.round(n * fator));
  return {
    resumo: {
      processosAtivos: data.resumo.processosAtivos,
      atualizacoesPeriodo: round(data.resumo.atualizacoesPeriodo),
      sentencasPeriodo: round(data.resumo.sentencasPeriodo),
      transitadosPeriodo: round(data.resumo.transitadosPeriodo),
    },
    sla: data.sla.map((s) => ({
      ...s,
      amostra: round(s.amostra),
      // pequeno jitter nos tempos para variar entre períodos
      tempoMedio: Math.round(s.tempoMedio * (0.96 + Math.random() * 0.08)),
    })),
    latencia: data.latencia.slice(-latenciaDays),
    transicoes: data.transicoes.map((t) => ({ ...t, amostra: round(t.amostra) })),
    categorias: data.categorias.map((c) => ({
      ...c,
      amostra: round(c.amostra),
      fechadosNoPeriodo: round(c.fechadosNoPeriodo),
      protocoladosNoPeriodo: round(c.protocoladosNoPeriodo),
      pendentes: Math.max(0, Math.round(c.pendentes * fator)),
    })),
  };
}

export const DATASET_PROC: Record<PeriodoProc, DashboardProcessualData> = {
  mes: MES,
  semana: scale(MES, 7 / 30, 7),
  dia: scale(MES, 1 / 30, 1),
};

export const PERIODO_PROC_LABEL: Record<PeriodoProc, string> = {
  dia: "Hoje",
  semana: "Esta semana",
  mes: "Este mês",
};

export const fmtInt = new Intl.NumberFormat("pt-BR");
export const fmtDec = (n: number, d = 1) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

export function slaStatus(atual: number, ideal: number): "ok" | "alerta" | "critico" {
  const ratio = atual / ideal;
  if (ratio <= 1) return "ok";
  if (ratio <= 1.2) return "alerta";
  return "critico";
}

export function slaTone(status: "ok" | "alerta" | "critico") {
  switch (status) {
    case "ok":
      return {
        text: "text-emerald-600 dark:text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/30",
        dot: "bg-emerald-500",
        label: "Dentro do SLA",
      };
    case "alerta":
      return {
        text: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
        dot: "bg-amber-500",
        label: "Atenção",
      };
    case "critico":
      return {
        text: "text-red-600 dark:text-red-400",
        bg: "bg-red-500/10",
        border: "border-red-500/30",
        dot: "bg-red-500",
        label: "Crítico",
      };
  }
}
