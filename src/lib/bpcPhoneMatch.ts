// Helpers de matching de telefone entre planilha BPC e tabela `leads`.
// A planilha grava o telefone como o Meta entrega (com/sem 55, com/sem 9 extra),
// e a tabela `leads` também varia. Pra não perder match por causa de prefixo,
// usamos os últimos 8 dígitos como chave canônica (DDD-menos + número).

/** Extrai só dígitos. Aceita null/undefined/non-string sem quebrar. */
export function digitsOnly(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\D/g, "");
}

/** Chave canônica: últimos 8 dígitos. "" se telefone for inválido (<8 dígitos). */
export function phoneKey(raw: unknown): string {
  const d = digitsOnly(raw);
  if (d.length < 8) return "";
  return d.slice(-8);
}

export interface BpcLeadLike {
  operator?: string | null;
  phone_normalized?: string | null;
  phone_raw?: string | null;
}

export interface BuildFilterOpts {
  /** Nomes selecionados. Vazio = não filtrar. "__none__" = leads sem operator. */
  selected: string[];
  leads: BpcLeadLike[];
}

export interface BpcFilterResult {
  /** null = sem filtro ativo (passa tudo). Set vazio = filtro ativo mas zero matches. */
  phoneKeys: Set<string> | null;
  /** Quantos leads da planilha bateram com o filtro (antes do cruzamento). */
  matchedLeadCount: number;
  /** Quantos telefones únicos válidos foram extraídos. */
  validPhoneCount: number;
  /** Quantos leads casaram mas não tinham telefone utilizável. */
  droppedNoPhone: number;
}

export function buildBpcAcolhedorFilter({ selected, leads }: BuildFilterOpts): BpcFilterResult {
  if (!selected || selected.length === 0) {
    return { phoneKeys: null, matchedLeadCount: 0, validPhoneCount: 0, droppedNoPhone: 0 };
  }

  const namesLower = new Set(
    selected
      .filter((s) => typeof s === "string" && s !== "__none__")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const includeNone = selected.includes("__none__");

  const keys = new Set<string>();
  let matchedLeadCount = 0;
  let droppedNoPhone = 0;

  for (const l of leads || []) {
    const op = (l?.operator ?? "").toString().trim();
    const opLower = op.toLowerCase();
    const matches = op ? namesLower.has(opLower) : includeNone;
    if (!matches) continue;
    matchedLeadCount++;
    const key = phoneKey(l?.phone_normalized) || phoneKey(l?.phone_raw);
    if (!key) {
      droppedNoPhone++;
      continue;
    }
    keys.add(key);
  }

  return {
    phoneKeys: keys,
    matchedLeadCount,
    validPhoneCount: keys.size,
    droppedNoPhone,
  };
}

/** Verifica se um lead da tabela `leads` casa com o filtro. */
export function leadMatchesFilter(
  leadPhone: unknown,
  filter: Pick<BpcFilterResult, "phoneKeys">,
): boolean {
  if (!filter.phoneKeys) return true; // sem filtro
  const key = phoneKey(leadPhone);
  if (!key) return false;
  return filter.phoneKeys.has(key);
}
