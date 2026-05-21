// Lista procurações pendentes (label-triggered) pra um chat WhatsApp.
// Usado pela extensão Chrome pra mostrar selo "Procuração pronta pra revisão".
//
// - Valida JWT do usuário (Cloud)
// - Confere se o user tem acesso à instância (whatsapp_instance_users no Cloud)
// - Lê pending_label_documents do Externo filtrando por phone+instance
//
// Body: { phone: string, instance_name: string }
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

  try {
    const auth = req.headers.get("Authorization") || "";
    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const cloudUser = createClient(cloudUrl, anonKey, { global: { headers: { Authorization: auth } } });

    const { data: userData } = await cloudUser.auth.getUser();
    if (!userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "unauthorized" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { phone, instance_name } = body as { phone?: string; instance_name?: string };
    if (!phone || !instance_name) {
      return new Response(
        JSON.stringify({ success: false, error: "phone e instance_name obrigatórios" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Permissão: confere se user tem acesso à instância no Cloud
    const cloudAdmin = createClient(cloudUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: inst } = await cloudAdmin
      .from("whatsapp_instances")
      .select("id, instance_name")
      .ilike("instance_name", instance_name)
      .maybeSingle();

    if (inst) {
      const { data: perm } = await cloudAdmin
        .from("whatsapp_instance_users")
        .select("user_id")
        .eq("instance_id", inst.id)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      // Admins podem tudo; se não admin nem tem perm, bloqueia
      const { data: roleRow } = await cloudAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .in("role", ["admin"])
        .maybeSingle();
      if (!perm && !roleRow) {
        return new Response(
          JSON.stringify({ success: false, error: "sem acesso à instância" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Lê do Externo
    const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
    const ext = createClient(extUrl, extKey);

    const phoneDigits = String(phone).replace(/\D/g, "");
    const { data: pending, error } = await ext
      .from("pending_label_documents")
      .select("*")
      .eq("phone", phoneDigits)
      .ilike("instance_name", instance_name)
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, pending: pending || [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[list-pending-label-documents] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e?.message || "unknown" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
