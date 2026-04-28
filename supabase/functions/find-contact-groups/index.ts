// find-contact-groups
// ============================================================
// Dado um telefone (participante) e uma instância UazAPI, retorna
// TODOS os grupos da instância em que o telefone aparece como
// participante. Usa cache em `whatsapp_groups_cache` (Cloud) com
// TTL de 6h. Suporta force_refresh=true para ignorar o cache.
//
// Body:
//   { phone: string, instance_name: string, force_refresh?: boolean }
//
// Resposta:
//   { groups: [{ jid, name, invite_link, participants_count }],
//     from_cache: boolean, fetched_at: string }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// Match key = últimos 10 dígitos (DDD + número, sem 9º se Brasil)
// Reduz colisão de DDI/DDD em comparações "endsWith".
function phoneMatchKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-10);
}

function extractParticipantKeys(group: any): string[] {
  const list: any[] =
    group.participants || group.Participants || group.members || [];
  const keys: string[] = [];
  for (const p of list) {
    const id = String(
      p?.id || p?.jid || p?.phone || p?.participant || p || "",
    );
    const k = phoneMatchKey(id);
    if (k) keys.push(k);
  }
  return keys;
}

async function fetchGroupsFromUazapi(
  baseUrl: string,
  token: string,
): Promise<any[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/group/list`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ getParticipants: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`uazapi /group/list ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  if (Array.isArray(data)) return data;
  return data?.groups || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const phone: string | undefined = body?.phone;
    const instance_name: string | undefined = body?.instance_name;
    const force_refresh: boolean = body?.force_refresh === true;

    if (!phone || !instance_name) {
      return new Response(
        JSON.stringify({ error: "phone and instance_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const matchKey = phoneMatchKey(phone);
    if (!matchKey || matchKey.length < 8) {
      return new Response(
        JSON.stringify({ error: "phone has too few digits", matchKey }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cloud client (cache + whatsapp_instances vivem no Cloud)
    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const cloudKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cloud = createClient(cloudUrl, cloudKey);

    // 1) Verificar cache
    let fromCache = true;
    let fetchedAt: string | null = null;
    let cachedRows: any[] = [];

    if (!force_refresh) {
      const { data: rows } = await cloud
        .from("whatsapp_groups_cache")
        .select("group_jid, group_name, invite_link, participants, participants_count, fetched_at")
        .ilike("instance_name", instance_name);

      if (rows && rows.length > 0) {
        const newest = rows.reduce((acc, r) =>
          new Date(r.fetched_at) > new Date(acc.fetched_at) ? r : acc,
        );
        const age = Date.now() - new Date(newest.fetched_at).getTime();
        if (age < CACHE_TTL_MS) {
          cachedRows = rows;
          fetchedAt = newest.fetched_at;
        }
      }
    }

    // 2) Cache miss / expirado / force => buscar no UazAPI
    if (cachedRows.length === 0) {
      fromCache = false;
      const { data: instRow, error: instErr } = await cloud
        .from("whatsapp_instances")
        .select("base_url, instance_token, instance_name")
        .ilike("instance_name", instance_name)
        .maybeSingle();

      if (instErr) throw instErr;
      if (!instRow?.base_url || !instRow?.instance_token) {
        return new Response(
          JSON.stringify({ error: "instance not found or missing credentials", instance_name }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const groups = await fetchGroupsFromUazapi(
        instRow.base_url,
        instRow.instance_token,
      );

      // Upsert no cache
      const now = new Date().toISOString();
      fetchedAt = now;
      const upsertRows = groups
        .map((g) => {
          const jid = g.id || g.jid || g.JID || null;
          if (!jid) return null;
          const participants = (g.participants || g.Participants || []).map((p: any) => {
            const id = String(p?.id || p?.jid || p?.phone || p || "");
            return { id, key: phoneMatchKey(id) };
          });
          return {
            instance_name: instRow.instance_name,
            group_jid: jid,
            group_name: g.subject || g.name || null,
            invite_link: g.invite_link || g.inviteLink || null,
            participants,
            participants_count: participants.length,
            fetched_at: now,
          };
        })
        .filter(Boolean) as any[];

      if (upsertRows.length > 0) {
        const { error: upErr } = await cloud
          .from("whatsapp_groups_cache")
          .upsert(upsertRows, { onConflict: "instance_name,group_jid" });
        if (upErr) console.warn("[find-contact-groups] cache upsert error:", upErr);
      }

      cachedRows = upsertRows;
    }

    // 3) Filtrar grupos onde matchKey aparece nos participantes
    const matched: any[] = [];
    for (const r of cachedRows) {
      const parts: any[] = Array.isArray(r.participants) ? r.participants : [];
      const keys = parts
        .map((p) => p?.key || phoneMatchKey(p?.id || p))
        .filter(Boolean);
      if (keys.includes(matchKey)) {
        matched.push({
          jid: r.group_jid,
          name: r.group_name,
          invite_link: r.invite_link,
          participants_count: r.participants_count,
        });
      }
    }

    return new Response(
      JSON.stringify({
        groups: matched,
        from_cache: fromCache,
        fetched_at: fetchedAt,
        scanned: cachedRows.length,
        match_key: matchKey,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[find-contact-groups] error:", e);
    return new Response(
      JSON.stringify({ error: String((e as any)?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
