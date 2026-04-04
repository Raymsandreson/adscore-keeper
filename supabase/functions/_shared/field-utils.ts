/**
 * Field normalization, catalog building, resolution and protection utilities.
 * Core primitives used across all WJIA agent operations.
 */

// ============================================================
// TYPES
// ============================================================

export type TemplateFieldRef = {
  variable: string;
  label: string;
  normalized: string;
};

// ============================================================
// NORMALIZATION
// ============================================================

export const normalizeFieldKey = (v: string): string =>
  (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(
    /\{\{|\}\}/g,
    "",
  ).replace(/[^A-Za-z0-9]+/g, "").toUpperCase().trim();

export const hasFieldValue = (v: any): boolean =>
  v !== null && v !== undefined && v.toString().trim().length > 0;

// ============================================================
// CATALOG
// ============================================================

export function buildTemplateFieldCatalog(session: any): TemplateFieldRef[] {
  const required = Array.isArray(session?.required_fields)
    ? session.required_fields
    : [];
  const fromRequired = required
    .filter((f: any) => f && (f.required ?? true))
    .map((f: any) => {
      const variable = (f.variable || "").toString().trim();
      const label = (f.label || variable || "").toString().trim();
      return {
        variable: variable || label,
        label,
        normalized: normalizeFieldKey(variable || label),
      };
    })
    .filter((f: TemplateFieldRef) => f.variable && f.normalized);
  if (fromRequired.length > 0) return fromRequired;

  const missing = Array.isArray(session?.missing_fields)
    ? session.missing_fields
    : [];
  return missing
    .map((f: any) => {
      const variable = (f.field_name || f.friendly_name || "").toString().trim();
      const label = (f.friendly_name || f.field_name || variable).toString().trim();
      return {
        variable,
        label,
        normalized: normalizeFieldKey(variable || label),
      };
    })
    .filter((f: TemplateFieldRef) => f.variable && f.normalized);
}

// ============================================================
// FIELD LABEL & RESOLUTION
// ============================================================

export function getFieldLabel(field: any, catalog: TemplateFieldRef[]): string {
  const rawDe = (field?.de || field?.field_name || "").toString().trim();
  const normKey = normalizeFieldKey(rawDe);
  const match = catalog.find((c) =>
    c.normalized === normKey || normalizeFieldKey(c.variable) === normKey
  );
  return match?.label || rawDe.replace(/\{\{|\}\}/g, "").trim();
}

export function resolveTemplateVariable(
  field: any,
  catalog: TemplateFieldRef[],
): string | null {
  const candidates = [field?.field_name, field?.de, field?.friendly_name]
    .map((v: any) => (v || "").toString().trim()).filter(Boolean);
  for (const c of candidates) {
    const norm = normalizeFieldKey(c);
    if (!norm) continue;
    const exact = catalog.find((f) => f.normalized === norm);
    if (exact) return exact.variable;
    const partial = catalog.find((f) =>
      f.normalized.includes(norm) || norm.includes(f.normalized)
    );
    if (partial) return partial.variable;
  }
  return null;
}

// ============================================================
// FIELD CRUD
// ============================================================

export function upsertCollectedField(
  fields: any[],
  variable: string,
  value: string,
) {
  const normVar = normalizeFieldKey(variable);
  const idx = fields.findIndex((f: any) =>
    normalizeFieldKey(f.de || "") === normVar
  );
  if (idx >= 0) {
    fields[idx].para = value;
  } else {
    fields.push({ de: variable, para: value });
  }
}

export function computeMissingFields(
  catalog: TemplateFieldRef[],
  fields: any[],
): { field_name: string; friendly_name: string }[] {
  const isOptional = (k: string) =>
    k.includes("EMAIL") || k.includes("WHATSAPP");
  return catalog
    .filter((req) => {
      if (isOptional(req.normalized)) return false;
      return !fields.find((f: any) =>
        normalizeFieldKey(f?.de || "") === req.normalized &&
        hasFieldValue(f?.para)
      );
    })
    .map((f) => ({
      field_name: f.variable,
      friendly_name: f.label || f.variable,
    }));
}

export function normalizeIncomingField(
  field: any,
  catalog: TemplateFieldRef[],
): { variable: string; value: string } | null {
  const deRaw = (field?.de || field?.field_name || "").toString().trim();
  const paraRaw = (field?.para || "").toString().trim();
  if (!deRaw || !paraRaw) return null;

  const deLooksLike = deRaw.includes("{{") || catalog.some((c) => {
    const n = normalizeFieldKey(deRaw);
    return c.normalized === n || c.normalized.includes(n) ||
      n.includes(c.normalized);
  });
  const paraLooksLike = paraRaw.includes("{{") || catalog.some((c) => {
    const n = normalizeFieldKey(paraRaw);
    return c.normalized === n || c.normalized.includes(n) ||
      n.includes(c.normalized);
  });

  let varCandidate = deRaw, valCandidate = paraRaw;
  if (!deLooksLike && paraLooksLike) {
    varCandidate = paraRaw;
    valCandidate = deRaw;
  }

  const resolved = resolveTemplateVariable(
    { de: varCandidate, field_name: varCandidate },
    catalog,
  ) || varCandidate;
  return resolved && hasFieldValue(valCandidate)
    ? { variable: resolved, value: valCandidate }
    : null;
}

// ============================================================
// NAME SYNCHRONIZATION
// ============================================================

export function syncNameFields(fields: any[]) {
  const nameKeys = ["NOMECOMPLETO", "NOMEOUTORGANTE", "NOME"];
  const nameFields = fields.filter((f) =>
    nameKeys.includes(normalizeFieldKey(f.de || ""))
  );
  if (nameFields.length >= 2) {
    const filled = nameFields.find((f) => hasFieldValue(f.para));
    if (filled) {
      nameFields.forEach((f) => {
        if (!hasFieldValue(f.para)) f.para = filled.para;
      });
    }
  }
}

// ============================================================
// NAME PROTECTION (don't overwrite longer name with shorter)
// ============================================================

export function shouldProtectName(
  currentFields: any[],
  normalized: { variable: string; value: string },
): boolean {
  const targetKey = normalizeFieldKey(normalized.variable);
  if (!targetKey.includes("NOME")) return false;

  const existing = currentFields.find((f) =>
    normalizeFieldKey(f.de || "") === targetKey
  );
  if (!existing || !hasFieldValue(existing.para)) return false;

  const existingWords = existing.para.trim().split(/\s+/).length;
  const newWords = normalized.value.trim().split(/\s+/).length;

  if (newWords === 1 && existingWords >= 2) {
    console.log(`NOME PROTEGIDO: "${existing.para}" vs "${normalized.value}"`);
    return true;
  }
  if (
    existing.para.toUpperCase().includes(normalized.value.toUpperCase()) &&
    existingWords >= 2
  ) {
    console.log(`NOME PROTEGIDO (parcial): "${existing.para}"`);
    return true;
  }
  return false;
}

// ============================================================
// TEMPLATE FIELD FILTERING (post-AI enforcement)
// ============================================================

export function filterFieldsAgainstTemplate(
  parsed: any,
  templateFields: any[],
) {
  if (!templateFields.length) return;

  const templateFieldKeys = new Set(
    templateFields.map((f: any) => normalizeFieldKey(f.variable || f.label)),
  );

  if (Array.isArray(parsed.extracted_fields)) {
    parsed.extracted_fields = parsed.extracted_fields.filter((f: any) => {
      const key = normalizeFieldKey(f.de || "");
      const isValid = templateFieldKeys.has(key) ||
        [...templateFieldKeys].some((tk) =>
          tk.includes(key) || key.includes(tk)
        );
      if (!isValid) {
        console.log(`FILTERED ghost extracted field: ${f.de} = ${f.para}`);
      }
      return isValid;
    });
  }

  if (Array.isArray(parsed.missing_fields)) {
    parsed.missing_fields = parsed.missing_fields.filter((f: any) => {
      const key = normalizeFieldKey(f.field_name || "");
      const isValid = templateFieldKeys.has(key) ||
        [...templateFieldKeys].some((tk) =>
          tk.includes(key) || key.includes(tk)
        );
      if (!isValid) {
        console.log(`FILTERED ghost missing field: ${f.field_name}`);
      }
      return isValid;
    });
  }

  if (parsed.missing_fields && parsed.missing_fields.length === 0) {
    parsed.all_data_available = true;
  }
}

// ============================================================
// CRM CONTEXT BUILDER
// ============================================================

export function buildCrmContext(
  contactData: any,
  leadData: any,
  phone: string,
): string {
  return `DADOS DO CONTATO (CRM):
- Nome: ${contactData?.full_name || ""}
- Telefone: ${contactData?.phone || phone}
- Email: ${contactData?.email || ""}
- Cidade: ${contactData?.city || ""}
- Estado: ${contactData?.state || ""}
- Bairro: ${contactData?.neighborhood || ""}
- Rua: ${contactData?.street || ""}
- CEP: ${contactData?.cep || ""}
- Profissão: ${contactData?.profession || ""}

DADOS DO LEAD (CRM):
- Nome: ${leadData?.lead_name || ""}
- Vítima: ${leadData?.victim_name || ""}
- CPF: ${leadData?.cpf || ""}
- Telefone: ${leadData?.lead_phone || ""}
- Email: ${leadData?.lead_email || ""}
- Cidade: ${leadData?.city || ""}
- Estado: ${leadData?.state || ""}`;
}
