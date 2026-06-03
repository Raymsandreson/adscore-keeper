import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getExternalClient } from "../_shared/external-client.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lead_id } = await req.json();
    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const extClient = getExternalClient();

    // Get group JID for this lead
    const { data: groups } = await extClient
      .from("lead_whatsapp_groups")
      .select("group_jid, group_name")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(1);

    let groupJid = groups?.[0]?.group_jid;

    if (!groupJid) {
      // Fallback: check leads.whatsapp_group_id (External)
      const { data: lead } = await extClient
        .from("leads")
        .select("whatsapp_group_id")
        .eq("id", lead_id)
        .maybeSingle();
      groupJid = (lead as any)?.whatsapp_group_id;
    }


    if (!groupJid) {
      return new Response(
        JSON.stringify({ success: false, error: "No group linked to this lead" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!groupJid.includes("@")) {
      groupJid = `${groupJid}@g.us`;
    }

    // Pega qualquer instância com token — não exige status='connected' porque
    // pode estar como 'open'/'active' e ainda assim responder ao /group/info.
    // Ordena: connected primeiro, depois as outras.
    // whatsapp_instances vivem no Externo (não no Cloud).
    const { data: instances } = await extClient
      .from("whatsapp_instances")
      .select("id, instance_name, instance_token, base_url, is_active")
      .not("instance_token", "is", null);

    const sortedInstances = (instances || []).sort((a: any, b: any) => {
      const score = (i: any) => (i.is_active ? 0 : 1);
      return score(a) - score(b);
    });


    if (!sortedInstances.length) {
      return new Response(
        JSON.stringify({ success: false, error: "No instances with token available" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to get group info from UazAPI
    // Limita tentativas e usa timeout por chamada — sem isso, instâncias
    // desconectadas penduram a função até o limite de 150s.
    const MAX_TRIES = 8;
    const PER_CALL_MS = 4000;
    for (const inst of sortedInstances.slice(0, MAX_TRIES)) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), PER_CALL_MS);
        const res = await fetch(`${baseUrl}/group/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({ groupjid: groupJid }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(tid));

        if (!res.ok) continue;

        const data = await res.json();
        
        // UazAPI may return creation timestamp in different fields
        const creationTs = data?.creation || data?.GroupCreated || data?.created_at || 
          data?.data?.creation || data?.data?.GroupCreated;

        if (creationTs) {
          // Convert Unix timestamp (seconds) to ISO date
          let creationDate: string;
          if (typeof creationTs === "number") {
            // Unix timestamp in seconds
            const d = new Date(creationTs * 1000);
            creationDate = d.toISOString().split("T")[0];
          } else {
            const d = new Date(creationTs);
            creationDate = d.toISOString().split("T")[0];
          }

          return new Response(
            JSON.stringify({ 
              success: true, 
              creation_date: creationDate,
              group_name: data?.subject || data?.name || groups?.[0]?.group_name || "",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // If no creation date in response but got group data, return null date
        if (data?.subject || data?.participants) {
          return new Response(
            JSON.stringify({ success: true, creation_date: null, group_name: data?.subject || "" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e) {
        console.warn(`Instance ${inst.instance_name} failed:`, e);
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: "Could not fetch group info" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
