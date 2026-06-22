/**
 * WhatsApp Webhook handler — ported from supabase/functions/whatsapp-webhook/index.ts
 * Runs on Node.js/Express instead of Deno edge functions.
 *
 * All Deno.env.get('X') → process.env.X
 * All Deno.serve → express RequestHandler
 * All esm.sh imports → npm imports
 */

import { createClient } from '@supabase/supabase-js';
import { RequestHandler } from 'express';
import * as nodeCrypto from 'crypto';
import { geminiChat } from '../lib/gemini';
import { getLocationFromDDD } from '../lib/ddd-mapping';
import { transcribeAudio } from '../lib/stt';
import { verifyAgentLabelBeforeSend } from '../lib/verify-agent-label';

// ============================================================
// Proactive first message — disparado quando o agente é ativado
// via etiqueta. Gera a 1ª mensagem com a IA e envia pelo UazAPI
// sem esperar o cliente abrir a conversa.
// Idempotente por (phone, instance_name, agent_id).
// ============================================================
async function triggerProactiveFirstMessage(
  supabase: any,
  phone: string,
  instanceName: string,
  agentId: string,
): Promise<void> {
  try {
    if (!agentId || !phone || !instanceName) return;

    const { data: agent } = await supabase
      .from('wjia_command_shortcuts')
      .select('id, shortcut_name, base_prompt, prompt_instructions, proactive_first_message_enabled, proactive_first_message_instruction')
      .eq('id', agentId)
      .maybeSingle();

    if (!agent || !(agent as any).proactive_first_message_enabled) return;

    // Idempotência: já mandou pra esse phone+instance+agent? não repete.
    const { data: prior } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('phone', phone)
      .ilike('instance_name', instanceName)
      .eq('action_source', 'proactive_first_message')
      .eq('action_source_detail', String(agentId))
      .limit(1)
      .maybeSingle();
    if (prior) {
      console.log('[proactive] já disparado antes, skip', { phone, instanceName, agentId });
      return;
    }

    // Credenciais da instância
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .ilike('instance_name', instanceName)
      .limit(1)
      .maybeSingle();
    const token = (inst as any)?.instance_token;
    const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
    if (!token) {
      console.warn('[proactive] instância sem token, abortando', { instanceName });
      return;
    }

    // Monta prompt
    const basePrompt = (agent as any).base_prompt || '';
    const extra = (agent as any).prompt_instructions || '';
    const proactiveExtra = (agent as any).proactive_first_message_instruction || '';

    // Puxa últimas 30 mensagens da conversa pra dar contexto à IA.
    // Sem isso, o agente fala como telemarketing ("oi tudo bem, passando pra saber...").
    let historyBlock = '';
    let lastContactName: string | null = null;
    try {
      const { data: history } = await supabase
        .from('whatsapp_messages')
        .select('created_at, direction, message_text, contact_name, message_type')
        .eq('phone', phone)
        .ilike('instance_name', instanceName)
        .order('created_at', { ascending: false })
        .limit(30);
      if (Array.isArray(history) && history.length) {
        const ordered = [...history].reverse();
        lastContactName = (ordered.find((m: any) => m.contact_name)?.contact_name) || null;
        const lines = ordered
          .map((m: any) => {
            const who = m.direction === 'inbound' ? 'CLIENTE' : 'ATENDENTE';
            const txt = (m.message_text && String(m.message_text).trim())
              || (m.message_type && m.message_type !== 'text' ? `[${m.message_type}]` : '');
            if (!txt) return '';
            return `${who}: ${txt.replace(/\s+/g, ' ').slice(0, 400)}`;
          })
          .filter(Boolean)
          .join('\n');
        if (lines) historyBlock = `--- HISTÓRICO RECENTE DA CONVERSA (mais antiga → mais recente) ---\n${lines}`;
      }
    } catch (e: any) {
      console.warn('[proactive] falha lendo histórico (segue sem):', e?.message);
    }

    const hasHistory = !!historyBlock;
    const system = [
      basePrompt,
      extra,
      historyBlock,
      '--- DISPARO PROATIVO ---',
      hasHistory
        ? 'Você está RETOMANDO uma conversa que já existe acima. Leia o histórico e escreva UMA mensagem curta, humana, no tom do agente, que continue de onde parou — referenciando o último assunto/contexto real. NUNCA escreva saudações genéricas tipo "Olá, tudo bem? Passando pra saber..." — isso soa telemarketing e está PROIBIDO. Se houver pendência clara, pergunte sobre ela. Se a última mensagem foi sua, dê seguimento natural.'
        : 'Esta é a PRIMEIRA mensagem que o cliente vai receber. Ele ainda não escreveu nada. Inicie a conversa de forma natural, curta e humana, no tom do agente.',
      lastContactName ? `Nome do contato: ${lastContactName}` : '',
      proactiveExtra ? `Instrução extra do operador: ${proactiveExtra}` : '',
    ].filter(Boolean).join('\n\n');

    let aiText = '';
    try {
      const aiResp = await geminiChat({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: hasHistory
              ? 'Gere agora a próxima mensagem para retomar a conversa, levando em conta o histórico acima.'
              : 'Gere agora a primeira mensagem para iniciar a conversa.' },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });
      aiText = String(aiResp?.choices?.[0]?.message?.content || '').trim();
    } catch (e: any) {
      console.error('[proactive] erro na IA:', e?.message);
      return;
    }
    if (!aiText) {
      console.warn('[proactive] IA retornou vazio, abortando');
      return;
    }

    // Envia via UazAPI
    let externalId: string | null = null;
    try {
      const sendResp = await fetch(`${String(baseUrl).replace(/\/$/, '')}/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ number: phone, text: aiText }),
      });
      const sendJson: any = await sendResp.json().catch(() => null);
      externalId = sendJson?.id || sendJson?.messageId || sendJson?.key?.id || null;
      if (!sendResp.ok) {
        console.warn('[proactive] UazAPI retornou erro', sendResp.status, sendJson);
        return;
      }
    } catch (e: any) {
      console.error('[proactive] erro enviando UazAPI:', e?.message);
      return;
    }

    // Loga como outbound + marca idempotência
    try {
      await supabase.from('whatsapp_messages').insert({
        phone,
        instance_name: instanceName,
        message_text: aiText,
        message_type: 'text',
        direction: 'outbound',
        external_message_id: externalId,
        action_source: 'proactive_first_message',
        action_source_detail: String(agentId),
      } as any);
    } catch (e: any) {
      console.warn('[proactive] falha registrando mensagem (não-fatal):', e?.message);
    }

    console.log('[proactive] 1ª mensagem enviada', { phone, instanceName, agentId, length: aiText.length });
  } catch (e: any) {
    console.error('[proactive] erro inesperado:', e?.message);
  }
}



// ============================================================
// WhatsApp media decryption (HKDF + AES-256-CBC)
// Used as fallback when UazAPI /message/download fails to return
// decrypted bytes. Requires the mediaKey from the original message
// metadata. Without it, .enc files cannot be decoded.
// ============================================================
const WA_MEDIA_TYPE_INFO: Record<string, string> = {
  document: 'WhatsApp Document Keys',
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
};

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
  // last 10 bytes are MAC
  const ciphertext = encBuf.slice(0, encBuf.length - 10);
  const decipher = nodeCrypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ============================================================
// ENV CONFIG
// ============================================================
const RESOLVED_SUPABASE_URL = process.env.EXTERNAL_SUPABASE_URL || '';
const RESOLVED_SERVICE_ROLE_KEY = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY || '';
const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || '';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

const UAZ_EVENT_TYPES = new Set([
  'connection', 'history', 'messages', 'messages_update', 'call', 'contacts',
  'presence', 'groups', 'labels', 'chats', 'chat_labels', 'blocks',
  'chat_label', 'label',
]);

function normalizeUazEventType(body: any): string {
  const candidates = [body?.EventType, body?.eventType, body?.event_type, body?.type, body?.event];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.toLowerCase();
    if (UAZ_EVENT_TYPES.has(normalized)) return normalized;
  }
  return '';
}

function pushLabelIds(out: string[], value: any) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) pushLabelIds(out, item);
    return;
  }
  if (typeof value === 'object') {
    pushLabelIds(out, value.id ?? value.labelid ?? value.labelId ?? value.label_id ?? value.value);
    return;
  }
  const text = String(value).trim();
  if (text) out.push(text);
}

function extractLabelEventData(body: any) {
  const data = body?.data && typeof body.data === 'object' ? body.data : {};
  const chat = body?.chat || data?.chat || {};
  const chatId = String(
    chat?.wa_chatid || chat?.id || body?.chatid || body?.chatId || body?.jid || body?.remoteJid
    || data?.chatid || data?.chatId || data?.jid || data?.remoteJid || body?.number || data?.number || ''
  );
  const labels: string[] = [];
  // UazAPI usa `wa_label` (singular) como array de strings "owner:labelId"
  const waLabel = chat?.wa_label ?? chat?.wa_labels ?? data?.wa_label ?? data?.wa_labels;
  if (Array.isArray(waLabel)) {
    for (const raw of waLabel) {
      if (typeof raw !== 'string') continue;
      const id = raw.includes(':') ? raw.split(':').pop() : raw;
      if (id) labels.push(String(id).trim());
    }
  }
  pushLabelIds(labels, chat?.labels);
  pushLabelIds(labels, body?.labels);
  pushLabelIds(labels, data?.labels);
  pushLabelIds(labels, body?.labelids ?? body?.labelIds);
  pushLabelIds(labels, data?.labelids ?? data?.labelIds);
  pushLabelIds(labels, body?.add_labelid ?? body?.addLabelId);
  pushLabelIds(labels, data?.add_labelid ?? data?.addLabelId);
  pushLabelIds(labels, body?.labelid ?? body?.labelId ?? body?.label_id ?? body?.label);
  pushLabelIds(labels, data?.labelid ?? data?.labelId ?? data?.label_id ?? data?.label);
  return { chatId, labels: Array.from(new Set(labels)) };

}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isEncryptedWhatsAppUrl(url?: string | null): boolean {
  if (typeof url !== 'string') return false;
  if (/\.enc(?:\?|$)/i.test(url)) return true;
  // WhatsApp CDN media URLs are AES-encrypted blobs even without .enc suffix.
  // They cannot be played directly by the browser — require mediaKey decrypt.
  if (/^https?:\/\/(?:[a-z0-9-]+\.)*whatsapp\.net\//i.test(url)) return true;
  return false;
}

function findMediaKeyDeep(value: any, depth = 0): string | null {
  if (!value || depth > 5) return null;
  if (typeof value !== 'object') return null;

  const direct = value.mediaKey || value.media_key;
  if (typeof direct === 'string' && direct.length >= 32) return direct;

  for (const child of Object.values(value)) {
    const found = findMediaKeyDeep(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function downloadAndStoreMedia(
  supabase: any,
  messageId: string,
  instanceName: string,
  mediaUrl: string,
  mediaType: string,
  messageType: string,
  baseUrl: string,
  instanceToken: string,
  mediaKey?: string | null,
): Promise<{ publicUrl: string | null; transcription: string | null; contentType: string | null; encryptedSource: boolean }> {
  try {
    console.log('Downloading media via UazAPI for message:', messageId, 'type:', messageType);

    let fileBuffer: ArrayBuffer | null = null;
    let contentType = mediaType || 'application/octet-stream';
    let transcription: string | null = null;
    let encryptedSource = isEncryptedWhatsAppUrl(mediaUrl);
    let encryptedDownloadUrl = encryptedSource ? mediaUrl : null;
    let downloadedEncryptedBytes = false;

    const downloadUrl = `${baseUrl}/message/download`;
    console.log('Calling /message/download at:', downloadUrl, 'with id:', messageId);
    const downloadResp = await fetch(downloadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: instanceToken },
      body: JSON.stringify({ id: messageId, return_link: true, generate_mp3: true }),
    });

    console.log('downloadMediaMessage response status:', downloadResp.status);

    if (downloadResp.ok) {
      const respContentType = downloadResp.headers.get('content-type') || '';

      if (respContentType.includes('application/json')) {
        const jsonData = await downloadResp.json() as any;
        console.log('downloadMediaMessage JSON response keys:', Object.keys(jsonData));

        if (jsonData.fileURL) {
          console.log('Got fileURL from UazAPI:', jsonData.fileURL);
          const mediaResp = await fetch(jsonData.fileURL);
          if (mediaResp.ok) {
            fileBuffer = await mediaResp.arrayBuffer();
            contentType = jsonData.mimetype || mediaResp.headers.get('content-type') || contentType;
            if (isEncryptedWhatsAppUrl(jsonData.fileURL)) {
              encryptedSource = true;
              encryptedDownloadUrl = jsonData.fileURL;
              downloadedEncryptedBytes = true;
            }
          }
          if (typeof jsonData.transcription === 'string' && jsonData.transcription.trim()) {
            transcription = jsonData.transcription.trim();
          }
        } else if (jsonData.base64Data) {
          fileBuffer = toExactArrayBuffer(Buffer.from(jsonData.base64Data, 'base64'));
          if (jsonData.mimetype) contentType = jsonData.mimetype;
        } else if (jsonData.data) {
          fileBuffer = toExactArrayBuffer(Buffer.from(jsonData.data, 'base64'));
          if (jsonData.mimetype) contentType = jsonData.mimetype;
        } else if (jsonData.url) {
          const mediaResp = await fetch(jsonData.url);
          if (mediaResp.ok) {
            fileBuffer = await mediaResp.arrayBuffer();
            contentType = mediaResp.headers.get('content-type') || contentType;
            if (isEncryptedWhatsAppUrl(jsonData.url)) {
              encryptedSource = true;
              encryptedDownloadUrl = jsonData.url;
              downloadedEncryptedBytes = true;
            }
          }
        } else {
          console.log('downloadMediaMessage unexpected JSON:', JSON.stringify(jsonData).substring(0, 500));
        }
      } else {
        fileBuffer = await downloadResp.arrayBuffer();
        if (respContentType && !respContentType.includes('text/')) {
          contentType = respContentType;
        }
      }
    } else {
      const errorText = await downloadResp.text();
      console.log('downloadMediaMessage error:', downloadResp.status, errorText.substring(0, 300));
    }

    // Fallback: alternate ID format
    if (!fileBuffer || fileBuffer.byteLength < 50) {
      console.log('Trying /message/download with alternate ID format...');
      const altId = messageId.includes(':') ? messageId.split(':').pop()! : messageId;
      if (altId !== messageId) {
        const fallbackResp = await fetch(`${baseUrl}/message/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: instanceToken },
          body: JSON.stringify({ id: altId, return_link: true, generate_mp3: true }),
        });
        console.log('Fallback download response status:', fallbackResp.status);
        if (fallbackResp.ok) {
          const fallbackData = await fallbackResp.json() as any;
          console.log('Fallback response keys:', Object.keys(fallbackData));
          if (typeof fallbackData.transcription === 'string' && fallbackData.transcription.trim()) {
            transcription = fallbackData.transcription.trim();
          }
          const resolvedUrl = fallbackData.fileURL || fallbackData.url;
          if (resolvedUrl && typeof resolvedUrl === 'string' && resolvedUrl.startsWith('http')) {
            const dlResp = await fetch(resolvedUrl);
            if (dlResp.ok) {
              fileBuffer = await dlResp.arrayBuffer();
              contentType = fallbackData.mimetype || dlResp.headers.get('content-type') || contentType;
              if (isEncryptedWhatsAppUrl(resolvedUrl)) {
                encryptedSource = true;
                encryptedDownloadUrl = resolvedUrl;
                downloadedEncryptedBytes = true;
              }
            }
          }
        } else {
          const errText = await fallbackResp.text();
          console.log('Fallback download error:', fallbackResp.status, errText.substring(0, 300));
        }
      }
    }

    // Fallback: direct URL
    if ((!fileBuffer || fileBuffer.byteLength < 50) && mediaUrl && !isEncryptedWhatsAppUrl(mediaUrl)) {
      console.log('Trying direct media URL...');
      const directResp = await fetch(mediaUrl);
      if (directResp.ok) {
        fileBuffer = await directResp.arrayBuffer();
        contentType = directResp.headers.get('content-type') || contentType;
      }
    }

    // Fallback: download .enc + decrypt locally with mediaKey
    if ((downloadedEncryptedBytes || !fileBuffer || fileBuffer.byteLength < 50) && mediaKey && encryptedDownloadUrl) {
      console.log('Trying local AES decrypt of .enc URL with mediaKey...');
      try {
        const encResp = await fetch(encryptedDownloadUrl);
        if (encResp.ok) {
          const encBuf = Buffer.from(await encResp.arrayBuffer());
          const decrypted = decryptWhatsAppMedia(encBuf, mediaKey, messageType);
          fileBuffer = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength) as ArrayBuffer;
          downloadedEncryptedBytes = false;
          console.log('Local AES decrypt OK, size:', decrypted.length);
        } else {
          console.log('Failed to fetch .enc URL:', encResp.status);
        }
      } catch (decErr) {
        console.error('Local AES decrypt error:', decErr);
      }
    }

    if (!fileBuffer || fileBuffer.byteLength < 50) {
      console.log('Could not download media, buffer empty or too small, size:', fileBuffer?.byteLength || 0);
      return { publicUrl: null, transcription, contentType: null, encryptedSource };
    }

    if (downloadedEncryptedBytes) {
      console.error('Encrypted WhatsApp media was returned as a download but no valid mediaKey/decrypt result was available. Refusing to upload unreadable bytes.', {
        messageId,
        messageType,
        hasMediaKey: !!mediaKey,
        size: fileBuffer.byteLength,
      });
      return { publicUrl: null, transcription, contentType: null, encryptedSource: true };
    }

    // Normalize content type when UazAPI didn't tell us what it is.
    // Sem essa etiqueta, o navegador trata áudio como binário cego (duração 0,
    // não toca) e arquivo vira .bin. Inferimos pelo messageType + sniffing.
    const isGeneric = !contentType || contentType === 'application/octet-stream' || contentType.startsWith('text/');
    if (isGeneric) {
      const head = new Uint8Array(fileBuffer.slice(0, 16));
      const sniff = (sig: number[], offset = 0) => sig.every((b, i) => head[offset + i] === b);
      if (messageType === 'audio') {
        if (sniff([0x4f, 0x67, 0x67, 0x53])) contentType = 'audio/ogg';           // OggS
        else if (sniff([0x49, 0x44, 0x33]) || sniff([0xff, 0xfb])) contentType = 'audio/mpeg'; // ID3 / MP3
        else if (sniff([0x66, 0x74, 0x79, 0x70], 4)) contentType = 'audio/mp4';   // ftyp
        else contentType = 'audio/ogg';
      } else if (messageType === 'image') {
        if (sniff([0x89, 0x50, 0x4e, 0x47])) contentType = 'image/png';
        else if (sniff([0xff, 0xd8, 0xff])) contentType = 'image/jpeg';
        else if (sniff([0x52, 0x49, 0x46, 0x46]) && sniff([0x57, 0x45, 0x42, 0x50], 8)) contentType = 'image/webp';
        else contentType = 'image/jpeg';
      } else if (messageType === 'video') {
        contentType = 'video/mp4';
      } else if (messageType === 'document') {
        if (sniff([0x25, 0x50, 0x44, 0x46])) contentType = 'application/pdf';      // %PDF
        else if (sniff([0x50, 0x4b, 0x03, 0x04])) contentType = 'application/zip'; // PK (also docx/xlsx)
      }
      console.log('Normalized contentType to:', contentType);
    }

    console.log('Downloaded media:', fileBuffer.byteLength, 'bytes, type:', contentType);

    // STT: transcribe audio
    if (messageType === 'audio' && (!transcription || !transcription.trim())) {
      try {
        const sttText = await transcribeAudio(fileBuffer, contentType || 'audio/ogg');
        if (sttText) {
          transcription = sttText;
          console.log('Audio transcription via shared STT:', sttText.substring(0, 120));
        }
      } catch (sttError) {
        console.error('Shared STT failed:', sttError);
      }
    }

    const ext = getFileExtension(contentType, messageType);
    const timestamp = Date.now();
    // Sanitize: remove acentos/cedilha + troca tudo que não é [a-zA-Z0-9_] por _
    // Supabase Storage rejeita keys com caracteres especiais (StorageApiError: Invalid key)
    const safeInstance = String(instanceName || 'unknown')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown';
    const filePath = `${safeInstance}/${timestamp}_${messageId.substring(0, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, Buffer.from(fileBuffer), { contentType, upsert: true });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return { publicUrl: null, transcription, contentType, encryptedSource };
    }

    const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(filePath);
    console.log('Media uploaded successfully:', urlData.publicUrl);
    return { publicUrl: urlData.publicUrl, transcription, contentType, encryptedSource };
  } catch (e) {
    console.error('Media download/upload error:', e);
    return { publicUrl: null, transcription: null, contentType: null, encryptedSource: isEncryptedWhatsAppUrl(mediaUrl) };
  }
}

function normalizeVoiceCommandText(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveAgentControlCommand(text: string | null, messageType: string): '#parar' | '#ativar' | '#status' | '#limpar' | null {
  const raw = (text || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === '#parar' || raw === '#ativar' || raw === '#status' || raw === '#limpar') {
    return raw as '#parar' | '#ativar' | '#status' | '#limpar';
  }
  if (messageType !== 'audio') return null;
  const cleaned = normalizeVoiceCommandText(raw);
  if (/^#?\s*(parar|pare|desativar|desative)\b/.test(cleaned)) return '#parar';
  if (/^#?\s*(ativar|ative|retomar|retome)\b/.test(cleaned)) return '#ativar';
  if (/^#?\s*(status|situacao|situa[çc][aã]o|como\s+esta)\b/.test(cleaned)) return '#status';
  if (/^#?\s*(limpar|limpe|apagar\s+conversa|limpar\s+conversa)\b/.test(cleaned)) return '#limpar';
  return null;
}

function getFileExtension(contentType: string, messageType: string): string {
  const map: Record<string, string> = {
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/aac': 'aac',
    'audio/wav': 'wav', 'audio/webm': 'webm',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
    'application/pdf': 'pdf', 'application/zip': 'zip',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (map[ct]) return map[ct];
  if (messageType === 'audio') return 'ogg';
  if (messageType === 'image') return 'jpg';
  if (messageType === 'video') return 'mp4';
  if (messageType === 'document') return 'pdf';
  return 'bin';
}

async function transcribeCallAudio(audioUrl: string, _apiKey: string): Promise<{ summary: string; transcript: string } | null> {
  try {
    const data = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Você é um assistente jurídico de um CRM de advocacia. Transcreva o áudio da chamada e forneça um resumo objetivo." },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcreva este áudio de chamada telefônica e forneça:\n1. TRANSCRIÇÃO: A transcrição completa da conversa\n2. RESUMO: Um resumo conciso dos pontos principais discutidos, decisões tomadas e próximos passos\n\nResponda em português do Brasil. Use o formato:\nTRANSCRIÇÃO:\n[transcrição aqui]\n\nRESUMO:\n[resumo aqui]" },
            { type: "input_audio", input_audio: { url: audioUrl, format: "wav" } }
          ]
        }
      ],
    });
    const content = data.choices?.[0]?.message?.content || "";
    const transcriptMatch = content.match(/TRANSCRIÇÃO:\s*([\s\S]*?)(?=RESUMO:|$)/i);
    const summaryMatch = content.match(/RESUMO:\s*([\s\S]*?)$/i);
    return {
      transcript: transcriptMatch?.[1]?.trim() || content,
      summary: summaryMatch?.[1]?.trim() || "",
    };
  } catch (e) {
    console.error("Transcription error:", e);
    return null;
  }
}

function normalizePhone(raw: string | null | undefined): string {
  return (raw || '')
    .replace('@s.whatsapp.net', '')
    .replace('@g.us', '')
    .replace('@lid', '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

function normalizeCallId(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || null;
}

function resolveCallTag(body: any, event: any, call: any): string {
  const candidates = [
    event?.Data?.Tag, event?.tag, event?.status, event?.result,
    call?.status, call?.state, body?.status, body?.call_status,
    body?.callState, body?.event_type, body?.type,
    body?.message?.call_state, body?.message?.status, body?.message?.messageType,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.toLowerCase().trim();
  }
  return '';
}

// ============================================================
// CALL EVENT HANDLER
// ============================================================

async function handleCallEvent(supabase: any, body: any) {
  const event = body.event || {};
  const call = body.call || body.message || body.chat || {};

  const senderPn = body.sender_pn || event.CallCreatorAlt || event.From || call.from || '';
  const callFrom = event.From || call.from || body.from || body.chat?.phone || senderPn || '';
  const phone = normalizePhone(callFrom);
  const contactName = body.chat?.name || body.chat?.pushName || body.senderName || call?.caller_name || null;
  const instanceName = body.instanceName || body.chat?.instanceName || null;

  const callId = normalizeCallId(
    event.CallID || event.call_id || event.callId || call.CallID || call.call_id || call.callId
    || body.call_id || body.callId || body.message?.call_id || body.message?.callId || body.message?.id
  );

  const fromMeBody = body.fromMe === true || body.message?.fromMe === true || body.chat?.fromMe === true || call.fromMe === true;
  const fromMeEvent = event.from_me === true
    || String(body.direction || '').toLowerCase() === 'outbound'
    || String(body.call_direction || '').toLowerCase() === 'outbound';
  const instanceOwner = normalizePhone(body.owner || body.chat?.owner || '');
  const fromMeOwner = !!instanceOwner && normalizePhone(senderPn) === instanceOwner;

  const isIncoming = !(fromMeBody || fromMeEvent || fromMeOwner);
  const eventTag = resolveCallTag(body, event, call);
  const reason = String(body.Reason || body.reason || event.Reason || event?.Data?.Attrs?.reason || '').toLowerCase();

  console.log('Processing call event:', { phone, callId, eventTag, reason, isIncoming, instanceName });

  if (!phone) { console.error('No phone for call event, skipping'); return null; }

  const isOffer = ['offer', 'ringing', 'ring', 'initiated', 'incoming', 'calling'].some(s => eventTag.includes(s));
  const isAccept = ['accept', 'accepted', 'answer', 'answered', 'connected', 'in_progress', 'ongoing'].some(s => eventTag.includes(s));
  const hasMissedSignal = ['reject', 'rejected', 'timeout', 'miss', 'missed', 'cancel', 'cancelled', 'failed', 'unavailable', 'declined'].some(s => eventTag.includes(s) || reason.includes(s));
  const hasBusySignal = eventTag.includes('busy') || reason.includes('busy');
  const isTerminate = ['terminate', 'terminated', 'ended', 'end', 'hangup', 'completed', 'finish', 'finished'].some(s => eventTag.includes(s))
    || hasMissedSignal || hasBusySignal;

  console.log('Call event routing:', { eventTag, isOffer, isAccept, isTerminate, callId });

  if ((isOffer || isAccept) && callId) {
    const eventType = isOffer ? 'offer' : 'accept';
    const { data: alreadyExists } = await supabase
      .from('call_events_pending').select('id').eq('call_id', callId).eq('event_type', eventType).limit(1).maybeSingle();

    if (!alreadyExists) {
      await supabase.from('call_events_pending').insert({
        call_id: callId, instance_name: instanceName, phone, contact_name: contactName, event_type: eventType, from_me: !isIncoming,
      });
      console.log(`Saved ${eventType} event for call:`, callId);
    }

    if (isAccept && instanceName) {
      try {
        const { data: inst } = await supabase
          .from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).eq('is_active', true).limit(1).maybeSingle();
        if (inst?.instance_token) {
          const recBaseUrl = inst.base_url || 'https://abraci.uazapi.com';
          const recordUrl = `${recBaseUrl}/call/record`;
          console.log('Auto-activating call recording via UazAPI:', recordUrl);
          const recResp = await fetch(recordUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token: inst.instance_token },
            body: JSON.stringify({ callId, number: phone }),
          });
          const recData = await recResp.json().catch(() => ({}));
          console.log('UazAPI record response:', recResp.status, JSON.stringify(recData));
        }
      } catch (recErr) { console.error('Error activating call recording:', recErr); }
    }
    return null;
  }

  if (!isTerminate) { console.log('Unknown/intermediate call event, skipping:', eventTag || '(empty)'); return null; }

  // Idempotency
  if (callId) {
    const { data: existingFinal } = await supabase
      .from('call_records').select('id, user_id, audio_url').ilike('notes', `%CallID:${callId}%`).neq('call_result', 'em_andamento')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingFinal) { console.log('Final call record already exists, skipping:', callId); return existingFinal; }
  }

  let pendingQuery = supabase.from('call_events_pending').select('*').order('created_at', { ascending: true }).limit(30);
  if (callId) { pendingQuery = pendingQuery.eq('call_id', callId); }
  else { pendingQuery = pendingQuery.eq('phone', phone); if (instanceName) pendingQuery = pendingQuery.eq('instance_name', instanceName); }

  const { data: pendingEvents } = await pendingQuery;
  const offerEvent = pendingEvents?.find((e: any) => e.event_type === 'offer');
  const acceptEvent = pendingEvents?.find((e: any) => e.event_type === 'accept');

  const reportedDurationRaw = Number(call.duration || call.duration_seconds || event.duration || body.duration || body.duration_seconds || 0);
  let durationSeconds = Number.isFinite(reportedDurationRaw) && reportedDurationRaw > 0 ? Math.round(reportedDurationRaw) : 0;

  if (!durationSeconds && acceptEvent?.created_at) {
    const acceptTime = new Date(acceptEvent.created_at).getTime();
    durationSeconds = Math.max(0, Math.round((Date.now() - acceptTime) / 1000));
  }

  const hasAnsweredSignal = ['accept', 'accepted', 'answer', 'answered', 'connected', 'in_progress', 'ongoing', 'completed'].some(s => eventTag.includes(s));
  const wasAnswered = !!acceptEvent || durationSeconds > 0 || (hasAnsweredSignal && !hasMissedSignal && !hasBusySignal);

  let callResult = 'atendeu';
  if (!wasAnswered) { callResult = hasBusySignal ? 'ocupado' : 'não_atendeu'; durationSeconds = 0; }

  const finalPhone = offerEvent?.phone || acceptEvent?.phone || phone;
  const finalContactName = offerEvent?.contact_name || acceptEvent?.contact_name || contactName;
  const isOutbound = offerEvent?.from_me === true || acceptEvent?.from_me === true || !isIncoming;
  const callType = isOutbound ? 'realizada' : 'recebida';

  console.log('Finalizing call record:', { finalPhone, callType, callResult, durationSeconds, callId });

  // Clean up pending
  if (callId) { await supabase.from('call_events_pending').delete().eq('call_id', callId); }
  else { let q = supabase.from('call_events_pending').delete().eq('phone', finalPhone); if (instanceName) q = q.eq('instance_name', instanceName); await q; }
  const staleCutoffIso = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  await supabase.from('call_events_pending').delete().lt('created_at', staleCutoffIso);

  // Look up contact/lead
  let contactId: string | null = null;
  let leadId: string | null = null;
  let leadName: string | null = null;

  const phoneVariants = Array.from(new Set([finalPhone, finalPhone.replace(/^55/, '')].filter(Boolean)));
  for (const variant of phoneVariants) {
    const { data: contacts } = await supabase.from('contacts').select('id, lead_id, full_name').or(`phone.ilike.%${variant}`).limit(1);
    if (contacts?.length) { contactId = contacts[0].id; leadId = contacts[0].lead_id; break; }
  }
  if (!leadId) {
    for (const variant of phoneVariants) {
      const { data: leads } = await supabase.from('leads').select('id, lead_name').or(`lead_phone.ilike.%${variant}`).limit(1);
      if (leads?.length) { leadId = leads[0].id; leadName = leads[0].lead_name; break; }
    }
  }

  // AI transcription
  let aiSummary: string | null = null;
  let aiTranscript: string | null = null;
  const audioUrl = call.audioUrl || call.audio_url || call.mediaUrl || null;

  if (audioUrl && callResult === 'atendeu' && durationSeconds > 5) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (apiKey) {
      console.log('Transcribing call audio...');
      const result = await transcribeCallAudio(audioUrl, apiKey);
      if (result) { aiSummary = result.summary; aiTranscript = result.transcript; }
    }
  }

  // Try to update existing open record
  const twoHoursAgoIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  let openRecordQuery = supabase
    .from('call_records').select('id, user_id, created_at').eq('call_result', 'em_andamento')
    .gte('created_at', twoHoursAgoIso).order('created_at', { ascending: false }).limit(1);
  if (instanceName) openRecordQuery = openRecordQuery.eq('phone_used', instanceName);
  if (phoneVariants.length > 0) openRecordQuery = openRecordQuery.or(phoneVariants.map(v => `contact_phone.eq.${v}`).join(','));

  const { data: openRecord } = await openRecordQuery.maybeSingle();

  let record: any = null;
  const callIdNote = callId ? `CallID:${callId}` : 'CallID:unknown';
  const basePayload = {
    call_type: callType, call_result: callResult, duration_seconds: durationSeconds,
    contact_id: contactId, lead_id: leadId, lead_name: leadName || finalContactName,
    contact_name: finalContactName, contact_phone: finalPhone, phone_used: instanceName || 'whatsapp',
    ai_summary: aiSummary, ai_transcript: aiTranscript, audio_url: audioUrl,
    notes: `Chamada WhatsApp ${callType} via ${instanceName || 'UazAPI'}. Duração: ${durationSeconds}s | ${callIdNote}`,
    tags: ['whatsapp', 'automatico'],
  };

  if (openRecord?.id) {
    const { data: updated, error: updateError } = await supabase.from('call_records').update(basePayload).eq('id', openRecord.id).select().single();
    if (updateError) console.error('Error updating open call record:', updateError);
    else { record = updated; console.log('Updated open call record:', record.id); }
  }

  if (!record) {
    const { data: adminRole } = await supabase.from('user_roles').select('user_id').eq('role', 'admin').limit(1).single();
    const userId = adminRole?.user_id;
    if (!userId) { console.error('No admin user found for call record'); return null; }
    const { data: inserted, error } = await supabase.from('call_records').insert({ user_id: userId, ...basePayload }).select().single();
    if (error) { console.error('Error creating call record:', error); return null; }
    record = inserted;
    console.log('Call record created:', record.id);
  }

  // Trigger field extraction (fire-and-forget)
  if (callResult === 'atendeu' && durationSeconds > 5 && (audioUrl || record.audio_url)) {
    fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/analyze-activity-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
      body: JSON.stringify({ action: 'transcribe_call', audio_url: audioUrl || record.audio_url, call_record_id: record.id, phone: finalPhone }),
    }).catch(e => console.error('Field extraction trigger error:', e));
  }

  return record;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export const handler: RequestHandler = async (req, res) => {
  try {
    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
    const startTime = Date.now();

    // Handle GET requests
    let body: any;
    if (req.method === 'GET') {
      body = { ...req.query };
      for (const key of Object.keys(body)) {
        try { const parsed = JSON.parse(body[key]); if (typeof parsed === 'object') body[key] = parsed; } catch (_) {}
      }
      console.log('GET webhook received, params:', JSON.stringify(body).substring(0, 2000));
      if (Object.keys(body).length === 0) {
        return res.json({ success: true, method: 'GET', message: 'Webhook active' });
      }
      // webhook_logs disabled — console-only
      console.log('[whatsapp-webhook][GET]', {
        event_type: 'GET_' + (body.EventType || body.event || body.type || 'unknown'),
        instance_name: body.instanceName || body.instance_name || null,
      });
    } else {
      body = req.body;
    }

    // ========== EARLY FILTERS ==========
    let webhookInstanceName = body.instanceName || body.InstanceName || body.chat?.instanceName || body.data?.instanceName || body.instance_name || body.instance || null;
    const eventType = normalizeUazEventType(body);
    const bodyType = String(body.type || '').toLowerCase();
    const bodyEventStr = (typeof body.event === 'string') ? body.event.toLowerCase() : '';
    const messageTypeHint = String(body.message?.messageType || body.chat?.wa_lastMessageType || '').toLowerCase();
    const hasCallPayload = Boolean(
      body.call || body.call_id || body.callId
      || (typeof body.event === 'object' && body.event !== null && (body.event.CallID || body.event.call_id || body.event.Data?.Tag))
      || body.message?.call_id || body.message?.callId
    );

    const isCallEvent = ['call', 'calls', 'call_log'].includes(eventType)
      || bodyEventStr === 'call' || bodyType.includes('call') || messageTypeHint.includes('call') || hasCallPayload;

    // webhook_logs disabled — console-only no-op
    const logWebhook = async (status: string, _responseData?: any, errorMsg?: string) => {
      console.log('[whatsapp-webhook]', {
        status,
        event_type: eventType || bodyType || bodyEventStr || 'unknown',
        instance_name: webhookInstanceName,
        ms: Date.now() - startTime,
        ...(errorMsg ? { error: errorMsg } : {}),
      });
    };

    // Skip noise events (labels é tratado separadamente abaixo)
    const skippableEvents = ['messages_update', 'presence', 'chats_update', 'chats_delete', 'contacts_update', 'message_ack', 'chats'];
    if (skippableEvents.includes(eventType) && !isCallEvent) {
      return res.json({ success: true, skipped: true, reason: `EventType ${eventType} filtered` });
    }

    // ========== LABEL EVENT — dispara fluxo de procuração automática ==========
    // Doc UazAPI usa "chat_labels" no payload, mas alguns ambientes mandam "chat_label" (singular)
    // ou apenas "labels"/"label". Aceitamos todas as variações por segurança.
    const isLabelEvent = ['chat_labels', 'chat_label', 'labels', 'label'].includes(eventType);
    if (isLabelEvent && !isCallEvent) {
      console.log('[whatsapp-webhook] LABEL event received, EventType=', body.EventType, 'instance=', webhookInstanceName);
      // DEBUG TEMP: dump payload completo pra mapear onde a UazAPI coloca os labels
      try {
        console.log('[label-trigger][DEBUG-PAYLOAD]', JSON.stringify(body).slice(0, 4000));
      } catch {}

      try {
        const { chatId, labels: waLabels } = extractLabelEventData(body);

        // waLabels vazio é um estado válido: significa que a conversa ficou sem etiquetas.
        // Antes isso era tratado como "dados faltando" e a remoção da etiqueta do agente
        // nunca chegava no bloco de desativação abaixo.
        if (!chatId || !webhookInstanceName) {
          console.warn('[label-trigger] missing data', { hasChatId: Boolean(chatId), webhookInstanceName, labelCount: waLabels.length, keys: Object.keys(body || {}) });
          return res.json({ success: true, skipped: true, reason: 'label_event_missing_data' });
        }

        // Canonicaliza o instance_name (UazAPI manda em CAIXA-ALTA em label events,
        // mas as mensagens regulares chegam em camelCase). Sem isso, conversation_agents
        // grava 'NOME MAIÚSCULO' e o ai-agent-reply faz .eq() case-sensitive → bot não responde.
        try {
          const { data: canonInst } = await supabase
            .from('whatsapp_instances')
            .select('instance_name')
            .ilike('instance_name', webhookInstanceName)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (canonInst?.instance_name && canonInst.instance_name !== webhookInstanceName) {
            console.log('[label-trigger] canonicalizing instance_name', { from: webhookInstanceName, to: canonInst.instance_name });
            webhookInstanceName = canonInst.instance_name;
          }
        } catch (e: any) {
          console.warn('[label-trigger] canonicalize failed (non-fatal):', e?.message);
        }

        const phoneDigits = chatId.replace(/@[^@]+$/, '').replace(/\D/g, '');

        // Busca gatilhos ativos pra essa instância
        const { data: triggers } = await supabase
          .from('label_document_triggers')
          .select('id, label_id, label_name, zapsign_template_id, agent_id')
          .ilike('instance_name', webhookInstanceName)
          .eq('enabled', true)
          .is('deleted_at', null);

        // Normaliza labels do WA: "owner:labelId" → "labelId"
        const normalizedWaLabels = waLabels.map((l) => String(l).split(':').pop() || String(l));

        // === NOVO: busca também em agent_instance_labels (sync automático
        // criado pela tela de Agentes). Aqui não tem template ZapSign,
        // só ativa o agente correspondente quando o operador aplica a etiqueta.
        const { data: agentLabelMappings } = await supabase
          .from('agent_instance_labels')
          .select('agent_id, label_id, label_name, instance_name')
          .ilike('instance_name', webhookInstanceName)
          .is('deleted_at', null);

        const matchedAgentLabels = (agentLabelMappings || []).filter((m: any) => {
          const lid = String(m.label_id).split(':').pop() || String(m.label_id);
          return normalizedWaLabels.includes(lid);
        });

        for (const m of matchedAgentLabels) {
          try {
            const last8 = phoneDigits.slice(-8);
            const { error: agentErr } = await supabase
              .from('whatsapp_conversation_agents')
              .upsert({
                phone: phoneDigits,
                instance_name: webhookInstanceName,
                agent_id: (m as any).agent_id,
                is_active: true,
                human_paused_until: null,
                activated_by: 'label_sync',
                updated_at: new Date().toISOString(),
              }, { onConflict: 'phone,instance_name' });
            if (agentErr && last8) {
              await supabase
                .from('whatsapp_conversation_agents')
                .update({
                  agent_id: (m as any).agent_id,
                  is_active: true,
                  human_paused_until: null,
                  activated_by: 'label_sync',
                })
                .ilike('instance_name', webhookInstanceName)
                .like('phone', `%${last8}`);
            }
            console.log('[label-trigger] agent activated via sync', { chatId, phone: phoneDigits, agent_id: (m as any).agent_id, label: (m as any).label_name });
            // Dispara 1ª mensagem proativa se o agente tiver configurado
            triggerProactiveFirstMessage(supabase, phoneDigits, webhookInstanceName, (m as any).agent_id).catch(err => console.warn('[proactive] sync trigger error:', err?.message));
          } catch (e: any) {
            console.warn('[label-trigger] sync activation failed:', e?.message);
          }
        }

        // === NOVO: DESATIVAÇÃO ao remover etiqueta de agente.
        // Se a conversa tem agente ativo cuja etiqueta NÃO está mais presente
        // no payload (operador removeu no WA), desativa imediatamente.
        try {
          const last8 = phoneDigits.slice(-8);
          // Pega agente atualmente ativo nesta conversa
          const { data: convAgent } = await supabase
            .from('whatsapp_conversation_agents')
            .select('agent_id, is_active')
            .ilike('instance_name', webhookInstanceName)
            .like('phone', `%${last8}`)
            .eq('is_active', true)
            .maybeSingle();

          if (convAgent && (convAgent as any).agent_id) {
            const activeAgentId = (convAgent as any).agent_id;
            // Esse agente tem etiqueta mapeada nesta instância?
            const mappingForActive = (agentLabelMappings || []).find(
              (m: any) => m.agent_id === activeAgentId,
            );
            if (mappingForActive) {
              const lid = String((mappingForActive as any).label_id).split(':').pop()
                || String((mappingForActive as any).label_id);
              const stillPresent = normalizedWaLabels.includes(lid);
              if (!stillPresent) {
                await supabase
                  .from('whatsapp_conversation_agents')
                  .update({
                    is_active: false,
                    updated_at: new Date().toISOString(),
                    activated_by: 'label_sync_removed',
                  })
                  .ilike('instance_name', webhookInstanceName)
                  .like('phone', `%${last8}`);
                console.log('[label-trigger] agent DEACTIVATED via label removal', {
                  chatId, phone: phoneDigits, agent_id: activeAgentId,
                  label: (mappingForActive as any).label_name,
                });
              }
            }
          }
        } catch (e: any) {
          console.warn('[label-trigger] deactivation check failed:', e?.message);
        }



        // === NOVO: etiquetas de RESULTADO do lead (WA → CRM)
        // Quando o operador cola "✅ Fechado", "❌ Recusado" etc, atualiza lead_status.
        // Só atua se houver vínculo EXPLÍCITO conversa→lead (whatsapp_conversation_agents ou contact_leads).
        // Cada outcome precisa de lead_status + um *_date próprio. Os outros dates
        // têm que ser zerados — o LeadEditDialog deduz o outcome pelo date preenchido,
        // não pelo lead_status.
        const today = new Date().toISOString().slice(0, 10);
        const RESULT_KEY_TO_PATCH: Record<string, Record<string, any>> = {
          in_progress: { lead_status: 'active',    in_progress_date: today, became_client_date: null, classification_date: null, inviavel_date: null, cancelled_date: null },
          closed:      { lead_status: 'closed',    became_client_date: today, in_progress_date: null, classification_date: null, inviavel_date: null, cancelled_date: null },
          refused:     { lead_status: 'refused',   classification_date: today, in_progress_date: null, became_client_date: null, inviavel_date: null, cancelled_date: null },
          inviavel:    { lead_status: 'inviavel',  inviavel_date: today, in_progress_date: null, became_client_date: null, classification_date: null, cancelled_date: null },
          cancelled:   { lead_status: 'cancelled', cancelled_date: today, in_progress_date: null, became_client_date: null, classification_date: null, inviavel_date: null },
        };
        try {
          const { data: resultLabelMappings } = await supabase
            .from('result_instance_labels')
            .select('result_key, label_id, label_name, instance_name')
            .ilike('instance_name', webhookInstanceName)
            .is('deleted_at', null);

          const matchedResultLabels = (resultLabelMappings || []).filter((m: any) => {
            const lid = String(m.label_id).split(':').pop() || String(m.label_id);
            return normalizedWaLabels.includes(lid);
          });

          if (matchedResultLabels.length > 0) {
            // Resolve lead_id: 1) conversa→agent, 2) contact→lead, 3) telefone direto no lead
            let leadId: string | null = null;
            try {
              const { data: convoLead } = await supabase
                .from('whatsapp_conversation_agents')
                .select('lead_id')
                .ilike('instance_name', webhookInstanceName)
                .like('phone', `%${phoneDigits.slice(-8)}`)
                .not('lead_id', 'is', null)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              leadId = (convoLead as any)?.lead_id || null;
            } catch {}
            if (!leadId) {
              try {
                const { data: contact } = await supabase
                  .from('contacts')
                  .select('id')
                  .like('phone', `%${phoneDigits.slice(-8)}`)
                  .limit(1)
                  .maybeSingle();
                if (contact?.id) {
                  const { data: cl } = await supabase
                    .from('contact_leads')
                    .select('lead_id')
                    .eq('contact_id', (contact as any).id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  leadId = (cl as any)?.lead_id || null;
                }
              } catch {}
            }
            if (!leadId) {
              try {
                const { data: leadByPhone } = await supabase
                  .from('leads')
                  .select('id')
                  .like('lead_phone', `%${phoneDigits.slice(-8)}`)
                  .is('deleted_at', null)
                  .order('updated_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                leadId = (leadByPhone as any)?.id || null;
              } catch {}
            }

            if (!leadId) {
              console.log('[label-trigger][result] no lead link, skipping', { phone: phoneDigits, labels: matchedResultLabels.map((m: any) => m.label_name) });
            } else {
              const lastMatch: any = matchedResultLabels[matchedResultLabels.length - 1];
              const patch = RESULT_KEY_TO_PATCH[lastMatch.result_key];
              if (patch) {
                // Preserva data original quando o lead já estava no mesmo outcome
                // (evita sobrescrever became_client_date=hoje em fechados antigos
                // quando o webhook re-sincroniza etiquetas).
                let finalPatch: Record<string, any> = { ...patch };
                try {
                  const { data: existing } = await supabase
                    .from('leads')
                    .select('lead_status, became_client_date, in_progress_date, classification_date, inviavel_date, cancelled_date')
                    .eq('id', leadId)
                    .maybeSingle();
                  if (existing) {
                    const dateField = lastMatch.result_key === 'closed' ? 'became_client_date'
                      : lastMatch.result_key === 'in_progress' ? 'in_progress_date'
                      : lastMatch.result_key === 'refused' ? 'classification_date'
                      : lastMatch.result_key === 'inviavel' ? 'inviavel_date'
                      : lastMatch.result_key === 'cancelled' ? 'cancelled_date'
                      : null;
                    // Se já tinha data preenchida, mantém — não sobrescreve com hoje.
                    if (dateField && (existing as any)[dateField]) {
                      finalPatch[dateField] = (existing as any)[dateField];
                    }
                    // Pra 'closed': tenta puxar signed_at do ZapSign mais recente como fonte de verdade
                    if (lastMatch.result_key === 'closed' && !(existing as any).became_client_date) {
                      try {
                        const { data: zap } = await supabase
                          .from('zapsign_documents')
                          .select('signed_at')
                          .eq('lead_id', leadId)
                          .not('signed_at', 'is', null)
                          .order('signed_at', { ascending: false })
                          .limit(1)
                          .maybeSingle();
                        const signedAt = (zap as any)?.signed_at;
                        if (signedAt) finalPatch.became_client_date = String(signedAt).slice(0, 10);
                      } catch {}
                    }
                    // Fallback adicional: se ainda não temos became_client_date,
                    // tenta a data de criação do GRUPO vinculado ao lead.
                    // Cenário: lead nasceu hoje no CRM (revogação ou re-importação),
                    // mas o grupo do WhatsApp existe há meses/anos. A data real do
                    // fechamento é a criação do grupo, não a do registro no CRM.
                    if (lastMatch.result_key === 'closed' && !finalPatch.became_client_date) {
                      try {
                        // 1) Descobre o group_jid vinculado
                        let groupJid: string | null = null;
                        const { data: gRow } = await supabase
                          .from('lead_whatsapp_groups')
                          .select('group_jid')
                          .eq('lead_id', leadId)
                          .order('created_at', { ascending: false })
                          .limit(1)
                          .maybeSingle();
                        groupJid = (gRow as any)?.group_jid || null;
                        if (!groupJid) {
                          const { data: lRow } = await supabase
                            .from('leads').select('whatsapp_group_id').eq('id', leadId).maybeSingle();
                          groupJid = (lRow as any)?.whatsapp_group_id || null;
                        }
                        if (groupJid && !groupJid.includes('@')) groupJid = `${groupJid}@g.us`;

                        if (groupJid) {
                          // 2) Pega token/baseUrl da instância do webhook (ou qualquer conectada)
                          const { data: inst } = await supabase
                            .from('whatsapp_instances')
                            .select('instance_token, base_url')
                            .ilike('instance_name', webhookInstanceName || '')
                            .limit(1)
                            .maybeSingle();
                          const token = (inst as any)?.instance_token;
                          const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
                          if (token) {
                            const ctrl = new AbortController();
                            const tid = setTimeout(() => ctrl.abort(), 5000);
                            const res = await fetch(`${baseUrl}/group/info`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', token },
                              body: JSON.stringify({ id: groupJid }),
                              signal: ctrl.signal,
                            }).catch(() => null);
                            clearTimeout(tid);
                            if (res && res.ok) {
                              const data: any = await res.json().catch(() => ({}));
                              const ts = data?.creation || data?.GroupCreated || data?.created_at
                                || data?.data?.creation || data?.data?.GroupCreated;
                              if (ts) {
                                const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
                                if (!isNaN(d.getTime())) {
                                  finalPatch.became_client_date = d.toISOString().slice(0, 10);
                                  console.log('[label-trigger][result] became_client_date from group creation', { leadId, groupJid, date: finalPatch.became_client_date });
                                }
                              }
                            }
                          }
                        }
                      } catch (e: any) {
                        console.warn('[label-trigger][result] group-date fallback failed:', e?.message);
                      }
                    }

                  }
                } catch (e: any) {
                  console.warn('[label-trigger][result] preserve-date check failed:', e?.message);
                }
                await supabase
                  .from('leads')
                  .update({ ...finalPatch, updated_at: new Date().toISOString() } as any)
                  .eq('id', leadId);
                console.log('[label-trigger][result] lead outcome updated', { leadId, outcome: lastMatch.result_key, via: lastMatch.label_name, dateUsed: finalPatch.became_client_date || finalPatch.in_progress_date || finalPatch.classification_date || finalPatch.inviavel_date || finalPatch.cancelled_date });

                // Quando FECHA, o operador/instância que atendeu vira o acolhedor do lead.
                // Fonte: whatsapp_instances.owner_name da instância que recebeu o webhook.
                if (lastMatch.result_key === 'closed') {
                  try {
                    const { data: inst } = await supabase
                      .from('whatsapp_instances')
                      .select('owner_name')
                      .ilike('instance_name', webhookInstanceName)
                      .limit(1)
                      .maybeSingle();
                    const ownerName = ((inst as any)?.owner_name || '').trim();
                    if (ownerName) {
                      await supabase
                        .from('leads')
                        .update({ acolhedor: ownerName, updated_at: new Date().toISOString() } as any)
                        .eq('id', leadId);
                      console.log('[label-trigger][result] acolhedor set from instance', { leadId, acolhedor: ownerName, instance: webhookInstanceName });
                    } else {
                      console.log('[label-trigger][result] instance has no owner_name, acolhedor unchanged', { instance: webhookInstanceName });
                    }
                  } catch (e: any) {
                    console.warn('[label-trigger][result] set acolhedor failed:', e?.message);
                  }
                }

                try {
                  await supabase.from('lead_activities').insert({
                    lead_id: leadId,
                    title: `Resultado alterado via etiqueta WhatsApp: ${lastMatch.label_name}`,
                    description: `Resultado do lead definido como "${lastMatch.result_key}" pelo operador aplicando a etiqueta no WhatsApp.`,
                    activity_type: 'notificacao',
                    status: 'concluida',
                    priority: 'normal',
                  } as any);
                } catch (e: any) {
                  console.warn('[label-trigger][result] activity log failed:', e?.message);
                }
              }
            }

          }
        } catch (e: any) {
          console.warn('[label-trigger][result] block failed:', e?.message);
        }

        // === NOVO: etiquetas de ETAPA de KANBAN (WA → CRM)
        // Quando o operador aplica a etiqueta de uma etapa no WA, move o card
        // automaticamente para a coluna correspondente. Lookup em stage_instance_labels.
        try {
          const { data: stageMappings } = await supabase
            .from('stage_instance_labels')
            .select('board_id, stage_id, label_id, label_name, instance_name')
            .ilike('instance_name', webhookInstanceName)
            .is('deleted_at', null);

          const matchedStageLabels = (stageMappings || []).filter((m: any) => {
            const lid = String(m.label_id).split(':').pop() || String(m.label_id);
            return normalizedWaLabels.includes(lid);
          });

          if (matchedStageLabels.length > 0) {
            // Resolve lead via telefone + board
            const last8 = phoneDigits.slice(-8);
            // Pega o ÚLTIMO match (operador pode ter colocado várias etiquetas; a aplicada por último prevalece)
            const lastStageMatch: any = matchedStageLabels[matchedStageLabels.length - 1];

            const { data: leadRow } = await supabase
              .from('leads')
              .select('id, status, board_id')
              .like('lead_phone', `%${last8}`)
              .eq('board_id', lastStageMatch.board_id)
              .is('deleted_at', null)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (leadRow && (leadRow as any).status !== lastStageMatch.stage_id) {
              const leadId = (leadRow as any).id;
              const oldStage = (leadRow as any).status;
              await supabase
                .from('leads')
                .update({ status: lastStageMatch.stage_id, updated_at: new Date().toISOString() } as any)
                .eq('id', leadId);
              console.log('[label-trigger][stage] lead moved by WA label', { leadId, from: oldStage, to: lastStageMatch.stage_id, via: lastStageMatch.label_name });
              // Registra histórico
              try {
                await supabase.from('lead_stage_history').insert({
                  lead_id: leadId,
                  from_stage: oldStage,
                  to_stage: lastStageMatch.stage_id,
                  board_id: lastStageMatch.board_id,
                  changed_by: null,
                  source: 'whatsapp_label',
                } as any);
              } catch (e: any) {
                console.warn('[label-trigger][stage] history insert failed:', e?.message);
              }
            } else if (leadRow) {
              console.log('[label-trigger][stage] lead já está no stage correto, skipping', { leadId: (leadRow as any).id, stage: lastStageMatch.stage_id });
            } else {
              // === NOVO: nenhum lead nesse board com esse telefone → cria automaticamente
              console.log('[label-trigger][stage] no lead matched, auto-creating', { phone: phoneDigits, board: lastStageMatch.board_id, label: lastStageMatch.label_name });
              try {
                // Tenta puxar nome do contato (qualquer instância) pra batizar o lead
                let leadName: string | null = null;
                const cleanName = (s: any) => {
                  const v = (s == null ? '' : String(s)).trim();
                  if (!v) return null;
                  // Rejeita nomes que são só dígitos/telefone
                  const digits = v.replace(/\D/g, '');
                  if (digits.length >= 8 && digits.length >= v.replace(/\s/g, '').length - 3) return null;
                  return v;
                };
                try {
                  const { data: contacts } = await supabase
                    .from('contacts')
                    .select('full_name, push_name, updated_at')
                    .like('phone', `%${last8}`)
                    .order('updated_at', { ascending: false })
                    .limit(5);
                  for (const c of (contacts as any[] | null) || []) {
                    leadName = cleanName(c?.full_name) || cleanName(c?.push_name);
                    if (leadName) break;
                  }
                } catch {}
                if (!leadName) {
                  // Fallback: nome da última mensagem com contact_name (qualquer instância)
                  try {
                    const { data: msgs } = await supabase
                      .from('whatsapp_messages')
                      .select('contact_name')
                      .like('phone', `%${last8}`)
                      .not('contact_name', 'is', null)
                      .order('created_at', { ascending: false })
                      .limit(10);
                    for (const m of (msgs as any[] | null) || []) {
                      leadName = cleanName(m?.contact_name);
                      if (leadName) break;
                    }
                  } catch {}
                }
                if (!leadName) {
                  // Fallback final: consulta UazAPI /chat/details pra puxar nome direto do WhatsApp
                  try {
                    const { data: inst } = await supabase
                      .from('whatsapp_instances')
                      .select('instance_token, base_url')
                      .ilike('instance_name', webhookInstanceName)
                      .limit(1)
                      .maybeSingle();
                    const token = (inst as any)?.instance_token;
                    const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
                    if (token) {
                      const ctrl = new AbortController();
                      const timer = setTimeout(() => ctrl.abort(), 5000);
                      try {
                        const r = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/details`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', token },
                          body: JSON.stringify({ number: phoneDigits, preview: false }),
                          signal: ctrl.signal,
                        });
                        if (r.ok) {
                          const data: any = await r.json().catch(() => null);
                          const chat = data?.chat || data || {};
                          leadName =
                            cleanName(chat?.wa_contactName) ||
                            cleanName(chat?.wa_name) ||
                            cleanName(chat?.name) ||
                            cleanName(chat?.lead_name) ||
                            cleanName(chat?.pushName) ||
                            cleanName(chat?.wa_chatName);
                        }
                      } finally {
                        clearTimeout(timer);
                      }
                    }
                  } catch (e: any) {
                    console.warn('[label-trigger][stage] UazAPI /chat/details falhou:', e?.message);
                  }
                }
                if (!leadName) {
                  // Sem nome real disponível: aborta criação automática deste lead,
                  // mas mantém o restante do webhook funcionando.
                  // O lead será criado quando o contato for registrado ou quando
                  // chegar mensagem com contact_name preenchido.
                  console.warn('[label-trigger][stage] auto-create abortado: nome do cliente não disponível', { phone: phoneDigits, instance: webhookInstanceName });
                  throw new Error('skip_autocreate_no_name');
                }

                const { data: newLead, error: createErr } = await supabase
                  .from('leads')
                  .insert({
                    lead_name: leadName,
                    lead_phone: phoneDigits,
                    board_id: lastStageMatch.board_id,
                    status: lastStageMatch.stage_id,
                    source: `WhatsApp · etiqueta "${lastStageMatch.label_name}"`,
                  } as any)
                  .select('id')
                  .single();

                if (createErr) {
                  console.warn('[label-trigger][stage] auto-create failed:', createErr.message);
                } else {
                  const newLeadId = (newLead as any).id;
                  console.log('[label-trigger][stage] lead auto-created via WA label', { leadId: newLeadId, board: lastStageMatch.board_id, stage: lastStageMatch.stage_id, label: lastStageMatch.label_name });
                  try {
                    await supabase.from('lead_stage_history').insert({
                      lead_id: newLeadId,
                      from_stage: null,
                      to_stage: lastStageMatch.stage_id,
                      board_id: lastStageMatch.board_id,
                      changed_by: null,
                      source: 'whatsapp_label_autocreate',
                    } as any);
                  } catch (e: any) {
                    console.warn('[label-trigger][stage] history insert (autocreate) failed:', e?.message);
                  }
                }
              } catch (e: any) {
                console.warn('[label-trigger][stage] auto-create block failed:', e?.message);
              }
            }
          }
        } catch (e: any) {
          console.warn('[label-trigger][stage] block failed:', e?.message);
        }


        if (!triggers || triggers.length === 0) {
          if (matchedAgentLabels.length > 0) {
            return res.json({ success: true, type: 'agent_activated_via_label_sync', count: matchedAgentLabels.length, labels: matchedAgentLabels.map((m: any) => m.label_name) });
          }
          return res.json({ success: true, skipped: true, reason: 'no_triggers_for_instance' });
        }

        const matched = triggers.filter((t: any) => {
          const triggerLabelId = String(t.label_id).split(':').pop() || String(t.label_id);
          return normalizedWaLabels.includes(triggerLabelId);
        });
        console.log('[label-trigger] matching', { waLabels, normalizedWaLabels, triggerCount: triggers.length, matchedCount: matched.length, agentLabelSyncMatches: matchedAgentLabels.length });

        if (matched.length === 0) {
          if (matchedAgentLabels.length > 0) {
            return res.json({ success: true, type: 'agent_activated_via_label_sync', count: matchedAgentLabels.length, labels: matchedAgentLabels.map((m: any) => m.label_name) });
          }
          return res.json({ success: true, skipped: true, reason: 'no_matching_label_trigger' });
        }

        // Dispara prepare-label-document-trigger pra cada match e registra o resultado.
        const railwayBase = process.env.RAILWAY_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
        const apiKey = process.env.RAILWAY_API_KEY || '';
        const dispatchResults: any[] = [];
        for (const t of matched) {
          // 1) Se o gatilho tem agente vinculado, ativa-o na conversa (igual auto_swap_agent_on_stage_change)
          //    POLÍTICA: só ativa o bot quando a etiqueta é a etapa "Documentos p/ Protocolo".
          //    Qualquer outra etiqueta de etapa NÃO deve ligar o agente automaticamente.
          if ((t as any).agent_id) {
            const labelNameNorm = String((t as any).label_name || '')
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '');
            const isProtocoloStage =
              labelNameNorm.includes('documentos p/ protocolo') ||
              labelNameNorm.includes('documentos para protocolo') ||
              labelNameNorm.includes('documentos p protocolo');
            if (!isProtocoloStage) {
              console.log('[label-trigger] agent activation skipped — etiqueta não é "Documentos p/ Protocolo"', { label: (t as any).label_name });
            } else {
            try {
              const last8 = phoneDigits.slice(-8);
              const { error: agentErr } = await supabase
                .from('whatsapp_conversation_agents')
                .upsert({
                  phone: phoneDigits,
                  instance_name: webhookInstanceName,
                  agent_id: (t as any).agent_id,
                  is_active: true,
                  human_paused_until: null,
                  activated_by: 'label_trigger',
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'phone,instance_name' });
              if (agentErr) {
                // Fallback: tenta update por LIKE em telefone (algumas linhas têm formato variável)
                await supabase
                  .from('whatsapp_conversation_agents')
                  .update({
                    agent_id: (t as any).agent_id,
                    is_active: true,
                    human_paused_until: null,
                    activated_by: 'label_trigger',
                  })
                  .ilike('instance_name', webhookInstanceName)
                  .like('phone', `%${last8}`);
              }
              console.log('[label-trigger] agent activated', { phone: phoneDigits, agent_id: (t as any).agent_id });
              // Dispara 1ª mensagem proativa se o agente tiver configurado
              triggerProactiveFirstMessage(supabase, phoneDigits, webhookInstanceName, (t as any).agent_id).catch(err => console.warn('[proactive] trigger error:', err?.message));
            } catch (e: any) {
              console.warn('[label-trigger] agent activation failed:', e?.message);
            }
            }
          }


          // 2) Se tem template ZapSign, dispara o preparo da procuração (comportamento antigo)
          if (!t.zapsign_template_id) {
            dispatchResults.push({ label: t.label_name, ok: true, skipped: 'no_template_only_agent' });
            continue;
          }
          const payload = {
            chatId,
            phone: phoneDigits,
            instance: webhookInstanceName,
            labelName: t.label_name,
            templateId: t.zapsign_template_id,
            triggerId: t.id,
          };
          try {
            const dispatchResponse = await fetch(`${railwayBase}/functions/prepare-label-document-trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
              body: JSON.stringify(payload),
            });
            const dispatchJson = await dispatchResponse.json().catch(() => null);
            dispatchResults.push({ label: t.label_name, ok: dispatchResponse.ok, status: dispatchResponse.status, result: dispatchJson });
            console.log('[label-trigger] dispatched', { chatId, label: t.label_name, instance: webhookInstanceName, status: dispatchResponse.status, result: dispatchJson });
          } catch (e: any) {
            dispatchResults.push({ label: t.label_name, ok: false, error: e?.message });
            console.warn('[label-trigger] dispatch failed:', e?.message);
          }
        }

        return res.json({ success: true, type: 'label_triggered', count: matched.length, labels: matched.map((m: any) => m.label_name), dispatchResults });
      } catch (e: any) {
        console.error('[label-trigger] handler error:', e);
        return res.json({ success: false, error: e?.message || 'label handler failed' });
      }
    }

    logWebhook('received', { detected_event_type: eventType, body_type: bodyType, is_call_event: isCallEvent, keys: Object.keys(body).join(',') });

    // Group detection
    const chatId = body.chat?.wa_chatid || body.message?.chatid || '';
    const isGroup = body.chat?.wa_isGroup === true || chatId.includes('@g.us');
    const groupMessageText = body.message?.text || body.message?.content?.text || body.message?.content || '';
    const groupMsgStr = typeof groupMessageText === 'string' ? groupMessageText.trim() : '';
    const isFromMe = body.message?.fromMe === true || body.chat?.fromMe === true;

    // Skip reactions
    const msgType = (body.message?.messageType || body.chat?.wa_lastMessageType || '').toLowerCase();
    if (msgType === 'reactionmessage' || msgType === 'protocolmessage') {
      return res.json({ success: true, skipped: true, reason: 'reaction_or_protocol_filtered' });
    }

    console.log('WhatsApp webhook payload:', JSON.stringify(body).substring(0, 2000));

    // Pause check
    if (webhookInstanceName) {
      const { data: inst } = await supabase.from('whatsapp_instances').select('is_paused').eq('instance_name', webhookInstanceName).limit(1).maybeSingle();
      if (inst?.is_paused) {
        console.log(`Instance "${webhookInstanceName}" is PAUSED.`);
        return res.json({ success: true, skipped: true, reason: 'instance_paused' });
      }
    }

    // Call event handling
    if (isCallEvent) {
      console.log('Detected CALL event, processing...');
      const callRecord = await handleCallEvent(supabase, body);
      const resp = { success: true, type: 'call', call_record_id: callRecord?.id || null };
      await logWebhook('call_processed', resp);
      return res.json(resp);
    }

    // ========== MESSAGE HANDLING ==========
    let rawPhone = '';
    let contactName: string | null = null;
    let messageText: string | null = null;
    let messageType = 'text';
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    let mediaKey: string | null = null;
    let direction = 'inbound';
    let externalMessageId: string | null = null;
    let instanceName: string | null = null;
    let instanceToken: string | null = null;
    let baseUrl: string | null = null;

    if (body.EventType && body.chat) {
      // UazAPI format
      console.log('Detected UazAPI format, EventType:', body.EventType);
      instanceName = body.instanceName || body.chat?.instanceName || null;
      instanceToken = body.token || body.chat?.token || null;
      baseUrl = body.BaseUrl || null;

      // Canonicalize instance by token, then fallback by name (case-insensitive)
      let canonicalized = false;
      if (instanceToken) {
        const { data: canonicalInstance } = await supabase
          .from('whatsapp_instances').select('instance_name, base_url')
          .eq('instance_token', instanceToken).eq('is_active', true).limit(1).maybeSingle();
        if (canonicalInstance) {
          if (instanceName && instanceName !== canonicalInstance.instance_name) {
            console.log('Instance alias mismatch. Payload:', instanceName, 'Canonical:', canonicalInstance.instance_name);
          }
          instanceName = canonicalInstance.instance_name;
          baseUrl = baseUrl || canonicalInstance.base_url;
          canonicalized = true;
        }
      }
      // Fallback: canonicalize by name (case-insensitive) when token lookup fails
      if (!canonicalized && instanceName) {
        const { data: nameMatch } = await supabase
          .from('whatsapp_instances').select('instance_name, base_url')
          .ilike('instance_name', instanceName).eq('is_active', true).limit(1).maybeSingle();
        if (nameMatch) {
          if (nameMatch.instance_name !== instanceName) {
            console.log('Instance name case mismatch. Payload:', instanceName, 'Canonical:', nameMatch.instance_name);
          }
          instanceName = nameMatch.instance_name;
          baseUrl = baseUrl || nameMatch.base_url;
        }
      }

      console.log('Instance:', instanceName, 'Token:', instanceToken?.substring(0, 8), 'BaseUrl:', baseUrl);

      // Auto-save owner_phone
      const ownerFromWebhook = body.chat?.owner || body.owner || null;
      if (instanceName && ownerFromWebhook) {
        const cleanOwnerPhone = ownerFromWebhook.replace('@s.whatsapp.net', '');
        supabase.from('whatsapp_instances').update({ owner_phone: cleanOwnerPhone })
          .eq('instance_name', instanceName).is('owner_phone', null)
          .then(({ error: upErr }: any) => { if (!upErr) console.log(`Auto-saved owner_phone ${cleanOwnerPhone} for ${instanceName}`); });
      }

      // Call events in message types
      const lastMsgType = (body.chat?.wa_lastMessageType || '').toLowerCase();
      const msgMessageType = (body.message?.messageType || '').toLowerCase();
      const isCallInMessage = lastMsgType.includes('call') || msgMessageType.includes('call');
      if (isCallInMessage) {
        console.log('Detected call event via messageType/wa_lastMessageType');
        const callRecord = await handleCallEvent(supabase, body);
        return res.json({ success: true, type: 'call', call_record_id: callRecord?.id || null });
      }

      if (body.EventType !== 'messages') {
        const callRelated = body.EventType === 'call' || body.EventType === 'calls' || body.EventType === 'call_log';
        if (callRelated) {
          const callRecord = await handleCallEvent(supabase, body);
          return res.json({ success: true, type: 'call', call_record_id: callRecord?.id || null });
        }
        console.log('SKIPPING non-message, non-call EventType:', body.EventType);
        await logWebhook('skipped_' + (body.EventType || 'unknown'));
        return res.json({ success: true, skipped: true, reason: `EventType ${body.EventType} ignored` });
      }

      const chatIdInner = body.chat?.wa_chatid || body.message?.chatid || body.chat?.id || '';
      rawPhone = chatIdInner.replace('@s.whatsapp.net', '').replace('@g.us', '');
      contactName = body.chat?.name || body.chat?.pushName || body.senderName || null;

      const msg = body.message || body.chat?.message || {};
      if (typeof msg === 'string') {
        messageText = msg;
      } else {
        const rawContent = msg.content;
        let contentText: string | null = null;
        if (typeof rawContent === 'object' && rawContent !== null) {
          if (rawContent.URL) mediaUrl = rawContent.URL;
          contentText = rawContent.text || rawContent.conversation || null;
        } else if (typeof rawContent === 'string') {
          contentText = rawContent;
        }
        messageText = msg.text || contentText || msg.conversation
          || msg.extendedTextMessage?.text || msg.imageMessage?.caption
          || msg.videoMessage?.caption || msg.documentMessage?.caption || null;
        if (messageText && typeof messageText !== 'string') messageText = JSON.stringify(messageText);
      }

      // Detect media type + mediaKey (for local AES decrypt fallback)
      const rawContentObj = (typeof msg.content === 'object' && msg.content !== null) ? msg.content : null;
      if (msg.imageMessage) {
        messageType = 'image'; mediaType = msg.imageMessage.mimetype || 'image/jpeg'; mediaUrl = mediaUrl || msg.imageMessage.url || null;
        mediaKey = msg.imageMessage.mediaKey || mediaKey;
      } else if (msg.videoMessage) {
        messageType = 'video'; mediaType = msg.videoMessage.mimetype || 'video/mp4'; mediaUrl = mediaUrl || msg.videoMessage.url || null;
        mediaKey = msg.videoMessage.mediaKey || mediaKey;
      } else if (msg.audioMessage) {
        messageType = 'audio'; mediaType = msg.audioMessage.mimetype || 'audio/ogg'; mediaUrl = mediaUrl || msg.audioMessage.url || null;
        mediaKey = msg.audioMessage.mediaKey || mediaKey;
      } else if (msg.documentMessage) {
        messageType = 'document'; mediaType = msg.documentMessage.mimetype || null; mediaUrl = mediaUrl || msg.documentMessage.url || null;
        mediaKey = msg.documentMessage.mediaKey || mediaKey;
      } else if (msg.mediaType || (typeof msg.content === 'object' && msg.content?.URL)) {
        const uazMediaType = (msg.mediaType || '').toLowerCase();
        const chatLastMsgType = (body.chat?.wa_lastMessageType || '').toLowerCase();
        if (uazMediaType.includes('audio') || uazMediaType.includes('ptt') || chatLastMsgType.includes('audio')) {
          messageType = 'audio'; mediaType = msg.mimetype || 'audio/ogg; codecs=opus';
        } else if (uazMediaType.includes('image') || chatLastMsgType.includes('image')) {
          messageType = 'image'; mediaType = msg.mimetype || 'image/jpeg';
        } else if (uazMediaType.includes('video') || chatLastMsgType.includes('video')) {
          messageType = 'video'; mediaType = msg.mimetype || 'video/mp4';
        } else if (uazMediaType.includes('document') || uazMediaType.includes('sticker') || chatLastMsgType.includes('document') || chatLastMsgType.includes('sticker')) {
          messageType = 'document'; mediaType = msg.mimetype || null;
        } else if (mediaUrl) {
          messageType = 'document'; mediaType = msg.mimetype || null;
        }
        if (!messageText && messageType !== 'text') messageText = null;
      }
      if (!mediaKey && rawContentObj) mediaKey = rawContentObj.mediaKey || rawContentObj.media_key || null;
      if (!mediaKey) mediaKey = findMediaKeyDeep(msg) || findMediaKeyDeep(body.message) || findMediaKeyDeep(body.chat?.message) || findMediaKeyDeep(body.chat) || null;
      if (messageType !== 'text') {
        console.log('Media parse debug:', {
          messageType,
          mediaType,
          hasMediaUrl: !!mediaUrl,
          mediaUrlIsEnc: isEncryptedWhatsAppUrl(mediaUrl),
          hasMediaKey: !!mediaKey,
          externalMessageId,
        });
      }

      // Direction
      const fromMeFlag = body.message?.fromMe === true || body.chat?.fromMe === true;
      const chatIdRaw = body.chat?.wa_chatid || body.message?.chatid || '';
      const isLidChat = chatIdRaw.includes('@lid');
      if (fromMeFlag && isLidChat) {
        console.log(`Direction correction: fromMe=true but @lid chat detected, forcing inbound`);
        direction = 'inbound';
      } else {
        direction = fromMeFlag ? 'outbound' : 'inbound';
      }
      externalMessageId = body.message?.id || body.message?.messageid || body.chat?.id_message || null;
    } else {
      rawPhone = body.phone || body.from || body.sender || body.remoteJid || '';
      contactName = body.contact_name || body.pushName || body.senderName || body.name || null;
      messageText = body.message || body.text || body.body || body.content || null;
      messageType = body.message_type || body.type || 'text';
      mediaUrl = body.media_url || body.mediaUrl || null;
      mediaType = body.media_type || body.mediaType || null;
      direction = body.direction || 'inbound';
      externalMessageId = body.message_id || body.messageId || body.id || null;
      instanceName = body.instance_name || null;
      instanceToken = body.instance_token || null;
    }

    const phone = rawPhone.replace(/\D/g, '').replace(/^0+/, '');

    // Sanitize contact_name
    if (contactName) {
      const cleaned = contactName.replace(/^WhatsApp\s+/i, '').replace(/\s*\|.*$/, '').trim();
      if (/^\+?\d[\d\s\-()]{6,}$/.test(cleaned)) contactName = null;
      else if (/^WhatsApp\s+\d/i.test(contactName)) contactName = null;
    }
    if (!phone) return res.status(400).json({ success: false, error: 'No phone number provided' });

    console.log('Parsed message:', { phone, contactName, messageText: messageText?.substring(0, 100), direction, messageType, instanceName });

    // ========== MUTED CHAT CHECK ==========
    if (phone && instanceName) {
      try {
        const cloudClient = createClient(CLOUD_FUNCTIONS_URL, CLOUD_ANON_KEY);
        const { data: muteRecord } = await cloudClient
          .from('whatsapp_muted_chats').select('mute_type').eq('phone', phone).eq('instance_name', instanceName).maybeSingle();
        if (muteRecord) {
          const mt = muteRecord.mute_type || 'all';
          const shouldBlock = mt === 'all' || (mt === 'receive' && direction === 'inbound') || (mt === 'send' && direction === 'outbound');
          if (shouldBlock) {
            console.log(`Chat MUTED (${mt}): phone=${phone}, instance=${instanceName}`);
            return res.json({ success: true, skipped: true, reason: 'chat_muted', mute_type: mt });
          }
        }
      } catch (muteErr) { console.warn('Mute check failed, continuing:', muteErr); }
    }

    // ========== DOWNLOAD AND STORE MEDIA ==========
    let storedMediaUrl = mediaUrl;
    let mediaTranscription: string | null = null;
    const isMediaMessage = messageType === 'image' || messageType === 'audio' || messageType === 'video' || messageType === 'document';
    // Baixa mídia de TODAS as conversas (incluindo grupos) — transcreve áudio e gera link permanente
    if ((mediaUrl || isMediaMessage) && messageType !== 'text' && externalMessageId) {
      let resolvedToken = instanceToken;
      let resolvedBaseUrl = baseUrl;
      if (instanceName && (!resolvedToken || !resolvedBaseUrl)) {
        const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).single();
        if (inst) { resolvedToken = resolvedToken || inst.instance_token; resolvedBaseUrl = resolvedBaseUrl || inst.base_url; }
      }
      if (resolvedToken && resolvedBaseUrl) {
        const mediaDownload = await downloadAndStoreMedia(supabase, externalMessageId, instanceName || 'unknown', mediaUrl || '', mediaType || 'application/octet-stream', messageType, resolvedBaseUrl, resolvedToken, mediaKey);
        mediaTranscription = mediaDownload.transcription;
        if (mediaDownload.contentType) mediaType = mediaDownload.contentType;
        if (mediaDownload.publicUrl) { storedMediaUrl = mediaDownload.publicUrl; console.log('Media stored at:', mediaDownload.publicUrl); }
        else if (mediaDownload.encryptedSource) {
          storedMediaUrl = null;
          console.error('Media download/decrypt failed for encrypted source; not saving .enc URL as playable media', {
            externalMessageId,
            messageType,
            instanceName,
            hasMediaKey: !!mediaKey,
          });
        } else console.log('Media download failed, keeping original URL');
      } else console.log('No instance token/baseUrl for media download');
    }

    if (messageType === 'audio' && !messageText && mediaTranscription) {
      messageText = mediaTranscription;
      console.log('Using audio transcription as message_text:', messageText.substring(0, 120));
    }

    // ========== FIND CONTACT/LEAD ==========
    let contactId: string | null = null;
    let leadId: string | null = null;
    const normalizedPhone = phone.replace(/\D/g, '');
    const last8Digits = normalizedPhone.slice(-8);
    const phoneVariants = Array.from(new Set([phone, normalizedPhone, `+${normalizedPhone}`, normalizedPhone.replace(/^55/, ''), last8Digits].filter(Boolean)));

    for (const variant of phoneVariants) {
      const { data: contacts } = await supabase.from('contacts').select('id, lead_id').or(`phone.ilike.%${variant}`).limit(1);
      if (contacts && contacts.length > 0) { contactId = contacts[0].id; leadId = contacts[0].lead_id; break; }
    }
    if (!leadId) {
      for (const variant of phoneVariants) {
        const { data: leads } = await supabase.from('leads').select('id').or(`lead_phone.ilike.%${variant}`).limit(1);
        if (leads && leads.length > 0) { leadId = leads[0].id; break; }
      }
    }
    if (leadId && !contactId) {
      for (const variant of phoneVariants) {
        const { data: linkedContacts } = await supabase.from('contacts').select('id').eq('lead_id', leadId).or(`phone.ilike.%${variant}`).limit(1);
        if (linkedContacts && linkedContacts.length > 0) { contactId = linkedContacts[0].id; break; }
      }
    }

    // ========== AUTO-REGISTER CONTACT ==========
    // Guarda dupla: !isGroup (vindo do payload) + checagem por formato do
    // número. JIDs de grupo são >=17 dígitos e tipicamente começam com 120363.
    const looksLikeGroupJid = normalizedPhone.length >= 17 || normalizedPhone.startsWith('120363');
    if (!contactId && direction === 'inbound' && normalizedPhone.length >= 10 && !isGroup && !looksLikeGroupJid) {
      try {
        const { data: ownInstances } = await supabase.from('whatsapp_instances').select('owner_phone').eq('is_active', true);
        const instancePhones = (ownInstances || []).map((i: any) => (i.owner_phone || '').replace(/\D/g, '')).filter(Boolean);
        const isOurInstance = instancePhones.some((ip: string) =>
          normalizedPhone.endsWith(ip) || ip.endsWith(normalizedPhone) || normalizedPhone.slice(-8) === ip.slice(-8)
        );

        if (!isOurInstance) {
          const location = getLocationFromDDD(normalizedPhone);
          const autoContactName = contactName || normalizedPhone;
          let responsibleUserId: string | null = null;
          if (leadId) {
            const { data: leadData } = await supabase.from('leads').select('acolhedor').eq('id', leadId).maybeSingle();
            if (leadData?.acolhedor) {
              const { data: profile } = await supabase.from('profiles').select('user_id').ilike('full_name', leadData.acolhedor).limit(1).maybeSingle();
              responsibleUserId = profile?.user_id || null;
            }
          }
          const { data: newContact } = await supabase.from('contacts').insert({
            full_name: autoContactName, phone: normalizedPhone,
            city: location?.city || null, state: location?.state || null,
            classification: 'prospect', created_by: responsibleUserId,
            action_source: 'system', action_source_detail: `Auto-registro via WhatsApp (${instanceName || 'unknown'})`,
          }).select('id').single();
          if (newContact) { contactId = newContact.id; console.log(`Auto-registered contact ${autoContactName} → ${contactId}`); }
        }
      } catch (autoRegErr: any) { console.warn('Auto-register contact error:', autoRegErr.message); }
    }

    // ========== CTWA AD TRACKING ==========
    let detectedCampaignId: string | null = null;
    let detectedCampaignName: string | null = null;
    if (direction === 'inbound') {
      try {
        const msg = body.message || body.chat?.message || {};
        const msgContent = msg.content || msg.extendedTextMessage || {};
        const contextInfo = msgContent.contextInfo || msg.contextInfo || msg.imageMessage?.contextInfo || msg.videoMessage?.contextInfo || {};
        const externalAdReply = contextInfo.externalAdReply || null;
        const ctwaSourceId = externalAdReply?.sourceID || externalAdReply?.sourceId || contextInfo.ctwaContext?.sourceId || null;
        const ctwaClid = contextInfo.ctwaContext?.ctwaClid || contextInfo.ctwaClid || null;
        const isTrueCTWA = !!(ctwaSourceId || ctwaClid);

        if (externalAdReply && isTrueCTWA) {
          console.log('CTWA sourceID resolved:', ctwaSourceId, 'ctwa_clid:', ctwaClid);
          const { data: allCampaignLinks } = await supabase.from('whatsapp_agent_campaign_links').select('*').eq('is_active', true);
          let matchedCampaignLink: any = null;

          if (allCampaignLinks && allCampaignLinks.length > 0) {
            const links = allCampaignLinks as any[];
            if (ctwaSourceId) {
              matchedCampaignLink = links.find(l => l.campaign_id === ctwaSourceId);
              if (!matchedCampaignLink) {
                matchedCampaignLink = links.find(l => ctwaSourceId.startsWith(l.campaign_id) || l.campaign_id.startsWith(ctwaSourceId));
              }
            }
            if (!matchedCampaignLink) {
              matchedCampaignLink = links[0]; // fallback to first active
            }
          }

          if (matchedCampaignLink) {
            detectedCampaignId = matchedCampaignLink.campaign_id;
            detectedCampaignName = matchedCampaignLink.campaign_name || null;
            console.log('CTWA campaign matched:', detectedCampaignId);
          }
        }
      } catch (ctwaErr) { console.error('CTWA extraction error:', ctwaErr); }
    }

    // ========== DEDUPLICATION / MEDIA REPAIR ==========
    if (externalMessageId) {
      const dedupeQuery = supabase
        .from('whatsapp_messages')
        .select('id, instance_name, media_url, media_type, message_text')
        .eq('external_message_id', externalMessageId)
        .limit(1);
      const scopedQuery = instanceName ? dedupeQuery.eq('instance_name', instanceName) : dedupeQuery;
      const { data: existing } = await scopedQuery.maybeSingle();
      if (existing) {
        const updates: Record<string, any> = {};
        const existingMediaUrl = (existing as any).media_url || null;
        const existingMissingMedia = isMediaMessage && (!existingMediaUrl || isEncryptedWhatsAppUrl(existingMediaUrl));

        // History/media re-sync replays the same message id. In that case the
        // webhook must repair the existing row instead of skipping it as a dup.
        if (existingMissingMedia && storedMediaUrl && !isEncryptedWhatsAppUrl(storedMediaUrl)) {
          updates.media_url = storedMediaUrl;
        }
        if (mediaType && mediaType !== (existing as any).media_type) {
          updates.media_type = mediaType;
        }
        if (messageType === 'audio' && mediaTranscription && !(existing as any).message_text) {
          updates.message_text = mediaTranscription;
        }

        if (Object.keys(updates).length > 0) {
          const { error: repairErr } = await supabase.from('whatsapp_messages').update(updates).eq('id', (existing as any).id);
          if (repairErr) {
            console.error('Duplicate media repair failed:', repairErr);
            return res.json({ success: false, error: repairErr.message, existing_id: (existing as any).id });
          }
          console.log('Duplicate message repaired with media:', externalMessageId, updates);
          return res.json({ success: true, repaired: true, existing_id: (existing as any).id, updates: Object.keys(updates) });
        }

        console.log('Duplicate message detected, skipping:', externalMessageId);
        return res.json({ success: true, skipped: true, reason: 'duplicate', existing_id: (existing as any).id });
      }
    }

    // ========== OUTBOUND ECHO DEDUP ==========
    if (direction === 'outbound' && messageText && instanceName && phone) {
      try {
        const echoWindow = new Date(Date.now() - 120000).toISOString();
        const { data: aiEcho } = await supabase
          .from('whatsapp_messages').select('id').eq('phone', phone).eq('instance_name', instanceName)
          .eq('direction', 'outbound').eq('message_text', messageText).gte('created_at', echoWindow).limit(1).maybeSingle();
        if (aiEcho) {
          console.log(`Outbound echo detected (exact match), skipping for ${phone}`);
          return res.json({ success: true, skipped: true, reason: 'ai_echo_dedup', existing_id: aiEcho.id });
        }
        const trimmedEcho = (messageText || '').trim();
        if (trimmedEcho.length >= 10) {
          const { data: parentMsg } = await supabase
            .from('whatsapp_messages').select('id, message_text').eq('phone', phone).eq('instance_name', instanceName)
            .eq('direction', 'outbound').eq('action_source', 'agent').gte('created_at', echoWindow)
            .order('created_at', { ascending: false }).limit(5);
          const isPartOfAgent = (parentMsg || []).some((m: any) => m.message_text && m.message_text.includes(trimmedEcho));
          if (isPartOfAgent) {
            console.log(`Outbound echo detected (split part), skipping for ${phone}`);
            return res.json({ success: true, skipped: true, reason: 'ai_echo_split_dedup' });
          }
        }
      } catch (e) { console.error('Outbound echo dedup error:', e); }
    }

    // ========== INSERT MESSAGE ==========
    const { data: message, error } = await supabase
      .from('whatsapp_messages')
      .insert({
        phone, contact_name: contactName, message_text: messageText, message_type: messageType,
        media_url: storedMediaUrl, media_type: mediaType, direction,
        status: direction === 'inbound' ? 'received' : 'sent',
        contact_id: contactId, lead_id: leadId, external_message_id: externalMessageId,
        metadata: body, instance_name: instanceName, instance_token: instanceToken,
        campaign_id: detectedCampaignId || null, campaign_name: detectedCampaignName || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting message:', error);
      return res.status(400).json({ success: false, error: error.message });
    }

    console.log('Message saved:', message.id, 'Contact:', contactId, 'Lead:', leadId, 'Instance:', instanceName);

    // ========== AUTO-ACTIVATE DEFAULT AGENT ==========
    // Se a instância tem default_agent_id e ainda não há agente ativado para essa conversa,
    // cria a linha em whatsapp_conversation_agents automaticamente. Sem isso, o agente
    // nunca responde mesmo com default_agent_id configurado.
    if (direction === 'inbound' && instanceName && phone) {
      try {
        const { data: existingAgent } = await supabase
          .from('whatsapp_conversation_agents')
          .select('id')
          .eq('phone', phone)
          .eq('instance_name', instanceName)
          .maybeSingle();
        if (!existingAgent) {
          const { data: inst } = await supabase
            .from('whatsapp_instances')
            .select('default_agent_id')
            .eq('instance_name', instanceName)
            .maybeSingle();
          if (inst?.default_agent_id) {
            await supabase.from('whatsapp_conversation_agents').upsert({
              phone,
              instance_name: instanceName,
              agent_id: inst.default_agent_id,
              is_active: true,
              activated_by: 'default_instance',
            }, { onConflict: 'phone,instance_name' });
            console.log('[default-agent] activated', inst.default_agent_id, 'for', phone, '@', instanceName);
          }
        }
      } catch (e) {
        console.error('[default-agent] auto-activate error:', e);
      }
    }


    // ========== AUTO-ENRICH LEAD/CONTACT (parity with Cloud) ==========
    if (!isGroup && direction === 'inbound' && instanceName && phone && (leadId || contactId) && CLOUD_FUNCTIONS_URL && CLOUD_ANON_KEY) {
      // Fire and forget — don't block webhook response
      fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/auto-enrich-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CLOUD_ANON_KEY}`,
        },
        body: JSON.stringify({ phone, instance_name: instanceName, lead_id: leadId, contact_id: contactId }),
      }).catch((e) => console.error('[auto-enrich] fire-and-forget error:', e));
    }

    // ========== PROGRESSIVE CONTACT DATA UPDATE ==========
    if (contactId && direction === 'inbound' && !isGroup) {
      try {
        const { data: existingContact } = await supabase.from('contacts').select('full_name, city, state, phone').eq('id', contactId).maybeSingle();
        if (existingContact) {
          const updates: Record<string, any> = {};
          const currentName = existingContact.full_name || '';
          const isNameJustPhone = /^\+?\d[\d\s\-()]*$/.test(currentName.trim());
          if (contactName && contactName.trim() && isNameJustPhone && !/^\+?\d[\d\s\-()]*$/.test(contactName.trim())) {
            updates.full_name = contactName.trim();
          }
          const contactPhone = existingContact.phone || normalizedPhone;
          if (!existingContact.state || !existingContact.city) {
            const location = getLocationFromDDD(contactPhone);
            if (location) {
              if (!existingContact.state) updates.state = location.state;
              if (!existingContact.city) updates.city = location.city;
            }
          }
          if (Object.keys(updates).length > 0) {
            await supabase.from('contacts').update(updates).eq('id', contactId);
            console.log('Progressive contact update:', contactId, JSON.stringify(updates));
          }
        }
      } catch (progressiveErr: any) { console.warn('Progressive contact update error:', progressiveErr.message); }
    }

    // ========== AUTO-CREATE CONTACT FOR INSTANCE'S OWN PHONE ==========
    if (direction === 'outbound' && instanceName && !isGroup) {
      try {
        const { data: inst } = await supabase.from('whatsapp_instances').select('owner_phone, instance_name').eq('instance_name', instanceName).maybeSingle();
        if (inst?.owner_phone) {
          const instPhone = inst.owner_phone.replace(/\D/g, '');
          if (instPhone.length >= 10) {
            const instLast8 = instPhone.slice(-8);
            const { data: existingInstContact } = await supabase.from('contacts').select('id').or(`phone.ilike.%${instLast8}%`).limit(1).maybeSingle();
            if (!existingInstContact) {
              const instLocation = getLocationFromDDD(instPhone);
              const { data: newInstContact } = await supabase.from('contacts').insert({
                full_name: inst.instance_name || instPhone, phone: instPhone,
                city: instLocation?.city || null, state: instLocation?.state || null,
                classification: 'interno', action_source: 'system',
                action_source_detail: `Auto-registro instância WhatsApp (${instanceName})`,
              }).select('id').single();
              if (newInstContact) console.log(`Auto-registered instance contact: ${instanceName} (${instPhone}) → ${newInstContact.id}`);
            }
          }
        }
      } catch (instContactErr: any) { console.warn('Auto-create instance contact error:', instContactErr.message); }
    }

    // ========== Cloud mirror REMOVED ==========
    // Single source of truth: external Supabase only. No mirror to Cloud.

    // ========== #SHORTCUT AGENT ACTIVATION ==========
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmedSingle = (messageText || '').trim();
      const lastLineSingle = trimmedSingle.split('\n').pop()?.trim() || trimmedSingle;
      const singleHashMatch = lastLineSingle.match(/^#([a-zA-Z0-9_]+)\s*$/);
      if (singleHashMatch && !lastLineSingle.startsWith('##')) {
        const shortcutName = singleHashMatch[1].toLowerCase();
        console.log('#shortcut agent activation detected:', shortcutName);

        try {
          const { data: shortcut } = await supabase
            .from('wjia_command_shortcuts').select('id, shortcut_name, is_active')
            .eq('shortcut_name', shortcutName).eq('is_active', true).maybeSingle();

          if (shortcut) {
            await supabase.from('whatsapp_conversation_agents').upsert({
              phone, instance_name: instanceName, agent_id: shortcut.id,
              is_active: true, activated_by: 'whatsapp_command', human_paused_until: null,
            }, { onConflict: 'phone,instance_name' });
            console.log('Agent activated via #shortcut:', shortcutName, 'agent_id:', shortcut.id);

            // Execute automations (fire-and-forget)
            fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/execute-agent-automations`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
              body: JSON.stringify({
                agent_id: shortcut.id, trigger_type: 'on_activation', phone,
                instance_name: instanceName, contact_name: contactName || '',
                is_group: isGroup, group_id: isGroup ? chatId : null,
              }),
            }).catch(err => console.error('#shortcut automation trigger error:', err));

            // Delete #command from WhatsApp
            if (externalMessageId) {
              let resolvedToken = instanceToken;
              let resolvedBaseUrl = baseUrl;
              if (!resolvedToken || !resolvedBaseUrl) {
                const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).maybeSingle();
                if (inst) { resolvedToken = resolvedToken || inst.instance_token; resolvedBaseUrl = resolvedBaseUrl || inst.base_url; }
              }
              if (resolvedToken && resolvedBaseUrl) {
                fetch(`${resolvedBaseUrl}/message/delete`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', token: resolvedToken },
                  body: JSON.stringify({ id: externalMessageId }),
                }).catch(e => console.error('Error deleting #shortcut message:', e));
              }
            }
            if (message?.id) await supabase.from('whatsapp_messages').delete().eq('id', message.id);

            // Trigger agent reply with last inbound
            const { data: lastInbound } = await supabase
              .from('whatsapp_messages').select('message_text, message_type').eq('phone', phone)
              .eq('instance_name', instanceName).eq('direction', 'inbound')
              .order('created_at', { ascending: false }).limit(1).maybeSingle();

            if (lastInbound) {
              (async () => {
                const verdict = await verifyAgentLabelBeforeSend(phone, instanceName);
                if (!verdict.allowed) {
                  console.log(`[#shortcut auto-reply] skipped (${verdict.reason}) phone=${phone}`);
                  return;
                }
                fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-ai-agent-reply`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
                  body: JSON.stringify({ phone, instance_name: instanceName, message_text: lastInbound.message_text || '', message_type: lastInbound.message_type || 'text' }),
                }).catch(err => console.error('#shortcut agent reply trigger error:', err));
              })();
            }

            const respData = { success: true, message_id: message?.id, shortcut_activated: true, agent_id: shortcut.id, instance_name: instanceName };
            await logWebhook('shortcut_agent_activated', respData);
            return res.json(respData);
          }
        } catch (e) { console.error('#shortcut activation error:', e); }
      }
    }

    // ========== COMMAND CONFIG CHECK (outbound from authorized phone in group) ==========
    // Route to command processor in Cloud
    if (isGroup && isFromMe && instanceName && phone) {
      const isGroupAgentCommand = groupMsgStr.match(/^#[a-z0-9_]+$/i);
      const isGroupWjiaCommand = groupMsgStr.toLowerCase().startsWith('@wjia');

      if (isGroupAgentCommand || isGroupWjiaCommand) {
        const senderPn = normalizePhone(body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || '');
        const ownerPn = normalizePhone(body?.message?.owner || body?.chat?.owner || body?.owner || '');
        const cmdLookupPhone = senderPn || ownerPn || phone;

        fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-command-processor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
          body: JSON.stringify({
            phone: cmdLookupPhone, instance_name: instanceName,
            message_text: messageText || '', media_url: storedMediaUrl || mediaUrl || null,
            message_type: messageType || 'text', is_group: true, group_id: phone,
          }),
        }).catch(err => console.error('Group command trigger error:', err));

        const respData = { success: true, message_id: message.id, command_routed: true, instance_name: instanceName };
        await logWebhook('group_command_routed', respData);
        return res.json(respData);
      }
    }

    // ========== COMMAND CONFIG CHECK (non-group, fromMe) ==========
    if (direction === 'outbound' && instanceName && phone && messageText && !isGroup) {
      // Check if sender is authorized for commands
      const senderPn = normalizePhone(body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || '');
      const ownerPn = normalizePhone(body?.message?.owner || body?.chat?.owner || body?.owner || '');
      const cmdLookupPhone = senderPn || ownerPn || phone;

      try {
        const { data: cmdConfigs } = await supabase
          .from('whatsapp_command_config').select('id, authorized_phone, instance_name')
          .eq('is_active', true).limit(50);

        const isAuthorized = (cmdConfigs || []).some((cfg: any) => {
          const authPhone = (cfg.authorized_phone || '').replace(/\D/g, '');
          const cfgInstance = cfg.instance_name;
          const phoneMatch = authPhone && (cmdLookupPhone.endsWith(authPhone) || authPhone.endsWith(cmdLookupPhone) || cmdLookupPhone.slice(-8) === authPhone.slice(-8));
          const instanceMatch = !cfgInstance || cfgInstance === instanceName;
          return phoneMatch && instanceMatch;
        });

        if (isAuthorized) {
          // Anti-loop check
          const antiLoopPrefix = '🤖 *WhatsJUD IA*';
          const msgTrimmed = (messageText || '').trim();
          if (msgTrimmed.startsWith(antiLoopPrefix)) {
            console.log('Anti-loop: skipping command for AI response');
          } else {
            fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-command-processor`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
              body: JSON.stringify({
                phone: cmdLookupPhone, instance_name: instanceName,
                message_text: messageText || '', media_url: storedMediaUrl || mediaUrl || null,
                message_type: messageType || 'text', is_group: false, group_id: null,
              }),
            }).catch(err => console.error('Command processor trigger error:', err));

            const respData = { success: true, message_id: message.id, command_routed: true, instance_name: instanceName };
            await logWebhook('command_routed', respData);
            return res.json(respData);
          }
        }
      } catch (e) { console.error('Command config check error:', e); }
    }

    // ========== @WJIA COMMAND DETECTION ==========
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmed = (messageText || '').trim();
      if (trimmed.toLowerCase().startsWith('@wjia')) {
        console.log('@wjia command detected, phone:', phone);
        fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/wjia-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
          body: JSON.stringify({ phone, instance_name: instanceName, command: trimmed, contact_id: contactId, lead_id: leadId }),
        }).catch(err => console.error('@wjia command trigger error:', err));

        // Delete @wjia message from WhatsApp
        if (externalMessageId && instanceName) {
          try {
            let resolvedToken = instanceToken;
            let resolvedBaseUrl = baseUrl;
            if (!resolvedToken || !resolvedBaseUrl) {
              const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).maybeSingle();
              if (inst) { resolvedToken = resolvedToken || inst.instance_token; resolvedBaseUrl = resolvedBaseUrl || inst.base_url; }
            }
            if (resolvedToken && resolvedBaseUrl) {
              fetch(`${resolvedBaseUrl}/message/delete`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', token: resolvedToken },
                body: JSON.stringify({ id: externalMessageId }),
              }).catch(e => console.error('Error deleting @wjia message:', e));
            }
          } catch (delErr) { console.error('Error deleting @wjia command message:', delErr); }
        }
        if (message?.id) await supabase.from('whatsapp_messages').delete().eq('id', message.id);

        const respData = { success: true, message_id: message.id, wjia_command: true, instance_name: instanceName };
        await logWebhook('wjia_command_routed', respData);
        return res.json(respData);
      }
    }

    // ========== ##NAME INTERNAL COMMAND ==========
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmedCmd = (messageText || '').trim();
      const lastLineForDouble = trimmedCmd.split('\n').pop()?.trim() || trimmedCmd;
      const doubleHashMatch = lastLineForDouble.match(/^##([a-z0-9_]+)(?:\s+([\s\S]+))?$/i) || trimmedCmd.match(/^##([a-z0-9_]+)(?:\s+([\s\S]+))?$/i);

      if (doubleHashMatch) {
        const internalCmdName = doubleHashMatch[1].toLowerCase();
        const internalCmdArgs = (doubleHashMatch[2] || '').trim();
        console.log('##internal command detected:', internalCmdName);

        const { data: internalShortcut } = await supabase
          .from('wjia_command_shortcuts').select('id, shortcut_name, assistant_type, is_active')
          .eq('shortcut_name', internalCmdName).eq('command_scope', 'internal').eq('is_active', true).maybeSingle();

        if (!internalShortcut && !internalCmdArgs) {
          console.log('No active internal shortcut found for:', internalCmdName);
        } else {
          try {
            // Delete ##command from WhatsApp
            if (externalMessageId) {
              let resolvedToken = instanceToken;
              let resolvedBaseUrl = baseUrl;
              if (!resolvedToken || !resolvedBaseUrl) {
                const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).maybeSingle();
                if (inst) { resolvedToken = resolvedToken || inst.instance_token; resolvedBaseUrl = resolvedBaseUrl || inst.base_url; }
              }
              if (resolvedToken && resolvedBaseUrl) {
                fetch(`${resolvedBaseUrl}/message/delete`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', token: resolvedToken },
                  body: JSON.stringify({ id: externalMessageId }),
                }).catch(e => console.error('Error deleting ##command message:', e));
              }
            }
            if (message?.id) await supabase.from('whatsapp_messages').delete().eq('id', message.id);

            const internalSenderPhone = normalizePhone(body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || '');
            const internalOwnerPhone = normalizePhone(body?.message?.owner || body?.chat?.owner || body?.owner || '');
            const internalLookupPhone = internalSenderPhone || internalOwnerPhone || phone;

            fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-command-processor`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
              body: JSON.stringify({
                phone: internalLookupPhone, instance_name: instanceName,
                message_text: trimmedCmd, media_url: storedMediaUrl || mediaUrl || null,
                message_type: messageType || 'text', is_group: isGroup, group_id: isGroup ? phone : null,
                is_internal_command: true,
              }),
            }).catch(err => console.error('##internal command trigger error:', err));

            const respData = { success: true, message_id: message.id, internal_command: internalCmdName, instance_name: instanceName };
            await logWebhook('internal_command_routed', respData);
            return res.json(respData);
          } catch (e) { console.error('##internal command processing error:', e); }
        }
      }
    }

    // ========== #NAME AGENT/SHORTCUT COMMAND ==========
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmedCmd = (messageText || '').trim();
      const lastLine = trimmedCmd.split('\n').pop()?.trim() || trimmedCmd;
      const hashNameMatch = lastLine.match(/^#([a-z0-9_ ]+)$/i) || trimmedCmd.match(/^#([a-z0-9_ ]+)$/i);
      const controlCommands = ['parar', 'ativar', 'status', 'limpar'];

      if (hashNameMatch && !controlCommands.includes(hashNameMatch[1].trim().toLowerCase())) {
        const shortcutName = hashNameMatch[1].trim().toLowerCase();
        console.log('#name command detected:', shortcutName);

        const { data: shortcutConfig } = await supabase
          .from('wjia_command_shortcuts').select('id, shortcut_name, assistant_type, is_active')
          .eq('shortcut_name', shortcutName).in('command_scope', ['client']).eq('is_active', true).maybeSingle();

        if (shortcutConfig) {
          try {
            // Delete from WhatsApp
            if (externalMessageId) {
              let resolvedToken = instanceToken;
              let resolvedBaseUrl = baseUrl;
              if (!resolvedToken || !resolvedBaseUrl) {
                const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).maybeSingle();
                if (inst) { resolvedToken = resolvedToken || inst.instance_token; resolvedBaseUrl = resolvedBaseUrl || inst.base_url; }
              }
              if (resolvedToken && resolvedBaseUrl) {
                fetch(`${resolvedBaseUrl}/message/delete`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', token: resolvedToken },
                  body: JSON.stringify({ id: externalMessageId }),
                }).catch(e => console.error('Error deleting #name command message:', e));
              }
            }
            if (message?.id) await supabase.from('whatsapp_messages').delete().eq('id', message.id);

            // Hard reset
            await Promise.all([
              supabase.from('wjia_collection_sessions')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() } as any)
                .eq('phone', phone).eq('instance_name', instanceName)
                .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready']),
              supabase.from('whatsapp_command_history').delete().eq('phone', phone).eq('instance_name', instanceName),
            ]);

            fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/wjia-agent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
              body: JSON.stringify({ phone, instance_name: instanceName, command: trimmedCmd, contact_id: contactId, lead_id: leadId, reset_memory: false }),
            }).catch(err => console.error('#name command trigger error:', err));

            const respData = { success: true, message_id: message.id, hash_command: shortcutName, instance_name: instanceName };
            await logWebhook('hash_command_routed', respData);
            return res.json(respData);
          } catch (e) { console.error('#name command processing error:', e); }
        }
      }
    }

    // ========== WJIA COLLECTION SESSION CHECK ==========
    const hasMedia = !!(storedMediaUrl || mediaUrl || (messageType && messageType !== 'text'));
    const normalizedMessageText = (messageText || '').trim().toLowerCase();
    const isControlCommand = ['#parar', '#ativar', '#status'].includes(normalizedMessageText);
    if (!isControlCommand && direction === 'inbound' && instanceName && phone && (messageText || hasMedia)) {
      try {
        const { data: activeSession } = await supabase
          .from('wjia_collection_sessions').select('id')
          .eq('phone', phone).eq('instance_name', instanceName)
          .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated'])
          .order('created_at', { ascending: false }).limit(1).maybeSingle();

        if (activeSession) {
          console.log('Active WJIA collection session found, routing to collection processor:', activeSession.id);
          fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-command-processor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
            body: JSON.stringify({
              phone, instance_name: instanceName, message_text: messageText || '',
              media_url: storedMediaUrl || mediaUrl || null, message_type: messageType || 'text',
              is_group: false, group_id: null,
            }),
          }).catch(err => console.error('Collection processor trigger error:', err));

          const respData = { success: true, message_id: message.id, collection_routed: true, instance_name: instanceName };
          await logWebhook('collection_routed', respData);
          return res.json(respData);
        }
      } catch (e) { console.error('Collection session check error:', e); }
    }

    // ========== AGENT CONTROL COMMANDS ==========
    if (instanceName && phone && (messageText || messageType === 'audio')) {
      const resolvedControlCommand = resolveAgentControlCommand(messageText, messageType);
      if (resolvedControlCommand) {
        console.log('Agent control command detected:', resolvedControlCommand);

        // Check active collection session
        const { data: activeCollectionSession } = await supabase
          .from('wjia_collection_sessions').select('id, status, shortcut_name')
          .eq('phone', phone).eq('instance_name', instanceName)
          .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated'])
          .order('created_at', { ascending: false }).limit(1).maybeSingle();

        const getInstanceCreds = async () => {
          let token = instanceToken;
          let url = baseUrl;
          if (!token || !url) {
            const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).maybeSingle();
            if (inst) { token = inst.instance_token; url = inst.base_url; }
          }
          return { token, baseUrl: url };
        };

        // Delete control command from WhatsApp
        if (direction === 'outbound' && externalMessageId) {
          const creds = await getInstanceCreds();
          if (creds.token && creds.baseUrl) {
            fetch(`${creds.baseUrl}/message/delete`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', token: creds.token },
              body: JSON.stringify({ id: externalMessageId }),
            }).catch(e => console.error('Error deleting control command:', e));
          }
          if (message?.id) await supabase.from('whatsapp_messages').delete().eq('id', message.id);
        }

        try {
          if (resolvedControlCommand === '#parar') {
            const phoneCandidates = Array.from(new Set([phone, normalizedPhone, normalizedPhone.replace(/^55/, ''), last8Digits].filter(Boolean)));

            const { data: activeAgents } = await supabase
              .from('whatsapp_conversation_agents').select('id, agent_id, phone, instance_name')
              .in('phone', phoneCandidates as string[]).eq('is_active', true);

            if (activeAgents && activeAgents.length > 0) {
              await supabase.from('whatsapp_conversation_agents').update({ is_active: false, human_paused_until: null } as any)
                .in('id', (activeAgents as any[]).map(a => a.id));
              console.log(`Deactivated ${activeAgents.length} agent(s) via #parar`);
            }

            const { data: sessionsToCancel } = await supabase
              .from('wjia_collection_sessions').select('id')
              .in('phone', phoneCandidates as string[])
              .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready']);
            if (sessionsToCancel && sessionsToCancel.length > 0) {
              await supabase.from('wjia_collection_sessions').update({ status: 'cancelled' } as any)
                .in('id', (sessionsToCancel as any[]).map(s => s.id));
              console.log(`Cancelled ${sessionsToCancel.length} collection session(s) via #parar`);
            }
          } else if (resolvedControlCommand === '#ativar') {
            const { data: existing } = await supabase
              .from('whatsapp_conversation_agents').select('agent_id, is_active')
              .eq('phone', phone).eq('instance_name', instanceName).maybeSingle();
            if (existing && !(existing as any).is_active) {
              await supabase.from('whatsapp_conversation_agents').update({ is_active: true, human_paused_until: null } as any)
                .eq('phone', phone).eq('instance_name', instanceName);
              console.log(`Agent reactivated for ${phone} via #ativar`);
            }
          } else if (resolvedControlCommand === '#status') {
            const statusParts: string[] = [];
            const { data: existing } = await supabase
              .from('whatsapp_conversation_agents').select('agent_id, is_active, human_paused_until')
              .eq('phone', phone).eq('instance_name', instanceName).maybeSingle();

            if (existing) {
              const { data: agentData } = await supabase.from('whatsapp_ai_agents').select('name').eq('id', (existing as any).agent_id).maybeSingle();
              const agentName = (agentData as any)?.name || 'Desconhecido';
              const isActive = (existing as any).is_active;
              const pausedUntil = (existing as any).human_paused_until;
              if (!isActive) statusParts.push(`🤖 Agente "${agentName}" está *DESATIVADO*.`);
              else if (pausedUntil && new Date(pausedUntil) > new Date()) {
                const timeStr = new Date(pausedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                statusParts.push(`🤖 Agente "${agentName}" está *PAUSADO* até ${timeStr}.`);
              } else statusParts.push(`🤖 Agente "${agentName}" está *ATIVO*.`);
            } else statusParts.push('🤖 Nenhum agente atribuído.');

            if (activeCollectionSession) {
              const sessStatus = (activeCollectionSession as any).status;
              const shortcutNameSess = (activeCollectionSession as any).shortcut_name || 'Atalho';
              const statusLabels: Record<string, string> = {
                collecting: 'coletando dados', collecting_docs: 'coletando documentos',
                processing_docs: 'processando documentos', ready: 'aguardando confirmação',
                generated: 'documento gerado (aguardando assinatura)',
              };
              statusParts.push(`📋 Atalho "${shortcutNameSess}" *EM ANDAMENTO* (${statusLabels[sessStatus] || sessStatus}).`);
            }

            const creds = await getInstanceCreds();
            if (creds.token && creds.baseUrl) {
              await fetch(`${creds.baseUrl}/send/text`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', token: creds.token },
                body: JSON.stringify({ number: phone, text: statusParts.join('\n') }),
              });
            }
          } else if (resolvedControlCommand === '#limpar') {
            if (direction === 'outbound') {
              const phoneCandidates = Array.from(new Set([phone, normalizedPhone, normalizedPhone.replace(/^55/, ''), last8Digits].filter(Boolean)));
              for (const p of phoneCandidates) {
                await supabase.from('whatsapp_messages').delete({ count: 'exact' }).eq('phone', p);
              }
              for (const p of phoneCandidates) {
                await supabase.from('wjia_collection_sessions').update({ status: 'cancelled' })
                  .eq('phone', p).in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated']);
              }
              for (const p of phoneCandidates) {
                await supabase.from('whatsapp_conversation_agents').update({ is_active: false }).eq('phone', p).eq('is_active', true);
              }
              const creds = await getInstanceCreds();
              if (creds.token && creds.baseUrl) {
                await fetch(`${creds.baseUrl}/send/text`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', token: creds.token },
                  body: JSON.stringify({ number: phone, text: '✅ Conversa limpa.' }),
                });
              }
            }
          }

          const respData = { success: true, message_id: message.id, agent_command: resolvedControlCommand, instance_name: instanceName };
          await logWebhook('agent_command_processed', respData);
          return res.json(respData);
        } catch (e) { console.error('Agent command processing error:', e); }
      }
    }

    // ========== MEMBER AI ASSISTANT CHECK ==========
    if (direction === 'inbound' && instanceName && phone && messageText && !isGroup) {
      try {
        const { data: memberConfig } = await supabase
          .from('member_assistant_config').select('is_active, instance_id').limit(1).maybeSingle();

        if (memberConfig?.is_active) {
          let instanceMatch = !memberConfig.instance_id;
          if (!instanceMatch && memberConfig.instance_id) {
            const { data: currentInst } = await supabase
              .from('whatsapp_instances').select('id').eq('instance_name', instanceName).eq('is_active', true).limit(1).maybeSingle();
            instanceMatch = currentInst?.id === memberConfig.instance_id;
          }

          if (instanceMatch) {
            const senderPhoneNorm = phone.replace(/\D/g, '');
            const phoneSuffix = senderPhoneNorm.slice(-8);
            const { data: memberProfile } = await supabase
              .from('profiles').select('user_id, full_name, phone').ilike('phone', `%${phoneSuffix}%`).limit(1).maybeSingle();

            if (memberProfile) {
              const { data: recentInbound } = await supabase
                .from('whatsapp_command_history').select('id').eq('phone', phone).eq('role', 'member_lock')
                .gte('created_at', new Date(Date.now() - 30_000).toISOString()).limit(1).maybeSingle();

              if (!recentInbound) {
                console.log('Member detected:', memberProfile.full_name, '- routing to member AI assistant');
                await supabase.from('whatsapp_command_history').insert({
                  phone, instance_name: instanceName, role: 'member_lock',
                  content: messageText?.substring(0, 200) || 'member_assistant',
                });

                fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/member-ai-assistant`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
                  body: JSON.stringify({
                    phone, instance_name: instanceName, message_text: messageText,
                    member_user_id: memberProfile.user_id, member_name: memberProfile.full_name,
                    external_message_id: externalMessageId,
                    media_url: storedMediaUrl || null, message_type: messageType || 'text', media_type: mediaType || null,
                  }),
                }).catch(err => console.error('Member AI assistant trigger error:', err));
              }

              const respData = { success: true, message_id: message.id, instance_name: instanceName, member_assistant_routed: true };
              await logWebhook('member_assistant_routed', respData);
              return res.json(respData);
            }
          }
        }
      } catch (e) { console.error('Member assistant check error:', e); }
    }

    // ========== AI AGENT AUTO-REPLY ==========
    if (!isGroup && direction === 'inbound' && instanceName && phone) {
      try {
        (async () => {
          const verdict = await verifyAgentLabelBeforeSend(phone, instanceName);
          if (!verdict.allowed) {
            console.log(`[ai-agent-reply] skipped (${verdict.reason}) phone=${phone} instance=${instanceName}`);
            return;
          }
          fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-ai-agent-reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
            body: JSON.stringify({
              phone, instance_name: instanceName, message_text: messageText,
              message_type: messageType, lead_id: leadId || null,
              campaign_id: detectedCampaignId || null, is_group: isGroup, contact_name: contactName || null,
            }),
          }).catch(err => console.error('AI agent reply trigger error:', err));
        })();
      } catch (e) { console.error('AI agent trigger setup error:', e); }
    }

    // ========== AI AGENT AUTO-REPLY (GROUPS) ==========
    // Trigger agent in groups ONLY for messages from real clients.
    // Block any sender whose phone matches an active WhatsApp instance owner_phone,
    // so the agent never replies to our own collaborators (Raym, Luana, atendimento-*, etc).
    if (isGroup && direction === 'inbound' && instanceName && phone) {
      try {
        const senderRaw = normalizePhone(
          body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || ''
        );
        if (!senderRaw) {
          console.log('[group-agent] skipped: missing sender_pn');
        } else {
          const { data: ownInstances } = await supabase
            .from('whatsapp_instances')
            .select('owner_phone')
            .eq('is_active', true);
          const instancePhones = (ownInstances || [])
            .map((i: any) => (i.owner_phone || '').replace(/\D/g, ''))
            .filter(Boolean);
          const senderDigits = senderRaw.replace(/\D/g, '');
          const isOurStaff = instancePhones.some((ip: string) =>
            senderDigits.endsWith(ip) || ip.endsWith(senderDigits) || senderDigits.slice(-8) === ip.slice(-8)
          );
          if (isOurStaff) {
            console.log(`[group-agent] skipped: sender ${senderDigits} is staff (registered instance owner)`);
          } else {
            fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-ai-agent-reply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
              body: JSON.stringify({
                phone,
                sender_phone: senderDigits,
                group_id: phone,
                instance_name: instanceName,
                message_text: messageText,
                message_type: messageType,
                lead_id: leadId || null,
                campaign_id: detectedCampaignId || null,
                is_group: true,
                contact_name: contactName || null,
              }),
            }).catch(err => console.error('AI agent group reply trigger error:', err));
          }
        }
      } catch (e) { console.error('AI agent group trigger setup error:', e); }
    }

    const respData = {
      success: true, message_id: message.id, contact_id: contactId, lead_id: leadId,
      is_new_contact: !contactId, instance_name: instanceName,
      media_stored: !!storedMediaUrl && storedMediaUrl !== mediaUrl,
    };
    await logWebhook('message_processed', respData);
    return res.json(respData);

  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // webhook_logs disabled — console-only
    console.error('[whatsapp-webhook][error]', errorMessage);
    return res.status(500).json({ success: false, error: errorMessage });
  }
};
