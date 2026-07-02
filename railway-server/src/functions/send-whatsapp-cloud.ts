/**
 * send-whatsapp-cloud — envio outbound via WhatsApp Business Cloud API (Meta oficial).
 *
 * Recebe payload do proxy local (supabase/functions/send-whatsapp) quando o canal
 * for `cloud_gerencia`. v1 só suporta `text`. Mídia/template ficam pra v2.
 *
 * Fluxo:
 *  1. Valida WHATSAPP_CLOUD_TOKEN + body (phone, message).
 *  2. Busca phone_number_id do registro ativo em whatsapp_cloud_config.
 *  3. POST Graph API v21.0/{phone_number_id}/messages.
 *  4. Trata erros conhecidos (token, janela 24h, recipient).
 *  5. INSERT outbound em whatsapp_messages com instance_name='cloud_gerencia'.
 *  6. Responde {success, message_id, external_message_id, instance_name}.
 */

import { RequestHandler } from 'express';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { supabase } from '../lib/supabase';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';
const INSTANCE_NAME = 'cloud_gerencia';

// Mimes que a WhatsApp Cloud API aceita pra áudio. Qualquer coisa fora dessa
// lista (ex: audio/webm gravado pelo Chrome) é aceito pelo Graph mas NÃO entrega
// — message_id volta válido e a mensagem some no meio do caminho.
const META_AUDIO_MIMES = new Set([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/amr',
  'audio/ogg',
]);

function normalizeAudioMime(mime: string | undefined): string {
  return (mime || '').toLowerCase().split(';')[0].trim();
}

/**
 * Baixa o áudio, transcodifica pra audio/ogg;codecs=opus (mono 48k 32kbps) usando
 * o ffmpeg estático embarcado, sobe pro bucket whatsapp-media e retorna a nova URL
 * pública + mime correto. Se qualquer passo falhar, devolve null e o caller envia
 * o original (entrega vai falhar, mas pelo menos não trava o fluxo).
 */
async function transcodeAudioToOpus(
  srcUrl: string,
  rid: string,
): Promise<{ url: string; mime: string } | null> {
  if (!ffmpegPath) {
    console.error(`[send-cloud ${rid}] ffmpeg-static não disponível`);
    return null;
  }
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(tmpdir(), `audio-in-${stamp}.bin`);
  const outPath = path.join(tmpdir(), `audio-out-${stamp}.ogg`);
  try {
    const resp = await fetch(srcUrl);
    if (!resp.ok) {
      console.error(`[send-cloud ${rid}] download áudio falhou: ${resp.status}`);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(inPath, buf);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-y',
        '-i', inPath,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '32k',
        '-ac', '1',
        '-ar', '48000',
        '-f', 'ogg',
        outPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
      });
    });

    const outBytes = await fs.readFile(outPath);
    const storagePath = `outbound/audio-opus-${stamp}.ogg`;
    const { error: upErr } = await supabase.storage
      .from('whatsapp-media')
      .upload(storagePath, outBytes, { contentType: 'audio/ogg', upsert: false, cacheControl: '31536000' });
    if (upErr) {
      console.error(`[send-cloud ${rid}] upload transcoded falhou:`, upErr);
      return null;
    }
    const { data: pub } = supabase.storage.from('whatsapp-media').getPublicUrl(storagePath);
    if (!pub?.publicUrl) return null;
    console.log(`[send-cloud ${rid}] áudio transcodificado ${buf.length}B → ${outBytes.length}B`);
    return { url: pub.publicUrl, mime: 'audio/ogg' };
  } catch (err) {
    console.error(`[send-cloud ${rid}] transcode exceção:`, err);
    return null;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}



interface SendBody {
  action?: string;
  phone?: string;
  message?: string;
  contact_id?: string | null;
  lead_id?: string | null;
  // Media (Cloud API)
  media_url?: string;
  media_type?: string; // MIME (image/png, audio/ogg, application/pdf, ...)
  caption?: string;
  file_name?: string;
}

function mediaKindFromMime(mime: string | undefined): 'image' | 'audio' | 'video' | 'document' {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'document';
}

function normalizePhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  // Mobile BR sem o 9 (12 díg, 55+DDD+8d, primeiro díg do assinante >= 6).
  // Meta exige E.164 atual (com 9) no envio, mesmo que o wa_id histórico
  // que chega no webhook não tenha. Fixos (assinante 2-5) não levam 9.
  if (d.length === 12 && d.startsWith('55') && d[4] >= '6') {
    return d.slice(0, 4) + '9' + d.slice(4);
  }
  return d;
}

// Chave de thread/armazenamento: wa_id histórico (BR mobile SEM o 9), idêntico ao que o
// whatsapp-cloud-webhook grava na ingestão. O outbound DEVE gravar nesse mesmo formato pra
// cair na MESMA conversa do inbound — senão o 9 injetado pra entrega cria uma thread duplicada.
function toThreadPhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    return d.slice(0, 4) + d.slice(5);
  }
  return d;
}

function mapGraphError(code: number | undefined, subcode: number | undefined): string {
  if (code === 190) return 'INVALID_TOKEN';
  if (code === 131047 || subcode === 2018278) return 'OUTSIDE_24H_WINDOW';
  if (code === 131026) return 'RECIPIENT_REFUSED';
  if (code === 131056) return 'RECIPIENT_NOT_VERIFIED';
  if (code === 100) return 'INVALID_PARAMETER';
  return 'GRAPH_ERROR';
}

export const handler: RequestHandler = async (req, res) => {
  const rid = (req.headers['x-request-id'] as string) || 'no-rid';

  if (!TOKEN) {
    console.error(`[send-cloud ${rid}] WHATSAPP_CLOUD_TOKEN ausente no Railway`);
    res.status(500).json({
      success: false,
      error: 'WHATSAPP_CLOUD_TOKEN não configurado no Railway',
      error_code: 'MISSING_TOKEN',
    });
    return;
  }

  const body: SendBody = req.body || {};
  const isMedia = body.action === 'send_media' || !!body.media_url;
  const sendPhone = normalizePhone(body.phone || ''); // E.164 com o 9 — entrega via Graph
  const phone = toThreadPhone(body.phone || '');      // SEM o 9 — chave de thread do webhook
  const text = (body.message || '').trim();
  const caption = (body.caption || '').trim();

  if (!phone) {
    res.status(400).json({ success: false, error: 'phone obrigatório', error_code: 'MISSING_PHONE' });
    return;
  }
  if (!isMedia && !text) {
    res.status(400).json({ success: false, error: 'message obrigatório', error_code: 'MISSING_MESSAGE' });
    return;
  }
  if (isMedia && !body.media_url) {
    res.status(400).json({ success: false, error: 'media_url obrigatório', error_code: 'MISSING_MEDIA_URL' });
    return;
  }

  // Lookup do phone_number_id ativo
  const { data: cfg, error: cfgErr } = await supabase
    .from('whatsapp_cloud_config')
    .select('phone_number_id')
    .eq('is_active', true)
    .maybeSingle();

  if (cfgErr) {
    console.error(`[send-cloud ${rid}] erro lendo whatsapp_cloud_config:`, cfgErr);
    res.status(500).json({ success: false, error: 'Falha lendo config Cloud', error_code: 'CONFIG_READ_ERROR' });
    return;
  }

  const phoneNumberId = (cfg as any)?.phone_number_id;
  if (!phoneNumberId) {
    console.error(`[send-cloud ${rid}] whatsapp_cloud_config sem registro ativo`);
    res.status(412).json({
      success: false,
      error: 'Cloud API não configurada — salve phone_number_id pela tela WhatsApp Cloud',
      error_code: 'NO_PHONE_NUMBER_ID',
    });
    return;
  }

  // Monta payload Graph API.
  // Para mídia usamos `link` (Meta baixa do nosso Supabase Storage) — evita upload prévio.
  // Requisitos: URL pública HTTPS, content-type correto, dentro dos limites Meta
  // (image ≤5MB, audio ≤16MB, video ≤16MB, document ≤100MB).
  let payload: Record<string, unknown>;
  let mediaKind: 'image' | 'audio' | 'video' | 'document' | null = null;
  let dbMessageType = 'text';
  if (isMedia) {
    mediaKind = mediaKindFromMime(body.media_type);
    dbMessageType = mediaKind;
    let link = String(body.media_url);

    // Áudio em mime que a Meta não entrega (ex: audio/webm do Chrome) → transcodifica
    // pra ogg/opus mono. Reescreve body.media_url/media_type pro INSERT lá embaixo
    // refletir o asset que de fato foi entregue.
    if (mediaKind === 'audio') {
      const normalized = normalizeAudioMime(body.media_type);
      if (!META_AUDIO_MIMES.has(normalized)) {
        console.log(`[send-cloud ${rid}] áudio em mime incompatível (${normalized || 'desconhecido'}) → transcodificando`);
        const transcoded = await transcodeAudioToOpus(link, rid);
        if (transcoded) {
          link = transcoded.url;
          body.media_url = transcoded.url;
          body.media_type = transcoded.mime;
        } else {
          console.warn(`[send-cloud ${rid}] transcode falhou — enviando original (provável falha de entrega)`);
        }
      }
    }

    const mediaPayload: Record<string, unknown> = { link };
    // Audio NÃO aceita caption nem filename na Cloud API.
    if (mediaKind !== 'audio' && caption) mediaPayload.caption = caption;
    if (mediaKind === 'document') {
      mediaPayload.filename = body.file_name || link.split('/').pop()?.split('?')[0] || 'arquivo';
    }
    payload = {
      messaging_product: 'whatsapp',
      to: sendPhone,
      type: mediaKind,
      [mediaKind]: mediaPayload,
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: sendPhone,
      type: 'text',
      text: { preview_url: false, body: text },
    };
  }

  const url = `${GRAPH}/${API_VERSION}/${phoneNumberId}/messages`;
  console.log(`[send-cloud ${rid}] → Graph to=***${phone.slice(-4)} type=${isMedia ? mediaKind : 'text'} pnid=${phoneNumberId}`);

  let httpStatus = 0;
  let graphResp: any = null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    httpStatus = resp.status;
    graphResp = await resp.json();
  } catch (err) {
    console.error(`[send-cloud ${rid}] fetch falhou:`, err);
    res.status(502).json({ success: false, error: 'Graph API indisponível', error_code: 'GRAPH_UNREACHABLE' });
    return;
  }

  const externalId: string | null = graphResp?.messages?.[0]?.id || null;

  if (httpStatus >= 400 || !externalId) {
    const code = graphResp?.error?.code;
    const subcode = graphResp?.error?.error_subcode;
    const msg = graphResp?.error?.message || `HTTP ${httpStatus}`;
    const mappedCode = mapGraphError(code, subcode);
    console.error(`[send-cloud ${rid}] Graph erro http=${httpStatus} code=${code} sub=${subcode} mapped=${mappedCode}: ${msg}`);
    res.status(httpStatus || 502).json({
      success: false,
      error: msg,
      error_code: mappedCode,
      graph_code: code,
      graph_subcode: subcode,
    });
    return;
  }

  // INSERT outbound em whatsapp_messages
  let dbId: string | null = null;
  try {
    const { data: inserted, error: insErr } = await supabase
      .from('whatsapp_messages')
      .insert({
        phone,
        instance_name: INSTANCE_NAME,
        message_text: isMedia ? (caption || null) : text,
        message_type: dbMessageType,
        direction: 'outbound',
        status: 'sent',
        external_message_id: externalId,
        contact_id: body.contact_id || null,
        lead_id: body.lead_id || null,
        action_source: 'cloud_api',
        action_source_detail: 'outbound',
        media_url: isMedia ? body.media_url : null,
        media_type: isMedia ? (body.media_type || null) : null,
      } as any)
      .select('id')
      .single();
    if (insErr) {
      console.error(`[send-cloud ${rid}] insert falhou (msg JÁ foi enviada via Graph):`, insErr);
    } else {
      dbId = (inserted as any)?.id || null;
    }
  } catch (err) {
    console.error(`[send-cloud ${rid}] insert exceção (msg JÁ foi enviada via Graph):`, err);
  }

  console.log(`[send-cloud ${rid}] OK wamid=...${externalId.slice(-12)} db=${dbId || 'fail'}`);
  res.status(200).json({
    success: true,
    message_id: dbId,
    external_message_id: externalId,
    instance_name: INSTANCE_NAME,
  });
};
