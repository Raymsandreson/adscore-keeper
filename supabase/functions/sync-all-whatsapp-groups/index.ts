// sync-all-whatsapp-groups
// ============================================================
// Lista TODOS os grupos de cada instância WhatsApp conectada via
// UazAPI POST /group/list e faz upsert em `whatsapp_groups_index`
// (Externo). Sem dependência de whatsapp_messages — pega 100% dos
// grupos, mesmo sem mensagens recentes.
//
// Body:
//   {}                                -> sincroniza TODAS as instâncias conectadas
//   { instance_name: "X" }            -> apenas uma instância
//   { force: true }                   -> força refresh do cache UazAPI (mais lento)
//   { include_participants: true }    -> traz participantes (mais lento/pesado)
//   { concurrency: 5 }                -> paralelismo (default 4)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Inst = { instance_name: string; base_url: string | null; token: string };

async function fetchGroupsFromUazapi(
  baseUrl: string,
  token: string,
  opts: { force: boolean; noParticipants: boolean },
): Promise<any[]> {
  const url = `${(baseUrl || "https://abraci.uazapi.com").replace(/\/$/, "")}/group/list`;
  const all: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        force: opts.force && offset === 0, // só força no primeiro request
        noParticipants: opts.noParticipants,
        limit: PAGE,
        offset,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`uazapi /group/list ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => null);
    const page: any[] = Array.isArray(data) ? data : (data?.groups || []);
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}

async function syncInstance(
  external: ReturnType<typeof createClient>,
  inst: Inst,
  opts: { force: boolean; include_participants: boolean },
) {
  const t0 = Date.now();
  try {
    const groups = await fetchGroupsFromUazapi(inst.base_url || "", inst.token, {
      force: opts.force,
      noParticipants: !opts.include_participants,
    });

    const rows: any[] = [];
    const snapshotRows: any[] = [];
    for (const g of groups as any[]) {
      const jid: string | null = g.JID || g.jid || g.id || null;
      if (!jid || !jid.includes("@g.us")) continue;
      const name: string | null =
        g.Name || g.name || g.subject || g.Topic || null;
      const partsArr = g.Participants || g.participants || [];
      const participantsCount = Array.isArray(partsArr) ? partsArr.length : 0;
      const ownerJid: string | null = g.Owner || g.owner || g.GroupOwner || null;
      const isLocked = !!(g.IsLocked ?? g.locked ?? false);
      const isAnnounce = !!(g.IsAnnounce ?? g.announce ?? false);
      const topic: string | null = g.Topic || g.topic || g.description || null;
      const createdRaw = g.GroupCreated || g.creation || g.GroupCreatedAt || g.created_at || null;
      const createdIso = createdRaw ? new Date(createdRaw).toISOString() : null;

      rows.push({
        group_jid: jid,
        instance_name: inst.instance_name,
        contact_name: name,
        last_seen: createdIso || new Date().toISOString(),
        message_count: 0,
        updated_at: new Date().toISOString(),
      });

      snapshotRows.push({
        jid,
        group_name: name,
        group_created_at: createdIso,
        owner_jid: ownerJid,
        is_locked: isLocked,
        is_announce: isAnnounce,
        topic,
        participants_count: participantsCount,
      });
    }

    if (rows.length === 0) {
      return { instance: inst.instance_name, ok: true, total: 0, ms: Date.now() - t0 };
    }

    // Upsert em lotes de 500 — whatsapp_groups_index
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await external
        .from("whatsapp_groups_index")
        .upsert(slice, { onConflict: "group_jid,instance_name" });
      if (error) throw new Error(error.message);
      upserted += slice.length;
    }

    // Upsert em lotes de 500 — whatsapp_groups_uazapi_snapshot (chave: jid)
    for (let i = 0; i < snapshotRows.length; i += 500) {
      const slice = snapshotRows.slice(i, i + 500);
      const { error: snapErr } = await external
        .from("whatsapp_groups_uazapi_snapshot")
        .upsert(slice, { onConflict: "jid" });
      if (snapErr) console.warn(`[sync] snapshot upsert error (${inst.instance_name}):`, snapErr.message);
    }

    return { instance: inst.instance_name, ok: true, total: upserted, ms: Date.now() - t0 };
  } catch (e: any) {
    return {
      instance: inst.instance_name,
      ok: false,
      error: String(e?.message || e),
      ms: Date.now() - t0,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const force: boolean = !!body.force;
    const include_participants: boolean = !!body.include_participants;
    const concurrency: number = Math.max(1, Math.min(10, body.concurrency || 4));
    const onlyInstance: string | undefined = body.instance_name;

    const cloud = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const external = createClient(
      Deno.env.get("EXTERNAL_SUPABASE_URL")!,
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = cloud
      .from("whatsapp_instances")
      .select("instance_name, base_url, instance_token")
      .eq("is_active", true)
      .not("instance_token", "is", null);
    if (onlyInstance) q = q.ilike("instance_name", onlyInstance);
    const { data: rawInstances, error: instErr } = await q;
    const instances = (rawInstances || []).map((r: any) => ({
      instance_name: r.instance_name,
      base_url: r.base_url,
      token: r.instance_token,
    }));
    if (instErr) throw new Error(`load instances: ${instErr.message}`);
    if (!instances || instances.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Nenhuma instância conectada.", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Roda com concorrência limitada
    const results: any[] = [];
    let idx = 0;
    async function worker() {
      while (idx < instances.length) {
        const i = idx++;
        const r = await syncInstance(external, instances[i] as Inst, {
          force,
          include_participants,
        });
        results.push(r);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    const totalGroups = results.reduce((acc, r) => acc + (r.total || 0), 0);
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    // ============================================================
    // FALLBACK BACKFILL — para grupos que estão no index mas sem
    // group_created_at no snapshot, tenta /group/info em cada
    // instância conectada que enxerga o grupo, até uma responder.
    // Útil quando /group/list devolve resumo sem `creation`.
    // ============================================================
    let backfilled = 0;
    let backfillTried = 0;
    let backfillSkipped = 0;
    try {
      const okInstanceNames = new Set(
        results.filter((r) => r.ok).map((r) => String(r.instance).toLowerCase()),
      );
      const instByName = new Map(
        instances.map((i) => [i.instance_name.toLowerCase(), i as Inst]),
      );

      // 1) Lista JIDs ainda sem data
      const { data: missingRows } = await external
        .from("whatsapp_groups_index" as any)
        .select("group_jid, instance_name")
        .limit(20000);
      const snapshotJids = new Set<string>();
      {
        const { data: snapRows } = await external
          .from("whatsapp_groups_uazapi_snapshot" as any)
          .select("jid, group_created_at")
          .not("group_created_at", "is", null)
          .limit(50000);
        for (const r of (snapRows as any[]) || []) snapshotJids.add(r.jid);
      }
      // jid -> instâncias conectadas que o veem
      const candidates = new Map<string, string[]>();
      for (const row of (missingRows as any[]) || []) {
        const jid = row.group_jid as string;
        if (!jid || snapshotJids.has(jid)) continue;
        if (!okInstanceNames.has(String(row.instance_name).toLowerCase())) continue;
        const arr = candidates.get(jid) || [];
        if (!arr.includes(row.instance_name)) arr.push(row.instance_name);
        candidates.set(jid, arr);
      }

      const entries = Array.from(candidates.entries());
      const BACKFILL_CONCURRENCY = 12;
      const BACKFILL_TIME_BUDGET_MS = 110_000; // deixa folga pro response
      const bf_t0 = Date.now();
      const snapshotBuffer: any[] = [];

      async function flushBuffer() {
        if (snapshotBuffer.length === 0) return;
        const slice = snapshotBuffer.splice(0, snapshotBuffer.length);
        await external
          .from("whatsapp_groups_uazapi_snapshot" as any)
          .upsert(slice, { onConflict: "jid" });
      }

      let bfIdx = 0;
      async function bfWorker() {
        while (bfIdx < entries.length) {
          if (Date.now() - bf_t0 > BACKFILL_TIME_BUDGET_MS) return;
          const i = bfIdx++;
          const [jid, instNames] = entries[i];
          backfillTried++;
          let got: any = null;
          let gotFrom: string | null = null;
          for (const instName of instNames) {
            const inst = instByName.get(instName.toLowerCase());
            if (!inst) continue;
            try {
              const url = `${(inst.base_url || "https://abraci.uazapi.com").replace(/\/$/, "")}/group/info`;
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", token: inst.token },
                body: JSON.stringify({ groupjid: jid, getInviteLink: false }),
              });
              if (!res.ok) continue;
              const data = await res.json().catch(() => null);
              const g = data?.group || data;
              const created = g?.GroupCreated || g?.creation || g?.GroupCreatedAt || g?.created_at;
              if (created) { got = g; gotFrom = instName; break; }
            } catch (_) { /* try next */ }
          }
          if (!got) { backfillSkipped++; continue; }
          const createdRaw = got.GroupCreated || got.creation || got.GroupCreatedAt || got.created_at;
          snapshotBuffer.push({
            jid,
            group_name: got.Name || got.name || got.subject || null,
            group_created_at: new Date(createdRaw).toISOString(),
            owner_jid: got.Owner || got.owner || null,
            is_locked: !!(got.IsLocked ?? got.locked ?? false),
            is_announce: !!(got.IsAnnounce ?? got.announce ?? false),
            topic: got.Topic || got.topic || null,
            participants_count: Array.isArray(got.Participants || got.participants)
              ? (got.Participants || got.participants).length : 0,
          });
          backfilled++;
          if (snapshotBuffer.length >= 100) await flushBuffer();
          if (backfilled % 50 === 0) console.log(`[backfill] progresso: ${backfilled}/${entries.length} (último via ${gotFrom})`);
        }
      }
      await Promise.all(Array.from({ length: BACKFILL_CONCURRENCY }, bfWorker));
      await flushBuffer();
    } catch (e: any) {
      console.warn("[backfill] erro:", e?.message || e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        instances_processed: results.length,
        instances_ok: okCount,
        instances_failed: failCount,
        total_groups_upserted: totalGroups,
        backfill: { tried: backfillTried, recovered: backfilled, still_missing: backfillSkipped },
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
