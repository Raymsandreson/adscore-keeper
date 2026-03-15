import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if processing a specific session (event-driven mode)
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const targetSessionId = body?.session_id || null;

    // Get active rules
    const { data: rules } = await supabase
      .from("wjia_followup_rules")
      .select("*")
      .eq("is_active", true)
      .order("display_order");

    if (!rules?.length) {
      return new Response(JSON.stringify({ message: "No active followup rules" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get target session(s)
    let sessionsQuery = supabase
      .from("wjia_collection_sessions")
      .select("*")
      .eq("status", "generated");

    if (targetSessionId) {
      sessionsQuery = sessionsQuery.eq("id", targetSessionId);
    }

    const { data: sessions } = await sessionsQuery.order("updated_at", { ascending: true });

    if (!sessions?.length) {
      return new Response(JSON.stringify({ message: "No pending sessions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let actionsExecuted = 0;

    for (const session of sessions) {
      // Check human_reply_pause_minutes: if a human replied recently, pause followup
      const { data: shortcutData } = await supabase
        .from("wjia_command_shortcuts")
        .select("human_reply_pause_minutes")
        .eq("shortcut_name", session.shortcut_name)
        .maybeSingle();

      const pauseMinutes = shortcutData?.human_reply_pause_minutes || 0;
      if (pauseMinutes > 0) {
        // Check if there's a human outbound message within the pause window
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
          // Reschedule for when the pause expires
          const replyTime = new Date(humanReply.created_at).getTime();
          const resumeAt = replyTime + pauseMinutes * 60 * 1000;
          const remainingMinutes = Math.max(1, Math.ceil((resumeAt - Date.now()) / 60000));
          console.log(`Pausing followup for session ${session.id}: human replied, resuming in ${remainingMinutes}min`);
          await supabase.rpc("schedule_followup_for_session", {
            p_session_id: session.id,
            p_delay_minutes: remainingMinutes,
          }).catch(e => console.error("Schedule pause error:", e));
          continue;
        }
      }

      const rule = rules.find((r: any) => r.trigger_status === "generated") || rules[0];
      if (!rule) continue;

      const steps = (rule.steps || []) as any[];
      if (!steps.length) continue;

      // Get last executed step for this session
      const { data: lastLog } = await supabase
        .from("wjia_followup_log")
        .select("*")
        .eq("session_id", session.id)
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextStepIndex = lastLog ? (lastLog.step_index + 1) : 0;
      
      // For infinite followup: wrap around to beginning when all steps done
      const effectiveStepIndex = nextStepIndex % steps.length;
      const step = steps[effectiveStepIndex];
      const delayMinutes = step.delay_minutes || 60;

      // Check if enough time has passed
      const referenceTime = lastLog?.executed_at || session.updated_at;
      const timeSince = Date.now() - new Date(referenceTime).getTime();
      const delayMs = delayMinutes * 60 * 1000;

      if (timeSince < delayMs) {
        // Not time yet — schedule for later (remaining time)
        const remainingMinutes = Math.max(1, Math.ceil((delayMs - timeSince) / 60000));
        await supabase.rpc("schedule_followup_for_session", {
          p_session_id: session.id,
          p_delay_minutes: remainingMinutes,
        }).catch(e => console.error("Schedule error:", e));
        continue;
      }

      console.log(`Executing followup step ${effectiveStepIndex} for session ${session.id}: ${step.action_type}`);

      let actionResult = "executed";

      // Get instance details
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
          
          // Generate contextual follow-up message using the shortcut's prompt
          const msg = `Olá ${signerName.split(" ")[0]}! 📝\n\nNotamos que o documento *${session.template_name}* ainda não foi assinado.\n\n👉 ${session.sign_url}\n\nPrecisa de ajuda? Estamos à disposição! 🙏`;

          await fetch(`${baseUrl}/send/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: session.phone, text: msg }),
          }).catch(e => {
            console.error("Followup WhatsApp error:", e);
            actionResult = "error";
          });

          await supabase.from("whatsapp_messages").insert({
            phone: session.phone,
            instance_name: session.instance_name,
            message_text: msg,
            message_type: "text",
            direction: "outbound",
            contact_id: session.contact_id || null,
            lead_id: session.lead_id || null,
            external_message_id: `wjia_followup_${Date.now()}`,
          });
        }
      } else if (step.action_type === "call") {
        if (inst?.instance_token) {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          await fetch(`${baseUrl}/call/make`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ number: session.phone }),
          }).catch(e => {
            console.error("Followup call error:", e);
            actionResult = "error";
          });
        }
      } else if (step.action_type === "create_activity") {
        let assignedTo = step.assigned_to || null;
        let assignedName = null;
        
        // __self__ means assign to the authorized user of this instance
        if (assignedTo === "__self__") {
          const { data: configUser } = await supabase
            .from("wjia_command_configs")
            .select("user_id")
            .eq("instance_name", session.instance_name)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();
          assignedTo = configUser?.user_id || null;
        }
        
        if (assignedTo) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", assignedTo)
            .maybeSingle();
          assignedName = profile?.full_name || null;
        }

        await supabase.from("lead_activities").insert({
          lead_id: session.lead_id || null,
          title: `Cobrar assinatura: ${session.template_name}`,
          description: `O cliente ainda não assinou o documento "${session.template_name}".\nLink: ${session.sign_url || "N/A"}\nTelefone: ${session.phone}`,
          activity_type: step.activity_type || "tarefa",
          status: "pendente",
          priority: step.priority || "alta",
          assigned_to: assignedTo,
          assigned_to_name: assignedName,
          deadline: new Date().toISOString().split("T")[0],
        });
      }

      // Log the execution
      await supabase.from("wjia_followup_log").insert({
        session_id: session.id,
        rule_id: rule.id,
        step_index: nextStepIndex, // keep absolute index for tracking
        action_type: step.action_type,
        action_result: actionResult,
        next_execution_at: null, // will be set by the scheduled job
      });

      actionsExecuted++;

      // Schedule the NEXT step via DB trigger (event-driven, no polling)
      const nextNextIndex = (nextStepIndex + 1) % steps.length;
      const nextStep = steps[nextNextIndex];
      const nextDelay = nextStep?.delay_minutes || 60;

      await supabase.rpc("schedule_followup_for_session", {
        p_session_id: session.id,
        p_delay_minutes: nextDelay,
      }).catch(e => console.error("Schedule next error:", e));
    }

    return new Response(JSON.stringify({
      success: true,
      sessions_checked: sessions.length,
      actions_executed: actionsExecuted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Followup processor error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
