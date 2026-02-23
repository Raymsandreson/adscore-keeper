import { createClient } from 'npm:@supabase/supabase-js@2'

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

async function transcribeCallAudio(audioUrl: string, apiKey: string): Promise<{ summary: string; transcript: string } | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Você é um assistente jurídico de um CRM de advocacia. Transcreva o áudio da chamada e forneça um resumo objetivo."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcreva este áudio de chamada telefônica e forneça:\n1. TRANSCRIÇÃO: A transcrição completa da conversa\n2. RESUMO: Um resumo conciso dos pontos principais discutidos, decisões tomadas e próximos passos\n\nResponda em português do Brasil. Use o formato:\nTRANSCRIÇÃO:\n[transcrição aqui]\n\nRESUMO:\n[resumo aqui]"
              },
              {
                type: "input_audio",
                input_audio: { url: audioUrl, format: "wav" }
              }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      console.error("AI transcription error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
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

async function handleCallEvent(supabase: any, body: any) {
  const event = body.event || {};
  const call = body.call || body.message || body.chat || {};
  
  // UazAPI v2: phone comes from sender_pn, event.CallCreatorAlt, or event.From
  const senderPn = body.sender_pn || event.CallCreatorAlt || '';
  const chatId = senderPn || body.chat?.wa_chatid || call.chatid || event.From || call.from || '';
  const phone = chatId.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '').replace(/\D/g, '').replace(/^0+/, '');
  const contactName = body.chat?.name || body.chat?.pushName || body.senderName || null;
  const instanceName = body.instanceName || body.chat?.instanceName || null;

  // UazAPI v2: fromMe detection for outbound calls
  // For outbound calls: body.fromMe=true OR event.CallCreator matches instance owner OR direction field
  const fromMeBody = body.fromMe === true || body.message?.fromMe === true || body.chat?.fromMe === true || call.fromMe === true;
  // UazAPI also signals outbound via event.CallCreatorAlt matching the instance owner or via direction
  const fromMeEvent = event.from_me === true || body.direction === 'outbound' || body.call_direction === 'outbound';
  // UazAPI: for outbound calls, sender_pn is the instance owner's number
  const instanceOwner = body.owner || body.chat?.owner || '';
  const fromMeOwner = instanceOwner && senderPn && senderPn.includes(instanceOwner.replace(/\D/g, ''));
  
  const isIncoming = !(fromMeBody || fromMeEvent || fromMeOwner);
  const callId = event.CallID || event.call_id || call.CallID || '';
  const eventTag = (event.Data?.Tag || event.status || event.result || call.status || '').toLowerCase();
  const reason = (body.Reason || event.Reason || event.Data?.Attrs?.reason || '').toLowerCase();

  console.log('Processing call event:', { phone, callId, eventTag, reason, isIncoming, instanceName, fromMeBody, fromMeEvent, fromMeOwner, instanceOwner, senderPn });

  if (!phone || !callId) {
    console.error('No phone or callId for call event');
    return null;
  }

  // ===== EVENT ROUTING =====
  // offer = call started → save pending event
  // accept = call answered → save pending event  
  // terminate = call ended → create final record with calculated duration

  if (eventTag === 'offer') {
    // Save the offer timestamp
    await supabase.from('call_events_pending').insert({
      call_id: callId,
      instance_name: instanceName,
      phone,
      contact_name: contactName,
      event_type: 'offer',
      from_me: !isIncoming,
    });
    console.log('Saved offer event for call:', callId);
    return null; // Don't create a call_record yet
  }

  if (eventTag === 'accept') {
    // Save the accept timestamp
    await supabase.from('call_events_pending').insert({
      call_id: callId,
      instance_name: instanceName,
      phone,
      contact_name: contactName,
      event_type: 'accept',
      from_me: !isIncoming,
    });
    console.log('Saved accept event for call:', callId);
    return null; // Don't create a call_record yet
  }

  // ===== TERMINATE: Create the final call record =====
  // Look up pending events to calculate duration
  const { data: pendingEvents } = await supabase
    .from('call_events_pending')
    .select('*')
    .eq('call_id', callId)
    .order('created_at', { ascending: true });

  const offerEvent = pendingEvents?.find((e: any) => e.event_type === 'offer');
  const acceptEvent = pendingEvents?.find((e: any) => e.event_type === 'accept');

  // Calculate duration: from accept (or offer if no accept) to now
  let durationSeconds = 0;
  const wasAnswered = !!acceptEvent;
  
  if (wasAnswered && acceptEvent) {
    const acceptTime = new Date(acceptEvent.created_at).getTime();
    const terminateTime = Date.now();
    durationSeconds = Math.round((terminateTime - acceptTime) / 1000);
  }

  // Determine call result
  let callResult = 'atendeu';
  if (!wasAnswered) {
    // Check reason for unanswered
    if (reason.includes('reject') || reason.includes('cancel') || reason.includes('timeout') || reason.includes('miss') || reason.includes('accepted_elsewhere')) {
      callResult = 'não_atendeu';
    } else if (reason.includes('busy')) {
      callResult = 'ocupado';
    } else {
      callResult = 'não_atendeu';
    }
    durationSeconds = 0;
  }

  // Use phone/name from offer event if available (more reliable)
  const finalPhone = offerEvent?.phone || phone;
  const finalContactName = offerEvent?.contact_name || contactName;
  // Determine direction: offerEvent.from_me is most reliable, fallback to isIncoming detection
  const isOutbound = offerEvent?.from_me === true || (!isIncoming && offerEvent?.from_me !== false);
  const callType = isOutbound ? 'realizada' : 'recebida';

  console.log('Creating call record:', { finalPhone, callType, callResult, durationSeconds, wasAnswered });

  // Clean up pending events
  if (pendingEvents?.length) {
    await supabase.from('call_events_pending').delete().eq('call_id', callId);
  }

  // Look up contact/lead
  let contactId: string | null = null;
  let leadId: string | null = null;
  let leadName: string | null = null;

  const phoneVariants = [finalPhone, `+${finalPhone}`, finalPhone.replace(/^55/, '')];
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

  const { data: record, error } = await supabase
    .from('call_records')
    .insert({
      user_id: userId,
      call_type: callType,
      call_result: callResult,
      duration_seconds: durationSeconds,
      contact_id: contactId,
      lead_id: leadId,
      lead_name: leadName || finalContactName,
      contact_name: finalContactName,
      contact_phone: finalPhone,
      phone_used: 'whatsapp',
      ai_summary: aiSummary,
      ai_transcript: aiTranscript,
      audio_url: audioUrl,
      notes: `Chamada WhatsApp ${callType} via ${instanceName || 'UazAPI'}. Duração: ${durationSeconds}s`,
      tags: ['whatsapp', 'automatico'],
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating call record:', error);
    return null;
  }

  console.log('Call record created:', record.id, 'duration:', durationSeconds, 'seconds');

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
    }).catch(e => console.error('Field extraction trigger error:', e));
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

    const body = await req.json()
    console.log('WhatsApp webhook payload:', JSON.stringify(body).substring(0, 2000))

    // ========== CALL EVENT HANDLING ==========
    if (body.EventType === 'call' || body.event === 'call' || body.type === 'call') {
      console.log('Detected CALL event, processing...')
      const callRecord = await handleCallEvent(supabase, body);
      return new Response(
        JSON.stringify({ success: true, type: 'call', call_record_id: callRecord?.id || null }),
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

      if (body.EventType !== 'messages') {
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

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: message.id, 
        contact_id: contactId,
        lead_id: leadId,
        is_new_contact: !contactId,
        instance_name: instanceName,
        media_stored: !!storedMediaUrl && storedMediaUrl !== mediaUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Webhook error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
