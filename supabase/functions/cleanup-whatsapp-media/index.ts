// Edge function: cleanup-whatsapp-media
// Remove arquivos do bucket `whatsapp-media` com mais de 90 dias.
// Sincroniza com a limpeza de mensagens antigas para reduzir egress/storage.
// Pode ser invocado manualmente ou via pg_cron. Retorna HTTP 200 sempre.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "whatsapp-media";
const RETENTION_DAYS = 90;
const BATCH_DELETE = 500; // limite por chamada de storage.remove
const MAX_PER_RUN = 5000;  // teto por invocação (~10 batches)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

  try {
    // Buscar paths antigos via tabela storage.objects (PostgREST não expõe — usar RPC ou query direta via service role).
    // Aqui usamos uma query SQL através do supabase-js .rpc('exec_sql') seria perigoso; preferimos paginação por listagem.
    // Estratégia: consultar storage.objects via REST do PostgREST não funciona (schema storage é restrito).
    // Solução: usar a função interna admin via fetch direto ao schema storage com PostgREST headers.

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();

    const listRes = await fetch(
      `${supabaseUrl}/rest/v1/objects?select=name&bucket_id=eq.${BUCKET}&created_at=lt.${cutoff}&limit=${MAX_PER_RUN}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Accept-Profile": "storage",
        },
      },
    );

    if (!listRes.ok) {
      const text = await listRes.text();
      return new Response(
        JSON.stringify({ success: false, error: `list failed: ${listRes.status} ${text}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = (await listRes.json()) as Array<{ name: string }>;
    const paths = rows.map((r) => r.name);

    if (dryRun) {
      return new Response(
        JSON.stringify({ success: true, dry_run: true, would_delete: paths.length, sample: paths.slice(0, 5) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let removed = 0;
    const errors: string[] = [];
    for (let i = 0; i < paths.length; i += BATCH_DELETE) {
      const batch = paths.slice(i, i + BATCH_DELETE);
      const { error } = await admin.storage.from(BUCKET).remove(batch);
      if (error) errors.push(error.message);
      else removed += batch.length;
    }

    return new Response(
      JSON.stringify({ success: true, removed, total_found: paths.length, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
