/**
 * Configuração de captura para NOTA DE VOZ (áudio que vai pro WhatsApp).
 *
 * `getUserMedia({ audio: true })` liga por padrão o DSP de telefonia do navegador
 * (noiseSuppression + echoCancellation + autoGainControl). Esse processamento é
 * feito pra CHAMADA, não pra nota de voz: ele corta os agudos, abafa a voz e
 * altera o ruído de fundo — o que dava a sensação de "chiado + voz sem definição".
 * Como ele descarta a informação já na captura, nenhum filtro posterior recupera.
 *
 * Gravamos CRU (DSP desligado) e em bitrate alto; quem gera o opus final é a
 * UazAPI (então o iPhone continua abrindo — ver whatsappVoiceSend.ts). Validado
 * por teste A/B de ouvido em 22/07/2026: cru soou nitidamente mais definido que
 * o `{ audio: true }` atual.
 *
 * Obs.: `sampleRate`/`channelCount` são dicas (ideais), não exigências — se o
 * dispositivo não suportar, o navegador escolhe outro valor em vez de falhar.
 * NÃO use isto no gravador de LIGAÇÃO ao vivo: lá o echoCancellation evita eco.
 */
export const VOICE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 48000,
};

/** Bitrate de gravação da nota de voz. Opus de voz já é transparente em 128k. */
export const VOICE_RECORDER_BITRATE = 128000;
