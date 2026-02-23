import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
    const { phone, instance_id } = body

    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Format phone number
    const cleanPhone = phone.replace(/\D/g, '')
    const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

    // Get instance
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

    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const callUrl = `${baseUrl}/call/make`

    console.log('Making call via UazAPI:', callUrl, 'to:', formattedPhone)

    const uazResponse = await fetch(callUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': instance.instance_token,
      },
      body: JSON.stringify({ number: formattedPhone }),
    })

    const responseData = await uazResponse.json().catch(() => ({}))

    if (!uazResponse.ok) {
      throw new Error(`UazAPI error: ${uazResponse.status} - ${JSON.stringify(responseData)}`)
    }

    console.log('UazAPI call response:', JSON.stringify(responseData))

    return new Response(
      JSON.stringify({ success: true, data: responseData, instance_name: instance.instance_name }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Make WhatsApp call error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
