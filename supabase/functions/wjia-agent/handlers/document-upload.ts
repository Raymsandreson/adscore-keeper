/**
 * Handler: Document Upload & Extraction
 * Handles media uploads during collecting_docs phase and runs OCR extraction.
 */

import {
  applyConfiguredPredefinedFields,
  applyDefaults,
  autoFillDates,
  autoSyncCityState,
  classifyDocument,
  computeMissingFields,
  DOC_TYPE_LABELS,
  extractFromDocuments,
  getFieldLabel,
  sendWhatsApp,
  syncNameFields,
  type TemplateFieldRef,
  upsertCollectedField,
} from "../../_shared/wjia-utils.ts";
import { jsonResponse } from "./shared.ts";

export async function handleDocumentUpload(opts: {
  supabase: any;
  session: any;
  inst: any;
  normalizedPhone: string;
  instance_name: string;
  media_url: string;
  receivedDocs: any[];
  requestedTypes: string[];
  currentFields: any[];
  collectedData: any;
  catalog: TemplateFieldRef[];
  splitOpts?: { splitMessages?: boolean; splitDelaySeconds?: number };
  zapsignSettings?: any;
}) {
  const {
    supabase, session, inst, normalizedPhone, instance_name,
    media_url, receivedDocs, requestedTypes, currentFields,
    collectedData, catalog, splitOpts, zapsignSettings,
  } = opts;

  const pendingTypes = requestedTypes.filter((t) =>
    !receivedDocs.some((d: any) => d.type === t)
  );

  if (pendingTypes.length === 0 && receivedDocs.length > 0) {
    return await runDocExtraction({
      supabase, session, inst, normalizedPhone, instance_name,
      receivedDocs, currentFields, collectedData, catalog, splitOpts, zapsignSettings,
    });
  }

  const classification = await classifyDocument(media_url, pendingTypes);

  if (classification.type === "invalido") {
    await sendWhatsApp(
      supabase, inst, normalizedPhone, instance_name,
      `⚠️ Não reconheci como documento válido. Envie: *${pendingTypes.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")}*`,
      session.contact_id, session.lead_id, "wjia_invalid", splitOpts,
    );
    return jsonResponse({ active_session: true, processed: true, session_id: session.id });
  }

  if (!pendingTypes.includes(classification.type) && receivedDocs.some((d) => d.type === classification.type)) {
    await sendWhatsApp(
      supabase, inst, normalizedPhone, instance_name,
      `⚠️ Já recebi *${DOC_TYPE_LABELS[classification.type] || classification.type}*. Preciso: *${pendingTypes.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")}*`,
      session.contact_id, session.lead_id, "wjia_dup", splitOpts,
    );
    return jsonResponse({ active_session: true, processed: true, session_id: session.id });
  }

  const assignedType = pendingTypes.includes(classification.type)
    ? classification.type
    : pendingTypes[0] || "outros";
  receivedDocs.push({
    type: assignedType,
    media_url,
    received_at: new Date().toISOString(),
  });

  const newPending = requestedTypes.filter((t) =>
    !receivedDocs.some((d: any) => d.type === t)
  );

  if (newPending.length > 0) {
    await supabase.from("wjia_collection_sessions").update({
      received_documents: receivedDocs,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    await sendWhatsApp(
      supabase, inst, normalizedPhone, instance_name,
      `✅ *${DOC_TYPE_LABELS[assignedType] || assignedType}* recebido!\n\nAinda falta: *${newPending.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")}*`,
      session.contact_id, session.lead_id, "wjia_ack", splitOpts,
    );
    return jsonResponse({ active_session: true, processed: true, session_id: session.id });
  }

  // All docs received → extract
  const { data: lock } = await supabase.from("wjia_collection_sessions")
    .update({
      received_documents: receivedDocs,
      status: "processing_docs",
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id).eq("status", "collecting_docs").select("id");

  if (!lock?.length) {
    await sendWhatsApp(
      supabase, inst, normalizedPhone, instance_name,
      "⏳ Processando documentos...",
      session.contact_id, session.lead_id, "wjia_wait",
    );
    return jsonResponse({ active_session: true, processed: false, session_id: session.id });
  }

  return await runDocExtraction({
    supabase, session, inst, normalizedPhone, instance_name,
    receivedDocs, currentFields, collectedData, catalog, splitOpts, zapsignSettings,
  });
}

export async function runDocExtraction(opts: {
  supabase: any;
  session: any;
  inst: any;
  normalizedPhone: string;
  instance_name: string;
  receivedDocs: any[];
  currentFields: any[];
  collectedData: any;
  catalog: TemplateFieldRef[];
  splitOpts?: { splitMessages?: boolean; splitDelaySeconds?: number };
  zapsignSettings?: any;
}) {
  const {
    supabase, session, inst, normalizedPhone, instance_name,
    receivedDocs, currentFields, collectedData, catalog, splitOpts, zapsignSettings,
  } = opts;

  let customPrompt: string | null = null;
  if (session.shortcut_name) {
    const { data: sc } = await supabase.from("wjia_command_shortcuts").select(
      "media_extraction_prompt",
    ).eq("shortcut_name", session.shortcut_name).maybeSingle();
    customPrompt = sc?.media_extraction_prompt || null;
  }

  const docUrls = receivedDocs.map((d: any) => d.media_url).filter(Boolean);
  const { extractedFields, signerName } = await extractFromDocuments(
    docUrls, catalog, currentFields, customPrompt,
    receivedDocs.map((d: any) => d.type),
  );

  for (const f of extractedFields) {
    upsertCollectedField(currentFields, f.variable, f.value);
  }
  if (signerName) collectedData.signer_name = signerName;
  syncNameFields(currentFields);
  applyDefaults(currentFields);
  applyConfiguredPredefinedFields(currentFields, catalog, zapsignSettings, { phone: normalizedPhone });
  autoFillDates(currentFields, catalog);
  autoSyncCityState(currentFields, catalog);

  const missing = computeMissingFields(catalog, currentFields);
  const summary = currentFields.filter((f) => f.para).map((f) =>
    `• *${getFieldLabel(f, catalog)}*: ${f.para}`
  ).join("\n");
  const docsSummary = receivedDocs.map((d: any) =>
    `• ✅ ${DOC_TYPE_LABELS[d.type] || d.type}`
  ).join("\n");

  const msg = missing.length > 0
    ? `✅ *Documentos analisados!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n⚠️ Ainda preciso: *${missing.map((f) => f.friendly_name).join(", ")}*`
    : `✅ *Dados extraídos!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n📋 Está correto? Responda *SIM* para gerar.`;

  await supabase.from("wjia_collection_sessions").update({
    collected_data: { ...collectedData, fields: currentFields },
    received_documents: receivedDocs,
    missing_fields: missing,
    status: missing.length > 0 ? "collecting" : "ready",
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  await sendWhatsApp(
    supabase, inst, normalizedPhone, instance_name,
    msg, session.contact_id, session.lead_id, "wjia_extract", splitOpts,
  );

  return jsonResponse({ active_session: true, processed: true, session_id: session.id });
}
