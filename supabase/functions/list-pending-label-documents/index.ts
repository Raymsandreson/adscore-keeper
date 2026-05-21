// Lista procurações pendentes (label-triggered) por telefone.
// Usado pela extensão Chrome pra mostrar selo "Procuração pronta pra revisão".
//
// - Valida JWT do usuário (Cloud)
// - Busca instâncias permitidas (admin = todas; member = whatsapp_instance_users)
// - Lê pending_label_documents do Externo filtrando por phone + essas instâncias
//
// Body: { phone: string, instance_name?: string }
// Retorno HTTP 200: { success, pending: [...], error? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ok = (data: any) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const auth = req.headers.get("Authorization") || "";
    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const srKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cloudUser = createClient(cloudUrl, anonKey, { global: { headers: { Authorization: auth } } });

    const { data: userData } = await cloudUser.auth.getUser();
    if (!userData?.user) return ok({ success: false, error: "unauthorized" });

    const body = await req.json().catch(() => ({}));
    const { phone, instance_name } = body as { phone?: string; instance_name?: string };
    if (!phone) return ok({ success: false, error: "phone obrigatório" });

    const cloudAdmin = createClient(cloudUrl, srKey);

    // Admin = todas instâncias; member = apenas as vinculadas
    const { data: roleRow } = await cloudAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .in("role", ["admin"])
      .maybeSingle();
    const isAdmin = !!roleRow;

    let allowedInstanceNames: string[] | null = null;
    if (!isAdmin) {
      const { data: links } = await cloudAdmin
        .from("whatsapp_instance_users")
        .select("instance_id")
        .eq("user_id", userData.user.id);
      const ids = (links || []).map((l: any) => l.instance_id);
      if (ids.length === 0) return ok({ success: true, pending: [] });
      const { data: insts } = await cloudAdmin
        .from("whatsapp_instances")
        .select("instance_name")
        .in("id", ids);
      allowedInstanceNames = (insts || []).map((i: any) => String(i.instance_name).toLowerCase());
      if (allowedInstanceNames.length === 0) return ok({ success: true, pending: [] });
    }

    // Lê do Externo
    const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
    const ext = createClient(extUrl, extKey);

    const phoneDigits = String(phone).replace(/\D/g, "");
    let q = ext
      .from("pending_label_documents")
      .select("*")
      .eq("phone", phoneDigits)
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (instance_name) q = q.ilike("instance_name", instance_name);

    const { data: pending, error } = await q;
    if (error) return ok({ success: false, error: error.message });

    // Filtra por instâncias permitidas se não-admin
    let filtered = pending || [];
    if (allowedInstanceNames) {
      filtered = filtered.filter((p: any) =>
        allowedInstanceNames!.includes(String(p.instance_name).toLowerCase())
      );
    }

    return ok({ success: true, pending: filtered });
  } catch (e: any) {
    console.error("[list-pending-label-documents] error:", e);
    return ok({ success: false, error: e?.message || "unknown" });
  }
});
