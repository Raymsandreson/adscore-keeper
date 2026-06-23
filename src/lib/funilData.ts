// Dataset estático do dashboard "Funil de Conversão" — BPC-LOAS.
// Todos os números pt-BR. "Este mês" usa os números reais do enunciado;
// "Hoje" e "Esta semana" são subconjuntos proporcionais coerentes.

export type Periodo = 'hoje' | 'semana' | 'mes';

export interface EtapaDist {
  id: string;
  nome: string;
  cor: string;
  count: number;
}

export interface AcolhedorRow {
  nome: string;
  count: number;
  cor: string;
}

export interface StageTimeRow {
  lead: string;
  acolhedor: string | null;
}

export interface StageChangeRow {
  from: string;
  to: string;
  casos: number;
}

export interface PeriodoDataset {
  label: string;
  kpis: {
    totalBase: number;
    aLigar: number;
    chegadasHoje: number;
    estaSemana: number;
    esteMes: number;
    noWhatsapp: number;
    inviavel: number;
  };
  // distribuição dos LEADS que chegaram no período por etapa atual
  distribuicao: EtapaDist[];
  acolhedores: AcolhedorRow[];
  procuracaoAssinada: { total: number; leads: StageTimeRow[] };
  documentosProtocolo: { total: number; leads: StageTimeRow[] };
  mudancas: {
    total: number;
    noResponseTotal: number; // soma das mudanças *_to_no_response
    rows: StageChangeRow[];
  };
}

// Paleta oficial das etapas
export const STAGE_COLORS: Record<string, string> = {
  recepcao: '#6366f1',
  analise: '#8b5cf6',
  aguardando: '#06b6d4',
  procEnviada: '#14b8a6',
  procAssinada: '#22c55e',
  docsProtocolo: '#eab308',
  desqualificado: '#5b6172',
};

const ACOLHEDOR_CORES = [
  '#6366f1', // Israel
  '#8b5cf6', // Mateus
  '#06b6d4', // Karolyne
  '#22c55e', // Keilane
  '#eab308', // Cris
  '#f0a3a0', // API
  '#14b8a6', // Andressa
];

const acol = (entries: Array<[string, number]>): AcolhedorRow[] =>
  entries.map(([nome, count], i) => ({ nome, count, cor: ACOLHEDOR_CORES[i % ACOLHEDOR_CORES.length] }));

const dist = (counts: Record<string, number>): EtapaDist[] => [
  { id: 'recepcao', nome: 'Recepção', cor: STAGE_COLORS.recepcao, count: counts.recepcao },
  { id: 'analise', nome: 'Análise de Viabilidade', cor: STAGE_COLORS.analise, count: counts.analise },
  { id: 'aguardando', nome: 'Aguardando Documentos', cor: STAGE_COLORS.aguardando, count: counts.aguardando },
  { id: 'procEnviada', nome: 'Procuração Enviada', cor: STAGE_COLORS.procEnviada, count: counts.procEnviada },
  { id: 'procAssinada', nome: 'Procuração Assinada', cor: STAGE_COLORS.procAssinada, count: counts.procAssinada },
  { id: 'docsProtocolo', nome: 'Documentos p/ Protocolo', cor: STAGE_COLORS.docsProtocolo, count: counts.docsProtocolo },
  { id: 'desqualificado', nome: 'Desqualificado', cor: STAGE_COLORS.desqualificado, count: counts.desqualificado },
];

export const FUNIL_DATA: Record<Periodo, PeriodoDataset> = {
  mes: {
    label: 'Este mês',
    kpis: {
      totalBase: 3273,
      aLigar: 3273,
      chegadasHoje: 66,
      estaSemana: 171,
      esteMes: 2411,
      noWhatsapp: 0,
      inviavel: 0,
    },
    distribuicao: dist({
      recepcao: 2687,
      analise: 97,
      aguardando: 107,
      procEnviada: 7,
      procAssinada: 132,
      docsProtocolo: 12,
      desqualificado: 220,
    }),
    acolhedores: acol([
      ['Israel', 1003],
      ['Mateus', 923],
      ['Karolyne', 753],
      ['Keilane', 402],
      ['Cris', 101],
      ['API', 47],
      ['Andressa', 43],
    ]),
    procuracaoAssinada: {
      total: 148,
      leads: [
        { lead: 'PREV 1573 Samuel Henrique Almeida da Silva — BPC/LOAS', acolhedor: null },
        { lead: 'PREV 1574 Rio de janeiro - RJ — Maria Aparecida (BPC)', acolhedor: 'Israel' },
        { lead: 'Beatriz hernandez', acolhedor: null },
        { lead: 'PREV 1576 João Luccas dos Santos Oliveira', acolhedor: null },
        { lead: 'Michela Corrêa de Ávila', acolhedor: 'Israel' },
        { lead: 'PREV 1409 ananindeua - PA — Família Gomes', acolhedor: 'Israel' },
      ],
    },
    documentosProtocolo: {
      total: 19,
      leads: [
        { lead: 'Mateus Santos Saraiva', acolhedor: null },
        { lead: 'FAMÍLIA 356 - JP - Felipe Henrique (BPC autismo)', acolhedor: null },
        { lead: 'PREV 1388 - Nicolas - Thayna Santos', acolhedor: null },
        { lead: 'prev 1266 Thiane Borges Salles', acolhedor: null },
        { lead: 'PREV 1395 - Gabriel - Karina Souza', acolhedor: null },
        { lead: 'PREV 1409 Bonito - MS (ZONA RURAL)', acolhedor: 'Mateus' },
      ],
    },
    mudancas: {
      total: 243,
      noResponseTotal: 210,
      rows: [
        { from: 'Recepção', to: 'no_response', casos: 201 },
        { from: 'Recepção', to: 'Aguardando Documentos', casos: 22 },
        { from: 'Aguardando Documentos', to: 'no_response', casos: 9 },
        { from: 'Recepção', to: 'closed', casos: 8 },
        { from: 'Documentos p/ Protocolo', to: 'Desqualificado', casos: 1 },
        { from: 'Documentos p/ Protocolo', to: 'Procuração Assinada', casos: 1 },
        { from: 'Recepção', to: 'Análise de Viabilidade', casos: 1 },
      ],
    },
  },

  semana: {
    label: 'Esta semana',
    kpis: {
      totalBase: 3273,
      aLigar: 3273,
      chegadasHoje: 66,
      estaSemana: 171,
      esteMes: 2411,
      noWhatsapp: 0,
      inviavel: 0,
    },
    distribuicao: dist({
      recepcao: 142,
      analise: 6,
      aguardando: 8,
      procEnviada: 1,
      procAssinada: 4,
      docsProtocolo: 1,
      desqualificado: 9,
    }),
    acolhedores: acol([
      ['Israel', 54],
      ['Mateus', 49],
      ['Karolyne', 38],
      ['Keilane', 19],
      ['Cris', 5],
      ['API', 4],
      ['Andressa', 2],
    ]),
    procuracaoAssinada: {
      total: 11,
      leads: [
        { lead: 'PREV 1574 Rio de janeiro - RJ — Maria Aparecida', acolhedor: 'Israel' },
        { lead: 'Michela Corrêa de Ávila', acolhedor: 'Israel' },
        { lead: 'PREV 1576 João Luccas dos Santos Oliveira', acolhedor: null },
      ],
    },
    documentosProtocolo: {
      total: 3,
      leads: [
        { lead: 'PREV 1395 - Gabriel - Karina Souza', acolhedor: null },
        { lead: 'PREV 1409 Bonito - MS (ZONA RURAL)', acolhedor: 'Mateus' },
      ],
    },
    mudancas: {
      total: 25,
      noResponseTotal: 22,
      rows: [
        { from: 'Recepção', to: 'no_response', casos: 20 },
        { from: 'Recepção', to: 'Aguardando Documentos', casos: 2 },
        { from: 'Aguardando Documentos', to: 'no_response', casos: 2 },
        { from: 'Recepção', to: 'closed', casos: 1 },
      ],
    },
  },

  hoje: {
    label: 'Hoje',
    kpis: {
      totalBase: 3273,
      aLigar: 3273,
      chegadasHoje: 66,
      estaSemana: 171,
      esteMes: 2411,
      noWhatsapp: 0,
      inviavel: 0,
    },
    distribuicao: dist({
      recepcao: 58,
      analise: 2,
      aguardando: 2,
      procEnviada: 0,
      procAssinada: 1,
      docsProtocolo: 0,
      desqualificado: 3,
    }),
    acolhedores: acol([
      ['Israel', 21],
      ['Mateus', 19],
      ['Karolyne', 14],
      ['Keilane', 7],
      ['Cris', 2],
      ['API', 2],
      ['Andressa', 1],
    ]),
    procuracaoAssinada: {
      total: 3,
      leads: [
        { lead: 'PREV 1574 Rio de janeiro - RJ — Maria Aparecida', acolhedor: 'Israel' },
        { lead: 'Michela Corrêa de Ávila', acolhedor: 'Israel' },
      ],
    },
    documentosProtocolo: {
      total: 1,
      leads: [
        { lead: 'PREV 1409 Bonito - MS (ZONA RURAL)', acolhedor: 'Mateus' },
      ],
    },
    mudancas: {
      total: 9,
      noResponseTotal: 8,
      rows: [
        { from: 'Recepção', to: 'no_response', casos: 7 },
        { from: 'Aguardando Documentos', to: 'no_response', casos: 1 },
        { from: 'Recepção', to: 'Aguardando Documentos', casos: 1 },
      ],
    },
  },
};
