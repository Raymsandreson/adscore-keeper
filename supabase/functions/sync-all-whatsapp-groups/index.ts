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

    const rows = groups
      .map((g: any) => {
        const jid: string | null = g.JID || g.jid || g.id || null;
        if (!jid || !jid.includes("@g.us")) return null;
        const name: string | null =
          g.Name || g.name || g.subject || g.Topic || null;
        const participants =
          g.Participants?.length || g.participants?.length || 0;
        const created = g.GroupCreated || g.creation || g.GroupCreatedAt || null;
        return {
          group_jid: jid,
          instance_name: inst.instance_name,
          contact_name: name,
          // Usa created_at do grupo se vier; senão now() (será atualizado por trigger se voltar)
          last_seen: created ? new Date(created).toISOString() : new Date().toISOString(),
          message_count: 0,
          updated_at: new Date().toISOString(),
          // colunas extras opcionais (podem não existir; ignoradas pelo PG se schema permitir)
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return { instance: inst.instance_name, ok: true, total: 0, ms: Date.now() - t0 };
    }

    // Upsert em lotes de 500
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await external
        .from("whatsapp_groups_index")
        .upsert(slice, { onConflict: "group_jid,instance_name" });
      if (error) throw new Error(error.message);
      upserted += slice.length;
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

    return new Response(
      JSON.stringify({
        success: true,
        instances_processed: results.length,
        instances_ok: okCount,
        instances_failed: failCount,
        total_groups_upserted: totalGroups,
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
