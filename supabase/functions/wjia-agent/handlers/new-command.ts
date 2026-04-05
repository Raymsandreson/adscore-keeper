/**
 * Handler: New Command (MODE 1)
 * Processes #shortcut commands — analyzes intent, picks template,
 * creates collection session or generates document immediately.
 */

import { geminiChat } from "../../_shared/gemini.ts";
import {
  applyConfiguredPredefinedFields,
  applyDefaults,
  applyZapSignSettings,
  autoFillDates,
  autoSyncCityState,
  buildCrmContext,
  buildTemplateFieldCatalog,
  computeMissingFields,
  DOC_TYPE_LABELS,
  extractFromDocuments,
  filterFieldsAgainstTemplate,
  filterOnlyAutoFilledData,
  generateZapSignDocument,
  sendWhatsApp,
  syncNameFields,
  updateSignerSettings,
  upsertCollectedField,
  ZAPSIGN_API_URL,
} from "../../_shared/wjia-utils.ts";
import { corsHeaders, errorResponse, jsonResponse } from "./shared.ts";

export async function handleNewCommand(opts: {
  supabase: any;
  zapsignToken: string | undefined;
  normalizedPhone: string;
  phone: string;
  instance_name: string;
  command: string;
  contact_id: string;
  lead_id: string;
  reset_memory: boolean;
}) {
  const {
    supabase, zapsignToken, normalizedPhone, instance_name,
    command, contact_id, lead_id, reset_memory,
  } = opts;

  // Load context in parallel
  const messagesQueryPromise = reset_memory
    ? Promise.resolve({ data: [] as any[] })
    : (() => {
      let query = supabase
        .from("whatsapp_messages")
        .select("direction, message_text, message_type, media_url, media_type, created_at")
        .eq("phone", normalizedPhone);
      if (instance_name) query = query.eq("instance_name", instance_name);
      return query.order("created_at", { ascending: false }).limit(200);
    })();

  const [messagesRes, contactRes, leadRes, templatesRes, instanceRes, shortcutsRes] =
    await Promise.all([
      messagesQueryPromise,
      contact_id
        ? supabase.from("contacts").select("*").eq("id", contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
      lead_id
        ? supabase.from("leads").select("*").eq("id", lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
      zapsignToken
        ? fetch(`${ZAPSIGN_API_URL}/templates/`, {
          headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
        }).then((r) => r.ok ? r.json() : []).catch(() => [])
        : Promise.resolve([]),
      instance_name
        ? supabase.from("whatsapp_instances").select("instance_token, base_url, owner_name")
          .eq("instance_name", instance_name).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("wjia_command_shortcuts").select("*").eq("is_active", true)
        .order("display_order"),
    ]);

  let messages = (messagesRes.data || []).reverse();
  const contactData = contactRes.data || {};
  const leadData = leadRes.data || {};
  const shortcuts = (shortcutsRes.data || []) as any[];

  const templates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.results || []);
  const templateList = templates.map((t: any, i: number) =>
    `${i + 1}. "${t.name}" (token: ${t.token})`
  ).join("\n");

  // Match shortcut
  const hashMatch = command.match(/#(\S+)/i);
  const commandLower = hashMatch
    ? hashMatch[1].toLowerCase()
    : command.replace(/^@wjia\s*/i, "").trim().toLowerCase();
  const matchedShortcut = shortcuts.find((s: any) =>
    s.shortcut_name.toLowerCase() === commandLower
  );

  const forceTemplate = matchedShortcut?.template_token || null;
  const forceTemplateName = matchedShortcut?.template_name || null;
  const shortcutInstructions = matchedShortcut?.prompt_instructions || "";
  const notifyOnSignature = matchedShortcut?.notify_on_signature !== false;
  const sendSignedPdf = matchedShortcut?.send_signed_pdf !== false;
  const requestDocuments = matchedShortcut?.request_documents || false;
  const documentTypes = matchedShortcut?.document_types || [];
  const customDocumentNames: string[] = matchedShortcut?.custom_document_names || [];
  const documentTypeModes: Record<string, string> = matchedShortcut?.document_type_modes || {};
  const assistantType = matchedShortcut?.assistant_type || "document";
  const shortcutModel = matchedShortcut?.model || "google/gemini-2.5-flash";
  const shortcutTemperature = matchedShortcut?.temperature ?? 0.1;
  const shortcutBasePrompt = matchedShortcut?.base_prompt || "";
  const zapsignSettings = matchedShortcut?.zapsign_settings || null;
  const zapsignMode: string = matchedShortcut?.zapsign_mode || "final_document";
  let skipConfirmation = matchedShortcut?.skip_confirmation === true;
  const partialMinFields: string[] = matchedShortcut?.partial_min_fields || [];
  const historyLimit: number = matchedShortcut?.history_limit ?? 50;
  const initialSplitOpts = matchedShortcut?.split_messages
    ? { splitMessages: true, splitDelaySeconds: matchedShortcut?.split_delay_seconds || 3 }
    : undefined;

  // Apply history_limit
  if (historyLimit === 0) {
    messages.length = 0;
  } else if (messages.length > historyLimit) {
    const sliced = messages.slice(messages.length - historyLimit);
    messages.length = 0;
    messages.push(...sliced);
  }

  // HARD RESET: Cut history at last completion marker or previous # command
  const COMPLETION_MARKERS = ["🔗", "✅ Documento", "Conversa limpa"];
  const COMMAND_PATTERN = /^#\S+/;
  let hardResetIdx = -1;
  let hasTrustedBoundary = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const txt = messages[i]?.message_text || "";
    if (i === messages.length - 1) continue;
    const isCompletionMarker = messages[i].direction === "outbound" &&
      COMPLETION_MARKERS.some((marker) => txt.includes(marker));
    const isPreviousCommand = messages[i].direction === "outbound" &&
      COMMAND_PATTERN.test(txt.trim());
    if (isCompletionMarker || isPreviousCommand) {
      hardResetIdx = i;
      hasTrustedBoundary = true;
      break;
    }
  }
  if (hardResetIdx >= 0) {
    const afterReset = messages.slice(hardResetIdx + 1);
    messages.length = 0;
    messages.push(...afterReset);
    console.log(`WJIA Hard Reset: cut at index ${hardResetIdx}, kept ${messages.length} messages after marker`);
  } else if (messages.length > 0) {
    messages = [];
    console.log("WJIA Hard Reset: no trusted boundary found, ignoring pre-command history");
  }

  const allowCrmPrefill = hasTrustedBoundary && messages.length > 0;
  console.log(`WJIA command context: trusted_boundary=${hasTrustedBoundary}, kept_messages=${messages.length}, crm_prefill=${allowCrmPrefill}`);
  const crmContext = allowCrmPrefill
    ? buildCrmContext(contactData, leadData, normalizedPhone)
    : "CRM/CADASTRO: ignore nesta etapa inicial. Para este comando, use apenas dados enviados após o marco mais recente da conversa.";

  let conversationText = messages
    .filter((m: any) => m.message_text)
    .map((m: any) => `[${m.direction === "outbound" ? "Atendente" : "Cliente"}]: ${m.message_text}`)
    .join("\n");

  // ── ASSISTANT MODE ──
  if (assistantType === "assistant") {
    const basePromptSection = shortcutBasePrompt ? `\nPERSONA/REGRAS BASE DO ASSISTENTE:\n${shortcutBasePrompt}\n` : "";
    const systemPrompt = `Você é o assistente WJIA, integrado ao WhatsApp de um escritório de advocacia.
${basePromptSection}
MODO: Assistente conversacional. Responda ao comando do atendente usando o contexto disponível.

${crmContext}

CONVERSA COM O CLIENTE (últimas mensagens):
${conversationText || "(sem mensagens)"}

${shortcutInstructions ? `INSTRUÇÕES ESPECÍFICAS:\n${shortcutInstructions}\n` : ""}`;

    const aiResult = await geminiChat({
      model: shortcutModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Comando: ${command}` },
      ],
      temperature: shortcutTemperature,
    });

    return jsonResponse({
      success: true,
      action: "assistant_response",
      message: aiResult.choices?.[0]?.message?.content || "Sem resposta.",
    });
  }

  // ── DOCUMENT MODE ──
  const basePromptSection = shortcutBasePrompt ? `\nPERSONA/REGRAS BASE:\n${shortcutBasePrompt}\n` : "";
  const systemPrompt = `Você é o assistente WJIA. O atendente digitou um comando.
${basePromptSection}
IMPORTANTE: NÃO gere o documento agora. Seu trabalho é:
1. Identificar qual template ZapSign usar
  2. Analisar apenas os dados confiáveis disponíveis para ESTE comando
3. Identificar quais campos obrigatórios estão FALTANDO
4. Em caso de conflito entre CRM antigo e a conversa atual do cliente, a conversa atual tem prioridade

${forceTemplate ? `⚠️ TEMPLATE OBRIGATÓRIO: Use EXATAMENTE "${forceTemplateName}" (token: ${forceTemplate}).` : ""}

TEMPLATES ZAPSIGN DISPONÍVEIS:
${templateList || "(nenhum template)"}

 ${crmContext}

PRIORIDADE DAS FONTES:
 - 1º: dados informados pelo cliente após o marco mais recente da conversa
 - 2º: mensagens recentes do mesmo contexto já filtradas
 - 3º: CRM/cadastro só pode ser usado se estiver explicitamente presente no contexto acima
 - Se houver dúvida sobre a origem, considere como faltante e peça confirmação

CONVERSA COM O CLIENTE:
${conversationText || "(sem mensagens)"}

${shortcutInstructions ? `INSTRUÇÕES ESPECÍFICAS:\n${shortcutInstructions}\n` : ""}
REGRAS:
- NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- WHATSAPP escritório: "(86)99447-3226"
- EMAIL escritório: "contato@prudencioadv.com"
- Datas: DD/MM/AAAA
- Campos DATA_ASSINATURA/DATA_PROCURACAO: preencha com hoje (${new Date().toLocaleDateString("pt-BR")})
- Use SOMENTE campos que existem no template ZapSign`;

  const tools = [{
    type: "function",
    function: {
      name: "analyze_wjia_command",
      description: "Analisa o comando, escolhe template e identifica dados disponíveis vs faltantes",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["generate_document", "unknown"] },
          template_token: { type: "string" },
          template_name: { type: "string" },
          signer_name: { type: "string" },
          signer_phone: { type: "string" },
          extracted_fields: {
            type: "array",
            items: {
              type: "object",
              properties: { de: { type: "string" }, para: { type: "string" } },
              required: ["de", "para"],
            },
          },
          missing_fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_name: { type: "string" },
                friendly_name: { type: "string" },
              },
              required: ["field_name", "friendly_name"],
            },
          },
          all_data_available: { type: "boolean" },
          collection_message: { type: "string" },
          message_to_attendant: { type: "string" },
        },
        required: ["action", "message_to_attendant", "all_data_available"],
      },
    },
  }];

  const aiResult = await geminiChat({
    model: shortcutModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Comando: ${command}` },
    ],
    tools,
    tool_choice: { type: "function", function: { name: "analyze_wjia_command" } },
    temperature: shortcutTemperature,
  });

  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    const fallbackText = aiResult.choices?.[0]?.message?.content;
    if (fallbackText) {
      return jsonResponse({ success: true, action: "assistant_response", message: fallbackText });
    }
    return errorResponse("Não foi possível processar o comando.");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return errorResponse("Erro ao processar resposta da IA.");
  }

  console.log("WJIA analysis:", JSON.stringify(parsed));

  // Force shortcut template
  if (forceTemplate) {
    parsed.template_token = forceTemplate;
    parsed.template_name = forceTemplateName || parsed.template_name;
    if (parsed.action !== "generate_document") parsed.action = "generate_document";
  }

  if (parsed.action !== "generate_document" || !parsed.template_token || !zapsignToken) {
    return jsonResponse({
      success: true,
      action: parsed.action || "info",
      message: parsed.message_to_attendant || "Comando processado.",
    });
  }

  // Get template fields
  const templateRes = await fetch(
    `${ZAPSIGN_API_URL}/templates/${parsed.template_token}/`,
    { headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" } },
  );

  let templateFields: any[] = [];
  if (templateRes.ok) {
    const templateDetail = await templateRes.json();
    templateFields = (templateDetail.inputs || []).map((input: any) => ({
      variable: input.variable || "",
      label: input.label || "",
      required: input.required || false,
    }));
  }

  // Post-AI enforcement
  filterFieldsAgainstTemplate(parsed, templateFields);

  const fieldsData = parsed.extracted_fields || [];
  const missingFields = parsed.missing_fields || [];
  const trustedCrmSignerName = allowCrmPrefill ? (contactData.full_name || leadData.victim_name || "") : "";
  const trustedCrmSignerPhone = allowCrmPrefill ? (contactData.phone || "") : "";
  // Extract signer name from NOME COMPLETO field if AI didn't return it explicitly
  const nomeCompletoField = fieldsData.find((f: any) => /NOME.?COMPLETO/i.test(f.de));
  let signerName = parsed.signer_name || nomeCompletoField?.para?.trim() || trustedCrmSignerName || "Cliente";
  const signerPhone = parsed.signer_phone || trustedCrmSignerPhone || normalizedPhone;

  applyDefaults(fieldsData);

  const hasMissing = missingFields.length > 0 && !parsed.all_data_available;

  if (hasMissing) {
    return await handleCollectionSession({
      supabase, normalizedPhone, instance_name, contact_id, lead_id,
      command, parsed, fieldsData, missingFields, signerName, signerPhone,
      templateFields, messages, contactData, leadData, allowCrmPrefill,
      notifyOnSignature, sendSignedPdf, requestDocuments, documentTypes,
      customDocumentNames, documentTypeModes, matchedShortcut, zapsignSettings,
      skipConfirmation, partialMinFields, instanceRes, initialSplitOpts,
      zapsignToken: zapsignToken!,
    });
  }

  // All data available → generate immediately
  return await generateImmediate({
    supabase, normalizedPhone, instance_name, contact_id, lead_id,
    parsed, fieldsData, signerName, signerPhone, templateFields,
    zapsignSettings, skipConfirmation, partialMinFields, instanceRes,
    leadData, zapsignToken: zapsignToken!, hasMissing,
    notifyOnSignature, sendSignedPdf, matchedShortcut,
  });
}

// ── Sub-handler: Create collection session and handle auto-extraction ──
async function handleCollectionSession(opts: {
  supabase: any; normalizedPhone: string; instance_name: string;
  contact_id: string; lead_id: string; command: string;
  parsed: any; fieldsData: any[]; missingFields: any[];
  signerName: string; signerPhone: string; templateFields: any[];
  messages: any[]; contactData: any; leadData: any; allowCrmPrefill: boolean;
  notifyOnSignature: boolean; sendSignedPdf: boolean;
  requestDocuments: boolean; documentTypes: string[];
  customDocumentNames: string[]; documentTypeModes: Record<string, string>;
  matchedShortcut: any; zapsignSettings: any;
  skipConfirmation: boolean; partialMinFields: string[];
  instanceRes: any; initialSplitOpts: any; zapsignToken: string;
}) {
  const {
    supabase, normalizedPhone, instance_name, contact_id, lead_id,
    command, parsed, fieldsData, missingFields, signerName, signerPhone,
    templateFields, messages, contactData, leadData, allowCrmPrefill,
    notifyOnSignature, sendSignedPdf, requestDocuments, documentTypes,
    customDocumentNames, documentTypeModes, matchedShortcut, zapsignSettings,
    skipConfirmation, partialMinFields, instanceRes, initialSplitOpts, zapsignToken,
  } = opts;

  const startWithDocs = requestDocuments && Array.isArray(documentTypes) && documentTypes.length > 0;
  const initialStatus = startWithDocs ? "collecting_docs" : "collecting";

  const { data: session, error: sessionErr } = await supabase
    .from("wjia_collection_sessions")
    .insert({
      phone: normalizedPhone,
      instance_name,
      contact_id: contact_id || null,
      lead_id: lead_id || null,
      template_token: parsed.template_token,
      template_name: parsed.template_name || "Documento",
      required_fields: templateFields,
      collected_data: { fields: fieldsData, signer_name: signerName, signer_phone: signerPhone },
      missing_fields: missingFields,
      status: initialStatus,
      triggered_by: command,
      notify_on_signature: notifyOnSignature,
      send_signed_pdf: sendSignedPdf,
      request_documents: requestDocuments,
      document_types: documentTypes,
      shortcut_name: matchedShortcut?.shortcut_name || null,
    })
    .select().single();

  if (sessionErr) {
    console.error("Session creation error:", sessionErr);
    return errorResponse("Erro ao iniciar sessão de coleta.");
  }

  const inst = instanceRes.data;

  // Auto-extraction from history (text + media + CRM)
  {
    const catalog = buildTemplateFieldCatalog({ required_fields: templateFields, missing_fields: missingFields });
    let customPrompt: string | null = matchedShortcut?.media_extraction_prompt || null;

    // Build CRM data string
    const crmDataForExtraction: string[] = [];
    if (allowCrmPrefill) {
      if (contactData.full_name) crmDataForExtraction.push(`Nome completo: ${contactData.full_name}`);
      if (contactData.cpf) crmDataForExtraction.push(`CPF: ${contactData.cpf}`);
      if (contactData.rg) crmDataForExtraction.push(`RG: ${contactData.rg}`);
      if (contactData.email) crmDataForExtraction.push(`E-mail: ${contactData.email}`);
      if (contactData.phone) crmDataForExtraction.push(`Telefone: ${contactData.phone}`);
      if (contactData.nationality) crmDataForExtraction.push(`Nacionalidade: ${contactData.nationality}`);
      if (contactData.marital_status) crmDataForExtraction.push(`Estado civil: ${contactData.marital_status}`);
      if (contactData.profession) crmDataForExtraction.push(`Profissão: ${contactData.profession}`);
      if (contactData.address_street) crmDataForExtraction.push(`Rua: ${contactData.address_street}`);
      if (contactData.address_number) crmDataForExtraction.push(`Número: ${contactData.address_number}`);
      if (contactData.address_complement) crmDataForExtraction.push(`Complemento: ${contactData.address_complement}`);
      if (contactData.address_neighborhood || contactData.neighborhood) crmDataForExtraction.push(`Bairro: ${contactData.address_neighborhood || contactData.neighborhood}`);
      if (contactData.city) crmDataForExtraction.push(`Cidade: ${contactData.city}`);
      if (contactData.state) crmDataForExtraction.push(`Estado: ${contactData.state}`);
      if (contactData.zip_code || contactData.cep) crmDataForExtraction.push(`CEP: ${contactData.zip_code || contactData.cep}`);
      if (contactData.birth_date) crmDataForExtraction.push(`Data de nascimento: ${contactData.birth_date}`);
      if (contactData.mother_name) crmDataForExtraction.push(`Nome da mãe: ${contactData.mother_name}`);
      if (leadData.victim_name && !contactData.full_name) crmDataForExtraction.push(`Nome: ${leadData.victim_name}`);
      if (leadData.victim_cpf && !contactData.cpf) crmDataForExtraction.push(`CPF: ${leadData.victim_cpf}`);
      if (leadData.lead_email && !contactData.email) crmDataForExtraction.push(`E-mail: ${leadData.lead_email}`);
    }

    // Step 1: Extract from TEXT/AUDIO + CRM
    const textMessages = messages.filter((m: any) => m.message_text?.trim());
    const hasCrmData = crmDataForExtraction.length > 0;

    if (textMessages.length > 0 || hasCrmData) {
      try {
        const historyText = textMessages.map((m: any) =>
          `[${m.direction === "inbound" ? "Cliente" : "Atendente"}]: ${m.message_text}`
        ).join("\n");

        const fieldsDetail = catalog.map((f: any) =>
          `- ${f.variable}: ${f.friendly_name || f.label || f.variable.replace(/[{}]/g, "")}`
        ).join("\n");

        const crmSection = hasCrmData
          ? `\nDADOS DO CRM/CADASTRO (prioridade alta):\n${crmDataForExtraction.join("\n")}\n`
          : "";

        const extractPrompt = `Você é um extrator de dados. Analise TODAS as fontes abaixo e extraia TODOS os dados que correspondem aos campos listados.

CAMPOS QUE PRECISO PREENCHER:
${fieldsDetail}
${crmSection}
${historyText ? `\nCONVERSA:\n${historyText}\n` : ""}
REGRAS DE EXTRAÇÃO:
1. Mapeie cada dado encontrado para o campo correto usando EXATAMENTE o nome da variável (com {{}}).
2. PRIORIZE os dados que o cliente informou na conversa atual e no histórico recente desta conversa.
3. Use CRM/cadastro apenas como fallback quando o dado não aparecer na conversa ou quando não houver conflito.
4. Se houver conflito entre CRM antigo e conversa atual, use SEMPRE a conversa atual.
5. Exemplos de mapeamento:
   - "Estado civil: Solteira" → {{ESTADO_CIVIL}} = "Solteira"
   - "CPF: 060.766.902-08" → {{CPF}} = "060.766.902-08"  
   - "Profissão: Jovem aprendiz" → {{PROFISSAO}} = "Jovem aprendiz"
   - "Nome da mãe: Maria" → {{NOME_MAE}} = "Maria" (se existir no template)
   - "Estado: Pará" → {{UF}} = "PA" (converta para sigla)
   - "RG: 8657920" → {{RG}} = "8657920"
   - Nome mencionado → {{NOME_COMPLETO}} = nome encontrado
6. Se tem CPF brasileiro, deduza {{NACIONALIDADE}} = "brasileiro(a)".
7. Extraia TUDO que encontrar, mesmo dados parciais.
8. Use a sigla do estado para {{UF}} (ex: PA, SP, RJ).
9. Tente mapear variantes do nome do campo (NOME, NOME_COMPLETO, NOME_CLIENTE são o mesmo).

Responda APENAS com JSON array válido:
[{"variable":"{{CAMPO}}","value":"valor"}]

Se não encontrou nada, retorne: []`;

        const extractResult = await geminiChat({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: extractPrompt }],
          temperature: 0.1,
        });
        const extractText = extractResult?.choices?.[0]?.message?.content || "";
        console.log(`WJIA text+CRM extraction AI response: ${extractText.substring(0, 500)}`);

        try {
          const jsonMatch = extractText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const extracted = JSON.parse(jsonMatch[0]);
            if (Array.isArray(extracted)) {
              for (const f of extracted) {
                if (f.variable && f.value) upsertCollectedField(fieldsData, f.variable, f.value);
              }
              console.log(`WJIA: Extracted ${extracted.length} fields from text+CRM`);
            }
          }
        } catch (jsonErr) {
          console.error("Error parsing text extraction result:", jsonErr);
        }
      } catch (textExtractErr) {
        console.error("Text/CRM extraction error:", textExtractErr);
      }
    }

    // Step 2: Check media in history
    const mediaMessages = messages.filter((m: any) =>
      m.direction === "inbound" && m.media_url &&
      (m.message_type === "image" || m.message_type === "document")
    );

    if (mediaMessages.length > 0) {
      console.log(`WJIA: Found ${mediaMessages.length} media messages in history, auto-extracting`);
      const mediaUrls = mediaMessages.map((m: any) => m.media_url).filter(Boolean);
      const docTypeGuesses = mediaMessages.map(() => "outros");

      try {
        const { extractedFields: autoExtracted, signerName: autoSigner } =
          await extractFromDocuments(mediaUrls, catalog, fieldsData, customPrompt, docTypeGuesses);
        for (const f of autoExtracted) upsertCollectedField(fieldsData, f.variable, f.value);
        if (autoSigner) opts.signerName = autoSigner;
      } catch (extractErr) {
        console.error("Auto-extract from history media error:", extractErr);
      }
    }

    // Step 3: Sync and compute what's still missing
    syncNameFields(fieldsData);
    applyDefaults(fieldsData);
    applyConfiguredPredefinedFields(fieldsData, catalog, zapsignSettings, { phone: normalizedPhone });
    autoFillDates(fieldsData, catalog);
    autoSyncCityState(fieldsData, catalog);

    const stillMissing = computeMissingFields(catalog, fieldsData);
    const filledCount = fieldsData.filter((f: any) => f.para).length;
    console.log(`WJIA auto-extract total: filled ${filledCount} fields, still missing ${stillMissing.length}`);

    // Update session
    const collectedData = { fields: fieldsData, signer_name: signerName, signer_phone: signerPhone };
    const receivedDocs = mediaMessages.map((m: any) => ({
      type: "outros", media_url: m.media_url, via: "history_auto",
    }));

    await supabase.from("wjia_collection_sessions").update({
      collected_data: { ...collectedData, fields: fieldsData },
      received_documents: receivedDocs.length > 0 ? receivedDocs : undefined,
      missing_fields: stillMissing,
      status: stillMissing.length > 0 ? "collecting" : "ready",
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    if (stillMissing.length === 0) {
      session.status = "ready";
    } else if (skipConfirmation && !(startWithDocs && stillMissing.length > 0)) {
      const minFieldsMissing = partialMinFields.filter((mf: string) => {
        const filled = fieldsData.find((f: any) => {
          const key = (f.de || "").replace(/[{}]/g, "");
          return key === mf && f.para;
        });
        return !filled;
      });

      if (minFieldsMissing.length > 0) {
        console.log(`WJIA skip_confirmation: min fields still missing: ${minFieldsMissing.join(", ")}`);
      } else {
        console.log(`WJIA skip_confirmation: min fields OK, ${stillMissing.length} fields missing, generating with partial data`);
        await supabase.from("wjia_collection_sessions").update({
          status: "ready", updated_at: new Date().toISOString(),
        }).eq("id", session.id);
        session.status = "ready";
      }
    } else if (filledCount > 0) {
      // Found some data but still missing — DON'T announce count to client
      // The initial message will be sent below via the prompt-based flow (line ~696)
    }

    // No data extracted
    if (session.status !== "ready" && filledCount === 0) {
      if (skipConfirmation && !startWithDocs && partialMinFields.length === 0) {
        console.log(`WJIA skip_confirmation: no data and no min fields required, generating empty doc`);
        await supabase.from("wjia_collection_sessions").update({
          status: "ready", updated_at: new Date().toISOString(),
        }).eq("id", session.id);
        session.status = "ready";
      } else if (startWithDocs) {
        const requiredDocs: string[] = documentTypes
          .filter((t: string) => t !== "outros")
          .filter((t: string) => (documentTypeModes[t] || "required") === "required")
          .map((t: string) => DOC_TYPE_LABELS[t] || t);
        const optionalDocs: string[] = documentTypes
          .filter((t: string) => t !== "outros")
          .filter((t: string) => documentTypeModes[t] === "optional")
          .map((t: string) => DOC_TYPE_LABELS[t] || t);
        if (documentTypes.includes("outros") && customDocumentNames.length > 0) {
          const outrosMode = documentTypeModes["outros"] || "required";
          if (outrosMode === "required") requiredDocs.push(...customDocumentNames.filter((n: string) => n.trim()));
          else optionalDocs.push(...customDocumentNames.filter((n: string) => n.trim()));
        } else if (documentTypes.includes("outros")) {
          const outrosMode = documentTypeModes["outros"] || "required";
          if (outrosMode === "required") requiredDocs.push("Outros documentos");
          else optionalDocs.push("Outros documentos");
        }

        if (requiredDocs.length === 0 && optionalDocs.length > 0) {
          const skipDocs = documentTypes.map((t: string) => ({ type: t, media_url: null, via: "skipped_optional" }));
          await supabase.from("wjia_collection_sessions").update({
            received_documents: skipDocs, status: "collecting", updated_at: new Date().toISOString(),
          }).eq("id", session.id);
          session.status = "collecting";

          const optMsg = `📝 Para preparar o documento *${parsed.template_name || "Documento"}*, vou precisar de alguns dados.\n\n💡 *Se tiver, pode enviar também:*\n• ${optionalDocs.join("\n• ")}\n\nMas não se preocupe, pode informar os dados por mensagem também! Vamos lá 🚀`;
          if (inst?.instance_token) {
            await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
              optMsg, contact_id, lead_id, "wjia_collect", initialSplitOpts);
          }
        } else {
          let docsFirstMsg = `📝 Para preparar o documento *${parsed.template_name || "Documento"}*, preciso de algumas informações:\n\n`;
          if (requiredDocs.length > 0) docsFirstMsg += `📎 *Envie obrigatoriamente:*\n• ${requiredDocs.join("\n• ")}\n\n`;
          if (optionalDocs.length > 0) docsFirstMsg += `💬 *Opcional (envie o documento OU informe os dados por mensagem):*\n• ${optionalDocs.join("\n• ")}\n\n`;
          docsFirstMsg += `📸 Envie a *foto ou arquivo* de cada documento. Vou extrair as informações automaticamente!\n\nSe não tiver algum agora, digite *pular*.`;

          if (inst?.instance_token) {
            await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
              docsFirstMsg, contact_id, lead_id, "wjia_docsfirst");
          }

          return jsonResponse({
            success: true, action: "collection_started",
            message: `🔄 *Coleta de documentos iniciada*\nDocumento: *${parsed.template_name}*\n📎 Pedindo documentos ao cliente.\n⚠️ Faltantes: ${missingFields.length}`,
            session_id: session.id, missing_count: missingFields.length, docs_first: true,
          });
        }
      }
    }
  }

  // Normal flow: generate initial message respecting the agent's prompt
  if (session.status !== "ready") {
    if (inst?.instance_token) {
      const filledCount = fieldsData.filter((f: any) => f.para).length;
      const stillMissing = computeMissingFields(
        buildTemplateFieldCatalog({ required_fields: templateFields, missing_fields: missingFields }),
        fieldsData,
      );

      // If the shortcut has prompt_instructions, use AI to generate a natural first message
      // that follows the agent's personality and flow instead of a robotic field list
      if (matchedShortcut?.prompt_instructions) {
        const FRIENDLY_LABELS: Record<string, string> = {
          "NOME_COMPLETO": "Nome completo", "NACIONALIDADE": "Nacionalidade",
          "ESTADO_CIVIL": "Estado civil", "PROFISSAO": "Profissão",
          "CPF": "CPF", "RG": "RG", "ENDERECO_COMPLETO": "Endereço completo",
          "CIDADE": "Cidade", "UF": "Estado (UF)", "CEP": "CEP",
          "DATA_NASCIMENTO": "Data de nascimento", "NOME_MAE": "Nome da mãe",
          "EMAIL": "E-mail", "TELEFONE": "Telefone", "WHATSAPP": "WhatsApp",
        };
        const missingLabels = stillMissing.map((f: any) => {
          const key = (f.friendly_name || f.field_name || "").replace(/[{}]/g, "");
          return FRIENDLY_LABELS[key] || f.friendly_name || key;
        });

        const ownerName = inst?.owner_name || "";
        const ownerContext = ownerName ? `\nNOME DO DONO DA INSTÂNCIA (use como seu nome se o prompt disser): ${ownerName}\n` : "";

        const firstMsgPrompt = `Você é um atendente de WhatsApp. Siga RIGOROSAMENTE as instruções abaixo para gerar a PRIMEIRA mensagem ao cliente.
${ownerContext}
INSTRUÇÕES DO AGENTE (PRIORIDADE MÁXIMA — siga o tom, personalidade e fluxo definidos aqui):
${matchedShortcut.prompt_instructions}

CONTEXTO INTERNO (NÃO mencione isso ao cliente):
- Campos já preenchidos automaticamente: ${filledCount} (o cliente NÃO sabe disso, NÃO mencione)
- Campos que ainda faltam coletar: ${missingLabels.join(", ")}

REGRAS:
1. Siga o fluxo e tom do prompt do agente acima. Se ele diz para se apresentar, qualificar, tirar dúvidas primeiro — faça isso.
2. NUNCA diga "encontrei X dados" ou mencione dados pré-preenchidos. O cliente não enviou nada ainda.
3. NUNCA use listas com bullets/tópicos para pedir dados. Seja conversacional e natural.
4. NUNCA se identifique como IA/robô.
5. A mensagem deve ser em português brasileiro informal e empático.
6. Se o prompt do agente diz para pedir os dados de uma vez, peça de forma conversacional (não em lista).

Gere APENAS a mensagem para o cliente. Nada mais.`;

        try {
          const firstMsgResult = await geminiChat({
            model: matchedShortcut.model || "google/gemini-2.5-flash",
            messages: [{ role: "user", content: firstMsgPrompt }],
            temperature: matchedShortcut.temperature ?? 0.4,
          });
          const firstMsg = firstMsgResult?.choices?.[0]?.message?.content;
          if (firstMsg?.trim()) {
            await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
              firstMsg.trim(), contact_id, lead_id, "wjia_collect", initialSplitOpts);
          }
        } catch (e) {
          console.error("Error generating prompt-based first message:", e);
          // Fallback to collection_message if AI fails
          if (parsed.collection_message) {
            await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
              parsed.collection_message, contact_id, lead_id, "wjia_collect");
          }
        }
      } else if (parsed.collection_message) {
        // No custom prompt — use the AI-generated collection message
        await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
          parsed.collection_message, contact_id, lead_id, "wjia_collect");
      }
    }

    return jsonResponse({
      success: true, action: "collection_started",
      message: `🔄 *Coleta de dados iniciada*\nDocumento: *${parsed.template_name}*\n📊 Dados encontrados: ${fieldsData.filter((f: any) => f.para).length}\n⚠️ Faltantes: ${missingFields.length}`,
      session_id: session.id, missing_count: missingFields.length,
    });
  }

  // Auto-extraction filled all fields — generate
  return await generateImmediate({
    supabase, normalizedPhone, instance_name, contact_id, lead_id,
    parsed, fieldsData, signerName, signerPhone, templateFields,
    zapsignSettings, skipConfirmation, partialMinFields, instanceRes,
    leadData: {}, zapsignToken, hasMissing: true,
    notifyOnSignature, sendSignedPdf, matchedShortcut,
  });
}

// ── Sub-handler: Generate document immediately ──
async function generateImmediate(opts: {
  supabase: any; normalizedPhone: string; instance_name: string;
  contact_id: string; lead_id: string; parsed: any;
  fieldsData: any[]; signerName: string; signerPhone: string;
  templateFields: any[]; zapsignSettings: any;
  skipConfirmation: boolean; partialMinFields: string[];
  instanceRes: any; leadData: any; zapsignToken: string;
  hasMissing: boolean; notifyOnSignature: boolean; sendSignedPdf: boolean;
  matchedShortcut: any;
}) {
  const {
    supabase, normalizedPhone, instance_name, contact_id, lead_id,
    parsed, fieldsData, signerName, signerPhone, templateFields,
    zapsignSettings, skipConfirmation, partialMinFields, instanceRes,
    leadData, zapsignToken, hasMissing, notifyOnSignature, sendSignedPdf,
  } = opts;

  const inst = instanceRes.data;

  const cleanPhoneForDoc = (signerPhone || "").replace(/\D/g, "");
  const docPhoneCountry = cleanPhoneForDoc.startsWith("55") ? "55" : cleanPhoneForDoc.substring(0, 2);
  const docPhoneNumber = cleanPhoneForDoc.startsWith("55") ? cleanPhoneForDoc.substring(2) : cleanPhoneForDoc;

  const finalDocCatalog = buildTemplateFieldCatalog({ required_fields: templateFields });
  applyDefaults(fieldsData);
  const predefinedKeysMain = applyConfiguredPredefinedFields(fieldsData, finalDocCatalog, zapsignSettings, { phone: normalizedPhone });
  const dateKeysMain = autoFillDates(fieldsData, finalDocCatalog);
  const syncKeysMain = autoSyncCityState(fieldsData, finalDocCatalog);
  const autoKeysMain = new Set([...predefinedKeysMain, ...dateKeysMain, ...syncKeysMain]);

  const filledTemplateData = fieldsData.filter((f: any) =>
    f?.de && f?.para && f.para.trim() !== "" && f.para !== " "
  );
  const finalMissingForDoc = computeMissingFields(finalDocCatalog, filledTemplateData);
  const hasIncompleteDocFields = finalMissingForDoc.length > 0;
  const forceEditable = partialMinFields.length > 0 && skipConfirmation;
  const shouldMarkIncomplete = hasIncompleteDocFields || forceEditable;

  // Apply zapsign_mode: 'prefilled_form' sends only auto fields + editable form; 'final_document' sends all
  const isPrefilledForm = zapsignMode === "prefilled_form";
  const dataToSend = isPrefilledForm
    ? fieldsData.filter((f: any) => f?.de && f?.para && String(f.para).trim().length > 0 && f.para !== " " && autoKeysMain.has(normalizeFieldKey(f.de)))
    : fieldsData.filter((f: any) => f?.de && f?.para && String(f.para).trim().length > 0 && f.para !== " ");
  const cpfFieldMain = fieldsData.find((f: any) => /CPF/i.test(f.de));

  const createBody: any = {
    template_id: parsed.template_token,
    signer_name: signerName,
    ...(docPhoneCountry && { signer_phone_country: docPhoneCountry }),
    ...(docPhoneNumber && { signer_phone_number: docPhoneNumber }),
    data: dataToSend.length > 0 ? dataToSend : [{ de: "{{_}}", para: " " }],
    ...(isPrefilledForm && { signer_has_incomplete_fields: true }),
  };

  applyZapSignSettings(createBody, zapsignSettings, {
    cpfValue: cpfFieldMain?.para || undefined,
    leadId: lead_id || undefined,
    leadName: leadData.lead_name || undefined,
  });

  const createRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("ZapSign error:", errText);
    return errorResponse(`Erro ZapSign: ${errText}`);
  }

  const docData = await createRes.json();
  const signer = docData.signers?.[0];
  const signUrl = signer ? `https://app.zapsign.co/verificar/${signer.token}` : null;

  if (signer?.token && zapsignToken) {
    await updateSignerSettings(signer.token, zapsignToken, zapsignSettings, {
      cpfValue: cpfFieldMain?.para || undefined,
    });
  }

  await supabase.from("zapsign_documents").insert({
    doc_token: docData.token,
    template_id: parsed.template_token,
    document_name: parsed.template_name || docData.name || "Documento",
    status: docData.status || "pending",
    original_file_url: docData.original_file || null,
    sign_url: signUrl,
    signer_name: signerName,
    signer_token: signer?.token || null,
    signer_phone: signerPhone,
    signer_status: signer?.status || "new",
    template_data: fieldsData,
    lead_id: lead_id || null,
    contact_id: contact_id || null,
    sent_via_whatsapp: true,
    whatsapp_phone: normalizedPhone,
    notify_on_signature: notifyOnSignature,
    send_signed_pdf: sendSignedPdf,
    instance_name: instance_name,
  });

  // Update active session if exists
  if (hasMissing && signUrl) {
    const { data: activeSession } = await supabase
      .from("wjia_collection_sessions")
      .select("id")
      .eq("phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeSession) {
      await supabase.from("wjia_collection_sessions").update({
        status: "generated", sign_url: signUrl, updated_at: new Date().toISOString(),
      }).eq("id", activeSession.id);
    }
  }

  if (inst?.instance_token && signUrl) {
    const hasPartialData = (hasMissing && skipConfirmation) || forceEditable;
    const clientMsg = hasPartialData
      ? `📝 *Documento para preenchimento e assinatura*\n\nOlá ${signerName.split(" ")[0]}! Preparei o documento *${parsed.template_name}* com os dados que já tenho.\n\n👉 ${signUrl}\n\n1. Clique no link\n2. *Complete os campos que estiverem em branco*\n3. Confira tudo e assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`
      : `📝 *Documento para assinatura*\n\nOlá ${signerName.split(" ")[0]}! Segue o link:\n\n👉 ${signUrl}\n\n1. Clique no link\n2. Confira seus dados e assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;
    await sendWhatsApp(supabase, inst, normalizedPhone, instance_name,
      clientMsg, contact_id, lead_id, "wjia_doc");
  }

  return jsonResponse({
    success: true, action: "document_created",
    message: `✅ Documento *${parsed.template_name}* criado!\n🔗 Link enviado ao cliente\n${signUrl ? `👁️ ${signUrl}` : ""}`,
    sign_url: signUrl, doc_token: docData.token,
  });
}
