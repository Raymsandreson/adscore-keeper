// =============================================================================
// O que, numa mensagem do WhatsApp, a IA da atividade consegue LER.
//
// A seleção de mensagens só mandava `message_text` pra IA. Mensagem que é só
// anexo — a intimação em PDF, o print do PJe, o áudio do cliente — chegava como
// nada, e a atividade nascia vazia justamente no caso em que o anexo ERA o
// assunto. Aqui a mensagem vira um descritor que o `chat-to-activity` sabe
// baixar e ler.
//
// Link entra como mídia também: a URL solta no texto é a "mídia" daquela
// mensagem, e o servidor busca a página (com trava de destino) pra IA saber do
// que se trata.
// =============================================================================

/** O que vai no `media[]` do `chat-to-activity`. */
export interface MidiaDaMensagem {
  message_id?: string | null;
  url: string;
  mime?: string | null;
  kind: 'image' | 'document' | 'audio' | 'video' | 'link';
  caption?: string | null;
  who?: string | null;
  when?: string | null;
}

/** Mensagem do WhatsApp, no mínimo que interessa aqui. */
export interface MensagemComMidia {
  id?: string;
  message_text?: string | null;
  message_type?: string | null;
  media_type?: string | null;
  media_url?: string | null;
}

/**
 * URL do WhatsApp que ainda está criptografada (`.enc`) não abre pra ninguém —
 * precisa do backfill de mídia antes. Mesma checagem que o chat já faz na tela.
 */
export const midiaCriptografada = (url: string | null | undefined): boolean =>
  !!url && /\.enc(\?|$)/i.test(url);

/** Tipo do anexo a partir do que o webhook gravou. */
function tipoDaMidia(msg: MensagemComMidia): MidiaDaMensagem['kind'] {
  const mime = (msg.media_type || '').toLowerCase();
  const tipo = (msg.message_type || '').toLowerCase();
  if (mime.startsWith('audio/') || tipo === 'audio' || tipo === 'ptt') return 'audio';
  if (mime.startsWith('video/') || tipo === 'video') return 'video';
  if (mime.startsWith('image/') || tipo === 'image' || tipo === 'sticker') return 'image';
  return 'document';
}

/** Acha URLs soltas no texto da mensagem. */
export function linksDoTexto(texto: string | null | undefined): string[] {
  const achados = String(texto || '').match(/https?:\/\/[^\s<>"')]+/gi) || [];
  // Pontuação de fim de frase gruda na URL ("veja em https://x.com/a." ).
  const limpos = achados.map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
  return Array.from(new Set(limpos)).slice(0, 3);
}

/**
 * Tudo que dá pra ler nesta mensagem: o anexo (quando há) e os links do texto.
 * Devolve lista vazia pra mensagem que é só texto sem link.
 */
export function midiasDaMensagem(
  msg: MensagemComMidia,
  rotulo: { who?: string | null; when?: string | null } = {}
): MidiaDaMensagem[] {
  const saida: MidiaDaMensagem[] = [];
  const base = { message_id: msg.id ?? null, who: rotulo.who ?? null, when: rotulo.when ?? null };

  if (msg.media_url && !midiaCriptografada(msg.media_url)) {
    const kind = tipoDaMidia(msg);
    // Áudio já chega transcrito em message_text pelo webhook; mandar o arquivo
    // de novo só gastaria uma transcrição. Sem transcrição, aí sim vai o áudio.
    const audioJaTranscrito = kind === 'audio' && !!(msg.message_text || '').trim();
    // Vídeo o Gemini não lê aqui; fica de fora em vez de virar erro no servidor.
    if (kind !== 'video' && !audioJaTranscrito) {
      saida.push({ ...base, url: msg.media_url, mime: msg.media_type || null, kind, caption: msg.message_text || null });
    }
  }

  for (const url of linksDoTexto(msg.message_text)) {
    saida.push({ ...base, url, kind: 'link', mime: null, caption: null });
  }

  return saida;
}

/** Rótulo do anexo pra linha da conversa que a IA lê ("[PDF] intimação.pdf"). */
export function rotuloDaMidia(msg: MensagemComMidia): string {
  const kind = tipoDaMidia(msg);
  if (!msg.media_url) return '';
  if (midiaCriptografada(msg.media_url)) return '[anexo ainda não baixado]';
  const nome = decodeURIComponent((msg.media_url.split('/').pop() || '').split('?')[0]);
  const tipo = kind === 'image' ? 'imagem' : kind === 'audio' ? 'áudio' : kind === 'video' ? 'vídeo' : 'documento';
  return `[${tipo}${nome ? `: ${nome}` : ''}]`;
}
