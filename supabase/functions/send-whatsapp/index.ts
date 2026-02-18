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

    // Send directly to UazAPI using the instance token in the URL path (v2 API)
    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const sendUrl = `${baseUrl}/sendText/${instance.instance_token}`
    
    console.log('Sending via instance:', instance.instance_name, 'to phone:', phone, 'url:', sendUrl)

    const uazResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: phone,
        message: message,
      }),
    })

    if (!uazResponse.ok) {
      const errorText = await uazResponse.text()
      throw new Error(`UazAPI error: ${uazResponse.status} - ${errorText}`)
    }

    // Save outbound message to database with instance info
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