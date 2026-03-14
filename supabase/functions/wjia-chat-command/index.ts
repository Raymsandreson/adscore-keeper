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

    // 1) Load context in parallel
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");

    const [messagesRes, contactRes, leadRes, templatesRes, instanceRes] = await Promise.all([
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
    ]);

    const messages = (messagesRes.data || []).reverse();
    const contactData = contactRes.data || {};
    const leadData = leadRes.data || {};

    // Build template list for AI
    const templates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.results || []);
    const templateList = templates.map((t: any, i: number) => `${i + 1}. "${t.name}" (token: ${t.token})`).join("\n");

    // Build conversation text
    const conversationText = messages
      .filter((m: any) => m.message_text)
      .map((m: any) => `[${m.direction === "outbound" ? "Atendente" : "Cliente"}]: ${m.message_text}`)
      .join("\n");

    // CRM context
    const crmContext = `
DADOS DO CONTATO (CRM):
- Nome: ${contactData.full_name || ""}
- Telefone: ${contactData.phone || normalizedPhone}
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
- Estado: ${leadData.state || ""}
`;

    // 2) AI decides what to do
    const systemPrompt = `Você é o assistente WJIA, integrado ao WhatsApp de um escritório de advocacia. O atendente digitou um comando @wjia dentro da conversa com um cliente.

Seu trabalho:
1. Entender o que o atendente quer (gerar documento, procuração, contrato, etc.)
2. Escolher o template ZapSign mais adequado
3. Extrair TODOS os dados disponíveis da conversa e do CRM
4. Identificar dados faltantes que o cliente precisará fornecer
5. Gerar mensagens para o cliente pedindo dados faltantes (se houver)

TEMPLATES ZAPSIGN DISPONÍVEIS:
${templateList || "(nenhum template encontrado)"}

${crmContext}

CONVERSA COM O CLIENTE (últimas mensagens):
${conversationText || "(sem mensagens)"}

REGRAS:
- Para NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- Para WHATSAPP do escritório: use "(86)99447-3226"
- Para EMAIL do escritório: use "contato@prudencioadv.com"
- Formate datas como DD/MM/AAAA
- Extraia TUDO que puder da conversa (nome completo, CPF, RG, endereço, etc.)
- Analise cada mensagem do cliente com atenção para dados pessoais`;

    const tools = [
      {
        type: "function",
        function: {
          name: "process_wjia_command",
          description: "Processa o comando @wjia: escolhe template, extrai dados e identifica dados faltantes",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["generate_document", "unknown"],
                description: "Ação identificada no comando",
              },
              template_token: {
                type: "string",
                description: "Token do template ZapSign escolhido",
              },
              template_name: {
                type: "string",
                description: "Nome do template escolhido",
              },
              signer_name: {
                type: "string",
                description: "Nome completo do signatário (cliente)",
              },
              signer_phone: {
                type: "string",
                description: "Telefone do signatário",
              },
              extracted_fields: {
                type: "array",
                description: "Campos extraídos para preencher o template",
                items: {
                  type: "object",
                  properties: {
                    de: { type: "string", description: "Nome do campo no template (ex: {{NOME_COMPLETO}})" },
                    para: { type: "string", description: "Valor extraído ou vazio se não encontrado" },
                  },
                  required: ["de", "para"],
                },
              },
              missing_fields: {
                type: "array",
                description: "Campos que não foram encontrados e precisam ser pedidos ao cliente",
                items: {
                  type: "object",
                  properties: {
                    field_name: { type: "string" },
                    friendly_name: { type: "string", description: "Nome amigável para perguntar ao cliente" },
                  },
                  required: ["field_name", "friendly_name"],
                },
              },
              message_to_client: {
                type: "string",
                description: "Mensagem para enviar ao cliente pedindo os dados faltantes. Se não houver dados faltantes, mensagem informando que o documento será enviado.",
              },
              message_to_attendant: {
                type: "string",
                description: "Mensagem para mostrar ao atendente sobre o que foi feito",
              },
            },
            required: ["action", "message_to_attendant"],
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
      tool_choice: { type: "function", function: { name: "process_wjia_command" } },
      temperature: 0.1,
    });

    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({
        success: false,
        message: "Não foi possível processar o comando. Tente ser mais específico.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return new Response(JSON.stringify({
        success: false,
        message: "Erro ao processar resposta da IA.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("WJIA command result:", JSON.stringify(parsed));

    // 3) If action is generate_document and we have a template
    if (parsed.action === "generate_document" && parsed.template_token && zapsignToken) {
      // First get template details to know all fields
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

      // If AI didn't extract fields but we have template fields, do a second extraction
      let fieldsData = parsed.extracted_fields || [];
      if (fieldsData.length === 0 && templateFields.length > 0) {
        // Use the existing extract_data logic
        const extractResult = await geminiChat({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Extraia dados para preencher um documento jurídico. Retorne JSON array: [{"de": "{{CAMPO}}", "para": "valor"}]. Use "" para campos não encontrados.`,
            },
            {
              role: "user",
              content: `Campos: ${JSON.stringify(templateFields)}\n\n${crmContext}\n\nCONVERSA:\n${conversationText}`,
            },
          ],
          temperature: 0.1,
        });

        const extractText = extractResult.choices?.[0]?.message?.content || "[]";
        try {
          fieldsData = JSON.parse(extractText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        } catch {
          fieldsData = [];
        }
      }

      // Apply defaults
      if (Array.isArray(fieldsData)) {
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

      // Identify truly missing required fields
      const missingFields = (parsed.missing_fields || []).filter((mf: any) => {
        const found = fieldsData.find((f: any) =>
          f.de?.toUpperCase().includes(mf.field_name?.toUpperCase())
        );
        return !found || !found.para;
      });

      // Create the document
      const signerName = parsed.signer_name || contactData.full_name || leadData.victim_name || "Cliente";
      const signerPhone = parsed.signer_phone || contactData.phone || normalizedPhone;

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
        return new Response(JSON.stringify({
          success: false,
          message: `Erro ao criar documento no ZapSign: ${errText}`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      }).then(r => {
        if (r.error) console.error("Error saving doc:", r.error);
      });

      // Send message to client via WhatsApp
      const inst = instanceRes.data;
      if (inst?.instance_token && signUrl) {
        const missingList = missingFields.length > 0
          ? `\n\n⚠️ *Alguns campos precisam ser preenchidos no formulário:*\n${missingFields.map((f: any) => `• ${f.friendly_name}`).join("\n")}`
          : "";

        const clientMsg = `📝 *Documento para assinatura*\n\nOlá ${signerName.split(" ")[0]}! Segue o link para assinar o documento *${parsed.template_name || "Documento"}*:\n\n👉 ${signUrl}${missingList}\n\n*Instruções:*\n1. Clique no link acima\n${missingFields.length > 0 ? "2. Preencha os campos indicados\n3." : "2."} Confira seus dados e assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;

        const baseUrl = inst.base_url || "https://abraci.uazapi.com";
        await fetch(`${baseUrl}/send/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({ number: normalizedPhone, text: clientMsg }),
        }).catch(e => console.error("Error sending WhatsApp:", e));

        // Also save outbound message
        await supabase.from("whatsapp_messages").insert({
          phone: normalizedPhone,
          instance_name: instance_name,
          contact_name: contactData.full_name || null,
          message_text: clientMsg,
          message_type: "text",
          direction: "outbound",
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          external_message_id: `wjia_doc_${Date.now()}`,
        }).then(r => {
          if (r.error) console.error("Error saving outbound msg:", r.error);
        });
      }

      // Build response for attendant
      const filledCount = fieldsData.filter((f: any) => f.para).length;
      const totalFields = fieldsData.length;
      const attendantMsg = `✅ Documento *${parsed.template_name || "Documento"}* criado com sucesso!\n\n📊 Campos preenchidos: ${filledCount}/${totalFields}\n${missingFields.length > 0 ? `⚠️ Campos para o cliente preencher: ${missingFields.length}\n` : ""}🔗 Link de assinatura enviado ao cliente\n\n${signUrl ? `👁️ Link: ${signUrl}` : ""}`;

      return new Response(JSON.stringify({
        success: true,
        action: "document_created",
        message: attendantMsg,
        sign_url: signUrl,
        doc_token: docData.token,
        filled_fields: filledCount,
        total_fields: totalFields,
        missing_fields: missingFields,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // For unknown actions or no template
    return new Response(JSON.stringify({
      success: true,
      action: parsed.action || "info",
      message: parsed.message_to_attendant || "Comando processado.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("WJIA command error:", error);
    return new Response(JSON.stringify({
      success: false,
      message: `Erro: ${error.message}`,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
