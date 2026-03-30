import { createClient } from 'npm:@supabase/supabase-js@2'
import { geminiChat } from "../_shared/gemini.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || RESOLVED_SUPABASE_URL;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || RESOLVED_SERVICE_ROLE_KEY;
const RESOLVED_ANON_KEY = RESOLVED_ANON_KEY;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
): Promise<{ publicUrl: string | null; transcription: string | null }> {
  try {
    console.log('Downloading media via UazAPI for message:', messageId, 'type:', messageType);

    let fileBuffer: ArrayBuffer | null = null;
    let contentType = mediaType || 'application/octet-stream';
    let transcription: string | null = null;

    // UazAPI v2 endpoint: POST /message/download with { id: messageId, return_link: true, generate_mp3: true }
    const downloadUrl = `${baseUrl}/message/download`;
    console.log('Calling /message/download at:', downloadUrl, 'with id:', messageId);
    const downloadResp = await fetch(downloadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': instanceToken },
      body: JSON.stringify({ id: messageId, return_link: true, generate_mp3: true }),
    });

    console.log('downloadMediaMessage response status:', downloadResp.status);

    if (downloadResp.ok) {
      const respContentType = downloadResp.headers.get('content-type') || '';
      
      if (respContentType.includes('application/json')) {
        const jsonData = await downloadResp.json();
        console.log('downloadMediaMessage JSON response keys:', Object.keys(jsonData));
        
        // UazAPI v2 returns { fileURL, mimetype, base64Data?, transcription? }
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
          const binaryStr = atob(jsonData.base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          fileBuffer = bytes.buffer;
          if (jsonData.mimetype) contentType = jsonData.mimetype;
        } else if (jsonData.data) {
          const binaryStr = atob(jsonData.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          fileBuffer = bytes.buffer;
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

    // Fallback: try with alternate ID format (strip owner prefix or add it)
    if (!fileBuffer || fileBuffer.byteLength < 50) {
      console.log('Trying /message/download with alternate ID format...');
      const altId = messageId.includes(':') ? messageId.split(':').pop()! : messageId;
      if (altId !== messageId) {
        const fallbackResp = await fetch(`${baseUrl}/message/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instanceToken },
          body: JSON.stringify({ id: altId, return_link: true, generate_mp3: true }),
        });
        console.log('Fallback download response status:', fallbackResp.status);
        if (fallbackResp.ok) {
          const fallbackData = await fallbackResp.json();
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

    // Fallback: try direct URL if not encrypted
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

    // STT: transcribe audio using shared utility (ElevenLabs primary, Gemini fallback)
    if (messageType === 'audio' && (!transcription || !transcription.trim())) {
      try {
        const { transcribeAudio } = await import("../_shared/stt.ts");
        const sttText = await transcribeAudio(fileBuffer, contentType || 'audio/ogg');
        if (sttText) {
          transcription = sttText;
          console.log('Audio transcription via shared STT:', sttText.substring(0, 120));
        }
      } catch (sttError) {
        console.error('Shared STT failed:', sttError);
      }
    }

    // Determine file extension
    const ext = getFileExtension(contentType, messageType);
    const timestamp = Date.now();
    const filePath = `${instanceName.replace(/\s+/g, '_')}/${timestamp}_${messageId.substring(0, 8)}.${ext}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return { publicUrl: null, transcription };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(filePath);

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
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/amr': 'amr',
    'audio/aac': 'aac',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
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
    event?.Data?.Tag,
    event?.tag,
    event?.status,
    event?.result,
    call?.status,
    call?.state,
    body?.status,
    body?.call_status,
    body?.callState,
    body?.event_type,
    body?.type,
    body?.message?.call_state,
    body?.message?.status,
    body?.message?.messageType,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.toLowerCase().trim();
    }
  }

  return '';
}

async function handleCallEvent(supabase: any, body: any) {
  const event = body.event || {};
  const call = body.call || body.message || body.chat || {};

  const senderPn = body.sender_pn || event.CallCreatorAlt || event.From || call.from || '';
  const callFrom = event.From || call.from || body.from || body.chat?.phone || senderPn || '';
  const phone = normalizePhone(callFrom);
  const contactName = body.chat?.name || body.chat?.pushName || body.senderName || call?.caller_name || null;
  const instanceName = body.instanceName || body.chat?.instanceName || null;

  const callId = normalizeCallId(
    event.CallID
    || event.call_id
    || event.callId
    || call.CallID
    || call.call_id
    || call.callId
    || body.call_id
    || body.callId
    || body.message?.call_id
    || body.message?.callId
    || body.message?.id
  );

  // Outbound detection (UazAPI variants)
  const fromMeBody = body.fromMe === true || body.message?.fromMe === true || body.chat?.fromMe === true || call.fromMe === true;
  const fromMeEvent = event.from_me === true
    || String(body.direction || '').toLowerCase() === 'outbound'
    || String(body.call_direction || '').toLowerCase() === 'outbound';
  const instanceOwner = normalizePhone(body.owner || body.chat?.owner || '');
  const fromMeOwner = !!instanceOwner && normalizePhone(senderPn) === instanceOwner;

  const isIncoming = !(fromMeBody || fromMeEvent || fromMeOwner);
  const eventTag = resolveCallTag(body, event, call);
  const reason = String(
    body.Reason
    || body.reason
    || event.Reason
    || event?.Data?.Attrs?.reason
    || ''
  ).toLowerCase();

  console.log('Processing call event:', {
    phone,
    callId,
    eventTag,
    reason,
    isIncoming,
    instanceName,
    fromMeBody,
    fromMeEvent,
    fromMeOwner,
  });

  if (!phone) {
    console.error('No phone for call event, skipping');
    return null;
  }

  const isOffer = ['offer', 'ringing', 'ring', 'initiated', 'incoming', 'calling'].some((s) => eventTag.includes(s));
  const isAccept = ['accept', 'accepted', 'answer', 'answered', 'connected', 'in_progress', 'ongoing'].some((s) => eventTag.includes(s));
  const hasMissedSignal = ['reject', 'rejected', 'timeout', 'miss', 'missed', 'cancel', 'cancelled', 'failed', 'unavailable', 'declined'].some((s) => eventTag.includes(s) || reason.includes(s));
  const hasBusySignal = eventTag.includes('busy') || reason.includes('busy');
  const isTerminate = ['terminate', 'terminated', 'ended', 'end', 'hangup', 'completed', 'finish', 'finished'].some((s) => eventTag.includes(s))
    || hasMissedSignal
    || hasBusySignal;

  console.log('Call event routing:', { eventTag, isOffer, isAccept, isTerminate, callId });

  // Record offer/accept on pending table for realtime banners and duration calculation
  if ((isOffer || isAccept) && callId) {
    const eventType = isOffer ? 'offer' : 'accept';
    const { data: alreadyExists } = await supabase
      .from('call_events_pending')
      .select('id')
      .eq('call_id', callId)
      .eq('event_type', eventType)
      .limit(1)
      .maybeSingle();

    if (!alreadyExists) {
      await supabase.from('call_events_pending').insert({
        call_id: callId,
        instance_name: instanceName,
        phone,
        contact_name: contactName,
        event_type: eventType,
        from_me: !isIncoming,
      });
      console.log(`Saved ${eventType} event for call:`, callId);
    }

    // Auto-activate recording when call is accepted/answered
    if (isAccept && instanceName) {
      try {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('instance_token, base_url')
          .eq('instance_name', instanceName)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (inst?.instance_token) {
          const recBaseUrl = inst.base_url || 'https://abraci.uazapi.com';
          const recordUrl = `${recBaseUrl}/call/record`;
          console.log('Auto-activating call recording via UazAPI:', recordUrl, 'callId:', callId);

          const recResp = await fetch(recordUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
            body: JSON.stringify({ callId, number: phone }),
          });

          const recData = await recResp.json().catch(() => ({}));
          console.log('UazAPI record response:', recResp.status, JSON.stringify(recData));
        } else {
          console.warn('No instance token found for recording, instance:', instanceName);
        }
      } catch (recErr) {
        console.error('Error activating call recording:', recErr);
      }
    }

    return null;
  }

  // Unknown/intermediate event => skip
  if (!isTerminate) {
    console.log('Unknown/intermediate call event, skipping:', eventTag || '(empty)');
    return null;
  }

  // Idempotency: avoid duplicated final record creation for same call_id
  if (callId) {
    const { data: existingFinal } = await supabase
      .from('call_records')
      .select('id, user_id, audio_url')
      .ilike('notes', `%CallID:${callId}%`)
      .neq('call_result', 'em_andamento')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingFinal) {
      console.log('Final call record already exists for call_id, skipping duplicate:', callId, existingFinal.id);
      return existingFinal;
    }
  }

  // Lookup pending events for duration and better direction/source inference
  let pendingQuery = supabase
    .from('call_events_pending')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(30);

  if (callId) {
    pendingQuery = pendingQuery.eq('call_id', callId);
  } else {
    pendingQuery = pendingQuery.eq('phone', phone);
    if (instanceName) pendingQuery = pendingQuery.eq('instance_name', instanceName);
  }

  const { data: pendingEvents } = await pendingQuery;
  const offerEvent = pendingEvents?.find((e: any) => e.event_type === 'offer');
  const acceptEvent = pendingEvents?.find((e: any) => e.event_type === 'accept');

  // Calculate duration
  const reportedDurationRaw = Number(
    call.duration
    || call.duration_seconds
    || event.duration
    || body.duration
    || body.duration_seconds
    || 0
  );
  let durationSeconds = Number.isFinite(reportedDurationRaw) && reportedDurationRaw > 0
    ? Math.round(reportedDurationRaw)
    : 0;

  if (!durationSeconds && acceptEvent?.created_at) {
    const acceptTime = new Date(acceptEvent.created_at).getTime();
    durationSeconds = Math.max(0, Math.round((Date.now() - acceptTime) / 1000));
  }

  const hasAnsweredSignal = ['accept', 'accepted', 'answer', 'answered', 'connected', 'in_progress', 'ongoing', 'completed'].some((s) => eventTag.includes(s));
  const wasAnswered = !!acceptEvent || durationSeconds > 0 || (hasAnsweredSignal && !hasMissedSignal && !hasBusySignal);

  let callResult = 'atendeu';
  if (!wasAnswered) {
    callResult = hasBusySignal ? 'ocupado' : 'não_atendeu';
    durationSeconds = 0;
  }

  const finalPhone = offerEvent?.phone || acceptEvent?.phone || phone;
  const finalContactName = offerEvent?.contact_name || acceptEvent?.contact_name || contactName;
  const isOutbound = offerEvent?.from_me === true || acceptEvent?.from_me === true || !isIncoming;
  const callType = isOutbound ? 'realizada' : 'recebida';

  console.log('Finalizing call record:', { finalPhone, callType, callResult, durationSeconds, callId });

  // Clean up pending rows for this call (and stale rows older than 8h)
  if (callId) {
    await supabase.from('call_events_pending').delete().eq('call_id', callId);
  } else {
    let cleanupQuery = supabase.from('call_events_pending').delete().eq('phone', finalPhone);
    if (instanceName) cleanupQuery = cleanupQuery.eq('instance_name', instanceName);
    await cleanupQuery;
  }
  const staleCutoffIso = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  await supabase.from('call_events_pending').delete().lt('created_at', staleCutoffIso);

  // Look up contact/lead
  let contactId: string | null = null;
  let leadId: string | null = null;
  let leadName: string | null = null;

  const phoneVariants = Array.from(new Set([finalPhone, finalPhone.replace(/^55/, '')].filter(Boolean)));
  for (const variant of phoneVariants) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, lead_id, full_name')
      .or(`phone.ilike.%${variant}`)
      .limit(1);
    if (contacts?.length) {
      contactId = contacts[0].id;
      leadId = contacts[0].lead_id;
      break;
    }
  }

  if (!leadId) {
    for (const variant of phoneVariants) {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name')
        .or(`lead_phone.ilike.%${variant}`)
        .limit(1);
      if (leads?.length) {
        leadId = leads[0].id;
        leadName = leads[0].lead_name;
        break;
      }
    }
  }

  // AI transcription for answered calls
  let aiSummary: string | null = null;
  let aiTranscript: string | null = null;
  const audioUrl = call.audioUrl || call.audio_url || call.mediaUrl || null;

  if (audioUrl && callResult === 'atendeu' && durationSeconds > 5) {
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (apiKey) {
      console.log('Transcribing call audio...');
      const result = await transcribeCallAudio(audioUrl, apiKey);
      if (result) {
        aiSummary = result.summary;
        aiTranscript = result.transcript;
      }
    }
  }

  // Try to update an existing open record first (outbound call created by make-whatsapp-call)
  const twoHoursAgoIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  let openRecordQuery = supabase
    .from('call_records')
    .select('id, user_id, created_at')
    .eq('call_result', 'em_andamento')
    .gte('created_at', twoHoursAgoIso)
    .order('created_at', { ascending: false })
    .limit(1);

  if (instanceName) {
    openRecordQuery = openRecordQuery.eq('phone_used', instanceName);
  }

  if (phoneVariants.length > 0) {
    openRecordQuery = openRecordQuery.or(phoneVariants.map((variant) => `contact_phone.eq.${variant}`).join(','));
  }

  const { data: openRecord } = await openRecordQuery.maybeSingle();

  let record: any = null;
  const callIdNote = callId ? `CallID:${callId}` : 'CallID:unknown';
  const basePayload = {
    call_type: callType,
    call_result: callResult,
    duration_seconds: durationSeconds,
    contact_id: contactId,
    lead_id: leadId,
    lead_name: leadName || finalContactName,
    contact_name: finalContactName,
    contact_phone: finalPhone,
    phone_used: instanceName || 'whatsapp',
    ai_summary: aiSummary,
    ai_transcript: aiTranscript,
    audio_url: audioUrl,
    notes: `Chamada WhatsApp ${callType} via ${instanceName || 'UazAPI'}. Duração: ${durationSeconds}s | ${callIdNote}`,
    tags: ['whatsapp', 'automatico'],
  };

  if (openRecord?.id) {
    const { data: updated, error: updateError } = await supabase
      .from('call_records')
      .update(basePayload)
      .eq('id', openRecord.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating open call record:', updateError);
    } else {
      record = updated;
      console.log('Updated open call record:', record.id);
    }
  }

  if (!record) {
    const { data: adminRole } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin')
      .limit(1)
      .single();

    const userId = adminRole?.user_id;
    if (!userId) {
      console.error('No admin user found for call record');
      return null;
    }

    const { data: inserted, error } = await supabase
      .from('call_records')
      .insert({
        user_id: userId,
        ...basePayload,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating call record:', error);
      return null;
    }

    record = inserted;
    console.log('Call record created:', record.id, 'duration:', durationSeconds, 'seconds');
  }

  // Trigger field extraction via analyze-activity-chat (async, don't wait)
  if (callResult === 'atendeu' && durationSeconds > 5 && (audioUrl || record.audio_url)) {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const anonKey = RESOLVED_ANON_KEY;
    fetch(`${supabaseUrl}/functions/v1/analyze-activity-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        action: 'transcribe_call',
        audio_url: audioUrl || record.audio_url,
        call_record_id: record.id,
        phone: finalPhone,
      }),
    }).catch((e) => console.error('Field extraction trigger error:', e));
  }

  return record;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl, supabaseKey)

    const startTime = Date.now()

    // Handle GET requests (UazAPI may send call events via GET)
    let body: any
    if (req.method === 'GET') {
      const url = new URL(req.url)
      body = Object.fromEntries(url.searchParams.entries())
      // Try to parse JSON fields that might be URL-encoded
      for (const key of Object.keys(body)) {
        try {
          const parsed = JSON.parse(body[key])
          if (typeof parsed === 'object') body[key] = parsed
        } catch (_) { /* keep as string */ }
      }
      // Log GET request for debugging
      console.log('GET webhook received, params:', JSON.stringify(body).substring(0, 2000))
      
      // If GET has no meaningful data, just acknowledge
      if (Object.keys(body).length === 0) {
        return new Response(
          JSON.stringify({ success: true, method: 'GET', message: 'Webhook active' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Log GET events to webhook_logs for debugging
      await supabase.from('webhook_logs').insert({
        source: 'whatsapp',
        event_type: 'GET_' + (body.EventType || body.event || body.type || 'unknown'),
        instance_name: body.instanceName || body.instance_name || null,
        phone: (body.phone || body.from || '').replace(/\D/g, '').slice(0, 20),
        direction: 'inbound',
        status: 'received_get',
        payload: body,
        processing_ms: Date.now() - startTime,
      }).catch(() => {})
    } else {
      body = await req.json()
    }

    // ========== EARLY FILTERS (no DB queries) ==========
    const webhookInstanceName = body.instanceName || body.chat?.instanceName || body.instance_name || null

    // 1) Event classification + call detection
    const eventType = String(body.EventType || '').toLowerCase()
    const bodyType = String(body.type || '').toLowerCase()
    // body.event can be an object (UazAPI call data) — only treat as string if it IS a string
    const bodyEventStr = (typeof body.event === 'string') ? body.event.toLowerCase() : ''
    const messageTypeHint = String(body.message?.messageType || body.chat?.wa_lastMessageType || '').toLowerCase()
    const hasCallPayload = Boolean(
      body.call
      || body.call_id
      || body.callId
      || (typeof body.event === 'object' && body.event !== null && (body.event.CallID || body.event.call_id || body.event.Data?.Tag))
      || body.message?.call_id
      || body.message?.callId
    )

    const isCallEvent = ['call', 'calls', 'call_log'].includes(eventType)
      || bodyEventStr === 'call'
      || bodyType.includes('call')
      || messageTypeHint.includes('call')
      || hasCallPayload

    // Helper to log webhook payload to DB (fire-and-forget)
    const logWebhook = async (status: string, responseData?: any, errorMsg?: string) => {
      try {
        const phone = body.chat?.phone || body.message?.chatid?.replace('@s.whatsapp.net', '') || ''
        await supabase.from('webhook_logs').insert({
          source: 'whatsapp',
          event_type: eventType || bodyType || bodyEventStr || 'unknown',
          instance_name: webhookInstanceName,
          phone: phone.replace(/\D/g, '').slice(0, 20),
          direction: body.message?.fromMe ? 'outbound' : 'inbound',
          status,
          payload: body,
          response: responseData || null,
          error_message: errorMsg || null,
          processing_ms: Date.now() - startTime,
        })
      } catch (e) {
        // Silent fail — logging should never break webhook
      }
    }

    // ========== EARLY SKIP: Filter high-volume noise events BEFORE logging ==========
    const skippableEvents = ['messages_update', 'presence', 'chats_update', 'chats_delete', 'contacts_update', 'labels', 'message_ack', 'chats']
    if (skippableEvents.includes(eventType) && !isCallEvent) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: `EventType ${eventType} filtered` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log only meaningful events to webhook_logs
    logWebhook('received', { 
      detected_event_type: eventType, 
      body_type: bodyType, 
      is_call_event: isCallEvent,
      keys: Object.keys(body).join(','),
    })

    // 2) Detect group messages — save them to DB but skip AI agent processing later
    const chatId = body.chat?.wa_chatid || body.message?.chatid || ''
    const isGroup = body.chat?.wa_isGroup === true || chatId.includes('@g.us')
    
    // For groups: detect special commands
    const groupMessageText = body.message?.text || body.message?.content?.text || body.message?.content || ''
    const groupMsgStr = typeof groupMessageText === 'string' ? groupMessageText.trim() : ''
    const isFromMe = body.message?.fromMe === true || body.chat?.fromMe === true
    const isGroupAgentCommand = isFromMe && groupMsgStr.match(/^#[a-z0-9_]+$/i)
    const isGroupWjiaCommand = isFromMe && groupMsgStr.toLowerCase().startsWith('@wjia')
    // Note: group messages are NO LONGER filtered out — they are saved to DB for inbox visibility

    // 3) Skip reaction messages (emoji reactions on existing messages)
    const msgType = (body.message?.messageType || body.chat?.wa_lastMessageType || '').toLowerCase()
    if (msgType === 'reactionmessage' || msgType === 'protocolmessage') {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'reaction_or_protocol_filtered' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('WhatsApp webhook payload:', JSON.stringify(body).substring(0, 2000))

    // ========== PAUSE CHECK ==========
    if (webhookInstanceName) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('is_paused')
        .eq('instance_name', webhookInstanceName)
        .limit(1)
        .maybeSingle()
      if (inst?.is_paused) {
        console.log(`Instance "${webhookInstanceName}" is PAUSED. Ignoring webhook.`)
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'instance_paused' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ========== CALL EVENT HANDLING (isCallEvent computed in early filters) ==========
    if (isCallEvent) {
      console.log('Detected CALL event, processing...')
      const callRecord = await handleCallEvent(supabase, body);
      const resp = { success: true, type: 'call', call_record_id: callRecord?.id || null }
      await logWebhook('call_processed', resp)
      return new Response(
        JSON.stringify(resp),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========== MESSAGE HANDLING ==========
    let rawPhone = ''
    let contactName: string | null = null
    let messageText: string | null = null
    let messageType = 'text'
    let mediaUrl: string | null = null
    let mediaType: string | null = null
    let direction = 'inbound'
    let externalMessageId: string | null = null
    let instanceName: string | null = null
    let instanceToken: string | null = null
    let baseUrl: string | null = null

    if (body.EventType && body.chat) {
      // UazAPI format
      console.log('Detected UazAPI format, EventType:', body.EventType)
      
      instanceName = body.instanceName || body.chat?.instanceName || null
      instanceToken = body.token || body.chat?.token || null
      baseUrl = body.BaseUrl || null

      // Canonicalize instance by token to avoid alias-name drift (e.g. webhook says "Site ABRACI" while DB uses "WHATSJUD IA")
      if (instanceToken) {
        const { data: canonicalInstance } = await supabase
          .from('whatsapp_instances')
          .select('instance_name, base_url')
          .eq('instance_token', instanceToken)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()

        if (canonicalInstance) {
          if (instanceName && instanceName !== canonicalInstance.instance_name) {
            console.log('Instance alias mismatch detected. Payload:', instanceName, 'Canonical:', canonicalInstance.instance_name)
          }
          instanceName = canonicalInstance.instance_name
          baseUrl = baseUrl || canonicalInstance.base_url
        }
      }
      
      console.log('Instance:', instanceName, 'Token:', instanceToken?.substring(0, 8), 'BaseUrl:', baseUrl)

      // Auto-save owner_phone from webhook data
      const ownerFromWebhook = body.chat?.owner || body.owner || null
      if (instanceName && ownerFromWebhook) {
        const cleanOwnerPhone = ownerFromWebhook.replace('@s.whatsapp.net', '')
        supabase
          .from('whatsapp_instances')
          .update({ owner_phone: cleanOwnerPhone })
          .eq('instance_name', instanceName)
          .is('owner_phone', null)
          .then(({ error: upErr }) => {
            if (!upErr) console.log(`Auto-saved owner_phone ${cleanOwnerPhone} for ${instanceName}`)
          })
      }

      // Check wa_lastMessageType for call events arriving as chats/messages
      const lastMsgType = (body.chat?.wa_lastMessageType || '').toLowerCase()
      const msgMessageType = (body.message?.messageType || '').toLowerCase()
      const isCallInMessage = lastMsgType.includes('call') || msgMessageType.includes('call')

      if (isCallInMessage) {
        console.log('Detected call event via messageType/wa_lastMessageType:', lastMsgType, msgMessageType)
        const callRecord = await handleCallEvent(supabase, body)
        return new Response(
          JSON.stringify({ success: true, type: 'call', call_record_id: callRecord?.id || null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Allow call-related EventTypes to pass through to the call handler above
      if (body.EventType !== 'messages') {
        // Check if this is a call event that wasn't caught above (UazAPI may use different naming)
        const callRelated = body.EventType === 'call' || body.EventType === 'calls' || body.EventType === 'call_log';
        if (callRelated) {
          console.log('Detected UazAPI call event via EventType:', body.EventType);
          const callRecord = await handleCallEvent(supabase, body);
          return new Response(
            JSON.stringify({ success: true, type: 'call', call_record_id: callRecord?.id || null }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log('SKIPPING non-message, non-call EventType:', body.EventType, 'Full type field:', body.type, 'Keys:', Object.keys(body).join(','));
        await logWebhook('skipped_' + (body.EventType || 'unknown'))
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: `EventType ${body.EventType} ignored` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const chatId = body.chat?.wa_chatid || body.message?.chatid || body.chat?.id || ''
      rawPhone = chatId.replace('@s.whatsapp.net', '').replace('@g.us', '')
      
      contactName = body.chat?.name || body.chat?.pushName || body.senderName || null
      
      const msg = body.message || body.chat?.message || {}
      if (typeof msg === 'string') {
        messageText = msg
      } else {
        const rawContent = msg.content;
        let contentText: string | null = null;
        
        if (typeof rawContent === 'object' && rawContent !== null) {
          if (rawContent.URL) {
            mediaUrl = rawContent.URL;
          }
          contentText = rawContent.text || rawContent.conversation || null;
        } else if (typeof rawContent === 'string') {
          contentText = rawContent;
        }

        messageText = msg.text
          || contentText
          || msg.conversation 
          || msg.extendedTextMessage?.text 
          || msg.imageMessage?.caption 
          || msg.videoMessage?.caption
          || msg.documentMessage?.caption
          || null
        
        if (messageText && typeof messageText !== 'string') {
          messageText = JSON.stringify(messageText)
        }
      }

      // Detect media type
      if (msg.imageMessage) {
        messageType = 'image'
        mediaType = msg.imageMessage.mimetype || 'image/jpeg'
        mediaUrl = mediaUrl || msg.imageMessage.url || null
      } else if (msg.videoMessage) {
        messageType = 'video'
        mediaType = msg.videoMessage.mimetype || 'video/mp4'
        mediaUrl = mediaUrl || msg.videoMessage.url || null
      } else if (msg.audioMessage) {
        messageType = 'audio'
        mediaType = msg.audioMessage.mimetype || 'audio/ogg'
        mediaUrl = mediaUrl || msg.audioMessage.url || null
      } else if (msg.documentMessage) {
        messageType = 'document'
        mediaType = msg.documentMessage.mimetype || null
        mediaUrl = mediaUrl || msg.documentMessage.url || null
      } else if (msg.mediaType || (typeof msg.content === 'object' && msg.content?.URL)) {
        const uazMediaType = (msg.mediaType || '').toLowerCase()
        const chatLastMsgType = (body.chat?.wa_lastMessageType || '').toLowerCase()
        
        if (uazMediaType.includes('audio') || uazMediaType.includes('ptt') || chatLastMsgType.includes('audio')) {
          messageType = 'audio'
          mediaType = msg.mimetype || 'audio/ogg; codecs=opus'
        } else if (uazMediaType.includes('image') || chatLastMsgType.includes('image')) {
          messageType = 'image'
          mediaType = msg.mimetype || 'image/jpeg'
        } else if (uazMediaType.includes('video') || chatLastMsgType.includes('video')) {
          messageType = 'video'
          mediaType = msg.mimetype || 'video/mp4'
        } else if (uazMediaType.includes('document') || uazMediaType.includes('sticker') || chatLastMsgType.includes('document') || chatLastMsgType.includes('sticker')) {
          messageType = 'document'
          mediaType = msg.mimetype || null
        } else if (mediaUrl) {
          messageType = 'document'
          mediaType = msg.mimetype || null
        }
        
        if (!messageText && messageType !== 'text') {
          messageText = null
        }
      }

      // Determine direction: use fromMe flag
      // UazAPI sometimes incorrectly sets fromMe=true for inbound media using @lid IDs
      // Only apply correction when chatid contains @lid (known problematic case)
      const fromMeFlag = body.message?.fromMe === true || body.chat?.fromMe === true
      const chatIdRaw = body.chat?.wa_chatid || body.message?.chatid || ''
      const isLidChat = chatIdRaw.includes('@lid')
      
      if (fromMeFlag && isLidChat) {
        // @lid chats with fromMe=true are often actually inbound — correct direction
        console.log(`Direction correction: fromMe=true but @lid chat detected, forcing inbound`)
        direction = 'inbound'
      } else {
        direction = fromMeFlag ? 'outbound' : 'inbound'
      }
      externalMessageId = body.message?.id || body.message?.messageid || body.chat?.id_message || null
    } else {
      rawPhone = body.phone || body.from || body.sender || body.remoteJid || ''
      contactName = body.contact_name || body.pushName || body.senderName || body.name || null
      messageText = body.message || body.text || body.body || body.content || null
      messageType = body.message_type || body.type || 'text'
      mediaUrl = body.media_url || body.mediaUrl || null
      mediaType = body.media_type || body.mediaType || null
      direction = body.direction || 'inbound'
      externalMessageId = body.message_id || body.messageId || body.id || null
      instanceName = body.instance_name || null
      instanceToken = body.instance_token || null
    }

    const phone = rawPhone.replace(/\D/g, '').replace(/^0+/, '')
    
    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'No phone number provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Parsed message:', { phone, contactName, messageText: messageText?.substring(0, 100), direction, messageType, mediaUrl: mediaUrl?.substring(0, 80), instanceName })

    // ========== DOWNLOAD AND STORE MEDIA ==========
    let storedMediaUrl = mediaUrl;
    let mediaTranscription: string | null = null;
    const isMediaMessage = messageType === 'image' || messageType === 'audio' || messageType === 'video' || messageType === 'document';
    if ((mediaUrl || isMediaMessage) && messageType !== 'text' && externalMessageId) {
      // Look up instance token from DB if not in payload
      let resolvedToken = instanceToken;
      let resolvedBaseUrl = baseUrl;
      
      if (instanceName && (!resolvedToken || !resolvedBaseUrl)) {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('instance_token, base_url')
          .eq('instance_name', instanceName)
          .limit(1)
          .single();
        if (inst) {
          resolvedToken = resolvedToken || inst.instance_token;
          resolvedBaseUrl = resolvedBaseUrl || inst.base_url;
        }
      }

      if (resolvedToken && resolvedBaseUrl) {
        const mediaDownload = await downloadAndStoreMedia(
          supabase,
          externalMessageId,
          instanceName || 'unknown',
          mediaUrl || '',
          mediaType || 'application/octet-stream',
          messageType,
          resolvedBaseUrl,
          resolvedToken,
        );
        mediaTranscription = mediaDownload.transcription;
        if (mediaDownload.publicUrl) {
          storedMediaUrl = mediaDownload.publicUrl;
          console.log('Media stored at:', mediaDownload.publicUrl);
        } else {
          console.log('Media download failed, keeping original URL');
        }
      } else {
        console.log('No instance token/baseUrl for media download');
      }
    }

    if (messageType === 'audio' && !messageText && mediaTranscription) {
      messageText = mediaTranscription;
      console.log('Using audio transcription as message_text:', messageText.substring(0, 120));
    }

    // ========== FIND CONTACT/LEAD ==========
    let contactId: string | null = null
    let leadId: string | null = null

    const normalizedPhone = phone.replace(/\D/g, '')
    const last8Digits = normalizedPhone.slice(-8)
    const phoneVariants = Array.from(new Set([phone, normalizedPhone, `+${normalizedPhone}`, normalizedPhone.replace(/^55/, ''), last8Digits].filter(Boolean)))
    
    for (const variant of phoneVariants) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, lead_id')
        .or(`phone.ilike.%${variant}`)
        .limit(1)

      if (contacts && contacts.length > 0) {
        contactId = contacts[0].id
        leadId = contacts[0].lead_id
        break
      }
    }

    if (!leadId) {
      for (const variant of phoneVariants) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id')
          .or(`lead_phone.ilike.%${variant}`)
          .limit(1)

        if (leads && leads.length > 0) {
          leadId = leads[0].id
          break
        }
      }
    }

    if (leadId && !contactId) {
      for (const variant of phoneVariants) {
        const { data: linkedContacts } = await supabase
          .from('contacts')
          .select('id')
          .eq('lead_id', leadId)
          .or(`phone.ilike.%${variant}`)
          .limit(1)

        if (linkedContacts && linkedContacts.length > 0) {
          contactId = linkedContacts[0].id
          break
        }
      }
    }

    // ========== CTWA AD TRACKING & AUTO-CREATE LEAD ==========
    let detectedCampaignId: string | null = null;
    let detectedCampaignName: string | null = null;
    if (direction === 'inbound') {
      try {
        const msg = body.message || body.chat?.message || {}
        // UazAPI stores content nested: message.content.contextInfo
        const msgContent = msg.content || msg.extendedTextMessage || {}
        const contextInfo = msgContent.contextInfo || msg.contextInfo || msg.imageMessage?.contextInfo || msg.videoMessage?.contextInfo || {}
        const externalAdReply = contextInfo.externalAdReply || null
        
        // Only process as CTWA if it's actually a Meta ad click (has sourceId/ctwa_clid)
        // Messages forwarded with spam/promo links also have externalAdReply but no sourceId
        const ctwaSourceId = externalAdReply?.sourceID || externalAdReply?.sourceId || contextInfo.ctwaContext?.sourceId || null
        const ctwaClid = contextInfo.ctwaContext?.ctwaClid || contextInfo.ctwaClid || null
        const isTrueCTWA = !!(ctwaSourceId || ctwaClid)
        
        if (externalAdReply && isTrueCTWA) {
          console.log('CTWA sourceID resolved:', ctwaSourceId, 'ctwa_clid:', ctwaClid)
          
          const ctwaData = {
            title: externalAdReply.title || null,
            body: externalAdReply.body || null,
            source_url: externalAdReply.sourceUrl || externalAdReply.mediaUrl || null,
            thumbnail_url: externalAdReply.thumbnailUrl || null,
            ctwa_clid: ctwaClid,
            source_id: ctwaSourceId,
            captured_at: new Date().toISOString(),
          }
          
          console.log('CTWA Ad data detected:', JSON.stringify(ctwaData))
          
          // ---- Resolve campaign from campaign_links ----
          // Try matching by source_id (Meta ad ID) or by ad title against campaign_name
          let matchedCampaignLink: any = null
          
          // Fetch ALL campaign links (include paused ones - they still track)
          const { data: allCampaignLinks } = await supabase
            .from('whatsapp_agent_campaign_links')
            .select('*')
          
          if (allCampaignLinks && allCampaignLinks.length > 0) {
            const links = allCampaignLinks as any[]
            
            // Strategy 1: Exact match source_id to campaign_id
            if (ctwaSourceId) {
              matchedCampaignLink = links.find(l => l.campaign_id === ctwaSourceId)
              if (matchedCampaignLink) {
                console.log('CTWA: Exact match by source_id:', matchedCampaignLink.campaign_id)
              }
            }
            
            // Strategy 2: Prefix match - Meta generates different IDs for campaign/adset/ad
            // but they often share a common prefix (first 12+ digits)
            if (!matchedCampaignLink && ctwaSourceId && ctwaSourceId.length >= 12) {
              const sourcePrefix = ctwaSourceId.substring(0, 12)
              matchedCampaignLink = links.find(l => 
                l.campaign_id && l.campaign_id.startsWith(sourcePrefix)
              )
              if (matchedCampaignLink) {
                console.log('CTWA: Prefix match campaign:', matchedCampaignLink.campaign_id, 'for sourceID:', ctwaSourceId)
              }
            }
            
            // Strategy 3: Match by ad title against campaign_name
            if (!matchedCampaignLink && ctwaData.title) {
              const adTitle = (ctwaData.title || '').toLowerCase().trim()
              matchedCampaignLink = links.find(l => 
                l.campaign_name && l.campaign_name.toLowerCase().trim() === adTitle
              )
              if (matchedCampaignLink) {
                console.log('CTWA: Matched campaign by title:', matchedCampaignLink.campaign_name)
              }
            }
            
            // Strategy 4: Match by instance
            if (!matchedCampaignLink && instanceName) {
              const { data: currentInst } = await supabase
                .from('whatsapp_instances')
                .select('id')
                .eq('instance_name', instanceName)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()
              
              if (currentInst) {
                const instLinks = links.filter(l => l.instance_id === currentInst.id)
                if (instLinks.length === 1) {
                  matchedCampaignLink = instLinks[0]
                  console.log('CTWA: Matched campaign by instance:', matchedCampaignLink.campaign_id)
                }
              }
            }
            
            // Strategy 5: Single link fallback
            if (!matchedCampaignLink && links.length === 1) {
              matchedCampaignLink = links[0]
              console.log('CTWA: Single campaign link fallback:', matchedCampaignLink.campaign_id)
            }
          }
          
          const isCampaignLinkActive = matchedCampaignLink?.is_active === true
          if (matchedCampaignLink) {
            detectedCampaignId = matchedCampaignLink.campaign_id
            detectedCampaignName = matchedCampaignLink.campaign_name || null
            console.log('CTWA campaign link found, active:', isCampaignLinkActive)
          }
          
          console.log('CTWA resolved campaign:', detectedCampaignId, detectedCampaignName)
          
          if (leadId) {
            // Update existing lead with CTWA context + campaign_id
            const updateData: any = { 
              ctwa_context: ctwaData,
              source: 'ctwa_whatsapp',
            }
            if (detectedCampaignId) {
              updateData.campaign_id = detectedCampaignId
              updateData.ad_name = ctwaData.title || detectedCampaignName || null
            }
            
            const { error: ctwaErr } = await supabase
              .from('leads')
              .update(updateData)
              .eq('id', leadId)
              .is('ctwa_context', null)
            
            if (ctwaErr) console.error('Error saving CTWA context:', ctwaErr)
            else console.log('CTWA context + campaign_id saved for lead:', leadId, 'campaign:', detectedCampaignId)
          }
          
          // Auto-create lead if none exists and campaign link is ACTIVE with auto_create_lead enabled
          if (!leadId && instanceName && matchedCampaignLink && isCampaignLinkActive && matchedCampaignLink.auto_create_lead && matchedCampaignLink.board_id) {
            try {
              const autoLink = matchedCampaignLink
              
              let stageId = autoLink.stage_id
              if (!stageId && autoLink.board_id) {
                const { data: board } = await supabase
                  .from('kanban_boards')
                  .select('stages')
                  .eq('id', autoLink.board_id)
                  .single()
                const stages = (board as any)?.stages || []
                if (stages.length > 0) stageId = stages[0].id
              }
              
              const leadName = contactName || `WhatsApp ${phone}`

              if (leadId) {
                console.log('CTWA: Lead already linked/resolved for phone, reusing existing lead:', leadId)
              }
              
              if (!leadId) {
                const { data: newLead, error: leadErr } = await supabase
                  .from('leads')
                  .insert({
                    lead_name: leadName,
                    lead_phone: phone,
                    board_id: autoLink.board_id,
                    status: stageId || 'new',
                    source: 'ctwa_whatsapp',
                    ctwa_context: ctwaData,
                    ad_name: ctwaData.title || detectedCampaignName || null,
                    campaign_id: detectedCampaignId,
                    action_source: 'system',
                    action_source_detail: `CTWA Auto-create (campanha: ${detectedCampaignName || 'desconhecida'})`,
                  })
                  .select('id')
                  .single()

                if (leadErr) {
                  console.error('Error auto-creating lead from CTWA:', leadErr)
                } else if (newLead) {
                  leadId = (newLead as any).id
                  console.log('Auto-created lead from CTWA:', leadId, 'board:', autoLink.board_id, 'campaign:', detectedCampaignId)
                }
              }

              if (leadId) {
                const leadPatch: Record<string, unknown> = {
                  ctwa_context: ctwaData,
                  ad_name: ctwaData.title || detectedCampaignName || null,
                  campaign_id: detectedCampaignId,
                  campaign_name: detectedCampaignName || null,
                }
                await supabase
                  .from('leads')
                  .update(leadPatch)
                  .eq('id', leadId)
              }

              // Also create or link contact
              if (!contactId && leadId && (autoLink.auto_create_contact !== false)) {
                const { data: newContact } = await supabase
                  .from('contacts')
                  .insert({
                    full_name: leadName,
                    phone: phone,
                    lead_id: leadId,
                    classification: 'lead',
                    action_source: 'system',
                    action_source_detail: `CTWA Auto-create (campanha: ${detectedCampaignName || 'desconhecida'})`,
                  })
                  .select('id')
                  .single()
                if (newContact) {
                  contactId = (newContact as any).id
                  console.log('Auto-created contact from CTWA:', contactId)
                }
              }

              if (leadId && contactId) {
                await supabase
                  .from('whatsapp_messages')
                  .update({ lead_id: leadId, contact_id: contactId })
                  .eq('campaign_id', detectedCampaignId)
                  .or(`phone.eq.${phone},phone.ilike.%${last8Digits}%`)
              }

              // Auto-assign agent from the campaign link
              if (leadId && autoLink.agent_id && instanceName) {
                try {
                  await supabase
                    .from('whatsapp_conversation_agents')
                    .upsert({
                      phone,
                      instance_name: instanceName,
                      agent_id: autoLink.agent_id,
                      is_active: true,
                      activated_by: 'ctwa_campaign',
                    }, { onConflict: 'phone,instance_name' })
                  console.log('Auto-assigned agent from CTWA campaign link:', autoLink.agent_id)
                } catch (agentErr) {
                  console.error('Error auto-assigning agent from CTWA:', agentErr)
                }
              }
            } catch (autoErr) {
              console.error('CTWA auto-create error:', autoErr)
            }
          }
          
          // NOTE: Removed dangerous generic fallback that was assigning random campaign_ids
          // to messages with externalAdReply but no matching campaign link.
          // Only messages with a proper source_id/ctwa_clid match should get a campaign_id.
          if (!matchedCampaignLink) {
            console.log('CTWA: No campaign link matched for sourceID:', ctwaSourceId, '- not assigning campaign_id')
          }
        }
      } catch (ctwaErr) {
        console.error('CTWA extraction error:', ctwaErr)
      }
    }

    // ========== DEDUPLICATION ==========
    if (externalMessageId) {
      const dedupeQuery = supabase
        .from('whatsapp_messages')
        .select('id, instance_name')
        .eq('external_message_id', externalMessageId)
        .limit(1)

      // Same external message ID can appear in different instances.
      // Deduplicate per instance to avoid dropping valid commands on mirrored webhooks.
      const scopedQuery = instanceName
        ? dedupeQuery.eq('instance_name', instanceName)
        : dedupeQuery

      const { data: existing } = await scopedQuery.maybeSingle();

      if (existing) {
        console.log('Duplicate message detected, skipping:', externalMessageId, 'instance:', instanceName || '(unknown)');
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'duplicate', existing_id: existing.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { data: message, error } = await supabase
      .from('whatsapp_messages')
      .insert({
        phone,
        contact_name: contactName,
        message_text: messageText,
        message_type: messageType,
        media_url: storedMediaUrl,
        media_type: mediaType,
        direction,
        status: direction === 'inbound' ? 'received' : 'sent',
        contact_id: contactId,
        lead_id: leadId,
        external_message_id: externalMessageId,
        metadata: body,
        instance_name: instanceName,
        instance_token: instanceToken,
        campaign_id: detectedCampaignId || null,
        campaign_name: detectedCampaignName || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting message:', error)
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Message saved:', message.id, 'Contact:', contactId, 'Lead:', leadId, 'Instance:', instanceName, 'StoredMedia:', storedMediaUrl ? 'yes' : 'no')

    // ========== AUTO-ENRICH LEAD/CONTACT (after X inbound messages) ==========
    if (direction === 'inbound' && instanceName && phone && (leadId || contactId)) {
      try {
        const supabaseUrl = RESOLVED_SUPABASE_URL
        const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
        // Fire and forget - don't block webhook response
        fetch(`${supabaseUrl}/functions/v1/auto-enrich-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            phone,
            instance_name: instanceName,
            lead_id: leadId,
            contact_id: contactId,
          }),
        }).catch(e => console.error('[auto-enrich] fire-and-forget error:', e))
      } catch (e) {
        console.error('[auto-enrich] trigger error:', e)
      }
    }

    // ========== HUMAN PAUSE: detect human outbound messages ==========
    if (direction === 'outbound' && instanceName && phone) {
      // Check if this outbound message is from a human (not AI-generated)
      const isAiMessage = body?.metadata?.ai_agent || body?.metadata?.ai_agent_id;
      if (!isAiMessage) {
        // Human sent a message - pause the AI agent
        try {
          const { data: assignment } = await supabase
            .from('whatsapp_conversation_agents')
            .select('agent_id, is_active')
            .eq('phone', phone)
            .eq('instance_name', instanceName)
            .eq('is_active', true)
            .maybeSingle();

          if (assignment) {
            // Get the agent's human_pause_minutes config
            const { data: agentConfig } = await supabase
              .from('whatsapp_ai_agents')
              .select('human_pause_minutes')
              .eq('id', (assignment as any).agent_id)
              .maybeSingle();

            const pauseMinutes = (agentConfig as any)?.human_pause_minutes || 30;
            const pauseUntil = new Date(Date.now() + pauseMinutes * 60 * 1000).toISOString();
            
            await supabase
              .from('whatsapp_conversation_agents')
              .update({ human_paused_until: pauseUntil } as any)
              .eq('phone', phone)
              .eq('instance_name', instanceName);

            console.log(`Human message detected - AI paused until ${pauseUntil} (${pauseMinutes}min)`);
          }
        } catch (e) {
          console.error('Human pause error:', e);
        }
      }
    }

    // ========== WHATSAPP COMMAND PROCESSOR (Chat IA via WhatsApp) ==========
    // Also handle self-chat (messages to own number show as outbound/fromMe)
    if (instanceName && phone && (direction === 'inbound' || direction === 'outbound')) {
      try {
        // Compare with normalized phone variants (with/without country code and optional mobile 9)
        const buildPhoneVariants = (rawPhone: string) => {
          const digits = (rawPhone || '').replace(/\D/g, '').replace(/^0+/, '')
          if (!digits) return [] as string[]

          const variants = new Set<string>()
          const add = (value?: string) => {
            if (value) variants.add(value)
          }

          add(digits)
          const local = digits.startsWith('55') ? digits.slice(2) : digits
          add(local)

          // Brasil: alguns eventos chegam sem o 9 após DDD
          if (local.length === 10) {
            const withNine = `${local.slice(0, 2)}9${local.slice(2)}`
            add(withNine)
            add(`55${withNine}`)
          }

          if (local.length === 11 && local[2] === '9') {
            const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`
            add(withoutNine)
            add(`55${withoutNine}`)
          }

          return Array.from(variants)
        }

        // For groups, use the actual sender's phone instead of the group ID
        const senderPnRaw = normalizePhone(body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || '')
        const cmdLookupPhone = isGroup && senderPnRaw ? senderPnRaw : phone
        const cmdPhoneVariants = buildPhoneVariants(cmdLookupPhone)
        
        // Also try owner phone as fallback only for outbound group events (never for inbound)
        const ownerPhoneCmd = normalizePhone(body?.message?.owner || body?.chat?.owner || body?.owner || '')
        if (isGroup && direction === 'outbound' && ownerPhoneCmd) {
          buildPhoneVariants(ownerPhoneCmd).forEach(v => { if (!cmdPhoneVariants.includes(v)) cmdPhoneVariants.push(v) })
        }
        
        let cmdConfig: any = null
        for (const variant of cmdPhoneVariants) {
          const { data } = await supabase
            .from('whatsapp_command_config')
            .select('id')
            .eq('authorized_phone', variant)
            .eq('instance_name', instanceName)
            .eq('is_active', true)
            .maybeSingle()
          if (data) { cmdConfig = data; break }
        }

        if (cmdConfig) {
          // Anti-loop: skip bot's own outbound messages to prevent re-triggering
          const trimmedMsgText = (messageText || '').trim()
          if (trimmedMsgText.startsWith('🤖 *WhatsJUD IA*') || trimmedMsgText.startsWith('🤖 WhatsJUD IA')) {
            console.log('Anti-loop: skipping bot own message from command routing:', phone)
          } else {
          console.log('Authorized command phone detected, routing to command processor:', cmdLookupPhone, isGroup ? `(group: ${phone})` : '')
          const supabaseUrl = RESOLVED_SUPABASE_URL
          const supabaseAnonKey = RESOLVED_ANON_KEY
          // Fire-and-forget — pass the actual sender phone and group context
          fetch(`${supabaseUrl}/functions/v1/whatsapp-command-processor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              phone: cmdLookupPhone,
              instance_name: instanceName,
              message_text: messageText || '',
              media_url: storedMediaUrl || mediaUrl || null,
              message_type: messageType || 'text',
              is_group: isGroup,
              group_id: isGroup ? phone : null,
            }),
          }).catch(err => console.error('Command processor trigger error:', err))

          // Skip AI agent auto-reply for command users
          const respData = { 
            success: true, 
            message_id: message.id, 
            contact_id: contactId,
            lead_id: leadId,
            is_new_contact: !contactId,
            instance_name: instanceName,
            media_stored: !!storedMediaUrl && storedMediaUrl !== mediaUrl,
            command_routed: true,
          }
          await logWebhook('command_routed', respData)
          return new Response(
            JSON.stringify(respData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        } // end anti-loop else
      } catch (e) {
        console.error('Command config check error:', e)
      }
    }

    // ========== @WJIA COMMAND DETECTION (outbound messages from attendant) ==========
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmed = (messageText || '').trim()
      if (trimmed.toLowerCase().startsWith('@wjia')) {
        console.log('@wjia command detected from attendant via WhatsApp app, phone:', phone, 'command:', trimmed)
        try {
          const supabaseUrl = RESOLVED_SUPABASE_URL
          const supabaseAnonKey = RESOLVED_ANON_KEY

          // Resolve instance_name to get instance details
          const { data: instData } = await supabase
            .from('whatsapp_instances')
            .select('instance_name')
            .eq('instance_name', instanceName)
            .eq('is_active', true)
            .maybeSingle()

          // Fire-and-forget: call unified wjia-agent
          fetch(`${supabaseUrl}/functions/v1/wjia-agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              phone,
              instance_name: instData?.instance_name || instanceName,
              command: trimmed,
              contact_id: contactId,
              lead_id: leadId,
            }),
          }).catch(err => console.error('@wjia command trigger error:', err))

          // Delete the @wjia message from WhatsApp so client doesn't see it
          if (externalMessageId && instanceName) {
            try {
              let resolvedToken = instanceToken
              let resolvedBaseUrl = baseUrl
              if (!resolvedToken || !resolvedBaseUrl) {
                const { data: inst } = await supabase
                  .from('whatsapp_instances')
                  .select('instance_token, base_url')
                  .eq('instance_name', instanceName)
                  .limit(1)
                  .maybeSingle()
                if (inst) {
                  resolvedToken = resolvedToken || inst.instance_token
                  resolvedBaseUrl = resolvedBaseUrl || inst.base_url
                }
              }
              if (resolvedToken && resolvedBaseUrl) {
                fetch(`${resolvedBaseUrl}/message/delete`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'token': resolvedToken },
                  body: JSON.stringify({ id: externalMessageId }),
                }).catch(e => console.error('Error deleting @wjia message:', e))
              }
            } catch (delErr) {
              console.error('Error deleting @wjia command message:', delErr)
            }
          }

          // Also delete from DB so it doesn't show in inbox
          if (message?.id) {
            const { error: deleteMessageError } = await supabase
              .from('whatsapp_messages')
              .delete()
              .eq('id', message.id)
            if (deleteMessageError) {
              console.error('Error deleting @wjia message from DB:', deleteMessageError)
            }
          }

          const respData = {
            success: true,
            message_id: message.id,
            wjia_command: true,
            instance_name: instanceName,
          }
          await logWebhook('wjia_command_routed', respData)
          return new Response(
            JSON.stringify(respData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } catch (e) {
          console.error('@wjia command processing error:', e)
        }
      }
    }

    // ========== ##NAME INTERNAL COMMAND DETECTION (team members) ==========
    // Handles commands like ##lead, ##caso, and free-text like ##criar atividade ...
    // Uses ## prefix and routes to command processor as ghost command
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmedCmd = (messageText || '').trim()
      const doubleHashMatch = trimmedCmd.match(/^##([a-z0-9_]+)(?:\s+([\s\S]+))?$/i)

      if (doubleHashMatch) {
        const internalCmdName = doubleHashMatch[1].toLowerCase()
        const internalCmdArgs = (doubleHashMatch[2] || '').trim()
        console.log('##internal command detected:', internalCmdName, 'hasArgs:', !!internalCmdArgs, 'phone:', phone, 'instance:', instanceName)

        // Optional shortcut validation (kept for compatibility), but free-text ## commands are also allowed
        const { data: internalShortcut } = await supabase
          .from('wjia_command_shortcuts')
          .select('id, shortcut_name, assistant_type, is_active')
          .eq('shortcut_name', internalCmdName)
          .eq('command_scope', 'internal')
          .eq('is_active', true)
          .maybeSingle()

        // If there is no active shortcut and no args, keep old behavior (ignore)
        if (!internalShortcut && !internalCmdArgs) {
          console.log('No active internal shortcut found for:', internalCmdName, '- ignoring bare ## command')
        } else {
          if (internalShortcut) {
            console.log('Internal shortcut found:', internalShortcut.shortcut_name)
          } else {
            console.log('No internal shortcut config found; routing as free-text ## command')
          }

          try {
            // Delete the ##command message from WhatsApp (ghost command)
            if (externalMessageId) {
              let resolvedToken = instanceToken
              let resolvedBaseUrl = baseUrl
              if (!resolvedToken || !resolvedBaseUrl) {
                const { data: inst } = await supabase
                  .from('whatsapp_instances')
                  .select('instance_token, base_url')
                  .eq('instance_name', instanceName)
                  .limit(1)
                  .maybeSingle()
                if (inst) {
                  resolvedToken = resolvedToken || inst.instance_token
                  resolvedBaseUrl = resolvedBaseUrl || inst.base_url
                }
              }
              if (resolvedToken && resolvedBaseUrl) {
                fetch(`${resolvedBaseUrl}/message/delete`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'token': resolvedToken },
                  body: JSON.stringify({ id: externalMessageId }),
                }).catch(e => console.error('Error deleting ##command message:', e))
              }
            }

            // Delete from DB
            if (message?.id) {
              await supabase.from('whatsapp_messages').delete().eq('id', message.id)
            }

            // For ## commands in regular chats, process as the team member (sender/owner), not the contact phone
            const internalSenderPhone = normalizePhone(body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || '')
            const internalOwnerPhone = normalizePhone(body?.message?.owner || body?.chat?.owner || body?.owner || '')
            const internalLookupPhone = internalSenderPhone || internalOwnerPhone || phone

            const supabaseUrl = RESOLVED_SUPABASE_URL
            const supabaseAnonKey = RESOLVED_ANON_KEY

            // Route to command processor preserving full command text
            fetch(`${supabaseUrl}/functions/v1/whatsapp-command-processor`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                phone: internalLookupPhone,
                instance_name: instanceName,
                message_text: trimmedCmd,
                media_url: storedMediaUrl || mediaUrl || null,
                message_type: messageType || 'text',
                is_group: isGroup,
                group_id: isGroup ? phone : null,
                is_internal_command: true,
              }),
            }).catch(err => console.error('##internal command trigger error:', err))

            const respData = {
              success: true,
              message_id: message.id,
              internal_command: internalCmdName,
              internal_free_text: !internalShortcut,
              instance_name: instanceName,
            }
            await logWebhook('internal_command_routed', respData)
            return new Response(
              JSON.stringify(respData),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          } catch (e) {
            console.error('##internal command processing error:', e)
          }
        }
      }
    }

    // ========== #NAME AGENT/SHORTCUT COMMAND DETECTION ==========
    // Handles commands like #procuracao_maternidade — validates against wjia_command_shortcuts table
    // Works for both outbound (fromMe) messages. Uses the shortcuts table as single source of truth.
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const trimmedCmd = (messageText || '').trim()
      const hashNameMatch = trimmedCmd.match(/^#([a-z0-9_ ]+)$/i)
      // Skip control commands handled below (#parar, #ativar, #status)
      const controlCommands = ['parar', 'ativar', 'status', 'limpar']
      
      if (hashNameMatch && !controlCommands.includes(hashNameMatch[1].trim().toLowerCase())) {
        const shortcutName = hashNameMatch[1].trim().toLowerCase()
        console.log('#name command detected:', shortcutName, 'phone:', phone, 'instance:', instanceName)
        
        // Validate against wjia_command_shortcuts table — only client-scope shortcuts
        const { data: shortcutConfig } = await supabase
          .from('wjia_command_shortcuts')
          .select('id, shortcut_name, assistant_type, is_active')
          .eq('shortcut_name', shortcutName)
          .in('command_scope', ['client'])
          .eq('is_active', true)
          .maybeSingle()

        if (shortcutConfig) {
          console.log('Shortcut found in table:', shortcutConfig.shortcut_name, 'type:', shortcutConfig.assistant_type)
          
          try {
            // Delete the #command message from WhatsApp so contact doesn't see it (ghost command)
            if (externalMessageId) {
              let resolvedToken = instanceToken
              let resolvedBaseUrl = baseUrl
              if (!resolvedToken || !resolvedBaseUrl) {
                const { data: inst } = await supabase
                  .from('whatsapp_instances')
                  .select('instance_token, base_url')
                  .eq('instance_name', instanceName)
                  .limit(1)
                  .maybeSingle()
                if (inst) {
                  resolvedToken = resolvedToken || inst.instance_token
                  resolvedBaseUrl = resolvedBaseUrl || inst.base_url
                }
              }
              if (resolvedToken && resolvedBaseUrl) {
                fetch(`${resolvedBaseUrl}/message/delete`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'token': resolvedToken },
                  body: JSON.stringify({ id: externalMessageId }),
                }).catch(e => console.error('Error deleting #name command message:', e))
              }
            }

            // Delete from DB so it doesn't show in inbox
            if (message?.id) {
              await supabase.from('whatsapp_messages').delete().eq('id', message.id)
            }

            // Hard reset de memória por conversa ao iniciar um novo #atalho
            await Promise.all([
              supabase
                .from('wjia_collection_sessions')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() } as any)
                .eq('phone', phone)
                .eq('instance_name', instanceName)
                .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready']),
              supabase
                .from('whatsapp_command_history')
                .delete()
                .eq('phone', phone)
                .eq('instance_name', instanceName),
            ])

            const supabaseUrl = RESOLVED_SUPABASE_URL
            const supabaseAnonKey = RESOLVED_ANON_KEY

            // Route to unified wjia-agent with the #name as command
            fetch(`${supabaseUrl}/functions/v1/wjia-agent`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                phone,
                instance_name: instanceName,
                command: trimmedCmd,
                contact_id: contactId,
                lead_id: leadId,
                reset_memory: true,
              }),
            }).catch(err => console.error('#name command trigger error:', err))

            const respData = {
              success: true,
              message_id: message.id,
              hash_command: shortcutName,
              shortcut_type: shortcutConfig.assistant_type,
              instance_name: instanceName,
            }
            await logWebhook('hash_command_routed', respData)
            return new Response(
              JSON.stringify(respData),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          } catch (e) {
            console.error('#name command processing error:', e)
          }
        } else {
          console.log('No active shortcut found for:', shortcutName, '- treating as normal message')
        }
      }
    }



    // ========== WJIA COLLECTION SESSION CHECK ==========
    // If there's an active data collection session, route to collection processor instead of AI agent.
    // Direction is already corrected above by comparing sender vs owner phone.
    const hasMedia = !!(storedMediaUrl || mediaUrl || (messageType && messageType !== 'text'))

    // Skip collection routing for ghost control commands (#parar, #ativar, #status)
    const normalizedMessageText = (messageText || '').trim().toLowerCase()
    const isControlCommand = ['#parar', '#ativar', '#status'].includes(normalizedMessageText)
    if (!isControlCommand && direction === 'inbound' && instanceName && phone && (messageText || hasMedia)) {
      try {
        const { data: activeSession } = await supabase
          .from('wjia_collection_sessions')
          .select('id')
          .eq('phone', phone)
          .eq('instance_name', instanceName)
          .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (activeSession) {
          console.log('Active WJIA collection session found, routing to collection processor:', activeSession.id, 'direction:', direction, 'message_type:', messageType)
          const supabaseUrl = RESOLVED_SUPABASE_URL
          const supabaseAnonKey = RESOLVED_ANON_KEY
          fetch(`${supabaseUrl}/functions/v1/wjia-agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              phone,
              instance_name: instanceName,
              message_text: messageText,
              media_url: storedMediaUrl || null,
              media_type: mediaType || null,
              message_type: messageType || 'text',
            }),
          }).catch(err => console.error('Collection processor trigger error:', err))

          const respData = {
            success: true,
            message_id: message.id,
            contact_id: contactId,
            lead_id: leadId,
            instance_name: instanceName,
            wjia_collection_routed: true,
          }
          await logWebhook('wjia_collection_routed', respData)
          return new Response(
            JSON.stringify(respData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      } catch (e) {
        console.error('Collection session check error:', e)
      }
    }

    // ========== AGENT CONTROL COMMANDS (#parar, #ativar, #status) ==========
    if (instanceName && phone && messageText) {
      const resolvedControlCommand = resolveAgentControlCommand(messageText, messageType)
      const isAgentCommand = !!resolvedControlCommand

      if (isAgentCommand) {
        console.log('Agent control command detected:', resolvedControlCommand, 'phone:', phone, 'instance:', instanceName, 'direction:', direction)
        try {
          // Build candidate phones to support mirrored webhooks between linked instances
          const ownerPhone = normalizePhone(body?.message?.owner || body?.chat?.owner || body?.owner || '')
          const senderPhone = normalizePhone(body?.message?.sender_pn || body?.sender_pn || body?.message?.sender || '')
          const phoneCandidates = Array.from(new Set([phone, ownerPhone, senderPhone].filter(Boolean)))

          // Delete the command message from WhatsApp so contact doesn't see it
          if (externalMessageId) {
            let resolvedToken = instanceToken
            let resolvedBaseUrl = baseUrl
            if (!resolvedToken || !resolvedBaseUrl) {
              const { data: inst } = await supabase
                .from('whatsapp_instances')
                .select('instance_token, base_url')
                .eq('instance_name', instanceName)
                .limit(1)
                .maybeSingle()
              if (inst) {
                resolvedToken = resolvedToken || inst.instance_token
                resolvedBaseUrl = resolvedBaseUrl || inst.base_url
              }
            }
            if (resolvedToken && resolvedBaseUrl) {
              fetch(`${resolvedBaseUrl}/message/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': resolvedToken },
                body: JSON.stringify({ id: externalMessageId }),
              }).catch(e => console.error('Error deleting agent command message:', e))
            }
          }

          // Delete from DB so it doesn't show in inbox
          if (message?.id) {
            await supabase.from('whatsapp_messages').delete().eq('id', message.id)
          }

          // Helper: check for active collection session (same chat scope for #status)
          const { data: activeCollectionSession } = await supabase
            .from('wjia_collection_sessions')
            .select('id, status, shortcut_name')
            .eq('phone', phone)
            .eq('instance_name', instanceName)
            .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          // Helper: resolve instance for sending messages
          const getInstanceCreds = async () => {
            let rToken = instanceToken
            let rBaseUrl = baseUrl
            if (!rToken || !rBaseUrl) {
              const { data: inst } = await supabase
                .from('whatsapp_instances')
                .select('instance_token, base_url')
                .eq('instance_name', instanceName)
                .limit(1)
                .maybeSingle()
              if (inst) {
                rToken = rToken || inst.instance_token
                rBaseUrl = rBaseUrl || inst.base_url
              }
            }
            return { token: rToken, baseUrl: rBaseUrl }
          }

          if (resolvedControlCommand === '#parar') {
            let stoppedAgent = false
            let stoppedCollection = false

            // Deactivate active agents for all mirrored phone candidates
            const { data: activeAgents } = await supabase
              .from('whatsapp_conversation_agents')
              .select('id, agent_id, phone, instance_name')
              .in('phone', phoneCandidates as string[])
              .eq('is_active', true)

            if (activeAgents && activeAgents.length > 0) {
              const activeAgentRows = activeAgents as any[]
              const agentRowIds = activeAgentRows.map((a) => a.id)
              await supabase
                .from('whatsapp_conversation_agents')
                .update({ is_active: false, human_paused_until: null } as any)
                .in('id', agentRowIds)

              stoppedAgent = true
              console.log(`Deactivated ${activeAgentRows.length} agent assignment(s) via #parar for phones: ${phoneCandidates.join(', ')}`)
            }

            // Cancel active collection sessions for all mirrored phone candidates
            const { data: sessionsToCancel } = await supabase
              .from('wjia_collection_sessions')
              .select('id')
              .in('phone', phoneCandidates as string[])
              .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready'])

            if (sessionsToCancel && sessionsToCancel.length > 0) {
              const sessionRows = sessionsToCancel as any[]
              await supabase
                .from('wjia_collection_sessions')
                .update({ status: 'cancelled' } as any)
                .in('id', sessionRows.map((s) => s.id))
              stoppedCollection = true
              console.log(`Cancelled ${sessionRows.length} collection session(s) via #parar for phones: ${phoneCandidates.join(', ')}`)
            }

            if (!stoppedAgent && !stoppedCollection) {
              console.log(`Nothing active to stop for ${phone}. Candidates: ${phoneCandidates.join(', ')}`)
            }
          } else if (resolvedControlCommand === '#ativar') {
            // Reactivate agent on this conversation
            const { data: existing } = await supabase
              .from('whatsapp_conversation_agents')
              .select('agent_id, is_active')
              .eq('phone', phone)
              .eq('instance_name', instanceName)
              .maybeSingle()

            if (existing && !(existing as any).is_active) {
              await supabase
                .from('whatsapp_conversation_agents')
                .update({ is_active: true, human_paused_until: null } as any)
                .eq('phone', phone)
                .eq('instance_name', instanceName)

              const { data: agentData } = await supabase
                .from('whatsapp_ai_agents')
                .select('name')
                .eq('id', (existing as any).agent_id)
                .maybeSingle()

              console.log(`Agent "${(agentData as any)?.name}" reactivated for ${phone} via #ativar command`)
            } else if (!existing) {
              console.log(`No agent assigned to ${phone} to reactivate`)
            } else {
              console.log(`Agent already active for ${phone}`)
            }
          } else if (resolvedControlCommand === '#status') {
            // Build status text with both agent and collection info
            const statusParts: string[] = []

            // Agent status — only this conversation (phone + instance)
            const { data: existing } = await supabase
              .from('whatsapp_conversation_agents')
              .select('agent_id, is_active, human_paused_until')
              .eq('phone', phone)
              .eq('instance_name', instanceName)
              .maybeSingle()

            if (existing) {
              const { data: agentData } = await supabase
                .from('whatsapp_ai_agents')
                .select('name')
                .eq('id', (existing as any).agent_id)
                .maybeSingle()

              const agentName = (agentData as any)?.name || 'Desconhecido'
              const isActive = (existing as any).is_active
              const pausedUntil = (existing as any).human_paused_until

              if (!isActive) {
                statusParts.push(`🤖 Agente "${agentName}" está *DESATIVADO*.`)
              } else if (pausedUntil && new Date(pausedUntil) > new Date()) {
                const timeStr = new Date(pausedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                statusParts.push(`🤖 Agente "${agentName}" está *PAUSADO* até ${timeStr}.`)
              } else {
                statusParts.push(`🤖 Agente "${agentName}" está *ATIVO*.`)
              }
            } else {
              statusParts.push('🤖 Nenhum agente atribuído.')
            }

            // Collection session status — only this conversation
            if (activeCollectionSession) {
              const sessStatus = (activeCollectionSession as any).status
              const shortcutName = (activeCollectionSession as any).shortcut_name || 'Atalho'
              const statusLabels: Record<string, string> = {
                collecting: 'coletando dados',
                collecting_docs: 'coletando documentos',
                processing_docs: 'processando documentos',
                ready: 'aguardando confirmação',
                generated: 'documento gerado (aguardando assinatura)',
              }
              const statusLabel = statusLabels[sessStatus] || sessStatus
              statusParts.push(`📋 Atalho "${shortcutName}" *EM ANDAMENTO* (${statusLabel}).`)
            }

            const statusText = statusParts.join('\n')

            const creds = await getInstanceCreds()
            if (creds.token && creds.baseUrl) {
              await fetch(`${creds.baseUrl}/send/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creds.token },
                body: JSON.stringify({ number: phone, text: statusText }),
              })
              console.log('Status sent to conversation:', phone)
            }
          } else if (resolvedControlCommand === '#limpar') {
            if (direction === 'outbound') {
              console.log(`#limpar command: clearing conversation for phoneCandidates=${JSON.stringify(phoneCandidates)}, instance=${instanceName}`)

              // 1. Delete all messages for ALL phone candidates
              // Also delete specifically for this instance_name to handle owner-testing scenario
              let totalDeleted = 0
              for (const p of phoneCandidates) {
                // Delete across all instances for this phone
                const { count: c1 } = await supabase
                  .from('whatsapp_messages')
                  .delete({ count: 'exact' })
                  .eq('phone', p)
                if (c1) totalDeleted += c1
              }
              // Also delete by instance_name in case phone didn't match (owner testing own instance)
              const { count: c2 } = await supabase
                .from('whatsapp_messages')
                .delete({ count: 'exact' })
                .eq('instance_name', instanceName)
                .eq('phone', phone)
              if (c2) totalDeleted += c2
              console.log(`#limpar: deleted ${totalDeleted} messages for phones: ${phoneCandidates.join(', ')}, instance: ${instanceName}`)

              // 2. Cancel active collection sessions for all phone candidates AND this instance
              for (const p of phoneCandidates) {
                await supabase
                  .from('wjia_collection_sessions')
                  .update({ status: 'cancelled' })
                  .eq('phone', p)
                  .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated'])
              }
              // Also cancel by instance
              await supabase
                .from('wjia_collection_sessions')
                .update({ status: 'cancelled' })
                .eq('instance_name', instanceName)
                .in('status', ['collecting', 'collecting_docs', 'processing_docs', 'ready', 'generated'])

              // 3. Deactivate conversation agents for all phone candidates
              for (const p of phoneCandidates) {
                await supabase
                  .from('whatsapp_conversation_agents')
                  .update({ is_active: false })
                  .eq('phone', p)
                  .eq('is_active', true)
              }

              // 4. Send confirmation and ghost-delete it
              const creds = await getInstanceCreds()
              if (creds.token && creds.baseUrl) {
                try {
                  const confirmResp = await fetch(`${creds.baseUrl}/send/text`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'token': creds.token },
                    body: JSON.stringify({ number: phone, text: '✅ Conversa limpa.' }),
                  })
                  const confirmData = await confirmResp.json()
                  const confirmMsgId = confirmData?.key?.id || confirmData?.messageId
                  console.log(`#limpar confirmation sent, msgId: ${confirmMsgId}`)
                  if (confirmMsgId) {
                    // Wait 4s then delete from WhatsApp (retry once)
                    await new Promise(r => setTimeout(r, 4000))
                    let delRes = await fetch(`${creds.baseUrl}/message/delete`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'token': creds.token },
                      body: JSON.stringify({ id: confirmMsgId }),
                    })
                    console.log(`#limpar confirmation delete status: ${delRes.status}`)
                    // Retry once if failed
                    if (!delRes.ok) {
                      await new Promise(r => setTimeout(r, 2000))
                      delRes = await fetch(`${creds.baseUrl}/message/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'token': creds.token },
                        body: JSON.stringify({ id: confirmMsgId }),
                      })
                      console.log(`#limpar confirmation delete retry status: ${delRes.status}`)
                    }
                  }
                  // Cleanup any confirmation that got saved to DB
                  await new Promise(r => setTimeout(r, 2000))
                  for (const p of phoneCandidates) {
                    await supabase
                      .from('whatsapp_messages')
                      .delete()
                      .eq('phone', p)
                      .ilike('message_text', '%conversa limpa%')
                  }
                  // Also delete by instance
                  await supabase
                    .from('whatsapp_messages')
                    .delete()
                    .eq('instance_name', instanceName)
                    .ilike('message_text', '%conversa limpa%')
                } catch (e) {
                  console.error('Error sending/deleting #limpar confirmation:', e)
                }
              }
            }
          }

          const respData = {
            success: true,
            message_id: message.id,
            agent_command: resolvedControlCommand,
            instance_name: instanceName,
          }
          await logWebhook('agent_command_processed', respData)
          return new Response(
            JSON.stringify(respData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } catch (e) {
          console.error('Agent command processing error:', e)
        }
      }
    }

    // ========== MEMBER AI ASSISTANT CHECK ==========
    // If inbound message is from a registered team member's phone, route to member assistant
    if (direction === 'inbound' && instanceName && phone && messageText && !isGroup) {
      try {
        // Check if member assistant is active
        const { data: memberConfig } = await supabase
          .from('member_assistant_config')
          .select('is_active, instance_id')
          .limit(1)
          .maybeSingle()

        if (memberConfig?.is_active) {
          // Match by instance_id (immutable) — resolve current webhook's instance ID
          let instanceMatch = !memberConfig.instance_id // null = any instance
          
          if (!instanceMatch && memberConfig.instance_id) {
            const { data: currentInst } = await supabase
              .from('whatsapp_instances')
              .select('id')
              .eq('instance_name', instanceName)
              .eq('is_active', true)
              .limit(1)
              .maybeSingle()
            instanceMatch = currentInst?.id === memberConfig.instance_id
            
            // Also try matching by token if name lookup didn't work
            if (!instanceMatch && instanceToken) {
              const { data: tokenInst } = await supabase
                .from('whatsapp_instances')
                .select('id')
                .eq('instance_token', instanceToken)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()
              instanceMatch = tokenInst?.id === memberConfig.instance_id
            }
          }

          if (instanceMatch) {
            // Check if sender phone belongs to a team member
            const senderPhoneNorm = phone.replace(/\D/g, '')
            const phoneSuffix = senderPhoneNorm.slice(-8)

            const { data: memberProfile } = await supabase
              .from('profiles')
              .select('user_id, full_name, phone')
              .ilike('phone', `%${phoneSuffix}%`)
              .limit(1)
              .maybeSingle()

            if (memberProfile) {
              // Anti-loop: only block duplicate webhook processing (30s lock), NOT recent outbound replies.
              // The old 2-min outbound check was blocking user confirmations like "Sim" after AI questions.
              const { data: recentInbound } = await supabase
                .from('whatsapp_command_history')
                .select('id')
                .eq('phone', phone)
                .eq('role', 'member_lock')
                .gte('created_at', new Date(Date.now() - 30_000).toISOString())
                .limit(1)
                .maybeSingle()

              if (recentInbound) {
                console.log('Anti-loop: skipping member assistant for', phone, '(recent lock)')
              } else {
                console.log('Member detected:', memberProfile.full_name, '- routing to member AI assistant')

                // Record processing lock immediately (using existing table columns)
                await supabase.from('whatsapp_command_history').insert({
                  phone,
                  instance_name: instanceName,
                  role: 'member_lock',
                  content: messageText?.substring(0, 200) || 'member_assistant',
                })

                const supabaseUrl = RESOLVED_SUPABASE_URL
                const supabaseAnonKey = RESOLVED_ANON_KEY

                // Fire-and-forget to member assistant
                fetch(`${supabaseUrl}/functions/v1/member-ai-assistant`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                  },
                  body: JSON.stringify({
                    phone,
                    instance_name: instanceName,
                    message_text: messageText,
                    member_user_id: memberProfile.user_id,
                    member_name: memberProfile.full_name,
                    external_message_id: externalMessageId,
                    media_url: storedMediaUrl || null,
                    message_type: messageType || 'text',
                    media_type: mediaType || null,
                  }),
                }).catch(err => console.error('Member AI assistant trigger error:', err))
              }

              // Skip regular AI agent for team members
              const respData = {
                success: true,
                message_id: message.id,
                contact_id: contactId,
                lead_id: leadId,
                instance_name: instanceName,
                member_assistant_routed: true,
              }
              await logWebhook('member_assistant_routed', respData)
              return new Response(
                JSON.stringify(respData),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
          }
        }
      } catch (e) {
        console.error('Member assistant check error:', e)
      }
    }

    // ========== AI AGENT AUTO-REPLY ==========
    if (direction === 'inbound' && instanceName && phone) {
      try {
        const supabaseUrl = RESOLVED_SUPABASE_URL
        const supabaseAnonKey = RESOLVED_ANON_KEY
        // Fire-and-forget: don't await to avoid delaying webhook response
        fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-agent-reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            phone,
            instance_name: instanceName,
            message_text: messageText,
            message_type: messageType,
            lead_id: leadId || null,
            campaign_id: detectedCampaignId || null,
            is_group: isGroup,
            contact_name: contactName || null,
          }),
        }).catch(err => console.error('AI agent reply trigger error:', err))
      } catch (e) {
        console.error('AI agent trigger setup error:', e)
      }
    }

    const respData = { 
      success: true, 
      message_id: message.id, 
      contact_id: contactId,
      lead_id: leadId,
      is_new_contact: !contactId,
      instance_name: instanceName,
      media_stored: !!storedMediaUrl && storedMediaUrl !== mediaUrl,
    }
    await logWebhook('message_processed', respData)
    return new Response(
      JSON.stringify(respData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Webhook error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    // Try to log the error
    try {
      const supabaseUrl = RESOLVED_SUPABASE_URL
      const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
      const supabase = createClient(supabaseUrl, supabaseKey)
      await supabase.from('webhook_logs').insert({
        source: 'whatsapp',
        event_type: 'error',
        status: 'error',
        error_message: errorMessage,
        payload: null,
      })
    } catch (_) {}
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
