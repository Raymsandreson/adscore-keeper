import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      
      // Extract instance info
      instanceName = body.instanceName || body.chat?.instanceName || null
      instanceToken = body.token || body.chat?.token || null
      
      console.log('Instance:', instanceName, 'Token:', instanceToken?.substring(0, 8))

      // Only process message events
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
        messageText = msg.text
          || msg.content
          || msg.conversation 
          || msg.extendedTextMessage?.text 
          || msg.imageMessage?.caption 
          || msg.videoMessage?.caption
          || msg.documentMessage?.caption
          || null
      }

      // Media handling
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
      // Generic / custom format
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

    // Try to find existing contact by phone
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

    // Insert the message with instance data
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