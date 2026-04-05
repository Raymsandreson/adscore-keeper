/**
 * Handler: Regenerate Session (MODE 0)
 * Handles action="regenerate_session" or "force_generate" with a session_id.
 * Re-extracts data from conversation, generates ZapSign document, sends link.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../../_shared/gemini.ts";
import {
  applyConfiguredPredefinedFields,
  applyDefaults,
  applyZapSignSettings,
  autoFillDates,
  autoSyncCityState,
  buildTemplateFieldCatalog,
  convertImageToPdf,
  filterOnlyAutoFilledData,
  sendWhatsApp,
  updateSignerSettings,
  ZAPSIGN_API_URL,
} from "../../_shared/wjia-utils.ts";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  RESOLVED_SERVICE_ROLE_KEY,
  RESOLVED_SUPABASE_URL,
} from "./shared.ts";

export async function handleRegenerate(payload: {
  session_id: string;
  phone?: string;
}) {
  const { session_id, phone } = payload;
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
  const normalizedPhone = (phone || session.phone || "").replace(/\D/g, "").replace(/^0+/, "");

  // If phone is provided, re-extract data from conversation
  if (phone && session.instance_name) {
    try {
      const { data: recentMsgs } = await supabase
        .from("whatsapp_messages")
        .select("direction, message_text, created_at")
        .eq("phone", normalizedPhone.length > 8 ? normalizedPhone : session.phone)
        .eq("instance_name", session.instance_name)
        .order("created_at", { ascending: false })
        .limit(30);

      if (recentMsgs && recentMsgs.length > 0) {
        const conversationText = recentMsgs.reverse()
          .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.message_text || ''}`)
          .filter((t: string) => t.includes(': ') && !t.endsWith(': '))
          .join("\n");

        const templateFields = (collectedData.fields || []).map((f: any) => f.de).join(", ");
        const extractResult = await geminiChat({
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
            const fieldMap = new Map<string, string>();
            for (const f of (collectedData.fields || [])) {
              if (f.de && f.para) fieldMap.set(f.de, f.para);
            }
            for (const f of extracted.fields) {
              if (f.de && f.para && f.para.trim()) fieldMap.set(f.de, f.para);
            }
            collectedData.fields = Array.from(fieldMap.entries()).map(([de, para]) => ({ de, para }));

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
  const nomeCompletoField = fieldsData.find((f: any) => /NOME.?COMPLETO/i.test(f.de));
  const signerName = collectedData.signer_name !== "Cliente" && collectedData.signer_name ? collectedData.signer_name : (nomeCompletoField?.para?.trim() || collectedData.signer_name || "Cliente");
  const signerPhone = collectedData.signer_phone || session.phone;

  // Get instance token
  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("instance_token, owner_name")
    .eq("instance_name", session.instance_name)
    .maybeSingle();

  const cleanPhone = (signerPhone || "").replace(/\D/g, "");
  const phoneCountry = cleanPhone.startsWith("55") ? "55" : cleanPhone.substring(0, 2);
  const phoneNumber = cleanPhone.startsWith("55") ? cleanPhone.substring(2) : cleanPhone;

  // Load ZapSign settings from shortcut
  let zSettings: any = null;
  if (session.shortcut_name) {
    const { data: sc } = await supabase.from("wjia_command_shortcuts")
      .select("zapsign_settings").eq("shortcut_name", session.shortcut_name).maybeSingle();
    zSettings = sc?.zapsign_settings || null;
  }

  const regenerationCatalog = buildTemplateFieldCatalog(session);
  applyDefaults(fieldsData);
  const predefinedKeysRegen = applyConfiguredPredefinedFields(fieldsData, regenerationCatalog, zSettings, { phone: normalizedPhone });
  const dateKeysRegen = autoFillDates(fieldsData, regenerationCatalog);
  const syncKeysRegen = autoSyncCityState(fieldsData, regenerationCatalog);
  const autoKeysRegen = new Set([...predefinedKeysRegen, ...dateKeysRegen, ...syncKeysRegen]);

  // Send ALL collected fields (AI + auto) to ZapSign — client reviews in editable form
  const autoFilledData = fieldsData.filter((f: any) =>
    f?.de && f?.para && String(f.para).trim().length > 0 && f.para !== " "
  );

  const cpfField = fieldsData.find((f: any) => /CPF/i.test(f.de));
  const receivedDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
  const rgDoc = receivedDocs.find((d: any) => d.doc_type === "rg_cnh" && d.media_url);

  const createBody: any = {
    template_id: session.template_token,
    signer_name: signerName,
    signer_phone_country: phoneCountry,
    signer_phone_number: phoneNumber,
    data: autoFilledData.length > 0 ? autoFilledData : [{ de: "{{_}}", para: " " }],
    signer_has_incomplete_fields: true,
  };

  applyZapSignSettings(createBody, zSettings, {
    cpfValue: cpfField?.para || undefined,
    leadId: session.lead_id || undefined,
    documentPhotoUrl: rgDoc?.media_url || undefined,
  });

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

  const signerTokenRegen = zData.signers?.[0]?.token;
  const signUrl = signerTokenRegen
    ? `https://app.zapsign.co/verificar/${signerTokenRegen}`
    : zData.signers?.[0]?.sign_url || zData.sign_url || null;
  const docToken = zData.token || null;

  // Apply signer-level settings
  if (signerTokenRegen && zapsignToken) {
    await updateSignerSettings(signerTokenRegen, zapsignToken, zSettings, {
      cpfValue: cpfField?.para || undefined,
      documentPhotoUrl: rgDoc?.media_url || undefined,
    });
  }

  // Update session
  await supabase.from("wjia_collection_sessions").update({
    status: "generated",
    sign_url: signUrl,
    doc_token: docToken,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  // Attach received documents as extra docs
  for (const doc of receivedDocs) {
    if (!doc.media_url) continue;
    try {
      const fileResp = await fetch(doc.media_url);
      if (!fileResp.ok) continue;
      const fileBuffer = await fileResp.arrayBuffer();
      const ct = fileResp.headers.get("content-type") || "";
      let base64: string | null = null;
      if (ct.startsWith("image/")) {
        base64 = await convertImageToPdf(fileBuffer, ct);
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
    const msg = `📄 *${session.template_name}* (atualizado)\n\n🔗 Clique para preencher e assinar:\n${signUrl}\n\nSe faltar algum dado, pode preencher direto no formulário! 😉`;
    await sendWhatsApp(
      supabase, inst, session.phone, session.instance_name,
      msg, session.contact_id, session.lead_id, "wjia_regenerate",
    );
  }

  return jsonResponse({ success: true, sign_url: signUrl, doc_token: docToken });
}
