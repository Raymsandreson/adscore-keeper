import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CleanupResult = { action: string; count?: number | null; error?: string };

function isMissingTableError(error: unknown) {
  const message = String((error as { message?: string } | null)?.message || error || "");
  return message.includes("Could not find the table") || message.includes("schema cache") || message.includes("relation") && message.includes("does not exist");
}

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cleanup: CleanupResult[] = [];

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "Sessão obrigatória para excluir lead" });

    const cloud = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const ext = createClient(Deno.env.get("EXTERNAL_SUPABASE_URL")!, Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await cloud.auth.getUser(token);
    if (userError || !userData.user) return json({ success: false, error: "Sessão inválida ou expirada" });

    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.leadId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId)) {
      return json({ success: false, error: "leadId inválido" });
    }

    const { data: snapshot, error: snapshotError } = await ext.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (snapshotError) return json({ success: false, error: snapshotError.message });
    if (!snapshot) return json({ success: false, error: "Lead não encontrado no banco externo" });

    const idsFrom = async (table: string, column = "lead_id") => {
      const { data, error } = await ext.from(table).select("id").eq(column, leadId);
      if (error) {
        if (isMissingTableError(error)) {
          cleanup.push({ action: `skip missing ${table}`, error: error.message });
          return [] as string[];
        }
        cleanup.push({ action: `select ${table}`, error: error.message });
        return [] as string[];
      }
      return (data || []).map((r: any) => String(r.id)).filter(Boolean);
    };
    const runDelete = async (table: string, column = "lead_id") => {
      const { count, error } = await ext.from(table).delete({ count: "exact" }).eq(column, leadId);
      if (error && isMissingTableError(error)) {
        cleanup.push({ action: `skip missing ${table}.${column}`, count, error: error.message });
        return;
      }
      cleanup.push({ action: `delete ${table}.${column}`, count, error: error?.message });
      if (error) throw error;
    };
    const runUpdateNull = async (table: string, values: Record<string, null>, column = "lead_id") => {
      const { count, error } = await ext.from(table).update(values, { count: "exact" }).eq(column, leadId);
      if (error && isMissingTableError(error)) {
        cleanup.push({ action: `skip missing ${table}.${column}`, count, error: error.message });
        return;
      }
      cleanup.push({ action: `unlink ${table}.${column}`, count, error: error?.message });
      if (error) throw error;
    };
    const deleteIn = async (table: string, column: string, ids: string[]) => {
      if (ids.length === 0) return;
      const { count, error } = await ext.from(table).delete({ count: "exact" }).in(column, ids);
      if (error && isMissingTableError(error)) {
        cleanup.push({ action: `skip missing ${table}.${column}`, count, error: error.message });
        return;
      }
      cleanup.push({ action: `delete ${table}.${column}`, count, error: error?.message });
      if (error) throw error;
    };
    const updateNullIn = async (table: string, values: Record<string, null>, column: string, ids: string[]) => {
      if (ids.length === 0) return;
      const { count, error } = await ext.from(table).update(values, { count: "exact" }).in(column, ids);
      if (error && isMissingTableError(error)) {
        cleanup.push({ action: `skip missing ${table}.${column}`, count, error: error.message });
        return;
      }
      cleanup.push({ action: `unlink ${table}.${column}`, count, error: error?.message });
      if (error) throw error;
    };

    const activityIds = await idsFrom("lead_activities");
    const processIds = await idsFrom("lead_processes");

    await deleteIn("activity_attachments", "activity_id", activityIds);
    await updateNullIn("activity_chat_messages", { activity_id: null, lead_id: null }, "activity_id", activityIds);
    await updateNullIn("call_records", { activity_id: null, lead_id: null }, "activity_id", activityIds);

    await deleteIn("process_movement_notifications", "process_id", processIds);
    await deleteIn("process_movement_monitors", "process_id", processIds);
    await deleteIn("process_parties", "process_id", processIds);
    await updateNullIn("process_documents", { process_id: null, lead_id: null }, "process_id", processIds);

    for (const table of ["contact_leads", "lead_checklist_instances", "lead_custom_field_values", "lead_followups", "lead_stage_history", "lead_status_history", "lead_whatsapp_groups"]) {
      await runDelete(table);
    }

    for (const table of ["ad_briefings", "ambassador_referrals", "call_records", "card_assignments", "contacts", "external_posts", "lead_enrichment_log", "lead_financials", "legal_cases", "process_documents", "promoted_posts", "transaction_category_overrides", "whatsapp_messages", "whatsapp_call_queue", "wjia_collection_sessions", "zapsign_documents", "activity_chat_messages", "case_process_tracking", "cat_leads", "group_creation_queue", "onboarding_meeting_bookings"]) {
      await runUpdateNull(table, { lead_id: null });
    }

    await runDelete("lead_activities");
    await runDelete("lead_processes");

    const { count: deletedCount, error: deleteLeadError } = await ext.from("leads").delete({ count: "exact" }).eq("id", leadId);
    cleanup.push({ action: "delete leads.id", count: deletedCount, error: deleteLeadError?.message });
    if (deleteLeadError) throw deleteLeadError;
    if (!deletedCount) return json({ success: false, error: "Nenhuma linha de lead foi excluída", cleanup });

    return json({ success: true, leadId, snapshot, cleanup });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e), cleanup });
  }
});