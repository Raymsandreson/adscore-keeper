/**
 * WhatsApp messaging utilities: send text, media, audio (TTS), split messages.
 */

import { checkElevenLabsCredits, fetchWithRetry } from "./elevenlabs-utils.ts";

import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "./supabase-url-resolver.ts";

// ============================================================
// SEND TEXT MESSAGE
// ============================================================

export async function sendWhatsApp(
  supabase: any,
  inst: any,
  phone: string,
  instanceName: string,
  text: string,
  contactId?: string,
  leadId?: string,
  msgIdPrefix = "wjia",
  options?: {
    splitMessages?: boolean;
    splitDelaySeconds?: number;
    cloudClient?: any;
  },
) {
  if (!inst?.instance_token) return;
  const baseUrl = inst.base_url || "https://abraci.uazapi.com";

  const shouldSplit = options?.splitMessages === true;
  const splitDelay = (options?.splitDelaySeconds || 3) * 1000;

  // Split message into parts at double-newline boundaries
  let parts: string[] = [text];
  if (shouldSplit && text.includes("\n\n")) {
    const rawParts = text.split(/\n\n+/).filter((p) => p.trim());
    if (rawParts.length > 1) {
      parts = [];
      let buf = "";
      for (const p of rawParts) {
        if (buf && (buf.length + p.length) > 300) {
          parts.push(buf.trim());
          buf = p;
        } else {
          buf = buf ? buf + "\n\n" + p : p;
        }
      }
      if (buf.trim()) parts.push(buf.trim());
    }
  }

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, splitDelay));
    await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: inst.instance_token,
      },
      body: JSON.stringify({ number: phone, text: parts[i] }),
    }).catch((e) => console.error("Send error:", e));
    const msgRow = {
      phone,
      instance_name: instanceName,
      message_text: parts[i],
      message_type: "text",
      direction: "outbound",
      contact_id: contactId || null,
      lead_id: leadId || null,
      external_message_id: `${msgIdPrefix}_${Date.now()}_${i}`,
      action_source: "system",
      action_source_detail: "WJIA Agent (comando)",
    };
    await supabase.from("whatsapp_messages").insert(msgRow);
    if (options?.cloudClient) {
      await options.cloudClient.from("whatsapp_messages").insert(msgRow).catch((
        e: any,
      ) => console.error("Cloud mirror error:", e));
    }
  }
}

// ============================================================
// SEND AUDIO MESSAGE (TTS via ElevenLabs)
// ============================================================

function splitTextForTTS(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?…])\s+/);
  let buf = "";
  for (const s of sentences) {
    if (buf && (buf.length + s.length + 1) > limit) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf = buf ? buf + " " + s : s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

/**
 * Send a text reply as TTS audio via ElevenLabs + UazAPI.
 * Falls back to text if TTS fails.
 */
export async function sendWhatsAppAudio(
  supabase: any,
  inst: any,
  phone: string,
  instanceName: string,
  text: string,
  voiceId: string,
  contactId?: string,
  leadId?: string,
  msgIdPrefix = "wjia_audio",
) {
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY || !inst?.instance_token) {
    console.warn("sendWhatsAppAudio: missing ELEVENLABS_API_KEY or instance_token, falling back to text");
    return sendWhatsApp(supabase, inst, phone, instanceName, text, contactId, leadId, msgIdPrefix);
  }

  const baseUrl = inst.base_url || "https://abraci.uazapi.com";
  // Remove markdown formatting for TTS
  const cleanText = text.replace(/\*\*/g, "").replace(/\*/g, "").replace(/[_~`]/g, "").trim();
  const maxChars = 3000;
  const chunks = splitTextForTTS(cleanText, maxChars);
  console.log(`WJIA TTS: ${cleanText.length} chars → ${chunks.length} chunk(s), voice=${voiceId}`);

    // Check credits before calling TTS
    const credits = await checkElevenLabsCredits(ELEVENLABS_API_KEY);
    if (!credits.has_credits) {
      console.warn(`sendWhatsAppAudio: ElevenLabs sem créditos (${credits.character_count}/${credits.character_limit}), fallback texto`);
      return sendWhatsApp(supabase, inst, phone, instanceName, text, contactId, leadId, msgIdPrefix);
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const ttsResp = await fetchWithRetry(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: chunk,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
            ...(ci > 0 ? { previous_text: chunks[ci - 1].slice(-200) } : {}),
            ...(ci < chunks.length - 1 ? { next_text: chunks[ci + 1].slice(0, 200) } : {}),
          }),
        },
        2, // maxRetries
        1500,
      );

      if (!ttsResp.ok) {
        const errBody = await ttsResp.text();
        console.error(`WJIA TTS error chunk ${ci + 1}:`, ttsResp.status, errBody);
        throw new Error(`TTS failed: ${ttsResp.status}`);
      }

      const audioBuffer = await ttsResp.arrayBuffer();
      const fileName = `tts-wjia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
      const filePath = `tts/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from("whatsapp-media")
        .upload(filePath, new Uint8Array(audioBuffer), {
          contentType: "audio/mpeg",
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from("whatsapp-media").getPublicUrl(filePath);
      const audioUrl = urlData?.publicUrl;

      if (audioUrl) {
        const sendRes = await fetch(`${baseUrl}/send/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({ number: phone, file: audioUrl, type: "audio" }),
        });
        if (!sendRes.ok) {
          console.error("UazAPI audio send error:", sendRes.status, await sendRes.text());
          throw new Error("Audio send failed");
        }
        console.log(`WJIA TTS sent chunk ${ci + 1}/${chunks.length} to ${phone}`);
      }

      if (ci < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Log audio message
    const msgRow = {
      phone,
      instance_name: instanceName,
      message_text: text,
      message_type: "audio",
      direction: "outbound",
      contact_id: contactId || null,
      lead_id: leadId || null,
      external_message_id: `${msgIdPrefix}_${Date.now()}`,
      action_source: "system",
      action_source_detail: "WJIA Agent (comando)",
    };
    await supabase.from("whatsapp_messages").insert(msgRow);
  } catch (e) {
    console.error("WJIA TTS failed, falling back to text:", e);
    await sendWhatsApp(supabase, inst, phone, instanceName, text, contactId, leadId, msgIdPrefix);
  }
}

/**
 * Resolve voice ID: handles "instance_owner" and custom_voices UUIDs.
 */
export async function resolveVoiceId(
  supabase: any,
  voiceId: string,
  instanceName: string,
): Promise<string> {
  const FALLBACK_VOICE = "FGY2WhTYpPnrIDTdsKH5"; // Laura

  if (!voiceId || voiceId === "instance_owner") {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("voice_id")
      .eq("instance_name", instanceName)
      .maybeSingle();
    const resolved = inst?.voice_id || FALLBACK_VOICE;
    console.log(`Resolved instance voice to: ${resolved}`);
    return resolved;
  }

  // Custom voice UUID
  if (voiceId.length === 36 && voiceId.includes("-")) {
    const { data: customVoice } = await supabase
      .from("custom_voices")
      .select("elevenlabs_voice_id")
      .eq("id", voiceId)
      .eq("status", "ready")
      .maybeSingle();
    return customVoice?.elevenlabs_voice_id || FALLBACK_VOICE;
  }

  return voiceId || FALLBACK_VOICE;
}

// ============================================================
// SPEECH-TO-SPEECH (ElevenLabs STS)
// ============================================================

/**
 * Convert TTS-generated audio to target voice using Speech-to-Speech.
 * This creates more natural-sounding responses by preserving the
 * prosody/emotion from TTS and mapping to the target voice.
 * Falls back to the original TTS audio URL if STS fails.
 */
export async function speechToSpeech(
  supabase: any,
  audioUrl: string,
  voiceId: string,
  options?: {
    modelId?: string;
    removeBackgroundNoise?: boolean;
  },
): Promise<string | null> {
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY) {
    console.warn("speechToSpeech: ELEVENLABS_API_KEY missing");
    return null;
  }

  try {
    // Download input audio
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) throw new Error(`Download failed: ${audioResp.status}`);
    const audioBlob = await audioResp.blob();

    const formData = new FormData();
    formData.append("audio", audioBlob, "input.mp3");
    formData.append("model_id", options?.modelId || "eleven_multilingual_sts_v2");
    if (options?.removeBackgroundNoise) {
      formData.append("remove_background_noise", "true");
    }
    formData.append("voice_settings", JSON.stringify({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
    }));

    const stsResp = await fetch(
      `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        body: formData,
      },
    );

    if (!stsResp.ok) {
      console.error("STS error:", stsResp.status, await stsResp.text());
      return null;
    }

    const resultBuffer = await stsResp.arrayBuffer();
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
    console.log(`STS: converted audio uploaded to ${urlData?.publicUrl}`);
    return urlData?.publicUrl || null;
  } catch (e) {
    console.error("STS failed:", e);
    return null;
  }
}
