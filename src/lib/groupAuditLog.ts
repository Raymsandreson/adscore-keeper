import { supabase } from "@/integrations/supabase/client";

export type GroupAuditAction = "link" | "unlink";
export type GroupAuditResult = "success" | "error" | "duplicate_skipped";

export interface GroupAuditEntry {
  action: GroupAuditAction;
  group_jid?: string | null;
  group_name?: string | null;
  lead_id?: string | null;
  lead_name?: string | null;
  result: GroupAuditResult;
  error_message?: string | null;
  source?: string | null;
}

/**
 * Insere uma entrada na auditoria de vínculo/desvínculo de grupos WhatsApp.
 * Falhas são silenciosas (apenas console.warn) — auditoria nunca deve quebrar o fluxo principal.
 */
export async function logGroupAudit(entry: GroupAuditEntry): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? null;

    let userName: string | null = null;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", userId)
        .maybeSingle();
      userName = profile?.full_name ?? userData?.user?.email ?? null;
    }

    await supabase.from("lead_group_audit_log").insert({
      action: entry.action,
      group_jid: entry.group_jid ?? null,
      group_name: entry.group_name ?? null,
      lead_id: entry.lead_id ?? null,
      lead_name: entry.lead_name ?? null,
      user_id: userId,
      user_name: userName,
      result: entry.result,
      error_message: entry.error_message ?? null,
      source: entry.source ?? null,
    } as any);
  } catch (e) {
    console.warn("[groupAuditLog] failed to insert audit entry:", e);
  }
}
