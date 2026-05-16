// sync-whatsapp-group-description
// ============================================================
// Sincroniza a descrição (tópico) de um grupo de WhatsApp.
// Modos:
//   { mode: "pull", group_jid, instance_name }
//     -> Busca a descrição atual no WhatsApp (UazAPI /group/info) e
//        salva em whatsapp_groups_index.description (Externo).
//   { mode: "push", group_jid, instance_name, description }
//     -> Atualiza a descrição NO WhatsApp via /group/updateDescription
//        e salva o mesmo texto no banco.
//   { mode: "get",  group_jid, instance_name }
//     -> Apenas lê a descrição armazenada no banco (sem chamar UazAPI).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(payload: any) {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function fail(error: string, extra: any = {}) {
  return new Response(JSON.stringify({ success: false, error, ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadInstance(cloud: any, instance_name: string) {
  const { data, error } = await cloud
    .from("whatsapp_instances")
    .select("instance_name, base_url, instance_token")
    .ilike("instance_name", instance_name)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`load instance: ${error.message}`);
  if (!data || !data.instance_token) throw new Error("Instância não encontrada ou sem token");
  return {
    instance_name: data.instance_name as string,
    base_url: (data.base_url || "https://abraci.uazapi.com").replace(/\/$/, ""),
    token: data.instance_token as string,
  };
}

async function fetchDescriptionFromWa(base: string, token: string, jid: string): Promise<string | null> {
  // UazAPI /group/info → retorna { Description, Topic, ... } dependendo da versão
  try {
    const res = await fetch(`${base}/group/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ groupjid: jid, force: true }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const g = data?.group || data || {};
    return (g.Description || g.description || g.Topic || g.topic || g.subjectDescription || null) as string | null;
  } catch {
    return null;
  }
}

async function pushDescriptionToWa(base: string, token: string, jid: string, description: string) {
  // Tenta endpoint principal e fallback
  const attempt = async (path: string) => {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ groupjid: jid, description }),
    });
    return { ok: r.ok, status: r.status, body: await r.text().catch(() => "") };
  };
  for (let i = 0; i < 3; i++) {
    const r = await attempt("/group/updateDescription");
    if (r.ok) return r;
    await new Promise((rs) => setTimeout(rs, 1500 * (i + 1)));
  }
  // fallback
  return await attempt("/group/description");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const mode: string = String(body.mode || "get").toLowerCase();
    const group_jid: string = String(body.group_jid || "");
    const instance_name: string = String(body.instance_name || "");
    if (!group_jid.includes("@g.us")) return fail("group_jid inválido");
    if (!instance_name) return fail("instance_name obrigatório");

    const external = createClient(
      Deno.env.get("EXTERNAL_SUPABASE_URL")!,
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // `whatsapp_instances` também vive no Externo, então reusamos o mesmo client.
    const cloud = external;

    if (mode === "get") {
      const { data, error } = await external
        .from("whatsapp_groups_index")
        .select("description, description_updated_at")
        .eq("group_jid", group_jid)
        .ilike("instance_name", instance_name)
        .maybeSingle();
      if (error) return fail(error.message);
      return ok({ description: data?.description ?? null, description_updated_at: data?.description_updated_at ?? null });
    }

    const inst = await loadInstance(cloud, instance_name);

    if (mode === "pull") {
      const desc = await fetchDescriptionFromWa(inst.base_url, inst.token, group_jid);
      if (desc === null) return fail("Não foi possível ler a descrição na UazAPI");
      const { error } = await external
        .from("whatsapp_groups_index")
        .upsert(
          {
            group_jid,
            instance_name: inst.instance_name,
            description: desc,
            description_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_seen: new Date().toISOString(),
          },
          { onConflict: "group_jid,instance_name" },
        );
      if (error) return fail(`save: ${error.message}`);
      return ok({ mode: "pull", description: desc });
    }

    if (mode === "push") {
      const description: string = String(body.description ?? "");
      if (description.length > 512) return fail("Descrição excede 512 caracteres");
      const r = await pushDescriptionToWa(inst.base_url, inst.token, group_jid, description);
      if (!r.ok) return fail(`UazAPI ${r.status}`, { wa_response: r.body.slice(0, 300) });
      const { error } = await external
        .from("whatsapp_groups_index")
        .upsert(
          {
            group_jid,
            instance_name: inst.instance_name,
            description,
            description_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_seen: new Date().toISOString(),
          },
          { onConflict: "group_jid,instance_name" },
        );
      if (error) return fail(`save: ${error.message}`);
      return ok({ mode: "push", description });
    }

    return fail(`mode inválido: ${mode}`);
  } catch (e: any) {
    return fail(String(e?.message || e));
  }
});
