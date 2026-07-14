// =============================================================================
// Detecta COMPROMISSOS acionáveis a partir das movimentações do Escavador:
//   - audiencia  (audiência designada/redesignada, com data e hora)
//   - pericia    (perícia médica/técnica designada, com data)
//   - prazo      (intimação/ciência com prazo — "no prazo de N dias")
//
// Puro/determinístico — sem Date.now()/random, sem I/O. Testável isolado.
// Espelha o estilo de escavadorMarcos.ts (mesmo padrão de hash e normalização).
//
// IMPORTANTE: precisão > recall. Estes viram TAREFAS reais de advogado, então
// só emitimos quando o sinal é forte (verbo de agendamento + data extraível,
// ou "prazo de N dias" explícito). Preferimos deixar passar a poluir a agenda.
// =============================================================================

import type { EscavadorMovimentacao } from './escavadorMarcos.ts';

export type CompromissoTipo = 'audiencia' | 'pericia' | 'prazo';

export interface CompromissoExtraido {
  tipo: CompromissoTipo;
  /** Data do evento (audiência/perícia) em ISO 'YYYY-MM-DD'. null quando não há. */
  data_evento: string | null;
  /** Hora do evento 'HH:MM' quando presente no texto. */
  hora_evento: string | null;
  /** Data da própria movimentação (publicação/intimação). */
  data_movimentacao: string | null;
  /** Para prazo: nº de dias extraído ("no prazo de 15 dias" → 15). */
  prazo_dias: number | null;
  /** Título curto e legível para a atividade. */
  titulo: string;
  /** Trecho do conteúdo (evidência). */
  descricao: string | null;
  escavador_movimentacao_id: string | null;
  /** Hash estável para dedupe idempotente entre re-syncs. */
  conteudo_hash: string;
}

function normalize(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function stableHash(input: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ (c + 1);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

function movText(mov: EscavadorMovimentacao): string {
  const cls = mov.classificacao_predita;
  return [mov.tipo, mov.titulo, mov.conteudo, mov.descricao, cls?.nome, cls?.descricao]
    .filter(Boolean)
    .join(' ');
}

function movDate(mov: EscavadorMovimentacao): string | null {
  const raw = mov.data || mov.data_hora || '';
  return raw ? String(raw).trim() : null;
}

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

/** Extrai a PRIMEIRA data no formato DD/MM/YYYY ou "DD de mês de YYYY". Retorna ISO ou null. */
function extractEventDate(textNorm: string): string | null {
  const dmy = textNorm.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ext = textNorm.match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (ext && MESES[ext[2]]) {
    const dd = ext[1].padStart(2, '0');
    return `${ext[3]}-${MESES[ext[2]]}-${dd}`;
  }
  return null;
}

/** Extrai hora HH:MM ("às 14:30", "as 09h", "14h30"). */
function extractEventTime(textNorm: string): string | null {
  const hm = textNorm.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (hm) return `${hm[1].padStart(2, '0')}:${hm[2]}`;
  const h = textNorm.match(/\bas\s+(\d{1,2})\s*h\b/) || textNorm.match(/\b(\d{1,2})\s*h(?!\d)/);
  if (h) return `${h[1].padStart(2, '0')}:00`;
  return null;
}

/** Extrai "no prazo de N dias" / "prazo de N (quinze) dias" / "em N dias". */
function extractPrazoDias(textNorm: string): number | null {
  const m = textNorm.match(/prazo\s+(?:comum\s+|sucessivo\s+)?de\s+(\d{1,3})\s*\(?[a-z\s]*\)?\s*dias/)
    || textNorm.match(/no\s+prazo\s+de\s+(\d{1,3})/)
    || textNorm.match(/\bem\s+(\d{1,3})\s+dias/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n <= 180 ? n : null;
}

// Cues de agendamento — evitam pegar menção passada ("ata de audiência realizada").
const AUDIENCIA_CUES = ['designad', 'redesignad', 'marcada', 'aprazad', 'realizar-se-a', 'ocorrer', 'intimad', 'convoca'];
const PERICIA_CUES = ['designad', 'agendad', 'marcada', 'nomead', 'comparecer', 'realizar'];
// Cues de que a intimação abre PRAZO (e não é mera ciência informativa).
const PRAZO_CUES = ['manifest', 'impugn', 'contestar', 'contestacao', 'recorr', 'recurso', 'cumprir', 'apresentar', 'ciencia', 'intimad'];

function hasAny(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}

/** Classifica UMA movimentação em compromisso (ou null se não for acionável). */
function classify(mov: EscavadorMovimentacao): CompromissoExtraido | null {
  const full = movText(mov);
  const t = normalize(full);
  if (!t.trim()) return null;

  const dataMov = movDate(mov);
  const eventDate = extractEventDate(t);
  const eventTime = extractEventTime(t);
  const snippet = (mov.conteudo || mov.titulo || mov.descricao || '').toString().replace(/\s+/g, ' ').trim().slice(0, 400) || null;
  const movId = mov.id != null ? String(mov.id) : null;

  const emit = (tipo: CompromissoTipo, titulo: string, prazoDias: number | null): CompromissoExtraido => ({
    tipo,
    data_evento: tipo === 'prazo' ? null : eventDate,
    hora_evento: tipo === 'prazo' ? null : eventTime,
    data_movimentacao: dataMov,
    prazo_dias: prazoDias,
    titulo,
    descricao: snippet,
    escavador_movimentacao_id: movId,
    conteudo_hash: stableHash(`${tipo}|${dataMov || ''}|${eventDate || ''}|${normalize(snippet || '').slice(0, 120)}`),
  });

  // PERÍCIA (antes de audiência: perícia médica é comum no previdenciário).
  if ((t.includes('pericia') || t.includes('perito') || t.includes('laudo pericial')) && hasAny(t, PERICIA_CUES)) {
    // Só aciona com data (perícia sem data marcada não vira compromisso).
    if (eventDate) return emit('pericia', 'Perícia designada', null);
  }

  // AUDIÊNCIA — exige cue de agendamento e data extraível.
  if (t.includes('audiencia') && hasAny(t, AUDIENCIA_CUES) && eventDate) {
    const tipoAud = t.includes('conciliac') ? 'de conciliação'
      : t.includes('instrucao') ? 'de instrução e julgamento'
      : t.includes('inaugural') || t.includes('inicial') ? 'inicial'
      : t.includes('una') ? 'una'
      : '';
    return emit('audiencia', `Audiência ${tipoAud}`.trim(), null);
  }

  // PRAZO — exige "prazo de N dias" OU intimação com cue de providência.
  const prazoDias = extractPrazoDias(t);
  if (prazoDias || (t.includes('intim') && hasAny(t, PRAZO_CUES))) {
    // Evita transformar toda "ciência de decisão" em prazo: exige prazo em dias
    // OU uma providência clara (manifestar/impugnar/recorrer/contestar/cumprir).
    const temProvidencia = hasAny(t, ['manifest', 'impugn', 'contestar', 'recorr', 'recurso', 'cumprir', 'apresentar']);
    if (prazoDias || temProvidencia) {
      const alvo = t.includes('sentenca') ? 'sentença'
        : t.includes('acordao') ? 'acórdão'
        : t.includes('despacho') ? 'despacho'
        : t.includes('decisao') ? 'decisão'
        : 'ato processual';
      const titulo = prazoDias ? `Prazo de ${prazoDias} dias` : `Prazo — providência sobre ${alvo}`;
      return emit('prazo', titulo, prazoDias);
    }
  }

  return null;
}

/**
 * Varre as movimentações e devolve os compromissos acionáveis (dedup por hash).
 * @param movimentacoes array cru do Escavador (v2)
 * @param opts.numeroCnj usado no hash pra estabilidade entre re-syncs
 * @param opts.desde só considera movimentações com data >= desde (ISO) — evita
 *        recriar compromissos antigos ao habilitar a feature num processo com histórico.
 * @param opts.incluirPassados mantém eventos cuja data já passou (uso: marcos/estações
 *        da linha do processo, onde o histórico importa; tarefas continuam só futuras).
 */
export function extractCompromissos(
  movimentacoes: EscavadorMovimentacao[],
  opts: { numeroCnj?: string; desde?: string; incluirPassados?: boolean } = {},
): CompromissoExtraido[] {
  if (!Array.isArray(movimentacoes)) return [];
  const numeroCnj = opts.numeroCnj || '';
  const desde = opts.desde || '';
  const seen = new Set<string>();
  const out: CompromissoExtraido[] = [];

  for (const mov of movimentacoes) {
    const c = classify(mov);
    if (!c) continue;
    if (desde && c.data_movimentacao && String(c.data_movimentacao).slice(0, 10) < desde.slice(0, 10)) continue;

    // Descarta eventos (audiência/perícia) cuja data já passou em relação à
    // movimentação — é registro histórico, não compromisso futuro.
    if (!opts.incluirPassados && c.tipo !== 'prazo' && c.data_evento && c.data_movimentacao) {
      if (c.data_evento.slice(0, 10) < String(c.data_movimentacao).slice(0, 10)) continue;
    }

    const hash = stableHash(`${numeroCnj}|${c.conteudo_hash}`);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ ...c, conteudo_hash: hash });
  }

  return out;
}
