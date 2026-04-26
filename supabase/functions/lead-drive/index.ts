// Lead Drive Integration
// Actions: ensure_folder, list_files, upload, delete, get_root
// Storage: pasta única por lead dentro do Drive do escritório
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const UPLOAD_GATEWAY = "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3";
const ROOT_FOLDER_NAME = "AdScore Keeper - Leads";

function gwHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get("GOOGLE_DRIVE_API_KEY")!,
    ...extra,
  };
}

async function getOrCreateRootFolder(): Promise<string> {
  // Search by name
  const q = encodeURIComponent(`name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`${GATEWAY}/files?q=${q}&fields=files(id,name)`, { headers: gwHeaders() });
  if (!searchRes.ok) throw new Error(`drive search root failed [${searchRes.status}]: ${await searchRes.text()}`);
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  // Create
  const createRes = await fetch(`${GATEWAY}/files`, {
    method: "POST",
    headers: gwHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createRes.ok) throw new Error(`drive create root failed [${createRes.status}]: ${await createRes.text()}`);
  const created = await createRes.json();
  return created.id;
}

async function getOrCreateLeadFolder(leadId: string, leadName: string, ext: any): Promise<string> {
  // Check cache
  const { data: existing } = await ext
    .from("lead_drive_folders")
    .select("folder_id")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (existing?.folder_id) {
    // Verify still exists
    const verify = await fetch(`${GATEWAY}/files/${existing.folder_id}?fields=id,trashed`, { headers: gwHeaders() });
    if (verify.ok) {
      const v = await verify.json();
      if (!v.trashed) return existing.folder_id;
    }
  }

  const rootId = await getOrCreateRootFolder();
  const safeName = `${leadName || "Lead"} - ${leadId.slice(0, 8)}`.replace(/['\\]/g, "");

  // Search inside root
  const q = encodeURIComponent(`name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`);
  const searchRes = await fetch(`${GATEWAY}/files?q=${q}&fields=files(id,name)`, { headers: gwHeaders() });
  let folderId: string | null = null;
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files?.length > 0) folderId = data.files[0].id;
  }

  if (!folderId) {
    const createRes = await fetch(`${GATEWAY}/files`, {
      method: "POST",
      headers: gwHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: safeName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootId],
      }),
    });
    if (!createRes.ok) throw new Error(`drive create lead folder failed [${createRes.status}]: ${await createRes.text()}`);
    const created = await createRes.json();
    folderId = created.id;
  }

  await ext.from("lead_drive_folders").upsert({ lead_id: leadId, folder_id: folderId, folder_name: safeName });
  return folderId!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!Deno.env.get("LOVABLE_API_KEY")) throw new Error("LOVABLE_API_KEY missing");
    if (!Deno.env.get("GOOGLE_DRIVE_API_KEY")) throw new Error("GOOGLE_DRIVE_API_KEY missing");

    const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
    const ext = createClient(EXT_URL, EXT_KEY);

    const body = await req.json();
    const { action, lead_id, lead_name } = body;

    if (action === "ensure_folder") {
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);
      return new Response(
        JSON.stringify({ folder_id: folderId, folder_url: `https://drive.google.com/drive/folders/${folderId}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "list_files") {
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const res = await fetch(
        `${GATEWAY}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink)&orderBy=modifiedTime desc`,
        { headers: gwHeaders() },
      );
      if (!res.ok) throw new Error(`drive list failed [${res.status}]: ${await res.text()}`);
      const data = await res.json();
      return new Response(
        JSON.stringify({ folder_id: folderId, folder_url: `https://drive.google.com/drive/folders/${folderId}`, files: data.files || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "upload") {
      const { file_name, file_base64, mime_type } = body;
      if (!file_name || !file_base64) throw new Error("file_name and file_base64 required");
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);

      const binary = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
      const boundary = "----lovable-boundary-" + crypto.randomUUID();
      const metadata = JSON.stringify({ name: file_name, parents: [folderId] });
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mime_type || "application/octet-stream"}\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const headBytes = new TextEncoder().encode(head);
      const tailBytes = new TextEncoder().encode(tail);
      const payload = new Uint8Array(headBytes.length + binary.length + tailBytes.length);
      payload.set(headBytes, 0);
      payload.set(binary, headBytes.length);
      payload.set(tailBytes, headBytes.length + binary.length);

      const res = await fetch(`${UPLOAD_GATEWAY}/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size,modifiedTime`, {
        method: "POST",
        headers: gwHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body: payload,
      });
      if (!res.ok) throw new Error(`drive upload failed [${res.status}]: ${await res.text()}`);
      const file = await res.json();
      return new Response(JSON.stringify({ file }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      const { file_id } = body;
      if (!file_id) throw new Error("file_id required");
      const res = await fetch(`${GATEWAY}/files/${file_id}`, { method: "DELETE", headers: gwHeaders() });
      if (!res.ok && res.status !== 404) throw new Error(`drive delete failed [${res.status}]: ${await res.text()}`);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "upload_url") {
      // Baixa o arquivo de uma URL pública e sobe pro Drive na pasta do lead
      const { file_name, source_url, mime_type } = body;
      if (!file_name || !source_url) throw new Error("file_name and source_url required");
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);

      const dl = await fetch(source_url);
      if (!dl.ok) throw new Error(`source download failed [${dl.status}]: ${source_url}`);
      const binary = new Uint8Array(await dl.arrayBuffer());
      const finalMime = mime_type || dl.headers.get("content-type") || "application/octet-stream";

      const boundary = "----lovable-boundary-" + crypto.randomUUID();
      const metadata = JSON.stringify({ name: file_name, parents: [folderId] });
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${finalMime}\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const headBytes = new TextEncoder().encode(head);
      const tailBytes = new TextEncoder().encode(tail);
      const payload = new Uint8Array(headBytes.length + binary.length + tailBytes.length);
      payload.set(headBytes, 0);
      payload.set(binary, headBytes.length);
      payload.set(tailBytes, headBytes.length + binary.length);

      const res = await fetch(`${UPLOAD_GATEWAY}/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size,modifiedTime`, {
        method: "POST",
        headers: gwHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body: payload,
      });
      if (!res.ok) throw new Error(`drive upload_url failed [${res.status}]: ${await res.text()}`);
      const file = await res.json();
      return new Response(
        JSON.stringify({ ok: true, file, folder_id: folderId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "analyze_file") {
      // Baixa um arquivo do Drive e usa Gemini Vision para identificar tipo + titular
      const { file_id } = body;
      if (!file_id) throw new Error("file_id required");

      // Get file metadata for mime type
      const metaRes = await fetch(`${GATEWAY}/files/${file_id}?fields=id,name,mimeType`, { headers: gwHeaders() });
      if (!metaRes.ok) throw new Error(`drive meta failed [${metaRes.status}]: ${await metaRes.text()}`);
      const meta = await metaRes.json();

      // Download bytes
      const dlRes = await fetch(`${GATEWAY}/files/${file_id}?alt=media`, { headers: gwHeaders() });
      if (!dlRes.ok) throw new Error(`drive download failed [${dlRes.status}]: ${await dlRes.text()}`);
      const buf = new Uint8Array(await dlRes.arrayBuffer());
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
      }
      const b64 = btoa(bin);
      const dataUrl = `data:${meta.mimeType};base64,${b64}`;

      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "Você analisa documentos brasileiros (RG, CPF, CNH, comprovantes, procurações, laudos periciais, boletins, etc.). Devolva APENAS via tool call.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: `Identifique o tipo deste documento, o titular e descreva brevemente. Nome do arquivo: ${meta.name}` },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "save_analysis",
                parameters: {
                  type: "object",
                  properties: {
                    document_type: {
                      type: "string",
                      enum: ["RG", "CPF", "CNH", "Procuração", "Comprovante de Endereço", "Laudo Pericial", "Boletim de Ocorrência", "Contrato", "Atestado Médico", "Foto", "Outro"],
                    },
                    document_subtype: { type: ["string", "null"], description: "Ex: 'frente', 'verso', 'frente e verso', 'página 1 de 3'" },
                    holder_name: { type: ["string", "null"], description: "Nome do titular do documento" },
                    holder_cpf: { type: ["string", "null"] },
                    description: { type: "string", description: "Resumo de 1-2 linhas do conteúdo" },
                    confidence: { type: "string", enum: ["alta", "média", "baixa"] },
                  },
                  required: ["document_type", "description", "confidence"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "save_analysis" } },
        }),
      });
      if (!aiRes.ok) {
        const t = await aiRes.text();
        throw new Error(`AI analyze failed [${aiRes.status}]: ${t}`);
      }
      const aiData = await aiRes.json();
      const args = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      let analysis: any = {};
      try { analysis = args ? JSON.parse(args) : {}; } catch { analysis = {}; }

      return new Response(
        JSON.stringify({ ok: true, file: meta, analysis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e) {
    console.error("[lead-drive] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
