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

    const n8nWebhookUrl = Deno.env.get('N8N_WHATSAPP_WEBHOOK_URL')
    if (!n8nWebhookUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'N8N_WHATSAPP_WEBHOOK_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    const { phone, message, contact_id, lead_id } = body

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ success: false, error: 'phone and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send to n8n which will forward to UazAPI
    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_message',
        phone,
        message,
      }),
    })

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text()
      throw new Error(`n8n error: ${n8nResponse.status} - ${errorText}`)
    }

    // Save outbound message to database
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
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving outbound message:', error)
    }

    return new Response(
      JSON.stringify({ success: true, message_id: savedMessage?.id }),
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
