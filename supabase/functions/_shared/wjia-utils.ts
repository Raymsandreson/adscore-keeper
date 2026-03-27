/**
 * Shared utilities for the unified WJIA agent.
 * Contains: field normalization, CEP lookup, OCR, ZapSign generation, WhatsApp messaging.
 */

import { geminiChat } from "./gemini.ts";

// ============================================================
// CONSTANTS
// ============================================================

export const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

export const DOC_TYPE_LABELS: Record<string, string> = {
  rg_cnh: "RG / CNH (documento com foto)",
  comprovante_endereco: "Comprovante de endereço",
  comprovante_renda: "Comprovante de renda",
  outros: "Outros documentos",
};

// ============================================================
// FIELD NORMALIZATION & CATALOG
// ============================================================

export type TemplateFieldRef = { variable: string; label: string; normalized: string };

export const normalizeFieldKey = (v: string): string =>
  (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\{\{|\}\}/g, "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase().trim();

export const hasFieldValue = (v: any): boolean => v !== null && v !== undefined && v.toString().trim().length > 0;

export function buildTemplateFieldCatalog(session: any): TemplateFieldRef[] {
  const required = Array.isArray(session?.required_fields) ? session.required_fields : [];
  const fromRequired = required
    .filter((f: any) => f && (f.required ?? true))
    .map((f: any) => {
      const variable = (f.variable || "").toString().trim();
      const label = (f.label || variable || "").toString().trim();
      return { variable: variable || label, label, normalized: normalizeFieldKey(variable || label) };
    })
    .filter((f: TemplateFieldRef) => f.variable && f.normalized);
  if (fromRequired.length > 0) return fromRequired;

  const missing = Array.isArray(session?.missing_fields) ? session.missing_fields : [];
  return missing
    .map((f: any) => {
      const variable = (f.field_name || f.friendly_name || "").toString().trim();
      const label = (f.friendly_name || f.field_name || variable).toString().trim();
      return { variable, label, normalized: normalizeFieldKey(variable || label) };
    })
    .filter((f: TemplateFieldRef) => f.variable && f.normalized);
}

export function getFieldLabel(field: any, catalog: TemplateFieldRef[]): string {
  const rawDe = (field?.de || field?.field_name || "").toString().trim();
  const normKey = normalizeFieldKey(rawDe);
  const match = catalog.find(c => c.normalized === normKey || normalizeFieldKey(c.variable) === normKey);
  return match?.label || rawDe.replace(/\{\{|\}\}/g, "").trim();
}

export function resolveTemplateVariable(field: any, catalog: TemplateFieldRef[]): string | null {
  const candidates = [field?.field_name, field?.de, field?.friendly_name]
    .map((v: any) => (v || "").toString().trim()).filter(Boolean);
  for (const c of candidates) {
    const norm = normalizeFieldKey(c);
    if (!norm) continue;
    const exact = catalog.find(f => f.normalized === norm);
    if (exact) return exact.variable;
    const partial = catalog.find(f => f.normalized.includes(norm) || norm.includes(f.normalized));
    if (partial) return partial.variable;
  }
  return null;
}

export function upsertCollectedField(fields: any[], variable: string, value: string) {
  const normVar = normalizeFieldKey(variable);
  const idx = fields.findIndex((f: any) => normalizeFieldKey(f.de || "") === normVar);
  if (idx >= 0) {
    fields[idx].para = value;
  } else {
    fields.push({ de: variable, para: value });
  }
}

export function computeMissingFields(catalog: TemplateFieldRef[], fields: any[]): { field_name: string; friendly_name: string }[] {
  const isOptional = (k: string) => k.includes("EMAIL") || k.includes("WHATSAPP");
  return catalog
    .filter(req => {
      if (isOptional(req.normalized)) return false;
      return !fields.find((f: any) => normalizeFieldKey(f?.de || "") === req.normalized && hasFieldValue(f?.para));
    })
    .map(f => ({ field_name: f.variable, friendly_name: f.label || f.variable }));
}

export function normalizeIncomingField(field: any, catalog: TemplateFieldRef[]): { variable: string; value: string } | null {
  const deRaw = (field?.de || field?.field_name || "").toString().trim();
  const paraRaw = (field?.para || "").toString().trim();
  if (!deRaw || !paraRaw) return null;

  const deLooksLike = deRaw.includes("{{") || catalog.some(c => {
    const n = normalizeFieldKey(deRaw);
    return c.normalized === n || c.normalized.includes(n) || n.includes(c.normalized);
  });
  const paraLooksLike = paraRaw.includes("{{") || catalog.some(c => {
    const n = normalizeFieldKey(paraRaw);
    return c.normalized === n || c.normalized.includes(n) || n.includes(c.normalized);
  });

  let varCandidate = deRaw, valCandidate = paraRaw;
  if (!deLooksLike && paraLooksLike) { varCandidate = paraRaw; valCandidate = deRaw; }

  const resolved = resolveTemplateVariable({ de: varCandidate, field_name: varCandidate }, catalog) || varCandidate;
  return resolved && hasFieldValue(valCandidate) ? { variable: resolved, value: valCandidate } : null;
}

export function applyDefaults(fields: any[]) {
  for (const f of fields) {
    const key = (f.de || "").replace(/\{\{|\}\}/g, "").toUpperCase().trim();
    if (key.includes("EMAIL") && !f.para) f.para = "contato@prudencioadv.com";
    if (key.includes("WHATSAPP") && !f.para) f.para = "(86)99447-3226";
  }
}

export function autoFillDates(fields: any[], catalog: TemplateFieldRef[]): Set<string> {
  const today = new Date().toLocaleDateString("pt-BR");
  const filled = new Set<string>();
  for (const t of catalog) {
    const k = t.normalized;
    const isDate = k.includes("DATA") && (k.includes("ASSINATURA") || k.includes("PROCURACAO") || k.includes("ATUAL") || k.includes("HOJE"));
    if (isDate) {
      const existing = fields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(t.variable));
      if (!existing || !hasFieldValue(existing.para)) {
        upsertCollectedField(fields, t.variable, today);
      }
      filled.add(k);
    }
  }
  return filled;
}

export function autoSyncCityState(fields: any[], catalog: TemplateFieldRef[]): Set<string> {
  const filled = new Set<string>();
  for (const t of catalog) {
    const k = t.normalized;
    const isSigningCity = (k.includes("CIDADE") || k.includes("LOCAL") || k.includes("MUNICIPIO")) && (k.includes("ASSINATURA") || k.includes("PROCURACAO") || k.includes("OUTORGANTE"));
    const isSigningState = (k.includes("ESTADO") || k.includes("UF")) && (k.includes("ASSINATURA") || k.includes("PROCURACAO") || k.includes("OUTORGANTE"));

    if (isSigningCity) {
      const src = fields.find((f: any) => {
        const fk = normalizeFieldKey(f.de || "");
        return (fk.includes("CIDADE") || fk.includes("MUNICIPIO")) && !fk.includes("ASSINATURA") && !fk.includes("PROCURACAO") && !fk.includes("OUTORGANTE") && hasFieldValue(f.para);
      });
      if (src) {
        const existing = fields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(t.variable));
        if (!existing || !hasFieldValue(existing.para)) upsertCollectedField(fields, t.variable, src.para);
        filled.add(k);
      }
    }
    if (isSigningState) {
      const src = fields.find((f: any) => {
        const fk = normalizeFieldKey(f.de || "");
        return (fk.includes("ESTADO") || fk === "UF") && !fk.includes("ASSINATURA") && !fk.includes("PROCURACAO") && !fk.includes("OUTORGANTE") && hasFieldValue(f.para);
      });
      if (src) {
        const existing = fields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(t.variable));
        if (!existing || !hasFieldValue(existing.para)) upsertCollectedField(fields, t.variable, src.para);
        filled.add(k);
      }
    }
  }
  return filled;
}

export function syncNameFields(fields: any[]) {
  const nameKeys = ["NOMECOMPLETO", "NOMEOUTORGANTE", "NOME"];
  const nameFields = fields.filter(f => nameKeys.includes(normalizeFieldKey(f.de || "")));
  if (nameFields.length >= 2) {
    const filled = nameFields.find(f => hasFieldValue(f.para));
    if (filled) nameFields.forEach(f => { if (!hasFieldValue(f.para)) f.para = filled.para; });
  }
}

// ============================================================
// CEP LOOKUP
// ============================================================

export async function lookupCEP(cep: string) {
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.erro ? null : data;
  } catch { return null; }
}

export async function reverseLookupCEP(state: string, city: string, street: string) {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${encodeURIComponent(state)}/${encodeURIComponent(city)}/${encodeURIComponent(street)}/json/`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 3) : [];
  } catch { return []; }
}

export function extractCEPFromMessage(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}${match[2]}` : null;
}

// ============================================================
// IMAGE / DOCUMENT PROCESSING
// ============================================================

export async function urlToBase64DataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return url;
    const buffer = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch { return url; }
}

export async function classifyDocument(mediaUrl: string, pendingTypes: string[]): Promise<{ type: string; confidence: string; description: string }> {
  if (pendingTypes.length === 1) return { type: pendingTypes[0], confidence: "alta", description: "Auto-assigned (single pending)" };
  try {
    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `Classifique o documento. TIPOS POSSÍVEIS: rg_cnh (identidade), comprovante_endereco, comprovante_renda, outros, invalido. PENDENTES: ${pendingTypes.join(", ")}` },
        { role: "user", content: [{ type: "text", text: "Classifique:" }, { type: "image_url", image_url: { url: await urlToBase64DataUri(mediaUrl) } }] },
      ],
      tools: [{ type: "function", function: { name: "classify_document", description: "Classifica", parameters: { type: "object", properties: { document_type: { type: "string", enum: ["rg_cnh", "comprovante_endereco", "comprovante_renda", "outros", "invalido"] }, confidence: { type: "string" }, description: { type: "string" } }, required: ["document_type", "confidence", "description"] } } }],
      tool_choice: { type: "function", function: { name: "classify_document" } },
      temperature: 0.1,
    });
    const tc = result.choices?.[0]?.message?.tool_calls?.[0];
    return tc?.function?.arguments ? JSON.parse(tc.function.arguments) : { type: pendingTypes[0], confidence: "baixa", description: "Fallback" };
  } catch { return { type: pendingTypes[0], confidence: "baixa", description: "Error fallback" }; }
}

export async function extractFromDocuments(imageUrls: string[], catalog: TemplateFieldRef[], fields: any[], customPrompt: string | null, docTypes: string[]) {
  if (imageUrls.length === 0) return { extractedFields: [], signerName: null };

  const hasOnlyIdentityDocs = docTypes.every(t => t === "rg_cnh");
  const BLOCKED_FROM_ID = new Set(["ESTADOCIVIL", "PROFISSAO", "ENDERECOCOMPLETO", "ENDERECO", "CEP", "CIDADE", "MUNICIPIO", "UF", "ESTADO", "BAIRRO", "RUA", "LOGRADOURO", "NUMERO", "COMPLEMENTO", "DATAASSINATURA", "LOCALASSINATURA"]);

  const defaultPrompt = `Você é um especialista em OCR de documentos brasileiros. Extraia os dados do TITULAR.
REGRAS:
- Em RG: NOME está em letras grandes. FILIAÇÃO são os pais (NÃO confunda). NATURALIDADE = local de nascimento.
- Em CNH: NOME está no campo "Nome". LOCAL DE NASCIMENTO = naturalidade.
- NUNCA invente dados inexistentes (endereço, estado civil, profissão, data de assinatura NÃO existem em RG/CNH).
- Formate CPF como XXX.XXX.XXX-XX e datas como DD/MM/AAAA.
- Se não conseguir ler com certeza, deixe em branco.`;

  const base64Urls = await Promise.all(imageUrls.map(u => urlToBase64DataUri(u)));

  try {
    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `${customPrompt || defaultPrompt}\n\nCAMPOS: ${catalog.map(f => `${f.variable} (${f.label})`).join(", ")}\n\nJÁ PREENCHIDOS: ${fields.filter(f => f.para).map(f => `${f.de}: ${f.para}`).join(", ") || "(nenhum)"}` },
        { role: "user", content: [{ type: "text", text: "Extraia:" }, ...base64Urls.map(url => ({ type: "image_url", image_url: { url } }))] },
      ],
      tools: [{ type: "function", function: { name: "extracted_document_data", description: "Dados extraídos", parameters: { type: "object", properties: { extracted_fields: { type: "array", items: { type: "object", properties: { de: { type: "string" }, para: { type: "string" } }, required: ["de", "para"] } }, signer_name: { type: "string" } }, required: ["extracted_fields"] } } }],
      tool_choice: { type: "function", function: { name: "extracted_document_data" } },
      temperature: 0.1,
    });

    const tc = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) return { extractedFields: [], signerName: null };

    const data = JSON.parse(tc.function.arguments);
    const validFields: { variable: string; value: string }[] = [];

    for (const field of (data.extracted_fields || [])) {
      const normalized = normalizeIncomingField(field, catalog);
      if (!normalized) continue;
      const normKey = normalizeFieldKey(normalized.variable);
      if (hasOnlyIdentityDocs && BLOCKED_FROM_ID.has(normKey)) {
        console.log(`BLOCKED hallucinated field from ID doc: ${normalized.variable}`);
        continue;
      }
      validFields.push(normalized);
    }

    return { extractedFields: validFields, signerName: data.signer_name || null };
  } catch (e) {
    console.error("OCR extraction error:", e);
    return { extractedFields: [], signerName: null };
  }
}

export async function convertImageToPdf(fileBuffer: ArrayBuffer, contentType: string): Promise<string | null> {
  try {
    const { PDFDocument } = await import("https://esm.sh/pdf-lib@1.17.1");
    const pdfDoc = await PDFDocument.create();
    const embeddedImage = contentType.includes("png")
      ? await pdfDoc.embedPng(new Uint8Array(fileBuffer))
      : await pdfDoc.embedJpg(new Uint8Array(fileBuffer));
    const dims = embeddedImage.scale(1);
    const scale = Math.min(555 / dims.width, 802 / dims.height, 1);
    const page = pdfDoc.addPage([595, 842]);
    page.drawImage(embeddedImage, {
      x: (595 - dims.width * scale) / 2, y: (842 - dims.height * scale) / 2,
      width: dims.width * scale, height: dims.height * scale,
    });
    const pdfBytes = await pdfDoc.save();
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < pdfBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, Math.min(i + chunkSize, pdfBytes.length)));
    }
    return btoa(binary);
  } catch (e) {
    console.error("PDF conversion error:", e);
    return null;
  }
}

// ============================================================
// WHATSAPP MESSAGING
// ============================================================

export async function sendWhatsApp(
  supabase: any, inst: any, phone: string, instanceName: string, text: string,
  contactId?: string, leadId?: string, msgIdPrefix = "wjia",
  options?: { splitMessages?: boolean; splitDelaySeconds?: number }
) {
  if (!inst?.instance_token) return;
  const baseUrl = inst.base_url || "https://abraci.uazapi.com";

  const shouldSplit = options?.splitMessages === true;
  const splitDelay = (options?.splitDelaySeconds || 3) * 1000;

  // Split message into parts at double-newline boundaries
  let parts: string[] = [text];
  if (shouldSplit && text.includes("\n\n")) {
    const rawParts = text.split(/\n\n+/).filter(p => p.trim());
    if (rawParts.length > 1) {
      // Group very short parts together (min ~80 chars per message)
      parts = [];
      let buf = "";
      for (const p of rawParts) {
        if (buf && (buf.length + p.length) > 300) {
          parts.push(buf.trim());
          buf = p;
        } else {
          buf = buf ? buf + "\n\n" + p : p;
        }
      }
      if (buf.trim()) parts.push(buf.trim());
    }
  }

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, splitDelay));
    await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: inst.instance_token },
      body: JSON.stringify({ number: phone, text: parts[i] }),
    }).catch(e => console.error("Send error:", e));
    await supabase.from("whatsapp_messages").insert({
      phone, instance_name: instanceName, message_text: parts[i], message_type: "text", direction: "outbound",
      contact_id: contactId || null, lead_id: leadId || null,
      external_message_id: `${msgIdPrefix}_${Date.now()}_${i}`,
    });
  }
}

// ============================================================
// ZAPSIGN DOCUMENT GENERATION
// ============================================================

export async function generateZapSignDocument(
  supabase: any, session: any, fields: any[], signerName: string, signerPhone: string,
  normalizedPhone: string, instanceName: string, inst: any, zapsignToken: string,
) {
  applyDefaults(fields);

  const createBody = {
    template_id: session.template_token,
    signer_name: signerName,
    signer_phone: signerPhone,
    data: fields.length > 0 ? fields : [{ de: "{{_}}", para: " " }],
  };

  console.log("Creating ZapSign doc:", JSON.stringify(createBody));

  const createRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("ZapSign error:", errText);
    return null;
  }

  const docData = await createRes.json();
  const signer = docData.signers?.[0];
  const signUrl = signer ? `https://app.zapsign.co/verificar/${signer.token}` : null;

  await supabase.from("wjia_collection_sessions")
    .update({ status: "generated", doc_token: docData.token, sign_url: signUrl })
    .eq("id", session.id);

  // Resolve the user who owns this instance to set created_by
  let createdByUserId: string | null = null;
  if (instanceName) {
    const { data: instRow } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();
    if (instRow?.id) {
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('default_instance_id', instRow.id)
        .maybeSingle();
      createdByUserId = ownerProfile?.user_id || null;
    }
  }

  await supabase.from("zapsign_documents").insert({
    doc_token: docData.token, template_id: session.template_token,
    document_name: session.template_name || "Documento",
    status: docData.status || "pending", original_file_url: docData.original_file || null,
    sign_url: signUrl, signer_name: signerName, signer_token: signer?.token || null,
    signer_phone: signerPhone, signer_status: signer?.status || "new",
    template_data: fields, lead_id: session.lead_id || null,
    contact_id: session.contact_id || null, sent_via_whatsapp: true,
    whatsapp_phone: normalizedPhone, notify_on_signature: session.notify_on_signature !== false,
    send_signed_pdf: session.send_signed_pdf !== false, instance_name: instanceName,
    created_by: createdByUserId,
  });

  // Attach received documents
  const receivedDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
  for (const doc of receivedDocs) {
    if (!doc.media_url) continue;
    try {
      const fileResp = await fetch(doc.media_url);
      if (!fileResp.ok) continue;
      const fileBuffer = await fileResp.arrayBuffer();
      const ct = fileResp.headers.get("content-type") || "";
      let base64: string | null;
      if (ct.startsWith("image/")) {
        base64 = await convertImageToPdf(fileBuffer, ct);
      } else {
        const bytes = new Uint8Array(fileBuffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
        base64 = btoa(bin);
      }
      if (!base64) continue;
      const typeLabels: Record<string, string> = { rg_cnh: "RG_CNH", comprovante_endereco: "Comprovante_Endereco", comprovante_renda: "Comprovante_Renda" };
      await fetch(`${ZAPSIGN_API_URL}/docs/${docData.token}/add-extra-doc/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: typeLabels[doc.type] || "Anexo", base64_pdf: base64 }),
      });
    } catch (e) { console.error("Attach error:", e); }
  }

  // Send sign link to client
  if (signUrl) {
    const signMsg = `📝 *Documento pronto para assinatura!*\n\nOlá ${signerName.split(" ")[0]}! O documento *${session.template_name}* está pronto.\n\n👉 Clique para assinar: ${signUrl}\n\n*Instruções:*\n1. Clique no link\n2. Confira seus dados\n3. Assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;
    await sendWhatsApp(supabase, inst, normalizedPhone, instanceName, signMsg, session.contact_id, session.lead_id, "wjia_sign");
  }

  // ====================================================
  // AUTO-SEND COLLECTED DOCS + SUMMARY TO WHATSAPP GROUP
  // ====================================================
  try {
    // Find group_id from lead or contact
    let groupId: string | null = null;
    if (session.lead_id) {
      const { data: leadG } = await supabase.from("leads").select("whatsapp_group_id").eq("id", session.lead_id).maybeSingle();
      groupId = leadG?.whatsapp_group_id || null;
    }
    if (!groupId && session.contact_id) {
      const { data: contactG } = await supabase.from("contacts").select("whatsapp_group_id").eq("id", session.contact_id).maybeSingle();
      groupId = contactG?.whatsapp_group_id || null;
    }

    if (groupId && inst?.instance_token) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";

      // Send collected documents (images) to the group
      for (const doc of receivedDocs) {
        if (!doc.media_url) continue;
        const typeLabel = DOC_TYPE_LABELS[doc.type] || doc.type;
        try {
          await fetch(`${baseUrl}/send/media`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: groupId, file: doc.media_url, type: "document", caption: `📎 ${typeLabel} - ${signerName}` }),
          });
          console.log(`Doc ${typeLabel} sent to group ${groupId}`);
        } catch (e) { console.error(`Error sending doc to group:`, e); }
      }

      // Send case summary to the group
      const summaryLines = fields.filter(f => f.para).map(f => `• *${getFieldLabel(f, buildTemplateFieldCatalog([]))}*: ${f.para}`).join("\n");
      const summaryMsg = `📋 *Resumo do Caso - ${session.template_name}*\n\n👤 *Cliente:* ${signerName}\n📱 *Telefone:* ${normalizedPhone}\n\n${summaryLines}\n\n📝 Documento: *${session.template_name}*\n🔗 ${signUrl || 'Aguardando assinatura'}`;
      
      await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: inst.instance_token },
        body: JSON.stringify({ number: groupId, text: summaryMsg }),
      });
      console.log(`Summary sent to group ${groupId}`);
    }
  } catch (groupErr) {
    console.error("Error sending to group:", groupErr);
  }

  return docData;
}

// ============================================================
// CRM CONTEXT BUILDER
// ============================================================

export function buildCrmContext(contactData: any, leadData: any, phone: string): string {
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

// ============================================================
// TEMPLATE FIELD FILTERING (post-AI enforcement)
// ============================================================

export function filterFieldsAgainstTemplate(parsed: any, templateFields: any[]) {
  if (!templateFields.length) return;

  const templateFieldKeys = new Set(templateFields.map((f: any) => normalizeFieldKey(f.variable || f.label)));

  if (Array.isArray(parsed.extracted_fields)) {
    parsed.extracted_fields = parsed.extracted_fields.filter((f: any) => {
      const key = normalizeFieldKey(f.de || "");
      const isValid = templateFieldKeys.has(key) || [...templateFieldKeys].some(tk => tk.includes(key) || key.includes(tk));
      if (!isValid) console.log(`FILTERED ghost extracted field: ${f.de} = ${f.para}`);
      return isValid;
    });
  }

  if (Array.isArray(parsed.missing_fields)) {
    parsed.missing_fields = parsed.missing_fields.filter((f: any) => {
      const key = normalizeFieldKey(f.field_name || "");
      const isValid = templateFieldKeys.has(key) || [...templateFieldKeys].some(tk => tk.includes(key) || key.includes(tk));
      if (!isValid) console.log(`FILTERED ghost missing field: ${f.field_name}`);
      return isValid;
    });
  }

  if (parsed.missing_fields && parsed.missing_fields.length === 0) {
    parsed.all_data_available = true;
  }
}

// ============================================================
// NAME PROTECTION (don't overwrite longer name with shorter)
// ============================================================

export function shouldProtectName(currentFields: any[], normalized: { variable: string; value: string }): boolean {
  const targetKey = normalizeFieldKey(normalized.variable);
  if (!targetKey.includes("NOME")) return false;

  const existing = currentFields.find(f => normalizeFieldKey(f.de || "") === targetKey);
  if (!existing || !hasFieldValue(existing.para)) return false;

  const existingWords = existing.para.trim().split(/\s+/).length;
  const newWords = normalized.value.trim().split(/\s+/).length;

  if (newWords === 1 && existingWords >= 2) {
    console.log(`NOME PROTEGIDO: "${existing.para}" vs "${normalized.value}"`);
    return true;
  }
  if (existing.para.toUpperCase().includes(normalized.value.toUpperCase()) && existingWords >= 2) {
    console.log(`NOME PROTEGIDO (parcial): "${existing.para}"`);
    return true;
  }
  return false;
}

// ============================================================
// CEP AUTO-FILL FROM FIELD
// ============================================================

export async function autoFillFromCEP(currentFields: any[], catalog: TemplateFieldRef[]) {
  const cepField = currentFields.find(f => normalizeFieldKey(f.de || "").includes("CEP") && hasFieldValue(f.para));
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
      if (m.patterns.some(p => k.includes(p)) && !k.includes("ASSINATURA") && !k.includes("OUTORGANTE")) {
        const existing = currentFields.find(f => normalizeFieldKey(f.de || "") === t.normalized);
        if (!existing || !hasFieldValue(existing.para)) {
          upsertCollectedField(currentFields, t.variable, m.value);
        }
      }
    }
  }
  autoSyncCityState(currentFields, catalog);
}
