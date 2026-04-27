// Import group documents from WhatsApp into process_documents.
// Uses UazAPI /message/download which returns the decrypted media (no AES handling needed).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  lead_id: string;
  message_ids: string[]; // external_message_id values
  document_type?: string; // default 'outro'
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body.lead_id || !Array.isArray(body.message_ids) || body.message_ids.length === 0) {
      return json({ error: "lead_id and message_ids[] required" }, 400);
    }

    const cloud = createClient(SUPABASE_URL, SERVICE_KEY);
    const ext = createClient(EXT_URL, EXT_KEY);

    // Pick any active instance to use as the API caller
    const { data: instances } = await cloud
      .from("whatsapp_instances")
      .select("instance_name, instance_token, base_url")
      .eq("is_active", true)
      .limit(20);
    if (!instances?.length) return json({ error: "no active instance" }, 500);

    // Try to prefer raymsandreson, then any other
    const preferred =
      instances.find((i) => i.instance_name?.toLowerCase() === "raymsandreson") ?? instances[0];
    const baseUrl = preferred.base_url || "https://abraci.uazapi.com";
    const token = preferred.instance_token;

    const results: any[] = [];

    for (const msgId of body.message_ids) {
      try {
        // Find one matching message in external DB (any of the duplicates is fine - same media)
        const { data: msg } = await ext
          .from("whatsapp_messages")
          .select("id, external_message_id, message_text, message_type, media_url, created_at, phone")
          .like("external_message_id", `%${msgId}`)
          .limit(1)
          .maybeSingle();

        if (!msg) {
          results.push({ msgId, status: "not_found" });
          continue;
        }

        // Call UazAPI /message/download to get the decrypted file
        const dl = await fetch(`${baseUrl}/message/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify({
            id: msg.external_message_id,
            // Return base64 directly
            returnAsBase64: true,
          }),
        });

        if (!dl.ok) {
          const errTxt = await dl.text();
          results.push({ msgId, status: "download_failed", error: errTxt.slice(0, 300) });
          continue;
        }

        const dlJson = await dl.json();
        // UazAPI returns: { fileBase64, mimetype, fileName, ... } — shape varies
        const b64: string =
          dlJson.fileBase64 || dlJson.base64 || dlJson.data || dlJson.file || "";
        const mimeType: string =
          dlJson.mimetype || dlJson.mimeType || dlJson.contentType || "application/octet-stream";
        const fileName: string =
          dlJson.fileName || dlJson.filename || msg.message_text || `doc-${msgId}.bin`;

        if (!b64) {
          results.push({ msgId, status: "no_base64", payload: Object.keys(dlJson) });
          continue;
        }

        // Decode base64 -> bytes
        const cleanB64 = b64.replace(/^data:[^;]+;base64,/, "");
        const bytes = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0));

        // Upload to storage
        const ext2 = (fileName.split(".").pop() || "bin").toLowerCase();
        const storagePath = `lead/${body.lead_id}/group-docs/${msgId}.${ext2}`;
        const up = await cloud.storage
          .from("whatsapp-media")
          .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
        if (up.error) {
          results.push({ msgId, status: "upload_failed", error: up.error.message });
          continue;
        }

        const { data: pub } = cloud.storage.from("whatsapp-media").getPublicUrl(storagePath);

        // Insert into process_documents
        const { data: doc, error: insErr } = await cloud
          .from("process_documents")
          .insert({
            lead_id: body.lead_id,
            document_type: body.document_type || "outro",
            title: fileName,
            description: msg.message_text || `Importado do grupo WhatsApp em ${msg.created_at}`,
            source: "whatsapp_group",
            file_url: pub.publicUrl,
            file_name: fileName,
            file_size: bytes.length,
            original_url: msg.media_url,
            document_date: (msg.created_at as string)?.slice(0, 10),
            metadata: {
              external_message_id: msg.external_message_id,
              group_jid: msg.phone,
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
          status: "ok",
          document_id: doc.id,
          file_name: fileName,
          size: bytes.length,
        });
      } catch (e: any) {
        results.push({ msgId, status: "error", error: e?.message || String(e) });
      }
    }

    return json({ ok: true, lead_id: body.lead_id, results });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
