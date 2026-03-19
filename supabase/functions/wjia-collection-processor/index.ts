import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

// CEP lookup via ViaCEP API
async function lookupCEP(cep: string): Promise<{ logradouro?: string; bairro?: string; localidade?: string; uf?: string; cep?: string } | null> {
  const cleanCep = cep.replace(/\D/g, "");
  if (cleanCep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;
    return { logradouro: data.logradouro, bairro: data.bairro, localidade: data.localidade, uf: data.uf, cep: data.cep };
  } catch (e) {
    console.error("CEP lookup error:", e);
    return null;
  }
}

// Reverse CEP lookup - search by address
async function reverseLookupCEP(state: string, city: string, street: string): Promise<Array<{ cep: string; logradouro: string; bairro: string; localidade: string; uf: string }>> {
  try {
    const encodedState = encodeURIComponent(state.trim());
    const encodedCity = encodeURIComponent(city.trim());
    const encodedStreet = encodeURIComponent(street.trim());
    const res = await fetch(`https://viacep.com.br/ws/${encodedState}/${encodedCity}/${encodedStreet}/json/`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 3);
  } catch (e) {
    console.error("Reverse CEP lookup error:", e);
    return [];
  }
}

// Extract CEP from a text message
function extractCEPFromMessage(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}${match[2]}` : null;
}

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

/**
 * Download an external URL and convert to base64 data URI.
 * Critical: the Gemini shared helper converts external URLs to plain text,
 * so the model never sees the actual image without this conversion.
 */
async function urlToBase64DataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("Failed to download image for base64:", resp.status, url);
      return url;
    }
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch (e) {
    console.error("Error converting URL to base64:", e);
    return url;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let { phone, instance_name, message_text, media_url, media_type, message_type } = await req.json();
    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "phone and instance_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === PRE-PROCESS AUDIO: Transcribe audio messages using Gemini ===
    const isAudio = message_type === 'audio' || message_type === 'ptt' || (media_type && media_type.startsWith('audio/'));
    if (isAudio && media_url && !message_text) {
      try {
        console.log("Transcribing audio message via Gemini...");
        const transcriptionResult = await geminiChat({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Você é um transcritor de áudio. Transcreva EXATAMENTE o que a pessoa disse no áudio, sem adicionar nada. Retorne apenas a transcrição literal." },
            {
              role: "user",
              content: [
                { type: "text", text: "Transcreva este áudio:" },
                { type: "image_url", image_url: { url: await urlToBase64DataUri(media_url) } },
              ],
            },
          ],
          temperature: 0.1,
        });

        const transcription = transcriptionResult.choices?.[0]?.message?.content;
        if (transcription && transcription.trim()) {
          message_text = transcription.trim();
          console.log("Audio transcribed:", message_text.substring(0, 100));
        }
      } catch (audioErr) {
        console.error("Audio transcription error:", audioErr);
        // Continue without transcription
      }
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
      .in("status", ["collecting", "collecting_docs", "processing_docs", "ready"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ active_session: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load agent persona if session has agent_id
    let agentPersona = "";
    if ((session as any).agent_id) {
      const { data: agentData } = await supabase
        .from("whatsapp_ai_agents")
        .select("name, base_prompt")
        .eq("id", (session as any).agent_id)
        .maybeSingle();
      if (agentData) {
        agentPersona = `\nPERSONA DO AGENTE (use este tom, estilo e forma de falar):\nNome: ${agentData.name}\n${agentData.base_prompt || ''}\n`;
      }
    }

    console.log("Active collection session found:", session.id, "status:", session.status, "missing:", JSON.stringify(session.missing_fields));

    // === HANDLE CONFIRMATION STATUS ===
    if (session.status === 'ready') {
      const msgLower = (message_text || "").toLowerCase().trim();
      const isConfirmation = /^(sim|confirmo|correto|ok|está certo|tá certo|pode gerar|gerar|isso|exato|confirmar|pode|certo|tudo certo|ta certo|yes|s)/.test(msgLower);

      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token, base_url")
        .eq("instance_name", instance_name)
        .maybeSingle();

      if (isConfirmation) {
        // Client confirmed → move to "ready" and generate
        await supabase
          .from("wjia_collection_sessions")
          .update({ status: "ready", updated_at: new Date().toISOString() })
          .eq("id", session.id);

        // Trigger document generation (same flow as before)
        const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
        const collectedData = session.collected_data || { fields: [] };
        const updatedFields = [...(collectedData.fields || [])];

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

        const signerName = collectedData.signer_name || "Cliente";
        const signerPhone = collectedData.signer_phone || normalizedPhone;

        if (zapsignToken) {
          const createBody = {
            template_id: session.template_token,
            signer_name: signerName,
            signer_phone: signerPhone,
            data: updatedFields.length > 0 ? updatedFields : [{ de: "{{_}}", para: " " }],
          };

          console.log("Creating ZapSign doc after confirmation:", JSON.stringify(createBody));

          const createRes = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
            method: "POST",
            headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(createBody),
          });

          if (createRes.ok) {
            const docData = await createRes.json();
            const signer = docData.signers?.[0];
            const signUrl = signer ? `https://app.zapsign.co/verificar/${signer.token}` : null;

            await supabase
              .from("wjia_collection_sessions")
              .update({ status: "generated", doc_token: docData.token, sign_url: signUrl })
              .eq("id", session.id);

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
              notify_on_signature: session.notify_on_signature !== false,
              send_signed_pdf: session.send_signed_pdf !== false,
            });

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

            console.log("Document generated after confirmation! Doc token:", docData.token);

            // Attach received documents to ZapSign doc
            const receivedDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
            for (const doc of receivedDocs) {
              if (!doc.media_url) continue;
              try {
                // Download the file and convert to base64
                const fileResp = await fetch(doc.media_url);
                if (!fileResp.ok) { console.error("Failed to download doc:", doc.media_url); continue; }
                const fileBuffer = await fileResp.arrayBuffer();
                const base64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
                
                const docTypeLabels: Record<string, string> = {
                  rg_cnh: 'RG_CNH', comprovante_endereco: 'Comprovante_Endereco',
                  comprovante_renda: 'Comprovante_Renda', outros: 'Documento_Anexo',
                };
                const attachName = docTypeLabels[doc.type] || 'Anexo';

                const attachRes = await fetch(`${ZAPSIGN_API_URL}/docs/${docData.token}/add-extra-doc/`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${zapsignToken}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ name: attachName, base64_pdf: base64 }),
                });

                if (attachRes.ok) {
                  console.log(`Attached ${attachName} to doc ${docData.token}`);
                } else {
                  const attachErr = await attachRes.text();
                  console.error(`Failed to attach ${attachName}:`, attachErr);
                }
              } catch (attachErr) {
                console.error("Error attaching document:", attachErr);
              }
            }
          } else {
            const errText = await createRes.text();
            console.error("ZapSign error after confirmation:", errText);
          }
        }

        return new Response(JSON.stringify({
          active_session: true,
          processed: true,
          all_collected: true,
          confirmed: true,
          session_id: session.id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } else {
        // Client wants to correct something → back to collecting
        await supabase
          .from("wjia_collection_sessions")
          .update({ status: "collecting", updated_at: new Date().toISOString() })
          .eq("id", session.id);

        const correctionReply = "Entendi! Me diga qual informação precisa ser corrigida que eu atualizo.";

        if (inst?.instance_token) {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: normalizedPhone, text: correctionReply }),
          }).catch(e => console.error("Error sending correction reply:", e));

          await supabase.from("whatsapp_messages").insert({
            phone: normalizedPhone,
            instance_name,
            message_text: correctionReply,
            message_type: "text",
            direction: "outbound",
            contact_id: session.contact_id || null,
            lead_id: session.lead_id || null,
            external_message_id: `wjia_correct_${Date.now()}`,
          });
        }

        return new Response(JSON.stringify({
          active_session: true,
          processed: true,
          correction_mode: true,
          session_id: session.id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // === HANDLE DOCUMENT COLLECTION STATUS ===
    if (session.status === 'collecting_docs') {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token, base_url")
        .eq("instance_name", instance_name)
        .maybeSingle();

      const receivedDocs = Array.isArray(session.received_documents) ? [...session.received_documents] : [];
      const docTypeLabels: Record<string, string> = {
        rg_cnh: 'RG / CNH',
        comprovante_endereco: 'Comprovante de endereço',
        comprovante_renda: 'Comprovante de renda',
        outros: 'Outros documentos',
      };
      const requestedTypes: string[] = Array.isArray(session.document_types) ? session.document_types : [];

      // Check if client sent an image/document
      const isMedia = media_url && (message_type === 'image' || message_type === 'document');

      if (isMedia) {
        // Use AI to classify the document type
        let assignedType = 'outros';
        const pendingTypes = requestedTypes.filter(t => !receivedDocs.some((d: any) => d.type === t));

        if (pendingTypes.length > 0) {
          try {
             const classifyResult = await geminiChat({
              model: "google/gemini-2.5-pro",
              messages: [
                { role: "system", content: `Você é um classificador de documentos. Analise a imagem e determine qual tipo de documento é.

TIPOS POSSÍVEIS:
- rg_cnh: Documento de identidade (RG, CNH, carteira de identidade, documento com foto e CPF)
- comprovante_endereco: Comprovante de endereço (conta de luz, água, telefone, extrato bancário com endereço, contrato de aluguel)
- comprovante_renda: Comprovante de renda (holerite, contracheque, declaração de IR, extrato bancário de rendimentos, carteira de trabalho com salário)
- outros: Qualquer documento que não se encaixe nos anteriores
- invalido: NÃO é um documento válido (selfie, foto de paisagem, meme, print aleatório, etc.)

TIPOS AINDA PENDENTES: ${pendingTypes.join(', ')}

Classifique o documento enviado.` },
                { role: "user", content: [
                  { type: "text", text: "Classifique este documento:" },
                  { type: "image_url", image_url: { url: await urlToBase64DataUri(media_url) } },
                ]},
              ],
              tools: [{ type: "function", function: { name: "classify_document", description: "Classifica o tipo do documento", parameters: { type: "object", properties: { document_type: { type: "string", enum: ["rg_cnh", "comprovante_endereco", "comprovante_renda", "outros", "invalido"] }, confidence: { type: "string", enum: ["alta", "media", "baixa"] }, description: { type: "string", description: "Breve descrição do que foi identificado na imagem" } }, required: ["document_type", "confidence", "description"] } } }],
              tool_choice: { type: "function", function: { name: "classify_document" } },
              temperature: 0.1,
            });

            const classifyTc = classifyResult.choices?.[0]?.message?.tool_calls?.[0];
            if (classifyTc?.function?.arguments) {
              const classification = JSON.parse(classifyTc.function.arguments);
              console.log("Document classification:", JSON.stringify(classification));

              // Check if document is invalid
              if (classification.document_type === 'invalido') {
                const invalidMsg = `⚠️ *Documento não reconhecido*\n\nO que você enviou não parece ser um documento válido (${classification.description}).\n\nPor favor, envie a foto ou arquivo de: *${pendingTypes.map(t => docTypeLabels[t] || t).join(', ')}*`;

                if (inst?.instance_token) {
                  const baseUrl = inst.base_url || "https://abraci.uazapi.com";
                  await fetch(`${baseUrl}/send/text`, { method: "POST", headers: { "Content-Type": "application/json", token: inst.instance_token }, body: JSON.stringify({ number: normalizedPhone, text: invalidMsg }) }).catch(e => console.error(e));
                  await supabase.from("whatsapp_messages").insert({ phone: normalizedPhone, instance_name, message_text: invalidMsg, message_type: "text", direction: "outbound", contact_id: session.contact_id || null, lead_id: session.lead_id || null, external_message_id: `wjia_invalid_doc_${Date.now()}` });
                }

                return new Response(JSON.stringify({ active_session: true, processed: true, invalid_document: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }

              // Check if the classified type matches a pending type
              if (pendingTypes.includes(classification.document_type)) {
                assignedType = classification.document_type;
              } else if (requestedTypes.includes(classification.document_type) && receivedDocs.some((d: any) => d.type === classification.document_type)) {
                // Already received this type - warn user
                const alreadyMsg = `⚠️ Parece que você enviou outro *${docTypeLabels[classification.document_type] || classification.document_type}*, mas eu já recebi esse tipo de documento.\n\nAinda preciso de: *${pendingTypes.map(t => docTypeLabels[t] || t).join(', ')}*.\n\nPor favor, envie o documento correto.`;

                if (inst?.instance_token) {
                  const baseUrl = inst.base_url || "https://abraci.uazapi.com";
                  await fetch(`${baseUrl}/send/text`, { method: "POST", headers: { "Content-Type": "application/json", token: inst.instance_token }, body: JSON.stringify({ number: normalizedPhone, text: alreadyMsg }) }).catch(e => console.error(e));
                  await supabase.from("whatsapp_messages").insert({ phone: normalizedPhone, instance_name, message_text: alreadyMsg, message_type: "text", direction: "outbound", contact_id: session.contact_id || null, lead_id: session.lead_id || null, external_message_id: `wjia_dup_doc_${Date.now()}` });
                }

                return new Response(JSON.stringify({ active_session: true, processed: true, duplicate_document: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              } else {
                // Type doesn't match any pending - warn but accept as "outros" if pending
                const wrongTypeMsg = `⚠️ O documento enviado parece ser *${classification.description}*, mas estou esperando: *${pendingTypes.map(t => docTypeLabels[t] || t).join(', ')}*.\n\nPor favor, envie o documento correto. Se este é o documento certo, envie novamente.`;

                if (inst?.instance_token) {
                  const baseUrl = inst.base_url || "https://abraci.uazapi.com";
                  await fetch(`${baseUrl}/send/text`, { method: "POST", headers: { "Content-Type": "application/json", token: inst.instance_token }, body: JSON.stringify({ number: normalizedPhone, text: wrongTypeMsg }) }).catch(e => console.error(e));
                  await supabase.from("whatsapp_messages").insert({ phone: normalizedPhone, instance_name, message_text: wrongTypeMsg, message_type: "text", direction: "outbound", contact_id: session.contact_id || null, lead_id: session.lead_id || null, external_message_id: `wjia_wrong_doc_${Date.now()}` });
                }

                return new Response(JSON.stringify({ active_session: true, processed: true, wrong_document_type: true, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }
            }
          } catch (classifyErr) {
            console.error("Document classification error:", classifyErr);
            // Fallback: assign to first pending type
            assignedType = pendingTypes[0];
          }
        }

        receivedDocs.push({
          type: assignedType,
          media_url,
          media_type: media_type || 'image/jpeg',
          received_at: new Date().toISOString(),
        });

        // Always save received doc immediately
        await supabase
          .from("wjia_collection_sessions")
          .update({
            received_documents: receivedDocs,
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id);

        const stillPending = requestedTypes.filter(t => !receivedDocs.some((d: any) => d.type === t));

        if (stillPending.length === 0) {
          // ALL DOCS RECEIVED — use optimistic lock to prevent duplicate processing.
          // Only proceed if status is still 'collecting_docs' (atomic CAS).
          const { data: lockResult } = await supabase
            .from("wjia_collection_sessions")
            .update({ status: "processing_docs", updated_at: new Date().toISOString() })
            .eq("id", session.id)
            .eq("status", "collecting_docs")
            .select("id");

          if (!lockResult || lockResult.length === 0) {
            // Another concurrent call already started processing — skip
            console.log("Skipping duplicate doc processing — another call already handling session:", session.id);
            return new Response(JSON.stringify({
              active_session: true, processed: false, skipped_duplicate: true, session_id: session.id,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          // Re-read session to get ALL received docs (including from concurrent calls)
          const { data: freshSession } = await supabase
            .from("wjia_collection_sessions")
            .select("*")
            .eq("id", session.id)
            .single();

          const allReceivedDocs = Array.isArray(freshSession?.received_documents) ? freshSession.received_documents : receivedDocs;

          console.log("All docs received, extracting data with AI vision... Total docs:", allReceivedDocs.length);

          const collectedData = session.collected_data || { fields: [] };
          const updatedFields = [...(collectedData.fields || [])];
          const requiredFieldCatalog = buildTemplateFieldCatalog(session);
          const missingFields = session.missing_fields || [];

          // Load custom media extraction prompt from shortcut config
          let customExtractionPrompt: string | null = null;
          if (session.shortcut_name) {
            const { data: shortcutConfig } = await supabase
              .from("wjia_command_shortcuts")
              .select("media_extraction_prompt")
              .eq("shortcut_name", session.shortcut_name)
              .maybeSingle();
            customExtractionPrompt = shortcutConfig?.media_extraction_prompt || null;
          }

          // Build image parts for Gemini vision - download and convert to base64
          const rawImageUrls = allReceivedDocs.map((d: any) => d.media_url).filter(Boolean);
          const imageUrls = await Promise.all(rawImageUrls.map((u: string) => urlToBase64DataUri(u)));

          if (imageUrls.length > 0) {
            try {
              const allTemplateFieldNames = requiredFieldCatalog.length > 0
                ? requiredFieldCatalog.map((f) => `${f.variable} (${f.label})`)
                : missingFields.map((f: any) => f.friendly_name || f.field_name);

              const alreadyFilledSummary = updatedFields
                .filter((f: any) => f.para)
                .map((f: any) => `${f.de}: ${f.para}`)
                .join('\n');

              const defaultExtractionPrompt = `Você é um especialista em OCR de documentos brasileiros. Analise CUIDADOSAMENTE as imagens dos documentos enviados e extraia os dados do TITULAR do documento.

ATENÇÃO - REGRAS CRÍTICAS DE IDENTIFICAÇÃO:
1. Em um RG (Carteira de Identidade):
   - O NOME DO TITULAR está no campo "NOME" em letras VERMELHAS/GRANDES no centro do documento
   - O campo "FILIAÇÃO" contém os nomes dos PAIS (pai e mãe) - NÃO confunda com o nome do titular
   - O nome no rodapé "ASSINATURA DO TITULAR" é a assinatura manuscrita do próprio titular
   - No verso do RG, o nome que aparece junto a "DIRETORA/DIRETOR" é do funcionário do órgão emissor, NÃO do titular
   - O CPF do titular aparece no verso do RG
   - O campo "NATURALIDADE" indica a cidade/estado onde a pessoa nasceu - extraia para campos de naturalidade
   - O campo "DATA DE NASCIMENTO" ou "NASCIMENTO" contém a data de nascimento
2. Em uma CNH:
   - O NOME DO TITULAR está no campo "NOME" ou "Nome"
   - FILIAÇÃO são os pais
   - O campo "LOCAL DE NASCIMENTO" indica a naturalidade
3. O OUTORGANTE/SIGNATÁRIO é SEMPRE o TITULAR do documento (cujo NOME aparece em destaque)
4. NATURALIDADE: Extraia o local de nascimento do documento e preencha campos de NATURALIDADE com esse dado`;

              const extractPrompt = `${customExtractionPrompt || defaultExtractionPrompt}

CAMPOS QUE PRECISO PREENCHER:
${allTemplateFieldNames.map((f: string) => `- ${f}`).join('\n')}

DADOS JÁ COLETADOS (não sobrescreva a menos que esteja claramente errado):
${alreadyFilledSummary || '(nenhum)'}

REGRAS DE FORMATAÇÃO:
- NOME COMPLETO: Use o nome do TITULAR do documento (campo "NOME"), NUNCA os nomes da filiação
- Para NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- Para NATURALIDADE: use o local de nascimento que aparece no documento (cidade/UF)
- Formate datas como DD/MM/AAAA
- Formate CPF como XXX.XXX.XXX-XX
- No campo "de", use EXATAMENTE a variável do template (ex: {{NOME_COMPLETO}}, {{CPF}})
- Leia CADA CARACTERE com cuidado - documentos antigos podem ter texto desgastado
- Se não conseguir ler com certeza, NÃO invente - deixe em branco`;

              const visionMessages: any[] = [
                { role: "system", content: extractPrompt },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Extraia os dados destes documentos:" },
                    ...imageUrls.map((url: string) => ({
                      type: "image_url",
                      image_url: { url },
                    })),
                  ],
                },
              ];

              const extractTools = [{
                type: "function",
                function: {
                  name: "extracted_document_data",
                  description: "Dados extraídos dos documentos enviados",
                  parameters: {
                    type: "object",
                    properties: {
                      extracted_fields: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            de: { type: "string", description: "Variável do template (ex: {{NOME_COMPLETO}})" },
                            para: { type: "string", description: "Valor extraído do documento" },
                          },
                          required: ["de", "para"],
                        },
                      },
                      signer_name: { type: "string", description: "Nome completo extraído" },
                    },
                    required: ["extracted_fields"],
                  },
                },
              }];

              const visionResult = await geminiChat({
                model: "google/gemini-2.5-pro",
                messages: visionMessages,
                tools: extractTools,
                tool_choice: { type: "function", function: { name: "extracted_document_data" } },
                temperature: 0.1,
              });

              const visionToolCall = visionResult.choices?.[0]?.message?.tool_calls?.[0];
              if (visionToolCall?.function?.arguments) {
                const extractedData = JSON.parse(visionToolCall.function.arguments);
                console.log("Vision extraction result:", JSON.stringify(extractedData));

                // Merge extracted fields into collected data — always overwrite with document data
                for (const field of (extractedData.extracted_fields || [])) {
                  if (!field.de || !field.para) continue;
                  const canonicalVariable = resolveTemplateVariable(field, requiredFieldCatalog) || field.de;
                  upsertCollectedField(updatedFields, canonicalVariable, field.para);
                }

                // Update signer name if extracted
                if (extractedData.signer_name) {
                  collectedData.signer_name = extractedData.signer_name;
                }
              }
            } catch (visionErr) {
              console.error("Vision extraction error:", visionErr);
              // Continue even if vision fails
            }
          }

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

          // Compute what's still missing after extraction
          const actuallyMissing = computeMissingRequiredFields(requiredFieldCatalog, updatedFields, { skipOptional: true });
          const updatedCollectedData = { ...collectedData, fields: updatedFields };

          const filledSummary = updatedFields
            .filter((f: any) => f.para)
            .map((f: any) => `• *${(f.de || '').replace(/\{\{|\}\}/g, '')}*: ${f.para}`)
            .join('\n');
          const docsSummary = allReceivedDocs.map((d: any) => `• ✅ ${docTypeLabels[d.type] || d.type}`).join('\n');
          const conflictWarning = '';

          if (actuallyMissing.length > 0) {
            // Still missing fields → move to "collecting" to ask the rest
            const missingNames = actuallyMissing.map((f: any) => f.friendly_name || f.field_name).join(', ');
            const extractedCount = updatedFields.filter((f: any) => f.para).length;

            const afterExtractMsg = `✅ *Documentos recebidos e analisados!*\n\n📊 Consegui extrair *${extractedCount}* dados dos documentos:\n${filledSummary}\n\nDocumentos anexos:\n${docsSummary}${conflictWarning}\n\n⚠️ Ainda preciso que informe: *${missingNames}*\n\nPor favor, me envie esses dados.`;

            await supabase
              .from("wjia_collection_sessions")
              .update({
                collected_data: updatedCollectedData,
                received_documents: allReceivedDocs,
                missing_fields: actuallyMissing,
                status: "collecting",
                updated_at: new Date().toISOString(),
              })
              .eq("id", session.id);

            if (inst?.instance_token) {
              const baseUrl = inst.base_url || "https://abraci.uazapi.com";
              await fetch(`${baseUrl}/send/text`, {
                method: "POST",
                headers: { "Content-Type": "application/json", token: inst.instance_token },
                body: JSON.stringify({ number: normalizedPhone, text: afterExtractMsg }),
              }).catch(e => console.error("Error sending extract msg:", e));

              await supabase.from("whatsapp_messages").insert({
                phone: normalizedPhone, instance_name,
                message_text: afterExtractMsg, message_type: "text", direction: "outbound",
                contact_id: session.contact_id || null, lead_id: session.lead_id || null,
                external_message_id: `wjia_extract_${Date.now()}`,
              });
            }

            return new Response(JSON.stringify({
              active_session: true, processed: true,
              docs_received: receivedDocs.length, extracted_fields: updatedFields.filter((f: any) => f.para).length,
              still_missing: actuallyMissing.length, session_id: session.id,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

          } else {
            // ALL data extracted from docs → go to confirmation (ready)
            const summaryMsg = `✅ *Documentos recebidos e dados extraídos com sucesso!*\n\nConfira as informações para o documento *${session.template_name}*:\n\n${filledSummary}\n\nDocumentos anexos:\n${docsSummary}${conflictWarning}\n\n📋 Está tudo correto? Responda *SIM* para gerar o documento ou me diga o que precisa corrigir.`;

            await supabase
              .from("wjia_collection_sessions")
              .update({
                collected_data: updatedCollectedData,
                received_documents: allReceivedDocs,
                missing_fields: [],
                status: "ready",
                updated_at: new Date().toISOString(),
              })
              .eq("id", session.id);

            if (inst?.instance_token) {
              const baseUrl = inst.base_url || "https://abraci.uazapi.com";
              await fetch(`${baseUrl}/send/text`, {
                method: "POST",
                headers: { "Content-Type": "application/json", token: inst.instance_token },
                body: JSON.stringify({ number: normalizedPhone, text: summaryMsg }),
              }).catch(e => console.error("Error sending ready msg:", e));

              await supabase.from("whatsapp_messages").insert({
                phone: normalizedPhone, instance_name,
                message_text: summaryMsg, message_type: "text", direction: "outbound",
                contact_id: session.contact_id || null, lead_id: session.lead_id || null,
                external_message_id: `wjia_ready_${Date.now()}`,
              });
            }

            return new Response(JSON.stringify({
              active_session: true, processed: true, all_collected: true,
              docs_received: receivedDocs.length, session_id: session.id,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }

        // Not all docs received yet
        await supabase
          .from("wjia_collection_sessions")
          .update({
            received_documents: receivedDocs,
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id);

        const pendingNames = stillPending.map(t => docTypeLabels[t] || t).join(', ');
        replyMsg = `✅ *Documento recebido: ${docTypeLabels[assignedType]}*\n\nAinda falta: ${pendingNames}.\nPor favor, envie a foto ou arquivo.`;

        if (inst?.instance_token) {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: normalizedPhone, text: replyMsg }),
          }).catch(e => console.error("Error sending doc reply:", e));

          await supabase.from("whatsapp_messages").insert({
            phone: normalizedPhone, instance_name,
            message_text: replyMsg, message_type: "text", direction: "outbound",
            contact_id: session.contact_id || null, lead_id: session.lead_id || null,
            external_message_id: `wjia_doc_${Date.now()}`,
          });
        }

        return new Response(JSON.stringify({
          active_session: true, processed: true,
          docs_received: receivedDocs.length,
          docs_pending: stillPending.length,
          session_id: session.id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } else {
        // Text message during doc collection - check if it's a "done" or question
        const msgLower = (message_text || "").toLowerCase().trim();
        const isSkip = /^(pular|n[aã]o tenho|n[aã]o possuo|depois|skip)/.test(msgLower);
        
        if (isSkip) {
          // Skip remaining docs — extract from whatever was received, then move to collecting for missing fields
          const collectedData = session.collected_data || { fields: [] };
          const updatedFields = [...(collectedData.fields || [])];
          const requiredFieldCatalog = buildTemplateFieldCatalog(session);

          // Extract from any docs already received
          const imageUrls = await Promise.all(receivedDocs.map((d: any) => d.media_url).filter(Boolean).map((u: string) => urlToBase64DataUri(u)));
          if (imageUrls.length > 0) {
            try {
              const allTemplateFieldNames = requiredFieldCatalog.map((f) => `${f.variable} (${f.label})`);
              
              const defaultSkipExtractionPrompt = `Você é um especialista em OCR de documentos brasileiros. Analise CUIDADOSAMENTE as imagens dos documentos enviados e extraia os dados do TITULAR do documento.

ATENÇÃO - REGRAS CRÍTICAS DE IDENTIFICAÇÃO:
1. Em um RG (Carteira de Identidade):
   - O NOME DO TITULAR está no campo "NOME" em letras VERMELHAS/GRANDES no centro do documento
   - O campo "FILIAÇÃO" contém os nomes dos PAIS (pai e mãe) - NÃO confunda com o nome do titular
   - No verso do RG, o nome que aparece junto a "DIRETORA/DIRETOR" é do funcionário do órgão emissor, NÃO do titular
   - O CPF do titular aparece no verso do RG
2. Em uma CNH:
   - O NOME DO TITULAR está no campo "NOME" ou "Nome"
   - FILIAÇÃO são os pais`;

              const extractPrompt = `${customExtractionPrompt || defaultSkipExtractionPrompt}\n\nCAMPOS NECESSÁRIOS:\n${allTemplateFieldNames.map((f: string) => `- ${f}`).join('\n')}\n\nREGRAS:\n- Extraia nome, CPF, RG, data de nascimento, endereço, etc.\n- Formate CPF como XXX.XXX.XXX-XX e datas como DD/MM/AAAA\n- Use EXATAMENTE as variáveis do template no campo "de"`;

              const visionResult = await geminiChat({
                model: "google/gemini-2.5-pro",
                messages: [
                  { role: "system", content: extractPrompt },
                  { role: "user", content: [
                    { type: "text", text: "Extraia os dados:" },
                    ...imageUrls.map((url: string) => ({ type: "image_url", image_url: { url } })),
                  ]},
                ],
                tools: [{ type: "function", function: { name: "extracted_document_data", description: "Dados extraídos", parameters: { type: "object", properties: { extracted_fields: { type: "array", items: { type: "object", properties: { de: { type: "string" }, para: { type: "string" } }, required: ["de", "para"] } }, signer_name: { type: "string" } }, required: ["extracted_fields"] } } }],
                tool_choice: { type: "function", function: { name: "extracted_document_data" } },
                temperature: 0.1,
              });

              const tc = visionResult.choices?.[0]?.message?.tool_calls?.[0];
              if (tc?.function?.arguments) {
                const extracted = JSON.parse(tc.function.arguments);
                for (const field of (extracted.extracted_fields || [])) {
                  if (!field.de || !field.para) continue;
                  const cv = resolveTemplateVariable(field, requiredFieldCatalog) || field.de;
                  upsertCollectedField(updatedFields, cv, field.para);
                }
                if (extracted.signer_name) collectedData.signer_name = extracted.signer_name;
              }
            } catch (e) { console.error("Vision extract on skip:", e); }
          }

          // Apply defaults
          for (const field of updatedFields) {
            const fn = (field.de || "").replace(/\{\{|\}\}/g, "").toUpperCase().trim();
            if (fn.includes("EMAIL") && !field.para) field.para = "contato@prudencioadv.com";
            if (fn.includes("WHATSAPP") && !field.para) field.para = "(86)99447-3226";
          }

          const actuallyMissing = computeMissingRequiredFields(requiredFieldCatalog, updatedFields, { skipOptional: true });
          const updatedCollectedData = { ...collectedData, fields: updatedFields };

          if (actuallyMissing.length > 0) {
            // Still missing → move to collecting
            const missingNames = actuallyMissing.map((f: any) => f.friendly_name).join(', ');
            const filledSummary = updatedFields.filter((f: any) => f.para).map((f: any) => `• *${(f.de || '').replace(/\{\{|\}\}/g, '')}*: ${f.para}`).join('\n');
            const skipMsg = `Ok! ${receivedDocs.length > 0 ? `Extraí dados dos documentos recebidos.\n\n${filledSummary}\n\n` : ''}⚠️ Ainda preciso que informe: *${missingNames}*`;

            await supabase.from("wjia_collection_sessions").update({
              collected_data: updatedCollectedData, received_documents: receivedDocs,
              missing_fields: actuallyMissing, status: "collecting", updated_at: new Date().toISOString(),
            }).eq("id", session.id);

            if (inst?.instance_token) {
              const baseUrl = inst.base_url || "https://abraci.uazapi.com";
              await fetch(`${baseUrl}/send/text`, { method: "POST", headers: { "Content-Type": "application/json", token: inst.instance_token }, body: JSON.stringify({ number: normalizedPhone, text: skipMsg }) }).catch(e => console.error(e));
              await supabase.from("whatsapp_messages").insert({ phone: normalizedPhone, instance_name, message_text: skipMsg, message_type: "text", direction: "outbound", contact_id: session.contact_id || null, lead_id: session.lead_id || null, external_message_id: `wjia_skip_${Date.now()}` });
            }
          } else {
            // All extracted → ready
            const filledSummary = updatedFields.filter((f: any) => f.para).map((f: any) => `• *${(f.de || '').replace(/\{\{|\}\}/g, '')}*: ${f.para}`).join('\n');
            const docsSummary = receivedDocs.length > 0 ? '\n\nDocumentos anexos:\n' + receivedDocs.map((d: any) => `• ✅ ${docTypeLabels[d.type] || d.type}`).join('\n') : '';
            const skipMsg = `✅ *Dados extraídos dos documentos!*\n\n${filledSummary}${docsSummary}\n\n📋 Está tudo correto? Responda *SIM* para gerar o documento.`;

            await supabase.from("wjia_collection_sessions").update({
              collected_data: updatedCollectedData, received_documents: receivedDocs,
              missing_fields: [], status: "ready", updated_at: new Date().toISOString(),
            }).eq("id", session.id);

            if (inst?.instance_token) {
              const baseUrl = inst.base_url || "https://abraci.uazapi.com";
              await fetch(`${baseUrl}/send/text`, { method: "POST", headers: { "Content-Type": "application/json", token: inst.instance_token }, body: JSON.stringify({ number: normalizedPhone, text: skipMsg }) }).catch(e => console.error(e));
              await supabase.from("whatsapp_messages").insert({ phone: normalizedPhone, instance_name, message_text: skipMsg, message_type: "text", direction: "outbound", contact_id: session.contact_id || null, lead_id: session.lead_id || null, external_message_id: `wjia_skip_${Date.now()}` });
            }
          }

          return new Response(JSON.stringify({
            active_session: true, processed: true, skipped_docs: true, session_id: session.id,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Otherwise remind to send docs
        const pendingTypes = requestedTypes.filter(t => !receivedDocs.some((d: any) => d.type === t));
        const pendingNames = pendingTypes.map(t => docTypeLabels[t] || t).join(', ');
        const reminderMsg = `📎 Ainda preciso que envie: *${pendingNames}*.\n\nEnvie a foto ou arquivo do documento. Se não tiver agora, digite *pular* para continuar sem.`;

        if (inst?.instance_token) {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: normalizedPhone, text: reminderMsg }),
          }).catch(e => console.error("Error sending reminder:", e));

          await supabase.from("whatsapp_messages").insert({
            phone: normalizedPhone, instance_name,
            message_text: reminderMsg, message_type: "text", direction: "outbound",
            contact_id: session.contact_id || null, lead_id: session.lead_id || null,
            external_message_id: `wjia_remind_${Date.now()}`,
          });
        }

        return new Response(JSON.stringify({
          active_session: true, processed: true, awaiting_docs: true, session_id: session.id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Fetch instance info (needed for replies and doc sending)
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("instance_name", instance_name)
      .maybeSingle();

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

    // === PRE-AI CEP LOOKUP ===
    // Detect CEP in client's message and lookup address before AI processes
    let cepLookupContext = "";
    const detectedCEP = extractCEPFromMessage(message_text || "");
    if (detectedCEP) {
      const cepData = await lookupCEP(detectedCEP);
      if (cepData) {
        console.log("Pre-AI CEP lookup result:", JSON.stringify(cepData));
        cepLookupContext = `\n\n🔍 RESULTADO DA BUSCA DE CEP (${detectedCEP}):
- Rua/Logradouro: ${cepData.logradouro || "(não encontrado)"}
- Bairro: ${cepData.bairro || "(não encontrado)"}
- Cidade: ${cepData.localidade || "(não encontrado)"}
- Estado: ${cepData.uf || "(não encontrado)"}
INSTRUÇÃO: Apresente este endereço ao cliente e PERGUNTE SE ESTÁ CORRETO antes de prosseguir. Exemplo: "Achei seu endereço pelo CEP: [rua], [bairro], [cidade]-[UF]. Tá certinho? Só preciso do número e complemento."
Se o cliente CONFIRMAR, extraia todos os campos de endereço nos newly_extracted. Se NEGAR, peça o endereço correto.`;
      } else {
        cepLookupContext = `\n\n⚠️ CEP ${detectedCEP} não foi encontrado na base de dados. Informe ao cliente que o CEP não foi localizado e peça para verificar ou informar o endereço completo manualmente.`;
      }
    }

    // Check if client is saying they don't know their CEP - try reverse lookup from collected data
    const msgLowerCheck = (message_text || "").toLowerCase();
    const dontKnowCEP = msgLowerCheck.match(/n[aã]o\s+sei\s+(o\s+)?(meu\s+)?cep|n[aã]o\s+lembro\s+(o\s+)?(meu\s+)?cep|qual\s+(é\s+)?(o\s+)?meu\s+cep|n[aã]o\s+tenho\s+cep/);
    if (dontKnowCEP && !detectedCEP) {
      // Check if we have city/state/street in collected data to do reverse lookup
      const collectedFields = collectedData.fields || [];
      let collectedCity = "";
      let collectedState = "";
      let collectedStreet = "";
      for (const f of collectedFields) {
        const key = normalizeFieldKey(f.de || f.field_name || "");
        if (key.includes("CIDADE") || key.includes("MUNICIPIO")) collectedCity = f.para || "";
        if (key.includes("ESTADO") || key === "UF") collectedState = f.para || "";
        if (key.includes("RUA") || key.includes("LOGRADOURO") || key.includes("ENDERECO")) collectedStreet = f.para || "";
      }
      
      if (collectedState && collectedCity && collectedStreet) {
        const reverseResults = await reverseLookupCEP(collectedState, collectedCity, collectedStreet);
        if (reverseResults.length > 0) {
          const resultLines = reverseResults.map(r => `  CEP ${r.cep}: ${r.logradouro}, ${r.bairro}`).join("\n");
          cepLookupContext = `\n\n🔍 BUSCA REVERSA DE CEP (pela rua "${collectedStreet}" em ${collectedCity}/${collectedState}):
${resultLines}
INSTRUÇÃO: Apresente os CEPs encontrados ao cliente de forma natural e pergunte qual é o dele. Ex: "Achei alguns CEPs pra sua rua: [lista]. Qual desses é o seu?"`;
          console.log("Reverse CEP lookup results:", JSON.stringify(reverseResults));
        }
      } else {
        cepLookupContext = `\n\n📍 O cliente não sabe o CEP. Pergunte a rua, cidade e estado para que possamos buscar o CEP. Ex: "Sem problema! Me passa a rua, cidade e estado que eu procuro pra você."`;
      }
    }

    const systemPrompt = `Você é um assistente de coleta de dados para um escritório de advocacia. Está coletando informações do cliente para preencher um documento "${session.template_name}".
${agentPersona}

DADOS JÁ COLETADOS:
${JSON.stringify(collectedData.fields || [], null, 2)}

DADOS QUE AINDA FALTAM:
${missingFields.map((f: any) => `- ${f.friendly_name} (${f.field_name})`).join("\n")}

LISTA COMPLETA DE CAMPOS DO TEMPLATE (todos são OBRIGATÓRIOS):
${[...alreadyCollected, ...allTemplateFields].map((f: string) => `- ${f}`).join("\n")}

CONVERSA RECENTE:
${conversationText}

MENSAGEM ATUAL DO CLIENTE: "${message_text || ""}"
${cepLookupContext}

REGRAS:
- Analise a mensagem atual E a conversa recente para extrair QUALQUER dado que corresponda aos campos faltantes
- Se o cliente mandou nome completo, CPF, RG, endereço, etc., extraia tudo
- Para NACIONALIDADE: se tem CPF brasileiro, use "brasileiro(a)"
- Formate datas como DD/MM/AAAA
- No campo "de", use EXATAMENTE a variável do template (ex: {{CEP}}, {{E-mail}}). NUNCA use o valor do cliente no campo "de"
- Seja educado e natural na conversa
- Se o cliente informar um dado diferente de algo já coletado, simplesmente ATUALIZE com o novo valor sem questionar. O cliente sempre tem razão.
- NUNCA questione ou sinalize divergências/conflitos de dados. Aceite o que o cliente diz como verdade.

REGRA CRÍTICA - NOME COMPLETO:
- Se o documento (RG/CNH) já extraiu o NOME COMPLETO, USE SEMPRE O NOME COMPLETO do documento.
- Se o cliente responder apenas com o primeiro nome (ex: "Kemly"), isso é uma CONFIRMAÇÃO, NÃO uma correção. NÃO extraia esse nome parcial nos newly_extracted.
- Só extraia um novo NOME_COMPLETO se o cliente EXPLICITAMENTE corrigir com um nome completo diferente e MAIS LONGO que o atual.
- Exemplo: documento extraiu "KEMLY RAYANE DA SILVA" e cliente disse "Kemly" → NÃO extraia NOME_COMPLETO. O nome completo já está correto.
- Exemplo: cliente disse "meu nome é Maria Kemly Santos" → extraia "Maria Kemly Santos" pois é uma correção explícita.

REGRA CRÍTICA - ENDEREÇO E CEP:
- Quando o sistema fornecer resultado de busca de CEP (logradouro, bairro, cidade, UF), use EXATAMENTE esses dados do resultado.
- NÃO invente ou modifique o endereço. Se a busca retornou "Rua dos Andradas" use "Rua dos Andradas", não "Avenida João 23".
- O campo ENDERECO_COMPLETO deve conter APENAS o logradouro retornado pelo CEP + número/complemento informado pelo cliente.
- Se o cliente ainda não informou número, NÃO adicione "sem número". Pergunte o número.

REGRA CRÍTICA - NUNCA RE-PERGUNTE DADOS JÁ COLETADOS:
- Se um dado JÁ ESTÁ nos "DADOS JÁ COLETADOS" acima (ex: NOME_COMPLETO, CPF), NUNCA pergunte novamente ao cliente.
- Dados extraídos de documentos (RG, CNH) são CONFIÁVEIS. Não peça confirmação de nome/CPF se já foram extraídos.
- Foque APENAS nos campos que REALMENTE faltam na lista "DADOS QUE AINDA FALTAM".

REGRA CRÍTICA - PEÇA TODOS OS DADOS FALTANTES DE UMA VEZ COM RESUMO:
- Quando precisar pedir dados ao cliente, faça um RESUMO mostrando o que já tem e o que falta.
- Formate assim de forma NATURAL (sem parecer robô):
  "Até agora tenho:
  ✅ Nome: João da Silva
  ✅ CPF: 123.456.789-00
  ✅ RG: 12345678
  
  Ainda preciso de:
  ❌ Estado civil
  ❌ Profissão
  ❌ Endereço completo com CEP
  ❌ Número da identidade
  
  Me manda tudo que puder de uma vez!"
- Use esse formato SEMPRE que pedir dados faltantes. Isso ajuda o cliente a ver o progresso.
- NÃO peça um dado por vez. Isso é lento e frustrante para o cliente.
- Só marque all_collected como true se ABSOLUTAMENTE TODOS os campos listados acima tiverem valores preenchidos
- Se TODOS os dados foram coletados, diga que vai preparar o documento

REGRAS DE AUTO-PREENCHIMENTO (aplique SEMPRE):
- DATA DE ASSINATURA / DATA DA PROCURAÇÃO / DATA ATUAL: SEMPRE preencha com a data de HOJE (${new Date().toLocaleDateString('pt-BR')}). NUNCA pergunte ao cliente.
- CIDADE/LOCAL DE ASSINATURA / CIDADE DA PROCURAÇÃO: É SEMPRE a mesma cidade do endereço do cliente. NUNCA pergunte separadamente.
- ESTADO DE ASSINATURA / UF DA PROCURAÇÃO: É SEMPRE o mesmo estado do endereço do cliente. NUNCA pergunte separadamente.
- NATURALIDADE: Se o documento de identidade (RG/CNH) contém o local de nascimento, use esse dado. Se não, infira da cidade de nascimento se disponível. Se o campo "NATURALIDADE" está faltando e você tem o local de nascimento do documento, preencha automaticamente.
- Quando o cliente informar o CEP, o sistema JÁ BUSCOU o endereço (veja acima). APRESENTE ao cliente e peça confirmação + número/complemento. SÓ extraia os campos de endereço se o cliente CONFIRMAR.
- Se o cliente não souber o CEP, peça rua, cidade e estado para buscar. Se já tiver esses dados coletados, o sistema já fez a busca reversa (veja acima).
- Quando o cliente confirmar o endereço do CEP, extraia TODOS os campos de endereço (rua, bairro, cidade, estado, CEP) nos newly_extracted de uma vez.`;

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
              description: "Mensagem para enviar ao cliente. Quando pedir dados faltantes, SEMPRE liste o que já tem (✅) e o que falta (❌) de forma natural e humana.",
            },
          },
          required: ["newly_extracted", "still_missing", "all_collected", "reply_to_client"],
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

    // Always accept client data as authoritative — no conflict detection

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

      // PROTEÇÃO DE NOME COMPLETO: Se o campo é NOME e já existe um nome mais longo, não sobrescrever com nome parcial
      const targetKey = normalizeFieldKey(targetVariable.toString());
      if (targetKey.includes("NOME") && targetKey.includes("COMPLET")) {
        const existing = updatedFields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(targetVariable.toString()));
        if (existing && hasFieldValue(existing.para)) {
          const existingName = (existing.para || "").toString().trim();
          const newName = (newField.para || "").toString().trim();
          // Se o nome existente tem mais palavras que o novo, manter o existente (é mais completo)
          const existingWords = existingName.split(/\s+/).length;
          const newWords = newName.split(/\s+/).length;
          if (existingWords > newWords) {
            console.log(`NOME PROTEGIDO: mantendo "${existingName}" em vez de "${newName}"`);
            continue;
          }
        }
      }

      upsertCollectedField(updatedFields, targetVariable.toString(), newField.para);
    }

    // === CEP AUTO-LOOKUP: auto-fill address fields from CEP ===
    const cepField = updatedFields.find((f: any) => {
      const key = normalizeFieldKey(f.de || f.field_name || "");
      return key.includes("CEP") && hasFieldValue(f.para);
    });

    if (cepField) {
      const cepData = await lookupCEP(cepField.para);
      if (cepData) {
        console.log("CEP lookup result:", JSON.stringify(cepData));
        
        // Build full address string for ENDERECO_COMPLETO fields
        const fullAddressFromCEP = [cepData.logradouro, cepData.bairro, cepData.localidade, cepData.uf ? `${cepData.localidade}-${cepData.uf}` : null]
          .filter(Boolean).join(", ");

        const addressMappings = [
          { patterns: ["ENDERECOCOMPLETO", "ENDERECOCOMPLETODARESIDENCIA"], value: cepData.logradouro, forceOverwrite: true },
          { patterns: ["RUA", "LOGRADOURO"], value: cepData.logradouro, forceOverwrite: true },
          { patterns: ["BAIRRO"], value: cepData.bairro, forceOverwrite: true },
          { patterns: ["CIDADE", "MUNICIPIO", "CIDADERESIDENCIA", "CIDADEDAPROCURACAO", "CIDADEASSINATURA", "LOCAL"], value: cepData.localidade, forceOverwrite: true },
          { patterns: ["ESTADO", "UF", "ESTADORESIDENCIA", "ESTADODAPROCURACAO", "UFASSINATURA"], value: cepData.uf, forceOverwrite: true },
        ];

        for (const mapping of addressMappings) {
          if (!mapping.value) continue;
          for (const templateField of requiredFieldCatalog) {
            const normKey = templateField.normalized;
            if (mapping.patterns.some(p => normKey.includes(p) || normKey === p)) {
              // ALWAYS overwrite address fields with CEP data — CEP API is authoritative
              upsertCollectedField(updatedFields, templateField.variable, mapping.value);
              console.log(`CEP auto-filled (overwrite): ${templateField.variable} = ${mapping.value}`);
            }
          }
        }
      }
    }

    // === AUTO-FILL: signing date = today ===
    const today = new Date().toLocaleDateString('pt-BR');
    for (const templateField of requiredFieldCatalog) {
      const normKey = templateField.normalized;
      const isDateField = (normKey.includes("DATA") && (normKey.includes("ASSINATURA") || normKey.includes("PROCURACAO") || normKey.includes("ATUAL") || normKey.includes("HOJE")));
      if (isDateField) {
        const existing = updatedFields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(templateField.variable));
        if (!existing || !hasFieldValue(existing.para)) {
          upsertCollectedField(updatedFields, templateField.variable, today);
          console.log(`Auto-filled date: ${templateField.variable} = ${today}`);
        }
      }
    }

    // === AUTO-FILL: signing city/state = client address city/state ===
    const clientCity = updatedFields.find((f: any) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("CIDADE") || k.includes("MUNICIPIO")) && !k.includes("ASSINATURA") && !k.includes("PROCURACAO") && hasFieldValue(f.para);
    });
    const clientState = updatedFields.find((f: any) => {
      const k = normalizeFieldKey(f.de || "");
      return (k.includes("ESTADO") || k === "UF") && !k.includes("ASSINATURA") && !k.includes("PROCURACAO") && hasFieldValue(f.para);
    });

    if (clientCity || clientState) {
      for (const templateField of requiredFieldCatalog) {
        const normKey = templateField.normalized;
        const isSigningCity = (normKey.includes("CIDADE") || normKey.includes("LOCAL") || normKey.includes("MUNICIPIO")) && (normKey.includes("ASSINATURA") || normKey.includes("PROCURACAO"));
        const isSigningState = (normKey.includes("ESTADO") || normKey.includes("UF")) && (normKey.includes("ASSINATURA") || normKey.includes("PROCURACAO"));

        if (isSigningCity && clientCity) {
          const existing = updatedFields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(templateField.variable));
          if (!existing || !hasFieldValue(existing.para)) {
            upsertCollectedField(updatedFields, templateField.variable, clientCity.para);
            console.log(`Auto-filled signing city: ${templateField.variable} = ${clientCity.para}`);
          }
        }
        if (isSigningState && clientState) {
          const existing = updatedFields.find((f: any) => normalizeFieldKey(f.de || "") === normalizeFieldKey(templateField.variable));
          if (!existing || !hasFieldValue(existing.para)) {
            upsertCollectedField(updatedFields, templateField.variable, clientState.para);
            console.log(`Auto-filled signing state: ${templateField.variable} = ${clientState.para}`);
          }
        }
      }
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
      .join(", ");
    const correctionMsg = `Ainda preciso de alguns dados para completar o documento: ${missingNames}. Poderia me informar?`;

    // === CONFIRMATION STEP ===
    // When all data is collected, show summary and ask for confirmation before generating
    if (finalAllCollected) {
      // Check if client just confirmed
      const msgLower = (message_text || "").toLowerCase().trim();
      const isConfirmation = /^(sim|confirmo|correto|ok|está certo|tá certo|pode gerar|gerar|isso|exato|confirmar|pode|certo|tudo certo|ta certo)/.test(msgLower);
      
      if (session.status === 'collecting') {
        // First time all data collected
        const summaryLines = updatedFields
          .filter((f: any) => f.para)
          .map((f: any) => {
            const label = (f.de || '').replace(/\{\{|\}\}/g, '');
            return `• *${label}*: ${f.para}`;
          }).join('\n');

        // Check if we need to collect documents (only if not already collected in docs-first flow)
        const alreadyReceivedDocs = Array.isArray(session.received_documents) && session.received_documents.length > 0;
        const needsDocs = session.request_documents && Array.isArray(session.document_types) && session.document_types.length > 0 && !alreadyReceivedDocs;
        const docTypeLabels: Record<string, string> = {
          rg_cnh: 'RG / CNH',
          comprovante_endereco: 'Comprovante de endereço',
          comprovante_renda: 'Comprovante de renda',
          outros: 'Outros documentos',
        };

        if (needsDocs) {
          // Move to collecting_docs phase
          const docNames = session.document_types.map((t: string) => docTypeLabels[t] || t).join('\n• ');
          const docsMsg = `✅ *Todos os dados foram coletados!*\n\n${summaryLines}\n\n📎 Agora preciso que envie os seguintes documentos:\n• ${docNames}\n\nEnvie a *foto ou arquivo* de cada documento. Se não tiver algum agora, digite *pular*.`;

          await supabase
            .from("wjia_collection_sessions")
            .update({
              collected_data: updatedCollectedData,
              missing_fields: [],
              status: "collecting_docs",
              updated_at: new Date().toISOString(),
            })
            .eq("id", session.id);

          if (inst?.instance_token) {
            const baseUrl = inst.base_url || "https://abraci.uazapi.com";
            await fetch(`${baseUrl}/send/text`, {
              method: "POST",
              headers: { "Content-Type": "application/json", token: inst.instance_token },
              body: JSON.stringify({ number: normalizedPhone, text: docsMsg }),
            }).catch(e => console.error("Error sending docs request:", e));

            await supabase.from("whatsapp_messages").insert({
              phone: normalizedPhone, instance_name,
              message_text: docsMsg, message_type: "text", direction: "outbound",
              contact_id: session.contact_id || null, lead_id: session.lead_id || null,
              external_message_id: `wjia_docs_req_${Date.now()}`,
            });
          }

          return new Response(JSON.stringify({
            active_session: true, processed: true, all_collected: true,
            collecting_docs: true, session_id: session.id,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // No docs needed → go straight to confirmation (ready)
        const summaryMsg = `✅ *Todos os dados foram coletados!*\n\nConfira as informações antes de gerar o documento *${session.template_name}*:\n\n${summaryLines}\n\n📋 Está tudo correto? Responda *SIM* para gerar o documento ou me diga o que precisa corrigir.`;

        const { error: setReadyError } = await supabase
          .from("wjia_collection_sessions")
          .update({
            collected_data: updatedCollectedData,
            missing_fields: [],
            status: "ready",
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id);

        if (setReadyError) {
          console.error("Error setting WJIA session to ready:", setReadyError);
        }

        if (inst?.instance_token) {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: normalizedPhone, text: summaryMsg }),
          }).catch(e => console.error("Error sending summary:", e));

          await supabase.from("whatsapp_messages").insert({
            phone: normalizedPhone, instance_name,
            message_text: summaryMsg, message_type: "text", direction: "outbound",
            contact_id: session.contact_id || null, lead_id: session.lead_id || null,
            external_message_id: `wjia_summary_${Date.now()}`,
          });
        }

        return new Response(JSON.stringify({
          active_session: true, processed: true, all_collected: true,
          awaiting_confirmation: true, session_id: session.id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Not all collected yet → normal flow
    const replyToClient = result.all_collected ? correctionMsg : (result.reply_to_client || correctionMsg);

    // Fetch instance info (needed for replies)
    await supabase
      .from("wjia_collection_sessions")
      .update({
        collected_data: updatedCollectedData,
        missing_fields: actuallyMissing,
        status: "collecting",
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

    return new Response(JSON.stringify({
      active_session: true,
      processed: true,
      all_collected: finalAllCollected,
      session_id: session.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Collection processor error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
