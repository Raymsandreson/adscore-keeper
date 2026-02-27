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

    const { campaign_id } = await req.json()
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Get campaign
    const { data: campaign, error: campErr } = await supabase
      .from('whatsapp_campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single()

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (campaign.status === 'sending') {
      return new Response(JSON.stringify({ error: 'Campaign already sending' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Get instance
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('id', campaign.instance_id)
      .eq('is_active', true)
      .single()

    if (!instance) {
      return new Response(JSON.stringify({ error: 'Instance not found or inactive' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Get broadcast list contacts
    const { data: contacts } = await supabase
      .from('whatsapp_broadcast_list_contacts')
      .select('*')
      .eq('list_id', campaign.broadcast_list_id)
      .order('created_at')

    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ error: 'No contacts in broadcast list' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Update campaign status
    await supabase.from('whatsapp_campaigns').update({
      status: 'sending',
      started_at: new Date().toISOString(),
      total_recipients: contacts.length,
    }).eq('id', campaign_id)

    // Create pending messages for all contacts
    const messages = contacts.map((c: any) => {
      // Replace variables in template
      let text = campaign.message_template
      text = text.replace(/\{nome\}/gi, c.contact_name || '')
      text = text.replace(/\{telefone\}/gi, c.phone || '')

      return {
        campaign_id,
        contact_id: c.contact_id,
        phone: c.phone,
        contact_name: c.contact_name,
        message_text: text,
        status: 'pending',
      }
    })

    await supabase.from('whatsapp_campaign_messages').insert(messages)

    // Process messages with interval (async, don't wait)
    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const sendUrl = `${baseUrl}/send/text`
    const intervalMs = (campaign.interval_seconds || 5) * 1000

    // Send messages sequentially with delay
    let sentCount = 0
    let failedCount = 0

    for (const contact of contacts) {
      try {
        let text = campaign.message_template
        text = text.replace(/\{nome\}/gi, contact.contact_name || '')
        text = text.replace(/\{telefone\}/gi, contact.phone || '')

        // Send via UazAPI
        if (campaign.media_url && campaign.media_type) {
          // Send media
          const mediaEndpoint = campaign.media_type === 'image' ? 'send/image' : campaign.media_type === 'audio' ? 'send/audio' : 'send/document'
          const mediaUrl = `${baseUrl}/${mediaEndpoint}`
          
          const mediaBody: any = { number: contact.phone }
          if (campaign.media_type === 'image') {
            mediaBody.imageUrl = campaign.media_url
            mediaBody.caption = text
          } else if (campaign.media_type === 'audio') {
            mediaBody.audioUrl = campaign.media_url
          } else {
            mediaBody.documentUrl = campaign.media_url
            mediaBody.caption = text
          }

          const mediaRes = await fetch(mediaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
            body: JSON.stringify(mediaBody),
          })

          if (!mediaRes.ok) throw new Error(`Media send failed: ${mediaRes.status}`)
        } else {
          // Text only
          const res = await fetch(sendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
            body: JSON.stringify({ number: contact.phone, text }),
          })

          if (!res.ok) throw new Error(`Send failed: ${res.status}`)
        }

        sentCount++

        // Update message status
        await supabase.from('whatsapp_campaign_messages')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('campaign_id', campaign_id)
          .eq('phone', contact.phone)

        // Update campaign progress
        await supabase.from('whatsapp_campaigns')
          .update({ sent_count: sentCount, failed_count: failedCount })
          .eq('id', campaign_id)

        // Also save to whatsapp_messages for chat history
        await supabase.from('whatsapp_messages').insert({
          phone: contact.phone,
          message_text: text,
          message_type: campaign.media_type || 'text',
          direction: 'outbound',
          status: 'sent',
          contact_id: contact.contact_id || null,
          instance_name: instance.instance_name,
          instance_token: instance.instance_token,
        })

        // Wait interval before next message
        if (sentCount < contacts.length) {
          await new Promise(resolve => setTimeout(resolve, intervalMs))
        }

      } catch (err: any) {
        failedCount++
        console.error(`Failed to send to ${contact.phone}:`, err.message)

        await supabase.from('whatsapp_campaign_messages')
          .update({ status: 'failed', error_message: err.message })
          .eq('campaign_id', campaign_id)
          .eq('phone', contact.phone)

        await supabase.from('whatsapp_campaigns')
          .update({ sent_count: sentCount, failed_count: failedCount })
          .eq('id', campaign_id)

        // Still wait interval to avoid spamming
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
    }

    // Mark campaign as completed
    await supabase.from('whatsapp_campaigns').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
    }).eq('id', campaign_id)

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, failed: failedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Campaign error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
