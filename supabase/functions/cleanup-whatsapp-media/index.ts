// Edge function: cleanup-whatsapp-media
// Deleta lista de paths do bucket `whatsapp-media`.
// POST body: { paths: string[], dry_run?: boolean }
// Retorna HTTP 200 sempre.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "whatsapp-media";
const BATCH_DELETE = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const paths: string[] = Array.isArray(body.paths) ? body.paths : [];
    const dryRun = body.dry_run === true;

    if (paths.length === 0) {
      return json({ success: false, error: "paths array is required" });
    }

    if (dryRun) {
      return json({ success: true, dry_run: true, would_delete: paths.length, sample: paths.slice(0, 3) });
    }

    let removed = 0;
    const errors: string[] = [];
    for (let i = 0; i < paths.length; i += BATCH_DELETE) {
      const batch = paths.slice(i, i + BATCH_DELETE);
      const { error } = await admin.storage.from(BUCKET).remove(batch);
      if (error) errors.push(error.message);
      else removed += batch.length;
    }

    return json({ success: true, removed, total: paths.length, errors });
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
