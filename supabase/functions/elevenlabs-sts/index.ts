/**
 * ElevenLabs Speech-to-Speech Edge Function
 * Receives audio, converts it to a target voice using ElevenLabs STS API,
 * uploads result to storage, and returns the public URL.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);

    const { audio_url, voice_id, text, model_id, remove_background_noise } = await req.json();
    if (!audio_url) throw new Error("audio_url is required");
    if (!voice_id) throw new Error("voice_id is required");

    console.log(`STS: Converting audio to voice ${voice_id}, audio_url=${audio_url.slice(0, 80)}...`);

    // Download input audio
    const audioResp = await fetch(audio_url);
    if (!audioResp.ok) throw new Error(`Failed to download audio: ${audioResp.status}`);
    const audioBlob = await audioResp.blob();

    // Build multipart form for ElevenLabs STS
    const formData = new FormData();
    formData.append("audio", audioBlob, "input.mp3");
    formData.append("model_id", model_id || "eleven_multilingual_sts_v2");
    
    if (remove_background_noise) {
      formData.append("remove_background_noise", "true");
    }

    // Voice settings for natural conversation
    const voiceSettings = JSON.stringify({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
    });
    formData.append("voice_settings", voiceSettings);

    // Call ElevenLabs Speech-to-Speech API with low-latency output format
    const stsResp = await fetch(
      `https://api.elevenlabs.io/v1/speech-to-speech/${voice_id}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: formData,
      },
    );

    if (!stsResp.ok) {
      const errText = await stsResp.text();
      console.error("ElevenLabs STS error:", stsResp.status, errText);
      throw new Error(`STS failed: ${stsResp.status} - ${errText}`);
    }

    const resultBuffer = await stsResp.arrayBuffer();
    console.log(`STS: Got ${resultBuffer.byteLength} bytes of converted audio`);

    // Upload to storage
    const fileName = `sts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const filePath = `sts/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, new Uint8Array(resultBuffer), {
        contentType: "audio/mpeg",
        upsert: false,
      });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(filePath);

    console.log(`STS: Uploaded to ${urlData?.publicUrl}`);

    return new Response(JSON.stringify({
      success: true,
      audio_url: urlData?.publicUrl,
      size_bytes: resultBuffer.byteLength,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("STS error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
