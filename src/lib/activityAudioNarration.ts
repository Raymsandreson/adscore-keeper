/**
 * Narração em áudio da mensagem de conclusão ("Concluir + próxima").
 *
 * Vivia dentro do `CompleteAndNotifyDialog`, onde só o clique em "Concluir e
 * Notificar" conseguia chamar. Saiu de lá quando o áudio passou a vir marcado
 * por padrão: com o envio automático, quem aperta precisa poder OUVIR antes o
 * que o cliente vai ouvir — e prévia e envio têm que percorrer exatamente o
 * mesmo caminho, senão a prévia vira promessa e não evidência.
 *
 * São dois passos, e eles falham por motivos diferentes:
 *  1. `gerarTextoNarracao` — a IA reescreve a mensagem em fala curta. Se falhar,
 *     cai no texto original (`resumido: false`) em vez de deixar o cliente sem
 *     áudio nenhum;
 *  2. `gerarAudioNarracao` — o ElevenLabs converte em MP3 com a voz de QUEM
 *     apertou (o `elevenlabs-tts` resolve a voz pelo usuário autenticado, em
 *     `voice_preferences`). Aqui não há fallback silencioso: sem áudio, quem
 *     chamou avisa.
 */
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface AudioTone {
  key: string;
  label: string;
  prompt: string;
}

export const AUDIO_TONES: AudioTone[] = [
  { key: 'humanized', label: '🤝 Humanizado', prompt: 'Explique de forma natural e humana, como se estivesse conversando pessoalmente. Seja caloroso e acessível.' },
  { key: 'casual', label: '😎 Descontraído', prompt: 'Explique de forma leve e descontraída, como uma conversa informal entre amigos. Use linguagem coloquial.' },
  { key: 'formal', label: '👔 Formal', prompt: 'Explique de forma profissional e formal, mantendo clareza e objetividade.' },
  { key: 'empathetic', label: '💛 Empático', prompt: 'Explique com empatia e cuidado, mostrando que se importa com o cliente. Seja acolhedor.' },
  { key: 'concise', label: '⚡ Conciso', prompt: 'Explique de forma breve e direta, indo direto ao ponto sem rodeios.' },
  { key: 'friendly', label: '😊 Amigável', prompt: 'Explique de forma amigável e simpática, com tom positivo e encorajador.' },
  { key: 'custom', label: '💬 Personalizado', prompt: '' },
];

export function promptDoTom(tone: string, customPrompt: string): string {
  if (tone === 'custom' && customPrompt.trim()) return customPrompt.trim();
  return AUDIO_TONES.find(t => t.key === tone)?.prompt || '';
}

export interface TextoNarracao {
  texto: string;
  /** `false` = a IA falhou e o áudio vai ler a mensagem escrita, sem resumir. */
  resumido: boolean;
}

/**
 * Reescreve a mensagem da atividade como fala curta para o cliente.
 *
 * O pedido à IA é o de sempre: EXPLICAR o que aconteceu, não ler a mensagem —
 * "trocando em miúdos", porque boa parte dos clientes não lê o texto.
 */
export async function gerarTextoNarracao(
  message: string,
  tone: string,
  customPrompt = '',
): Promise<TextoNarracao> {
  const limpo = (message || '').trim();
  if (!limpo) return { texto: '', resumido: false };

  try {
    const { data } = await cloudFunctions.invoke('ai-text-editor', {
      body: {
        action: 'custom',
        text: limpo,
        custom_prompt: `Você é o dono desta instância de WhatsApp. Gere APENAS o texto que será convertido em áudio para enviar ao grupo do cliente. NÃO leia o texto literal da mensagem escrita. Em vez disso, EXPLIQUE de forma natural o conteúdo/atualização da atividade como se estivesse falando ao vivo para o cliente. ${promptDoTom(tone, customPrompt)}. O texto deve ser curto (máximo 3 frases) e soar como fala natural. Não use emojis, asteriscos ou formatação. Comece direto sem saudação genérica.`,
      },
    });
    const texto = ((data as { result?: string } | null)?.result || '').trim();
    if (texto) return { texto, resumido: true };
  } catch {
    /* cai no fallback abaixo */
  }

  return { texto: limpo, resumido: false };
}

export interface AudioNarracao {
  audioUrl: string;
  /** Voz que o `elevenlabs-tts` de fato usou. Ausente nas versões antigas da função. */
  voiceName?: string;
  voiceType?: string;
}

/**
 * Converte o texto em MP3 com a voz de quem está autenticado e devolve a URL
 * pública — a mesma que vai ao grupo. Lança com o motivo quando não sai áudio.
 */
export async function gerarAudioNarracao(texto: string): Promise<AudioNarracao> {
  const limpo = (texto || '').trim();
  if (!limpo) throw new Error('o texto da narração ficou vazio');

  const { data, error } = await cloudFunctions.invoke('elevenlabs-tts', {
    body: { text: limpo },
  });

  const resposta = data as { audio_url?: string; error?: string; voice_name?: string; voice_type?: string } | null;
  const audioUrl = resposta?.audio_url;
  if (error || !audioUrl) {
    const motivo =
      resposta?.error ||
      (error instanceof Error ? error.message : null) ||
      'a geração de voz não devolveu áudio';
    console.error('[activityAudioNarration] TTS falhou:', error || data);
    throw new Error(motivo);
  }

  return { audioUrl, voiceName: resposta?.voice_name, voiceType: resposta?.voice_type };
}
