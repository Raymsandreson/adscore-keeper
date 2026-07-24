// Extração de cidade/estado a partir do nome do contato.
//
// Contexto: acolhedores frequentemente salvam a localização dentro do próprio
// nome do contato, no formato ".../UF" no fim — ex: "Solange - Campos De Júlio/MT".
// O separador " - " sozinho NÃO é sinal de cidade (é usado em "Grupo -", "PREV 123 -",
// "Acolhedor -", etc). O único sinal confiável é o sufixo "/UF" no fim, validado
// contra os 27 estados; a cidade são as palavras antes dele, confirmadas casando
// com a lista de municípios do IBGE daquele estado.
//
// Bairro não é extraído: praticamente nunca aparece no nome.

export interface StateOption {
  id: number;
  sigla: string;
  nome: string;
}

export interface CityOption {
  id: number;
  nome: string;
}

/** minúsculas, sem acento, espaços colapsados. */
export function normalizeLoc(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DetectedState {
  sigla: string;
  nome: string;
  /** trecho do nome antes do separador+UF, onde a cidade costuma estar. */
  base: string;
}

/**
 * Detecta um "/UF" (ou "- UF", ", UF", " UF") no FIM do nome e valida contra os
 * estados conhecidos. Retorna null se não houver sufixo de UF válido.
 */
export function detectStateFromName(
  name: string,
  states: StateOption[],
): DetectedState | null {
  if (!name) return null;
  const m = name.match(/[/\-,\s]\s*([A-Za-z]{2})\s*$/);
  if (!m || m.index === undefined) return null;
  const uf = m[1].toUpperCase();
  const st = states.find((s) => s.sigla === uf);
  if (!st) return null;
  return { sigla: st.sigla, nome: st.nome, base: name.slice(0, m.index).trim() };
}

/**
 * Dado o trecho `base` (nome sem o sufixo de UF) e a lista de municípios do
 * estado, encontra o melhor município presente no texto. Prefere o município
 * colado ao fim (mais perto do "/UF") e o nome mais longo (evita casar "Porto"
 * quando o certo é "Porto dos Gaúchos"). Casamento com borda de palavra, sem
 * acento/caixa. Retorna o nome canônico do IBGE ou null.
 */
export function detectCityFromBase(
  base: string,
  cities: CityOption[],
): string | null {
  const nb = normalizeLoc(base);
  if (!nb) return null;
  let best: { nome: string; score: number } | null = null;

  for (const c of cities) {
    const nc = normalizeLoc(c.nome);
    if (nc.length < 3) continue; // ignora nomes curtíssimos (ruído)
    const idx = nb.indexOf(nc);
    if (idx === -1) continue;

    // exige borda de palavra antes e depois pra não casar no meio de outra palavra
    const before = idx === 0 ? ' ' : nb[idx - 1];
    const after = idx + nc.length >= nb.length ? ' ' : nb[idx + nc.length];
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;

    const endsAt = idx + nc.length;
    const suffixBonus = endsAt >= nb.length - 1 ? 1000 : 0; // colado ao "/UF"
    const score = suffixBonus + nc.length;
    if (!best || score > best.score) best = { nome: c.nome, score };
  }

  return best ? best.nome : null;
}
