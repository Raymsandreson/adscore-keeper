import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { group_jid, instance_name } = await req.json();
  const cloud = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: i } = await cloud.from("whatsapp_instances")
    .select("instance_name, instance_token, base_url").eq("instance_name", instance_name).maybeSingle();
  if (!i) return new Response("no inst", { status: 404 });
  const baseUrl = i.base_url || "https://abraci.uazapi.com";

  const attempts: any[] = [];
  // Try different payload shapes and endpoints
  const variants = [
    { ep: "/group/info", body: { id: group_jid } },
    { ep: "/group/info", body: { groupjid: group_jid } },
    { ep: "/group/info", body: { phone: group_jid } },
    { ep: "/group", body: { id: group_jid } },
    { ep: "/group/get", body: { id: group_jid } },
    { ep: "/group/metadata", body: { id: group_jid } },
  ];
  for (const v of variants) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${baseUrl}${v.ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: i.instance_token },
        body: JSON.stringify(v.body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const t = await r.text();
      attempts.push({ ...v, status: r.status, body: t.slice(0, 600) });
    } catch (e) { attempts.push({ ...v, err: String((e as any)?.message || e) }); }
  }
  return new Response(JSON.stringify(attempts, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
