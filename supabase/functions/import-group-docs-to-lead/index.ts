// Import group documents from WhatsApp into process_documents + Google Drive.
//
// Body:
// {
//   lead_id: string,
//   lead_name?: string,            // for Drive folder name
//   documents: [{ message_id: string, document_type: string }],
//   // legacy: message_ids?: string[], document_type?: string
// }
//
// document_type valores esperados:
//   "Procuração", "Perícia Social", "Perícia Médica", "RG", "CPF",
//   "Comprovante de Residência", "Outro"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

interface DocItem {
  message_id: string;
  document_type: string;
}
interface Body {
  lead_id: string;
  lead_name?: string;
  documents?: DocItem[];
  // legacy
  message_ids?: string[];
  document_type?: string;
}

const MEDIA_TYPE_INFO: Record<string, string> = {
  document: "WhatsApp Document Keys",
  image: "WhatsApp Image Keys",
  video: "WhatsApp Video Keys",
  audio: "WhatsApp Audio Keys",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body.lead_id) return json({ error: "lead_id required" }, 400);

    // Normalize legacy
    const docs: DocItem[] = body.documents
      ? body.documents
      : (body.message_ids || []).map((m) => ({
          message_id: m,
          document_type: body.document_type || "Outro",
        }));

    if (docs.length === 0) return json({ error: "documents[] required" }, 400);

    const cloud = createClient(SUPABASE_URL, SERVICE_KEY);
    const ext = createClient(EXT_URL, EXT_KEY);

    // Resolve lead_name if not provided (try external leads table)
    let leadName = body.lead_name || "";
    if (!leadName) {
      try {
        const { data: lead } = await ext
          .from("leads")
          .select("lead_name")
          .eq("id", body.lead_id)
          .maybeSingle();
        leadName = lead?.lead_name || "Lead";
      } catch {
        leadName = "Lead";
      }
    }

    const { data: instances } = await cloud
      .from("whatsapp_instances")
      .select("instance_name, instance_token, base_url")
      .eq("is_active", true)
      .limit(20);
    if (!instances?.length) return json({ error: "no active instance" }, 500);
    const preferred =
      instances.find((i) => i.instance_name?.toLowerCase() === "raymsandreson") ?? instances[0];
    const baseUrl = preferred.base_url || "https://abraci.uazapi.com";
    const token = preferred.instance_token;

    const results: any[] = [];

    for (const item of docs) {
      const msgId = item.message_id;
      const documentType = item.document_type || "Outro";
      try {
        const { data: msg } = await ext
          .from("whatsapp_messages")
          .select("external_message_id, message_text, message_type, media_url, created_at, phone, metadata")
          .like("external_message_id", `%${msgId}`)
          .limit(1)
          .maybeSingle();

        if (!msg) {
          results.push({ msgId, status: "not_found" });
          continue;
        }

        const content = msg.metadata?.message?.content || {};
        const mediaKeyB64: string | undefined = content.mediaKey;
        const mimeType: string =
          content.mimetype || content.mimeType || "application/octet-stream";
        const fileName: string =
          content.fileName || content.title || msg.message_text || `doc-${msgId}.bin`;
        const declaredType = msg.message_type || "document";

        let bytes: Uint8Array | null = null;
        let strategy = "";

        // --- Strategy 1: UazAPI returns a decrypted fileURL ---
        try {
          const dl = await fetch(`${baseUrl}/message/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token },
            body: JSON.stringify({ id: msg.external_message_id }),
          });
          if (dl.ok) {
            const dlJson = await dl.json();
            const fileURL: string | undefined = dlJson.fileURL || dlJson.url;
            if (fileURL) {
              const fr = await fetch(fileURL);
              if (fr.ok) {
                bytes = new Uint8Array(await fr.arrayBuffer());
                strategy = "uazapi_fileURL";
              }
            }
          }
        } catch (_) { /* fallthrough */ }

        // --- Strategy 2: download .enc and decrypt locally ---
        if (!bytes && mediaKeyB64 && msg.media_url) {
          try {
            const enc = await fetch(msg.media_url);
            if (!enc.ok) throw new Error(`enc fetch ${enc.status}`);
            const encBuf = new Uint8Array(await enc.arrayBuffer());
            const decoded = await decryptWhatsAppMedia(encBuf, mediaKeyB64, declaredType);
            bytes = decoded;
            strategy = "aes_local_decrypt";
          } catch (e: any) {
            results.push({
              msgId,
              status: "decrypt_failed",
              error: e?.message || String(e),
            });
            continue;
          }
        }

        if (!bytes) {
          results.push({ msgId, status: "no_data_available" });
          continue;
        }

        // --- Upload to Supabase Storage (backup) ---
        const safeName = fileName.replace(/[^\w.\-]+/g, "_");
        const storagePath = `lead/${body.lead_id}/group-docs/${msgId}-${safeName}`;
        const up = await cloud.storage
          .from("whatsapp-media")
          .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
        if (up.error) {
          results.push({ msgId, status: "upload_failed", error: up.error.message });
          continue;
        }
        const { data: pub } = cloud.storage.from("whatsapp-media").getPublicUrl(storagePath);

        // --- Upload to Google Drive (typed subfolder) ---
        let driveFile: any = null;
        let driveError: string | null = null;
        try {
          const driveRes = await fetch(`${SUPABASE_URL}/functions/v1/lead-drive`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
              apikey: SERVICE_KEY,
            },
            body: JSON.stringify({
              action: "upload_url_typed",
              lead_id: body.lead_id,
              lead_name: leadName,
              file_name: safeName,
              source_url: pub.publicUrl,
              mime_type: mimeType,
              document_type: documentType,
            }),
          });
          const driveJson = await driveRes.json();
          if (!driveRes.ok || driveJson.success === false) {
            driveError = driveJson.error || `drive http ${driveRes.status}`;
          } else {
            driveFile = driveJson.file;
          }
        } catch (e: any) {
          driveError = e?.message || String(e);
        }

        // --- Insert process_documents record ---
        const { data: doc, error: insErr } = await cloud
          .from("process_documents")
          .insert({
            lead_id: body.lead_id,
            document_type: documentType,
            title: fileName,
            description: msg.message_text || `Importado do grupo WhatsApp em ${msg.created_at}`,
            source: "whatsapp_group",
            file_url: driveFile?.webViewLink || pub.publicUrl,
            file_name: fileName,
            file_size: bytes.length,
            original_url: msg.media_url,
            document_date: (msg.created_at as string)?.slice(0, 10),
            metadata: {
              external_message_id: msg.external_message_id,
              group_jid: msg.phone,
              import_strategy: strategy,
              storage_url: pub.publicUrl,
              drive_file_id: driveFile?.id || null,
              drive_view_link: driveFile?.webViewLink || null,
              drive_error: driveError,
              imported_at: new Date().toISOString(),
            },
          })
          .select("id")
          .single();

        if (insErr) {
          results.push({ msgId, status: "insert_failed", error: insErr.message });
          continue;
        }

        results.push({
          msgId,
          status: driveError ? "ok_no_drive" : "ok",
          strategy,
          document_type: documentType,
          document_id: doc.id,
          file_name: fileName,
          size: bytes.length,
          drive_link: driveFile?.webViewLink || null,
          drive_error: driveError,
        });
      } catch (e: any) {
        results.push({ msgId, status: "error", error: e?.message || String(e) });
      }
    }

    return json({ ok: true, lead_id: body.lead_id, lead_name: leadName, results });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

// ============================================================
// WhatsApp media decryption (HKDF + AES-256-CBC)
// ============================================================

async function decryptWhatsAppMedia(
  encBuf: Uint8Array,
  mediaKeyB64: string,
  mediaType: string,
): Promise<Uint8Array> {
  const info = MEDIA_TYPE_INFO[mediaType] || MEDIA_TYPE_INFO.document;
  const mediaKey = base64ToBytes(mediaKeyB64);
  const expanded = await hkdfSha256(mediaKey, new Uint8Array(32), new TextEncoder().encode(info), 112);
  const iv = expanded.slice(0, 16);
  const cipherKey = expanded.slice(16, 48);
  const ciphertext = encBuf.slice(0, encBuf.length - 10);

  const key = await crypto.subtle.importKey("raw", cipherKey, { name: "AES-CBC" }, false, [
    "decrypt",
  ]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
  return new Uint8Array(plain);
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
