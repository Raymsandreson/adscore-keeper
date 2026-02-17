import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const call = body.call || body.message || body.chat || {};
  const chatId = body.chat?.wa_chatid || call.chatid || call.from || '';
  const phone = chatId.replace('@s.whatsapp.net', '').replace('@g.us', '').replace(/\D/g, '').replace(/^0+/, '');
  const contactName = body.chat?.name || body.chat?.pushName || body.senderName || null;
  const instanceName = body.instanceName || body.chat?.instanceName || null;

  const isIncoming = !(body.message?.fromMe === true || body.chat?.fromMe === true || call.fromMe === true);
  const callType = isIncoming ? 'recebida' : 'realizada';
  const durationSeconds = call.duration || call.callDuration || 0;
  const callStatus = call.status || call.result || 'unknown';

  // Map UazAPI call status to our call_result
  let callResult = 'atendeu';
  const statusLower = (callStatus + '').toLowerCase();
  if (statusLower.includes('miss') || statusLower.includes('reject') || statusLower.includes('cancel') || statusLower.includes('timeout')) {
    callResult = 'não_atendeu';
  } else if (statusLower.includes('busy')) {
    callResult = 'ocupado';
  }

  console.log('Processing call event:', { phone, contactName, callType, durationSeconds, callResult, callStatus });

  if (!phone) {
    console.error('No phone for call event');
    return null;
  }

  // Find contact/lead
  let contactId: string | null = null;
  let leadId: string | null = null;
  let leadName: string | null = null;

  const phoneVariants = [phone, `+${phone}`, phone.replace(/^55/, '')];
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

  // Try transcription if there's audio and call was answered
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
        console.log('Transcription completed, summary length:', aiSummary?.length);
      }
    }
  }

  // Get first admin user as fallback user_id
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
      lead_name: leadName || contactName,
      contact_name: contactName,
      contact_phone: phone,
      phone_used: 'whatsapp',
      ai_summary: aiSummary,
      ai_transcript: aiTranscript,
      audio_url: audioUrl,
      notes: `Chamada WhatsApp ${callType} via ${instanceName || 'UazAPI'}. Status: ${callStatus}`,
      tags: ['whatsapp', 'automatico'],
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating call record:', error);
    return null;
  }

  console.log('Call record created:', record.id);
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

    // ========== MESSAGE HANDLING (existing logic) ==========
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

    if (body.EventType && body.chat) {
      // UazAPI format
      console.log('Detected UazAPI format, EventType:', body.EventType)
      
      instanceName = body.instanceName || body.chat?.instanceName || null
      instanceToken = body.token || body.chat?.token || null
      
      console.log('Instance:', instanceName, 'Token:', instanceToken?.substring(0, 8))

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
        // Handle content that can be string or object with text property
        const rawContent = msg.content;
        const contentText = typeof rawContent === 'object' && rawContent !== null 
          ? rawContent.text || rawContent.conversation || null
          : rawContent;

        messageText = msg.text
          || contentText
          || msg.conversation 
          || msg.extendedTextMessage?.text 
          || msg.imageMessage?.caption 
          || msg.videoMessage?.caption
          || msg.documentMessage?.caption
          || null
        
        // Ensure messageText is always a string or null
        if (messageText && typeof messageText !== 'string') {
          messageText = JSON.stringify(messageText)
        }
      }

      if (msg.imageMessage) {
        messageType = 'image'
        mediaType = msg.imageMessage.mimetype || 'image/jpeg'
        mediaUrl = msg.imageMessage.url || null
      } else if (msg.videoMessage) {
        messageType = 'video'
        mediaType = msg.videoMessage.mimetype || 'video/mp4'
        mediaUrl = msg.videoMessage.url || null
      } else if (msg.audioMessage) {
        messageType = 'audio'
        mediaType = msg.audioMessage.mimetype || 'audio/ogg'
        mediaUrl = msg.audioMessage.url || null
      } else if (msg.documentMessage) {
        messageType = 'document'
        mediaType = msg.documentMessage.mimetype || null
        mediaUrl = msg.documentMessage.url || null
      }

      direction = (body.message?.fromMe === true || body.chat?.fromMe === true) ? 'outbound' : 'inbound'
      externalMessageId = body.message?.messageid || body.message?.id || body.chat?.id_message || null
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

    console.log('Parsed message:', { phone, contactName, messageText: messageText?.substring(0, 100), direction, messageType, instanceName })

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
        media_url: mediaUrl,
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

    console.log('Message saved:', message.id, 'Contact:', contactId, 'Lead:', leadId, 'Instance:', instanceName)

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: message.id, 
        contact_id: contactId,
        lead_id: leadId,
        is_new_contact: !contactId,
        instance_name: instanceName,
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