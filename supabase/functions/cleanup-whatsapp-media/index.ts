// Edge function: cleanup-whatsapp-media
// Remove arquivos antigos do bucket `whatsapp-media` para reduzir egress/storage.
// Aceita POST body: { kinds?: ('video'|'audio'|'image'|'other')[], retention_days?: number, dry_run?: boolean, max?: number }
// Padrão: video+audio, 60 dias, dry_run=false, max=5000.
// Retorna HTTP 200 sempre.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "whatsapp-media";
const BATCH_DELETE = 500;

const EXT_MAP: Record<string, RegExp> = {
  video: /\.(mp4|mov|webm|3gp|avi|mkv)$/i,
  audio: /\.(ogg|opus|mp3|m4a|wav|aac)$/i,
  image: /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/i,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* GET or empty */ }
  const url = new URL(req.url);
  const kinds: string[] = body.kinds ?? url.searchParams.get("kinds")?.split(",") ?? ["video", "audio"];
  const retentionDays = Number(body.retention_days ?? url.searchParams.get("retention_days") ?? 60);
  const dryRun = body.dry_run === true || url.searchParams.get("dry_run") === "1";
  const max = Number(body.max ?? url.searchParams.get("max") ?? 5000);

  try {
    const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();

    // Build extension OR filter for PostgREST (using or=(name.ilike.*.mp4,name.ilike.*.mov,...))
    const extensions: string[] = [];
    for (const k of kinds) {
      if (k === "video") extensions.push("mp4","mov","webm","3gp","avi","mkv");
      else if (k === "audio") extensions.push("ogg","opus","mp3","m4a","wav","aac");
      else if (k === "image") extensions.push("jpg","jpeg","png","gif","webp","bmp","heic");
    }
    if (extensions.length === 0) {
      return json({ success: false, error: "no valid kinds" });
    }
    const orFilter = extensions.map((e) => `name.ilike.*.${e}`).join(",");

    const listUrl = `${supabaseUrl}/rest/v1/objects?select=name,metadata&bucket_id=eq.${BUCKET}&created_at=lt.${cutoff}&or=(${orFilter})&limit=${max}`;
    const listRes = await fetch(listUrl, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Accept-Profile": "storage",
      },
    });

    if (!listRes.ok) {
      const text = await listRes.text();
      return json({ success: false, error: `list failed: ${listRes.status} ${text}` });
    }

    const rows = (await listRes.json()) as Array<{ name: string; metadata: any }>;
    const paths = rows.map((r) => r.name);
    const totalBytes = rows.reduce((s, r) => s + (Number(r.metadata?.size) || 0), 0);

    if (dryRun) {
      return json({
        success: true,
        dry_run: true,
        would_delete: paths.length,
        total_mb: Math.round(totalBytes / 1024 / 1024),
        sample: paths.slice(0, 5),
        kinds,
        retention_days: retentionDays,
      });
    }

    let removed = 0;
    const errors: string[] = [];
    for (let i = 0; i < paths.length; i += BATCH_DELETE) {
      const batch = paths.slice(i, i + BATCH_DELETE);
      const { error } = await admin.storage.from(BUCKET).remove(batch);
      if (error) errors.push(error.message);
      else removed += batch.length;
    }

    return json({
      success: true,
      removed,
      total_found: paths.length,
      total_mb: Math.round(totalBytes / 1024 / 1024),
      errors,
      kinds,
      retention_days: retentionDays,
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message });
  }

  function json(payload: unknown) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
