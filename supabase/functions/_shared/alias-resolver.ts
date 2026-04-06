/**
 * Deterministic field resolution via alias mapping table.
 * Replaces AI-dependent field matching with Make.com-style lookup.
 * 
 * Flow: User message → keyword detection → alias table lookup → variable name
 * AI is only used for INTENT understanding, never for field mapping.
 */

import { normalizeFieldKey, type TemplateFieldRef } from "./field-utils.ts";

// ============================================================
// TYPES
// ============================================================

export interface FieldAlias {
  id: string;
  variable_name: string;
  aliases: string[];
  field_type: string;
  extraction_pattern: string | null;
  validation_pattern: string | null;
  validation_message: string | null;
  agent_id: string | null;
}

export interface ResolvedField {
  variable: string;
  value: string;
  field_type: string;
  validation_error?: string;
}

// ============================================================
// LOAD ALIASES
// ============================================================

/**
 * Load field aliases from DB — agent-specific first, then global fallback.
 * Merges both: agent-specific overrides global for the same variable.
 */
export async function loadFieldAliases(
  supabase: any,
  agentId?: string | null,
): Promise<FieldAlias[]> {
  const { data, error } = await supabase
    .from("field_variable_aliases")
    .select("*")
    .or(agentId ? `agent_id.eq.${agentId},agent_id.is.null` : "agent_id.is.null")
    .order("created_at", { ascending: true });

  if (error || !data) {
    console.error("Failed to load field aliases:", error);
    return [];
  }

  // Agent-specific overrides global for same variable
  const byVariable = new Map<string, FieldAlias>();
  for (const alias of data as FieldAlias[]) {
    const key = normalizeFieldKey(alias.variable_name);
    const existing = byVariable.get(key);
    // Agent-specific takes priority over global
    if (!existing || (alias.agent_id && !existing.agent_id)) {
      byVariable.set(key, alias);
    }
  }

  return Array.from(byVariable.values());
}

// ============================================================
// RESOLVE FIELD BY KEYWORD (deterministic)
// ============================================================

/**
 * Given a keyword from the user message (e.g., "nome", "cpf"),
 * find the matching template variable deterministically.
 */
export function resolveFieldByKeyword(
  keyword: string,
  aliases: FieldAlias[],
  catalog: TemplateFieldRef[],
): FieldAlias | null {
  const lower = keyword.toLowerCase().trim();
  const normalized = normalizeFieldKey(keyword);

  // 1. Exact alias match
  for (const alias of aliases) {
    if (alias.aliases.some(a => a.toLowerCase() === lower)) {
      // Verify this variable exists in the template catalog
      const inCatalog = catalog.some(c =>
        normalizeFieldKey(c.variable) === normalizeFieldKey(alias.variable_name)
      );
      if (inCatalog) return alias;
    }
  }

  // 2. Partial alias match (keyword contains alias or vice versa)
  for (const alias of aliases) {
    if (alias.aliases.some(a => lower.includes(a.toLowerCase()) || a.toLowerCase().includes(lower))) {
      const inCatalog = catalog.some(c =>
        normalizeFieldKey(c.variable) === normalizeFieldKey(alias.variable_name)
      );
      if (inCatalog) return alias;
    }
  }

  // 3. Normalized key match against variable names
  for (const alias of aliases) {
    if (normalizeFieldKey(alias.variable_name) === normalized) {
      return alias;
    }
  }

  return null;
}

// ============================================================
// EXTRACT VALUE USING PATTERN
// ============================================================

/**
 * If the alias has an extraction_pattern, try to extract the value
 * from the raw message text.
 */
export function extractValueByPattern(
  message: string,
  alias: FieldAlias,
): string | null {
  if (!alias.extraction_pattern) return null;
  try {
    const regex = new RegExp(alias.extraction_pattern, "i");
    const match = message.match(regex);
    return match ? (match[1] || match[0]).trim() : null;
  } catch {
    return null;
  }
}

// ============================================================
// VALIDATE VALUE
// ============================================================

/**
 * Validate a value against the alias's validation pattern.
 * Returns null if valid, error message if invalid.
 */
export function validateFieldValue(
  value: string,
  alias: FieldAlias,
): string | null {
  if (!alias.validation_pattern) return null;
  try {
    const regex = new RegExp(alias.validation_pattern, "i");
    if (!regex.test(value.trim())) {
      return alias.validation_message || `Valor inválido para ${alias.variable_name}`;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// CBO PROFESSION NORMALIZATION
// ============================================================

/**
 * Match a free-text profession to the closest CBO entry.
 * Uses normalized substring matching for robustness.
 */
export async function normalizeProfessionToCBO(
  supabase: any,
  rawProfession: string,
): Promise<{ title: string; cbo_code: string } | null> {
  if (!rawProfession || rawProfession.trim().length < 2) return null;

  const normalized = rawProfession.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Load all CBO professions (200 rows — small enough to load in memory)
  const { data: professions, error } = await supabase
    .from("cbo_professions")
    .select("cbo_code, title, family_title");

  if (error || !professions?.length) return null;

  // Score each profession
  let bestMatch: { title: string; cbo_code: string; score: number } | null = null;

  for (const p of professions) {
    const titleNorm = (p.title || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const familyNorm = (p.family_title || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    let score = 0;

    // Exact match
    if (titleNorm === normalized) { score = 100; }
    // Title contains input
    else if (titleNorm.includes(normalized)) { score = 80; }
    // Input contains title
    else if (normalized.includes(titleNorm)) { score = 70; }
    // Family match
    else if (familyNorm.includes(normalized) || normalized.includes(familyNorm)) { score = 50; }
    // Word overlap
    else {
      const inputWords = normalized.split(/\s+/);
      const titleWords = titleNorm.split(/\s+/);
      const overlap = inputWords.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw))).length;
      if (overlap > 0) score = overlap * 20;
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { title: p.title, cbo_code: p.cbo_code, score };
    }
  }

  if (bestMatch && bestMatch.score >= 50) {
    console.log(`CBO match: "${rawProfession}" → "${bestMatch.title}" (${bestMatch.cbo_code}) score=${bestMatch.score}`);
    return { title: bestMatch.title, cbo_code: bestMatch.cbo_code };
  }

  console.log(`CBO no match: "${rawProfession}" (best score: ${bestMatch?.score || 0})`);
  return null;
}

// ============================================================
// RESOLVE INCOMING FIELD (deterministic replacement for normalizeIncomingField)
// ============================================================

/**
 * Given an AI-extracted field {de, para}, resolve it deterministically:
 * 1. Try alias table for the field name (de)
 * 2. Validate the value if pattern exists
 * 3. Fall back to catalog matching if no alias found
 */
export function resolveIncomingFieldWithAliases(
  field: { de?: string; para?: string; field_name?: string },
  aliases: FieldAlias[],
  catalog: TemplateFieldRef[],
): ResolvedField | null {
  const deRaw = (field?.de || field?.field_name || "").toString().trim();
  const paraRaw = (field?.para || "").toString().trim();
  if (!deRaw || !paraRaw) return null;

  // Try to resolve the field name via alias table
  const alias = resolveFieldByKeyword(deRaw, aliases, catalog);

  if (alias) {
    // Strip {{ }} from variable name for storage
    const variable = alias.variable_name;
    const validationError = validateFieldValue(paraRaw, alias);

    return {
      variable,
      value: paraRaw,
      field_type: alias.field_type,
      validation_error: validationError || undefined,
    };
  }

  // Fallback: try the value as key (AI sometimes swaps de/para)
  const aliasFromValue = resolveFieldByKeyword(paraRaw, aliases, catalog);
  if (aliasFromValue) {
    const validationError = validateFieldValue(deRaw, aliasFromValue);
    return {
      variable: aliasFromValue.variable_name,
      value: deRaw,
      field_type: aliasFromValue.field_type,
      validation_error: validationError || undefined,
    };
  }

  // Last resort: direct catalog match (legacy behavior)
  const normDe = normalizeFieldKey(deRaw);
  for (const c of catalog) {
    const normVar = normalizeFieldKey(c.variable);
    if (normVar === normDe || normVar.includes(normDe) || normDe.includes(normVar)) {
      return { variable: c.variable, value: paraRaw, field_type: "text" };
    }
  }

  // Try para as variable against catalog
  const normPara = normalizeFieldKey(paraRaw);
  for (const c of catalog) {
    const normVar = normalizeFieldKey(c.variable);
    if (normVar === normPara || normVar.includes(normPara) || normPara.includes(normVar)) {
      return { variable: c.variable, value: deRaw, field_type: "text" };
    }
  }

  console.log(`ALIAS RESOLVER: No match for field "${deRaw}" = "${paraRaw}"`);
  return null;
}

// ============================================================
// AUTO-SEED ALIASES FROM TEMPLATE CATALOG
// ============================================================

/**
 * When a new template is loaded, auto-generate alias entries
 * for fields that don't have aliases yet.
 * Called during session creation.
 */
export async function autoSeedAliasesFromCatalog(
  supabase: any,
  catalog: TemplateFieldRef[],
  agentId?: string | null,
): Promise<void> {
  if (!catalog.length) return;

  // Load existing aliases
  const existing = await loadFieldAliases(supabase, agentId);
  const existingVars = new Set(existing.map(a => normalizeFieldKey(a.variable_name)));

  // Find catalog fields without aliases
  const toSeed: { variable_name: string; aliases: string[]; field_type: string }[] = [];

  for (const field of catalog) {
    if (existingVars.has(normalizeFieldKey(field.variable))) continue;

    // Generate aliases from label
    const label = field.label.toLowerCase().trim();
    const variable = field.variable;
    const aliases = [label];

    // Add common variations
    const words = label.split(/\s+/);
    if (words.length > 1) {
      aliases.push(words[0]); // First word as alias
    }

    // Detect field type from variable name
    const normVar = normalizeFieldKey(variable);
    let fieldType = "text";
    if (normVar.includes("CPF")) fieldType = "cpf";
    else if (normVar.includes("EMAIL")) fieldType = "email";
    else if (normVar.includes("CEP")) fieldType = "cep";
    else if (normVar.includes("TELEFONE") || normVar.includes("CELULAR") || normVar.includes("WHATSAPP")) fieldType = "phone";
    else if (normVar.includes("DATA") || normVar.includes("NASCIMENTO")) fieldType = "date";
    else if (normVar.includes("RG") || normVar.includes("IDENTIDADE")) fieldType = "rg";

    toSeed.push({ variable_name: variable, aliases, field_type: fieldType });
  }

  if (toSeed.length === 0) return;

  const rows = toSeed.map(s => ({
    variable_name: s.variable_name,
    aliases: s.aliases,
    field_type: s.field_type,
    is_auto_generated: true,
    agent_id: agentId || null,
  }));

  const { error } = await supabase.from("field_variable_aliases").upsert(rows, {
    onConflict: "variable_name",
    ignoreDuplicates: true,
  });

  if (error) {
    console.warn("Auto-seed aliases warning:", error.message);
  } else {
    console.log(`Auto-seeded ${rows.length} field aliases from template catalog`);
  }
}
