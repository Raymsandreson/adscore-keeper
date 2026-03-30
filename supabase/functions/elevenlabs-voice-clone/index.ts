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

    const body = await req.json();
    const { action } = body;

    // List available preset voices
    if (action === "list_presets") {
      const presets = [
        { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "female", lang: "pt-BR" },
        { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female", lang: "en" },
        { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "male", lang: "en" },
        { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "male", lang: "en" },
        { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male", lang: "en" },
        { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "female", lang: "en" },
        { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "female", lang: "en" },
        { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "male", lang: "en" },
        { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", gender: "male", lang: "en" },
        { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "female", lang: "en" },
      ];

      // Also fetch user's custom voices
      const { data: customVoices } = await supabase
        .from("custom_voices")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      // Get user's current preference
      const { data: pref } = await supabase
        .from("voice_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      return new Response(JSON.stringify({ presets, custom_voices: customVoices || [], preference: pref }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clone a voice
    if (action === "clone") {
      const { name, sample_urls } = body;
      if (!name || !sample_urls?.length) throw new Error("Name and sample_urls required");

      // Create record first
      const { data: voiceRecord, error: insertErr } = await supabase
        .from("custom_voices")
        .insert({
          user_id: user.id,
          name,
          status: "processing",
          sample_file_urls: sample_urls,
        })
        .select("id")
        .single();

      if (insertErr) throw insertErr;

      // Download audio samples and prepare form data
      const formData = new FormData();
      formData.append("name", `${name}_${user.id.slice(0, 8)}`);
      formData.append("description", `Cloned voice for user ${user.id}`);

      for (let i = 0; i < sample_urls.length; i++) {
        const audioResp = await fetch(sample_urls[i]);
        if (!audioResp.ok) continue;
        const blob = await audioResp.blob();
        formData.append("files", blob, `sample_${i}.mp3`);
      }

      // Call ElevenLabs voice cloning API
      const cloneResp = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        body: formData,
      });

      if (!cloneResp.ok) {
        const errText = await cloneResp.text();
        console.error("Clone error:", cloneResp.status, errText);
        await supabase.from("custom_voices").update({
          status: "failed",
          error_message: `ElevenLabs error: ${cloneResp.status}`,
          updated_at: new Date().toISOString(),
        }).eq("id", voiceRecord.id);
        throw new Error(`Voice cloning failed: ${errText}`);
      }

      const cloneResult = await cloneResp.json();

      // Update with ElevenLabs voice ID
      await supabase.from("custom_voices").update({
        elevenlabs_voice_id: cloneResult.voice_id,
        status: "ready",
        updated_at: new Date().toISOString(),
      }).eq("id", voiceRecord.id);

      return new Response(JSON.stringify({
        success: true,
        voice_id: cloneResult.voice_id,
        record_id: voiceRecord.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Set voice preference
    if (action === "set_preference") {
      const { voice_type, voice_id, voice_name } = body;

      const { error } = await supabase
        .from("voice_preferences")
        .upsert({
          user_id: user.id,
          voice_type: voice_type || "preset",
          voice_id,
          voice_name,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate TTS preview
    if (action === "preview") {
      const { voice_id, text } = body;
      const previewText = text || "Olá, esta é uma prévia da minha voz. Como ficou?";

      const ttsResp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}?output_format=mp3_22050_32`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: previewText,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
          }),
        }
      );

      if (!ttsResp.ok) {
        throw new Error(`TTS preview failed: ${ttsResp.status}`);
      }

      const audioBuffer = await ttsResp.arrayBuffer();
      return new Response(audioBuffer, {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
      });
    }

    // Delete a custom voice
    if (action === "delete") {
      const { voice_id, record_id } = body;
      if (!record_id) throw new Error("record_id required");

      // If there's an ElevenLabs voice, delete it from their API
      if (voice_id) {
        try {
          await fetch(`https://api.elevenlabs.io/v1/voices/${voice_id}`, {
            method: "DELETE",
            headers: { "xi-api-key": ELEVENLABS_API_KEY },
          });
        } catch (e) {
          console.error("ElevenLabs delete error (non-fatal):", e);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from("custom_voices")
        .delete()
        .eq("id", record_id)
        .eq("user_id", user.id);

      if (error) throw error;

      // Clear preference if it was using this voice
      if (voice_id) {
        await supabase
          .from("voice_preferences")
          .delete()
          .eq("user_id", user.id)
          .eq("voice_id", voice_id);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("Voice clone error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
