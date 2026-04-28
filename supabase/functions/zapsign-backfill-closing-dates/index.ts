// Backfill became_client_date dos leads fechados via ZapSign
// Pega o signed_at mais recente em zapsign_documents pra cada lead e copia pra leads.became_client_date
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
    const ext = createClient(EXT_URL, EXT_KEY);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    // Pega docs assinados com signed_at e lead_id
    const { data: docs, error: docsErr } = await ext
      .from("zapsign_documents")
      .select("lead_id, signed_at")
      .eq("status", "signed")
      .not("signed_at", "is", null)
      .not("lead_id", "is", null);

    if (docsErr) throw new Error(`fetch docs: ${docsErr.message}`);

    // Pega o signed_at mais recente por lead
    const latestByLead = new Map<string, string>();
    for (const d of docs || []) {
      const cur = latestByLead.get(d.lead_id);
      if (!cur || new Date(d.signed_at) > new Date(cur)) {
        latestByLead.set(d.lead_id, d.signed_at);
      }
    }

    // Carrega became_client_date atual dos leads alvo
    const leadIds = [...latestByLead.keys()];
    const { data: leads, error: leadsErr } = await ext
      .from("leads")
      .select("id, became_client_date, lead_name")
      .in("id", leadIds);
    if (leadsErr) throw new Error(`fetch leads: ${leadsErr.message}`);

    let toUpdate: Array<{ id: string; old: string | null; new: string; name: string }> = [];
    for (const l of leads || []) {
      const signedAt = latestByLead.get(l.id)!;
      const newDate = signedAt.slice(0, 10);
      if (l.became_client_date !== newDate) {
        toUpdate.push({ id: l.id, old: l.became_client_date, new: newDate, name: l.lead_name });
      }
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({ dry_run: true, total_candidates: toUpdate.length, samples: toUpdate.slice(0, 20) }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let updated = 0, errors = 0;
    for (const u of toUpdate) {
      const { error } = await ext.from("leads").update({ became_client_date: u.new }).eq("id", u.id);
      if (error) errors++;
      else updated++;
    }

    return new Response(
      JSON.stringify({ updated, errors, total: toUpdate.length }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
