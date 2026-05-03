// get-group-participants
// ============================================================
// Lê os participantes de UM grupo a partir do cache
// `whatsapp_groups_cache` (Cloud). Não chama UazAPI — assume que o
// cache foi populado por `find-contact-groups` recentemente.
//
// Body: { group_jid: string, instance_name: string }
// Resposta: { participants: [{ phone, key }], group_name, fetched_at }
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function digits(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

async function fetchGroupParticipantsFromUazapi(baseUrl: string, token: string, groupJid: string): Promise<any[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/group/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ groupjid: groupJid, jid: groupJid, getParticipants: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`uazapi /group/info ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  return data?.participants || data?.Participants || data?.group?.participants || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { group_jid, instance_name } = await req.json().catch(() => ({}));
    if (!group_jid || !instance_name) {
      return new Response(
        JSON.stringify({ success: false, error: "group_jid and instance_name are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const cloud = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await cloud
      .from("whatsapp_groups_cache")
      .select("group_jid, group_name, participants, fetched_at")
      .ilike("instance_name", instance_name)
      .eq("group_jid", group_jid)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: instRow } = await cloud
        .from("whatsapp_instances")
        .select("base_url, instance_token")
        .ilike("instance_name", instance_name)
        .maybeSingle();

      if (instRow?.base_url && instRow?.instance_token) {
        const liveParts = await fetchGroupParticipantsFromUazapi(instRow.base_url, instRow.instance_token, group_jid);
        const phones = liveParts
          .map((p: any) => {
            const raw = String(p?.id || p?.jid || p?.phone || p?.participant || p || "");
            const ph = digits(raw);
            return ph ? { phone: ph, raw } : null;
          })
          .filter(Boolean);
        return new Response(
          JSON.stringify({ success: true, group_jid, group_name: null, fetched_at: new Date().toISOString(), participants: phones }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: "group not found in cache; run find-contact-groups first" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const parts = Array.isArray(data.participants) ? data.participants : [];
    const phones = parts
      .map((p: any) => {
        const raw = String(p?.id || p?.phone || p || "");
        const ph = digits(raw);
        return ph ? { phone: ph, raw } : null;
      })
      .filter(Boolean);
    return new Response(
      JSON.stringify({
        success: true,
        group_jid: data.group_jid,
        group_name: data.group_name,
        fetched_at: data.fetched_at,
        participants: phones,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[get-group-participants] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: String((e as any)?.message || e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
