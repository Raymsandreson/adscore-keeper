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

async function fetchGroupInfoFromUazapi(baseUrl: string, token: string, groupJid: string): Promise<{ participants: any[]; name: string | null; raw: any }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/group/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ groupjid: groupJid, force: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`uazapi /group/info ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  const participants =
    data?.Participants || data?.participants ||
    data?.group?.Participants || data?.group?.participants || [];
  const name = data?.Name || data?.name || data?.subject || null;
  return { participants, name, raw: data };
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

    // Busca telefones de TODAS as instâncias da org pra filtrar (atendentes != leads).
    const { data: allInst } = await cloud
      .from("whatsapp_instances")
      .select("owner_phone");
    const ownerKeys = new Set(
      (allInst || [])
        .map((r: any) => digits(r.owner_phone || "").slice(-10))
        .filter((k: string) => k.length >= 8),
    );

    function isOwnerInstance(phoneDigits: string) {
      const key = phoneDigits.slice(-10);
      return key.length >= 8 && ownerKeys.has(key);
    }

    const { data, error } = await cloud
      .from("whatsapp_groups_cache")
      .select("group_jid, group_name, participants, fetched_at")
      .ilike("instance_name", instance_name)
      .eq("group_jid", group_jid)
      .maybeSingle();
    if (error) throw error;

    let parts: any[] = [];
    let groupName: string | null = null;
    let fetchedAt: string = new Date().toISOString();

    if (data && Array.isArray(data.participants) && data.participants.length > 0) {
      parts = data.participants;
      groupName = data.group_name;
      fetchedAt = data.fetched_at;
    } else {
      const { data: instRow } = await cloud
        .from("whatsapp_instances")
        .select("base_url, instance_token")
        .ilike("instance_name", instance_name)
        .maybeSingle();
      if (!instRow?.base_url || !instRow?.instance_token) {
        return new Response(
          JSON.stringify({ success: false, error: "instance not found" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      parts = await fetchGroupParticipantsFromUazapi(
        instRow.base_url,
        instRow.instance_token,
        group_jid,
      );
    }

    const phones = parts
      .map((p: any) => {
        const raw = String(p?.id || p?.jid || p?.phone || p?.participant || p || "");
        const ph = digits(raw);
        return ph ? { phone: ph, raw } : null;
      })
      .filter(Boolean) as { phone: string; raw: string }[];

    const filtered = phones.filter((p) => !isOwnerInstance(p.phone));
    const removed = phones.length - filtered.length;

    return new Response(
      JSON.stringify({
        success: true,
        group_jid,
        group_name: groupName,
        fetched_at: fetchedAt,
        participants: filtered,
        excluded_instances_count: removed,
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
