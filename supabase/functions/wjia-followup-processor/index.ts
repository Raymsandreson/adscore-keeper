import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
const cloudAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const targetSessionId = body?.session_id || null;
    const targetPhone = body?.target_phone || null;
    const targetInstance = body?.target_instance || null;
    const forceImmediate = body?.force_immediate === true;
    const resetCycle = body?.reset_cycle === true;

    let actionsExecuted = 0;

    // ============================================================
    // PART 1: Document signing sessions + collecting sessions
    // ============================================================
    let sessionsQuery = supabase
      .from("wjia_collection_sessions")
      .select("*")
      .in("status", ["generated", "collecting"]);

    if (targetSessionId) {
      sessionsQuery = sessionsQuery.eq("id", targetSessionId);
    }

    const { data: sessions } = await sessionsQuery.order("updated_at", { ascending: true });

    if (sessions?.length) {
      for (const session of sessions) {
        const { data: shortcutData } = await supabase
          .from("wjia_command_shortcuts")
          .select("followup_steps, human_reply_pause_minutes, followup_repeat_forever")
          .eq("shortcut_name", session.shortcut_name)
          .maybeSingle();

        const steps = (shortcutData?.followup_steps || []) as any[];
        const repeatForever = shortcutData?.followup_repeat_forever ?? false;
        if (!steps.length) continue;

        const pauseMinutes = shortcutData?.human_reply_pause_minutes || 0;
        if (pauseMinutes > 0) {
          const pauseSince = new Date(Date.now() - pauseMinutes * 60 * 1000).toISOString();
          const { data: humanReply } = await supabase
            .from("whatsapp_messages")
            .select("id, created_at")
            .eq("phone", session.phone)
            .eq("instance_name", session.instance_name)
            .eq("direction", "outbound")
            .not("external_message_id", "like", "wjia_%")
            .gt("created_at", pauseSince)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (humanReply) {
            const replyTime = new Date(humanReply.created_at).getTime();
            const resumeAt = replyTime + pauseMinutes * 60 * 1000;
            const remainingMinutes = Math.max(1, Math.ceil((resumeAt - Date.now()) / 60000));
            await supabase.rpc("schedule_followup_for_session", {
              p_session_id: session.id,
              p_delay_minutes: remainingMinutes,
            }).catch(e => console.error("Schedule pause error:", e));
            continue;
          }
        }

        const { data: lastLog } = await supabase
          .from("wjia_followup_log")
          .select("*")
          .eq("session_id", session.id)
          .order("executed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextStepIndex = lastLog ? (lastLog.step_index + 1) : 0;

        if (!repeatForever && nextStepIndex >= steps.length) {
          await supabase.from("wjia_collection_sessions").update({ status: "followup_done" }).eq("id", session.id);
          continue;
        }

        const effectiveStepIndex = nextStepIndex % steps.length;
        const step = steps[effectiveStepIndex];
        const delayMinutes = step.delay_minutes || 60;
        // For call steps, enforce minimum 30 minutes delay
        const effectiveDelayMinutes = step.action_type === "call" ? Math.max(delayMinutes, 30) : delayMinutes;

        const referenceTime = lastLog?.executed_at || session.updated_at;
        const timeSince = Date.now() - new Date(referenceTime).getTime();
        const delayMs = effectiveDelayMinutes * 60 * 1000;

        if (timeSince < delayMs) continue;

        console.log(`[DOC] Executing step ${effectiveStepIndex} for session ${session.id}: ${step.action_type}`);
        let actionResult = "executed";

        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_token, base_url")
          .eq("instance_name", session.instance_name)
          .maybeSingle();

        if (step.action_type === "whatsapp_message") {
          if (inst?.instance_token) {
            const baseUrl = inst.base_url || "https://abraci.uazapi.com";
            const collectedData = session.collected_data || {};
            const signerName = collectedData.signer_name || "Cliente";
            const msg = `Olá ${signerName.split(" ")[0]}! 📝\n\nNotamos que o documento *${session.template_name}* ainda não foi assinado.\n\n👉 ${session.sign_url}\n\nPrecisa de ajuda? Estamos à disposição! 🙏`;

            await fetch(`${baseUrl}/send/text`, {
              method: "POST",
              headers: { "Content-Type": "application/json", token: inst.instance_token },
              body: JSON.stringify({ number: session.phone, text: msg }),
            }).catch(e => { console.error("Followup WhatsApp error:", e); actionResult = "error"; });

            await supabase.from("whatsapp_messages").insert({
              phone: session.phone, instance_name: session.instance_name,
              message_text: msg, message_type: "text", direction: "outbound",
              contact_id: session.contact_id || null, lead_id: session.lead_id || null,
              external_message_id: `wjia_followup_${Date.now()}`,
              action_source: 'system', action_source_detail: 'Follow-up automático',
            });
          }
        } else if (step.action_type === "call") {
          const { error: queueError } = await supabase.from("whatsapp_call_queue").insert({
            phone: session.phone, instance_name: session.instance_name,
            lead_id: session.lead_id || null, contact_name: session.collected_data?.signer_name || null,
            status: "pending", priority: 5, max_attempts: 2,
          });
          if (queueError) { console.error("Failed to enqueue call:", queueError); actionResult = "error"; }
        } else if (step.action_type === "create_activity") {
          let assignedTo = step.assigned_to || null;
          let assignedName = null;
          if (assignedTo === "__self__") {
            const { data: configUser } = await supabase.from("wjia_command_configs").select("user_id")
              .eq("instance_name", session.instance_name).eq("is_active", true).limit(1).maybeSingle();
            assignedTo = configUser?.user_id || null;
          }
          if (assignedTo) {
            const { data: profile } = await supabase.from("profiles").select("full_name").eq("user_id", assignedTo).maybeSingle();
            assignedName = profile?.full_name || null;
          }
          await supabase.from("lead_activities").insert({
            lead_id: session.lead_id || null,
            title: `Cobrar assinatura: ${session.template_name}`,
            description: `O cliente ainda não assinou o documento "${session.template_name}".\nLink: ${session.sign_url || "N/A"}\nTelefone: ${session.phone}`,
            activity_type: step.activity_type || "tarefa", status: "pendente", priority: step.priority || "alta",
            assigned_to: assignedTo, assigned_to_name: assignedName,
            deadline: new Date().toISOString().split("T")[0],
          });
        }

        await supabase.from("wjia_followup_log").insert({
          session_id: session.id, rule_id: null, step_index: nextStepIndex,
          action_type: step.action_type, action_result: actionResult, next_execution_at: null,
        });
        actionsExecuted++;
      }
    }

    // ============================================================
    // PART 2: Agent conversation follow-ups (NEW)
    // ============================================================
    if (!targetSessionId) {
      if (resetCycle && targetPhone && targetInstance) {
        // Reset: find conversation agent, get the synthetic session_id, delete logs
        const { data: ca } = await supabase
          .from("whatsapp_conversation_agents")
          .select("agent_id")
          .eq("phone", targetPhone)
          .eq("instance_name", targetInstance)
          .maybeSingle();

        if (ca?.agent_id) {
          const encoder = new TextEncoder();
          const rawStr = `${targetPhone}|${targetInstance}|${ca.agent_id}`;
          const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawStr));
          const hashArray = new Uint8Array(hashBuffer);
          const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
          const syntheticId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;

          await supabase.from("wjia_followup_log").delete().eq("session_id", syntheticId);
          console.log(`[RESET] Cleared followup logs for ${targetPhone} session ${syntheticId}`);
          actionsExecuted++;
        }

        return new Response(JSON.stringify({
          success: true, reset: true, actions_executed: actionsExecuted,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        const result = await processAgentConversationFollowups(supabase, targetPhone, targetInstance, forceImmediate);
        actionsExecuted += result;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      sessions_checked: sessions?.length || 0,
      actions_executed: actionsExecuted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Followup processor error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processAgentConversationFollowups(supabase: any, targetPhone?: string | null, targetInstance?: string | null, forceImmediate?: boolean): Promise<number> {
  let actionsExecuted = 0;

  // Check current hour in Brasilia timezone
  const nowBrasilia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const currentHour = nowBrasilia.getHours();

  // Get active conversation-agent assignments (optionally filtered)
  let convQuery = supabase
    .from("whatsapp_conversation_agents")
    .select("phone, instance_name, agent_id, human_paused_until")
    .eq("is_active", true);

  if (targetPhone) convQuery = convQuery.eq("phone", targetPhone);
  if (targetInstance) convQuery = convQuery.eq("instance_name", targetInstance);

  const { data: conversations, error: convError } = await convQuery;

  console.log(`[AGENT] Query: phone=${targetPhone}, instance=${targetInstance}, found=${conversations?.length || 0}, error=${convError?.message || 'none'}, forceImmediate=${forceImmediate}`);

  if (convError || !conversations?.length) {
    console.log(`[AGENT] No active conversations found`);
    return 0;
  }

  // Get unique agent IDs and load their configs
  const agentIds = [...new Set(conversations.map((c: any) => c.agent_id))];
  const { data: agentConfigs } = await supabase
    .from("wjia_command_shortcuts")
    .select("id, followup_steps, human_reply_pause_minutes, followup_repeat_forever, send_window_start_hour, send_window_end_hour, base_prompt, shortcut_name, max_repeat_cycles, min_call_delay_minutes, max_consecutive_call_failures, max_call_attempts")
    .in("id", agentIds);

  if (!agentConfigs?.length) return 0;

  const agentMap = new Map<string, any>();
  for (const a of agentConfigs) {
    if (a.followup_steps && Array.isArray(a.followup_steps) && a.followup_steps.length > 0) {
      agentMap.set(a.id, a);
    }
  }

  if (!agentMap.size) return 0;

  // Also get followup_prompt from whatsapp_ai_agents table
  const { data: agentPrompts } = await supabase
    .from("whatsapp_ai_agents")
    .select("id, followup_prompt, name")
    .in("id", agentIds);
  const promptMap = new Map<string, any>();
  for (const p of (agentPrompts || [])) {
    promptMap.set(p.id, p);
  }

  // Process up to 50 conversations per run to avoid timeouts
  let processed = 0;
  const maxPerRun = 50;

  for (const conv of conversations) {
    if (processed >= maxPerRun) break;

    const config = agentMap.get(conv.agent_id);
    if (!config) continue;

    // Check send window (skip if forced)
    if (!forceImmediate) {
      const windowStart = config.send_window_start_hour ?? 8;
      const windowEnd = config.send_window_end_hour ?? 20;
      if (currentHour < windowStart || currentHour >= windowEnd) continue;
    }

    // Check human_paused_until
    if (conv.human_paused_until && new Date(conv.human_paused_until) > new Date()) continue;

    // Generate a deterministic session ID for tracking
    const trackingId = generateTrackingId(conv.phone, conv.instance_name, conv.agent_id);

    // Check if client responded after our last outbound message
    const { data: lastInbound } = await supabase
      .from("whatsapp_messages")
      .select("created_at")
      .eq("phone", conv.phone)
      .eq("instance_name", conv.instance_name)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastOutbound } = await supabase
      .from("whatsapp_messages")
      .select("created_at")
      .eq("phone", conv.phone)
      .eq("instance_name", conv.instance_name)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only follow up if our last message is newer than client's last message
    // When force_immediate: if client sent a message and we never replied (or client replied after us),
    // trigger the AI to respond immediately instead of skipping
    if (forceImmediate) {
      // If there's no outbound at all, or client's message is newer, directly trigger AI reply
      const clientNeedsReply = !lastOutbound || (lastInbound && new Date(lastInbound.created_at) > new Date(lastOutbound.created_at));
      if (clientNeedsReply) {
        processed++;
        console.log(`[AGENT] Force-immediate: triggering AI reply for unanswered ${conv.phone} on ${conv.instance_name}`);
        try {
          const aiResult = await callAgentReply(supabase, conv.phone, conv.instance_name);
          if (aiResult.success) {
            console.log(`[AGENT] Force AI reply sent for ${conv.phone}`);
            actionsExecuted++;
          } else {
            console.error(`[AGENT] Force AI reply failed for ${conv.phone}`);
          }
        } catch (e) {
          console.error(`[AGENT] Force AI reply error for ${conv.phone}:`, e);
        }
        continue;
      }
    } else {
      if (!lastOutbound) continue;
      if (lastInbound && new Date(lastInbound.created_at) > new Date(lastOutbound.created_at)) {
        continue;
      }
    }

    // Block detection: check if last N outbound messages are all stuck at "sent" (never delivered)
    // This indicates the contact likely blocked us
    const { data: recentOutbound } = await supabase
      .from("whatsapp_messages")
      .select("status, created_at")
      .eq("phone", conv.phone)
      .eq("instance_name", conv.instance_name)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentOutbound && recentOutbound.length >= 3) {
      const allSentOnly = recentOutbound.every((m: any) => m.status === "sent");
      // Only flag as blocked if the oldest of these messages is at least 1 hour old
      const oldestMsg = recentOutbound[recentOutbound.length - 1];
      const oldestAge = Date.now() - new Date(oldestMsg.created_at).getTime();
      if (allSentOnly && oldestAge > 60 * 60 * 1000) {
        console.log(`[AGENT] Possible block detected for ${conv.phone} on ${conv.instance_name}: ${recentOutbound.length} messages stuck at 'sent'. Stopping followup.`);
        // Deactivate the agent for this conversation
        await supabase
          .from("whatsapp_conversation_agents")
          .update({ is_active: false, is_blocked: true })
          .eq("phone", conv.phone)
          .eq("instance_name", conv.instance_name);
        actionsExecuted++;
        continue;
      }
    }

    // Check human_reply_pause_minutes - pause if a human (non-agent) recently replied
    const pauseMinutes = config.human_reply_pause_minutes || 0;
    if (pauseMinutes > 0) {
      const pauseSince = new Date(Date.now() - pauseMinutes * 60 * 1000).toISOString();
      const { data: humanMsg } = await supabase
        .from("whatsapp_messages")
        .select("id")
        .eq("phone", conv.phone)
        .eq("instance_name", conv.instance_name)
        .eq("direction", "outbound")
        .or("action_source.eq.manual,action_source.is.null")
        .gt("created_at", pauseSince)
        .limit(1)
        .maybeSingle();

      if (humanMsg) continue;
    }

    // Get last executed step for this conversation
    const { data: lastLog } = await supabase
      .from("wjia_followup_log")
      .select("*")
      .eq("session_id", trackingId)
      .order("executed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const steps = config.followup_steps;
    const repeatForever = config.followup_repeat_forever ?? false;
    const nextStepIndex = lastLog ? (lastLog.step_index + 1) : 0;

    // Cap repeat_forever to max cycles (configurable per agent, default 3)
    // max_repeat_cycles = 0 means truly infinite (until client responds or blocks)
    const maxRepeatCycles = config.max_repeat_cycles ?? 3;
    const isInfinite = repeatForever && maxRepeatCycles === 0;
    const maxSteps = isInfinite ? Infinity : (repeatForever ? steps.length * maxRepeatCycles : steps.length);
    if (nextStepIndex >= maxSteps) {
      console.log(`[AGENT] Max follow-up cycles reached for ${conv.phone} (${nextStepIndex}/${maxSteps}), stopping`);
      continue;
    }

    const effectiveStepIndex = nextStepIndex % steps.length;
    const step = steps[effectiveStepIndex];
    const delayMinutes = step.delay_minutes || 60;

    // For call steps, enforce configurable minimum delay (default 30 minutes)
    const minCallDelay = config.min_call_delay_minutes ?? 30;
    const effectiveDelayMinutes = step.action_type === "call" ? Math.max(delayMinutes, minCallDelay) : delayMinutes;

    // Reference time: last log execution OR last outbound message
    const referenceTime = lastLog?.executed_at || lastOutbound.created_at;
    const timeSince = Date.now() - new Date(referenceTime).getTime();
    const delayMs = effectiveDelayMinutes * 60 * 1000;

    if (!forceImmediate && timeSince < delayMs) continue;

    // For call steps, check if previous calls to this phone all failed (busy/not answered)
    // If 3+ consecutive failed calls, skip the call step
    if (step.action_type === "call") {
      const maxCallFailures = config.max_consecutive_call_failures ?? 3;
      const { data: recentCalls } = await supabase
        .from("call_records")
        .select("call_result")
        .or(`contact_phone.ilike.%${conv.phone.slice(-8)}%`)
        .order("created_at", { ascending: false })
        .limit(maxCallFailures);

      const allFailed = recentCalls?.length >= maxCallFailures && recentCalls.every(
        (c: any) => c.call_result === 'ocupado' || c.call_result === 'não_atendeu' || c.call_result === 'nao_atendeu'
      );
      if (allFailed) {
        console.log(`[AGENT] Skipping call for ${conv.phone}: ${recentCalls.length} consecutive failed calls`);
        // Log it as skipped and move to next step
        await supabase.from("wjia_followup_log").insert({
          session_id: trackingId, rule_id: null, step_index: nextStepIndex,
          action_type: step.action_type, action_result: "skipped_consecutive_failures",
          next_execution_at: null,
        });
        actionsExecuted++;
        continue;
      }
    }

    processed++;
    console.log(`[AGENT] Executing step ${effectiveStepIndex} (${step.action_type}) for ${conv.phone} (agent: ${config.shortcut_name})`);

    let actionResult = "executed";

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("instance_name", conv.instance_name)
      .maybeSingle();

    if (step.action_type === "whatsapp_message") {
      // Use AI to generate contextual follow-up message
      try {
        const aiResult = await callAgentReply(supabase, conv.phone, conv.instance_name);
        if (aiResult.success) {
          console.log(`[AGENT] AI followup sent for ${conv.phone}`);
        } else {
          actionResult = "error";
        }
      } catch (e) {
        console.error(`[AGENT] AI followup error for ${conv.phone}:`, e);
        actionResult = "error";
      }
    } else if (step.action_type === "call") {
      // Find lead_id and contact_name
      const { data: msgWithLead } = await supabase
        .from("whatsapp_messages")
        .select("lead_id, contact_name")
        .eq("phone", conv.phone)
        .eq("instance_name", conv.instance_name)
        .not("lead_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const maxCallAttempts = config.max_call_attempts ?? 2;
      const { error: queueError } = await supabase.from("whatsapp_call_queue").insert({
        phone: conv.phone,
        instance_name: conv.instance_name,
        lead_id: msgWithLead?.lead_id || null,
        contact_name: msgWithLead?.contact_name || null,
        status: "pending",
        priority: 5,
        max_attempts: maxCallAttempts,
      });
      if (queueError) {
        console.error(`[AGENT] Call queue error for ${conv.phone}:`, queueError);
        actionResult = "error";
      } else {
        console.log(`[AGENT] Call enqueued for ${conv.phone}`);
      }
    } else if (step.action_type === "create_activity") {
      let assignedTo = step.assigned_to || null;
      let assignedName = null;
      if (assignedTo === "__self__") {
        const { data: configUser } = await supabase.from("wjia_command_configs").select("user_id")
          .eq("instance_name", conv.instance_name).eq("is_active", true).limit(1).maybeSingle();
        assignedTo = configUser?.user_id || null;
      }
      if (assignedTo) {
        const { data: profile } = await supabase.from("profiles").select("full_name").eq("user_id", assignedTo).maybeSingle();
        assignedName = profile?.full_name || null;
      }

      const { data: msgWithLead } = await supabase
        .from("whatsapp_messages")
        .select("lead_id")
        .eq("phone", conv.phone).eq("instance_name", conv.instance_name)
        .not("lead_id", "is", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      await supabase.from("lead_activities").insert({
        lead_id: msgWithLead?.lead_id || null,
        title: `Follow-up pendente: ${conv.phone}`,
        description: `O cliente ${conv.phone} não respondeu após as tentativas automáticas de follow-up via agente ${config.shortcut_name}.`,
        activity_type: step.activity_type || "tarefa",
        status: "pendente",
        priority: step.priority || "alta",
        assigned_to: assignedTo,
        assigned_to_name: assignedName,
        deadline: new Date().toISOString().split("T")[0],
      });
    }

    // Log the execution
    const { error: logError } = await supabase.from("wjia_followup_log").insert({
      session_id: trackingId,
      rule_id: null,
      step_index: nextStepIndex,
      action_type: step.action_type,
      action_result: actionResult,
      next_execution_at: null,
    });
    if (logError) {
      console.error(`[AGENT] Failed to save followup log for ${conv.phone}:`, JSON.stringify(logError));
    }

    actionsExecuted++;
  }

  console.log(`[AGENT] Processed ${processed} conversations, executed ${actionsExecuted} actions`);
  return actionsExecuted;
}

// Call the existing AI agent reply endpoint for follow-up messages
async function callAgentReply(supabase: any, phone: string, instanceName: string): Promise<{ success: boolean; reply?: string }> {
  const resp = await fetch(`${cloudFunctionsUrl}/functions/v1/whatsapp-ai-agent-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cloudAnonKey}`,
    },
    body: JSON.stringify({
      phone,
      instance_name: instanceName,
      message_text: "",
      is_followup: true,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[AGENT] Reply error for ${phone}: ${resp.status} - ${errText}`);
    return { success: false };
  }

  try {
    const data = await resp.json();
    if (data?.success === true) {
      return { success: true, reply: data.reply || '' };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

// Generate a deterministic UUID v5-like tracking ID for conversation follow-ups
function generateTrackingId(phone: string, instanceName: string, agentId: string): string {
  const input = `agent_followup:${phone}:${instanceName}:${agentId}`;
  // Simple hash to create a valid UUID format
  const bytes = new Uint8Array(16);
  for (let i = 0; i < input.length; i++) {
    bytes[i % 16] = (bytes[i % 16] + input.charCodeAt(i)) & 0xff;
  }
  // Set version 5 and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
