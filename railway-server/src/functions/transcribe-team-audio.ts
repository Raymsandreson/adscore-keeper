// Transcreve um áudio do chat da equipe (chat direto/grupo).
// Body: { audio_url: string, audio_mime?: string }
// - audio_url: URL pública do áudio (subido pelo front no bucket team-chat-media).
//   O áudio é baixado aqui no servidor pra manter o payload do request pequeno.
// STT: ElevenLabs Scribe v2 → fallback Gemini (lib/stt). Sem IA de preenchimento —
// devolve só o texto fiel do que foi falado.
import type { RequestHandler } from 'express';
import { transcribeAudio } from '../lib/stt';

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { audio_url, audio_mime } = (req.body || {}) as {
      audio_url?: string;
      audio_mime?: string;
    };

    if (!audio_url) return ok({ success: false, error: 'audio_url obrigatório' });

    // 1) Baixa o áudio a partir da URL pública.
    const resp = await fetch(audio_url);
    if (!resp.ok) return ok({ success: false, error: `Falha ao baixar áudio (${resp.status})` });
    const buffer = await resp.arrayBuffer();
    const mime = audio_mime || resp.headers.get('content-type') || 'audio/webm';

    // 2) Transcrição fiel (ElevenLabs Scribe v2 → fallback Gemini).
    const transcription = await transcribeAudio(buffer, mime);
    if (!transcription || transcription === '[áudio inaudível]') {
      return ok({
        success: false,
        error: 'Não foi possível transcrever o áudio (inaudível ou vazio).',
        transcription: transcription || '',
      });
    }

    return ok({ success: true, transcription });
  } catch (e: any) {
    console.error('[transcribe-team-audio] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};
