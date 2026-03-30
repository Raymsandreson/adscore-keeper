import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Not authenticated");

    const { text, voice_id } = await req.json();
    if (!text) throw new Error("Text is required");

    // Get user's voice preference if no voice_id specified
    let finalVoiceId = voice_id;
    if (!finalVoiceId) {
      const { data: pref } = await supabase
        .from("voice_preferences")
        .select("voice_id")
        .eq("user_id", user.id)
        .maybeSingle();
      finalVoiceId = pref?.voice_id || "FGY2WhTYpPnrIDTdsKH5"; // Laura default
    }

    // Clean text for TTS
    const cleanText = text
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/✅|📋|📅|🔔|👤|✏️|🤖|⚠️|📊|📌|📞|💬|👥|🔄|📈|🏆|☑️|🕐|📍|🎯|💡|🔴|🟠|🟡|🟢|🌟|⏳|🔍|📥|🔗|🚀|1️⃣|2️⃣|3️⃣/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!cleanText || cleanText.length < 5) {
      throw new Error("Text too short for TTS");
    }

    // Truncate to 1000 chars max
    const truncated = cleanText.length > 1000 ? cleanText.substring(0, 1000) + "..." : cleanText;

    const ttsResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: truncated,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
        }),
      }
    );

    if (!ttsResp.ok) {
      const errText = await ttsResp.text();
      console.error("ElevenLabs TTS error:", ttsResp.status, errText);
      throw new Error(`TTS generation failed: ${ttsResp.status}`);
    }

    const audioBuffer = await ttsResp.arrayBuffer();

    // Upload to storage
    const fileName = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const filePath = `tts/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, new Uint8Array(audioBuffer), {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(filePath);

    return new Response(JSON.stringify({
      success: true,
      audio_url: urlData?.publicUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("TTS error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
