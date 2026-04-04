/**
 * Auto-fill utilities: defaults, dates, city/state sync, predefined fields, CEP lookup.
 */

import {
  type TemplateFieldRef,
  normalizeFieldKey,
  hasFieldValue,
  upsertCollectedField,
} from "./field-utils.ts";
import type { ZapSignSettings } from "./zapsign-utils.ts";

// ============================================================
// DEFAULTS
// ============================================================

export function applyDefaults(fields: any[]) {
  for (const f of fields) {
    if (f.de && !f.de.startsWith("{{")) {
      f.de = `{{${f.de.replace(/\{\{|\}\}/g, "").trim()}}}`;
    }
    const key = (f.de || "").replace(/\{\{|\}\}/g, "").toUpperCase().trim();
    if (key.includes("EMAIL") && !f.para) f.para = "contato@prudencioadv.com";
    if (key.includes("WHATSAPP") && !f.para) f.para = "(86)99447-3226";
  }
}

// ============================================================
// PREDEFINED FIELDS
// ============================================================

function resolvePredefinedFieldValue(
  entry: { mode?: string; value?: string },
  context?: { phone?: string },
): string | null {
  switch (entry?.mode) {
    case "today":
      return new Date().toLocaleDateString("pt-BR");
    case "brazilian_nationality":
      return "Brasileiro(a)";
    case "client_phone": {
      const p = context?.phone || entry?.value || "";
      if (!p) return null;
      const digits = p.replace(/\D/g, "");
      if (digits.length === 13) return `(${digits.slice(2,4)}) ${digits.slice(4,9)}-${digits.slice(9)}`;
      if (digits.length === 12) return `(${digits.slice(2,4)}) ${digits.slice(4,8)}-${digits.slice(8)}`;
      return p;
    }
    case "fixed_value":
    default:
      return hasFieldValue(entry?.value) ? String(entry.value).trim() : null;
  }
}

export function applyConfiguredPredefinedFields(
  fields: any[],
  catalog: TemplateFieldRef[],
  settings: ZapSignSettings | null | undefined,
  context?: { phone?: string },
): Set<string> {
  const applied = new Set<string>();
  const entries = Array.isArray(settings?.predefined_fields)
    ? settings.predefined_fields
    : [];

  for (const entry of entries) {
    const fieldKey = normalizeFieldKey(entry?.field || "");
    if (!fieldKey) continue;

    const targetField = catalog.find((field) => field.normalized === fieldKey);
    if (!targetField) continue;

    const value = resolvePredefinedFieldValue(entry, context);
    if (!hasFieldValue(value)) continue;
    const safeValue = String(value).trim();
    if (!safeValue) continue;

    const existing = fields.find((field: any) =>
      normalizeFieldKey(field?.de || "") === targetField.normalized
    );

    if (existing && hasFieldValue(existing.para)) continue;

    upsertCollectedField(fields, targetField.variable, safeValue);
    applied.add(targetField.normalized);
  }

  return applied;
}

// ============================================================
// AUTO-FILL DATES
// ============================================================

export function autoFillDates(
  fields: any[],
  catalog: TemplateFieldRef[],
): Set<string> {
  const today = new Date().toLocaleDateString("pt-BR");
  const filled = new Set<string>();
  for (const t of catalog) {
    const k = t.normalized;
    const isDate = k.includes("DATA") &&
      (k.includes("ASSINATURA") || k.includes("PROCURACAO") ||
        k.includes("ATUAL") || k.includes("HOJE"));
    if (isDate) {
      const existing = fields.find((f: any) =>
        normalizeFieldKey(f.de || "") === normalizeFieldKey(t.variable)
      );
      if (!existing || !hasFieldValue(existing.para)) {
        upsertCollectedField(fields, t.variable, today);
      }
      filled.add(k);
    }
  }
  return filled;
}

// ============================================================
// AUTO-SYNC CITY/STATE (signing fields)
// ============================================================

export function autoSyncCityState(
  fields: any[],
  catalog: TemplateFieldRef[],
): Set<string> {
  const filled = new Set<string>();
  for (const t of catalog) {
    const k = t.normalized;
    const isSigningCity = (k.includes("CIDADE") || k.includes("LOCAL") ||
      k.includes("MUNICIPIO")) &&
      (k.includes("ASSINATURA") || k.includes("PROCURACAO") ||
        k.includes("OUTORGANTE"));
    const isSigningState = (k.includes("ESTADO") || k.includes("UF")) &&
      (k.includes("ASSINATURA") || k.includes("PROCURACAO") ||
        k.includes("OUTORGANTE"));

    if (isSigningCity) {
      const src = fields.find((f: any) => {
        const fk = normalizeFieldKey(f.de || "");
        return (fk.includes("CIDADE") || fk.includes("MUNICIPIO")) &&
          !fk.includes("ASSINATURA") && !fk.includes("PROCURACAO") &&
          !fk.includes("OUTORGANTE") && hasFieldValue(f.para);
      });
      if (src) {
        const existing = fields.find((f: any) =>
          normalizeFieldKey(f.de || "") === normalizeFieldKey(t.variable)
        );
        if (!existing || !hasFieldValue(existing.para)) {
          upsertCollectedField(fields, t.variable, src.para);
        }
        filled.add(k);
      }
    }
    if (isSigningState) {
      const src = fields.find((f: any) => {
        const fk = normalizeFieldKey(f.de || "");
        return (fk.includes("ESTADO") || fk === "UF") &&
          !fk.includes("ASSINATURA") && !fk.includes("PROCURACAO") &&
          !fk.includes("OUTORGANTE") && hasFieldValue(f.para);
      });
      if (src) {
        const existing = fields.find((f: any) =>
          normalizeFieldKey(f.de || "") === normalizeFieldKey(t.variable)
        );
        if (!existing || !hasFieldValue(existing.para)) {
          upsertCollectedField(fields, t.variable, src.para);
        }
        filled.add(k);
      }
    }
  }
  return filled;
}

// ============================================================
// CEP LOOKUP & AUTO-FILL
// ============================================================

export async function lookupCEP(cep: string) {
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.erro ? null : data;
  } catch {
    return null;
  }
}

export async function reverseLookupCEP(
  state: string,
  city: string,
  street: string,
) {
  try {
    const res = await fetch(
      `https://viacep.com.br/ws/${encodeURIComponent(state)}/${
        encodeURIComponent(city)
      }/${encodeURIComponent(street)}/json/`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function extractCEPFromMessage(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}${match[2]}` : null;
}

export async function autoFillFromCEP(
  currentFields: any[],
  catalog: TemplateFieldRef[],
) {
  const cepField = currentFields.find((f) =>
    normalizeFieldKey(f.de || "").includes("CEP") && hasFieldValue(f.para)
  );
  if (!cepField) return;

  const cepData = await lookupCEP(cepField.para);
  if (!cepData) return;

  const mappings = [
    { patterns: ["ENDERECOCOMPLETO"], value: cepData.logradouro },
    { patterns: ["RUA", "LOGRADOURO"], value: cepData.logradouro },
    { patterns: ["BAIRRO"], value: cepData.bairro },
    { patterns: ["CIDADE", "MUNICIPIO"], value: cepData.localidade },
    { patterns: ["ESTADO", "UF"], value: cepData.uf },
  ];
  for (const m of mappings) {
    if (!m.value) continue;
    for (const t of catalog) {
      const k = t.normalized;
      if (
        m.patterns.some((p) => k.includes(p)) && !k.includes("ASSINATURA") &&
        !k.includes("OUTORGANTE")
      ) {
        const existing = currentFields.find((f) =>
          normalizeFieldKey(f.de || "") === t.normalized
        );
        if (!existing || !hasFieldValue(existing.para)) {
          upsertCollectedField(currentFields, t.variable, m.value);
        }
      }
    }
  }
  autoSyncCityState(currentFields, catalog);
}
