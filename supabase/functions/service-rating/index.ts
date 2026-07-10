import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Avaliação de atendimento (0–5 estrelas + motivo).
// Público (verify_jwt=false): 'get' e 'submit' são chamados pelo cliente sem login,
// só com o token. 'create' gera um pedido de avaliação (chamado pela equipe).
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const action = body?.action;

    // ── CREATE: equipe gera um pedido de avaliação e recebe o token/link ──
    if (action === "create") {
      const { lead_id, lead_name, case_id, process_id, activity_id, assessor_id, assessor_name, created_by } = body;
      if (!lead_id && !case_id && !process_id) {
        return json({ success: false, error: "Informe ao menos lead_id, case_id ou process_id." });
      }
      // Resolve o nome do assessor pelo id quando não veio pronto (assessor = quem envia).
      let resolvedAssessorName = assessor_name || null;
      if (!resolvedAssessorName && assessor_id) {
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("user_id", assessor_id).maybeSingle();
        resolvedAssessorName = prof?.full_name || null;
      }
      const token = randomToken();
      const { error } = await supabase.from("service_ratings").insert({
        token, lead_id: lead_id || null, lead_name: lead_name || null,
        case_id: case_id || null, process_id: process_id || null, activity_id: activity_id || null,
        assessor_id: assessor_id || null, assessor_name: resolvedAssessorName,
        created_by: created_by || null, status: "pending",
      });
      if (error) return json({ success: false, error: error.message });
      return json({ success: true, token });
    }

    // ── GET: cliente abre o link; devolve só o necessário pra montar a tela ──
    if (action === "get") {
      const { token } = body;
      if (!token) return json({ success: false, error: "Token ausente." });
      const { data, error } = await supabase
        .from("service_ratings")
        .select("assessor_name, lead_name, status, rating")
        .eq("token", token)
        .maybeSingle();
      if (error || !data) return json({ success: false, error: "Link de avaliação inválido ou expirado." });
      return json({
        success: true,
        already: data.status === "submitted",
        assessor_name: data.assessor_name,
        lead_name: data.lead_name,
        rating: data.rating,
      });
    }

    // ── SUBMIT: cliente envia nota (0–5) + motivo ──
    if (action === "submit") {
      const { token, rating, reason } = body;
      if (!token) return json({ success: false, error: "Token ausente." });
      const nota = Number(rating);
      if (!Number.isInteger(nota) || nota < 0 || nota > 5) {
        return json({ success: false, error: "Nota inválida (use de 0 a 5)." });
      }
      const { data: existing } = await supabase
        .from("service_ratings").select("status").eq("token", token).maybeSingle();
      if (!existing) return json({ success: false, error: "Link de avaliação inválido." });
      if (existing.status === "submitted") return json({ success: true, already: true });

      const { error } = await supabase
        .from("service_ratings")
        .update({ rating: nota, reason: (reason || "").toString().slice(0, 2000), status: "submitted", submitted_at: new Date().toISOString() })
        .eq("token", token)
        .eq("status", "pending");
      if (error) return json({ success: false, error: error.message });
      return json({ success: true });
    }

    return json({ success: false, error: "Ação inválida." }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[service-rating] error:", msg);
    return json({ success: false, error: msg }, 500);
  }
});
