import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, command, contact_id, lead_id } = await req.json();
    if (!phone || !command) {
      return new Response(JSON.stringify({ error: "phone and command are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");

    // 1) Load context in parallel
    const [messagesRes, contactRes, leadRes, templatesRes, instanceRes, shortcutsRes] = await Promise.all([
      supabase
        .from("whatsapp_messages")
        .select("direction, message_text, message_type, media_url, media_type, created_at")
        .eq("phone", normalizedPhone)
        .order("created_at", { ascending: false })
        .limit(60),
      contact_id
        ? supabase.from("contacts").select("*").eq("id", contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
      lead_id
        ? supabase.from("leads").select("*").eq("id", lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
      zapsignToken
        ? fetch(`${ZAPSIGN_API_URL}/templates/`, {
            headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
          }).then(r => r.ok ? r.json() : []).catch(() => [])
        : Promise.resolve([]),
      instance_name
        ? supabase.from("whatsapp_instances").select("instance_token, base_url").eq("instance_name", instance_name).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("wjia_command_shortcuts").select("*").eq("is_active", true).order("display_order"),
    ]);

    const messages = (messagesRes.data || []).reverse();
    const contactData = contactRes.data || {};
    const leadData = leadRes.data || {};
    const shortcuts = (shortcutsRes.data || []) as any[];

    // Build template list
    const templates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.results || []);
    const templateList = templates.map((t: any, i: number) => `${i + 1}. "${t.name}" (token: ${t.token})`).join("\n");

    // Build shortcuts list for AI
    const shortcutList = shortcuts.map((s: any) => 
      `- "${s.shortcut_name}": ${s.description || s.template_name || ''} (template: ${s.template_token || 'auto'})`
    ).join("\n");

    // Build conversation text
    const conversationText = messages
      .filter((m: any) => m.message_text)
      .map((m: any) => `[${m.direction === "outbound" ? "Atendente" : "Cliente"}]: ${m.message_text}`)
      .join("\n");

    // CRM context
    const crmContext = buildCrmContext(contactData, leadData, normalizedPhone);

    // Check if command matches a specific shortcut with a fixed template
    const commandLower = command.replace(/^@wjia\s*/i, '').trim().toLowerCase();
    const matchedShortcut = shortcuts.find((s: any) => 
      commandLower.includes(s.shortcut_name.toLowerCase()) || 
      s.shortcut_name.toLowerCase().includes(commandLower)
    );

    const forceTemplate = matchedShortcut?.template_token || null;
    const forceTemplateName = matchedShortcut?.template_name || null;
    const shortcutInstructions = matchedShortcut?.prompt_instructions || '';
    const notifyOnSignature = matchedShortcut?.notify_on_signature !== false;
    const sendSignedPdf = matchedShortcut?.send_signed_pdf !== false;
    const requestDocuments = matchedShortcut?.request_documents || false;
    const documentTypes = matchedShortcut?.document_types || [];

    // 2) AI decides what to do — but does NOT generate doc yet if data is missing
    const systemPrompt = `Você é o assistente WJIA, integrado ao WhatsApp de um escritório de advocacia. O atendente digitou um comando @wjia.

IMPORTANTE: NÃO gere o documento agora. Seu trabalho é:
1. Identificar qual template ZapSign usar
2. Analisar TODOS os dados disponíveis (conversa + CRM)
3. Identificar quais campos obrigatórios estão FALTANDO
4. Se houver dados faltantes, o robô vai assumir a conversa para coletá-los antes de gerar

${forceTemplate ? `⚠️ TEMPLATE OBRIGATÓRIO: Use EXATAMENTE o template "${forceTemplateName}" (token: ${forceTemplate}). NÃO escolha outro template.` : ''}

ATALHOS CONFIGURADOS:
${shortcutList || "(nenhum atalho)"}

TEMPLATES ZAPSIGN DISPONÍVEIS:
${templateList || "(nenhum template)"}

${crmContext}

CONVERSA COM O CLIENTE (últimas mensagens):
${conversationText || "(sem mensagens)"}

${shortcutInstructions ? `INSTRUÇÕES ESPECÍFICAS DO ATALHO:\n${shortcutInstructions}\n` : ''}
REGRAS:
- Para NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- Para WHATSAPP do escritório: use "(86)99447-3226"
- Para EMAIL do escritório: use "contato@prudencioadv.com"
- Formate datas como DD/MM/AAAA
- Extraia TUDO que puder da conversa e CRM
- Se o atalho tem prompt_instructions, siga essas instruções adicionais`;

    const tools = [
      {
        type: "function",
        function: {
          name: "analyze_wjia_command",
          description: "Analisa o comando, escolhe template e identifica dados disponíveis vs faltantes",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["generate_document", "unknown"],
              },
              template_token: { type: "string" },
              template_name: { type: "string" },
              signer_name: { type: "string", description: "Nome do signatário" },
              signer_phone: { type: "string" },
              extracted_fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    de: { type: "string" },
                    para: { type: "string" },
                  },
                  required: ["de", "para"],
                },
              },
              missing_fields: {
                type: "array",
                description: "Campos obrigatórios que NÃO foram encontrados",
                items: {
                  type: "object",
                  properties: {
                    field_name: { type: "string" },
                    friendly_name: { type: "string" },
                  },
                  required: ["field_name", "friendly_name"],
                },
              },
              all_data_available: {
                type: "boolean",
                description: "true se TODOS os campos obrigatórios foram preenchidos",
              },
              collection_message: {
                type: "string",
                description: "Mensagem para enviar ao cliente pedindo os dados faltantes (se houver)",
              },
              message_to_attendant: { type: "string" },
            },
            required: ["action", "message_to_attendant", "all_data_available"],
          },
        },
      },
    ];

    const aiResult = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Comando do atendente: ${command}` },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "analyze_wjia_command" } },
      temperature: 0.1,
    });

    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return errorResponse("Não foi possível processar o comando. Tente ser mais específico.");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return errorResponse("Erro ao processar resposta da IA.");
    }

    console.log("WJIA analysis result:", JSON.stringify(parsed));

    // Force shortcut template if configured
    if (forceTemplate) {
      parsed.template_token = forceTemplate;
      parsed.template_name = forceTemplateName || parsed.template_name;
      if (parsed.action !== "generate_document") {
        parsed.action = "generate_document";
      }
    }

    if (parsed.action !== "generate_document" || !parsed.template_token || !zapsignToken) {
      return new Response(JSON.stringify({
        success: true,
        action: parsed.action || "info",
        message: parsed.message_to_attendant || "Comando processado.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get template fields details
    const templateRes = await fetch(`${ZAPSIGN_API_URL}/templates/${parsed.template_token}/`, {
      headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
    });

    let templateFields: any[] = [];
    if (templateRes.ok) {
      const templateDetail = await templateRes.json();
      templateFields = (templateDetail.inputs || []).map((input: any) => ({
        variable: input.variable || "",
        label: input.label || "",
        required: input.required || false,
      }));
    }

    const fieldsData = parsed.extracted_fields || [];
    const missingFields = parsed.missing_fields || [];
    const signerName = parsed.signer_name || contactData.full_name || leadData.victim_name || "Cliente";
    const signerPhone = parsed.signer_phone || contactData.phone || normalizedPhone;

    // Apply defaults
    applyFieldDefaults(fieldsData);

    // ========== DECISION: COLLECT or GENERATE ==========
    const hasMissing = missingFields.length > 0 && !parsed.all_data_available;

    if (hasMissing) {
      // CREATE COLLECTION SESSION — AI agent will take over to collect data
      const { data: session, error: sessionErr } = await supabase
        .from("wjia_collection_sessions")
        .insert({
          phone: normalizedPhone,
          instance_name: instance_name,
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          template_token: parsed.template_token,
          template_name: parsed.template_name || "Documento",
          required_fields: templateFields,
          collected_data: { fields: fieldsData, signer_name: signerName, signer_phone: signerPhone },
          missing_fields: missingFields,
          status: "collecting",
          triggered_by: command,
          notify_on_signature: notifyOnSignature,
          send_signed_pdf: sendSignedPdf,
          request_documents: requestDocuments,
          document_types: documentTypes,
        })
        .select()
        .single();

      if (sessionErr) {
        console.error("Error creating collection session:", sessionErr);
        return errorResponse("Erro ao iniciar sessão de coleta.");
      }

      // Send collection message to client
      const inst = instanceRes.data;
      if (inst?.instance_token && parsed.collection_message) {
        const baseUrl = inst.base_url || "https://abraci.uazapi.com";
        await sendWhatsApp(baseUrl, inst.instance_token, normalizedPhone, parsed.collection_message);

        // Save outbound
        await supabase.from("whatsapp_messages").insert({
          phone: normalizedPhone,
          instance_name,
          contact_name: contactData.full_name || null,
          message_text: parsed.collection_message,
          message_type: "text",
          direction: "outbound",
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          external_message_id: `wjia_collect_${Date.now()}`,
        });
      }

      const attendantMsg = `🔄 *Coleta de dados iniciada*\n\nDocumento: *${parsed.template_name || "Documento"}*\n📊 Dados encontrados: ${fieldsData.filter((f: any) => f.para).length}\n⚠️ Dados faltantes: ${missingFields.length}\n\nO robô vai conversar com o cliente para coletar:\n${missingFields.map((f: any) => `• ${f.friendly_name}`).join("\n")}\n\n✅ Quando todos os dados forem coletados, o documento será gerado e enviado automaticamente.`;

      return new Response(JSON.stringify({
        success: true,
        action: "collection_started",
        message: attendantMsg,
        session_id: session.id,
        missing_count: missingFields.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ALL DATA AVAILABLE — Generate document immediately
    return await generateAndSendDocument({
      supabase,
      zapsignToken,
      normalizedPhone,
      instanceRes,
      instance_name,
      contact_id,
      lead_id,
      contactData,
      parsed,
      fieldsData,
      signerName,
      signerPhone,
    });

  } catch (error: any) {
    console.error("WJIA command error:", error);
    return new Response(JSON.stringify({
      success: false,
      message: `Erro: ${error.message}`,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ========== HELPERS ==========

function buildCrmContext(contactData: any, leadData: any, phone: string): string {
  return `
DADOS DO CONTATO (CRM):
- Nome: ${contactData.full_name || ""}
- Telefone: ${contactData.phone || phone}
- Email: ${contactData.email || ""}
- Cidade: ${contactData.city || ""}
- Estado: ${contactData.state || ""}
- Bairro: ${contactData.neighborhood || ""}
- Rua: ${contactData.street || ""}
- CEP: ${contactData.cep || ""}
- Profissão: ${contactData.profession || ""}

DADOS DO LEAD (CRM):
- Nome: ${leadData.lead_name || ""}
- Vítima: ${leadData.victim_name || ""}
- CPF: ${leadData.cpf || ""}
- Telefone: ${leadData.lead_phone || ""}
- Email: ${leadData.lead_email || ""}
- Cidade: ${leadData.city || ""}
- Estado: ${leadData.state || ""}`;
}

function applyFieldDefaults(fieldsData: any[]) {
  if (!Array.isArray(fieldsData)) return;
  for (const field of fieldsData) {
    const fieldName = (field.de || "").replace(/\{\{|\}\}/g, "").toUpperCase().trim();
    if ((fieldName === "EMAIL" || fieldName.includes("EMAIL")) && !field.para) {
      field.para = "contato@prudencioadv.com";
    }
    if ((fieldName === "WHATSAPP" || fieldName.includes("WHATSAPP")) && !field.para) {
      field.para = "(86)99447-3226";
    }
  }
}

async function sendWhatsApp(baseUrl: string, token: string, phone: string, text: string) {
  try {
    await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, text }),
    });
  } catch (e) {
    console.error("Error sending WhatsApp:", e);
  }
}

function errorResponse(msg: string) {
  return new Response(JSON.stringify({ success: false, message: msg }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function generateAndSendDocument(opts: {
  supabase: any;
  zapsignToken: string;
  normalizedPhone: string;
  instanceRes: any;
  instance_name: string;
  contact_id: string | null;
  lead_id: string | null;
  contactData: any;
  parsed: any;
  fieldsData: any[];
  signerName: string;
  signerPhone: string;
  sessionId?: string;
}) {
  const {
    supabase, zapsignToken, normalizedPhone, instanceRes, instance_name,
    contact_id, lead_id, contactData, parsed, fieldsData, signerName, signerPhone, sessionId,
  } = opts;

  const createBody: any = {
    template_id: parsed.template_token,
    signer_name: signerName,
    signer_phone: signerPhone,
    data: fieldsData.length > 0 ? fieldsData : [{ de: "{{_}}", para: " " }],
  };

  console.log("Creating ZapSign doc:", JSON.stringify(createBody));

  const createRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("ZapSign create error:", errText);
    return errorResponse(`Erro ao criar documento no ZapSign: ${errText}`);
  }

  const docData = await createRes.json();
  const signer = docData.signers?.[0];
  const signUrl = signer ? `https://app.zapsign.co/verificar/${signer.token}` : null;

  // Save to database
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
  });

  // Update collection session if exists
  if (sessionId) {
    await supabase
      .from("wjia_collection_sessions")
      .update({ status: "generated", doc_token: docData.token, sign_url: signUrl })
      .eq("id", sessionId);
  }

  // Send link to client via WhatsApp
  const inst = instanceRes.data;
  if (inst?.instance_token && signUrl) {
    const clientMsg = `📝 *Documento para assinatura*\n\nOlá ${signerName.split(" ")[0]}! Segue o link para assinar o documento *${parsed.template_name || "Documento"}*:\n\n👉 ${signUrl}\n\n*Instruções:*\n1. Clique no link acima\n2. Confira seus dados e assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;

    const baseUrl = inst.base_url || "https://abraci.uazapi.com";
    await sendWhatsApp(baseUrl, inst.instance_token, normalizedPhone, clientMsg);

    await supabase.from("whatsapp_messages").insert({
      phone: normalizedPhone,
      instance_name,
      contact_name: contactData.full_name || null,
      message_text: clientMsg,
      message_type: "text",
      direction: "outbound",
      contact_id: contact_id || null,
      lead_id: lead_id || null,
      external_message_id: `wjia_doc_${Date.now()}`,
    });
  }

  const filledCount = fieldsData.filter((f: any) => f.para).length;
  const attendantMsg = `✅ Documento *${parsed.template_name || "Documento"}* criado com sucesso!\n\n📊 Campos preenchidos: ${filledCount}/${fieldsData.length}\n🔗 Link de assinatura enviado ao cliente\n\n${signUrl ? `👁️ Link: ${signUrl}` : ""}`;

  return new Response(JSON.stringify({
    success: true,
    action: "document_created",
    message: attendantMsg,
    sign_url: signUrl,
    doc_token: docData.token,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
