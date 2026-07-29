// Template de nome do PROCESSO — configurado por POP (kanban_boards.settings.process_name_template).
// Cada POP define como o título dos processos criados sob ele deve ser montado, combinando
// campos do processo (nº, tipo, polos, classe, tribunal) com dados do cliente/caso.
//
// Análoga à lógica de nome do LEAD/CASO/GRUPO (board_group_settings.lead_fields, ver
// railway-server/src/functions/regenerate-lead-name.ts), mas separada de propósito: o nome do
// lead/caso/grupo pertence ao FUNIL; o título do processo pertence ao POP. Uma fonte por entidade.

export interface ProcessNameToken {
  key: string;
  label: string;
  hint?: string;
}

// Tokens disponíveis no editor do POP. `key` é estável (entra no template como `{key}`);
// `label` é o texto amigável do chip. Ordem = ordem de exibição dos chips.
export const PROCESS_NAME_TOKENS: ProcessNameToken[] = [
  { key: 'process_number', label: 'Nº do processo', hint: 'CNJ / nº administrativo' },
  { key: 'process_type', label: 'Tipo', hint: 'Judicial ou Administrativo' },
  { key: 'client_name', label: 'Cliente', hint: 'Nome do cliente (caso/lead)' },
  { key: 'victim_name', label: 'Vítima' },
  { key: 'city_state', label: 'Cidade/UF' },
  { key: 'polo_ativo', label: 'Polo ativo' },
  { key: 'polo_passivo', label: 'Polo passivo' },
  { key: 'classe', label: 'Classe' },
  { key: 'assunto', label: 'Assunto' },
  { key: 'tribunal', label: 'Tribunal' },
  { key: 'workflow_name', label: 'Nome do POP' },
];

export type ProcessNameContext = Record<string, string | number | null | undefined>;

// Substitui `{token}` pelos valores do contexto e limpa separadores órfãos deixados
// por tokens vazios (ex.: "Cliente — ( )" vira "Cliente"). Mantém texto literal fora das chaves.
export function renderProcessTitle(template: string, ctx: ProcessNameContext): string {
  if (!template || !template.trim()) return '';

  let out = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = ctx[key];
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    return s;
  });

  // Remove parênteses/colchetes que sobraram vazios após um token ausente.
  out = out.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
  // Colapsa separadores consecutivos (ex.: "—  —", "/ /") deixados por tokens vazios.
  out = out.replace(/\s*([-–—·/|])\s*(?=[-–—·/|])/g, ' ');
  // Remove separadores soltos nas pontas.
  out = out.replace(/^[\s\-–—·/|]+/, '').replace(/[\s\-–—·/|]+$/, '');
  // Colapsa espaços múltiplos.
  out = out.replace(/\s{2,}/g, ' ').trim();

  return out;
}

// Rótulo amigável do tipo de processo para uso no token {process_type}.
export function processTypeLabel(type?: string | null): string {
  if (type === 'judicial') return 'Judicial';
  if (type === 'administrativo') return 'Administrativo';
  return type ? String(type) : '';
}

// Monta o token {city_state} a partir de city/state (mesma convenção do nome do lead).
export function cityStateToken(city?: string | null, state?: string | null): string {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (c && s) return `${c}/${s}`;
  return c || s || '';
}

// Preview com dados fictícios pra mostrar o resultado no editor do POP.
export const PROCESS_NAME_PREVIEW_CONTEXT: ProcessNameContext = {
  process_number: '0000657-98.2025.5.11.0012',
  process_type: 'Judicial',
  client_name: 'Franciane Gonçalves Freitas',
  victim_name: 'Franciane Gonçalves Freitas',
  city_state: 'Manaus/AM',
  polo_ativo: 'Franciane Gonçalves Freitas',
  polo_passivo: 'Município de Manaus',
  classe: 'ATOrd',
  assunto: 'Acidente de Trabalho',
  tribunal: 'TRT-11',
  workflow_name: 'Trabalhistas judicial',
};
