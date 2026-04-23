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
import { geminiChat } from '../lib/gemini';
import { getLocationFromDDD } from '../lib/ddd-mapping';
import { transcribeAudio } from '../lib/stt';

// ============================================================
// ENV CONFIG
// ============================================================
const RESOLVED_SUPABASE_URL = process.env.EXTERNAL_SUPABASE_URL || '';
const RESOLVED_SERVICE_ROLE_KEY = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY || '';
const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || '';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || '';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function downloadAndStoreMedia(
  supabase: any,
  messageId: string,
  instanceName: string,
  mediaUrl: string,
  mediaType: string,
  messageType: string,
  baseUrl: string,
  instanceToken: string,
): Promise<{ publicUrl: string | null; transcription: string | null }> {
  try {
    console.log('Downloading media via UazAPI for message:', messageId, 'type:', messageType);

    let fileBuffer: ArrayBuffer | null = null;
    let contentType = mediaType || 'application/octet-stream';
    let transcription: string | null = null;

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
          }
          if (typeof jsonData.transcription === 'string' && jsonData.transcription.trim()) {
            transcription = jsonData.transcription.trim();
          }
        } else if (jsonData.base64Data) {
          fileBuffer = Buffer.from(jsonData.base64Data, 'base64').buffer;
          if (jsonData.mimetype) contentType = jsonData.mimetype;
        } else if (jsonData.data) {
          fileBuffer = Buffer.from(jsonData.data, 'base64').buffer;
          if (jsonData.mimetype) contentType = jsonData.mimetype;
        } else if (jsonData.url) {
          const mediaResp = await fetch(jsonData.url);
          if (mediaResp.ok) {
            fileBuffer = await mediaResp.arrayBuffer();
            contentType = mediaResp.headers.get('content-type') || contentType;
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
            }
          }
        } else {
          const errText = await fallbackResp.text();
          console.log('Fallback download error:', fallbackResp.status, errText.substring(0, 300));
        }
      }
    }

    // Fallback: direct URL
    if ((!fileBuffer || fileBuffer.byteLength < 50) && mediaUrl && !mediaUrl.includes('.enc')) {
      console.log('Trying direct media URL...');
      const directResp = await fetch(mediaUrl);
      if (directResp.ok) {
        fileBuffer = await directResp.arrayBuffer();
        contentType = directResp.headers.get('content-type') || contentType;
      }
    }

    if (!fileBuffer || fileBuffer.byteLength < 50) {
      console.log('Could not download media, buffer empty or too small, size:', fileBuffer?.byteLength || 0);
      return { publicUrl: null, transcription };
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
    const filePath = `${instanceName.replace(/\s+/g, '_')}/${timestamp}_${messageId.substring(0, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, Buffer.from(fileBuffer), { contentType, upsert: true });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return { publicUrl: null, transcription };
    }

    const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(filePath);
    console.log('Media uploaded successfully:', urlData.publicUrl);
    return { publicUrl: urlData.publicUrl, transcription };
  } catch (e) {
    console.error('Media download/upload error:', e);
    return { publicUrl: null, transcription: null };
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
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
  };
  if (map[contentType]) return map[contentType];
  if (messageType === 'audio') return 'ogg';
  if (messageType === 'image') return 'jpg';
  if (messageType === 'video') return 'mp4';
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
      try {
        await supabase.from('webhook_logs').insert({
          source: 'whatsapp', event_type: 'GET_' + (body.EventType || body.event || body.type || 'unknown'),
          instance_name: body.instanceName || body.instance_name || null,
          phone: (body.phone || body.from || '').replace(/\D/g, '').slice(0, 20),
          direction: 'inbound', status: 'received_get', payload: body, processing_ms: Date.now() - startTime,
        });
      } catch (_) { /* ignore log failures */ }
    } else {
      body = req.body;
    }

    // ========== EARLY FILTERS ==========
    const webhookInstanceName = body.instanceName || body.chat?.instanceName || body.instance_name || null;
    const eventType = String(body.EventType || '').toLowerCase();
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

    const logWebhook = async (status: string, responseData?: any, errorMsg?: string) => {
      try {
        const phone = body.chat?.phone || body.message?.chatid?.replace('@s.whatsapp.net', '') || '';
        await supabase.from('webhook_logs').insert({
          source: 'whatsapp', event_type: eventType || bodyType || bodyEventStr || 'unknown',
          instance_name: webhookInstanceName,
          phone: phone.replace(/\D/g, '').slice(0, 20),
          direction: body.message?.fromMe ? 'outbound' : 'inbound',
          status, payload: body, response: responseData || null, error_message: errorMsg || null,
          processing_ms: Date.now() - startTime,
        });
      } catch (e) { /* Silent */ }
    };

    // Skip noise events
    const skippableEvents = ['messages_update', 'presence', 'chats_update', 'chats_delete', 'contacts_update', 'labels', 'message_ack', 'chats'];
    if (skippableEvents.includes(eventType) && !isCallEvent) {
      return res.json({ success: true, skipped: true, reason: `EventType ${eventType} filtered` });
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

      // Detect media type
      if (msg.imageMessage) {
        messageType = 'image'; mediaType = msg.imageMessage.mimetype || 'image/jpeg'; mediaUrl = mediaUrl || msg.imageMessage.url || null;
      } else if (msg.videoMessage) {
        messageType = 'video'; mediaType = msg.videoMessage.mimetype || 'video/mp4'; mediaUrl = mediaUrl || msg.videoMessage.url || null;
      } else if (msg.audioMessage) {
        messageType = 'audio'; mediaType = msg.audioMessage.mimetype || 'audio/ogg'; mediaUrl = mediaUrl || msg.audioMessage.url || null;
      } else if (msg.documentMessage) {
        messageType = 'document'; mediaType = msg.documentMessage.mimetype || null; mediaUrl = mediaUrl || msg.documentMessage.url || null;
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
    if (!isGroup && (mediaUrl || isMediaMessage) && messageType !== 'text' && externalMessageId) {
      let resolvedToken = instanceToken;
      let resolvedBaseUrl = baseUrl;
      if (instanceName && (!resolvedToken || !resolvedBaseUrl)) {
        const { data: inst } = await supabase.from('whatsapp_instances').select('instance_token, base_url').eq('instance_name', instanceName).limit(1).single();
        if (inst) { resolvedToken = resolvedToken || inst.instance_token; resolvedBaseUrl = resolvedBaseUrl || inst.base_url; }
      }
      if (resolvedToken && resolvedBaseUrl) {
        const mediaDownload = await downloadAndStoreMedia(supabase, externalMessageId, instanceName || 'unknown', mediaUrl || '', mediaType || 'application/octet-stream', messageType, resolvedBaseUrl, resolvedToken);
        mediaTranscription = mediaDownload.transcription;
        if (mediaDownload.publicUrl) { storedMediaUrl = mediaDownload.publicUrl; console.log('Media stored at:', mediaDownload.publicUrl); }
        else console.log('Media download failed, keeping original URL');
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
    if (!contactId && direction === 'inbound' && normalizedPhone.length >= 10 && !isGroup) {
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

    // ========== DEDUPLICATION ==========
    if (externalMessageId) {
      const dedupeQuery = supabase.from('whatsapp_messages').select('id, instance_name').eq('external_message_id', externalMessageId).limit(1);
      const scopedQuery = instanceName ? dedupeQuery.eq('instance_name', instanceName) : dedupeQuery;
      const { data: existing } = await scopedQuery.maybeSingle();
      if (existing) {
        console.log('Duplicate message detected, skipping:', externalMessageId);
        return res.json({ success: true, skipped: true, reason: 'duplicate', existing_id: existing.id });
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
              fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-ai-agent-reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
                body: JSON.stringify({ phone, instance_name: instanceName, message_text: lastInbound.message_text || '', message_type: lastInbound.message_type || 'text' }),
              }).catch(err => console.error('#shortcut agent reply trigger error:', err));
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
          .from('whatsapp_command_configs').select('id, authorized_phone, instance_name')
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
        fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/whatsapp-ai-agent-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUD_ANON_KEY}` },
          body: JSON.stringify({
            phone, instance_name: instanceName, message_text: messageText,
            message_type: messageType, lead_id: leadId || null,
            campaign_id: detectedCampaignId || null, is_group: isGroup, contact_name: contactName || null,
          }),
        }).catch(err => console.error('AI agent reply trigger error:', err));
      } catch (e) { console.error('AI agent trigger setup error:', e); }
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
    try {
      const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
      await supabase.from('webhook_logs').insert({
        source: 'whatsapp', event_type: 'error', status: 'error', error_message: errorMessage, payload: null,
      });
    } catch (_) {}
    return res.status(500).json({ success: false, error: errorMessage });
  }
};
