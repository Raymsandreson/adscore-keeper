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
    const { phone, message, contact_id, lead_id, instance_id } = body

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ success: false, error: 'phone and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get instance info - either from instance_id or use first active instance
    let instance: any = null
    if (instance_id) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('id', instance_id)
        .eq('is_active', true)
        .single()
      instance = data
    }
    
    if (!instance) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single()
      instance = data
    }

    if (!instance) {
      return new Response(
        JSON.stringify({ success: false, error: 'No active WhatsApp instance found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Route through n8n webhook which has the real UazAPI tokens configured
    const n8nWebhookUrl = Deno.env.get('N8N_WHATSAPP_WEBHOOK_URL')
    
    if (n8nWebhookUrl) {
      console.log('Sending via n8n webhook for instance:', instance.instance_name, 'to phone:', phone)
      
      const n8nResponse = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          message,
          instance_name: instance.instance_name,
          base_url: instance.base_url || 'https://abraci.uazapi.com',
          instance_token: instance.instance_token,
        }),
      })

      if (!n8nResponse.ok) {
        const errorText = await n8nResponse.text()
        throw new Error(`n8n webhook error: ${n8nResponse.status} - ${errorText}`)
      }

      console.log('n8n webhook response status:', n8nResponse.status)
    } else {
      // Fallback: direct UazAPI call with token in header
      const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
      const sendUrl = `${baseUrl}/sendText`
      console.log('Sending directly to UazAPI:', sendUrl, 'instance:', instance.instance_name)

      const uazResponse = await fetch(sendUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'token': instance.instance_token,
        },
        body: JSON.stringify({ phone, message }),
      })

      if (!uazResponse.ok) {
        const errorText = await uazResponse.text()
        throw new Error(`UazAPI error: ${uazResponse.status} - ${errorText}`)
      }
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
        instance_name: instance.instance_name,
        instance_token: instance.instance_token,
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
