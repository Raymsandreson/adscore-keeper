import type { RequestHandler } from 'express';
import * as nodeCrypto from 'crypto';
import { supabase as ext } from '../lib/supabase';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const WA_MEDIA_TYPE_INFO: Record<string, string> = {
  document: 'WhatsApp Document Keys',
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
};

function isEncryptedWhatsAppUrl(url?: string | null): boolean {
  if (typeof url !== 'string') return false;
  if (/\.enc(?:\?|$)/i.test(url)) return true;
  return /^https?:\/\/(?:[a-z0-9-]+\.)*whatsapp\.net\//i.test(url);
}

function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  const prk = nodeCrypto.createHmac('sha256', salt).update(ikm).digest();
  const blocks = Math.ceil(length / 32);
  let prev = Buffer.alloc(0);
  const out: Buffer[] = [];
  for (let i = 1; i <= blocks; i++) {
    prev = nodeCrypto.createHmac('sha256', prk).update(Buffer.concat([prev, info, Buffer.from([i])])).digest();
    out.push(prev);
  }
  return Buffer.concat(out).slice(0, length);
}

function decryptWhatsAppMedia(encBuf: Buffer, mediaKeyB64: string, messageType: string): Buffer {
  const info = WA_MEDIA_TYPE_INFO[messageType] || WA_MEDIA_TYPE_INFO.document;
  const mediaKey = Buffer.from(mediaKeyB64, 'base64');
  const expanded = hkdfSha256(mediaKey, Buffer.alloc(32), Buffer.from(info, 'utf8'), 112);
  const iv = expanded.slice(0, 16);
  const cipherKey = expanded.slice(16, 48);
  const ciphertext = encBuf.slice(0, encBuf.length - 10);
  const decipher = nodeCrypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function pickMediaKey(metadata: any): string | null {
  const content = metadata?.message?.content || {};
  const direct = content.mediaKey || content.media_key;
  return typeof direct === 'string' && direct.length >= 32 ? direct : null;
}

function normalizeContentType(contentType: string | null, messageType: string, bytes: Buffer): string {
  const current = contentType || 'application/octet-stream';
  if (current && current !== 'application/octet-stream' && !current.startsWith('text/')) return current;
  const sniff = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (messageType === 'audio') {
    if (sniff([0x49, 0x44, 0x33]) || sniff([0xff, 0xfb])) return 'audio/mpeg';
    if (sniff([0x66, 0x74, 0x79, 0x70], 4)) return 'audio/mp4';
    return 'audio/ogg';
  }
  if (messageType === 'image') {
    if (sniff([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
    if (sniff([0x52, 0x49, 0x46, 0x46]) && sniff([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    return 'image/jpeg';
  }
  if (messageType === 'video') return 'video/mp4';
  if (sniff([0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (sniff([0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  return current;
}

function extensionFor(contentType: string, messageType: string): string {
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('mpeg')) return 'mp3';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mp4')) return messageType === 'audio' ? 'm4a' : 'mp4';
  return messageType === 'audio' ? 'ogg' : messageType === 'image' ? 'jpg' : messageType === 'video' ? 'mp4' : 'bin';
}

async function verifyCloudJwt(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token || token === CLOUD_ANON_KEY) return false;
  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
    });
    if (!r.ok) return false;
    const user: any = await r.json().catch(() => null);
    return !!user?.id;
  } catch {
    return false;
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (body: Record<string, unknown>) => res.status(200).json(body);
  try {
    const authed = await verifyCloudJwt(req.headers.authorization as string | undefined);
    if (!authed) return ok({ success: false, error: 'Sessão inválida para sincronizar mídia.' });

    const rowId = String(req.body?.message_row_id || req.body?.message_id || '').trim();
    if (!rowId) return ok({ success: false, error: 'message_row_id é obrigatório.' });

    const { data: msg, error: msgErr } = await ext
      .from('whatsapp_messages')
      .select('id, external_message_id, instance_name, message_type, media_type, media_url, metadata, message_text')
      .eq('id', rowId)
      .maybeSingle();
    if (msgErr) return ok({ success: false, error: msgErr.message });
    if (!msg) return ok({ success: false, error: 'Mensagem não encontrada.' });

    if (msg.media_url && !isEncryptedWhatsAppUrl(msg.media_url)) {
      return ok({ success: true, already_synced: true, media_url: msg.media_url });
    }

    const { data: inst, error: instErr } = await ext
      .from('whatsapp_instances')
      .select('instance_name, instance_token, base_url')
      .ilike('instance_name', msg.instance_name || '')
      .limit(1)
      .maybeSingle();
    if (instErr) return ok({ success: false, error: instErr.message });
    if (!inst?.instance_token) return ok({ success: false, error: `Instância ${msg.instance_name || ''} sem token.` });

    const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
    const fullId = String(msg.external_message_id || msg.metadata?.message?.id || '').trim();
    const bareId = String(msg.metadata?.message?.messageid || (fullId.includes(':') ? fullId.split(':').pop() : fullId) || '').trim();
    const candidates = Array.from(new Set([bareId, fullId].filter(Boolean)));
    const mediaKey = pickMediaKey(msg.metadata);
    const messageType = msg.message_type || 'document';

    let bytes: Buffer | null = null;
    let contentType = msg.media_type || msg.metadata?.message?.content?.mimetype || 'application/octet-stream';
    let usedId: string | null = null;
    let transcription: string | null = null;

    for (const candidate of candidates) {
      const dl = await fetch(`${baseUrl}/message/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token: inst.instance_token },
        body: JSON.stringify({ id: candidate, return_link: true, return_base64: false, generate_mp3: true }),
      });
      const raw = await dl.text();
      if (!dl.ok) continue;
      let data: any = null;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (typeof data?.transcription === 'string' && data.transcription.trim()) transcription = data.transcription.trim();
      if (data?.mimetype) contentType = data.mimetype;
      if (typeof data?.base64Data === 'string' && data.base64Data) {
        bytes = Buffer.from(data.base64Data, 'base64');
        usedId = candidate;
        break;
      }
      const fileUrl = data?.fileURL || data?.url;
      if (typeof fileUrl === 'string' && fileUrl.startsWith('http')) {
        const fileResp = await fetch(fileUrl);
        if (!fileResp.ok) continue;
        const downloaded = Buffer.from(await fileResp.arrayBuffer());
        if (isEncryptedWhatsAppUrl(fileUrl)) {
          if (!mediaKey) continue;
          bytes = decryptWhatsAppMedia(downloaded, mediaKey, messageType);
        } else {
          bytes = downloaded;
        }
        contentType = data?.mimetype || fileResp.headers.get('content-type') || contentType;
        usedId = candidate;
        break;
      }
    }

    if (!bytes && msg.media_url && isEncryptedWhatsAppUrl(msg.media_url) && mediaKey) {
      const enc = await fetch(msg.media_url);
      if (enc.ok) {
        bytes = decryptWhatsAppMedia(Buffer.from(await enc.arrayBuffer()), mediaKey, messageType);
        usedId = 'local-media-key';
      }
    }

    if (!bytes || bytes.length < 50) {
      return ok({ success: false, error: 'A UazAPI não retornou arquivo legível para essa mensagem.' });
    }

    contentType = normalizeContentType(contentType, messageType, bytes);
    const extName = extensionFor(contentType, messageType);
    const safeInstance = String(inst.instance_name || msg.instance_name || 'unknown').replace(/\s+/g, '_');
    const filePath = `${safeInstance}/repair_${Date.now()}_${String(rowId).slice(0, 8)}.${extName}`;
    const { error: uploadErr } = await ext.storage
      .from('whatsapp-media')
      .upload(filePath, bytes, { contentType, upsert: true });
    if (uploadErr) return ok({ success: false, error: uploadErr.message });

    const { data: publicData } = ext.storage.from('whatsapp-media').getPublicUrl(filePath);
    const metadata = {
      ...(msg.metadata || {}),
      media_sync: { synced_at: new Date().toISOString(), source: 'message/download', id_used: usedId, content_type: contentType },
    };
    const updates: Record<string, unknown> = { media_url: publicData.publicUrl, media_type: contentType, metadata };
    if (messageType === 'audio' && transcription && !msg.message_text) updates.message_text = transcription;
    const { error: updateErr } = await ext.from('whatsapp_messages').update(updates).eq('id', rowId);
    if (updateErr) return ok({ success: false, error: updateErr.message });

    return ok({ success: true, media_url: publicData.publicUrl, media_type: contentType, id_used: usedId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return ok({ success: false, error: msg });
  }
};