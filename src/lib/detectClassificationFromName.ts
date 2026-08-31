// Relacionamento escondido no nome do contato.
//
// Contexto: quem cadastra escreve o papel da pessoa dentro do próprio nome —
// "Alex motorista parceiro Ibirarema/SP", "Yuban cliente parceiro Manaus/AM".
// O campo "Relacionamento Conosco" fica em "Sem status" mesmo com a resposta
// escrita na tela. Aqui a gente lê o que já está escrito: é instantâneo, de
// graça e não erra. O que o nome não entrega vai para a IA
// (suggest-contact-classification).
//
// Regra de ouro: só entra padrão que NÃO tem como significar outra coisa.
// "advogado" solto, "ponte", "adverso" ficam de fora de propósito — nome de
// cidade ("Ponte Nova") e sobrenome viram falso positivo. Dúvida é da IA.

/** minúsculas, sem acento, espaços colapsados. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ClassificationHit {
  /** slug do status (contact_classifications.name). */
  slug: string;
  /** trecho do nome que denunciou o papel — vira o "porquê" na tela. */
  matched: string;
}

// Ordem importa: o específico vem antes do genérico, senão "ex-cliente" cai em
// "cliente" e o contato perdido vira cliente ativo.
const RULES: { slug: string; pattern: RegExp }[] = [
  { slug: 'ex_cliente', pattern: /\bex[\s-]?client[ea]s?\b/ },
  { slug: 'non_client', pattern: /\bnao[\s-]?client[ea]s?\b/ },
  { slug: 'advogado_adverso', pattern: /\badv(?:\.|ogad[oa])?\s+advers[oa]\b/ },
  { slug: 'advogado_interno', pattern: /\badv(?:\.|ogad[oa])?\s+intern[oa]\b/ },
  { slug: 'advogado_externo', pattern: /\badv(?:\.|ogad[oa])?\s+extern[oa]\b/ },
  { slug: 'parte_contraria', pattern: /\bparte\s+contrari[ao]\b/ },
  { slug: 'prestador_servico', pattern: /\bprestador(?:a|es)?\s+de\s+servicos?\b/ },
  { slug: 'equipe_interna', pattern: /\bequipe\s+intern[oa]\b/ },
  { slug: 'client', pattern: /\bclient[ea]s?\b/ },
  { slug: 'partner', pattern: /\bparceir[oa]s?\b/ },
  { slug: 'supplier', pattern: /\bfornecedor(?:a|es|as)?\b/ },
  { slug: 'prospect', pattern: /\bprospect(?:o|os|s)?\b/ },
];

/**
 * Lê o relacionamento escrito no nome. `available` são os slugs que existem no
 * banco daquele workspace — status apagado ou renomeado não volta pela porta
 * dos fundos. Sem `available`, aceita todos os padrões conhecidos.
 *
 * Devolve todos os papéis encontrados: um contato pode ser cliente E parceiro,
 * e o campo aceita mais de um.
 */
export function detectClassificationFromName(
  name: string,
  available?: string[],
): ClassificationHit[] {
  if (!name) return [];
  const n = normalize(name);
  if (!n) return [];
  const allowed = available && available.length > 0 ? new Set(available) : null;

  const hits: ClassificationHit[] = [];
  // Trechos já consumidos: "ex-cliente" não pode virar também "cliente".
  const consumed: [number, number][] = [];

  for (const rule of RULES) {
    const m = n.match(rule.pattern);
    if (!m || m.index === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (consumed.some(([s, e]) => start < e && end > s)) continue;
    consumed.push([start, end]);
    if (allowed && !allowed.has(rule.slug)) continue;
    if (hits.some((h) => h.slug === rule.slug)) continue;
    hits.push({ slug: rule.slug, matched: m[0] });
  }

  return hits;
}
