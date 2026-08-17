/**
 * Shared Speech-to-Text utility — ported from supabase/functions/_shared/stt.ts
 * Primary: ElevenLabs Scribe v2
 * Fallback: Gemini 2.5 Flash
 *
 * Quando nenhuma das duas pernas devolve texto, o motivo REAL sobe junto
 * (`transcribeAudioDetailed`). Sem isso, os dois provedores podiam estar fora e
 * o assessor lia "áudio inaudível ou vazio" — uma mensagem que acusa o
 * microfone dele e esconde a queda. Foi o que segurou o diagnóstico em
 * 17/08/2026: gravação íntegra (29,4s, -19,7 dB), falha 100% reproduzível e
 * nenhum rastro do porquê fora dos logs do servidor.
 */

import { geminiChat } from "./gemini";
import { checkElevenLabsCredits, fetchWithRetry } from "./elevenlabs-utils";

const DEFAULT_STT_PROMPT =
  "Transcreva fielmente esta mensagem de voz em português brasileiro. " +
  "Retorne SOMENTE o texto falado, com leve limpeza de repetições e pausas, " +
  "mas mantendo o sentido original. Se o áudio estiver inaudível, retorne '[áudio inaudível]'. " +
  "NÃO invente conteúdo que não foi dito.";

export interface TranscriptionResult {
  /** Texto transcrito, ou `null` quando nenhuma perna devolveu nada. */
  text: string | null;
  /** Por que não veio texto. Só preenchido quando `text` é `null`. */
  reason?: string;
}

/** Recorta o corpo do provedor pro motivo caber num toast. */
function resumo(txt: string): string {
  return txt.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Compat: mantém a assinatura antiga para os chamadores que só querem o texto. */
export async function transcribeAudio(
  audioBuffer: ArrayBuffer | Uint8Array,
  audioMime: string,
  sttPrompt?: string
): Promise<string | null> {
  return (await transcribeAudioDetailed(audioBuffer, audioMime, sttPrompt)).text;
}

export async function transcribeAudioDetailed(
  audioBuffer: ArrayBuffer | Uint8Array,
  audioMime: string,
  sttPrompt?: string
): Promise<TranscriptionResult> {
  const bytes = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
  // Um item por perna que falhou, na ordem em que foram tentadas.
  const falhas: string[] = [];

  if (bytes.length < 100) {
    console.warn("Audio buffer too small for transcription:", bytes.length);
    return { text: null, reason: `o arquivo chegou com ${bytes.length} bytes — gravação vazia` };
  }

  // 1. Try ElevenLabs Scribe v2
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    falhas.push('ElevenLabs: ELEVENLABS_API_KEY não configurada');
  }
  if (ELEVENLABS_API_KEY) {
    const credits = await checkElevenLabsCredits(ELEVENLABS_API_KEY);
    if (!credits.has_credits) {
      console.warn(`ElevenLabs STT: sem créditos (${credits.character_count}/${credits.character_limit}), fallback Gemini`);
      falhas.push(`ElevenLabs: sem cota (${credits.character_count}/${credits.character_limit})`);
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
          const data = await res.json() as any;
          const text = data.text?.trim();
          if (text) {
            console.log(`ElevenLabs STT OK (${text.length} chars): ${text.substring(0, 100)}`);
            return { text };
          }
          // 200/202 sem texto: com `webhook=true` a Scribe responde 202 e manda o
          // resultado depois — aqui não pedimos webhook, então isso é anomalia.
          console.error(`ElevenLabs STT respondeu ${res.status} sem texto`);
          falhas.push(`ElevenLabs: HTTP ${res.status} sem campo "text"`);
        } else {
          const corpo = await res.text();
          console.error(`ElevenLabs STT error: ${res.status} ${corpo}`);
          falhas.push(`ElevenLabs: HTTP ${res.status} — ${resumo(corpo)}`);
        }
      } catch (e) {
        console.error("ElevenLabs STT exception, falling back to Gemini:", e);
        falhas.push(`ElevenLabs: ${resumo(e instanceof Error ? e.message : String(e))}`);
      }
    }
  }

  // 2. Fallback: Gemini
  try {
    const base64Audio = Buffer.from(bytes).toString('base64');
    const format = audioMime.split("/")[1]?.split(";")[0]?.trim() || "ogg";
    const prompt = sttPrompt || DEFAULT_STT_PROMPT;

    const result = await geminiChat({
      model: "google/gemini-3.6-flash",
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
      return { text };
    }
    // `parseGeminiResponse` devolve content vazio quando o candidato vem sem
    // parts — MAX_TOKENS, RECITATION ou modalidade recusada. O finish_reason é
    // a única pista, então vai junto.
    const finish = result?.choices?.[0]?.finish_reason || 'sem motivo declarado';
    console.error(`Gemini STT devolveu texto vazio (finish_reason: ${finish})`);
    falhas.push(`Gemini: resposta vazia (finish_reason: ${finish})`);
  } catch (e) {
    console.error("Gemini STT fallback failed:", e);
    falhas.push(`Gemini: ${resumo(e instanceof Error ? e.message : String(e))}`);
  }

  return { text: null, reason: falhas.join(' | ') || 'os dois provedores de transcrição falharam sem detalhe' };
}
