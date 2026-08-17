// Comparação de nomes de pessoa entre fontes que escrevem diferente: o e-mail
// do INSS traz o nome civil completo, o lead traz apelido, o contato traz o
// nome do cadastro e o grupo de WhatsApp traz o que a acolhedora digitou.
//
// Morava dentro do InssAdminProcessesTab. Saiu para cá quando a lista de
// protocolos da Visão Geral passou a precisar do mesmo casamento — duas cópias
// desta heurística divergiriam na primeira correção.

/** Antes de comparar, todos os nomes vestem o mesmo uniforme. */
export const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normalizeSearchText = (s?: string | null) =>
  stripAccents(String(s || ""))
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const tokenizeName = (s?: string | null): string[] => {
  if (!s) return [];
  return normalizeSearchText(s)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !["DOS", "DAS", "DEL", "DE", "DA", "DO", "E"].includes(t));
};

export const safeIlikeToken = (s: string) => s.replace(/[%,()]/g, " ").trim();

export const uniqueTokens = (tokens: string[]) => Array.from(new Set(tokens));

const accentAlternates: Record<string, string[]> = {
  A: ["Á", "À", "Â", "Ã"],
  E: ["É", "Ê"],
  I: ["Í"],
  O: ["Ó", "Ô", "Õ"],
  U: ["Ú"],
  C: ["Ç"],
};

/** O `ilike` do Postgres não ignora acento: buscamos todas as grafias. */
export const ilikeAccentVariants = (token: string) => {
  const base = safeIlikeToken(token).toUpperCase();
  const variants = new Set<string>([base]);
  for (let i = 0; i < base.length; i++) {
    for (const alt of accentAlternates[base[i]] || []) {
      variants.add(`${base.slice(0, i)}${alt}${base.slice(i + 1)}`);
    }
  }
  return Array.from(variants).filter(Boolean);
};

export const buildIlikeSearchTokens = (tokens: string[]) =>
  uniqueTokens(tokens.flatMap(ilikeAccentVariants));

export const tokenLooksMatched = (queryToken: string, candidateToken: string) => {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
  const minPrefix = Math.min(5, queryToken.length, candidateToken.length);
  if (minPrefix >= 4 && candidateToken.slice(0, minPrefix) === queryToken.slice(0, minPrefix)) return true;
  // Pequena tolerância para Sousa/Souza e outros nomes com 1 letra diferente.
  if (queryToken.length >= 5 && candidateToken.length >= 5 && Math.abs(queryToken.length - candidateToken.length) <= 1) {
    let diff = Math.abs(queryToken.length - candidateToken.length);
    const size = Math.min(queryToken.length, candidateToken.length);
    for (let i = 0; i < size; i++) if (queryToken[i] !== candidateToken[i]) diff++;
    return diff <= 1;
  }
  return false;
};

export const tokenMatchScore = (query: string, candidate?: string | null) => {
  const qTokens = uniqueTokens(tokenizeName(query));
  const cTokens = uniqueTokens(tokenizeName(candidate));
  if (!qTokens.length || !cTokens.length) return 0;
  return qTokens.filter((qt) => cTokens.some((ct) => tokenLooksMatched(qt, ct))).length;
};

// Compatibilidade de nomes (assimétrica): query = nome no processo do INSS
// (sempre completo), candidate = nome do lead/contato/grupo (pode ser curto).
// Regras:
//  - Se o processo tem 3+ partes (ex: "Francisco Cicero de Sousa"), exigir que
//    o candidato bata em pelo menos 2 tokens E pelo menos um deles seja
//    sobrenome (não só o primeiro nome). Assim "Francisco" sozinho NÃO casa
//    com "Francisco Cicero de Sousa", mas "Francisco Sousa" casa.
//  - Se ambos têm 3+ tokens, exigir margem de 1 (cobre Sousa/Souza), evitando
//    que "Maria Eduarda Medeiros Moraes" case com "Maria Eduarda Alves Maia".
//  - Se o processo tem 1-2 partes, basta que todos os tokens da query batam.
export const namesAreCompatible = (query: string, candidate?: string | null) => {
  const qTokens = uniqueTokens(tokenizeName(query));
  const cTokens = uniqueTokens(tokenizeName(candidate));
  if (!qTokens.length || !cTokens.length) return false;
  const matched = qTokens.filter((qt) => cTokens.some((ct) => tokenLooksMatched(qt, ct)));
  const score = matched.length;
  if (qTokens.length >= 3) {
    if (score < 2) return false;
    const firstName = qTokens[0];
    const hasSurnameMatch = matched.some((t) => t !== firstName);
    if (!hasSurnameMatch) return false;
    if (cTokens.length >= 3) {
      const shorter = Math.min(qTokens.length, cTokens.length);
      return score >= shorter - 1;
    }
    return true;
  }
  return score >= qTokens.length;
};

/** Busca digitada pela pessoa: com número no meio, um token batendo já serve. */
export const isLooseTokenMatch = (query: string, candidate?: string | null) => {
  const qTokens = uniqueTokens(tokenizeName(query));
  if (!qTokens.length) return false;
  if (qTokens.some((t) => /^\d+$/.test(t))) return tokenMatchScore(query, candidate) >= 1;
  return namesAreCompatible(query, candidate);
};
