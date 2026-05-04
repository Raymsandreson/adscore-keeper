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

// Normaliza string para match por nome (lowercase + remove acentos + colapsa espaços)
const normalizeForMatch = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "para", "com", "the"]);

const tokenize = (s: string) =>
  normalizeForMatch(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));

const scoreName = (name: string, queryTokens: string[]): number => {
  if (!queryTokens.length) return 0;
  const nameNorm = normalizeForMatch(name);
  const nameTokens = tokenize(name);
  let hits = 0;
  for (const qt of queryTokens) {
    const found = nameTokens.some(
      (nt) => nt === qt || (qt.length >= 3 && (nt.startsWith(qt) || qt.startsWith(nt))),
    );
    if (found || (qt.length >= 4 && nameNorm.includes(qt))) hits++;
  }
  return hits / queryTokens.length;
};

async function fetchGroupsFromUazapi(
  baseUrl: string,
  token: string,
): Promise<any[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/group/list`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    // force: true => pede ao UazAPI para buscar a lista completa direto do WhatsApp
    body: JSON.stringify({ getParticipants: true, force: true }),
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
    const name_query: string | undefined = body?.name_query;
    const instance_name: string | undefined = body?.instance_name;
    const force_refresh: boolean = body?.force_refresh === true;
    // Por padrão, se houver name_query, busca em TODAS as instâncias do tenant.
    // Se vier explicitamente false, restringe à instance_name.
    const search_all_instances: boolean =
      body?.search_all_instances !== undefined
        ? body.search_all_instances === true
        : !!name_query;

    if (!instance_name || (!phone && !name_query)) {
      return new Response(
        JSON.stringify({ success: false, error: "instance_name and one of (phone | name_query) are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const matchKey = phone ? phoneMatchKey(phone) : null;
    if (phone && (!matchKey || matchKey.length < 8)) {
      return new Response(
        JSON.stringify({ success: false, error: "phone has too few digits", matchKey }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cloud client (cache + whatsapp_instances vivem no Cloud)
    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const cloudKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cloud = createClient(cloudUrl, cloudKey);

    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL") || "";
    const externalKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "";
    const external = externalUrl && externalKey ? createClient(externalUrl, externalKey) : null;

    // Determina instâncias a varrer
    let targetInstances: string[] = [instance_name];
    if (search_all_instances) {
      const { data: allInst } = await cloud
        .from("whatsapp_instances")
        .select("instance_name");
      if (allInst && allInst.length > 0) {
        targetInstances = Array.from(
          new Set(allInst.map((r: any) => r.instance_name).filter(Boolean)),
        );
      }
    }

    const queryTokens = name_query ? tokenize(name_query) : [];
    const conversationMatches: Array<any & { _score?: number }> = [];
    if (external && name_query && queryTokens.length > 0) {
      // Busca via RPC na tabela whatsapp_groups_index (populada pela sync diária).
      // Cobre 100% dos grupos das instâncias conectadas, mesmo sem mensagens recentes.
      const { data: rpcRows, error: rpcErr } = await external.rpc(
        "search_whatsapp_groups_by_tokens",
        {
          p_tokens: queryTokens,
          p_instance_names: search_all_instances ? null : [instance_name],
          p_preferred_instance: instance_name,
          p_limit: 200,
        },
      );
      if (rpcErr) {
        console.warn("[find-contact-groups] RPC error:", rpcErr.message);
      } else {
        for (const r of (rpcRows as any[]) || []) {
          // RPC já faz dedup por group_jid e prioriza p_preferred_instance
          conversationMatches.push({
            jid: r.group_jid,
            name: r.contact_name,
            invite_link: null,
            participants_count: 0,
            instance_name: r.instance_name,
            source: "groups_index",
            _score: r.score ?? 0.5,
          });
        }
      }
    }

    if (queryTokens.length > 0 && conversationMatches.length > 0 && !force_refresh) {
      const deduped = conversationMatches.map((m) => { delete m._score; return m; });
      return new Response(
        JSON.stringify({
          groups: deduped,
          from_cache: false,
          fetched_at: null,
          scanned: deduped.length,
          match_key: matchKey,
          name_query: name_query || null,
          source: "groups_index",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Para cada instância: tenta cache, faz fetch se necessário
    let fromCacheAll = true;
    let fetchedAt: string | null = null;
    const cachedRows: any[] = [];

    for (const inst of targetInstances) {
      let rowsForInst: any[] = [];
      let usedCache = false;

      if (!force_refresh) {
        const { data: rows } = await cloud
          .from("whatsapp_groups_cache")
          .select("group_jid, group_name, invite_link, participants, participants_count, fetched_at, instance_name")
          .ilike("instance_name", inst);

        if (rows && rows.length > 0) {
          const newest = rows.reduce((acc, r) =>
            new Date(r.fetched_at) > new Date(acc.fetched_at) ? r : acc,
          );
          const age = Date.now() - new Date(newest.fetched_at).getTime();
          if (age < CACHE_TTL_MS) {
            rowsForInst = rows;
            usedCache = true;
            if (!fetchedAt || new Date(newest.fetched_at) > new Date(fetchedAt)) {
              fetchedAt = newest.fetched_at;
            }
          }
        }
      }

      if (rowsForInst.length === 0) {
        fromCacheAll = false;
        const { data: instRow } = await cloud
          .from("whatsapp_instances")
          .select("base_url, instance_token, instance_name")
          .ilike("instance_name", inst)
          .maybeSingle();

        if (!instRow?.base_url || !instRow?.instance_token) {
          console.warn(`[find-contact-groups] skip ${inst}: no creds`);
          continue;
        }

        let groups: any[] = [];
        try {
          groups = await fetchGroupsFromUazapi(instRow.base_url, instRow.instance_token);
        } catch (e) {
          console.warn(`[find-contact-groups] fetch failed for ${inst}:`, (e as any)?.message);
          continue;
        }

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
        rowsForInst = upsertRows;
      }

      if (!usedCache) fromCacheAll = false;
      cachedRows.push(...rowsForInst);
    }

    const fromCache = fromCacheAll;

    // 3) Filtrar grupos por participante (phone) OU por nome (name_query, fuzzy por tokens)
    const matched: Array<any & { _score?: number }> = [...conversationMatches];
    const matchedKeys = new Set(matched.map((m) => `${String(m.instance_name || "").toLowerCase()}|${m.jid}`));
    for (const r of cachedRows) {
      let isMatch = false;
      let score = 0;

      if (matchKey) {
        const parts: any[] = Array.isArray(r.participants) ? r.participants : [];
        const keys = parts
          .map((p) => p?.key || phoneMatchKey(p?.id || p))
          .filter(Boolean);
        if (keys.includes(matchKey)) {
          isMatch = true;
          score = 1;
        }
      }

      if (!isMatch && queryTokens.length && r.group_name) {
        score = scoreName(String(r.group_name), queryTokens);
        // limiar: pelo menos 50% dos tokens da query batem (ou 1 token único)
        const threshold = queryTokens.length === 1 ? 1 : 0.5;
        if (score >= threshold) isMatch = true;
      }

      if (isMatch) {
        const key = `${String(r.instance_name || "").toLowerCase()}|${r.group_jid}`;
        if (matchedKeys.has(key)) continue;
        matchedKeys.add(key);
        matched.push({
          jid: r.group_jid,
          name: r.group_name,
          invite_link: r.invite_link,
          participants_count: r.participants_count,
          instance_name: r.instance_name,
          _score: score,
        });
      }
    }

    // ordena por score desc (melhores matches primeiro)
    matched.sort((a, b) => (b._score || 0) - (a._score || 0));
    matched.forEach((m) => delete m._score);

    return new Response(
      JSON.stringify({
        groups: matched,
        from_cache: fromCache,
        fetched_at: fetchedAt,
        scanned: cachedRows.length,
        match_key: matchKey,
        name_query: name_query || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[find-contact-groups] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: String((e as any)?.message || e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
