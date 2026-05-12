// Admin op for whatsapp_instances on the External Supabase, using service role.
// Front fala com o Externo via sessão anônima e a RLS exige is_admin -> updates/deletes
// silenciosamente afetam 0 linhas. Esta função roda DELETE/UPDATE com service role,
// validando que quem chama é admin no Lovable Cloud.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const EXTERNAL_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const EXTERNAL_SR = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Validar usuário Lovable Cloud + role admin
    const authHeader = req.headers.get("Authorization") || "";
    const cloud = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await cloud.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: "unauthenticated" });
    }
    // Source of truth for roles is the External DB.
    const extAuth = createClient(EXTERNAL_URL, EXTERNAL_SR);
    const { data: roleRow, error: roleErr } = await extAuth
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr || !roleRow) {
      return json({ success: false, error: "forbidden" });
    }

    // 2) Aplicar operação no Externo com service role
    const body = await req.json().catch(() => ({}));
    const { action, instance_id, is_active, payload } = body as {
      action?: "delete" | "set_active" | "create" | "update";
      instance_id?: string;
      is_active?: boolean;
      payload?: Record<string, any>;
    };
    if (!action) {
      return json({ success: false, error: "missing action" });
    }
    if ((action === "delete" || action === "set_active" || action === "update") && !instance_id) {
      return json({ success: false, error: "missing instance_id" });
    }

    const ext = createClient(EXTERNAL_URL, EXTERNAL_SR);
    // Cloud mirror: a Inbox e várias FKs (whatsapp_instance_users, profiles.default_instance_id, etc.)
    // vivem no Cloud. Toda escrita em whatsapp_instances precisa espelhar lá pra não sumir do app.
    const SUPABASE_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cloudAdmin = createClient(SUPABASE_URL, SUPABASE_SR);

    if (action === "delete") {
      const { error, count } = await ext
        .from("whatsapp_instances")
        .delete({ count: "exact" })
        .eq("id", instance_id);
      if (error) return json({ success: false, error: error.message });
      const { error: cErr } = await cloudAdmin.from("whatsapp_instances").delete().eq("id", instance_id);
      if (cErr) console.warn("[admin-whatsapp-instance] cloud delete mirror failed:", cErr.message);
      return json({ success: true, affected: count ?? 0 });
    }

    if (action === "set_active") {
      if (typeof is_active !== "boolean") {
        return json({ success: false, error: "is_active must be boolean" });
      }
      const { error, count } = await ext
        .from("whatsapp_instances")
        .update({ is_active }, { count: "exact" })
        .eq("id", instance_id);
      if (error) return json({ success: false, error: error.message });
      const { error: cErr } = await cloudAdmin.from("whatsapp_instances").update({ is_active }).eq("id", instance_id);
      if (cErr) console.warn("[admin-whatsapp-instance] cloud set_active mirror failed:", cErr.message);
      return json({ success: true, affected: count ?? 0 });
    }

    if (action === "create") {
      if (!payload || !payload.instance_name || !payload.instance_token) {
        return json({ success: false, error: "instance_name e instance_token são obrigatórios" });
      }
      const row = {
        instance_name: String(payload.instance_name).trim(),
        instance_token: String(payload.instance_token).trim(),
        base_url: payload.base_url ? String(payload.base_url).trim() : null,
        owner_phone: payload.owner_phone ? String(payload.owner_phone).trim() : null,
        owner_name: payload.owner_name ? String(payload.owner_name).trim() : null,
        is_active: true,
      };
      const { data, error } = await ext
        .from("whatsapp_instances")
        .insert(row as any)
        .select()
        .single();
      if (error) return json({ success: false, error: error.message });

      // Mirror no Cloud com o MESMO id pra manter FKs consistentes.
      const mirrorRow = { ...row, id: (data as any)?.id };
      const { error: cErr } = await cloudAdmin
        .from("whatsapp_instances")
        .upsert(mirrorRow as any, { onConflict: "id" });
      if (cErr) {
        console.warn("[admin-whatsapp-instance] cloud create mirror failed:", cErr.message);
        return json({ success: true, instance: data, cloud_mirror_warning: cErr.message });
      }
      return json({ success: true, instance: data });
    }

    if (action === "update") {
      if (!payload) return json({ success: false, error: "missing payload" });
      const allowed: Record<string, any> = {};
      for (const k of ["instance_name", "instance_token", "base_url", "owner_phone", "owner_name"]) {
        if (k in payload) allowed[k] = payload[k] === "" ? null : payload[k];
      }
      const { error, count } = await ext
        .from("whatsapp_instances")
        .update(allowed, { count: "exact" })
        .eq("id", instance_id);
      if (error) return json({ success: false, error: error.message });
      const { error: cErr } = await cloudAdmin.from("whatsapp_instances").update(allowed).eq("id", instance_id);
      if (cErr) console.warn("[admin-whatsapp-instance] cloud update mirror failed:", cErr.message);
      return json({ success: true, affected: count ?? 0 });
    }

    return json({ success: false, error: "unknown action" });
  } catch (e: any) {
    return json({ success: false, error: e?.message || String(e) });
  }
});
