import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"*" };
Deno.serve(async () => {
  const ext = createClient(Deno.env.get("EXTERNAL_SUPABASE_URL")!, Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!);
  const { count } = await ext.from("whatsapp_groups_index").select("*", { count: "exact", head: true });
  const { data: byInst } = await ext.rpc("search_whatsapp_groups_by_tokens", { p_tokens: null, p_instance_names: null, p_limit: 10000 });
  const grouped: Record<string, number> = {};
  for (const r of (byInst as any[] || [])) grouped[r.instance_name] = (grouped[r.instance_name] || 0) + 1;
  return new Response(JSON.stringify({ total: count, by_instance: grouped }), { headers: { ...corsHeaders, "Content-Type":"application/json" } });
});
