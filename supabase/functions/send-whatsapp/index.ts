import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// External DB for data (messages, etc.)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();

// Internal (Cloud) DB for metadata (instances, permissions)
const INTERNAL_SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const INTERNAL_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Normalize Brazilian phone: strip non-digits, add DDI 55 if missing */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  // Already has DDI 55 (13 digits for mobile, 12 for landline)
  if (digits.startsWith('55') && digits.length >= 12) return digits
  // Has DDD + number (10-11 digits) — add 55
  if (digits.length >= 10 && digits.length <= 11) return '55' + digits
  // Fallback: return as-is
  return digits
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    // Normalize phone in body if present
    if (body.phone && typeof body.phone === 'string') {
      body.phone = normalizePhone(body.phone)
    }
    const { action } = body

    // ========================
    // RESOLVE GROUP INVITE LINK
    // ========================
    if (action === 'resolve_group_link') {
      const { group_link, instance_id } = body

      if (!group_link) {
        return new Response(
          JSON.stringify({ success: false, error: 'group_link is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Extract invite code from link
      const match = group_link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)
      if (!match) {
        return new Response(
          JSON.stringify({ success: false, error: 'Link de grupo inválido. Use o formato https://chat.whatsapp.com/...' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const inviteCode = match[1]

      const instance = await getInstance(supabase, instance_id)
      if (!instance) {
        return new Response(
          JSON.stringify({ success: false, error: 'No active WhatsApp instance found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
      
      try {
        const res = await fetch(`${baseUrl}/group/inviteInfo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
          body: JSON.stringify({ code: inviteCode }),
        })

        if (!res.ok) {
          const errText = await res.text()
          console.error('Group inviteInfo error:', res.status, errText)
          return new Response(
            JSON.stringify({ success: false, error: `Erro ao resolver link: ${res.status}` }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const groupData = await res.json()
        console.log('Group inviteInfo response:', JSON.stringify(groupData).substring(0, 500))
        const groupId = groupData?.id || groupData?.jid || groupData?.data?.id || null
        const groupName = groupData?.subject || groupData?.name || groupData?.data?.subject || ''

        if (!groupId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Não foi possível extrair o ID do grupo' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return new Response(
          JSON.stringify({ success: true, group_id: groupId, group_name: groupName }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (e) {
        console.error('Error resolving group link:', e)
        return new Response(
          JSON.stringify({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ========================
    // DELETE MESSAGE
    // ========================
    // ========================
    // FETCH GROUP PARTICIPANTS
    // ========================
    if (action === 'fetch_group_participants') {
      const { group_id, instance_id } = body

      if (!group_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'group_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const instance = await getInstance(supabase, instance_id)
      if (!instance) {
        return new Response(
          JSON.stringify({ success: false, error: 'No active WhatsApp instance found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
      // UazAPI v2: group info endpoint
      const groupJid = group_id.includes('@g.us') ? group_id : `${group_id}@g.us`
      
      try {
        const infoRes = await fetch(`${baseUrl}/group/info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
          body: JSON.stringify({ id: groupJid }),
        })

        if (!infoRes.ok) {
          const errText = await infoRes.text()
          console.error('Group info error:', infoRes.status, errText)
          return new Response(
            JSON.stringify({ success: false, error: `API error: ${infoRes.status}` }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const groupData = await infoRes.json()
        console.log('Group info response keys:', Object.keys(groupData || {}))
        // UazAPI returns participants as an array with id, admin, etc.
        const participants = groupData?.participants || groupData?.data?.participants || []
        const groupName = groupData?.subject || groupData?.name || groupData?.data?.subject || ''
        console.log('Participants count:', participants.length, 'sample:', JSON.stringify(participants.slice(0, 2)))

        return new Response(
          JSON.stringify({ success: true, participants, group_name: groupName }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (e) {
        console.error('Error fetching group info:', e)
        return new Response(
          JSON.stringify({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (action === 'delete_message') {
      const { message_id, instance_id, external_message_id, phone } = body

      if (!message_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'message_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Try to delete from WhatsApp via UazAPI if we have the external ID
      if (external_message_id && instance_id) {
        try {
          const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('*')
            .eq('id', instance_id)
            .single()

          if (instance) {
            const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
            await fetch(`${baseUrl}/message/delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
              body: JSON.stringify({ id: external_message_id }),
            })
          }
        } catch (e) {
          console.error('Error deleting from WhatsApp:', e)
        }
      }

      // Delete from database
      const { error } = await supabase
        .from('whatsapp_messages')
        .delete()
        .eq('id', message_id)

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // CLEAR CONVERSATION (delete all messages for a phone+instance)
    // ========================
    if (action === 'clear_conversation') {
      const { phone: clearPhone, instance_name } = body

      if (!clearPhone) {
        return new Response(
          JSON.stringify({ success: false, error: 'phone is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      let query = supabase.from('whatsapp_messages').delete().eq('phone', clearPhone)
      if (instance_name) {
        query = query.eq('instance_name', instance_name)
      }

      const { error, count } = await query

      if (error) throw error

      console.log(`Cleared conversation for phone ${clearPhone} instance ${instance_name || 'all'}: ${count} messages deleted`)

      return new Response(
        JSON.stringify({ success: true, deleted: count }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // SEND MEDIA (image, audio, document, video)
    // ========================
    if (action === 'send_media') {
      const { phone, chat_id, media_url, media_type, caption, contact_id, lead_id, instance_id, file_name } = body

      if (!phone || !media_url) {
        return new Response(
          JSON.stringify({ success: false, error: 'phone and media_url are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const instance = await getInstance(supabase, instance_id)
      if (!instance) {
        return new Response(
          JSON.stringify({ success: false, error: 'No active WhatsApp instance found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
      const targetNumber = chat_id?.trim() || phone

      // UazAPI v2: unified /send/media endpoint
      const endpoint = '/send/media'
      let messageType = 'image'
      const sendBody: any = { number: targetNumber, file: media_url }

      if (media_type?.startsWith('audio')) {
        sendBody.type = 'audio'
        messageType = 'audio'
      } else if (media_type?.startsWith('video')) {
        sendBody.type = 'video'
        messageType = 'video'
      } else if (media_type?.startsWith('image')) {
        sendBody.type = 'image'
      } else {
        sendBody.type = 'document'
        messageType = 'document'
      }

      // caption field for text, only for non-audio
      if (caption && sendBody.type !== 'audio') {
        sendBody.caption = caption
      }

      console.log(`Sending ${messageType} via UazAPI:`, endpoint, 'to:', phone, 'body keys:', Object.keys(sendBody))

      const uazResponse = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
        body: JSON.stringify(sendBody),
      })

      if (!uazResponse.ok) {
        const errorText = await uazResponse.text()
        throw new Error(`UazAPI error: ${uazResponse.status} - ${errorText}`)
      }

      const uazData = await uazResponse.json().catch(() => ({}))
      const externalId = uazData?.key?.id || uazData?.id || null

      // Save to database
      const { data: savedMessage, error } = await supabase
        .from('whatsapp_messages')
        .insert({
          phone,
          message_text: caption || null,
          message_type: messageType,
          media_url,
          media_type: media_type || null,
          direction: 'outbound',
          status: 'sent',
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          instance_name: instance.instance_name,
          instance_token: instance.instance_token,
          external_message_id: externalId,
        })
        .select()
        .single()

      if (error) console.error('Error saving media message:', error)

      return new Response(
        JSON.stringify({ success: true, message_id: savedMessage?.id, instance_name: instance.instance_name }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // SEND LOCATION
    // ========================
    if (action === 'send_location') {
      const { phone, chat_id, latitude, longitude, name, address, contact_id, lead_id, instance_id } = body

      if (!phone || latitude === undefined || longitude === undefined) {
        return new Response(
          JSON.stringify({ success: false, error: 'phone, latitude and longitude are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const instance = await getInstance(supabase, instance_id)
      if (!instance) {
        return new Response(
          JSON.stringify({ success: false, error: 'No active WhatsApp instance found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
      const targetNumber = chat_id?.trim() || phone

      const uazResponse = await fetch(`${baseUrl}/send/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
        body: JSON.stringify({
          number: targetNumber,
          lat: latitude,
          lng: longitude,
          title: name || '',
          address: address || '',
        }),
      })

      if (!uazResponse.ok) {
        const errorText = await uazResponse.text()
        throw new Error(`UazAPI location error: ${uazResponse.status} - ${errorText}`)
      }

      const locationText = `📍 ${name || 'Localização'}${address ? `\n${address}` : ''}`

      const { data: savedMessage, error } = await supabase
        .from('whatsapp_messages')
        .insert({
          phone,
          message_text: locationText,
          message_type: 'location',
          direction: 'outbound',
          status: 'sent',
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          instance_name: instance.instance_name,
          instance_token: instance.instance_token,
          metadata: { latitude, longitude, name, address },
        })
        .select()
        .single()

      if (error) console.error('Error saving location message:', error)

      return new Response(
        JSON.stringify({ success: true, message_id: savedMessage?.id, instance_name: instance.instance_name }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // SEND TEXT (default / legacy)
    // ========================
    const { phone, chat_id, message, contact_id, lead_id, instance_id } = body

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ success: false, error: 'phone and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const instance = await getInstance(supabase, instance_id)
    if (!instance) {
      return new Response(
        JSON.stringify({ success: false, error: 'No active WhatsApp instance found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const sendUrl = `${baseUrl}/send/text`
    
    console.log('Sending via UazAPI:', sendUrl, 'instance:', instance.instance_name, 'to phone:', phone)

    const targetNumber = typeof chat_id === 'string' && chat_id.trim() ? chat_id.trim() : phone

    const uazResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'token': instance.instance_token,
      },
      body: JSON.stringify({ number: targetNumber, text: message }),
    })

    if (!uazResponse.ok) {
      const errorText = await uazResponse.text()
      throw new Error(`UazAPI error: ${uazResponse.status} - ${errorText}`)
    }
    
    const uazData = await uazResponse.json().catch(() => ({}))
    const externalId = uazData?.key?.id || uazData?.id || null
    console.log('UazAPI response status:', uazResponse.status, 'externalId:', externalId)

    const { data: savedMessage, error } = await supabase
      .from('whatsapp_messages')
      .insert({
        phone,
        message_text: message,
        message_type: 'text',
        direction: 'outbound',
        status: 'sent',
        contact_id: contact_id || null,
        lead_id: lead_id || null,
        instance_name: instance.instance_name,
        instance_token: instance.instance_token,
        external_message_id: externalId,
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving outbound message:', error)
    }

    return new Response(
      JSON.stringify({ success: true, message_id: savedMessage?.id, instance_name: instance.instance_name }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Send WhatsApp error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getInstance(supabase: any, instance_id?: string) {
  if (!instance_id) {
    return null
  }

  const { data } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', instance_id)
    .eq('is_active', true)
    .single()

  return data || null
}
