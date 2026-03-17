import { createClient } from 'npm:@supabase/supabase-js@2'
import { geminiChat } from "../_shared/gemini.ts";

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
): Promise<string | null> {
  try {
    console.log('Downloading media via UazAPI for message:', messageId, 'type:', messageType);

    let fileBuffer: ArrayBuffer | null = null;
    let contentType = mediaType || 'application/octet-stream';

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
      return null;
    }

    console.log('Downloaded media:', fileBuffer.byteLength, 'bytes, type:', contentType);

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
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(filePath);

    console.log('Media uploaded successfully:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (e) {
    console.error('Media download/upload error:', e);
    return null;
  }
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

    // 2) Skip group messages (high-volume) unless it is a call event
    const chatId = body.chat?.wa_chatid || body.message?.chatid || ''
    const isGroup = body.chat?.wa_isGroup === true || chatId.includes('@g.us')
    if (isGroup && !isCallEvent) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'group_message_filtered' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

      direction = (body.message?.fromMe === true || body.chat?.fromMe === true) ? 'outbound' : 'inbound'
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
    if (mediaUrl && messageType !== 'text' && externalMessageId) {
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
        const publicUrl = await downloadAndStoreMedia(
          supabase,
          externalMessageId,
          instanceName || 'unknown',
          mediaUrl,
          mediaType || 'application/octet-stream',
          messageType,
          resolvedBaseUrl,
          resolvedToken,
        );
        if (publicUrl) {
          storedMediaUrl = publicUrl;
          console.log('Media stored at:', publicUrl);
        } else {
          console.log('Media download failed, keeping original URL');
        }
      } else {
        console.log('No instance token/baseUrl for media download');
      }
    }

    // ========== FIND CONTACT/LEAD ==========
    let contactId: string | null = null
    let leadId: string | null = null

    const phoneVariants = [phone, `+${phone}`, phone.replace(/^55/, '')]
    
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

    // ========== DEDUPLICATION ==========
    if (externalMessageId) {
      const { data: existing } = await supabase
        .from('whatsapp_messages')
        .select('id')
        .eq('external_message_id', externalMessageId)
        .limit(1)
        .maybeSingle();
      
      if (existing) {
        console.log('Duplicate message detected, skipping:', externalMessageId);
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

        const cmdPhoneVariants = buildPhoneVariants(phone)
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
          console.log('Authorized command phone detected, routing to command processor:', phone)
          const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
          const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
          // Fire-and-forget
          fetch(`${supabaseUrl}/functions/v1/whatsapp-command-processor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              phone,
              instance_name: instanceName,
              message_text: messageText || '',
              media_url: storedMediaUrl || mediaUrl || null,
              message_type: messageType || 'text',
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
          const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
          const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

          // Resolve instance_name to get instance details
          const { data: instData } = await supabase
            .from('whatsapp_instances')
            .select('instance_name')
            .eq('instance_name', instanceName)
            .eq('is_active', true)
            .maybeSingle()

          // Fire-and-forget: call wjia-chat-command
          fetch(`${supabaseUrl}/functions/v1/wjia-chat-command`, {
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

    // ========== WJIA COLLECTION SESSION CHECK ==========
    // If there's an active data collection session, route to collection processor instead of AI agent
    if (direction === 'inbound' && instanceName && phone && messageText) {
      try {
        const { data: activeSession } = await supabase
          .from('wjia_collection_sessions')
          .select('id')
          .eq('phone', phone)
          .eq('instance_name', instanceName)
          .in('status', ['collecting', 'collecting_docs', 'ready'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (activeSession) {
          console.log('Active WJIA collection session found, routing to collection processor:', activeSession.id)
          const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
          const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
          fetch(`${supabaseUrl}/functions/v1/wjia-collection-processor`, {
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
    if (direction === 'outbound' && instanceName && phone && messageText) {
      const cmdTrimmed = (messageText || '').trim().toLowerCase()
      const isAgentCommand = ['#parar', '#ativar', '#status'].includes(cmdTrimmed)

      if (isAgentCommand) {
        console.log('Agent control command detected:', cmdTrimmed, 'phone:', phone, 'instance:', instanceName)
        try {
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

          // Helper: check for active collection session
          const { data: activeCollectionSession } = await supabase
            .from('wjia_collection_sessions')
            .select('id, status, shortcut_name')
            .eq('phone', phone)
            .eq('instance_name', instanceName)
            .in('status', ['collecting', 'collecting_docs', 'ready'])
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

          if (cmdTrimmed === '#parar') {
            // Deactivate agent on this conversation
            const { data: existing } = await supabase
              .from('whatsapp_conversation_agents')
              .select('agent_id, is_active')
              .eq('phone', phone)
              .eq('instance_name', instanceName)
              .maybeSingle()

            let stoppedAgent = false
            let stoppedCollection = false

            if (existing && (existing as any).is_active) {
              await supabase
                .from('whatsapp_conversation_agents')
                .update({ is_active: false } as any)
                .eq('phone', phone)
                .eq('instance_name', instanceName)

              const { data: agentData } = await supabase
                .from('whatsapp_ai_agents')
                .select('name')
                .eq('id', (existing as any).agent_id)
                .maybeSingle()

              stoppedAgent = true
              console.log(`Agent "${(agentData as any)?.name}" deactivated for ${phone} via #parar command`)
            }

            // Also cancel active collection session
            if (activeCollectionSession) {
              await supabase
                .from('wjia_collection_sessions')
                .update({ status: 'cancelled' } as any)
                .eq('id', (activeCollectionSession as any).id)
              stoppedCollection = true
              console.log(`Collection session ${(activeCollectionSession as any).id} cancelled for ${phone} via #parar`)
            }

            if (!stoppedAgent && !stoppedCollection) {
              console.log(`Nothing active to stop for ${phone}`)
            }
          } else if (cmdTrimmed === '#ativar') {
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
          } else if (cmdTrimmed === '#status') {
            // Build status text with both agent and collection info
            const statusParts: string[] = []

            // Agent status
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

            // Collection session status
            if (activeCollectionSession) {
              const sessStatus = (activeCollectionSession as any).status
              const shortcutName = (activeCollectionSession as any).shortcut_name || 'Atalho'
              const statusLabel = sessStatus === 'ready' ? 'aguardando confirmação' : 'coletando dados'
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
          }

          const respData = {
            success: true,
            message_id: message.id,
            agent_command: cmdTrimmed,
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
    if (direction === 'inbound' && instanceName && phone && messageText) {
      try {
        // Check if member assistant is active
        const { data: memberConfig } = await supabase
          .from('member_assistant_config')
          .select('is_active, instance_name')
          .limit(1)
          .maybeSingle()

        if (memberConfig?.is_active) {
          // Check if this instance is the one configured for member commands (or any if null)
          const instanceMatch = !memberConfig.instance_name || memberConfig.instance_name === instanceName

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
              // Anti-loop: check if we already sent a reply to this phone in the last 60 seconds
              const { data: recentReply } = await supabase
                .from('whatsapp_messages')
                .select('id')
                .eq('phone', phone)
                .eq('instance_name', instanceName)
                .eq('direction', 'outbound')
                .gte('created_at', new Date(Date.now() - 60_000).toISOString())
                .limit(1)
                .maybeSingle()

              if (recentReply) {
                console.log('Anti-loop: skipping member assistant - recent outbound reply exists for', phone)
              } else {
                console.log('Member detected:', memberProfile.full_name, '- routing to member AI assistant')

                const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
                const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

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
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
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
            lead_id: leadId || null,
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
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
