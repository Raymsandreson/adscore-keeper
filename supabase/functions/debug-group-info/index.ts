import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { group_jid } = await req.json();
  const cloud = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: instances } = await cloud.from("whatsapp_instances")
    .select("instance_name, instance_token, base_url").eq("is_active", true);

  const out: any[] = [];
  for (const i of (instances || []).slice(0, 6)) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${i.base_url || "https://abraci.uazapi.com"}/group/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: i.instance_token },
        body: JSON.stringify({ id: group_jid }),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const txt = await r.text();
      out.push({ instance: i.instance_name, status: r.status, body: txt.slice(0, 800) });
    } catch (e) { out.push({ instance: i.instance_name, err: String((e as any)?.message || e) }); }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
