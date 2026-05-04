// get-group-participants
// ============================================================
// Lista participantes de UM grupo, enriquecidos via UazAPI /chat/details:
//   - nome (lead_fullName > lead_name > wa_contactName > wa_name > name)
//   - imagePreview (foto)
//   - lead_email, lead_personalid (CPF), lead_notes
//   - common_groups (string -> array {name, jid})
//   - is_admin (do grupo atual)
// Cache em whatsapp_chat_details_cache (External, TTL 24h).
//
// Body: { group_jid, instance_name, refresh?: boolean }
// Resp: { success, participants: [...], group_name, fetched_at }
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CONCURRENCY = 6;

function digits(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

async function fetchGroupInfoFromUazapi(baseUrl: string, token: string, groupJid: string) {
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
  return { participants, name };
}

async function fetchChatDetails(baseUrl: string, token: string, number: string) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number, preview: true }),
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

function parseCommonGroups(s: any): Array<{ name: string; jid: string }> {
  if (!s || typeof s !== "string") return [];
  // Format: "Nome(jid@g.us),Nome2(jid2@g.us)"
  const out: Array<{ name: string; jid: string }> = [];
  const re = /([^,(]+)\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ name: m[1].trim(), jid: m[2].trim() });
  }
  return out;
}

function pickName(d: any): string | null {
  return (
    d?.lead_fullName ||
    d?.lead_name ||
    d?.wa_contactName ||
    d?.wa_name ||
    d?.name ||
    null
  );
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null as any; }
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { group_jid, instance_name, refresh } = await req.json().catch(() => ({}));
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
    const ext = createClient(
      Deno.env.get("EXTERNAL_SUPABASE_URL")!,
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Filtra phones que pertencem a instâncias da org
    const { data: allInst } = await cloud
      .from("whatsapp_instances")
      .select("owner_phone");
    const ownerKeys = new Set(
      (allInst || [])
        .map((r: any) => digits(r.owner_phone || "").slice(-10))
        .filter((k: string) => k.length >= 8),
    );

    // 1) participantes do grupo (cache cloud OU uazapi)
    const { data: cacheRow } = await cloud
      .from("whatsapp_groups_cache")
      .select("group_jid, group_name, participants, fetched_at")
      .ilike("instance_name", instance_name)
      .eq("group_jid", group_jid)
      .maybeSingle();

    const { data: instRow } = await cloud
      .from("whatsapp_instances")
      .select("base_url, instance_token, instance_name")
      .ilike("instance_name", instance_name)
      .maybeSingle();
    if (!instRow?.base_url || !instRow?.instance_token) {
      return new Response(
        JSON.stringify({ success: false, error: "instance not found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let rawParts: any[] = [];
    let groupName: string | null = null;
    let fetchedAt = new Date().toISOString();

    if (cacheRow && Array.isArray(cacheRow.participants) && cacheRow.participants.length > 0 && !refresh) {
      rawParts = cacheRow.participants;
      groupName = cacheRow.group_name;
      fetchedAt = cacheRow.fetched_at;
    } else {
      const info = await fetchGroupInfoFromUazapi(instRow.base_url, instRow.instance_token, group_jid);
      rawParts = info.participants;
      groupName = info.name;
      try {
        await cloud.from("whatsapp_groups_cache").upsert({
          instance_name: instRow.instance_name,
          group_jid,
          group_name: groupName,
          participants: rawParts,
          participants_count: rawParts.length,
          fetched_at: fetchedAt,
        }, { onConflict: "instance_name,group_jid" });
      } catch (e) {
        console.warn("[get-group-participants] groups_cache upsert failed:", (e as any)?.message);
      }
    }

    // 2) extrai phones + admin flag
    const baseList = rawParts
      .map((p: any) => {
        const raw = String(p?.JID || p?.PhoneNumber || p?.id || p?.jid || p?.phone || p?.participant || p || "");
        const phone = digits(raw);
        if (!phone) return null;
        const isAdmin = !!(p?.IsAdmin || p?.isAdmin || p?.admin || p?.IsSuperAdmin || p?.superAdmin);
        return { phone, raw, is_admin: isAdmin };
      })
      .filter(Boolean) as Array<{ phone: string; raw: string; is_admin: boolean }>;

    // remove instâncias da org
    const filtered = baseList.filter((p) => {
      const k = p.phone.slice(-10);
      return !(k.length >= 8 && ownerKeys.has(k));
    });
    const excluded = baseList.length - filtered.length;

    // 3) busca cache /chat/details no Externo (TTL)
    const phones = filtered.map((p) => p.phone);
    let cachedDetails: Record<string, any> = {};
    if (phones.length > 0) {
      const { data: cached } = await ext
        .from("whatsapp_chat_details_cache")
        .select("*")
        .ilike("instance_name", instance_name)
        .in("phone", phones);
      const cutoff = Date.now() - CACHE_TTL_MS;
      (cached || []).forEach((c: any) => {
        if (new Date(c.fetched_at).getTime() >= cutoff) {
          cachedDetails[c.phone] = c;
        }
      });
    }

    // 4) /chat/details para os faltantes (em paralelo, com concorrência limitada)
    const missing = filtered.filter((p) => !cachedDetails[p.phone]);
    if (missing.length > 0 && !refresh) {
      // segue
    }
    const fetchTargets = refresh ? filtered : missing;
    const newDetails = await mapWithConcurrency(fetchTargets, CONCURRENCY, async (p) => {
      const d = await fetchChatDetails(instRow.base_url, instRow.instance_token, p.phone);
      if (!d) return null;
      const row = {
        instance_name: instRow.instance_name,
        phone: p.phone,
        name: pickName(d),
        image: d?.image || d?.imagePreview || null,
        is_group: false,
        lead_email: d?.lead_email || null,
        lead_personalid: d?.lead_personalid || null,
        lead_name: d?.lead_name || null,
        lead_full_name: d?.lead_fullName || null,
        lead_status: d?.lead_status || null,
        lead_tags: Array.isArray(d?.lead_tags) ? d.lead_tags : null,
        lead_notes: d?.lead_notes || null,
        common_groups: parseCommonGroups(d?.common_groups),
        raw: d,
        fetched_at: new Date().toISOString(),
      };
      try {
        await ext.from("whatsapp_chat_details_cache").upsert(row, { onConflict: "instance_name,phone" });
      } catch (e) {
        console.warn("[get-group-participants] chat_details cache upsert failed:", (e as any)?.message);
      }
      return row;
    });
    newDetails.filter(Boolean).forEach((r: any) => { cachedDetails[r.phone] = r; });

    // 5) monta resposta enriquecida
    const participants = filtered.map((p) => {
      const d = cachedDetails[p.phone] || {};
      return {
        phone: p.phone,
        raw: p.raw,
        is_admin: p.is_admin,
        name: d.name || null,
        image: d.image || null,
        lead_email: d.lead_email || null,
        lead_personalid: d.lead_personalid || null,
        lead_notes: d.lead_notes || null,
        common_groups: d.common_groups || [],
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        group_jid,
        group_name: groupName,
        fetched_at: fetchedAt,
        participants,
        excluded_instances_count: excluded,
        enriched_count: participants.filter((p) => p.name).length,
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
