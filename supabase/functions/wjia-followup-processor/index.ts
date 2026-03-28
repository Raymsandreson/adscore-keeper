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

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const targetSessionId = body?.session_id || null;

    // Get target session(s) with status 'generated'
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
      // Load followup_steps from the shortcut linked to this session
      const { data: shortcutData } = await supabase
        .from("wjia_command_shortcuts")
        .select("followup_steps, human_reply_pause_minutes, followup_repeat_forever")
        .eq("shortcut_name", session.shortcut_name)
        .maybeSingle();

      const steps = (shortcutData?.followup_steps || []) as any[];
      const repeatForever = shortcutData?.followup_repeat_forever ?? false;
      if (!steps.length) {
        console.log(`No followup steps for session ${session.id} (shortcut: ${session.shortcut_name})`);
        continue;
      }

      // Check human_reply_pause_minutes
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
          console.log(`Pausing followup for session ${session.id}: human replied, resuming in ${remainingMinutes}min`);
          await supabase.rpc("schedule_followup_for_session", {
            p_session_id: session.id,
            p_delay_minutes: remainingMinutes,
          }).catch(e => console.error("Schedule pause error:", e));
          continue;
        }
      }

      // Get last executed step for this session
      const { data: lastLog } = await supabase
        .from("wjia_followup_log")
        .select("*")
        .eq("session_id", session.id)
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextStepIndex = lastLog ? (lastLog.step_index + 1) : 0;
      
      // If not repeat forever and we've completed all steps, mark session done
      if (!repeatForever && nextStepIndex >= steps.length) {
        console.log(`All ${steps.length} followup steps completed for session ${session.id}, not repeating.`);
        await supabase.from("wjia_collection_sessions").update({ status: "followup_done" }).eq("id", session.id);
        continue;
      }
      
      const effectiveStepIndex = nextStepIndex % steps.length;
      const step = steps[effectiveStepIndex];
      const delayMinutes = step.delay_minutes || 60;

      // Check if enough time has passed
      const referenceTime = lastLog?.executed_at || session.updated_at;
      const timeSince = Date.now() - new Date(referenceTime).getTime();
      const delayMs = delayMinutes * 60 * 1000;

      if (timeSince < delayMs) {
        const remainingMinutes = Math.max(1, Math.ceil((delayMs - timeSince) / 60000));
        await supabase.rpc("schedule_followup_for_session", {
          p_session_id: session.id,
          p_delay_minutes: remainingMinutes,
        }).catch(e => console.error("Schedule error:", e));
        continue;
      }

      console.log(`Executing followup step ${effectiveStepIndex} for session ${session.id}: ${step.action_type}`);

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
        rule_id: null,
        step_index: nextStepIndex,
        action_type: step.action_type,
        action_result: actionResult,
        next_execution_at: null,
      });

      actionsExecuted++;

      // Schedule the NEXT step
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
