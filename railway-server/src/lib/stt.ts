/**
 * Shared Speech-to-Text utility — ported from supabase/functions/_shared/stt.ts
 * Primary: ElevenLabs Scribe v2
 * Fallback: Gemini 2.5 Flash
 */

import { geminiChat } from "./gemini";
import { checkElevenLabsCredits, fetchWithRetry } from "./elevenlabs-utils";

const DEFAULT_STT_PROMPT =
  "Transcreva fielmente esta mensagem de voz em português brasileiro. " +
  "Retorne SOMENTE o texto falado, com leve limpeza de repetições e pausas, " +
  "mas mantendo o sentido original. Se o áudio estiver inaudível, retorne '[áudio inaudível]'. " +
  "NÃO invente conteúdo que não foi dito.";

export async function transcribeAudio(
  audioBuffer: ArrayBuffer | Uint8Array,
  audioMime: string,
  sttPrompt?: string
): Promise<string | null> {
  const bytes = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);

  if (bytes.length < 100) {
    console.warn("Audio buffer too small for transcription:", bytes.length);
    return null;
  }

  // 1. Try ElevenLabs Scribe v2
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (ELEVENLABS_API_KEY) {
    const credits = await checkElevenLabsCredits(ELEVENLABS_API_KEY);
    if (!credits.has_credits) {
      console.warn(`ElevenLabs STT: sem créditos (${credits.character_count}/${credits.character_limit}), fallback Gemini`);
    } else {
      try {
        const ext = audioMime.split("/")[1]?.split(";")[0] || "ogg";
        const blob = new Blob([bytes], { type: audioMime });
        const formData = new FormData();
        formData.append("file", blob, `audio.${ext}`);
        formData.append("model_id", "scribe_v2");
        formData.append("language_code", "por");
        formData.append("tag_audio_events", "false");
        formData.append("diarize", "false");

        const res = await fetchWithRetry(
          "https://api.elevenlabs.io/v1/speech-to-text",
          { method: "POST", headers: { "xi-api-key": ELEVENLABS_API_KEY }, body: formData },
          2, 1500,
        );

        if (res.ok) {
          const data = await res.json();
          const text = data.text?.trim();
          if (text) {
            console.log(`ElevenLabs STT OK (${text.length} chars): ${text.substring(0, 100)}`);
            return text;
          }
        } else {
          console.error(`ElevenLabs STT error: ${res.status} ${await res.text()}`);
        }
      } catch (e) {
        console.error("ElevenLabs STT exception, falling back to Gemini:", e);
      }
    }
  }

  // 2. Fallback: Gemini
  try {
    const base64Audio = Buffer.from(bytes).toString('base64');
    const format = audioMime.split("/")[1]?.split(";")[0]?.trim() || "ogg";
    const prompt = sttPrompt || DEFAULT_STT_PROMPT;

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcreva este áudio:" },
            { type: "input_audio", input_audio: { data: base64Audio, format } },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    });

    const text = result?.choices?.[0]?.message?.content?.trim();
    if (text) {
      console.log(`Gemini STT OK (${text.length} chars): ${text.substring(0, 100)}`);
      return text;
    }
  } catch (e) {
    console.error("Gemini STT fallback failed:", e);
  }

  return null;
}
