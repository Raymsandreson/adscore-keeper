// Lead Drive Integration
// Actions: ensure_folder, list_files, upload, delete, get_root
// Storage: pasta única por lead dentro do Drive do escritório
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const UPLOAD_GATEWAY = "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3";
const ROOT_FOLDER_NAME = "AdScore Keeper - Leads";
const MAX_ANALYZE_BYTES = 8 * 1024 * 1024;
const FUNCTION_VERSION = 5; // v5: análise IA persistida no arquivo (description + appProperties.ai_at); list_files devolve ai_analysis

// Retry automático para falhas transitórias do gateway do Google Drive.
// Envolvemos o fetch global para não precisar tocar em ~30 call sites.
// Metáfora: quando o correio (Google Drive) responde "estou ocupado", a gente
// espera um pouco e bate de novo, em vez de desistir e deixar o pacote no chão.
const _originalFetch = globalThis.fetch;
globalThis.fetch = async function retryingFetch(input: any, init?: any): Promise<Response> {
  const url = typeof input === "string" ? input : (input as Request).url;
  const isGateway = typeof url === "string" && url.startsWith("https://connector-gateway.lovable.dev/google_drive/");
  const maxAttempts = isGateway ? 4 : 1;
  let lastRes: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await _originalFetch(input, init);
      // Retry só em 5xx e 429 (transitórios). 4xx é erro do request e não adianta insistir.
      if (attempt < maxAttempts && (res.status >= 500 || res.status === 429)) {
        lastRes = res;
        const backoff = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        console.warn(`[lead-drive] gateway ${res.status} on attempt ${attempt}/${maxAttempts} → retry em ${backoff}ms (${url})`);
        try { await res.body?.cancel(); } catch {}
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts && isGateway) {
        const backoff = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        console.warn(`[lead-drive] gateway network error on attempt ${attempt}/${maxAttempts} → retry em ${backoff}ms`, e);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw e;
    }
  }
  if (lastRes) return lastRes;
  throw lastErr ?? new Error("retryingFetch: unknown failure");
};

function gwHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get("GOOGLE_DRIVE_API_KEY")!,
    ...extra,
  };
}

function driveQ(value: string): string {
  return value.replace(/['\\]/g, "");
}

async function driveJson(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: gwHeaders({
      ...(init.headers as Record<string, string> | undefined),
    }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`drive request failed [${res.status}]: ${text}`);
  return data;
}

// ---------------------------------------------------------------------------
// Persistência da análise IA no próprio arquivo do Drive.
// Antes, a análise só existia no state do React e sumia a cada reload — o
// usuário reclicava "Detalhes IA" e a gente pagava Gemini de novo no mesmo doc.
// Agora o resultado vira `description` do arquivo (campo do Drive, ~4 KB) com um
// prefixo que identifica o bloco nosso, e `appProperties.ai_at` marca a data.
// ---------------------------------------------------------------------------
const AI_DESC_PREFIX = "[AI]";

/**
 * Instrução de extração dos campos personalizados do CRM.
 *
 * As regras de PAPEL existem porque a IA vinha preenchendo "REPRESENTANTE LEGAL"
 * com o nome do advogado outorgado na procuração. O advogado/sociedade que RECEBE
 * poderes nunca é dado do cliente — representante legal é quem representa o
 * titular incapaz/menor (mãe, pai, tutor, curador).
 */
function buildFieldsInstruction(
  cfList: Array<{ id: string; name: string; type: string; options?: string[] }>,
): string {
  if (!cfList.length) return "";
  const list = cfList
    .map((f) => `- id=${f.id} | nome="${f.name}" | tipo=${f.type}${f.options?.length ? ` | opções=[${f.options.join(", ")}]` : ""}`)
    .join("\n");
  return `\n\nALÉM DISSO, extraia valores para os seguintes CAMPOS PERSONALIZADOS do CRM, somente se o documento mostrar a informação. Devolva no array "extracted_fields" com { field_id, value } (value sempre como string; datas em formato ISO YYYY-MM-DD; checkbox como "true"/"false"). Não invente; omita o campo se a informação não estiver clara.

REGRAS DE PAPEL (obrigatórias):
1. Em procuração, contrato de honorários ou substabelecimento, o(a) advogado(a), o escritório e a sociedade de advogados são os OUTORGADOS (quem recebe poderes). Nunca use o nome deles como valor de campo algum do cliente — nem "representante legal", nem "responsável", nem "titular".
2. "Representante legal" = a pessoa física que representa o titular/beneficiário incapaz ou menor de idade (mãe, pai, tutor, curador), ou seja, quem OUTORGA em nome do beneficiário. Se o titular for maior e capaz (assina por si), deixe o campo vazio.
3. Só preencha um campo quando o papel da pessoa no documento corresponder exatamente ao rótulo do campo. Na dúvida entre duas pessoas, omita o campo.

Campos:
${list}

Por fim, devolva em "other_findings" (máx. 8 itens, { label, value }) os dados relevantes do titular/beneficiário que o documento mostra mas que NÃO têm campo correspondente na lista acima (ex.: nome da mãe, data de nascimento, benefício). É só informativo — nunca inclua dados do advogado/outorgado nem repita algo já devolvido em extracted_fields.`;
}

function parseStoredAnalysis(description?: string | null): any | null {
  if (!description) return null;
  const idx = description.indexOf(AI_DESC_PREFIX);
  if (idx === -1) return null;
  const raw = description.slice(idx + AI_DESC_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function saveAnalysisToDrive(fileId: string, analysis: any): Promise<boolean> {
  try {
    const compact = {
      document_type: analysis?.document_type ?? null,
      document_subtype: analysis?.document_subtype ?? null,
      holder_name: analysis?.holder_name ?? null,
      holder_cpf: analysis?.holder_cpf ?? null,
      description: typeof analysis?.description === "string" ? analysis.description.slice(0, 1500) : null,
      confidence: analysis?.confidence ?? null,
      extracted_fields: Array.isArray(analysis?.extracted_fields) ? analysis.extracted_fields : [],
      other_findings: Array.isArray(analysis?.other_findings) ? analysis.other_findings.slice(0, 8) : [],
    };
    // Drive limita `description` a ~4 KB. Se estourar (muito campo extraído),
    // derruba os extracted_fields e mantém a identificação do documento.
    let body = `${AI_DESC_PREFIX}${JSON.stringify(compact)}`;
    // Ordem de sacrifício: primeiro o informativo (other_findings), depois os campos.
    if (body.length > 3800) body = `${AI_DESC_PREFIX}${JSON.stringify({ ...compact, other_findings: [] })}`;
    if (body.length > 3800) body = `${AI_DESC_PREFIX}${JSON.stringify({ ...compact, other_findings: [], extracted_fields: [] })}`;
    if (body.length > 3800) body = body.slice(0, 3800);

    const res = await fetch(`${GATEWAY}/files/${fileId}?fields=id`, {
      method: "PATCH",
      headers: gwHeaders({ "Content-Type": "application/json" }),
      // PATCH de appProperties faz merge por chave: content_hash / dedup_key /
      // lead_id já gravados no upload continuam intactos.
      body: JSON.stringify({ description: body, appProperties: { ai_at: new Date().toISOString() } }),
    });
    if (!res.ok) {
      console.warn(`[lead-drive] AI_ANALYSIS_PERSIST_FAILED ${JSON.stringify({ file_id: fileId, status: res.status, error: await res.text() })}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[lead-drive] AI_ANALYSIS_PERSIST_ERROR", e);
    return false;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

async function resolveFolderBaseName(
  leadId: string,
  leadName: string,
  ext: any,
): Promise<{ name: string; reason: "case_number_and_title" | "case_title" | "case_number" | "lead_name" | "fallback" }> {
  // Prioriza o caso jurídico do lead se houver
  try {
    const { data: cases } = await ext
      .from("legal_cases")
      .select("case_number, title")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);
    const c = Array.isArray(cases) && cases.length > 0 ? cases[0] : null;
    if (c) {
      const title = (c.title || "").trim();
      const num = (c.case_number || "").trim();
      if (title && num) return { name: `${num} - ${title}`, reason: "case_number_and_title" };
      if (title) return { name: title, reason: "case_title" };
      if (num) return { name: num, reason: "case_number" };
    }
  } catch (e) {
    console.warn("[lead-drive] resolveFolderBaseName legal_cases lookup failed:", e);
  }
  return { name: leadName || "Lead", reason: leadName ? "lead_name" : "fallback" };
}

async function getOrCreateLeadFolder(leadId: string, leadName: string, ext: any): Promise<string> {
  const { name: baseName, reason: nameReason } = await resolveFolderBaseName(leadId, leadName, ext);
  const desiredName = `${baseName} - ${leadId.slice(0, 8)}`.replace(/['\\]/g, "");

  // Check cache
  const { data: existing } = await ext
    .from("lead_drive_folders")
    .select("folder_id, folder_name")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (existing?.folder_id) {
    // Verify still exists
    const verify = await fetch(`${GATEWAY}/files/${existing.folder_id}?fields=id,trashed,name`, { headers: gwHeaders() });
    if (verify.ok) {
      const v = await verify.json();
      if (!v.trashed) {
        // Renomeia se o nome cadastrado mudou (ex: lead virou caso)
        if (v.name !== desiredName) {
          try {
            const rn = await fetch(`${GATEWAY}/files/${existing.folder_id}?fields=id,name`, {
              method: "PATCH",
              headers: gwHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ name: desiredName }),
            });
            if (rn.ok) {
              await ext.from("lead_drive_folders").upsert({ lead_id: leadId, folder_id: existing.folder_id, folder_name: desiredName });
              console.log(`[lead-drive] FOLDER_RENAMED ${JSON.stringify({
                lead_id: leadId,
                folder_id: existing.folder_id,
                from: v.name,
                to: desiredName,
                reason: nameReason,
              })}`);
            } else {
              console.warn(`[lead-drive] FOLDER_RENAME_FAILED ${JSON.stringify({
                lead_id: leadId,
                folder_id: existing.folder_id,
                from: v.name,
                to: desiredName,
                reason: nameReason,
                status: rn.status,
                error: await rn.text(),
              })}`);
            }
          } catch (e) {
            console.warn("[lead-drive] folder rename error:", e);
          }
        } else {
          console.log(`[lead-drive] FOLDER_RENAME_SKIPPED ${JSON.stringify({
            lead_id: leadId,
            folder_id: existing.folder_id,
            name: v.name,
            reason: `already_matches:${nameReason}`,
          })}`);
        }
        return existing.folder_id;
      }
    }
  }

  const rootId = await getOrCreateRootFolder();

  // Search inside root pelo nome desejado
  const q = encodeURIComponent(`name='${desiredName}' and mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`);
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
        name: desiredName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootId],
      }),
    });
    if (!createRes.ok) throw new Error(`drive create lead folder failed [${createRes.status}]: ${await createRes.text()}`);
    const created = await createRes.json();
    folderId = created.id;
  }

  await ext.from("lead_drive_folders").upsert({ lead_id: leadId, folder_id: folderId, folder_name: desiredName });
  return folderId!;
}

async function getOrCreateSubfolder(parentFolderId: string, name: string): Promise<string> {
  const safeName = name.replace(/['\\]/g, "").trim() || "Outros";
  const q = encodeURIComponent(
    `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
  );
  const searchRes = await fetch(`${GATEWAY}/files?q=${q}&fields=files(id,name)`, { headers: gwHeaders() });
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files?.length > 0) return data.files[0].id;
  }
  const createRes = await fetch(`${GATEWAY}/files`, {
    method: "POST",
    headers: gwHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name: safeName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });
  if (!createRes.ok) throw new Error(`drive create subfolder failed [${createRes.status}]: ${await createRes.text()}`);
  const created = await createRes.json();
  return created.id;
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
        `${GATEWAY}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,description,appProperties)&orderBy=modifiedTime desc`,
        { headers: gwHeaders() },
      );
      if (!res.ok) throw new Error(`drive list failed [${res.status}]: ${await res.text()}`);
      const data = await res.json();
      const seenFiles = new Set<string>();
      const files = (data.files || []).filter((file: any) => {
        const key = `${file.name || ""}::${file.size || ""}`;
        if (!file.size || !file.name) return true;
        if (seenFiles.has(key)) return false;
        seenFiles.add(key);
        return true;
      }).map((file: any) => {
        // Análise IA persistida (ver saveAnalysisToDrive). `description` guarda o
        // JSON; `appProperties.ai_at` é o marcador de "já extraído" que sobrevive
        // a rename e a mover de pasta. Sem isso a tela reprocessava tudo do zero.
        const analysis = parseStoredAnalysis(file.description);
        const { description: _d, appProperties: ap, ...rest } = file;
        return { ...rest, ai_analysis: analysis, ai_analyzed_at: ap?.ai_at || null };
      });
      return new Response(
        JSON.stringify({ folder_id: folderId, folder_url: `https://drive.google.com/drive/folders/${folderId}`, files, _functionVersion: FUNCTION_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "flatten_subfolders") {
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);
      const foldersQuery = encodeURIComponent(
        `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      );
      const folderData = await driveJson(
        `/files?q=${foldersQuery}&fields=files(id,name)&pageSize=1000`,
      );

      const moved: Array<{ id: string; name: string; from_folder_id: string; from_folder_name: string }> = [];
      const deletedFolders: Array<{ id: string; name: string }> = [];
      const skipped: Array<{ id?: string; name?: string; reason: string }> = [];

      for (const folder of folderData.files || []) {
        const childQuery = encodeURIComponent(`'${folder.id}' in parents and trashed=false`);
        const childData = await driveJson(
          `/files?q=${childQuery}&fields=files(id,name,mimeType,size)&pageSize=1000`,
        );

        for (const child of childData.files || []) {
          if (child.mimeType === "application/vnd.google-apps.folder") {
            skipped.push({ id: child.id, name: child.name, reason: "nested_folder" });
            continue;
          }
          const moveParams = new URLSearchParams({
            addParents: folderId,
            removeParents: folder.id,
            fields: "id,name,parents",
          });
          await driveJson(`/files/${child.id}?${moveParams.toString()}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          moved.push({ id: child.id, name: child.name, from_folder_id: folder.id, from_folder_name: folder.name });
        }

        const remainingQuery = encodeURIComponent(`'${folder.id}' in parents and trashed=false`);
        const remaining = await driveJson(`/files?q=${remainingQuery}&fields=files(id)&pageSize=1`);
        if ((remaining.files || []).length === 0) {
          await fetch(`${GATEWAY}/files/${folder.id}`, { method: "DELETE", headers: gwHeaders() });
          deletedFolders.push({ id: folder.id, name: folder.name });
        }
      }

      return new Response(
        JSON.stringify({ ok: true, folder_id: folderId, moved, deletedFolders, skipped, _functionVersion: FUNCTION_VERSION }),
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
      const { file_name, source_url, mime_type, dedup_key, content_hash } = body;
      if (!file_name || !source_url) throw new Error("file_name and source_url required");
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);

      const dl = await fetch(source_url);
      if (!dl.ok) throw new Error(`source download failed [${dl.status}]: ${source_url}`);
      const binary = new Uint8Array(await dl.arrayBuffer());
      const finalMime = mime_type || dl.headers.get("content-type") || "application/octet-stream";
      const finalHash = content_hash || await sha256Hex(binary);

      // Dedup por dedup_key/content_hash procura no Drive INTEIRO (sem escopo de
      // pasta): arquivo que o usuário moveu pra subpasta continua encontrado e
      // NÃO é repuxado. dedup_key já embute o lead; content_hash é escopado por
      // lead via appProperties.lead_id. Só o fallback name+size fica na pasta.
      const leadScope = lead_id
        ? ` and appProperties has { key='lead_id' and value='${driveQ(String(lead_id))}' }`
        : "";
      const dedupQueries = [
        ...(dedup_key ? [`trashed = false and appProperties has { key='dedup_key' and value='${driveQ(String(dedup_key))}' }`] : []),
        ...(finalHash ? [`trashed = false and appProperties has { key='content_hash' and value='${driveQ(String(finalHash))}' }${leadScope}`] : []),
        `'${folderId}' in parents and trashed = false and name = '${driveQ(file_name)}'`,
      ];
      for (const condition of dedupQueries) {
        const q = encodeURIComponent(condition);
        const listRes = await fetch(`${GATEWAY}/files?q=${q}&fields=files(id,name,size,mimeType,webViewLink,modifiedTime)&pageSize=20`, { headers: gwHeaders() });
        if (!listRes.ok) continue;
        const listJson = await listRes.json();
        const existing = (listJson.files || []).find((f: any) =>
          condition.includes("name =") ? String(f.size || "") === String(binary.length) : true,
        );
        if (existing) {
          return new Response(
            JSON.stringify({ ok: true, file: existing, folder_id: folderId, deduped: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      const boundary = "----lovable-boundary-" + crypto.randomUUID();
      const appProperties: Record<string, string> = { content_hash: String(finalHash) };
      if (dedup_key) appProperties.dedup_key = String(dedup_key);
      if (lead_id) appProperties.lead_id = String(lead_id);
      const metadata = JSON.stringify({ name: file_name, parents: [folderId], appProperties });
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

    if (action === "merge_pdf_upload") {
      // Recebe array de URLs (imagens e/ou PDFs), monta UM PDF único e sobe pro Drive
      const { file_name, sources } = body as { file_name: string; sources: Array<{ url: string; mime_type?: string }> };
      if (!file_name || !Array.isArray(sources) || sources.length === 0) {
        throw new Error("file_name and sources[] required");
      }
      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);
      const { PDFDocument } = await import("https://esm.sh/pdf-lib@1.17.1?target=deno");
      const outDoc = await PDFDocument.create();
      const skipped: Array<{ url: string; reason: string }> = [];

      for (const src of sources) {
        try {
          const dl = await fetch(src.url);
          if (!dl.ok) { skipped.push({ url: src.url, reason: `download ${dl.status}` }); continue; }
          const bytes = new Uint8Array(await dl.arrayBuffer());
          const mime = (src.mime_type || dl.headers.get("content-type") || "").toLowerCase();

          if (mime.includes("pdf")) {
            const src1 = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const copied = await outDoc.copyPages(src1, src1.getPageIndices());
            copied.forEach((p) => outDoc.addPage(p));
          } else if (mime.includes("jpeg") || mime.includes("jpg")) {
            const img = await outDoc.embedJpg(bytes);
            const page = outDoc.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          } else if (mime.includes("png")) {
            const img = await outDoc.embedPng(bytes);
            const page = outDoc.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          } else if (mime.includes("webp") || mime.includes("heic") || mime.includes("gif")) {
            // pdf-lib não suporta nativamente; tentamos forçar como JPG (alguns servidores aceitam mudar Accept)
            skipped.push({ url: src.url, reason: `formato ${mime} não suportado para PDF` });
          } else {
            skipped.push({ url: src.url, reason: `mime não suportado: ${mime}` });
          }
        } catch (e) {
          skipped.push({ url: src.url, reason: (e as Error).message });
        }
      }

      if (outDoc.getPageCount() === 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "Nenhum arquivo pôde ser convertido para PDF", skipped }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const pdfBytes = await outDoc.save();
      const finalName = /\.pdf$/i.test(file_name) ? file_name : `${file_name}.pdf`;

      const boundary = "----lovable-boundary-" + crypto.randomUUID();
      const metadata = JSON.stringify({ name: finalName, parents: [folderId] });
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const headBytes = new TextEncoder().encode(head);
      const tailBytes = new TextEncoder().encode(tail);
      const payload = new Uint8Array(headBytes.length + pdfBytes.length + tailBytes.length);
      payload.set(headBytes, 0);
      payload.set(pdfBytes, headBytes.length);
      payload.set(tailBytes, headBytes.length + pdfBytes.length);

      const res = await fetch(`${UPLOAD_GATEWAY}/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size,modifiedTime`, {
        method: "POST",
        headers: gwHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body: payload,
      });
      if (!res.ok) throw new Error(`drive merge_pdf_upload failed [${res.status}]: ${await res.text()}`);
      const file = await res.json();
      return new Response(
        JSON.stringify({ ok: true, file, folder_id: folderId, merged: outDoc.getPageCount(), skipped }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "merge_drive_files") {
      // Agrupa arquivos JÁ existentes no Drive em UM PDF único.
      // Body: { lead_id, lead_name, file_ids: string[], output_name?: string, delete_originals?: boolean }
      const { file_ids, output_name, delete_originals } = body as {
        file_ids: string[];
        output_name?: string;
        delete_originals?: boolean;
      };
      if (!Array.isArray(file_ids) || file_ids.length < 2) {
        throw new Error("file_ids[] com pelo menos 2 arquivos é obrigatório");
      }

      const folderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);
      const { PDFDocument } = await import("https://esm.sh/pdf-lib@1.17.1?target=deno");
      const outDoc = await PDFDocument.create();
      const skipped: Array<{ file_id: string; name?: string; reason: string }> = [];
      const merged: Array<{ file_id: string; name: string }> = [];

      // Baixa cada arquivo na ordem informada e empilha no PDF
      for (const fid of file_ids) {
        try {
          const metaRes = await fetch(`${GATEWAY}/files/${fid}?fields=id,name,mimeType,size`, { headers: gwHeaders() });
          if (!metaRes.ok) { skipped.push({ file_id: fid, reason: `meta ${metaRes.status}` }); continue; }
          const meta = await metaRes.json();
          const mime = (meta.mimeType || "").toLowerCase();

          const dlRes = await fetch(`${GATEWAY}/files/${fid}?alt=media`, { headers: gwHeaders() });
          if (!dlRes.ok) { skipped.push({ file_id: fid, name: meta.name, reason: `download ${dlRes.status}` }); continue; }
          const bytes = new Uint8Array(await dlRes.arrayBuffer());

          if (mime.includes("pdf")) {
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const copied = await outDoc.copyPages(src, src.getPageIndices());
            copied.forEach((p) => outDoc.addPage(p));
          } else if (mime.includes("jpeg") || mime.includes("jpg")) {
            const img = await outDoc.embedJpg(bytes);
            const page = outDoc.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          } else if (mime.includes("png")) {
            const img = await outDoc.embedPng(bytes);
            const page = outDoc.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          } else {
            skipped.push({ file_id: fid, name: meta.name, reason: `mime não suportado: ${mime}` });
            continue;
          }
          merged.push({ file_id: fid, name: meta.name });
        } catch (e) {
          skipped.push({ file_id: fid, reason: (e as Error).message });
        }
      }

      if (outDoc.getPageCount() === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "Nenhum arquivo pôde ser agrupado", skipped }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const pdfBytes = await outDoc.save();
      const baseName = (output_name && output_name.trim())
        || (merged[0]?.name?.replace(/\.[^.]+$/, "") || "Documento agrupado");
      const finalName = /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;

      const boundary = "----lovable-boundary-" + crypto.randomUUID();
      const metadata = JSON.stringify({ name: finalName, parents: [folderId] });
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const headBytes = new TextEncoder().encode(head);
      const tailBytes = new TextEncoder().encode(tail);
      const payload = new Uint8Array(headBytes.length + pdfBytes.length + tailBytes.length);
      payload.set(headBytes, 0);
      payload.set(pdfBytes, headBytes.length);
      payload.set(tailBytes, headBytes.length + pdfBytes.length);

      const upRes = await fetch(`${UPLOAD_GATEWAY}/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size,modifiedTime`, {
        method: "POST",
        headers: gwHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
        body: payload,
      });
      if (!upRes.ok) throw new Error(`drive merge_drive_files upload failed [${upRes.status}]: ${await upRes.text()}`);
      const file = await upRes.json();

      // Apaga os originais que entraram no merge (somente se solicitado)
      const deleted: string[] = [];
      const deleteFailed: Array<{ file_id: string; reason: string }> = [];
      if (delete_originals) {
        for (const m of merged) {
          try {
            const del = await fetch(`${GATEWAY}/files/${m.file_id}`, { method: "DELETE", headers: gwHeaders() });
            if (del.ok || del.status === 404) deleted.push(m.file_id);
            else deleteFailed.push({ file_id: m.file_id, reason: `delete ${del.status}` });
          } catch (e) {
            deleteFailed.push({ file_id: m.file_id, reason: (e as Error).message });
          }
        }
      }

      console.log(`[lead-drive] MERGE_DRIVE_FILES ${JSON.stringify({
        lead_id,
        output_file_id: file.id,
        output_name: file.name,
        merged_count: merged.length,
        skipped_count: skipped.length,
        deleted_count: deleted.length,
      })}`);

      return new Response(
        JSON.stringify({ ok: true, file, folder_id: folderId, merged, skipped, deleted, deleteFailed }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "analyze_file") {
      // Baixa um arquivo do Drive e usa Gemini Vision para identificar tipo + titular.
      // Opcionalmente extrai valores para campos personalizados informados em `custom_fields`.
      const { file_id, custom_fields, force } = body as {
        file_id?: string;
        custom_fields?: Array<{ id: string; name: string; type: string; options?: string[] }>;
        force?: boolean;
      };
      if (!file_id) throw new Error("file_id required");
      const cfList = Array.isArray(custom_fields) ? custom_fields.filter((f) => f && f.id && f.name) : [];

      // Get file metadata before downloading bytes; large files can exceed worker memory.
      const metaRes = await fetch(`${GATEWAY}/files/${file_id}?fields=id,name,mimeType,size,description,appProperties`, { headers: gwHeaders() });
      if (!metaRes.ok) throw new Error(`drive meta failed [${metaRes.status}]: ${await metaRes.text()}`);
      const meta = await metaRes.json();

      // Já analisado antes? Devolve o que está gravado e não gasta Gemini de novo.
      // `force: true` (botão "Reanalisar") ignora o cache.
      const cached = force ? null : parseStoredAnalysis(meta.description);
      if (cached) {
        return new Response(JSON.stringify({
          ok: true,
          file: { id: meta.id, name: meta.name, mimeType: meta.mimeType, size: meta.size },
          analysis: cached,
          renamed: null,
          cached: true,
          analyzed_at: meta.appProperties?.ai_at || null,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const fileSize = Number(meta.size || 0);
      if (fileSize > MAX_ANALYZE_BYTES) {
        const analysis = {
          document_type: "Outro",
          description: `Arquivo ${meta.name} é maior que 8 MB e não foi analisado automaticamente para evitar limite de memória.`,
          confidence: "baixa",
        };
        await saveAnalysisToDrive(file_id, analysis);
        return new Response(JSON.stringify({
          success: true,
          analysis,
          renamed: false,
          skipped_reason: "file_too_large",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Download bytes
      const dlRes = await fetch(`${GATEWAY}/files/${file_id}?alt=media`, { headers: gwHeaders() });
      if (!dlRes.ok) throw new Error(`drive download failed [${dlRes.status}]: ${await dlRes.text()}`);
      const buf = new Uint8Array(await dlRes.arrayBuffer());

      // MIME types suportados nativamente pelo Gemini Vision (image_url)
      const VISION_MIMES = new Set([
        "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/heic", "image/heif",
        "application/pdf",
      ]);
      const isDocx = meta.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        || /\.docx$/i.test(meta.name || "");

      let userContent: any;
      if (VISION_MIMES.has(meta.mimeType)) {
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
        }
        const b64 = btoa(bin);
        const dataUrl = `data:${meta.mimeType};base64,${b64}`;
        const fieldsInstr = buildFieldsInstruction(cfList);
        userContent = [
          { type: "text", text: `Identifique o tipo deste documento, o titular e descreva brevemente. Nome do arquivo: ${meta.name}${fieldsInstr}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ];
      } else if (isDocx) {
        // DOCX = zip com XMLs. Usamos fflate (leve) p/ não estourar memória do worker.
        const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
        let text = "";
        try {
          const files = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
          const xmlBytes = files["word/document.xml"];
          if (xmlBytes) {
            const xml = strFromU8(xmlBytes);
            // Quebra parágrafos e remove todas as tags XML
            text = xml
              .replace(/<\/w:p>/g, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
              .replace(/[ \t]+/g, " ")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
              .slice(0, 40000);
          }
        } catch (e) {
          console.error("[lead-drive] docx extract failed:", e);
        }
        const fieldsInstr = buildFieldsInstruction(cfList);
        userContent = `Identifique o tipo deste documento, o titular e descreva brevemente. Nome do arquivo: ${meta.name}${fieldsInstr}\n\nConteúdo extraído do DOCX:\n\n${text || "(não foi possível extrair texto)"}`;
      } else {
        // Tipo não suportado pela IA — devolve análise neutra sem chamar Gemini
        const analysis = {
          document_type: "Outro",
          description: `Arquivo ${meta.name} (${meta.mimeType}) não pôde ser analisado automaticamente.`,
          confidence: "baixa",
        };
        await saveAnalysisToDrive(file_id, analysis);
        return new Response(JSON.stringify({
          success: true,
          analysis,
          renamed: false,
          skipped_reason: `unsupported_mime:${meta.mimeType}`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!Deno.env.get("GOOGLE_AI_API_KEY")) throw new Error("GOOGLE_AI_API_KEY missing");

      const aiData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Você analisa documentos brasileiros (RG, CPF, CNH, certidões de nascimento/casamento/óbito, comprovantes, procurações, laudos periciais, boletins, holerites, extratos, etc.). Seja ESPECÍFICO no document_type — nunca use 'Outro' se houver qualquer indicação clara (título do documento, brasão, layout). SEMPRE preencha document_subtype indicando se é 'frente', 'verso', 'frente e verso' ou 'único' (documento de página única que não tem verso). Devolva APENAS via tool call.",
          },
          {
            role: "user",
            content: userContent,
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
                    description: "Nome específico do documento em português. Ex: 'Certidão de Nascimento', 'Certidão de Casamento', 'Certidão de Óbito', 'RG', 'CPF', 'CNH', 'Carteira de Trabalho', 'Comprovante de Endereço', 'Holerite', 'Extrato Bancário', 'Procuração', 'Laudo Pericial', 'Boletim de Ocorrência', 'Contrato', 'Atestado Médico', 'Histórico Escolar', 'Título de Eleitor', 'Passaporte', 'Foto'. Use 'Outro' SOMENTE se for impossível identificar.",
                  },
                  document_subtype: { type: "string", enum: ["frente", "verso", "frente e verso", "único"], description: "Identifique sempre. 'único' = documento de página única sem verso (ex: certidão completa, comprovante)." },
                  holder_name: { type: ["string", "null"], description: "Nome do titular do documento" },
                  holder_cpf: { type: ["string", "null"] },
                  description: { type: "string", description: "Resumo de 1-2 linhas do conteúdo" },
                  confidence: { type: "string", enum: ["alta", "média", "baixa"] },
                  extracted_fields: {
                    type: "array",
                    description: "Valores extraídos para os campos personalizados do CRM. Inclua somente os campos cujos valores aparecem claramente no documento.",
                    items: {
                      type: "object",
                      properties: {
                        field_id: { type: "string" },
                        value: { type: "string", description: "Sempre como string. Datas em YYYY-MM-DD. Checkbox como 'true'/'false'." },
                      },
                      required: ["field_id", "value"],
                      additionalProperties: false,
                    },
                  },
                  other_findings: {
                    type: "array",
                    description: "Dados relevantes do titular/beneficiário achados no documento que NÃO têm campo correspondente na lista de campos personalizados. Só informativo, máximo 8. Nunca dados do advogado/outorgado.",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "Rótulo curto em português. Ex: 'Nome da mãe'." },
                        value: { type: "string" },
                      },
                      required: ["label", "value"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["document_type", "document_subtype", "description", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_analysis" } },
      });

      const args = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      let analysis: any = {};
      try { analysis = args ? JSON.parse(args) : {}; } catch { analysis = {}; }


      // Auto-rename in Drive based on AI analysis (preserve extension)
      let renamed: string | null = null;
      try {
        if (analysis?.document_type && analysis?.confidence !== "baixa") {
          const sanitize = (s: string) => String(s).replace(/[\\/:*?"<>|\r\n]/g, " ").replace(/\s+/g, " ").trim();
          const dotIdx = (meta.name || "").lastIndexOf(".");
          const extName = dotIdx > 0 ? (meta.name as string).slice(dotIdx) : "";

          // Se o lead tem caso vinculado, prefere o número/título do caso ao nome do titular
          let caseLabel: string | null = null;
          let caseLabelSource: "case_number" | "case_title" | null = null;
          if (lead_id) {
            try {
              const { data: cases } = await ext
                .from("legal_cases")
                .select("case_number, title")
                .eq("lead_id", lead_id)
                .order("created_at", { ascending: false })
                .limit(1);
              const c = Array.isArray(cases) && cases.length > 0 ? cases[0] : null;
              if (c) {
                const num = (c.case_number || "").trim();
                const title = (c.title || "").trim();
                if (num) { caseLabel = num; caseLabelSource = "case_number"; }
                else if (title) { caseLabel = title; caseLabelSource = "case_title"; }
              }
            } catch (e) {
              console.warn("[lead-drive] case lookup for rename failed:", e);
            }
          }

          const labelSource: "case_number" | "case_title" | "holder_name" | "none" =
            caseLabelSource ?? (analysis.holder_name ? "holder_name" : "none");

          // Padrão de nome: "{Tipo} — {Titular} ({frente|verso}) — {PREV 597}{ext}"
          // PREV / código do caso vai SEMPRE no final.
          const parts: string[] = [sanitize(analysis.document_type)];
          if (analysis.holder_name) parts.push(sanitize(analysis.holder_name));
          if (analysis.document_subtype) parts.push(`(${sanitize(analysis.document_subtype)})`);
          let base = parts.join(" — ");
          if (caseLabel) base = `${base} — ${sanitize(caseLabel)}`;
          base = base.slice(0, 180);
          const desired = `${base}${extName}`;
          if (desired && desired !== meta.name) {
            const previousName = meta.name;
            const rnRes = await fetch(`${GATEWAY}/files/${file_id}?fields=id,name`, {
              method: "PATCH",
              headers: gwHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ name: desired }),
            });
            if (rnRes.ok) {
              const rn = await rnRes.json();
              renamed = rn.name;
              meta.name = rn.name;
              console.log(`[lead-drive] FILE_RENAMED ${JSON.stringify({
                lead_id,
                file_id,
                from: previousName,
                to: rn.name,
                document_type: analysis.document_type,
                holder_name: analysis.holder_name ?? null,
                label_source: labelSource,
                case_label: caseLabel,
                confidence: analysis.confidence,
              })}`);
            } else {
              const errText = await rnRes.text();
              console.warn(`[lead-drive] FILE_RENAME_FAILED ${JSON.stringify({
                lead_id,
                file_id,
                from: meta.name,
                to: desired,
                label_source: labelSource,
                status: rnRes.status,
                error: errText,
              })}`);
            }
          } else {
            console.log(`[lead-drive] FILE_RENAME_SKIPPED ${JSON.stringify({
              lead_id,
              file_id,
              name: meta.name,
              label_source: labelSource,
              reason: desired ? "already_matches" : "empty_desired",
            })}`);
          }
        }
      } catch (e) {
        console.warn("auto-rename skipped:", e);
      }

      // Grava a análise no arquivo. Feito DEPOIS do rename para que o PATCH de
      // description não brigue com o PATCH de name na mesma revisão do Drive.
      const persisted = await saveAnalysisToDrive(file_id, analysis);

      return new Response(
        JSON.stringify({ ok: true, file: meta, analysis, renamed, cached: false, persisted }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "upload_url_typed") {
      // Sobe um arquivo de uma URL pública DIRETO para a pasta do lead (sem subpasta por tipo).
      // Body: { lead_id, lead_name, file_name, source_url, mime_type?, document_type }
      const { file_name, source_url, mime_type, document_type, dedup_key, content_hash } = body;
      if (!file_name || !source_url) throw new Error("file_name and source_url required");
      if (!document_type) throw new Error("document_type required");

      const leadFolderId = await getOrCreateLeadFolder(lead_id, lead_name, ext);
      const subFolderId = leadFolderId; // arquivos vão direto na pasta do lead

      // Dedup no Drive INTEIRO (sem escopo de pasta): arquivo movido pra
      // subpasta pelo usuário continua encontrado e NÃO é repuxado. dedup_key
      // já embute o lead; content_hash é escopado via appProperties.lead_id.
      for (const [key, value] of [["dedup_key", dedup_key], ["content_hash", content_hash]] as const) {
        if (!value) continue;
        const scope = key === "content_hash" && lead_id
          ? ` and appProperties has { key='lead_id' and value='${driveQ(String(lead_id))}' }`
          : "";
        const q = encodeURIComponent(
          `trashed = false and appProperties has { key='${key}' and value='${driveQ(String(value))}' }${scope}`,
        );
        const listRes = await fetch(
          `${GATEWAY}/files?q=${q}&fields=files(id,name,size,mimeType,webViewLink,modifiedTime)&pageSize=1`,
          { headers: gwHeaders() },
        );
        if (listRes.ok) {
          const listJson = await listRes.json();
          const existing = listJson.files?.[0];
          if (existing) {
            return new Response(
        JSON.stringify({ ok: true, file: existing, deduped: true, lead_folder_id: leadFolderId, subfolder_id: subFolderId, _functionVersion: FUNCTION_VERSION }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      }

      const dl = await fetch(source_url);
      if (!dl.ok) throw new Error(`source download failed [${dl.status}]: ${source_url}`);
      const binary = new Uint8Array(await dl.arrayBuffer());
      const finalMime = mime_type || dl.headers.get("content-type") || "application/octet-stream";

      // --- Dedup: skip re-upload if same name+size already exists in subfolder ---
      try {
        const escapedName = driveQ(file_name);
        const q = encodeURIComponent(`name = '${escapedName}' and '${subFolderId}' in parents and trashed = false`);
        const listRes = await fetch(
          `${GATEWAY}/files?q=${q}&fields=files(id,name,size,mimeType,webViewLink,modifiedTime)&pageSize=10`,
          { headers: gwHeaders() },
        );
        if (listRes.ok) {
          const listJson = await listRes.json();
          const existing = (listJson.files || []).find(
            (f: any) => String(f.size || "") === String(binary.length),
          );
          if (existing) {
            return new Response(
        JSON.stringify({ ok: true, file: existing, deduped: true, lead_folder_id: leadFolderId, subfolder_id: subFolderId, _functionVersion: FUNCTION_VERSION }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      } catch (e) {
        console.warn("[lead-drive] dedup check failed, proceeding with upload:", e);
      }

      const boundary = "----lovable-boundary-" + crypto.randomUUID();
      const appProperties: Record<string, string> = {};
      if (dedup_key) appProperties.dedup_key = String(dedup_key);
      if (content_hash) appProperties.content_hash = String(content_hash);
      if (lead_id) appProperties.lead_id = String(lead_id);
      const metadata = JSON.stringify({
        name: file_name,
        parents: [subFolderId],
        ...(Object.keys(appProperties).length ? { appProperties } : {}),
      });
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
      if (!res.ok) throw new Error(`drive upload_url_typed failed [${res.status}]: ${await res.text()}`);
      const file = await res.json();
      return new Response(
        JSON.stringify({ ok: true, file, lead_folder_id: leadFolderId, subfolder_id: subFolderId, _functionVersion: FUNCTION_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e) {
    console.error("[lead-drive] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
