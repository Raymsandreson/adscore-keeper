/**
 * Handler: Follow-Up Message (MODE 2)
 * Processes messages during active collection sessions —
 * collects data, handles doc uploads, generates documents.
 */

import { geminiChat } from "../../_shared/gemini.ts";
import { resolveVoiceId, sendWhatsAppAudio } from "../../_shared/whatsapp-utils.ts";
import {
  applyConfiguredPredefinedFields,
  applyDefaults,
  autoFillDates,
  autoFillFromCEP,
  autoSyncCityState,
  buildTemplateFieldCatalog,
  computeMissingFields,
  DOC_TYPE_LABELS,
  extractCEPFromMessage,
  extractFromDocuments,
  generateZapSignDocument,
  getFieldLabel,
  hasFieldValue,
  lookupCEP,
  normalizeFieldKey,
  normalizeIncomingField,
  reverseLookupCEP,
  sendWhatsApp,
  shouldProtectName,
  syncNameFields,
  upsertCollectedField,
} from "../../_shared/wjia-utils.ts";
import { jsonResponse } from "./shared.ts";
import { handleDocumentUpload } from "./document-upload.ts";

export async function handleFollowUp(opts: {
  supabase: any;
  zapsignToken: string | undefined;
  normalizedPhone: string;
  instance_name: string;
  message_text: string;
  media_url: string;
  media_type: string;
  message_type: string;
}) {
  const {
    supabase, zapsignToken, normalizedPhone, instance_name,
    message_text, media_url, media_type, message_type,
  } = opts;

  // Find active session
  const { data: sessionRaw } = await supabase
    .from("wjia_collection_sessions").select("*")
    .eq("phone", normalizedPhone).eq("instance_name", instance_name)
    .in("status", ["collecting", "collecting_docs", "processing_docs", "ready", "generated"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!sessionRaw) {
    return jsonResponse({ active_session: false });
  }

  let session = sessionRaw;

  // Recovery: unstick processing_docs > 3 min
  if (session.status === "processing_docs") {
    const stuckMin = (Date.now() - new Date(session.updated_at || session.created_at).getTime()) / 60000;
    if (stuckMin > 3) {
      await supabase.from("wjia_collection_sessions").update({
        status: "collecting_docs", updated_at: new Date().toISOString(),
      }).eq("id", session.id);
      const { data: refreshed } = await supabase.from("wjia_collection_sessions")
        .select("*").eq("id", session.id).single();
      if (refreshed) session = refreshed;
    }
  }

  // Load agent config for persona and delay
  let agentPersona = "";
  let batchDelaySeconds = 0;
  let shortcutPromptInstructions = "";

  const { data: convAgent } = await supabase
    .from("whatsapp_conversation_agents")
    .select("agent_id")
    .eq("phone", normalizedPhone)
    .eq("instance_name", instance_name)
    .eq("is_active", true)
    .maybeSingle();

  const agentId = convAgent?.agent_id || (session as any).agent_id;

  if (agentId) {
    const { data: agent } = await supabase.from("whatsapp_ai_agents")
      .select("name, base_prompt, response_delay_seconds")
      .eq("id", agentId).maybeSingle();
    if (agent) {
      agentPersona = `\nPERSONA: ${agent.name}\n${agent.base_prompt || ""}\n`;
      batchDelaySeconds = (agent as any).response_delay_seconds || 0;
    }
  }

  // ── MESSAGE BATCHING DELAY ──
  if (batchDelaySeconds > 0) {
    console.log(`WJIA batching delay: waiting ${batchDelaySeconds}s for more messages from ${normalizedPhone}`);
    await new Promise((resolve) => setTimeout(resolve, batchDelaySeconds * 1000));

    const cutoffTime = new Date(Date.now() - batchDelaySeconds * 1000).toISOString();
    const { data: newerMessages } = await supabase
      .from("whatsapp_messages")
      .select("id, created_at")
      .eq("phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .eq("direction", "inbound")
      .gt("created_at", cutoffTime)
      .order("created_at", { ascending: false })
      .limit(1);

    if (newerMessages && newerMessages.length > 0) {
      const newestMsgTime = new Date(newerMessages[0].created_at).getTime();
      const freshThresholdMs = batchDelaySeconds * 800;
      if (Date.now() - newestMsgTime < freshThresholdMs) {
        console.log(`WJIA batching: newer message detected, skipping this invocation`);
        return jsonResponse({ skipped: true, reason: "Batching: newer message will handle" });
      }
    }
    console.log(`WJIA batching delay complete for ${normalizedPhone}`);
  }

  // Load shortcut settings
  let splitOpts: { splitMessages?: boolean; splitDelaySeconds?: number } | undefined;
  let skipConfirmation = false;
  let partialMinFieldsReply: string[] = [];
  let zapsignSettingsReply: any = null;
  let zapsignModeReply: string = "final_document";
  if (session.shortcut_name) {
    const { data: scSplit } = await supabase.from("wjia_command_shortcuts")
      .select("split_messages, split_delay_seconds, skip_confirmation, partial_min_fields, zapsign_settings, zapsign_mode, prompt_instructions, reply_with_audio, reply_voice_id")
      .eq("shortcut_name", session.shortcut_name).maybeSingle();
    if (scSplit?.split_messages) {
      splitOpts = { splitMessages: true, splitDelaySeconds: scSplit.split_delay_seconds || 3 };
    }
    if (scSplit && typeof scSplit.skip_confirmation === "boolean") {
      skipConfirmation = scSplit.skip_confirmation;
    }
    partialMinFieldsReply = (scSplit as any)?.partial_min_fields || [];
    zapsignSettingsReply = (scSplit as any)?.zapsign_settings || null;
    zapsignModeReply = (scSplit as any)?.zapsign_mode || "final_document";
    shortcutPromptInstructions = scSplit?.prompt_instructions || "";
  }

  const { data: inst } = await supabase.from("whatsapp_instances")
    .select("instance_token, base_url, owner_name").eq("instance_name", instance_name).maybeSingle();
  const catalog = buildTemplateFieldCatalog(session);
  const collectedData = session.collected_data || { fields: [] };
  const currentFields = [...(collectedData.fields || [])];

  console.log("Session:", session.id, "status:", session.status);

  // ── GENERATED SESSION ──
  if (session.status === "generated") {
    if (session.sign_url) {
      const resendMsg = `📝 Aqui está o link para assinatura do documento *${session.template_name}*:\n\n👉 ${session.sign_url}\n\nÉ só clicar e seguir as instruções! 🙏`;
      await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
        resendMsg, session.contact_id, session.lead_id, "wjia_resend_link", splitOpts);
      return jsonResponse({ active_session: true, processed: true, resent_link: true, session_id: session.id });
    }
    return jsonResponse({ active_session: true, processed: true, session_id: session.id });
  }

  // ── DOCUMENT UPLOAD HANDLING ──
  if (session.status === "collecting_docs" || session.status === "processing_docs") {
    const receivedDocs = Array.isArray(session.received_documents) ? [...session.received_documents] : [];
    const requestedTypes: string[] = Array.isArray(session.document_types) ? session.document_types : [];
    const isMedia = media_url && (message_type === "image" || message_type === "document");

    const msgLower = (message_text || "").toLowerCase().trim();
    const isSkip = !isMedia && (msgLower === "pular" || msgLower === "skip" ||
      msgLower.includes("não tenho") || msgLower.includes("nao tenho"));

    if (isSkip) {
      return await handleDocSkip({
        supabase, session, inst, normalizedPhone, instance_name,
        receivedDocs, currentFields, collectedData, catalog,
        splitOpts, zapsignSettingsReply,
      });
    } else if (isMedia) {
      return await handleDocumentUpload({
        supabase, session, inst, normalizedPhone, instance_name,
        media_url, receivedDocs, requestedTypes, currentFields,
        collectedData, catalog, splitOpts, zapsignSettings: zapsignSettingsReply,
      });
    } else if (session.status !== "collecting" && session.status !== "ready") {
      return await handleTextDuringDocCollection({
        supabase, session, inst, normalizedPhone, instance_name,
        message_text, receivedDocs, requestedTypes, splitOpts,
      });
    }
  }

  // Load shortcut audio config
  let replyWithAudio = false;
  let replyVoiceId = "";
  if (session.shortcut_name) {
    const { data: scAudio } = await supabase.from("wjia_command_shortcuts")
      .select("reply_with_audio, reply_voice_id")
      .eq("shortcut_name", session.shortcut_name).maybeSingle();
    replyWithAudio = scAudio?.reply_with_audio === true;
    replyVoiceId = scAudio?.reply_voice_id || "";
  }

  // ── UNIFIED AGENT PHASE ──
  return await runAgentPhase({
    supabase, session, inst, normalizedPhone, instance_name,
    message_text, currentFields, collectedData, catalog,
    agentPersona, shortcutPromptInstructions, splitOpts, skipConfirmation,
    zapsignSettingsReply, zapsignToken, replyWithAudio, replyVoiceId,
    message_type,
  });
}

// ── Handle "pular" during doc collection ──
async function handleDocSkip(opts: {
  supabase: any; session: any; inst: any;
  normalizedPhone: string; instance_name: string;
  receivedDocs: any[]; currentFields: any[];
  collectedData: any; catalog: any;
  splitOpts: any; zapsignSettingsReply: any;
}) {
  const { supabase, session, inst, normalizedPhone, instance_name,
    receivedDocs, currentFields, collectedData, catalog,
    splitOpts, zapsignSettingsReply } = opts;

  let customPrompt: string | null = null;
  if (session.shortcut_name) {
    const { data: sc } = await supabase.from("wjia_command_shortcuts")
      .select("media_extraction_prompt").eq("shortcut_name", session.shortcut_name).maybeSingle();
    customPrompt = sc?.media_extraction_prompt || null;
  }

  const docUrls = receivedDocs.map((d: any) => d.media_url).filter(Boolean);
  const { extractedFields, signerName } = await extractFromDocuments(
    docUrls, catalog, currentFields, customPrompt,
    receivedDocs.map((d: any) => d.type),
  );

  for (const f of extractedFields) upsertCollectedField(currentFields, f.variable, f.value);
  if (signerName) collectedData.signer_name = signerName;
  syncNameFields(currentFields);
  applyDefaults(currentFields);
  applyConfiguredPredefinedFields(currentFields, catalog, zapsignSettingsReply, { phone: normalizedPhone });
  autoFillDates(currentFields, catalog);
  autoSyncCityState(currentFields, catalog);

  const missing = computeMissingFields(catalog, currentFields);

  await supabase.from("wjia_collection_sessions").update({
    collected_data: { ...collectedData, fields: currentFields },
    received_documents: receivedDocs,
    missing_fields: missing,
    status: missing.length > 0 ? "collecting" : "ready",
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  session.status = missing.length > 0 ? "collecting" : "ready";
  session.collected_data = { ...collectedData, fields: currentFields };
  session.missing_fields = missing;
  session.received_documents = receivedDocs;

  // Fall through handled by caller
  return jsonResponse({ active_session: true, processed: true, session_id: session.id, fell_through: true });
}

// ── Handle text messages during doc collection ──
async function handleTextDuringDocCollection(opts: {
  supabase: any; session: any; inst: any;
  normalizedPhone: string; instance_name: string;
  message_text: string; receivedDocs: any[];
  requestedTypes: string[]; splitOpts: any;
}) {
  const { supabase, session, inst, normalizedPhone, instance_name,
    message_text, receivedDocs, requestedTypes, splitOpts } = opts;

  let sessionDocModes: Record<string, string> = {};
  if (session.shortcut_name) {
    const { data: sc } = await supabase.from("wjia_command_shortcuts")
      .select("document_type_modes").eq("shortcut_name", session.shortcut_name).maybeSingle();
    sessionDocModes = sc?.document_type_modes || {};
  }

  const pendingTypes = requestedTypes.filter((t) => !receivedDocs.some((d: any) => d.type === t));
  const pendingRequired = pendingTypes.filter((t) => (sessionDocModes[t] || "required") === "required");
  const pendingOptional = pendingTypes.filter((t) => sessionDocModes[t] === "optional");

  if (message_text && pendingRequired.length === 0 && pendingOptional.length > 0) {
    for (const optType of pendingOptional) {
      receivedDocs.push({ type: optType, media_url: null, via: "text", text_data: message_text });
    }
    await supabase.from("wjia_collection_sessions").update({
      received_documents: receivedDocs, status: "collecting", updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    session.status = "collecting";
    session.received_documents = receivedDocs;
    return jsonResponse({ active_session: true, processed: true, session_id: session.id, fell_through: true });
  } else if (message_text && pendingOptional.length > 0) {
    for (const optType of pendingOptional) {
      receivedDocs.push({ type: optType, media_url: null, via: "text", text_data: message_text });
    }
    await supabase.from("wjia_collection_sessions").update({
      received_documents: receivedDocs, updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
      `💬 Dados recebidos!\n\n📎 Ainda preciso que envie: *${pendingRequired.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")}*.\n\nSe não tiver, digite *pular*.`,
      session.contact_id, session.lead_id, "wjia_remind", splitOpts);
    return jsonResponse({ active_session: true, processed: true, session_id: session.id });
  } else {
    let reminderParts: string[] = [];
    if (pendingRequired.length > 0) reminderParts.push(`📎 Envie: *${pendingRequired.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")}*`);
    if (pendingOptional.length > 0) reminderParts.push(`💬 Ou informe por mensagem: *${pendingOptional.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")}*`);
    await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
      `${reminderParts.join("\n\n")}\n\nSe não tiver, digite *pular*.`,
      session.contact_id, session.lead_id, "wjia_remind", splitOpts);
    return jsonResponse({ active_session: true, processed: true, session_id: session.id });
  }
}

// ── Main AI Agent Phase ──
async function runAgentPhase(opts: {
  supabase: any; session: any; inst: any;
  normalizedPhone: string; instance_name: string;
  message_text: string; currentFields: any[];
  collectedData: any; catalog: any;
  agentPersona: string; shortcutPromptInstructions: string;
  splitOpts: any;
  skipConfirmation: boolean; zapsignSettingsReply: any;
  zapsignToken: string | undefined;
  replyWithAudio: boolean; replyVoiceId: string;
  message_type: string;
}) {
  const { supabase, session, inst, normalizedPhone, instance_name,
    message_text, currentFields, collectedData, catalog,
    agentPersona, shortcutPromptInstructions, splitOpts,
    skipConfirmation, zapsignSettingsReply, zapsignToken,
    replyWithAudio, replyVoiceId, message_type } = opts;

  // Pre-process auto-fills
  const autoFilledKeys = autoFillDates(currentFields, catalog);
  const syncedKeys = autoSyncCityState(currentFields, catalog);
  const predefinedKeys = applyConfiguredPredefinedFields(currentFields, catalog, zapsignSettingsReply, { phone: normalizedPhone });
  const allAutoKeys = new Set([...autoFilledKeys, ...syncedKeys, ...predefinedKeys]);

  collectedData.fields = currentFields;
  let missingFields = computeMissingFields(catalog, currentFields)
    .filter((f) => !allAutoKeys.has(normalizeFieldKey(f.field_name)));

  // CEP context
  let cepContext = "";
  const detectedCEP = extractCEPFromMessage(message_text || "");
  if (detectedCEP) {
    const cepData = await lookupCEP(detectedCEP);
    cepContext = cepData
      ? `\n📍 CEP ${detectedCEP}: Rua: ${cepData.logradouro}, Bairro: ${cepData.bairro}, Cidade: ${cepData.localidade}, UF: ${cepData.uf}. Apresente e peça confirmação + número/complemento.`
      : `\n📍 CEP ${detectedCEP} não encontrado. Peça o endereço manualmente.`;
  }
  const msgLower = (message_text || "").toLowerCase();
  if (!detectedCEP && (msgLower.includes("não sei o cep") || msgLower.includes("nao sei o cep") || msgLower.includes("nao tenho cep"))) {
    cepContext = `\n📍 Cliente NÃO sabe o CEP. CEP é OPCIONAL. Peça rua, número, bairro, cidade e estado. NÃO pergunte o CEP novamente.`;
  }

  // Reverse CEP lookup
  if (!detectedCEP && !cepContext) {
    const addressField = currentFields.find((f) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("RUA") || k.includes("LOGRADOURO") || k.includes("ENDERECOCOMPLETO")) && hasFieldValue(f.para);
    });
    const cityField = currentFields.find((f) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("CIDADE") || k.includes("MUNICIPIO")) && hasFieldValue(f.para);
    });
    const stateField = currentFields.find((f) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("ESTADO") || k === "UF") && hasFieldValue(f.para);
    });
    if (addressField && cityField && stateField) {
      const results = await reverseLookupCEP(stateField.para, cityField.para, addressField.para);
      if (results.length > 0) {
        cepContext = `\n📍 BUSCA REVERSA: ${results.map((r) => `CEP ${r.cep} - ${r.logradouro}, ${r.bairro}`).join(" | ")}`;
      }
    }
  }

  // Conversation context
  const sessionContextStart = session.created_at || session.updated_at;
  const { data: recentMsgs } = await supabase.from("whatsapp_messages")
    .select("direction, message_text, created_at")
    .eq("phone", normalizedPhone).eq("instance_name", instance_name)
    .gte("created_at", sessionContextStart)
    .order("created_at", { ascending: false }).limit(50);

  const conversationText = (recentMsgs || []).reverse().filter((m: any) => m.message_text)
    .map((m: any) => `[${m.direction === "outbound" ? "Agente" : "Cliente"}]: ${m.message_text}`).join("\n");

  const filledFields = currentFields.filter((f) => f.para).map((f) =>
    `- ${getFieldLabel(f, catalog)}: ${f.para}`).join("\n");
  const missingFieldsList = missingFields.map((f) =>
    `- ${f.friendly_name} (variável: ${f.field_name})`).join("\n");
  const allFieldsList = catalog.map((f: any) =>
    `- ${f.label} (variável: ${f.variable})`).join("\n");

  const receivedDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
  const docsInfo = receivedDocs.length > 0
    ? `\nDocumentos anexados: ${receivedDocs.map((d: any) => DOC_TYPE_LABELS[d.type] || d.type).join(", ")}` : "";

  const isReadyPhase = session.status === "ready" || missingFields.length === 0;
  const hasAgentPersona = !!agentPersona && agentPersona.trim().length > 10;
  const hasShortcutPrompt = !!shortcutPromptInstructions && shortcutPromptInstructions.trim().length > 10;
  const ownerName = inst?.owner_name || "";
  const ownerContext = ownerName ? `\nNOME DO DONO DA INSTÂNCIA (use como seu nome se as instruções disserem): ${ownerName}` : "";

  // Build identity block: shortcut prompt_instructions takes priority, then agent persona
  const identityBlock = hasShortcutPrompt
    ? `IDENTIDADE E COMPORTAMENTO (PRIORIDADE ABSOLUTA — você DEVE agir EXATAMENTE como descrito abaixo em TODAS as mensagens):
${ownerContext}

INSTRUÇÕES DO AGENTE:
${shortcutPromptInstructions}
${agentPersona ? `\nCONFIGURAÇÃO ADICIONAL:\n${agentPersona}` : ""}

Você está coletando dados para gerar o documento "${session.template_name}". Mantenha SEMPRE o tom, estilo e personalidade acima durante TODA a conversa de coleta.`
    : hasAgentPersona
    ? `IDENTIDADE E COMPORTAMENTO (PRIORIDADE ABSOLUTA — você DEVE agir EXATAMENTE como descrito abaixo em TODAS as mensagens):
${ownerContext}
${agentPersona}

Você está coletando dados para gerar o documento "${session.template_name}". Mantenha SEMPRE o tom, estilo e personalidade acima durante TODA a conversa de coleta.`
    : `Você é um assistente jurídico conversando pelo WhatsApp. Seu OBJETIVO é coletar os dados necessários para gerar o documento "${session.template_name}" e obter a confirmação do cliente.`;

  const systemPrompt = `${identityBlock}

ESTILO DE CONVERSA:
- Use o tom da IDENTIDADE acima. Se não houver identidade definida, seja natural e direto.
- ✅/❌ para resumos. Conversa normal em frases corridas.
- Aceite o que o cliente diz. Se corrigir, atualize sem questionar.
- IMPORTANTE: Não seja robótico. Converse como a persona definiria. Integre os pedidos de dados naturalmente na conversa.

CAMPOS DO TEMPLATE:
${allFieldsList}

DADOS COLETADOS:
${filledFields || "(nenhum)"}

DADOS FALTANTES:
${missingFieldsList || "(todos coletados!)"}
${docsInfo}

FASE: ${isReadyPhase
    ? "CONFIRMAÇÃO — dados completos. Cliente pode confirmar (SIM) ou corrigir."
    : "COLETA — faltam dados."
  }

CONVERSA:
${conversationText}

MENSAGEM: "${message_text || "(vazia)"}"
${cepContext}

REGRAS (respeite a persona/identidade acima ao aplicar estas regras):
1. SIGA A IDENTIDADE/PERSONA ACIMA em tom e estilo. Se o prompt disser para pedir DOCUMENTO (foto/arquivo), peça o documento em vez de pedir os dados campo a campo.
2. Cliente CONFIRMANDO (sim, ok): ação "confirm_generate"
3. Cliente CORRIGINDO: extraia correção + se dados completos use "show_summary"
4. Faltam dados e a persona NÃO instruiu pedir documento: extraia o que puder, peça o restante naturalmente seguindo o tom da persona
5. CEP é OPCIONAL. NUNCA insista.
6. DATA_ASSINATURA/DATA_PROCURACAO: preenchidos automaticamente — NÃO pergunte
7. CIDADE/ESTADO de assinatura: sincronizados automaticamente
8. Nome parcial = confirmação se já existe nome completo
9. Use nomes EXATOS dos campos do template
10. Aceite bairros/locais sem questionar
11. ENDERECO_COMPLETO: rua + número + bairro
12. NUNCA INVENTE LINKS OU URLs. O sistema envia o link real automaticamente após gerar o documento.
13. Quando o cliente confirmar (SIM/ok/certo), NÃO mencione link. Diga apenas algo como que vai preparar/gerar o documento, no estilo da persona.
14. NUNCA diga que é assistente virtual, IA ou robô. NUNCA diga que não consegue visualizar, ler ou processar documentos, imagens ou PDFs.`;

  const tools = [{
    type: "function",
    function: {
      name: "process_message",
      description: "Processa a mensagem do cliente",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["collect_data", "show_summary", "confirm_generate"] },
          newly_extracted: {
            type: "array",
            items: {
              type: "object",
              properties: { de: { type: "string" }, para: { type: "string" } },
              required: ["de", "para"],
            },
          },
          reply_to_client: { type: "string" },
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
    return jsonResponse({ active_session: true, processed: false });
  }

  let result: any;
  try {
    result = JSON.parse(toolCall.function.arguments);
  } catch {
    return jsonResponse({ active_session: true, processed: false });
  }

  console.log("Agent result:", JSON.stringify(result));

  // Sanitize AI reply
  let invalidVisionReply = false;
  if (result.reply_to_client) {
    result.reply_to_client = result.reply_to_client
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/www\.\S+/gi, "")
      .replace(/[a-z0-9-]+\.(?:com|org|net|br|io|app|dev|link|me|co)[^\s]*/gi, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/:\s*\n/g, ".\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    invalidVisionReply = /assistente virtual|\bia\b|\brob[oô]\b|n[aã]o consigo visualizar|n[aã]o consigo ver|n[aã]o consigo ler|n[aã]o consigo processar.*(document|imagem|pdf)|documentos? ou imagens?/i
      .test(result.reply_to_client);

    if (invalidVisionReply) result.reply_to_client = "";

    const cleanText = result.reply_to_client.replace(/[^\w]/g, "");
    if (cleanText.length < 10) {
      if (result.action === "confirm_generate") {
        result.reply_to_client = "Perfeito! Vou gerar o documento agora. Em instantes você recebe o link para assinar. 📄";
      } else {
        result.reply_to_client = "";
      }
    }
  }

  for (const field of (result.newly_extracted || [])) {
    const normalized = normalizeIncomingField(field, catalog);
    if (!normalized) {
      console.log(`WJIA field rejected by normalizeIncomingField:`, JSON.stringify(field));
      continue;
    }
    if (shouldProtectName(currentFields, normalized)) continue;
    console.log(`WJIA field upserted: ${normalized.variable} = "${normalized.value}"`);
    upsertCollectedField(currentFields, normalized.variable, normalized.value);
  }

  syncNameFields(currentFields);
  applyDefaults(currentFields);
  applyConfiguredPredefinedFields(currentFields, catalog, zapsignSettingsReply, { phone: normalizedPhone });
  autoFillDates(currentFields, catalog);
  autoSyncCityState(currentFields, catalog);
  await autoFillFromCEP(currentFields, catalog);

  const finalMissing = computeMissingFields(catalog, currentFields);
  const allCollected = finalMissing.length === 0;
  const updatedCollectedData = { ...collectedData, fields: currentFields };

  if (invalidVisionReply) {
    const missingLabelList = finalMissing
      .map((f) => (f.friendly_name || f.field_name || "").toString().replace(/[{}]/g, "").trim())
      .filter(Boolean).slice(0, 6);

    if (allCollected) {
      result.action = "show_summary";
      result.reply_to_client = "Consegui organizar os dados do documento e vou te mostrar um resumo para confirmar antes de gerar.";
    } else {
      const joinedMissing = missingLabelList.length === 0
        ? "alguns dados finais"
        : missingLabelList.length === 1
        ? missingLabelList[0]
        : `${missingLabelList.slice(0, -1).join(", ")} e ${missingLabelList[missingLabelList.length - 1]}`;
      result.action = "collect_data";
      result.reply_to_client = receivedDocs.length > 0
        ? `Recebi seu documento e já aproveitei os dados que estavam visíveis. Agora só preciso de ${joinedMissing} para concluir.`
        : `Agora só preciso de ${joinedMissing} para concluir.`;
    }
  }

  // ── CONFIRM GENERATE ──
  if (result.action === "confirm_generate" && zapsignToken) {
    if (!allCollected) {
      console.log(`WJIA confirm_generate with missing fields (proceeding anyway - ZapSign editable):`, JSON.stringify(finalMissing));
    }
    await supabase.from("wjia_collection_sessions").update({
      collected_data: updatedCollectedData, missing_fields: finalMissing,
      status: "ready", updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    session.received_documents = receivedDocs;
    const nomeFieldConfirm = currentFields.find((f: any) => /NOME.?COMPLETO/i.test(f.de));
    const signerName = nomeFieldConfirm?.para?.trim() || collectedData.signer_name || "Cliente";
    const signerPhone = collectedData.signer_phone || normalizedPhone;
    const docData = await generateZapSignDocument(
      supabase, session, currentFields, signerName, signerPhone,
      normalizedPhone, instance_name, inst, zapsignToken,
    );

    return jsonResponse({
      active_session: true, processed: true, confirmed: true,
      generated: !!docData, session_id: session.id,
    });
  }

  // ── ALL COLLECTED ──
  if (allCollected) {
    if (skipConfirmation && zapsignToken) {
      console.log(`WJIA skip_confirmation: all fields collected, auto-generating document`);
      await supabase.from("wjia_collection_sessions").update({
        collected_data: updatedCollectedData, missing_fields: [],
        status: "ready", updated_at: new Date().toISOString(),
      }).eq("id", session.id);

      const summaryLines = currentFields.filter((f) => f.para).map((f) =>
        `• *${getFieldLabel(f, catalog)}*: ${f.para}`).join("\n");
      const confirmMsg = `✅ *Dados completos!*\n\n${summaryLines}\n\n📄 Gerando o documento *${session.template_name}*... Aguarde!`;
      await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
        confirmMsg, session.contact_id, session.lead_id, "wjia_autoconfirm", splitOpts);

      session.received_documents = receivedDocs;
      const nomeFieldAuto = currentFields.find((f: any) => /NOME.?COMPLETO/i.test(f.de));
      const signerName = nomeFieldAuto?.para?.trim() || collectedData.signer_name || "Cliente";
      const signerPhone = collectedData.signer_phone || normalizedPhone;
      const docData = await generateZapSignDocument(
        supabase, session, currentFields, signerName, signerPhone,
        normalizedPhone, instance_name, inst, zapsignToken,
      );

      return jsonResponse({
        active_session: true, processed: true, confirmed: true,
        generated: !!docData, session_id: session.id, auto_confirmed: true,
      });
    }

    // Show summary for manual confirmation
    const summaryLines = currentFields.filter((f) => f.para).map((f) =>
      `• *${getFieldLabel(f, catalog)}*: ${f.para}`).join("\n");
    const docsSection = receivedDocs.length > 0
      ? `\n\n📎 *Documentos anexados:*\n${receivedDocs.map((d: any) => `• ✅ ${DOC_TYPE_LABELS[d.type] || d.type}`).join("\n")}` : "";

    let replyMsg = result.reply_to_client;
    if (result.action === "show_summary" || session.status !== "ready") {
      replyMsg = `Confira as informações antes de gerar o documento *${session.template_name}*:\n\n${summaryLines}${docsSection}\n\n📋 Está tudo correto? Responda *SIM* para gerar ou me diga o que corrigir.`;
    }

    await supabase.from("wjia_collection_sessions").update({
      collected_data: updatedCollectedData, missing_fields: [],
      status: "ready", updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
      replyMsg, session.contact_id, session.lead_id, "wjia_summary", splitOpts);

    return jsonResponse({
      active_session: true, processed: true, all_collected: true, session_id: session.id,
    });
  }

  // ── STILL COLLECTING ──
  await supabase.from("wjia_collection_sessions").update({
    collected_data: updatedCollectedData, missing_fields: finalMissing,
    status: "collecting", updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  if (result.reply_to_client) {
    // Send as audio if shortcut has reply_with_audio AND contact sent audio
    const shouldReplyAudio = replyWithAudio && message_type === "audio" && replyVoiceId;
    if (shouldReplyAudio) {
      const resolvedVoice = await resolveVoiceId(supabase, replyVoiceId, instance_name);
      await sendWhatsAppAudio(supabase, inst, normalizedPhone, instance_name,
        result.reply_to_client, resolvedVoice, session.contact_id, session.lead_id, "wjia_collect");
    } else {
      await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
        result.reply_to_client, session.contact_id, session.lead_id, "wjia_collect", splitOpts);
    }
  }

  return jsonResponse({
    active_session: true, processed: true, all_collected: false, session_id: session.id,
  });
}
