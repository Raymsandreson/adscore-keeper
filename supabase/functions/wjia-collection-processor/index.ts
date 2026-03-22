import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

// ============================================================
// UTILITY FUNCTIONS (deterministic, no AI)
// ============================================================

async function lookupCEP(cep: string) {
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.erro ? null : data;
  } catch { return null; }
}

async function reverseLookupCEP(state: string, city: string, street: string) {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${encodeURIComponent(state)}/${encodeURIComponent(city)}/${encodeURIComponent(street)}/json/`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 3) : [];
  } catch { return []; }
}

function extractCEPFromMessage(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}${match[2]}` : null;
}

async function urlToBase64DataUri(url: string): Promise<string> {
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

// ============================================================
// FIELD NORMALIZATION & CATALOG
// ============================================================

type TemplateFieldRef = { variable: string; label: string; normalized: string };

const normalizeFieldKey = (v: string): string =>
  (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\{\{|\}\}/g, "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase().trim();

const hasFieldValue = (v: any): boolean => v !== null && v !== undefined && v.toString().trim().length > 0;

function buildTemplateFieldCatalog(session: any): TemplateFieldRef[] {
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

function getFieldLabel(field: any, catalog: TemplateFieldRef[]): string {
  const rawDe = (field?.de || field?.field_name || "").toString().trim();
  const normKey = normalizeFieldKey(rawDe);
  const match = catalog.find(c => c.normalized === normKey || normalizeFieldKey(c.variable) === normKey);
  return match?.label || rawDe.replace(/\{\{|\}\}/g, "").trim();
}

function resolveTemplateVariable(field: any, catalog: TemplateFieldRef[]): string | null {
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

function upsertCollectedField(fields: any[], variable: string, value: string) {
  const normVar = normalizeFieldKey(variable);
  const idx = fields.findIndex((f: any) => normalizeFieldKey(f.de || "") === normVar);
  if (idx >= 0) {
    fields[idx].para = value;
  } else {
    fields.push({ de: variable, para: value });
  }
}

function computeMissingFields(catalog: TemplateFieldRef[], fields: any[]): { field_name: string; friendly_name: string }[] {
  const isOptional = (k: string) => k.includes("EMAIL") || k.includes("WHATSAPP");
  return catalog
    .filter(req => {
      if (isOptional(req.normalized)) return false;
      return !fields.find((f: any) => normalizeFieldKey(f?.de || "") === req.normalized && hasFieldValue(f?.para));
    })
    .map(f => ({ field_name: f.variable, friendly_name: f.label || f.variable }));
}

function normalizeIncomingField(field: any, catalog: TemplateFieldRef[]): { variable: string; value: string } | null {
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

function applyDefaults(fields: any[]) {
  for (const f of fields) {
    const key = (f.de || "").replace(/\{\{|\}\}/g, "").toUpperCase().trim();
    if (key.includes("EMAIL") && !f.para) f.para = "contato@prudencioadv.com";
    if (key.includes("WHATSAPP") && !f.para) f.para = "(86)99447-3226";
  }
}

function autoFillDates(fields: any[], catalog: TemplateFieldRef[]): Set<string> {
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

function autoSyncCityState(fields: any[], catalog: TemplateFieldRef[]): Set<string> {
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

function syncNameFields(fields: any[]) {
  const nameKeys = ["NOMECOMPLETO", "NOMEOUTORGANTE", "NOME"];
  const nameFields = fields.filter(f => nameKeys.includes(normalizeFieldKey(f.de || "")));
  if (nameFields.length >= 2) {
    const filled = nameFields.find(f => hasFieldValue(f.para));
    if (filled) nameFields.forEach(f => { if (!hasFieldValue(f.para)) f.para = filled.para; });
  }
}

// ============================================================
// WHATSAPP MESSAGING HELPER
// ============================================================

async function sendWhatsApp(supabase: any, inst: any, phone: string, instanceName: string, text: string, contactId?: string, leadId?: string, msgIdPrefix = "wjia") {
  if (!inst?.instance_token) return;
  const baseUrl = inst.base_url || "https://abraci.uazapi.com";
  await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: inst.instance_token },
    body: JSON.stringify({ number: phone, text }),
  }).catch(e => console.error("Send error:", e));
  await supabase.from("whatsapp_messages").insert({
    phone, instance_name: instanceName, message_text: text, message_type: "text", direction: "outbound",
    contact_id: contactId || null, lead_id: leadId || null,
    external_message_id: `${msgIdPrefix}_${Date.now()}`,
  });
}

// ============================================================
// DOCUMENT CLASSIFICATION & OCR (deterministic + AI vision)
// ============================================================

async function classifyDocument(mediaUrl: string, pendingTypes: string[]): Promise<{ type: string; confidence: string; description: string }> {
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

async function extractFromDocuments(imageUrls: string[], catalog: TemplateFieldRef[], fields: any[], customPrompt: string | null, docTypes: string[]) {
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

async function convertImageToPdf(fileBuffer: ArrayBuffer, contentType: string): Promise<string | null> {
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
// ZAPSIGN DOCUMENT GENERATION
// ============================================================

async function generateZapSignDocument(
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

  // Send sign link
  if (signUrl) {
    const signMsg = `📝 *Documento pronto para assinatura!*\n\nOlá ${signerName.split(" ")[0]}! O documento *${session.template_name}* está pronto.\n\n👉 Clique para assinar: ${signUrl}\n\n*Instruções:*\n1. Clique no link\n2. Confira seus dados\n3. Assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;
    await sendWhatsApp(supabase, inst, normalizedPhone, instanceName, signMsg, session.contact_id, session.lead_id, "wjia_sign");
  }

  return docData;
}

// ============================================================
// MAIN HANDLER
// ============================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let { phone, instance_name, message_text, media_url, media_type, message_type } = await req.json();
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "phone and instance_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === TRANSCRIBE AUDIO ===
    const isAudio = message_type === "audio" || message_type === "ptt" || (media_type?.startsWith("audio/"));
    if (isAudio && media_url && !message_text) {
      try {
        const result = await geminiChat({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Transcreva EXATAMENTE o que a pessoa disse. Retorne apenas a transcrição." },
            { role: "user", content: [{ type: "text", text: "Transcreva:" }, { type: "image_url", image_url: { url: await urlToBase64DataUri(media_url) } }] },
          ],
          temperature: 0.1,
        });
        const t = result.choices?.[0]?.message?.content;
        if (t?.trim()) message_text = t.trim();
      } catch (e) { console.error("Audio transcription error:", e); }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");

    // === FIND ACTIVE SESSION ===
    const { data: sessionRaw } = await supabase
      .from("wjia_collection_sessions").select("*")
      .eq("phone", normalizedPhone).eq("instance_name", instance_name)
      .in("status", ["collecting", "collecting_docs", "processing_docs", "ready"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!sessionRaw) {
      return new Response(JSON.stringify({ active_session: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let session = sessionRaw;

    // Recovery: unstick processing_docs > 3 min
    if (session.status === "processing_docs") {
      const stuckMin = (Date.now() - new Date(session.updated_at || session.created_at).getTime()) / 60000;
      if (stuckMin > 3) {
        await supabase.from("wjia_collection_sessions").update({ status: "collecting_docs", updated_at: new Date().toISOString() }).eq("id", session.id);
        const { data: refreshed } = await supabase.from("wjia_collection_sessions").select("*").eq("id", session.id).single();
        if (refreshed) session = refreshed;
      }
    }

    // Load agent persona
    let agentPersona = "";
    if ((session as any).agent_id) {
      const { data: agent } = await supabase.from("whatsapp_ai_agents").select("name, base_prompt").eq("id", (session as any).agent_id).maybeSingle();
      if (agent) agentPersona = `\nPERSONA: ${agent.name}\n${agent.base_prompt || ""}\n`;
    }

    const { data: inst } = await supabase.from("whatsapp_instances").select("instance_token, base_url").eq("instance_name", instance_name).maybeSingle();
    const catalog = buildTemplateFieldCatalog(session);
    const collectedData = session.collected_data || { fields: [] };
    const currentFields = [...(collectedData.fields || [])];

    const docTypeLabels: Record<string, string> = {
      rg_cnh: "RG / CNH", comprovante_endereco: "Comprovante de endereço",
      comprovante_renda: "Comprovante de renda", outros: "Outros documentos",
    };

    console.log("Session:", session.id, "status:", session.status);

    // ============================================================
    // PHASE 1: HANDLE DOCUMENT UPLOADS (collecting_docs)
    // This is deterministic — classify doc, save, extract OCR when all received
    // ============================================================
    if (session.status === "collecting_docs" || session.status === "processing_docs") {
      const receivedDocs = Array.isArray(session.received_documents) ? [...session.received_documents] : [];
      const requestedTypes: string[] = Array.isArray(session.document_types) ? session.document_types : [];
      const isMedia = media_url && (message_type === "image" || message_type === "document");

      // Check for "pular" (skip docs)
      const msgLower = (message_text || "").toLowerCase().trim();
      if (!isMedia && (msgLower === "pular" || msgLower === "skip" || msgLower.includes("não tenho") || msgLower.includes("nao tenho"))) {
        // Extract from whatever docs we have, then move to collecting
        let customPrompt: string | null = null;
        if (session.shortcut_name) {
          const { data: sc } = await supabase.from("wjia_command_shortcuts").select("media_extraction_prompt").eq("shortcut_name", session.shortcut_name).maybeSingle();
          customPrompt = sc?.media_extraction_prompt || null;
        }

        const docUrls = receivedDocs.map((d: any) => d.media_url).filter(Boolean);
        const { extractedFields, signerName } = await extractFromDocuments(docUrls, catalog, currentFields, customPrompt, receivedDocs.map((d: any) => d.type));

        for (const f of extractedFields) upsertCollectedField(currentFields, f.variable, f.value);
        if (signerName) collectedData.signer_name = signerName;
        syncNameFields(currentFields);
        applyDefaults(currentFields);

        const autoFilledKeys = autoFillDates(currentFields, catalog);
        const syncedKeys = autoSyncCityState(currentFields, catalog);
        const allAutoKeys = new Set([...autoFilledKeys, ...syncedKeys]);

        const missing = computeMissingFields(catalog, currentFields).filter(f => !allAutoKeys.has(normalizeFieldKey(f.field_name)));

        await supabase.from("wjia_collection_sessions").update({
          collected_data: { ...collectedData, fields: currentFields },
          received_documents: receivedDocs, missing_fields: missing,
          status: missing.length > 0 ? "collecting" : "ready",
          updated_at: new Date().toISOString(),
        }).eq("id", session.id);

        // Update session in memory for the agent phase
        session.status = missing.length > 0 ? "collecting" : "ready";
        session.collected_data = { ...collectedData, fields: currentFields };
        session.missing_fields = missing;
        session.received_documents = receivedDocs;
        // Fall through to agent phase below
      } else if (isMedia) {
        // Classify and store document
        const pendingTypes = requestedTypes.filter(t => !receivedDocs.some((d: any) => d.type === t));

        if (pendingTypes.length === 0 && receivedDocs.length > 0) {
          // All already received — recovery
          const { data: lock } = await supabase.from("wjia_collection_sessions")
            .update({ status: "processing_docs", updated_at: new Date().toISOString() })
            .eq("id", session.id).eq("status", "collecting_docs").select("id");

          if (lock?.length) {
            // Run full extraction
            let customPrompt: string | null = null;
            if (session.shortcut_name) {
              const { data: sc } = await supabase.from("wjia_command_shortcuts").select("media_extraction_prompt").eq("shortcut_name", session.shortcut_name).maybeSingle();
              customPrompt = sc?.media_extraction_prompt || null;
            }

            const docUrls = receivedDocs.map((d: any) => d.media_url).filter(Boolean);
            const { extractedFields, signerName } = await extractFromDocuments(docUrls, catalog, currentFields, customPrompt, receivedDocs.map((d: any) => d.type));

            for (const f of extractedFields) upsertCollectedField(currentFields, f.variable, f.value);
            if (signerName) collectedData.signer_name = signerName;
            syncNameFields(currentFields);
            applyDefaults(currentFields);
            autoFillDates(currentFields, catalog);
            autoSyncCityState(currentFields, catalog);

            const missing = computeMissingFields(catalog, currentFields);
            const summary = currentFields.filter(f => f.para).map(f => `• *${getFieldLabel(f, catalog)}*: ${f.para}`).join("\n");
            const docsSummary = receivedDocs.map((d: any) => `• ✅ ${docTypeLabels[d.type] || d.type}`).join("\n");

            const msg = missing.length > 0
              ? `✅ *Documentos analisados!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n⚠️ Ainda preciso: *${missing.map(f => f.friendly_name).join(", ")}*`
              : `✅ *Dados extraídos!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n📋 Está tudo correto? Responda *SIM* para gerar.`;

            await supabase.from("wjia_collection_sessions").update({
              collected_data: { ...collectedData, fields: currentFields },
              received_documents: receivedDocs, missing_fields: missing,
              status: missing.length > 0 ? "collecting" : "ready",
              updated_at: new Date().toISOString(),
            }).eq("id", session.id);

            await sendWhatsApp(supabase, inst, normalizedPhone, instance_name, msg, session.contact_id, session.lead_id, "wjia_extract");
          }

          return new Response(JSON.stringify({ active_session: true, processed: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const classification = await classifyDocument(media_url, pendingTypes);

        if (classification.type === "invalido") {
          await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
            `⚠️ Não reconheci como documento válido. Envie: *${pendingTypes.map(t => docTypeLabels[t] || t).join(", ")}*`,
            session.contact_id, session.lead_id, "wjia_invalid");
          return new Response(JSON.stringify({ active_session: true, processed: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (!pendingTypes.includes(classification.type) && receivedDocs.some(d => d.type === classification.type)) {
          await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
            `⚠️ Já recebi *${docTypeLabels[classification.type] || classification.type}*. Preciso de: *${pendingTypes.map(t => docTypeLabels[t] || t).join(", ")}*`,
            session.contact_id, session.lead_id, "wjia_dup");
          return new Response(JSON.stringify({ active_session: true, processed: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const assignedType = pendingTypes.includes(classification.type) ? classification.type : pendingTypes[0] || "outros";
        receivedDocs.push({ type: assignedType, media_url, received_at: new Date().toISOString() });

        const newPending = requestedTypes.filter(t => !receivedDocs.some((d: any) => d.type === t));

        if (newPending.length > 0) {
          // Still waiting for more docs
          const ackMsg = `✅ *${docTypeLabels[assignedType] || assignedType}* recebido!\n\nAinda falta: *${newPending.map(t => docTypeLabels[t] || t).join(", ")}*`;
          await supabase.from("wjia_collection_sessions").update({
            received_documents: receivedDocs, updated_at: new Date().toISOString(),
          }).eq("id", session.id);
          await sendWhatsApp(supabase, inst, normalizedPhone, instance_name, ackMsg, session.contact_id, session.lead_id, "wjia_ack");
          return new Response(JSON.stringify({ active_session: true, processed: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // All docs received → lock and extract
        const { data: lock } = await supabase.from("wjia_collection_sessions")
          .update({ received_documents: receivedDocs, status: "processing_docs", updated_at: new Date().toISOString() })
          .eq("id", session.id).eq("status", "collecting_docs").select("id");

        if (!lock?.length) {
          await sendWhatsApp(supabase, inst, normalizedPhone, instance_name, "⏳ Processando documentos...", session.contact_id, session.lead_id, "wjia_wait");
          return new Response(JSON.stringify({ active_session: true, processed: false, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        let customPrompt: string | null = null;
        if (session.shortcut_name) {
          const { data: sc } = await supabase.from("wjia_command_shortcuts").select("media_extraction_prompt").eq("shortcut_name", session.shortcut_name).maybeSingle();
          customPrompt = sc?.media_extraction_prompt || null;
        }

        const docUrls = receivedDocs.map((d: any) => d.media_url).filter(Boolean);
        const { extractedFields, signerName } = await extractFromDocuments(docUrls, catalog, currentFields, customPrompt, receivedDocs.map((d: any) => d.type));

        for (const f of extractedFields) upsertCollectedField(currentFields, f.variable, f.value);
        if (signerName) collectedData.signer_name = signerName;
        syncNameFields(currentFields);
        applyDefaults(currentFields);
        autoFillDates(currentFields, catalog);
        autoSyncCityState(currentFields, catalog);

        const missing = computeMissingFields(catalog, currentFields);
        const summary = currentFields.filter(f => f.para).map(f => `• *${getFieldLabel(f, catalog)}*: ${f.para}`).join("\n");
        const docsSummary = receivedDocs.map((d: any) => `• ✅ ${docTypeLabels[d.type] || d.type}`).join("\n");

        const msg = missing.length > 0
          ? `✅ *Documentos analisados!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n⚠️ Ainda preciso: *${missing.map(f => f.friendly_name).join(", ")}*`
          : `✅ *Dados extraídos!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n📋 Está tudo correto? Responda *SIM* para gerar.`;

        await supabase.from("wjia_collection_sessions").update({
          collected_data: { ...collectedData, fields: currentFields },
          received_documents: receivedDocs, missing_fields: missing,
          status: missing.length > 0 ? "collecting" : "ready",
          updated_at: new Date().toISOString(),
        }).eq("id", session.id);

        await sendWhatsApp(supabase, inst, normalizedPhone, instance_name, msg, session.contact_id, session.lead_id, "wjia_extract");

        return new Response(JSON.stringify({ active_session: true, processed: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else if (session.status !== "collecting" && session.status !== "ready") {
        // Text message during doc collection — remind
        const pendingTypes = requestedTypes.filter(t => !receivedDocs.some((d: any) => d.type === t));
        await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
          `📎 Preciso que envie: *${pendingTypes.map(t => docTypeLabels[t] || t).join(", ")}*.\n\nSe não tiver, digite *pular*.`,
          session.contact_id, session.lead_id, "wjia_remind");
        return new Response(JSON.stringify({ active_session: true, processed: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ============================================================
    // PHASE 2: UNIFIED AGENT — handles collecting, corrections, confirmations
    // The AI receives the full context and decides what to do
    // ============================================================

    // Pre-process: auto-fill dates and sync city/state
    const autoFilledKeys = autoFillDates(currentFields, catalog);
    const syncedKeys = autoSyncCityState(currentFields, catalog);
    const allAutoKeys = new Set([...autoFilledKeys, ...syncedKeys]);

    // Update collectedData
    collectedData.fields = currentFields;
    let missingFields = computeMissingFields(catalog, currentFields)
      .filter(f => !allAutoKeys.has(normalizeFieldKey(f.field_name)));

    // CEP pre-lookup
    let cepContext = "";
    const detectedCEP = extractCEPFromMessage(message_text || "");
    if (detectedCEP) {
      const cepData = await lookupCEP(detectedCEP);
      if (cepData) {
        cepContext = `\n📍 RESULTADO DA BUSCA DE CEP ${detectedCEP}: Rua: ${cepData.logradouro}, Bairro: ${cepData.bairro}, Cidade: ${cepData.localidade}, UF: ${cepData.uf}. APRESENTE ao cliente e peça confirmação + número/complemento.`;
      } else {
        cepContext = `\n📍 CEP ${detectedCEP} não encontrado. Peça o endereço completo manualmente.`;
      }
    }
    // Detect "não sei o CEP"
    const msgLower = (message_text || "").toLowerCase();
    if (!detectedCEP && (msgLower.includes("não sei o cep") || msgLower.includes("nao sei o cep") || msgLower.includes("não sei meu cep") || msgLower.includes("nao tenho cep"))) {
      cepContext = `\n📍 Cliente NÃO sabe o CEP. CEP é OPCIONAL. Peça rua, número, bairro, cidade e estado. NÃO pergunte o CEP novamente.`;
    }

    // Reverse CEP lookup if address provided without CEP
    if (!detectedCEP && !cepContext) {
      const addressField = currentFields.find(f => {
        const k = normalizeFieldKey(f.de || "");
        return (k.includes("RUA") || k.includes("LOGRADOURO") || k.includes("ENDERECOCOMPLETO")) && hasFieldValue(f.para);
      });
      const cityField = currentFields.find(f => {
        const k = normalizeFieldKey(f.de || "");
        return (k.includes("CIDADE") || k.includes("MUNICIPIO")) && hasFieldValue(f.para);
      });
      const stateField = currentFields.find(f => {
        const k = normalizeFieldKey(f.de || "");
        return (k.includes("ESTADO") || k === "UF") && hasFieldValue(f.para);
      });
      if (addressField && cityField && stateField) {
        const results = await reverseLookupCEP(stateField.para, cityField.para, addressField.para);
        if (results.length > 0) {
          cepContext = `\n📍 BUSCA REVERSA DE CEP: Encontrei ${results.length} resultado(s): ${results.map(r => `CEP ${r.cep} - ${r.logradouro}, ${r.bairro}`).join(" | ")}. Se algum parecer correto, use o CEP correspondente.`;
        }
      }
    }

    // Get conversation context
    const { data: recentMsgs } = await supabase.from("whatsapp_messages")
      .select("direction, message_text, created_at")
      .eq("phone", normalizedPhone).order("created_at", { ascending: false }).limit(20);

    const conversationText = (recentMsgs || []).reverse().filter((m: any) => m.message_text)
      .map((m: any) => `[${m.direction === "outbound" ? "Agente" : "Cliente"}]: ${m.message_text}`).join("\n");

    // Build context for the AI
    const filledFields = currentFields.filter(f => f.para).map(f => `- ${getFieldLabel(f, catalog)}: ${f.para}`).join("\n");
    const missingFieldsList = missingFields.map(f => `- ${f.friendly_name} (variável: ${f.field_name})`).join("\n");
    const allFieldsList = catalog.map(f => `- ${f.label} (variável: ${f.variable})`).join("\n");

    const receivedDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
    const docsInfo = receivedDocs.length > 0
      ? `\nDocumentos anexados: ${receivedDocs.map((d: any) => docTypeLabels[d.type] || d.type).join(", ")}`
      : "";

    // Determine current phase for context
    const isReadyPhase = session.status === "ready" || missingFields.length === 0;

    const systemPrompt = `Você é um assistente jurídico conversando pelo WhatsApp. Seu OBJETIVO é coletar os dados necessários para gerar o documento "${session.template_name}" e obter a confirmação do cliente.
${agentPersona}

ESTILO:
- Converse como uma pessoa real no WhatsApp. Frases curtas, naturais.
- Use ✅/❌ para resumos de progresso. Para conversa normal, escreva frases corridas.
- Aceite o que o cliente diz sem questionar. Se ele corrigir algo, atualize sem perguntar "qual campo".

CAMPOS DO TEMPLATE (use EXATAMENTE estes nomes):
${allFieldsList}

DADOS JÁ COLETADOS:
${filledFields || "(nenhum)"}

DADOS QUE FALTAM:
${missingFieldsList || "(todos coletados!)"}
${docsInfo}

FASE ATUAL: ${isReadyPhase ? "CONFIRMAÇÃO — todos os dados estão coletados. O cliente pode confirmar (SIM) ou corrigir algo." : "COLETA — ainda faltam dados."}

CONVERSA RECENTE:
${conversationText}

MENSAGEM DO CLIENTE: "${message_text || "(vazia)"}"
${cepContext}

REGRAS DO OBJETIVO:
1. Se o cliente está CONFIRMANDO (sim, ok, pode gerar): use a ação "confirm_generate".
2. Se o cliente está CORRIGINDO um dado (ex: "meu nome é X", "o CPF é Y"): extraia a correção nos newly_extracted E se todos os dados estão completos, use ação "show_summary" para mostrar o resumo atualizado.
3. Se ainda faltam dados: extraia o que puder da mensagem, peça o restante de forma natural. Peça TUDO que falta de uma vez, não um por vez.
4. CEP é OPCIONAL se o cliente não souber. NUNCA insista.
5. Campos de DATA_ASSINATURA/DATA_PROCURACAO já são preenchidos automaticamente — NÃO pergunte.
6. CIDADE/ESTADO de assinatura/outorgante são sincronizados automaticamente — NÃO pergunte separadamente.
7. Se NOME já foi extraído de documento, um nome parcial do cliente é CONFIRMAÇÃO, não correção.
8. Quando apresentar dados extraídos de documentos ou coleta, use os NOMES EXATOS dos campos do template listados acima.
9. "Barro", "Centro", etc. são nomes válidos de bairro/zona rural. Aceite sem questionar.
10. ENDERECO_COMPLETO deve conter: rua + número + bairro. Sempre peça o bairro.`;

    const tools = [{
      type: "function",
      function: {
        name: "process_message",
        description: "Processa a mensagem do cliente e decide a próxima ação",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["collect_data", "show_summary", "confirm_generate"],
              description: "collect_data: extraiu dados e/ou pede mais. show_summary: todos coletados, mostra resumo para confirmar. confirm_generate: cliente confirmou, gerar documento.",
            },
            newly_extracted: {
              type: "array",
              description: "Campos extraídos/corrigidos nesta mensagem",
              items: {
                type: "object",
                properties: {
                  de: { type: "string", description: "Variável EXATA do template" },
                  para: { type: "string", description: "Valor extraído/corrigido" },
                },
                required: ["de", "para"],
              },
            },
            reply_to_client: {
              type: "string",
              description: "Mensagem para o cliente. Use nomes exatos dos campos do template.",
            },
          },
          required: ["action", "newly_extracted", "reply_to_client"],
        },
      },
    }];

    const aiResult = await geminiChat({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message_text || "(mensagem vazia)" },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "process_message" } },
      temperature: 0.2,
    });

    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("AI failed to process");
      return new Response(JSON.stringify({ active_session: true, processed: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let result: any;
    try { result = JSON.parse(toolCall.function.arguments); } catch {
      return new Response(JSON.stringify({ active_session: true, processed: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("Agent result:", JSON.stringify(result));

    // Apply extracted/corrected fields
    for (const field of (result.newly_extracted || [])) {
      const normalized = normalizeIncomingField(field, catalog);
      if (!normalized) continue;

      // Name protection: don't overwrite longer name with shorter
      const targetKey = normalizeFieldKey(normalized.variable);
      if (targetKey.includes("NOME")) {
        const existing = currentFields.find(f => normalizeFieldKey(f.de || "") === targetKey);
        if (existing && hasFieldValue(existing.para)) {
          const existingWords = existing.para.trim().split(/\s+/).length;
          const newWords = normalized.value.trim().split(/\s+/).length;
          if (newWords === 1 && existingWords >= 2) {
            console.log(`NOME PROTEGIDO: "${existing.para}" vs "${normalized.value}"`);
            continue;
          }
          if (existing.para.toUpperCase().includes(normalized.value.toUpperCase()) && existingWords >= 2) {
            console.log(`NOME PROTEGIDO (parcial): "${existing.para}"`);
            continue;
          }
        }
      }

      upsertCollectedField(currentFields, normalized.variable, normalized.value);
    }

    // Re-sync names and auto-fill
    syncNameFields(currentFields);
    applyDefaults(currentFields);
    autoFillDates(currentFields, catalog);
    autoSyncCityState(currentFields, catalog);

    // CEP auto-lookup for newly provided CEP
    const cepField = currentFields.find(f => normalizeFieldKey(f.de || "").includes("CEP") && hasFieldValue(f.para));
    if (cepField) {
      const cepData = await lookupCEP(cepField.para);
      if (cepData) {
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
    }

    // Recompute missing
    const finalMissing = computeMissingFields(catalog, currentFields);
    const allCollected = finalMissing.length === 0;

    // Decide action
    const updatedCollectedData = { ...collectedData, fields: currentFields };

    if (result.action === "confirm_generate" && allCollected && zapsignToken) {
      // GENERATE DOCUMENT
      const signerName = collectedData.signer_name || "Cliente";
      const signerPhone = collectedData.signer_phone || normalizedPhone;

      await supabase.from("wjia_collection_sessions").update({
        collected_data: updatedCollectedData, missing_fields: [], status: "ready",
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);

      session.received_documents = receivedDocs;
      const docData = await generateZapSignDocument(supabase, session, currentFields, signerName, signerPhone, normalizedPhone, instance_name, inst, zapsignToken);

      return new Response(JSON.stringify({
        active_session: true, processed: true, confirmed: true, generated: !!docData, session_id: session.id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // For show_summary or collect_data with all collected → show summary and set ready
    if (allCollected) {
      const summaryLines = currentFields.filter(f => f.para).map(f => `• *${getFieldLabel(f, catalog)}*: ${f.para}`).join("\n");
      const docsSection = receivedDocs.length > 0
        ? `\n\n📎 *Documentos anexados:*\n${receivedDocs.map((d: any) => `• ✅ ${docTypeLabels[d.type] || d.type}`).join("\n")}`
        : "";

      // Use AI reply if it makes sense, otherwise build our own summary
      let replyMsg = result.reply_to_client;
      if (result.action === "show_summary" || session.status !== "ready") {
        replyMsg = `Confira as informações antes de gerar o documento *${session.template_name}*:\n\n${summaryLines}${docsSection}\n\n📋 Está tudo correto? Responda *SIM* para gerar o documento ou me diga o que precisa corrigir.`;
      }

      await supabase.from("wjia_collection_sessions").update({
        collected_data: updatedCollectedData, missing_fields: [], status: "ready",
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);

      await sendWhatsApp(supabase, inst, normalizedPhone, instance_name, replyMsg, session.contact_id, session.lead_id, "wjia_summary");

      return new Response(JSON.stringify({
        active_session: true, processed: true, all_collected: true, session_id: session.id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Still collecting
    await supabase.from("wjia_collection_sessions").update({
      collected_data: updatedCollectedData, missing_fields: finalMissing, status: "collecting",
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    if (result.reply_to_client) {
      await sendWhatsApp(supabase, inst, normalizedPhone, instance_name, result.reply_to_client, session.contact_id, session.lead_id, "wjia_collect");
    }

    return new Response(JSON.stringify({
      active_session: true, processed: true, all_collected: false, session_id: session.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Collection processor error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
