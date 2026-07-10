// =============================================================================
// Classifica movimentações do Escavador em CATEGORIAS para o feed do sino
// (process_updates): decisão de mérito, audiência, perícia, prazo, despacho e
// movimentação simples. Diferente dos compromissos (precisão > recall, viram
// tarefa), aqui TODA movimentação entra no feed — a categoria só define o
// destaque visual. Puro/determinístico, mesmo padrão dos outros _shared.
// =============================================================================

import type { EscavadorMovimentacao } from './escavadorMarcos.ts';

export type UpdateCategoria =
  | 'decisao_merito'
  | 'audiencia'
  | 'pericia'
  | 'prazo'
  | 'despacho'
  | 'movimentacao';

export interface UpdateClassificado {
  categoria: UpdateCategoria;
  titulo: string;
  descricao: string | null;
  data_movimentacao: string | null;
  escavador_movimentacao_id: string | null;
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

const MERITO_KW = [
  'sentenca', 'julgo procedente', 'julgo improcedente', 'julgo parcialmente procedente',
  'acordao', 'transito em julgado', 'transitou em julgado',
  'julgamento de merito', 'resolucao de merito', 'homologo o acordo', 'homologacao de acordo',
];
const AUDIENCIA_KW = ['audiencia'];
const PERICIA_KW = ['pericia', 'perito', 'laudo pericial'];
const PRAZO_KW = ['prazo de', 'no prazo', 'intimad', 'intimacao'];
const DESPACHO_KW = ['despacho', 'mero expediente', 'decisao interlocutoria', 'conclusos'];

const CATEGORIA_TITULO: Record<UpdateCategoria, string> = {
  decisao_merito: 'Decisão de mérito',
  audiencia: 'Audiência',
  pericia: 'Perícia',
  prazo: 'Prazo / intimação',
  despacho: 'Despacho',
  movimentacao: 'Movimentação',
};

function hasAny(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}

/** Classifica UMA movimentação. Ordem importa: mérito > audiência > perícia > prazo > despacho. */
export function classifyUpdate(mov: EscavadorMovimentacao): UpdateClassificado {
  const cls = mov.classificacao_predita;
  const full = [mov.tipo, mov.titulo, mov.conteudo, mov.descricao, cls?.nome, cls?.descricao]
    .filter(Boolean)
    .join(' ');
  const t = normalize(full);

  let categoria: UpdateCategoria = 'movimentacao';
  if (hasAny(t, MERITO_KW)) categoria = 'decisao_merito';
  else if (hasAny(t, AUDIENCIA_KW)) categoria = 'audiencia';
  else if (hasAny(t, PERICIA_KW)) categoria = 'pericia';
  else if (hasAny(t, PRAZO_KW)) categoria = 'prazo';
  else if (hasAny(t, DESPACHO_KW)) categoria = 'despacho';

  const raw = (mov.data || mov.data_hora || '').toString().trim();
  const dataMov = raw ? raw.slice(0, 10) : null;
  const snippet = (mov.conteudo || mov.titulo || mov.descricao || '')
    .toString().replace(/\s+/g, ' ').trim().slice(0, 300) || null;

  return {
    categoria,
    titulo: CATEGORIA_TITULO[categoria],
    descricao: snippet,
    data_movimentacao: dataMov,
    escavador_movimentacao_id: mov.id != null ? String(mov.id) : null,
    conteudo_hash: stableHash(`${categoria}|${dataMov || ''}|${normalize(snippet || '').slice(0, 160)}`),
  };
}

/**
 * Classifica todas as movimentações (dedupe por hash dentro do lote).
 * @param opts.desde só considera movimentações com data >= desde (ISO).
 */
export function classifyUpdates(
  movimentacoes: EscavadorMovimentacao[],
  opts: { numeroCnj?: string; desde?: string } = {},
): UpdateClassificado[] {
  if (!Array.isArray(movimentacoes)) return [];
  const numeroCnj = opts.numeroCnj || '';
  const desde = opts.desde || '';
  const seen = new Set<string>();
  const out: UpdateClassificado[] = [];

  for (const mov of movimentacoes) {
    const u = classifyUpdate(mov);
    if (desde && u.data_movimentacao && u.data_movimentacao < desde.slice(0, 10)) continue;
    if (!u.descricao && !u.data_movimentacao) continue; // sem conteúdo nem data, não é feed útil
    const hash = stableHash(`${numeroCnj}|${u.conteudo_hash}`);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ ...u, conteudo_hash: hash });
  }

  return out;
}
