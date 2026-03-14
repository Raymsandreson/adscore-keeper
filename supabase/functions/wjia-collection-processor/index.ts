import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

type TemplateFieldRef = {
  variable: string;
  label: string;
  normalized: string;
};

const normalizeFieldKey = (value: string): string =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\{\{|\}\}/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase()
    .trim();

const hasFieldValue = (value: any): boolean => value !== null && value !== undefined && value.toString().trim().length > 0;

const isOptionalFieldKey = (normalizedKey: string): boolean =>
  normalizedKey.includes("EMAIL") || normalizedKey.includes("WHATSAPP");

function buildTemplateFieldCatalog(session: any): TemplateFieldRef[] {
  const required = Array.isArray(session?.required_fields) ? session.required_fields : [];
  const fromRequired = required
    .filter((f: any) => f && (f.required ?? true))
    .map((f: any) => {
      const variable = (f.variable || "").toString().trim();
      const label = (f.label || variable || "").toString().trim();
      const normalized = normalizeFieldKey(variable || label);
      return { variable: variable || label, label, normalized };
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

function resolveTemplateVariable(field: any, catalog: TemplateFieldRef[]): string | null {
  const candidates = [field?.field_name, field?.de, field?.friendly_name]
    .map((v: any) => (v || "").toString().trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeFieldKey(candidate);
    if (!normalizedCandidate) continue;

    const exact = catalog.find((f) => f.normalized === normalizedCandidate);
    if (exact) return exact.variable;

    const partial = catalog.find(
      (f) => f.normalized.includes(normalizedCandidate) || normalizedCandidate.includes(f.normalized),
    );
    if (partial) return partial.variable;
  }

  return null;
}

function inferVariableFromValue(value: any, catalog: TemplateFieldRef[]): string | null {
  const raw = (value || "").toString().trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  const pick = (matcher: (field: TemplateFieldRef) => boolean) => catalog.find(matcher)?.variable || null;

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return pick((f) => f.normalized.includes("EMAIL"));
  }

  if (/^\d{5}-?\d{3}$/.test(raw) || digits.length === 8) {
    return pick((f) => f.normalized.includes("CEP"));
  }

  if (digits.length === 11) {
    return pick((f) => f.normalized.includes("CPF"));
  }

  if (/^[A-Za-z]{2}$/.test(raw)) {
    return pick((f) => f.normalized === "ESTADO" || f.normalized.endsWith("ESTADO") || f.normalized.startsWith("ESTADO"));
  }

  return null;
}

function upsertCollectedField(fields: any[], targetVariable: string, value: any) {
  const targetKey = normalizeFieldKey(targetVariable);
  if (!targetKey || !hasFieldValue(value)) return;

  const existingIdx = fields.findIndex((f: any) => normalizeFieldKey((f?.de || f?.field_name || "").toString()) === targetKey);
  if (existingIdx >= 0) {
    fields[existingIdx].de = targetVariable;
    fields[existingIdx].para = value;
    return;
  }

  fields.push({ de: targetVariable, para: value });
}

function computeMissingRequiredFields(
  catalog: TemplateFieldRef[],
  fields: any[],
  options?: { skipOptional?: boolean },
) {
  return catalog
    .filter((requiredField) => {
      if (options?.skipOptional && isOptionalFieldKey(requiredField.normalized)) return false;

      const found = fields.find((f: any) => {
        const fKey = normalizeFieldKey((f?.de || f?.field_name || "").toString());
        return fKey === requiredField.normalized && hasFieldValue(f?.para);
      });

      return !found;
    })
    .map((f) => ({ field_name: f.variable, friendly_name: f.label || f.variable }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, message_text } = await req.json();
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "phone and instance_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");

    // Find active collection session for this phone
    const { data: session } = await supabase
      .from("wjia_collection_sessions")
      .select("*")
      .eq("phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .eq("status", "collecting")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ active_session: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Active collection session found:", session.id, "missing:", JSON.stringify(session.missing_fields));

    // Get recent conversation for context
    const { data: recentMsgs } = await supabase
      .from("whatsapp_messages")
      .select("direction, message_text, created_at")
      .eq("phone", normalizedPhone)
      .order("created_at", { ascending: false })
      .limit(20);

    const conversationText = (recentMsgs || [])
      .reverse()
      .filter((m: any) => m.message_text)
      .map((m: any) => `[${m.direction === "outbound" ? "Robô" : "Cliente"}]: ${m.message_text}`)
      .join("\n");

    const collectedData = session.collected_data || { fields: [] };
    const missingFields = session.missing_fields || [];
    const requiredFieldCatalog = buildTemplateFieldCatalog(session);

    // Use AI to extract data from the client's message
    const allTemplateFields = requiredFieldCatalog.length > 0
      ? requiredFieldCatalog.map((f) => `${f.variable} (${f.label})`)
      : (session.missing_fields || []).map((f: any) => f.friendly_name || f.field_name);

    const alreadyCollected = (collectedData.fields || [])
      .map((f: any) => resolveTemplateVariable(f, requiredFieldCatalog) || f.de)
      .filter(Boolean);

    const systemPrompt = `Você é um assistente de coleta de dados para um escritório de advocacia. Está coletando informações do cliente para preencher um documento "${session.template_name}".

DADOS JÁ COLETADOS:
${JSON.stringify(collectedData.fields || [], null, 2)}

DADOS QUE AINDA FALTAM:
${missingFields.map((f: any) => `- ${f.friendly_name} (${f.field_name})`).join("\n")}

LISTA COMPLETA DE CAMPOS DO TEMPLATE (todos são OBRIGATÓRIOS):
${[...alreadyCollected, ...allTemplateFields].map((f: string) => `- ${f}`).join("\n")}

CONVERSA RECENTE:
${conversationText}

MENSAGEM ATUAL DO CLIENTE: "${message_text || ""}"

REGRAS:
- Analise a mensagem atual E a conversa recente para extrair QUALQUER dado que corresponda aos campos faltantes
- Se o cliente mandou nome completo, CPF, RG, endereço, etc., extraia tudo
- Para NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- Formate datas como DD/MM/AAAA
- No campo "de", use EXATAMENTE a variável do template (ex: {{CEP}}, {{E-mail}}). NUNCA use o valor do cliente no campo "de"
- Seja educado e natural na conversa
- Se ainda faltam dados após esta mensagem, peça os próximos de forma natural (não todos de uma vez, máximo 3 por vez)
- IMPORTANTE: Só marque all_collected como true se ABSOLUTAMENTE TODOS os campos listados acima tiverem valores preenchidos
- Se TODOS os dados foram coletados, diga que vai preparar o documento`;

    const tools = [{
      type: "function",
      function: {
        name: "process_client_data",
        description: "Processa dados do cliente e determina próximo passo",
        parameters: {
          type: "object",
          properties: {
            newly_extracted: {
              type: "array",
              description: "Campos extraídos desta mensagem",
              items: {
                type: "object",
                properties: {
                  field_name: { type: "string" },
                  de: { type: "string", description: "Nome do campo no template (ex: {{NOME_COMPLETO}})" },
                  para: { type: "string", description: "Valor extraído" },
                },
                required: ["field_name", "de", "para"],
              },
            },
            still_missing: {
              type: "array",
              description: "Campos que AINDA faltam após esta extração",
              items: {
                type: "object",
                properties: {
                  field_name: { type: "string" },
                  friendly_name: { type: "string" },
                },
                required: ["field_name", "friendly_name"],
              },
            },
            all_collected: {
              type: "boolean",
              description: "true se TODOS os dados necessários foram coletados",
            },
            reply_to_client: {
              type: "string",
              description: "Mensagem para enviar ao cliente (agradecendo dados e pedindo próximos, ou confirmando que vai gerar o doc)",
            },
          },
          required: ["newly_extracted", "still_missing", "all_collected", "reply_to_client"],
        },
      },
    }];

    const aiResult = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message_text || "(mensagem vazia)" },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "process_client_data" } },
      temperature: 0.2,
    });

    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("AI failed to process client data");
      return new Response(JSON.stringify({ active_session: true, processed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: any;
    try {
      result = JSON.parse(toolCall.function.arguments);
    } catch {
      return new Response(JSON.stringify({ active_session: true, processed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Collection result:", JSON.stringify(result));

    // Update collected data using template-variable normalization
    const updatedFields = [...(collectedData.fields || [])];

    for (const existingField of (collectedData.fields || [])) {
      const canonicalVariable =
        resolveTemplateVariable(existingField, requiredFieldCatalog) ||
        inferVariableFromValue(existingField?.para, requiredFieldCatalog);

      if (canonicalVariable && hasFieldValue(existingField?.para)) {
        upsertCollectedField(updatedFields, canonicalVariable, existingField.para);
      }
    }

    for (const newField of (result.newly_extracted || [])) {
      const canonicalVariable =
        resolveTemplateVariable(newField, requiredFieldCatalog) ||
        inferVariableFromValue(newField?.para, requiredFieldCatalog);

      const targetVariable = canonicalVariable || newField?.de || newField?.field_name;
      if (!targetVariable || !hasFieldValue(newField?.para)) continue;

      if (!canonicalVariable) {
        const targetKey = normalizeFieldKey(targetVariable.toString());
        const valueKey = normalizeFieldKey(newField.para.toString());
        if (targetKey === valueKey) continue;
      }

      upsertCollectedField(updatedFields, targetVariable.toString(), newField.para);
    }

    const updatedCollectedData = {
      ...collectedData,
      fields: updatedFields,
      signer_name: collectedData.signer_name,
      signer_phone: collectedData.signer_phone,
    };

    const pendingFieldCatalog: TemplateFieldRef[] = (missingFields || [])
      .map((f: any) => {
        const variable =
          resolveTemplateVariable(f, requiredFieldCatalog) ||
          (f?.field_name || f?.friendly_name || "").toString().trim();
        const label = (f?.friendly_name || f?.field_name || variable).toString().trim();
        return { variable, label, normalized: normalizeFieldKey(variable || label) };
      })
      .filter((f) => f.variable && f.normalized);

    const validationCatalog = pendingFieldCatalog.length > 0 ? pendingFieldCatalog : requiredFieldCatalog;
    const actuallyMissing = computeMissingRequiredFields(validationCatalog, updatedFields, {
      skipOptional: pendingFieldCatalog.length === 0,
    });
    const finalAllCollected = actuallyMissing.length === 0;

    if (!finalAllCollected && result.all_collected) {
      console.log("SERVER VALIDATION: AI said all_collected but these fields are still empty:", JSON.stringify(actuallyMissing));
    }

    const missingNames = actuallyMissing
      .map((f: any) => f.friendly_name || f.field_name)
      .slice(0, 4)
      .join(", ");
    const correctionMsg = `Ainda preciso de alguns dados para completar o documento: ${missingNames}. Poderia me informar?`;

    const replyToClient = finalAllCollected
      ? (result.reply_to_client || "Obrigado(a)! Todos os dados foram coletados. Vou preparar o documento.")
      : (result.all_collected ? correctionMsg : (result.reply_to_client || correctionMsg));

    // Fetch instance info (needed for replies)
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("instance_name", instance_name)
      .maybeSingle();

    await supabase
      .from("wjia_collection_sessions")
      .update({
        collected_data: updatedCollectedData,
        missing_fields: actuallyMissing,
        status: finalAllCollected ? "ready" : "collecting",
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    if (inst?.instance_token && replyToClient) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";
      await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: inst.instance_token },
        body: JSON.stringify({ number: normalizedPhone, text: replyToClient }),
      }).catch(e => console.error("Error sending reply:", e));

      await supabase.from("whatsapp_messages").insert({
        phone: normalizedPhone,
        instance_name,
        message_text: replyToClient,
        message_type: "text",
        direction: "outbound",
        contact_id: session.contact_id || null,
        lead_id: session.lead_id || null,
        external_message_id: `wjia_collect_reply_${Date.now()}`,
      });
    }

    // If all data collected, generate the document!
    if (finalAllCollected && zapsignToken) {
      console.log("All data collected! Generating document for session:", session.id);

      // Apply defaults
      for (const field of updatedFields) {
        const fieldName = (field.de || "").replace(/\{\{|\}\}/g, "").toUpperCase().trim();
        if ((fieldName === "EMAIL" || fieldName.includes("EMAIL")) && !field.para) {
          field.para = "contato@prudencioadv.com";
        }
        if ((fieldName === "WHATSAPP" || fieldName.includes("WHATSAPP")) && !field.para) {
          field.para = "(86)99447-3226";
        }
      }

      const signerName = updatedCollectedData.signer_name || "Cliente";
      const signerPhone = updatedCollectedData.signer_phone || normalizedPhone;

      const createBody = {
        template_id: session.template_token,
        signer_name: signerName,
        signer_phone: signerPhone,
        data: updatedFields.length > 0 ? updatedFields : [{ de: "{{_}}", para: " " }],
      };

      console.log("Creating ZapSign doc:", JSON.stringify(createBody));

      const createRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
      });

      if (createRes.ok) {
        const docData = await createRes.json();
        const signer = docData.signers?.[0];
        const signUrl = signer ? `https://app.zapsign.co/verificar/${signer.token}` : null;

        // Update session
        await supabase
          .from("wjia_collection_sessions")
          .update({ status: "generated", doc_token: docData.token, sign_url: signUrl })
          .eq("id", session.id);

        // Save doc to zapsign_documents
        await supabase.from("zapsign_documents").insert({
          doc_token: docData.token,
          template_id: session.template_token,
          document_name: session.template_name || "Documento",
          status: docData.status || "pending",
          original_file_url: docData.original_file || null,
          sign_url: signUrl,
          signer_name: signerName,
          signer_token: signer?.token || null,
          signer_phone: signerPhone,
          signer_status: signer?.status || "new",
          template_data: updatedFields,
          lead_id: session.lead_id || null,
          contact_id: session.contact_id || null,
          sent_via_whatsapp: true,
          whatsapp_phone: normalizedPhone,
        });

        // Send sign link to client
        if (inst?.instance_token && signUrl) {
          const signMsg = `📝 *Documento pronto para assinatura!*\n\nOlá ${signerName.split(" ")[0]}! O documento *${session.template_name}* está pronto.\n\n👉 Clique para assinar: ${signUrl}\n\n*Instruções:*\n1. Clique no link\n2. Confira seus dados\n3. Assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;

          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: normalizedPhone, text: signMsg }),
          }).catch(e => console.error("Error sending sign link:", e));

          await supabase.from("whatsapp_messages").insert({
            phone: normalizedPhone,
            instance_name,
            message_text: signMsg,
            message_type: "text",
            direction: "outbound",
            contact_id: session.contact_id || null,
            lead_id: session.lead_id || null,
            external_message_id: `wjia_sign_${Date.now()}`,
          });
        }

        console.log("Document generated and sent! Doc token:", docData.token);
      } else {
        const errText = await createRes.text();
        console.error("ZapSign error:", errText);
      }
    }

    return new Response(JSON.stringify({
      active_session: true,
      processed: true,
      all_collected: finalAllCollected,
      session_id: session.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Collection processor error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
