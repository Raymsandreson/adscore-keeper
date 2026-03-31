import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

// Use external Supabase project when configured (hybrid architecture)
function resolveSupabaseUrl(): string {
  const candidates = [Deno.env.get('EXTERNAL_SUPABASE_URL'), Deno.env.get('SUPABASE_URL')];
  for (const c of candidates) { const v = (c || '').trim(); if (v.startsWith('https://') || v.startsWith('http://')) return v; }
  return 'https://kmedldlepwiityjsdahz.supabase.co';
}
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
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
    const baseUrl = (instance as any).base_url;
    const token = (instance as any).instance_token;
    const phone = (nextCall as any).phone;

    console.log(`Initiating call to ${phone} via ${instanceName}`);

    const callResp = await fetch(`${baseUrl}/call/make`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: token,
      },
      body: JSON.stringify({ number: phone }),
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

    // Create call record and send follow-up audio
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

      // Send follow-up audio message after the call
      await sendCallFollowupAudio(supabase, phone, instanceName, instance, (nextCall as any).contact_name || (nextCall as any).lead_name);
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

async function sendCallFollowupAudio(
  supabase: any, phone: string, instanceName: string, instance: any, contactName: string | null
) {
  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      console.log("No ElevenLabs key, skipping call follow-up audio");
      return;
    }

    const { data: convAgent } = await supabase
      .from("whatsapp_conversation_agents")
      .select("agent_id")
      .like("phone", `%${phone.slice(-8)}%`)
      .eq("is_active", true)
      .maybeSingle();

    if (!convAgent?.agent_id) {
      console.log("No active agent for phone, skipping call follow-up audio");
      return;
    }

    const { data: agent } = await supabase
      .from("wjia_command_shortcuts")
      .select("shortcut_name, reply_voice_id, base_prompt, send_call_followup_audio, reply_with_audio")
      .eq("id", convAgent.agent_id)
      .maybeSingle();

    // Send follow-up audio if explicitly enabled OR if agent has audio replies enabled (fallback)
    const shouldSendAudio = agent?.send_call_followup_audio || agent?.reply_with_audio;
    if (!shouldSendAudio) {
      console.log("Agent has neither send_call_followup_audio nor reply_with_audio enabled, skipping");
      return;
    }

    let voiceId = "FGY2WhTYpPnrIDTdsKH5";
    const agentName = agent.shortcut_name || "Assistente";
    const followupPrompt = agent.base_prompt || "";

    if (agent.reply_voice_id) {
      if (agent.reply_voice_id.length === 36 && agent.reply_voice_id.includes("-")) {
        const { data: cv } = await supabase
          .from("custom_voices")
          .select("elevenlabs_voice_id")
          .eq("id", agent.reply_voice_id)
          .eq("status", "ready")
          .maybeSingle();
        voiceId = cv?.elevenlabs_voice_id || voiceId;
      } else {
        voiceId = agent.reply_voice_id;
      }
    }

    const { data: recentMsgs } = await supabase
      .from("whatsapp_messages")
      .select("direction, message_text")
      .like("phone", `%${phone.slice(-8)}%`)
      .eq("instance_name", instanceName)
      .order("created_at", { ascending: false })
      .limit(10);

    const contextLines = (recentMsgs || [])
      .reverse()
      .map((m: any) => `${m.direction === "inbound" ? "Cliente" : agentName}: ${m.message_text || "(mídia)"}`)
      .join("\n");

    const firstName = contactName?.split(" ")[0] || "cliente";

    const aiResult = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `Você é ${agentName}. Você acabou de ligar para o(a) ${firstName} mas a ligação não foi atendida ou foi breve. Agora você vai enviar um áudio curto e natural no WhatsApp avisando que tentou ligar e reforçando o assunto da conversa. Seja empático, natural, use português brasileiro informal (tá, pra, tô). MÁXIMO 3 frases curtas. NÃO use listas ou bullets. ${followupPrompt ? `\nContexto do agente: ${followupPrompt}` : ""}`
        },
        {
          role: "user",
          content: `Contexto da conversa recente:\n${contextLines || "(sem mensagens anteriores)"}\n\nGere uma mensagem curta e natural avisando que tentou ligar e pedindo pra retornar ou continuar pelo WhatsApp.`
        }
      ],
    });

    const followupText = aiResult.choices?.[0]?.message?.content?.trim();
    if (!followupText) {
      console.log("No AI text generated for call follow-up");
      return;
    }

    console.log(`Call follow-up text for ${phone}: ${followupText.substring(0, 100)}`);

    const ttsResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: followupText,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
        }),
      }
    );

    if (!ttsResp.ok) {
      console.error("ElevenLabs TTS error for call follow-up:", ttsResp.status);
      return;
    }

    const audioBuffer = await ttsResp.arrayBuffer();
    const fileName = `tts-call-followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const filePath = `tts/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, new Uint8Array(audioBuffer), { contentType: "audio/mpeg", upsert: false });

    if (uploadErr) {
      console.error("Upload error for call follow-up audio:", uploadErr);
      return;
    }

    const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(filePath);
    const audioUrl = urlData?.publicUrl;
    if (!audioUrl) return;

    await new Promise(r => setTimeout(r, 5000));

    const baseUrl = (instance as any).base_url;
    const token = (instance as any).instance_token;

    const sendRes = await fetch(`${baseUrl}/send/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, file: audioUrl, type: "audio" }),
    });

    if (!sendRes.ok) {
      console.error("Send call follow-up audio error:", sendRes.status);
    } else {
      console.log(`Call follow-up audio sent to ${phone}`);
    }

    await supabase.from("whatsapp_messages").insert({
      phone,
      instance_name: instanceName,
      message_text: `🎤 ${followupText}`,
      message_type: "audio",
      direction: "outbound",
      external_message_id: `call_followup_${Date.now()}`,
      action_source: "system",
      action_source_detail: "Call follow-up audio",
    });

  } catch (e) {
    console.error("Call follow-up audio error:", e);
  }
}
