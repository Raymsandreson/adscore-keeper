/**
 * ZapSign API utilities: settings, document generation, signer updates, document processing.
 */

import {
  type TemplateFieldRef,
  normalizeFieldKey,
  hasFieldValue,
  buildTemplateFieldCatalog,
  getFieldLabel,
  computeMissingFields,
} from "./field-utils.ts";
import {
  applyDefaults,
  applyConfiguredPredefinedFields,
  autoFillDates,
  autoSyncCityState,
} from "./autofill-utils.ts";
import { sendWhatsApp } from "./whatsapp-utils.ts";

// ============================================================
// CONSTANTS
// ============================================================

export const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

export const DOC_TYPE_LABELS: Record<string, string> = {
  rg_cnh: "RG / CNH (documento com foto)",
  comprovante_endereco: "Comprovante de endereço",
  comprovante_renda: "Comprovante de renda",
  outros: "Outros documentos",
};

// ============================================================
// SETTINGS INTERFACE
// ============================================================

export interface ZapSignSettings {
  brand_logo?: string;
  brand_primary_color?: string;
  brand_name?: string;
  require_cpf?: boolean;
  validate_cpf?: boolean;
  lock_name?: boolean;
  lock_phone?: boolean;
  lock_email?: boolean;
  require_selfie_photo?: boolean;
  require_document_photo?: boolean;
  selfie_validation_type?: string;
  folder_path?: string;
  date_limit_days?: number;
  redirect_link?: string;
  observers?: string[];
  send_automatic_whatsapp?: boolean;
  send_automatic_whatsapp_signed_file?: boolean;
  predefined_fields?: Array<{
    field: string;
    mode?: "today" | "brazilian_nationality" | "fixed_value";
    value?: string;
  }>;
}

// ============================================================
// DOCUMENT-LEVEL SETTINGS
// ============================================================

export function applyZapSignSettings(
  createBody: any,
  settings: ZapSignSettings | null | undefined,
  options?: {
    cpfValue?: string;
    leadId?: string;
    leadName?: string;
    documentPhotoUrl?: string;
  },
): any {
  if (!settings) return createBody;

  if (settings.brand_logo) createBody.brand_logo = settings.brand_logo;
  if (settings.brand_primary_color) createBody.brand_primary_color = settings.brand_primary_color;
  if (settings.brand_name) createBody.brand_name = settings.brand_name;
  if (settings.folder_path) {
    let fp = settings.folder_path;
    if (options?.leadName) fp = fp.replace("{{LEAD_NAME}}", options.leadName);
    createBody.folder_path = fp;
  }
  if (settings.date_limit_days && settings.date_limit_days > 0) {
    const d = new Date();
    d.setDate(d.getDate() + settings.date_limit_days);
    createBody.date_limit_to_sign = d.toISOString().split("T")[0];
  }
  if (settings.observers?.length) createBody.observers = settings.observers;
  if (options?.leadId) createBody.external_id = options.leadId;
  if (settings.redirect_link) createBody.redirect_link = settings.redirect_link;
  if (settings.send_automatic_whatsapp) createBody.send_automatic_whatsapp = true;
  if (settings.send_automatic_whatsapp_signed_file) {
    createBody.send_automatic_whatsapp_signed_file = true;
  }

  return createBody;
}

// ============================================================
// SIGNER-LEVEL SETTINGS (post-creation)
// ============================================================

export async function updateSignerSettings(
  signerToken: string,
  zapsignApiToken: string,
  settings: ZapSignSettings | null | undefined,
  options?: {
    cpfValue?: string;
    documentPhotoUrl?: string;
  },
): Promise<void> {
  if (!settings || !signerToken) return;

  const signerUpdate: Record<string, any> = {};

  if (settings.lock_name) signerUpdate.lock_name = true;
  if (settings.lock_phone) signerUpdate.lock_phone = true;
  if (settings.lock_email) signerUpdate.lock_email = true;
  if (settings.require_cpf) signerUpdate.require_cpf = true;
  if (settings.validate_cpf) signerUpdate.validate_cpf = true;
  if (options?.cpfValue) signerUpdate.cpf = options.cpfValue;
  if (settings.require_selfie_photo) signerUpdate.require_selfie_photo = true;
  if (settings.require_document_photo) signerUpdate.require_document_photo = true;
  if (settings.selfie_validation_type) {
    signerUpdate.selfie_validation_type = settings.selfie_validation_type;
  }
  if (options?.documentPhotoUrl) {
    signerUpdate.document_photo_url = options.documentPhotoUrl;
  }

  if (Object.keys(signerUpdate).length === 0) return;

  console.log(`Updating signer ${signerToken} with settings:`, JSON.stringify(signerUpdate));

  try {
    const res = await fetch(`${ZAPSIGN_API_URL}/signers/${signerToken}/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zapsignApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(signerUpdate),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Failed to update signer settings: ${errText}`);
    } else {
      console.log(`Signer ${signerToken} settings updated successfully`);
    }
  } catch (err) {
    console.error("Error updating signer settings:", err);
  }
}

// ============================================================
// AUTO-FILL DATA FILTERING
// ============================================================

export function filterOnlyAutoFilledData(
  allFields: any[],
  autoFilledKeys: Set<string>,
): any[] {
  return allFields.filter((f: any) => {
    if (!f?.de || !f?.para || !f.para.trim() || f.para === " ") return false;
    const key = normalizeFieldKey(f.de);
    return autoFilledKeys.has(key);
  });
}

// ============================================================
// IMAGE → PDF CONVERSION
// ============================================================

export async function convertImageToPdf(
  fileBuffer: ArrayBuffer,
  contentType: string,
): Promise<string | null> {
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
      x: (595 - dims.width * scale) / 2,
      y: (842 - dims.height * scale) / 2,
      width: dims.width * scale,
      height: dims.height * scale,
    });
    const pdfBytes = await pdfDoc.save();
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < pdfBytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...pdfBytes.subarray(i, Math.min(i + chunkSize, pdfBytes.length)),
      );
    }
    return btoa(binary);
  } catch (e) {
    console.error("PDF conversion error:", e);
    return null;
  }
}

// ============================================================
// DOCUMENT GENERATION (full flow)
// ============================================================

export async function generateZapSignDocument(
  supabase: any,
  session: any,
  fields: any[],
  signerName: string,
  signerPhone: string,
  normalizedPhone: string,
  instanceName: string,
  inst: any,
  zapsignToken: string,
) {
  applyDefaults(fields);

  // Load ZapSign settings from shortcut if available
  let zSettingsUtil: any = null;
  if (session.shortcut_name) {
    const { data: scUtil } = await supabase.from("wjia_command_shortcuts")
      .select("zapsign_settings").eq("shortcut_name", session.shortcut_name)
      .maybeSingle();
    zSettingsUtil = scUtil?.zapsign_settings || null;
  }

  // Extract phone country code and number per ZapSign API spec
  const cleanPhone = (signerPhone || "").replace(/\D/g, "");
  const phoneCountry = cleanPhone.startsWith("55") ? "55" : cleanPhone.substring(0, 2);
  const phoneNumber = cleanPhone.startsWith("55") ? cleanPhone.substring(2) : cleanPhone;

  const sessionCatalog = buildTemplateFieldCatalog(session);
  const predefinedKeysUtil = applyConfiguredPredefinedFields(fields, sessionCatalog, zSettingsUtil, { phone: cleanPhone });
  const dateKeysUtil = autoFillDates(fields, sessionCatalog);
  const syncKeysUtil = autoSyncCityState(fields, sessionCatalog);
  const autoKeysUtil = new Set([...predefinedKeysUtil, ...dateKeysUtil, ...syncKeysUtil]);

  // Only send auto-filled fields to ZapSign — client fills the rest in the form
  const autoFilledDataUtil = filterOnlyAutoFilledData(fields, autoKeysUtil);

  const filledFields = fields.filter((f: any) =>
    f?.de && f?.para && f.para.trim() !== "" && f.para !== " "
  );
  const finalMissingFields = computeMissingFields(sessionCatalog, filledFields);

  // Extract CPF from fields and document photo from received docs
  const cpfFieldUtil = fields.find((f: any) => /CPF/i.test(f.de));
  const rcvDocs = Array.isArray(session.received_documents) ? session.received_documents : [];
  const rgDocUtil = rcvDocs.find((d: any) => d.doc_type === "rg_cnh" && d.media_url);

  const createBody: any = {
    template_id: session.template_token,
    signer_name: signerName,
    ...(phoneCountry && { signer_phone_country: phoneCountry }),
    ...(phoneNumber && { signer_phone_number: phoneNumber }),
    data: autoFilledDataUtil.length > 0 ? autoFilledDataUtil : [{ de: "{{_}}", para: " " }],
    signer_has_incomplete_fields: true,
  };

  applyZapSignSettings(createBody, zSettingsUtil, {
    cpfValue: cpfFieldUtil?.para || undefined,
    leadId: session.lead_id || undefined,
    documentPhotoUrl: rgDocUtil?.media_url || undefined,
  });

  console.log("Creating ZapSign doc:", JSON.stringify(createBody));

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
    return null;
  }

  const docData = await createRes.json();
  const signer = docData.signers?.[0];
  const signUrl = signer
    ? `https://app.zapsign.co/verificar/${signer.token}`
    : null;

  // Apply signer-level settings via update-signer API
  if (signer?.token) {
    await updateSignerSettings(signer.token, zapsignToken, zSettingsUtil, {
      cpfValue: cpfFieldUtil?.para || undefined,
      documentPhotoUrl: rgDocUtil?.media_url || undefined,
    });
  }

  await supabase.from("wjia_collection_sessions")
    .update({
      status: "generated",
      doc_token: docData.token,
      sign_url: signUrl,
    })
    .eq("id", session.id);

  // Resolve the user who owns this instance to set created_by
  let createdByUserId: string | null = null;
  if (instanceName) {
    const { data: instRow } = await supabase
      .from("whatsapp_instances")
      .select("id")
      .eq("instance_name", instanceName)
      .eq("is_active", true)
      .maybeSingle();
    if (instRow?.id) {
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("default_instance_id", instRow.id)
        .maybeSingle();
      createdByUserId = ownerProfile?.user_id || null;
    }
  }

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
    template_data: fields,
    lead_id: session.lead_id || null,
    contact_id: session.contact_id || null,
    sent_via_whatsapp: true,
    whatsapp_phone: normalizedPhone,
    notify_on_signature: session.notify_on_signature !== false,
    send_signed_pdf: session.send_signed_pdf !== false,
    instance_name: instanceName,
    created_by: createdByUserId,
  });

  // Attach received documents
  const receivedDocs = Array.isArray(session.received_documents)
    ? session.received_documents
    : [];
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
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode(
            ...bytes.subarray(i, Math.min(i + 8192, bytes.length)),
          );
        }
        base64 = btoa(bin);
      }
      if (!base64) continue;
      const typeLabels: Record<string, string> = {
        rg_cnh: "RG_CNH",
        comprovante_endereco: "Comprovante_Endereco",
        comprovante_renda: "Comprovante_Renda",
      };
      await fetch(`${ZAPSIGN_API_URL}/docs/${docData.token}/upload-extra-doc/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${zapsignToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: typeLabels[doc.type] || "Anexo",
          base64_pdf: base64,
        }),
      });
    } catch (e) {
      console.error("Attach error:", e);
    }
  }

  // Send sign link to client
  if (signUrl) {
    const signMsg = `📝 *Documento pronto para assinatura!*\n\nOlá ${
      signerName.split(" ")[0]
    }! O documento *${session.template_name}* está pronto.\n\n👉 Clique para assinar: ${signUrl}\n\n*Instruções:*\n1. Clique no link\n2. Confira seus dados\n3. Assine digitalmente\n\nQualquer dúvida, estou à disposição! 🙏`;
    await sendWhatsApp(
      supabase,
      inst,
      normalizedPhone,
      instanceName,
      signMsg,
      session.contact_id,
      session.lead_id,
      "wjia_sign",
    );
  }

  // Auto-send collected docs + summary to WhatsApp group
  try {
    let groupId: string | null = null;
    if (session.lead_id) {
      const { data: leadG } = await supabase.from("leads").select(
        "whatsapp_group_id",
      ).eq("id", session.lead_id).maybeSingle();
      groupId = leadG?.whatsapp_group_id || null;
    }
    if (!groupId && session.contact_id) {
      const { data: contactG } = await supabase.from("contacts").select(
        "whatsapp_group_id",
      ).eq("id", session.contact_id).maybeSingle();
      groupId = contactG?.whatsapp_group_id || null;
    }

    if (groupId && inst?.instance_token) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";

      for (const doc of receivedDocs) {
        if (!doc.media_url) continue;
        const typeLabel = DOC_TYPE_LABELS[doc.type] || doc.type;
        try {
          await fetch(`${baseUrl}/send/media`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              token: inst.instance_token,
            },
            body: JSON.stringify({
              number: groupId,
              file: doc.media_url,
              type: "document",
              caption: `📎 ${typeLabel} - ${signerName}`,
            }),
          });
        } catch (e) {
          console.error(`Error sending doc to group:`, e);
        }
      }

      const summaryLines = fields.filter((f) => f.para).map((f) =>
        `• *${getFieldLabel(f, buildTemplateFieldCatalog([]))}*: ${f.para}`
      ).join("\n");
      const summaryMsg =
        `📋 *Resumo do Caso - ${session.template_name}*\n\n👤 *Cliente:* ${signerName}\n📱 *Telefone:* ${normalizedPhone}\n\n${summaryLines}\n\n📝 Documento: *${session.template_name}*\n🔗 ${
          signUrl || "Aguardando assinatura"
        }`;

      await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: inst.instance_token,
        },
        body: JSON.stringify({ number: groupId, text: summaryMsg }),
      });
    }
  } catch (groupErr) {
    console.error("Error sending to group:", groupErr);
  }

  return docData;
}
