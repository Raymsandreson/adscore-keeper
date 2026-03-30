import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if there's an active call in progress
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: activeCalls } = await supabase
      .from("whatsapp_call_queue")
      .select("id")
      .eq("status", "calling")
      .gte("updated_at", twoMinAgo)
      .limit(1);

    if (activeCalls && activeCalls.length > 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "Call in progress" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get next pending call
    const now = new Date().toISOString();
    const { data: nextCall } = await supabase
      .from("whatsapp_call_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", now)
      .order("priority", { ascending: false })
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!nextCall) {
      return new Response(JSON.stringify({ skipped: true, reason: "No pending calls" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as calling
    await supabase.from("whatsapp_call_queue").update({
      status: "calling",
      attempts: (nextCall as any).attempts + 1,
      last_attempt_at: now,
      updated_at: now,
    } as any).eq("id", (nextCall as any).id);

    // Get instance for making the call
    const instanceName = (nextCall as any).instance_name;
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("base_url, instance_token, instance_name")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (!instance) {
      await supabase.from("whatsapp_call_queue").update({
        status: "failed",
        last_result: "Instance not found",
        updated_at: new Date().toISOString(),
      } as any).eq("id", (nextCall as any).id);

      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Make call via UazAPI
    const baseUrl = (instance as any).base_url || (instance as any).api_url;
    const token = (instance as any).instance_token || (instance as any).api_token;
    const phone = (nextCall as any).phone;

    console.log(`Initiating call to ${phone} via ${instanceName}`);

    const callResp = await fetch(`${baseUrl}/call/make`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: token,
      },
      body: JSON.stringify({ phone }),
    });

    let callResult = "unknown";
    if (callResp.ok) {
      callResult = "initiated";
      console.log(`Call initiated to ${phone}`);
    } else {
      const errText = await callResp.text();
      callResult = `error: ${callResp.status} - ${errText.substring(0, 200)}`;
      console.error(`Call failed: ${callResult}`);
    }

    // Update queue status
    const maxAttempts = (nextCall as any).max_attempts || 3;
    const currentAttempts = (nextCall as any).attempts + 1;
    const newStatus = callResult === "initiated"
      ? "completed"
      : currentAttempts >= maxAttempts
        ? "failed"
        : "pending";

    // If failed but can retry, schedule next attempt in 5 minutes
    const updatePayload: any = {
      status: newStatus,
      last_result: callResult,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === "pending") {
      updatePayload.scheduled_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }

    await supabase.from("whatsapp_call_queue").update(updatePayload).eq("id", (nextCall as any).id);

    // Create call record
    if (callResult === "initiated") {
      await supabase.from("call_records").insert({
        call_type: "outbound",
        call_result: "em_andamento",
        contact_phone: phone,
        contact_name: (nextCall as any).contact_name,
        lead_id: (nextCall as any).lead_id,
        lead_name: (nextCall as any).lead_name,
        phone_used: instanceName,
        notes: `Chamada automática via discadora IA`,
        tags: ["whatsapp", "automatico", "discadora"],
        user_id: "00000000-0000-0000-0000-000000000000", // system
      });
    }

    return new Response(JSON.stringify({
      success: true,
      call_result: callResult,
      phone,
      instance: instanceName,
      attempt: currentAttempts,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Call queue processor error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
