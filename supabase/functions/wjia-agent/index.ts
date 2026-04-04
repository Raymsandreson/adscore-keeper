/**
 * UNIFIED WJIA AGENT
 *
 * Single intelligent agent that handles:
 * 1. Initial #command (new session) — analyzes, creates session, starts interaction
 * 2. Follow-up messages during active sessions — collects data, processes docs, generates documents
 *
 * The AI decides what to do based on context and objective, not rigid state machines.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";
import {
  applyDefaults,
  autoFillDates,
  autoFillFromCEP,
  autoSyncCityState,
  buildCrmContext,
  buildTemplateFieldCatalog,
  classifyDocument,
  computeMissingFields,
  DOC_TYPE_LABELS,
  extractCEPFromMessage,
  extractFromDocuments,
  filterFieldsAgainstTemplate,
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
  type TemplateFieldRef,
  upsertCollectedField,
  urlToBase64DataUri,
  ZAPSIGN_API_URL,
} from "../_shared/wjia-utils.ts";

import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const {
      phone,
      instance_name,
      // New command fields
      command,
      contact_id,
      lead_id,
      reset_memory = false,
      // Follow-up message fields
      message_text: rawMessageText,
      media_url,
      media_type,
      message_type,
      // Regenerate action
      action,
      session_id,
    } = payload;

    // ============================================================
    // MODE 0: REGENERATE SESSION (from panel edit)
    // ============================================================
    if (action === "regenerate_session" && session_id) {
      const supabaseUrl = RESOLVED_SUPABASE_URL;
      const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
      const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: session, error: sessErr } = await supabase
        .from("wjia_collection_sessions")
        .select("*")
        .eq("id", session_id)
        .single();

      if (sessErr || !session) {
        return errorResponse("Sessão não encontrada", 404);
      }

      if (!zapsignToken || !session.template_token) {
        return errorResponse("Token ZapSign ou template não configurado", 400);
      }

      let collectedData = session.collected_data || {};
      
      // If phone is provided, re-extract data from conversation to capture new info sent after generation
      if (phone && session.instance_name) {
        try {
          const supabaseForMessages = createClient(supabaseUrl, supabaseKey);
          const normalizedPhone = (phone || session.phone || "").replace(/\D/g, "").replace(/^0+/, "");
          const { data: recentMsgs } = await supabaseForMessages
            .from("whatsapp_messages")
            .select("direction, message_text, created_at")
            .eq("phone", normalizedPhone.length > 8 ? normalizedPhone : session.phone)
            .eq("instance_name", session.instance_name)
            .order("created_at", { ascending: false })
            .limit(30);
          
          if (recentMsgs && recentMsgs.length > 0) {
            const conversationText = recentMsgs.reverse()
              .map((m: any) => `${(m as any).direction === 'inbound' ? 'Cliente' : 'Agente'}: ${(m as any).message_text || ''}`)
              .filter((t: string) => t.includes(': ') && !t.endsWith(': '))
              .join("\n");
            
            // Use Gemini to re-extract fields from updated conversation
            const templateFields = (collectedData.fields || []).map((f: any) => f.de).join(", ");
            const { geminiChat: reExtract } = await import("../_shared/gemini.ts");
            const extractResult = await reExtract({
              model: "google/gemini-2.5-flash",
              temperature: 0,
              max_tokens: 4096,
              messages: [
                { role: "system", content: `Extraia os dados da conversa para preencher os campos de um documento. Campos: ${templateFields}\n\nRetorne JSON com array "fields" no formato [{"de": "{{CAMPO}}", "para": "valor"}]. Extraia TODOS os dados disponíveis na conversa (nome, CPF, endereço, etc.). Se um dado não foi mencionado, omita o campo.` },
                { role: "user", content: conversationText }
              ]
            });
            
            const extractContent = extractResult.choices?.[0]?.message?.content || "";
            const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const extracted = JSON.parse(jsonMatch[0]);
              if (extracted.fields && Array.isArray(extracted.fields)) {
                // Merge: new values override old ones
                const fieldMap = new Map<string, string>();
                for (const f of (collectedData.fields || [])) {
                  if (f.de && f.para) fieldMap.set(f.de, f.para);
                }
                for (const f of extracted.fields) {
                  if (f.de && f.para && f.para.trim()) fieldMap.set(f.de, f.para);
                }
                collectedData.fields = Array.from(fieldMap.entries()).map(([de, para]) => ({ de, para }));
                
                // Update session with new data
                await supabase.from("wjia_collection_sessions").update({
                  collected_data: collectedData,
                  updated_at: new Date().toISOString(),
                }).eq("id", session.id);
                
                console.log(`Re-extracted ${extracted.fields.length} fields from conversation for regeneration`);
              }
            }
          }
        } catch (reExtractErr) {
          console.error("Re-extraction error (continuing with existing data):", reExtractErr);
        }
      }
      
      const fieldsData = collectedData.fields || [];
      const signerName = collectedData.signer_name || "Cliente";
      const signerPhone = collectedData.signer_phone || session.phone;

      // Get instance token
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token, owner_name")
        .eq("instance_name", session.instance_name)
        .maybeSingle();

      // Generate document
      const filledFields = fieldsData.filter((f: any) => f?.para && f.para.trim() !== "");
      const hasMissing = fieldsData.some((f: any) => !f?.para || !f.para.trim());

      const cleanPhone = (signerPhone || "").replace(/\D/g, "");
      const phoneCountry = cleanPhone.startsWith("55") ? "55" : cleanPhone.substring(0, 2);
      const phoneNumber = cleanPhone.startsWith("55") ? cleanPhone.substring(2) : cleanPhone;

      const createBody: any = {
        template_id: session.template_token,
        signer_name: signerName,
        signer_phone_country: phoneCountry,
        signer_phone_number: phoneNumber,
        data: filledFields.length > 0 ? filledFields : [{ de: "{{_}}", para: " " }],
        ...(hasMissing && { signer_has_incomplete_fields: true }),
      };

      const zRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${zapsignToken}`,
        },
        body: JSON.stringify(createBody),
      });
      const zData = await zRes.json();

      if (!zRes.ok) {
        console.error("ZapSign regenerate error:", JSON.stringify(zData));
        return errorResponse("Erro ao gerar documento na ZapSign: " + JSON.stringify(zData), 500);
      }

      const signUrl = zData.signers?.[0]?.sign_url || zData.sign_url || null;
      const docToken = zData.token || null;

      // Update session
      await supabase.from("wjia_collection_sessions").update({
        status: "generated",
        sign_url: signUrl,
        doc_token: docToken,
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);

      // Attach received documents as extra docs
      const receivedDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
      for (const doc of receivedDocs) {
        if (!doc.media_url) continue;
        try {
          const fileResp = await fetch(doc.media_url);
          if (!fileResp.ok) continue;
          const fileBuffer = await fileResp.arrayBuffer();
          const ct = fileResp.headers.get("content-type") || "";
          let base64: string | null = null;
          if (ct.startsWith("image/")) {
            const { convertImageToPdf: imgToPdf } = await import("../_shared/wjia-utils.ts");
            base64 = await imgToPdf(fileBuffer, ct);
          } else {
            const bytes = new Uint8Array(fileBuffer);
            let bin = "";
            for (let i = 0; i < bytes.length; i += 8192) {
              bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
            }
            base64 = btoa(bin);
          }
          if (!base64) continue;
          const typeLabels: Record<string, string> = { rg_cnh: "RG_CNH", comprovante_endereco: "Comprovante_Endereco", comprovante_renda: "Comprovante_Renda" };
          await fetch(`${ZAPSIGN_API_URL}/docs/${docToken}/upload-extra-doc/`, {
            method: "POST",
            headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: typeLabels[doc.type] || doc.type || "Anexo", base64_pdf: base64 }),
          });
        } catch (e) {
          console.error("Regenerate attach error:", e);
        }
      }

      // Send link to client
      if (signUrl && inst?.instance_token) {
        const msg = `📄 *${session.template_name}* (atualizado)\n\n🔗 Clique para preencher e assinar:\n${signUrl}`;
        await sendWhatsApp(
          supabase,
          inst,
          session.phone,
          session.instance_name,
          msg,
          session.contact_id,
          session.lead_id,
          "wjia_regenerate",
        );
      }

      return new Response(
        JSON.stringify({ success: true, sign_url: signUrl, doc_token: docToken }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!phone) {
      return errorResponse("phone is required", 400);
    }

    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");

    // Determine mode
    const isNewCommand = !!command;

    // ============================================================
    // MODE 1: NEW COMMAND (#shortcut)
    // ============================================================
    if (isNewCommand) {
      return await handleNewCommand({
        supabase,
        zapsignToken,
        normalizedPhone,
        phone,
        instance_name,
        command,
        contact_id,
        lead_id,
        reset_memory,
      });
    }

    // ============================================================
    // MODE 2: FOLLOW-UP MESSAGE (active session)
    // ============================================================
    let message_text = rawMessageText;

    // Transcribe audio if needed — using shared STT (ElevenLabs + Gemini fallback)
    const isAudio = message_type === "audio" || message_type === "ptt" ||
      (media_type?.startsWith("audio/"));
    if (isAudio && media_url && !message_text) {
      try {
        const { transcribeFromUrl } = await import("../_shared/stt.ts");
        const t = await transcribeFromUrl(media_url);
        if (t?.trim()) message_text = t.trim();
      } catch (e) {
        console.error("Audio transcription error:", e);
      }
    }

    if (!instance_name) {
      return errorResponse("instance_name is required for follow-up", 400);
    }

    return await handleFollowUp({
      supabase,
      zapsignToken,
      normalizedPhone,
      instance_name,
      message_text,
      media_url,
      media_type,
      message_type,
    });
  } catch (error: any) {
    console.error("WJIA Agent error:", error);
    return errorResponse(error.message || "Unknown error", 500);
  }
});

// ============================================================
// NEW COMMAND HANDLER
// ============================================================

async function handleNewCommand(opts: {
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
    supabase,
    zapsignToken,
    normalizedPhone,
    instance_name,
    command,
    contact_id,
    lead_id,
    reset_memory,
  } = opts;

  // Load context in parallel
  const messagesQueryPromise = reset_memory
    ? Promise.resolve({ data: [] as any[] })
    : (() => {
      let query = supabase
        .from("whatsapp_messages")
        .select(
          "direction, message_text, message_type, media_url, media_type, created_at",
        )
        .eq("phone", normalizedPhone);
      if (instance_name) query = query.eq("instance_name", instance_name);
      return query.order("created_at", { ascending: false }).limit(50);
    })();

  const [
    messagesRes,
    contactRes,
    leadRes,
    templatesRes,
    instanceRes,
    shortcutsRes,
  ] = await Promise.all([
    messagesQueryPromise,
    contact_id
      ? supabase.from("contacts").select("*").eq("id", contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    lead_id
      ? supabase.from("leads").select("*").eq("id", lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    zapsignToken
      ? fetch(`${ZAPSIGN_API_URL}/templates/`, {
        headers: {
          Authorization: `Bearer ${zapsignToken}`,
          "Content-Type": "application/json",
        },
      }).then((r) => r.ok ? r.json() : []).catch(() => [])
      : Promise.resolve([]),
    instance_name
      ? supabase.from("whatsapp_instances").select("instance_token, base_url")
        .eq("instance_name", instance_name).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("wjia_command_shortcuts").select("*").eq("is_active", true)
      .order("display_order"),
  ]);

  const messages = (messagesRes.data || []).reverse();
  const contactData = contactRes.data || {};
  const leadData = leadRes.data || {};
  const shortcuts = (shortcutsRes.data || []) as any[];

  const templates = Array.isArray(templatesRes)
    ? templatesRes
    : (templatesRes?.results || []);
  const templateList = templates.map((t: any, i: number) =>
    `${i + 1}. "${t.name}" (token: ${t.token})`
  ).join("\n");

  const conversationText = messages
    .filter((m: any) => m.message_text)
    .map((m: any) =>
      `[${
        m.direction === "outbound" ? "Atendente" : "Cliente"
      }]: ${m.message_text}`
    )
    .join("\n");

  const crmContext = buildCrmContext(contactData, leadData, normalizedPhone);

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
  const customDocumentNames: string[] =
    matchedShortcut?.custom_document_names || [];
  const documentTypeModes: Record<string, string> =
    matchedShortcut?.document_type_modes || {};
  const assistantType = matchedShortcut?.assistant_type || "document";
  const shortcutModel = matchedShortcut?.model || "google/gemini-2.5-flash";
  const shortcutTemperature = matchedShortcut?.temperature ?? 0.1;
  const shortcutBasePrompt = matchedShortcut?.base_prompt || "";
  const skipConfirmation = matchedShortcut?.skip_confirmation !== false; // default true

  // For assistant-only mode, just respond with AI
  if (assistantType === "assistant") {
    const basePromptSection = shortcutBasePrompt
      ? `\nPERSONA/REGRAS BASE DO ASSISTENTE:\n${shortcutBasePrompt}\n`
      : "";
    const systemPrompt =
      `Você é o assistente WJIA, integrado ao WhatsApp de um escritório de advocacia.
${basePromptSection}
MODO: Assistente conversacional. Responda ao comando do atendente usando o contexto disponível.

${crmContext}

CONVERSA COM O CLIENTE (últimas mensagens):
${conversationText || "(sem mensagens)"}

${
        shortcutInstructions
          ? `INSTRUÇÕES ESPECÍFICAS:\n${shortcutInstructions}\n`
          : ""
      }`;

    const aiResult = await geminiChat({
      model: shortcutModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Comando: ${command}` },
      ],
      temperature: shortcutTemperature,
    });

    return new Response(
      JSON.stringify({
        success: true,
        action: "assistant_response",
        message: aiResult.choices?.[0]?.message?.content || "Sem resposta.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Document mode: AI analyzes command and picks template
  const basePromptSection = shortcutBasePrompt
    ? `\nPERSONA/REGRAS BASE:\n${shortcutBasePrompt}\n`
    : "";
  const systemPrompt =
    `Você é o assistente WJIA. O atendente digitou um comando.
${basePromptSection}
IMPORTANTE: NÃO gere o documento agora. Seu trabalho é:
1. Identificar qual template ZapSign usar
2. Analisar TODOS os dados disponíveis (conversa + CRM)
3. Identificar quais campos obrigatórios estão FALTANDO
4. Em caso de conflito entre CRM antigo e a conversa atual do cliente, a conversa atual tem prioridade

${
      forceTemplate
        ? `⚠️ TEMPLATE OBRIGATÓRIO: Use EXATAMENTE "${forceTemplateName}" (token: ${forceTemplate}).`
        : ""
    }

TEMPLATES ZAPSIGN DISPONÍVEIS:
${templateList || "(nenhum template)"}

${crmContext}

PRIORIDADE DAS FONTES:
- 1º: dados informados pelo cliente na conversa atual
- 2º: dados da conversa recente já existente
- 3º: CRM/cadastro apenas como fallback
- Se houver conflito, NUNCA use o CRM antigo para sobrescrever o que o cliente acabou de informar

CONVERSA COM O CLIENTE:
${conversationText || "(sem mensagens)"}

${
      shortcutInstructions
        ? `INSTRUÇÕES ESPECÍFICAS:\n${shortcutInstructions}\n`
        : ""
    }
REGRAS:
- NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- WHATSAPP escritório: "(86)99447-3226"
- EMAIL escritório: "contato@prudencioadv.com"
- Datas: DD/MM/AAAA
- Campos DATA_ASSINATURA/DATA_PROCURACAO: preencha com hoje (${
      new Date().toLocaleDateString("pt-BR")
    })
- Use SOMENTE campos que existem no template ZapSign`;

  const tools = [{
    type: "function",
    function: {
      name: "analyze_wjia_command",
      description:
        "Analisa o comando, escolhe template e identifica dados disponíveis vs faltantes",
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
    tool_choice: {
      type: "function",
      function: { name: "analyze_wjia_command" },
    },
    temperature: shortcutTemperature,
  });

  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    const fallbackText = aiResult.choices?.[0]?.message?.content;
    if (fallbackText) {
      return new Response(
        JSON.stringify({
          success: true,
          action: "assistant_response",
          message: fallbackText,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
    if (parsed.action !== "generate_document") {
      parsed.action = "generate_document";
    }
  }

  if (
    parsed.action !== "generate_document" || !parsed.template_token ||
    !zapsignToken
  ) {
    return new Response(
      JSON.stringify({
        success: true,
        action: parsed.action || "info",
        message: parsed.message_to_attendant || "Comando processado.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Get template fields
  const templateRes = await fetch(
    `${ZAPSIGN_API_URL}/templates/${parsed.template_token}/`,
    {
      headers: {
        Authorization: `Bearer ${zapsignToken}`,
        "Content-Type": "application/json",
      },
    },
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
  let signerName = parsed.signer_name || contactData.full_name ||
    leadData.victim_name || "Cliente";
  const signerPhone = parsed.signer_phone || contactData.phone ||
    normalizedPhone;

  applyDefaults(fieldsData);

  const hasMissing = missingFields.length > 0 && !parsed.all_data_available;

  if (hasMissing) {
    // Create collection session
    const startWithDocs = requestDocuments && Array.isArray(documentTypes) &&
      documentTypes.length > 0;
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
        collected_data: {
          fields: fieldsData,
          signer_name: signerName,
          signer_phone: signerPhone,
        },
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

    // ALWAYS run auto-extraction from history (text + media + CRM), not just when requestDocuments is on
    {
      const catalog = buildTemplateFieldCatalog({
        required_fields: templateFields,
        missing_fields: missingFields,
      });
      let customPrompt: string | null =
        matchedShortcut?.media_extraction_prompt || null;

      // Build CRM data string for extraction context
      const crmDataForExtraction: string[] = [];
      if (contactData.full_name) {
        crmDataForExtraction.push(`Nome completo: ${contactData.full_name}`);
      }
      if (contactData.cpf) crmDataForExtraction.push(`CPF: ${contactData.cpf}`);
      if (contactData.rg) crmDataForExtraction.push(`RG: ${contactData.rg}`);
      if (contactData.email) {
        crmDataForExtraction.push(`E-mail: ${contactData.email}`);
      }
      if (contactData.phone) {
        crmDataForExtraction.push(`Telefone: ${contactData.phone}`);
      }
      if (contactData.nationality) {
        crmDataForExtraction.push(`Nacionalidade: ${contactData.nationality}`);
      }
      if (contactData.marital_status) {
        crmDataForExtraction.push(
          `Estado civil: ${contactData.marital_status}`,
        );
      }
      if (contactData.profession) {
        crmDataForExtraction.push(`Profissão: ${contactData.profession}`);
      }
      if (contactData.address_street) {
        crmDataForExtraction.push(`Rua: ${contactData.address_street}`);
      }
      if (contactData.address_number) {
        crmDataForExtraction.push(`Número: ${contactData.address_number}`);
      }
      if (contactData.address_complement) {
        crmDataForExtraction.push(
          `Complemento: ${contactData.address_complement}`,
        );
      }
      if (contactData.address_neighborhood || contactData.neighborhood) {
        crmDataForExtraction.push(
          `Bairro: ${
            contactData.address_neighborhood || contactData.neighborhood
          }`,
        );
      }
      if (contactData.city) {
        crmDataForExtraction.push(`Cidade: ${contactData.city}`);
      }
      if (contactData.state) {
        crmDataForExtraction.push(`Estado: ${contactData.state}`);
      }
      if (contactData.zip_code || contactData.cep) {
        crmDataForExtraction.push(
          `CEP: ${contactData.zip_code || contactData.cep}`,
        );
      }
      if (contactData.birth_date) {
        crmDataForExtraction.push(
          `Data de nascimento: ${contactData.birth_date}`,
        );
      }
      if (contactData.mother_name) {
        crmDataForExtraction.push(`Nome da mãe: ${contactData.mother_name}`);
      }
      // Lead data
      if (leadData.victim_name && !contactData.full_name) {
        crmDataForExtraction.push(`Nome: ${leadData.victim_name}`);
      }
      if (leadData.victim_cpf && !contactData.cpf) {
        crmDataForExtraction.push(`CPF: ${leadData.victim_cpf}`);
      }
      if (leadData.lead_email && !contactData.email) {
        crmDataForExtraction.push(`E-mail: ${leadData.lead_email}`);
      }

      // Step 1: Extract data from TEXT/AUDIO messages + CRM data using AI
      const textMessages = messages.filter((m: any) => m.message_text?.trim());
      const hasCrmData = crmDataForExtraction.length > 0;

      if (textMessages.length > 0 || hasCrmData) {
        try {
          const historyText = textMessages.map((m: any) =>
            `[${
              m.direction === "inbound" ? "Cliente" : "Atendente"
            }]: ${m.message_text}`
          ).join("\n");

          const fieldsDetail = catalog.map((f: any) =>
            `- ${f.variable}: ${
              f.friendly_name || f.label || f.variable.replace(/[{}]/g, "")
            }`
          ).join("\n");

          const crmSection = hasCrmData
            ? `\nDADOS DO CRM/CADASTRO (prioridade alta):\n${
              crmDataForExtraction.join("\n")
            }\n`
            : "";

          const extractPrompt =
            `Você é um extrator de dados. Analise TODAS as fontes abaixo e extraia TODOS os dados que correspondem aos campos listados.

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
          const extractText = extractResult?.choices?.[0]?.message?.content ||
            "";
          console.log(
            `WJIA text+CRM extraction AI response: ${
              extractText.substring(0, 500)
            }`,
          );

          try {
            const jsonMatch = extractText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const extracted = JSON.parse(jsonMatch[0]);
              if (Array.isArray(extracted)) {
                for (const f of extracted) {
                  if (f.variable && f.value) {
                    upsertCollectedField(fieldsData, f.variable, f.value);
                  }
                }
                console.log(
                  `WJIA: Extracted ${extracted.length} fields from text+CRM`,
                );
              }
            }
          } catch (jsonErr) {
            console.error("Error parsing text extraction result:", jsonErr);
          }
        } catch (textExtractErr) {
          console.error("Text/CRM extraction error:", textExtractErr);
        }
      }

      // Step 2: Check if conversation history has media (images/documents)
      const mediaMessages = messages.filter((m: any) =>
        m.direction === "inbound" &&
        m.media_url &&
        (m.message_type === "image" || m.message_type === "document")
      );

      if (mediaMessages.length > 0) {
        console.log(
          `WJIA: Found ${mediaMessages.length} media messages in history, auto-extracting`,
        );
        const mediaUrls = mediaMessages.map((m: any) => m.media_url).filter(
          Boolean,
        );
        const docTypeGuesses = mediaMessages.map(() => "outros");

        try {
          const { extractedFields: autoExtracted, signerName: autoSigner } =
            await extractFromDocuments(
              mediaUrls,
              catalog,
              fieldsData,
              customPrompt,
              docTypeGuesses,
            );

          for (const f of autoExtracted) {
            upsertCollectedField(fieldsData, f.variable, f.value);
          }
          if (autoSigner) signerName = autoSigner;
        } catch (extractErr) {
          console.error("Auto-extract from history media error:", extractErr);
        }
      }

      // Step 3: Sync and compute what's still missing after all extractions
      syncNameFields(fieldsData);
      applyDefaults(fieldsData);
      autoFillDates(fieldsData, catalog);
      autoSyncCityState(fieldsData, catalog);

      const stillMissing = computeMissingFields(catalog, fieldsData);
      const filledCount = fieldsData.filter((f: any) => f.para).length;
      console.log(
        `WJIA auto-extract total: filled ${filledCount} fields, still missing ${stillMissing.length}`,
      );

      // Update session with all extracted data
      const collectedData = {
        fields: fieldsData,
        signer_name: signerName,
        signer_phone: signerPhone,
      };
      const receivedDocs = mediaMessages.map((m: any) => ({
        type: "outros",
        media_url: m.media_url,
        via: "history_auto",
      }));

      await supabase.from("wjia_collection_sessions").update({
        collected_data: { ...collectedData, fields: fieldsData },
        received_documents: receivedDocs.length > 0 ? receivedDocs : undefined,
        missing_fields: stillMissing,
        status: stillMissing.length > 0 ? "collecting" : "ready",
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);

      if (stillMissing.length === 0) {
        // All data extracted from history! Skip to generation
        session.status = "ready";
        // Don't return — let it fall through to generate
      } else if (skipConfirmation && !(startWithDocs && stillMissing.length > 0)) {
        // skip_confirmation mode: generate document with partial data, client fills rest on ZapSign
        // BUT if request_documents is on, collect docs first before generating
        console.log(
          `WJIA skip_confirmation: ${stillMissing.length} fields missing, generating with partial data`,
        );

        // Update session to generated state
        await supabase.from("wjia_collection_sessions").update({
          status: "ready",
          updated_at: new Date().toISOString(),
        }).eq("id", session.id);
        session.status = "ready";
        // Fall through to generate — ZapSign will show editable fields for missing data
      } else if (filledCount > 0) {
        // Found some data but still missing — tell client what we found and ask only for what's missing
        if (inst?.instance_token) {
          const FRIENDLY_LABELS: Record<string, string> = {
            "NOME_COMPLETO": "Nome completo",
            "NACIONALIDADE": "Nacionalidade",
            "ESTADO_CIVIL": "Estado civil",
            "PROFISSAO": "Profissão",
            "CPF": "CPF",
            "RG": "RG",
            "ENDERECO_COMPLETO": "Endereço completo",
            "CIDADE": "Cidade",
            "UF": "Estado (UF)",
            "CEP": "CEP",
            "DATA_NASCIMENTO": "Data de nascimento",
            "NOME_MAE": "Nome da mãe",
            "EMAIL": "E-mail",
            "TELEFONE": "Telefone",
            "BAIRRO": "Bairro",
            "NUMERO": "Número",
            "COMPLEMENTO": "Complemento",
            "NOME": "Nome completo",
            "NOME_CLIENTE": "Nome completo",
            "CPF_CLIENTE": "CPF",
            "RG_CLIENTE": "RG",
            "NACIONALIDADE_CLIENTE": "Nacionalidade",
            "ESTADO_CIVIL_CLIENTE": "Estado civil",
            "PROFISSAO_CLIENTE": "Profissão",
            "EMAIL_CLIENTE": "E-mail",
            "ENDERECO_RUA": "Rua",
            "ENDERECO_NUMERO": "Número",
            "ENDERECO_BAIRRO": "Bairro",
            "ENDERECO_CIDADE": "Cidade",
            "ENDERECO_ESTADO": "Estado",
            "ENDERECO_CEP": "CEP",
            "ENDERECO_CLIENTE_RUA": "Rua",
            "ENDERECO_CLIENTE_NUMERO": "Número",
            "ENDERECO_CLIENTE_BAIRRO": "Bairro",
            "ENDERECO_CLIENTE_CIDADE": "Cidade",
            "ENDERECO_CLIENTE_ESTADO": "Estado",
            "ENDERECO_CLIENTE_CEP": "CEP",
          };
          const missingList = stillMissing.map((f: any) => {
            const key = (f.friendly_name || f.field_name || "").replace(
              /[{}]/g,
              "",
            );
            return `• ${FRIENDLY_LABELS[key] || f.friendly_name || key}`;
          }).join("\n");
          const collectMsg =
            `📋 Encontrei ${filledCount} dados na nossa conversa!\n\nAinda preciso de:\n${missingList}\n\nPor favor, me informe esses dados ou envie fotos dos documentos. 🙏`;
          await sendWhatsApp(
            supabase,
            inst,
            normalizedPhone,
            instance_name,
            collectMsg,
            contact_id,
            lead_id,
            "wjia_collect",
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            action: "collection_started",
            message:
              `🔄 *Dados extraídos do histórico*\nDocumento: *${parsed.template_name}*\n📊 Dados encontrados: ${filledCount}\n⚠️ Faltantes: ${stillMissing.length}`,
            session_id: session.id,
            missing_count: stillMissing.length,
            auto_extracted: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // No data extracted — ask for documents or data (only if NOT skip_confirmation)
      if (session.status !== "ready" && filledCount === 0) {
        if (skipConfirmation && !startWithDocs) {
          // Even with no data, generate and let client fill on ZapSign (unless docs are required)
          console.log(
            `WJIA skip_confirmation: no data extracted, generating empty doc for client to fill`,
          );
          await supabase.from("wjia_collection_sessions").update({
            status: "ready",
            updated_at: new Date().toISOString(),
          }).eq("id", session.id);
          session.status = "ready";
          // Fall through to generate
        } else if (startWithDocs) {
          const requiredDocs: string[] = documentTypes
            .filter((t: string) => t !== "outros")
            .filter((t: string) =>
              (documentTypeModes[t] || "required") === "required"
            )
            .map((t: string) => DOC_TYPE_LABELS[t] || t);
          const optionalDocs: string[] = documentTypes
            .filter((t: string) => t !== "outros")
            .filter((t: string) => documentTypeModes[t] === "optional")
            .map((t: string) => DOC_TYPE_LABELS[t] || t);
          if (
            documentTypes.includes("outros") && customDocumentNames.length > 0
          ) {
            const outrosMode = documentTypeModes["outros"] || "required";
            if (outrosMode === "required") {
              requiredDocs.push(
                ...customDocumentNames.filter((n: string) => n.trim()),
              );
            } else {
              optionalDocs.push(
                ...customDocumentNames.filter((n: string) => n.trim()),
              );
            }
          } else if (documentTypes.includes("outros")) {
            const outrosMode = documentTypeModes["outros"] || "required";
            if (outrosMode === "required") {
              requiredDocs.push("Outros documentos");
            } else optionalDocs.push("Outros documentos");
          }

          let docsFirstMsg = `📝 Para preparar o documento *${
            parsed.template_name || "Documento"
          }*, preciso de algumas informações:\n\n`;
          if (requiredDocs.length > 0) {
            docsFirstMsg += `📎 *Envie obrigatoriamente:*\n• ${
              requiredDocs.join("\n• ")
            }\n\n`;
          }
          if (optionalDocs.length > 0) {
            docsFirstMsg +=
              `💬 *Opcional (envie o documento OU informe os dados por mensagem):*\n• ${
                optionalDocs.join("\n• ")
              }\n\n`;
          }
          docsFirstMsg +=
            `📸 Envie a *foto ou arquivo* de cada documento. Vou extrair as informações automaticamente!\n\nSe não tiver algum agora, digite *pular*.`;

          if (inst?.instance_token) {
            await sendWhatsApp(
              supabase,
              inst,
              normalizedPhone,
              instance_name,
              docsFirstMsg,
              contact_id,
              lead_id,
              "wjia_docsfirst",
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              action: "collection_started",
              message:
                `🔄 *Coleta de documentos iniciada*\nDocumento: *${parsed.template_name}*\n📎 Pedindo documentos ao cliente.\n⚠️ Faltantes: ${missingFields.length}`,
              session_id: session.id,
              missing_count: missingFields.length,
              docs_first: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Normal flow: send collection message (only if not auto-extracted to ready and not skip_confirmation)
    if (session.status !== "ready") {
      if (inst?.instance_token && parsed.collection_message) {
        await sendWhatsApp(
          supabase,
          inst,
          normalizedPhone,
          instance_name,
          parsed.collection_message,
          contact_id,
          lead_id,
          "wjia_collect",
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: "collection_started",
          message:
            `🔄 *Coleta de dados iniciada*\nDocumento: *${parsed.template_name}*\n📊 Dados encontrados: ${
              fieldsData.filter((f: any) => f.para).length
            }\n⚠️ Faltantes: ${missingFields.length}\n\nO robô vai coletar:\n${
              missingFields.map((f: any) => `• ${f.friendly_name}`).join("\n")
            }`,
          session_id: session.id,
          missing_count: missingFields.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // If we reach here, auto-extraction filled all fields — fall through to generate
  }

  // All data available → generate immediately
  const inst = instanceRes.data;

  // Extract phone country code and number per ZapSign API spec
  const cleanPhoneForDoc = (signerPhone || "").replace(/\D/g, "");
  const docPhoneCountry = cleanPhoneForDoc.startsWith("55")
    ? "55"
    : cleanPhoneForDoc.substring(0, 2);
  const docPhoneNumber = cleanPhoneForDoc.startsWith("55")
    ? cleanPhoneForDoc.substring(2)
    : cleanPhoneForDoc;

  const finalDocCatalog = buildTemplateFieldCatalog({ required_fields: templateFields });
  const filledTemplateData = fieldsData.filter((f: any) =>
    f?.de && f?.para && f.para.trim() !== "" && f.para !== " "
  );
  const finalMissingForDoc = computeMissingFields(finalDocCatalog, filledTemplateData);
  const hasIncompleteDocFields = finalMissingForDoc.length > 0;

  const createBody: any = {
    template_id: parsed.template_token,
    signer_name: signerName,
    ...(docPhoneCountry && { signer_phone_country: docPhoneCountry }),
    ...(docPhoneNumber && { signer_phone_number: docPhoneNumber }),
    data: filledTemplateData.length > 0
      ? filledTemplateData
      : [{ de: "{{_}}", para: " " }],
    ...(hasIncompleteDocFields && { signer_has_incomplete_fields: true }),
  };

  const createRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${zapsignToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("ZapSign error:", errText);
    return errorResponse(`Erro ZapSign: ${errText}`);
  }

  const docData = await createRes.json();
  const signer = docData.signers?.[0];
  const signUrl = signer
    ? `https://app.zapsign.co/verificar/${signer.token}`
    : null;

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

  // If there's an active session (from auto-extraction), update it with the generated doc info
  if (hasMissing && signUrl) {
    const normalPhone = normalizedPhone;
    const { data: activeSession } = await supabase
      .from("wjia_collection_sessions")
      .select("id")
      .eq("phone", normalPhone)
      .eq("instance_name", instance_name)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeSession) {
      await supabase.from("wjia_collection_sessions").update({
        status: "generated",
        sign_url: signUrl,
        updated_at: new Date().toISOString(),
      }).eq("id", activeSession.id);
    }
  }

  if (inst?.instance_token && signUrl) {
    const hasPartialData = hasMissing && skipConfirmation;
    const clientMsg = hasPartialData
      ? `📝 *Documento para preenchimento e assinatura*\n\nOlá ${
        signerName.split(" ")[0]
      }! Preparei o documento *${parsed.template_name}* com os dados que já tenho.\n\n👉 ${signUrl}\n\n1. Clique no link\n2. *Complete os campos que estiverem em branco*\n3. Confira tudo e assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`
      : `📝 *Documento para assinatura*\n\nOlá ${
        signerName.split(" ")[0]
      }! Segue o link:\n\n👉 ${signUrl}\n\n1. Clique no link\n2. Confira seus dados e assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;
    await sendWhatsApp(
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      clientMsg,
      contact_id,
      lead_id,
      "wjia_doc",
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: "document_created",
      message:
        `✅ Documento *${parsed.template_name}* criado!\n🔗 Link enviado ao cliente\n${
          signUrl ? `👁️ ${signUrl}` : ""
        }`,
      sign_url: signUrl,
      doc_token: docData.token,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================
// FOLLOW-UP MESSAGE HANDLER
// ============================================================

async function handleFollowUp(opts: {
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
    supabase,
    zapsignToken,
    normalizedPhone,
    instance_name,
    message_text,
    media_url,
    media_type,
    message_type,
  } = opts;

  // Find active session
  const { data: sessionRaw } = await supabase
    .from("wjia_collection_sessions").select("*")
    .eq("phone", normalizedPhone).eq("instance_name", instance_name)
    .in("status", [
      "collecting",
      "collecting_docs",
      "processing_docs",
      "ready",
      "generated",
    ])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!sessionRaw) {
    return new Response(JSON.stringify({ active_session: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let session = sessionRaw;

  // Recovery: unstick processing_docs > 3 min
  if (session.status === "processing_docs") {
    const stuckMin = (Date.now() -
      new Date(session.updated_at || session.created_at).getTime()) / 60000;
    if (stuckMin > 3) {
      await supabase.from("wjia_collection_sessions").update({
        status: "collecting_docs",
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);
      const { data: refreshed } = await supabase.from(
        "wjia_collection_sessions",
      ).select("*").eq("id", session.id).single();
      if (refreshed) session = refreshed;
    }
  }

  // Load agent config for persona and delay settings
  let agentPersona = "";
  let batchDelaySeconds = 0;

  // Try to get agent from conversation_agents assignment
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

  // ========== MESSAGE BATCHING DELAY ==========
  if (batchDelaySeconds > 0) {
    console.log(
      `WJIA batching delay: waiting ${batchDelaySeconds}s for more messages from ${normalizedPhone}`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, batchDelaySeconds * 1000)
    );

    // Check if newer inbound messages arrived during the delay
    const cutoffTime = new Date(Date.now() - batchDelaySeconds * 1000)
      .toISOString();
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
        console.log(
          `WJIA batching: newer message detected, skipping this invocation`,
        );
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: "Batching: newer message will handle",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    console.log(`WJIA batching delay complete for ${normalizedPhone}`);
  }

  // Load split message settings and skip_confirmation from shortcut config
  let splitOpts:
    | { splitMessages?: boolean; splitDelaySeconds?: number }
    | undefined;
  let skipConfirmation = true; // default true
  if (session.shortcut_name) {
    const { data: scSplit } = await supabase.from("wjia_command_shortcuts")
      .select("split_messages, split_delay_seconds, skip_confirmation")
      .eq("shortcut_name", session.shortcut_name).maybeSingle();
    if (scSplit?.split_messages) {
      splitOpts = {
        splitMessages: true,
        splitDelaySeconds: scSplit.split_delay_seconds || 3,
      };
      console.log(`WJIA split enabled: delay=${splitOpts.splitDelaySeconds}s`);
    }
    if (scSplit && typeof scSplit.skip_confirmation === "boolean") {
      skipConfirmation = scSplit.skip_confirmation;
    }
  }

  const { data: inst } = await supabase.from("whatsapp_instances").select(
    "instance_token, base_url",
  ).eq("instance_name", instance_name).maybeSingle();
  const catalog = buildTemplateFieldCatalog(session);
  const collectedData = session.collected_data || { fields: [] };
  const currentFields = [...(collectedData.fields || [])];

  console.log("Session:", session.id, "status:", session.status);

  // ============================================================
  // GENERATED SESSION — resend real link or regenerate if needed
  // ============================================================
  if (session.status === "generated") {
    // ALWAYS handle generated sessions here — NEVER fall through to AI agent phase
    // This prevents the AI from hallucinating fake URLs
    if (session.sign_url) {
      const signerName =
        (session.collected_data?.signer_name || "").split(" ")[0] || "Cliente";
      const resendMsg =
        `📝 Aqui está o link para assinatura do documento *${session.template_name}*:\n\n👉 ${session.sign_url}\n\nÉ só clicar e seguir as instruções! 🙏`;
      await sendWhatsApp(
        supabase,
        inst,
        normalizedPhone,
        instance_name,
        resendMsg,
        session.contact_id,
        session.lead_id,
        "wjia_resend_link",
        splitOpts,
      );
      return new Response(
        JSON.stringify({
          active_session: true,
          processed: true,
          resent_link: true,
          session_id: session.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // No sign_url available — end session silently, don't let AI respond
    return new Response(
      JSON.stringify({
        active_session: true,
        processed: true,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  // ============================================================
  // DOCUMENT UPLOAD HANDLING (collecting_docs phase)
  // ============================================================
  if (
    session.status === "collecting_docs" || session.status === "processing_docs"
  ) {
    const receivedDocs = Array.isArray(session.received_documents)
      ? [...session.received_documents]
      : [];
    const requestedTypes: string[] = Array.isArray(session.document_types)
      ? session.document_types
      : [];
    const isMedia = media_url &&
      (message_type === "image" || message_type === "document");

    const msgLower = (message_text || "").toLowerCase().trim();
    const isSkip = !isMedia &&
      (msgLower === "pular" || msgLower === "skip" ||
        msgLower.includes("não tenho") || msgLower.includes("nao tenho"));

    if (isSkip) {
      // Extract from whatever docs we have, then move to collecting
      let customPrompt: string | null = null;
      if (session.shortcut_name) {
        const { data: sc } = await supabase.from("wjia_command_shortcuts")
          .select("media_extraction_prompt").eq(
            "shortcut_name",
            session.shortcut_name,
          ).maybeSingle();
        customPrompt = sc?.media_extraction_prompt || null;
      }

      const docUrls = receivedDocs.map((d: any) => d.media_url).filter(Boolean);
      const { extractedFields, signerName } = await extractFromDocuments(
        docUrls,
        catalog,
        currentFields,
        customPrompt,
        receivedDocs.map((d: any) => d.type),
      );

      for (const f of extractedFields) {
        upsertCollectedField(currentFields, f.variable, f.value);
      }
      if (signerName) collectedData.signer_name = signerName;
      syncNameFields(currentFields);
      applyDefaults(currentFields);
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
      // Fall through to agent phase
    } else if (isMedia) {
      return await handleDocumentUpload({
        supabase,
        session,
        inst,
        normalizedPhone,
        instance_name,
        media_url,
        receivedDocs,
        requestedTypes,
        currentFields,
        collectedData,
        catalog,
      });
    } else if (session.status !== "collecting" && session.status !== "ready") {
      // Text during doc collection — remind
      // Load document type modes from shortcut config
      let sessionDocModes: Record<string, string> = {};
      if (session.shortcut_name) {
        const { data: sc } = await supabase.from("wjia_command_shortcuts")
          .select("document_type_modes").eq(
            "shortcut_name",
            session.shortcut_name,
          ).maybeSingle();
        sessionDocModes = sc?.document_type_modes || {};
      }

      const pendingTypes = requestedTypes.filter((t) =>
        !receivedDocs.some((d: any) => d.type === t)
      );
      const pendingRequired = pendingTypes.filter((t) =>
        (sessionDocModes[t] || "required") === "required"
      );
      const pendingOptional = pendingTypes.filter((t) =>
        sessionDocModes[t] === "optional"
      );

      // If text message and there are only optional docs pending, accept the text as data and move to collecting phase
      if (
        message_text && pendingRequired.length === 0 &&
        pendingOptional.length > 0
      ) {
        // Mark optional docs as "text_provided" and move to collecting
        for (const optType of pendingOptional) {
          receivedDocs.push({
            type: optType,
            media_url: null,
            via: "text",
            text_data: message_text,
          });
        }

        await supabase.from("wjia_collection_sessions").update({
          received_documents: receivedDocs,
          status: "collecting",
          updated_at: new Date().toISOString(),
        }).eq("id", session.id);

        session.status = "collecting";
        session.received_documents = receivedDocs;
        // Fall through to agent phase
      } else if (message_text && pendingOptional.length > 0) {
        // Has both required and optional pending — accept text for optional, remind for required
        for (const optType of pendingOptional) {
          receivedDocs.push({
            type: optType,
            media_url: null,
            via: "text",
            text_data: message_text,
          });
        }

        await supabase.from("wjia_collection_sessions").update({
          received_documents: receivedDocs,
          updated_at: new Date().toISOString(),
        }).eq("id", session.id);

        await sendWhatsApp(
          supabase,
          inst,
          normalizedPhone,
          instance_name,
          `💬 Dados recebidos!\n\n📎 Ainda preciso que envie: *${
            pendingRequired.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")
          }*.\n\nSe não tiver, digite *pular*.`,
          session.contact_id,
          session.lead_id,
          "wjia_remind",
          splitOpts,
        );
        return new Response(
          JSON.stringify({
            active_session: true,
            processed: true,
            session_id: session.id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } else {
        // Only required docs pending — remind as before
        let reminderParts: string[] = [];
        if (pendingRequired.length > 0) {
          reminderParts.push(
            `📎 Envie: *${
              pendingRequired.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")
            }*`,
          );
        }
        if (pendingOptional.length > 0) {
          reminderParts.push(
            `💬 Ou informe por mensagem: *${
              pendingOptional.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")
            }*`,
          );
        }
        await sendWhatsApp(
          supabase,
          inst,
          normalizedPhone,
          instance_name,
          `${reminderParts.join("\n\n")}\n\nSe não tiver, digite *pular*.`,
          session.contact_id,
          session.lead_id,
          "wjia_remind",
          splitOpts,
        );
        return new Response(
          JSON.stringify({
            active_session: true,
            processed: true,
            session_id: session.id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
  }

  // ============================================================
  // UNIFIED AGENT PHASE — AI decides what to do
  // ============================================================

  // Pre-process auto-fills
  const autoFilledKeys = autoFillDates(currentFields, catalog);
  const syncedKeys = autoSyncCityState(currentFields, catalog);
  const allAutoKeys = new Set([...autoFilledKeys, ...syncedKeys]);

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
  if (
    !detectedCEP &&
    (msgLower.includes("não sei o cep") || msgLower.includes("nao sei o cep") ||
      msgLower.includes("nao tenho cep"))
  ) {
    cepContext =
      `\n📍 Cliente NÃO sabe o CEP. CEP é OPCIONAL. Peça rua, número, bairro, cidade e estado. NÃO pergunte o CEP novamente.`;
  }

  // Reverse CEP lookup
  if (!detectedCEP && !cepContext) {
    const addressField = currentFields.find((f) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("RUA") || k.includes("LOGRADOURO") ||
        k.includes("ENDERECOCOMPLETO")) && hasFieldValue(f.para);
    });
    const cityField = currentFields.find((f) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("CIDADE") || k.includes("MUNICIPIO")) &&
        hasFieldValue(f.para);
    });
    const stateField = currentFields.find((f) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("ESTADO") || k === "UF") && hasFieldValue(f.para);
    });
    if (addressField && cityField && stateField) {
      const results = await reverseLookupCEP(
        stateField.para,
        cityField.para,
        addressField.para,
      );
      if (results.length > 0) {
        cepContext = `\n📍 BUSCA REVERSA: ${
          results.map((r) => `CEP ${r.cep} - ${r.logradouro}, ${r.bairro}`)
            .join(" | ")
        }`;
      }
    }
  }

  // Conversation context
  const { data: recentMsgs } = await supabase.from("whatsapp_messages")
    .select("direction, message_text, created_at")
    .eq("phone", normalizedPhone).order("created_at", { ascending: false })
    .limit(20);

  const conversationText = (recentMsgs || []).reverse().filter((m: any) =>
    m.message_text
  )
    .map((m: any) =>
      `[${
        m.direction === "outbound" ? "Agente" : "Cliente"
      }]: ${m.message_text}`
    ).join("\n");

  const filledFields = currentFields.filter((f) => f.para).map((f) =>
    `- ${getFieldLabel(f, catalog)}: ${f.para}`
  ).join("\n");
  const missingFieldsList = missingFields.map((f) =>
    `- ${f.friendly_name} (variável: ${f.field_name})`
  ).join("\n");
  const allFieldsList = catalog.map((f) =>
    `- ${f.label} (variável: ${f.variable})`
  ).join("\n");

  const receivedDocs = Array.isArray(session.received_documents)
    ? session.received_documents
    : [];
  const docsInfo = receivedDocs.length > 0
    ? `\nDocumentos anexados: ${
      receivedDocs.map((d: any) => DOC_TYPE_LABELS[d.type] || d.type).join(", ")
    }`
    : "";

  const isReadyPhase = session.status === "ready" || missingFields.length === 0;

  const systemPrompt =
    `Você é um assistente jurídico conversando pelo WhatsApp. Seu OBJETIVO é coletar os dados necessários para gerar o documento "${session.template_name}" e obter a confirmação do cliente.

INSTRUÇÕES DO AGENTE (PRIORIDADE MÁXIMA — siga estas instruções acima de qualquer outra regra):
${agentPersona || "(nenhuma instrução adicional)"}

ESTILO:
- Converse naturalmente. Frases curtas, diretas.
- ✅/❌ para resumos. Conversa normal em frases corridas.
- Aceite o que o cliente diz. Se corrigir, atualize sem questionar.

CAMPOS DO TEMPLATE:
${allFieldsList}

DADOS COLETADOS:
${filledFields || "(nenhum)"}

DADOS FALTANTES:
${missingFieldsList || "(todos coletados!)"}
${docsInfo}

FASE: ${
      isReadyPhase
        ? "CONFIRMAÇÃO — dados completos. Cliente pode confirmar (SIM) ou corrigir."
        : "COLETA — faltam dados."
    }

CONVERSA:
${conversationText}

MENSAGEM: "${message_text || "(vazia)"}"
${cepContext}

REGRAS:
1. SIGA AS INSTRUÇÕES DO AGENTE ACIMA. Se o prompt do agente disser para pedir o DOCUMENTO (foto/arquivo), peça o documento em vez de pedir os dados campo a campo.
2. Cliente CONFIRMANDO (sim, ok): ação "confirm_generate"
3. Cliente CORRIGINDO: extraia correção + se dados completos use "show_summary"
4. Faltam dados e o agente NÃO instruiu pedir documento: extraia o que puder, peça o restante DE UMA VEZ
5. CEP é OPCIONAL. NUNCA insista.
6. DATA_ASSINATURA/DATA_PROCURACAO: preenchidos automaticamente — NÃO pergunte
7. CIDADE/ESTADO de assinatura: sincronizados automaticamente
8. Nome parcial = confirmação se já existe nome completo
9. Use nomes EXATOS dos campos do template
10. Aceite bairros/locais sem questionar
11. ENDERECO_COMPLETO: rua + número + bairro
12. NUNCA INVENTE LINKS OU URLs. Não inclua nenhum link na sua resposta. O sistema envia o link real automaticamente após gerar o documento. Se o cliente confirmar, diga apenas que vai preparar/gerar o documento.
13. Quando o cliente confirmar (SIM/ok/certo), NÃO mencione link. Diga apenas algo como "Perfeito! Vou gerar o documento agora. Em instantes você recebe o link para assinar."`;

  const tools = [{
    type: "function",
    function: {
      name: "process_message",
      description: "Processa a mensagem do cliente",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["collect_data", "show_summary", "confirm_generate"],
          },
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
    return new Response(
      JSON.stringify({ active_session: true, processed: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let result: any;
  try {
    result = JSON.parse(toolCall.function.arguments);
  } catch {
    return new Response(
      JSON.stringify({ active_session: true, processed: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("Agent result:", JSON.stringify(result));

  // Sanitize AI reply: strip any hallucinated URLs (real links are sent by the system)
  if (result.reply_to_client) {
    result.reply_to_client = result.reply_to_client
      // Remove full URLs (http/https) — aggressively match anything after protocol
      .replace(/https?:\/\/\S+/gi, "")
      // Remove partial URLs like www.something.com
      .replace(/www\.\S+/gi, "")
      // Remove any domain-like patterns (word.com/path, word.com.br/path)
      .replace(
        /[a-z0-9-]+\.(?:com|org|net|br|io|app|dev|link|me|co)[^\s]*/gi,
        "",
      )
      // Remove any remaining markdown links [text](url)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Clean up leftover artifacts
      .replace(/\(\s*\)/g, "")
      .replace(/:\s*\n/g, ".\n") // "Aqui está o link:\n" → "Aqui está o link.\n"
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // If sanitization left the reply mostly empty or broken, replace with safe fallback
    const cleanText = result.reply_to_client.replace(/[^\w]/g, "");
    if (cleanText.length < 10) {
      if (result.action === "confirm_generate") {
        result.reply_to_client =
          "Perfeito! Vou gerar o documento agora. Em instantes você recebe o link para assinar. 📄";
      } else {
        result.reply_to_client = "";
      }
    }
  }

  for (const field of (result.newly_extracted || [])) {
    const normalized = normalizeIncomingField(field, catalog);
    if (!normalized) continue;
    if (shouldProtectName(currentFields, normalized)) continue;
    upsertCollectedField(currentFields, normalized.variable, normalized.value);
  }

  syncNameFields(currentFields);
  applyDefaults(currentFields);
  autoFillDates(currentFields, catalog);
  autoSyncCityState(currentFields, catalog);
  await autoFillFromCEP(currentFields, catalog);

  const finalMissing = computeMissingFields(catalog, currentFields);
  const allCollected = finalMissing.length === 0;
  const updatedCollectedData = { ...collectedData, fields: currentFields };

  if (result.action === "confirm_generate" && allCollected && zapsignToken) {
    // GENERATE DOCUMENT
    await supabase.from("wjia_collection_sessions").update({
      collected_data: updatedCollectedData,
      missing_fields: [],
      status: "ready",
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    session.received_documents = receivedDocs;
    const signerName = collectedData.signer_name || "Cliente";
    const signerPhone = collectedData.signer_phone || normalizedPhone;
    const docData = await generateZapSignDocument(
      supabase,
      session,
      currentFields,
      signerName,
      signerPhone,
      normalizedPhone,
      instance_name,
      inst,
      zapsignToken,
    );

    return new Response(
      JSON.stringify({
        active_session: true,
        processed: true,
        confirmed: true,
        generated: !!docData,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (allCollected) {
    // Skip confirmation: auto-generate when all data is collected
    if (skipConfirmation && zapsignToken) {
      console.log(
        `WJIA skip_confirmation: all fields collected, auto-generating document`,
      );
      await supabase.from("wjia_collection_sessions").update({
        collected_data: updatedCollectedData,
        missing_fields: [],
        status: "ready",
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);

      // Send a brief confirmation message before generating
      const summaryLines = currentFields.filter((f) => f.para).map((f) =>
        `• *${getFieldLabel(f, catalog)}*: ${f.para}`
      ).join("\n");
      const confirmMsg =
        `✅ *Dados completos!*\n\n${summaryLines}\n\n📄 Gerando o documento *${session.template_name}*... Aguarde!`;
      await sendWhatsApp(
        supabase,
        inst,
        normalizedPhone,
        instance_name,
        confirmMsg,
        session.contact_id,
        session.lead_id,
        "wjia_autoconfirm",
        splitOpts,
      );

      session.received_documents = receivedDocs;
      const signerName = collectedData.signer_name || "Cliente";
      const signerPhone = collectedData.signer_phone || normalizedPhone;
      const docData = await generateZapSignDocument(
        supabase,
        session,
        currentFields,
        signerName,
        signerPhone,
        normalizedPhone,
        instance_name,
        inst,
        zapsignToken,
      );

      return new Response(
        JSON.stringify({
          active_session: true,
          processed: true,
          confirmed: true,
          generated: !!docData,
          session_id: session.id,
          auto_confirmed: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Show summary for manual confirmation
    const summaryLines = currentFields.filter((f) => f.para).map((f) =>
      `• *${getFieldLabel(f, catalog)}*: ${f.para}`
    ).join("\n");
    const docsSection = receivedDocs.length > 0
      ? `\n\n📎 *Documentos anexados:*\n${
        receivedDocs.map((d: any) =>
          `• ✅ ${DOC_TYPE_LABELS[d.type] || d.type}`
        ).join("\n")
      }`
      : "";

    let replyMsg = result.reply_to_client;
    if (result.action === "show_summary" || session.status !== "ready") {
      replyMsg =
        `Confira as informações antes de gerar o documento *${session.template_name}*:\n\n${summaryLines}${docsSection}\n\n📋 Está tudo correto? Responda *SIM* para gerar ou me diga o que corrigir.`;
    }

    await supabase.from("wjia_collection_sessions").update({
      collected_data: updatedCollectedData,
      missing_fields: [],
      status: "ready",
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    await sendWhatsApp(
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      replyMsg,
      session.contact_id,
      session.lead_id,
      "wjia_summary",
      splitOpts,
    );

    return new Response(
      JSON.stringify({
        active_session: true,
        processed: true,
        all_collected: true,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Still collecting
  await supabase.from("wjia_collection_sessions").update({
    collected_data: updatedCollectedData,
    missing_fields: finalMissing,
    status: "collecting",
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  if (result.reply_to_client) {
    await sendWhatsApp(
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      result.reply_to_client,
      session.contact_id,
      session.lead_id,
      "wjia_collect",
      splitOpts,
    );
  }

  return new Response(
    JSON.stringify({
      active_session: true,
      processed: true,
      all_collected: false,
      session_id: session.id,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================
// DOCUMENT UPLOAD HANDLER (sub-function of follow-up)
// ============================================================

async function handleDocumentUpload(opts: {
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
}) {
  const {
    supabase,
    session,
    inst,
    normalizedPhone,
    instance_name,
    media_url,
    receivedDocs,
    requestedTypes,
    currentFields,
    collectedData,
    catalog,
  } = opts;

  const pendingTypes = requestedTypes.filter((t) =>
    !receivedDocs.some((d: any) => d.type === t)
  );

  if (pendingTypes.length === 0 && receivedDocs.length > 0) {
    // All already received — run extraction
    return await runDocExtraction({
      supabase,
      session,
      inst,
      normalizedPhone,
      instance_name,
      receivedDocs,
      currentFields,
      collectedData,
      catalog,
    });
  }

  const classification = await classifyDocument(media_url, pendingTypes);

  if (classification.type === "invalido") {
    await sendWhatsApp(
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      `⚠️ Não reconheci como documento válido. Envie: *${
        pendingTypes.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")
      }*`,
      session.contact_id,
      session.lead_id,
      "wjia_invalid",
      splitOpts,
    );
    return new Response(
      JSON.stringify({
        active_session: true,
        processed: true,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (
    !pendingTypes.includes(classification.type) &&
    receivedDocs.some((d) => d.type === classification.type)
  ) {
    await sendWhatsApp(
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      `⚠️ Já recebi *${
        DOC_TYPE_LABELS[classification.type] || classification.type
      }*. Preciso: *${
        pendingTypes.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")
      }*`,
      session.contact_id,
      session.lead_id,
      "wjia_dup",
      splitOpts,
    );
    return new Response(
      JSON.stringify({
        active_session: true,
        processed: true,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      `✅ *${
        DOC_TYPE_LABELS[assignedType] || assignedType
      }* recebido!\n\nAinda falta: *${
        newPending.map((t) => DOC_TYPE_LABELS[t] || t).join(", ")
      }*`,
      session.contact_id,
      session.lead_id,
      "wjia_ack",
      splitOpts,
    );
    return new Response(
      JSON.stringify({
        active_session: true,
        processed: true,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
      supabase,
      inst,
      normalizedPhone,
      instance_name,
      "⏳ Processando documentos...",
      session.contact_id,
      session.lead_id,
      "wjia_wait",
    );
    return new Response(
      JSON.stringify({
        active_session: true,
        processed: false,
        session_id: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return await runDocExtraction({
    supabase,
    session,
    inst,
    normalizedPhone,
    instance_name,
    receivedDocs,
    currentFields,
    collectedData,
    catalog,
  });
}

async function runDocExtraction(opts: {
  supabase: any;
  session: any;
  inst: any;
  normalizedPhone: string;
  instance_name: string;
  receivedDocs: any[];
  currentFields: any[];
  collectedData: any;
  catalog: TemplateFieldRef[];
}) {
  const {
    supabase,
    session,
    inst,
    normalizedPhone,
    instance_name,
    receivedDocs,
    currentFields,
    collectedData,
    catalog,
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
    docUrls,
    catalog,
    currentFields,
    customPrompt,
    receivedDocs.map((d: any) => d.type),
  );

  for (const f of extractedFields) {
    upsertCollectedField(currentFields, f.variable, f.value);
  }
  if (signerName) collectedData.signer_name = signerName;
  syncNameFields(currentFields);
  applyDefaults(currentFields);
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
    ? `✅ *Documentos analisados!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n⚠️ Ainda preciso: *${
      missing.map((f) => f.friendly_name).join(", ")
    }*`
    : `✅ *Dados extraídos!*\n\n${summary}\n\nDocumentos:\n${docsSummary}\n\n📋 Está correto? Responda *SIM* para gerar.`;

  await supabase.from("wjia_collection_sessions").update({
    collected_data: { ...collectedData, fields: currentFields },
    received_documents: receivedDocs,
    missing_fields: missing,
    status: missing.length > 0 ? "collecting" : "ready",
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  await sendWhatsApp(
    supabase,
    inst,
    normalizedPhone,
    instance_name,
    msg,
    session.contact_id,
    session.lead_id,
    "wjia_extract",
    splitOpts,
  );

  return new Response(
    JSON.stringify({
      active_session: true,
      processed: true,
      session_id: session.id,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================
// HELPERS
// ============================================================

function errorResponse(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
