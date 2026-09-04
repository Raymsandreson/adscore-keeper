// ============================================================================
// Áudio da mensagem do INSS: catálogo, geração e entrega.
//
// A decisão de QUE assunto o despacho trata mora em `inss-audio-categoria`, que
// é puro e testado. Aqui fica só o que fala com o mundo: banco, ElevenLabs,
// storage e UazAPI.
// ============================================================================

import { createHash } from 'crypto';
import { supabase } from './supabase';
import type { TipoMensagemCliente } from './inss-mensagem-cliente';
import { enviarAudioAoGrupo } from './inss-zap';
import {
  categoriaDoAudio,
  chaveDoAudio,
  ROTEIROS,
  textoParaFala,
} from './inss-audio-categoria';

export * from './inss-audio-categoria';

export interface AudioDaMensagem {
  url: string;
  /** 'gravado' = voz da equipe; 'tts_catalogo' = gerado antes e reaproveitado;
   *  'tts_texto' = gerado agora lendo a mensagem que foi enviada. */
  origem: 'gravado' | 'tts_catalogo' | 'tts_texto';
  chave: string;
}

const BUCKET = 'whatsapp-media';
const PASTA_TTS = 'inss-audio/tts';

/** Voz do robô do INSS. Trocar = setar INSS_AUDIO_VOICE_ID no Railway. */
const VOICE_ID = process.env.INSS_AUDIO_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5';
const MODEL_ID = process.env.INSS_AUDIO_MODEL || 'eleven_multilingual_v2';

/**
 * Ritmo da fala. O resto do projeto narra a 1.05–1.1 porque é locução de telão
 * e de agente de vendas; aviso de INSS é o oposto — quem ouve é cliente idoso,
 * muitas vezes uma vez só, e precisa entender o que tem que providenciar.
 * Abaixo de 1.0 a ElevenLabs abre a pausa entre as palavras.
 *
 * 1.0 escolhido de ouvido em 04/09/2026, comparando 1.0, 0.9 e 0.8 do mesmo
 * texto na mesma voz. Fica explícito em vez de omitido porque a omissão foi o
 * que confundiu: o preview usado para julgar a voz rodava a 1.1, mais rápido do
 * que a produção jamais gerou.
 *
 * Faixa aceita pela API: 0.7 a 1.2.
 */
const SPEED = Math.min(1.2, Math.max(0.7, Number(process.env.INSS_AUDIO_SPEED || 1.0)));


/**
 * Busca no catálogo o áudio daquela chave. O catálogo guarda tanto o que a
 * equipe gravou quanto o que já foi gerado por TTS — é ele que evita pagar
 * geração nova para o mesmo assunto.
 */
async function doCatalogo(chave: string): Promise<AudioDaMensagem | null> {
  const { data, error } = await supabase
    .from('inss_audio_mensagens')
    .select('audio_url, origem, voice_id')
    .eq('chave', chave)
    .eq('ativo', true)
    .maybeSingle();
  if (error) {
    console.warn(`[inss-audio] catálogo indisponível (${chave}): ${error.message}`);
    return null;
  }
  if (!data?.audio_url) return null;

  // Gravado é voz humana: vale sempre. Já o que foi gerado por TTS envelhece
  // quando a voz muda -- e como `chave` é UNIQUE, a linha velha seria servida
  // para sempre sem ninguém perceber. Divergiu da voz atual, conta como
  // ausente: o chamador regera e regrava por cima.
  const gerado = (data as any).voice_id as string | null;
  if (data.origem !== 'gravado' && gerado !== VOICE_ID) {
    console.log(`[inss-audio] ${chave} foi gerado na voz ${gerado || '(desconhecida)'}, agora é ${VOICE_ID} — regerando`);
    return null;
  }

  return {
    url: data.audio_url,
    origem: data.origem === 'gravado' ? 'gravado' : 'tts_catalogo',
    chave,
  };
}

/**
 * Gera o mp3 no ElevenLabs e grava no storage.
 *
 * O nome do arquivo é o hash de (modelo, voz, texto): texto idêntico nunca
 * gera duas vezes, nem entre execuções diferentes. Mesmo padrão do
 * `telao-narrar`, que roda assim desde agosto.
 */
export async function gerarTts(
  texto: string,
  opts: { voiceId?: string; speed?: number } = {},
): Promise<{ url: string } | { erro: string }> {
  const key = process.env.ELEVENLABS_API_KEY || '';
  if (!key) return { erro: 'sem ELEVENLABS_API_KEY' };
  const fala = textoParaFala(texto);
  if (fala.length < 10) return { erro: 'texto curto demais para narrar' };

  const voz = opts.voiceId || VOICE_ID;
  const speed = opts.speed ?? SPEED;

  // Voz e ritmo entram no hash: trocar qualquer um dos dois gera arquivo novo em
  // vez de servir o antigo calado.
  const hash = createHash('sha1').update(`${MODEL_ID}|${voz}|${speed}|${fala}`).digest('hex').slice(0, 24);
  const caminho = `${PASTA_TTS}/${hash}.mp3`;
  const publica = () =>
    supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;

  // Já gerado antes? O storage é o cache.
  const { data: existe } = await supabase.storage
    .from(BUCKET)
    .list(PASTA_TTS, { search: `${hash}.mp3`, limit: 1 });
  if (existe && existe.length > 0) return { url: publica() };

  if (!dentroDoTeto()) return { erro: `teto de ${MAX_GERACOES_HORA} gerações/hora atingido` };
  geracoesNaJanela++;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: fala,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
      }),
    },
  );
  if (!res.ok) {
    // O corpo é onde a ElevenLabs diz o motivo real — o status mente (chave
    // inválida devolve 400, não 401). Ver a lib elevenlabs-utils.
    const corpo = await res.text().catch(() => '');
    return { erro: `elevenlabs_${res.status}: ${corpo.slice(0, 200)}` };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, bytes, { contentType: 'audio/mpeg', upsert: true });
  if (error) return { erro: `storage: ${error.message}` };
  return { url: publica() };
}

/**
 * O áudio que vai junto da mensagem.
 *
 *  1. gravado/guardado para o assunto exato;
 *  2. roteiro fixo da categoria, gerado uma vez e guardado no catálogo;
 *  3. o texto da mensagem, lido na hora.
 *
 * Devolve `null` quando o áudio está desligado ou quando nada pôde ser gerado —
 * e aí o texto vai sozinho, como sempre foi. Áudio é acréscimo: falha dele
 * nunca derruba o aviso.
 */
/**
 * Chave de desligamento. LIGADO por padrão desde 04/09/2026 — a migration do
 * catálogo já está aplicada no Externo e os áudios gravados estão no bucket.
 *
 * Para desligar sem redeploy: `INSS_AUDIO_ENVIAR=0` no Railway. Com a chave em
 * '0' nenhum áudio é gerado nem enviado, e nenhuma coluna `zap_audio_*` é
 * escrita — um UPDATE citando coluna inexistente é recusado inteiro pelo
 * PostgREST e derrubaria junto o `zap_status`, que é o que não pode falhar.
 */
export function audioLigado(): boolean {
  return process.env.INSS_AUDIO_ENVIAR !== '0';
}

// Teto de gerações NOVAS por hora, para o caso de uma enxurrada de e-mails do
// INSS (ou um backfill acidental) virar fatura. Áudio do catálogo não conta —
// ele já está gerado. Estado em memória: o Railway roda um processo só, mesmo
// desenho do `telao-narrar`.
const MAX_GERACOES_HORA = Number(process.env.INSS_AUDIO_MAX_HORA || 40);
let janelaInicio = Date.now();
let geracoesNaJanela = 0;

function dentroDoTeto(): boolean {
  const agora = Date.now();
  if (agora - janelaInicio > 3_600_000) {
    janelaInicio = agora;
    geracoesNaJanela = 0;
  }
  return geracoesNaJanela < MAX_GERACOES_HORA;
}

export async function resolverAudioDaMensagem(args: {
  tipo: TipoMensagemCliente;
  fonte?: string | null;
  texto: string;
}): Promise<AudioDaMensagem | null> {
  if (!audioLigado()) return null;

  const categoria = categoriaDoAudio(args.fonte);
  const chave = chaveDoAudio(args.tipo, categoria);

  const guardado = await doCatalogo(chave);
  if (guardado) return guardado;

  // Categoria reconhecida e sem áudio ainda: gera o roteiro genérico UMA vez e
  // guarda no catálogo, para o próximo cliente do mesmo assunto não gastar
  // geração nova. O roteiro é fixo e não carrega dado de ninguém — é por isso
  // que ele pode ser reaproveitado; a mensagem individual, não.
  const roteiro = ROTEIROS[chave];
  if (roteiro) {
    const gerado = await gerarTts(roteiro);
    if ('url' in gerado) {
      // upsert, não insert: `chave` é UNIQUE e a linha pode já existir de uma
      // voz anterior. Sem isto a regravação bateria em 23505 e o áudio velho
      // ficaria no lugar.
      const { error } = await supabase.from('inss_audio_mensagens').upsert(
        {
          chave,
          audio_url: gerado.url,
          texto_falado: roteiro,
          origem: 'tts',
          voice_id: VOICE_ID,
          ativo: true,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: 'chave' },
      );
      if (error) console.warn(`[inss-audio] não guardei ${chave} no catálogo: ${error.message}`);
      return { url: gerado.url, origem: 'tts_catalogo', chave };
    }
    console.warn(`[inss-audio] TTS do roteiro ${chave} falhou: ${gerado.erro}`);
  }

  // Sem roteiro (assunto novo ou despacho misturando vários pedidos): lê o
  // texto que o cliente acabou de receber. Sempre casa com a mensagem, porque
  // É a mensagem.
  const lido = await gerarTts(args.texto);
  if ('url' in lido) return { url: lido.url, origem: 'tts_texto', chave };
  console.warn(`[inss-audio] TTS do texto falhou: ${lido.erro}`);
  return null;
}

/**
 * Resolve o áudio e entrega no grupo, devolvendo o patch para
 * `inss_status_history`. Usado pelo `notify-inss-update` (envio na hora) e pelo
 * `dispatch-inss-zap` (fila da janela de 8h–20h), para que os dois caminhos
 * mandem exatamente o mesmo áudio.
 *
 * Nunca lança: áudio é acréscimo ao aviso, e o texto já está no grupo quando
 * esta função roda. O que der errado vira `zap_audio_status` para quem for
 * auditar depois.
 */
export async function mandarAudioDaMensagem(args: {
  tipo: TipoMensagemCliente;
  fonte?: string | null;
  texto: string;
  group_jid: string;
  instancia?: string | null;
}): Promise<Record<string, any>> {
  if (!audioLigado()) return {};
  try {
    const audio = await resolverAudioDaMensagem({
      tipo: args.tipo,
      fonte: args.fonte,
      texto: args.texto,
    });
    if (!audio) return { zap_audio_status: 'sem_audio' };

    const env = await enviarAudioAoGrupo({
      group_jid: args.group_jid,
      file_url: audio.url,
      instance_name: args.instancia,
    });
    if (!env.ok) {
      console.warn(`[inss-audio] áudio não foi ao grupo: ${JSON.stringify(env.body).slice(0, 200)}`);
      return { zap_audio_status: `erro:${env.status}`, zap_audio_url: audio.url };
    }
    return { zap_audio_status: audio.origem, zap_audio_url: audio.url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[inss-audio] falha inesperada no áudio:', msg);
    return { zap_audio_status: 'erro' };
  }
}
