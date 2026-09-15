// Transcreve um áudio do chat da equipe (chat direto/grupo).
// Body: { audio_url: string, audio_mime?: string, limpar?: boolean, contexto?: string }
// - audio_url: URL pública do áudio (subido pelo front no bucket team-chat-media).
//   O áudio é baixado aqui no servidor pra manter o payload do request pequeno.
// - limpar: quando true, o texto fiel passa por uma limpeza de IA antes de voltar
//   (ver limparDitado). Sem a flag, o comportamento é o de sempre: texto cru.
// - contexto: uma frase dizendo pra que serve o ditado (ex.: "instrução para a IA
//   editar um fluxo de trabalho"). Só orienta o tom da limpeza; não vira conteúdo.
// STT: ElevenLabs Scribe v2 → fallback Gemini (lib/stt).
//
// Por que a limpeza é um passo separado do STT: a perna primária (ElevenLabs
// Scribe) devolve o áudio VERBATIM — "é...", "tipo", começos abandonados e
// repetições vêm todos. O `sttPrompt` que pede "leve limpeza" só é usado na
// perna de reserva (Gemini). Então quem dita um pedido pra outra IA ler precisa
// desta segunda passada, senão o prompt chega sujo.
import type { RequestHandler } from 'express';
import { transcribeAudioDetailed } from '../lib/stt';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

/**
 * Tira do texto os vícios da fala sem tirar o que foi dito.
 *
 * O contrato é estreito de propósito: limpar ≠ reescrever. O texto sai do
 * ditado e vai direto pra um campo que a pessoa confere — se a IA resumir ou
 * trocar as palavras, quem ditou não reconhece mais o próprio pedido.
 */
export function montarPromptLimpeza(contexto?: string): string {
  const uso = (contexto || '').trim();
  return `Você recebe a TRANSCRIÇÃO LITERAL de um ditado por voz em português do Brasil e devolve o MESMO texto limpo, pronto para ser lido.

${uso ? `Para que serve este texto: ${uso}. Isso orienta só o tom — NÃO responda, NÃO execute e NÃO comente o pedido.\n` : ''}O que FAZER:
- Remover vícios de fala e hesitações ("é...", "né", "tipo", "ãã", "assim"), gaguejos e começos de frase abandonados.
- Remover repetições da mesma ideia dita duas vezes seguidas.
- Corrigir pontuação, maiúsculas, concordância e erros de transcrição óbvios (palavra que claramente saiu errada pelo som).
- Separar em frases e parágrafos quando ajudar a leitura.

O que NÃO fazer (nenhuma exceção):
- NÃO resumir, NÃO encurtar o conteúdo, NÃO cortar informação.
- NÃO acrescentar nada que não foi dito (nem exemplos, nem conclusões, nem saudações).
- NÃO trocar os termos de quem falou por sinônimos "melhores", NÃO reescrever no seu estilo.
- NÃO responder ao que foi pedido, NÃO comentar, NÃO opinar.

Responda SOMENTE com o texto limpo, sem aspas, sem markdown, sem título e sem qualquer introdução.`;
}

/** Modelo às vezes devolve o texto entre aspas ou com um rótulo na frente. */
export function polirSaida(bruto: string): string {
  let t = (bruto || '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  t = t.replace(/^(texto limpo|transcrição limpa|resultado)\s*:\s*/i, '').trim();
  if (t.length > 1 && /^["“'](.|\n)*["”']$/.test(t)) t = t.slice(1, -1).trim();
  return t;
}

/**
 * Roda a limpeza. Nunca lança: se a IA falhar, o ditado cru volta inteiro —
 * texto sujo é bem melhor do que perder o que a pessoa acabou de falar.
 */
export async function limparDitado(
  transcricao: string,
  contexto?: string,
): Promise<{ texto: string; falhou?: string }> {
  const cru = (transcricao || '').trim();
  if (!cru) return { texto: cru };
  try {
    const result = await geminiChat({
      model: MODEL,
      messages: [
        { role: 'system', content: montarPromptLimpeza(contexto) },
        { role: 'user', content: `TRANSCRIÇÃO LITERAL:\n${cru}` },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    });
    const limpo = polirSaida(result?.choices?.[0]?.message?.content || '');
    // Saída vazia ou absurdamente curta = a IA resumiu ou se perdeu. Nesse caso
    // o cru vale mais: o campo é conferido por quem ditou, não publicado.
    if (!limpo || limpo.length < Math.min(20, cru.length * 0.4)) {
      return { texto: cru, falhou: 'a limpeza devolveu texto vazio ou curto demais' };
    }
    return { texto: limpo };
  } catch (e: any) {
    console.error('[transcribe-team-audio] limpeza falhou:', e);
    return { texto: cru, falhou: e?.message || String(e) };
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { audio_url, audio_mime, limpar, contexto } = (req.body || {}) as {
      audio_url?: string;
      audio_mime?: string;
      limpar?: boolean;
      contexto?: string;
    };

    if (!audio_url) return ok({ success: false, error: 'audio_url obrigatório' });

    // 1) Baixa o áudio a partir da URL pública.
    const resp = await fetch(audio_url);
    if (!resp.ok) return ok({ success: false, error: `Falha ao baixar áudio (${resp.status})` });
    const buffer = await resp.arrayBuffer();
    const mime = audio_mime || resp.headers.get('content-type') || 'audio/webm';

    // 2) Transcrição fiel (ElevenLabs Scribe v2 → fallback Gemini).
    const { text: transcription, reason } = await transcribeAudioDetailed(buffer, mime);
    if (!transcription || transcription === '[áudio inaudível]') {
      return ok({
        success: false,
        // O motivo real vem junto: sem ele, provedor fora do ar chegava ao
        // usuário como "seu áudio está inaudível".
        error: reason
          ? `Não foi possível transcrever o áudio — ${reason}`
          : 'Não foi possível transcrever o áudio (inaudível ou vazio).',
        transcription: transcription || '',
      });
    }

    // 3) Limpeza opcional. Quem não pede a flag recebe exatamente o de antes.
    if (limpar) {
      const { texto, falhou } = await limparDitado(transcription, contexto);
      return ok({
        success: true,
        transcription: texto,
        transcription_raw: transcription,
        ...(falhou ? { limpeza_falhou: falhou } : {}),
      });
    }

    return ok({ success: true, transcription });
  } catch (e: any) {
    console.error('[transcribe-team-audio] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};
