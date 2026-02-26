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

    // Extract user from JWT
    let userId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || supabaseKey
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } }
      })
      const { data: userData } = await userClient.auth.getUser()
      userId = userData?.user?.id || null
    }

    const body = await req.json()
    const { phone, instance_id, instance_name, contact_name, contact_id, lead_id, lead_name } = body

    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Format phone number
    const cleanPhone = phone.replace(/\D/g, '')
    const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

    // Get instance by id, name, or fallback to first active
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

    if (!instance && instance_name) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('instance_name', instance_name)
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
      console.error(`UazAPI error for instance ${instance.instance_name}: ${uazResponse.status}`, responseData)
      return new Response(
        JSON.stringify({ success: false, error: `Erro na UazAPI (${uazResponse.status}): ${responseData?.message || 'Token inválido ou instância desconectada. Verifique o token da instância.'}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('UazAPI call response:', JSON.stringify(responseData))

    // Create call_record automatically
    let callRecordId: string | null = null
    if (userId) {
      // Resolve lead_name if lead_id is provided but lead_name is not
      let resolvedLeadName = lead_name || null
      if (lead_id && !resolvedLeadName) {
        const { data: leadData } = await supabase
          .from('leads')
          .select('lead_name')
          .eq('id', lead_id)
          .single()
        resolvedLeadName = leadData?.lead_name || null
      }

      const { data: callRecord, error: insertError } = await supabase
        .from('call_records')
        .insert({
          user_id: userId,
          call_type: 'realizada',
          call_result: 'em_andamento',
          contact_phone: phone,
          contact_name: contact_name || null,
          contact_id: contact_id || null,
          lead_id: lead_id || null,
          lead_name: resolvedLeadName,
          phone_used: instance.instance_name || 'whatsapp',
          notes: `Chamada iniciada via UazAPI.${resolvedLeadName ? ` Lead: ${resolvedLeadName}` : ''}`,
          tags: ['whatsapp', 'uazapi'],
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Error creating call_record:', insertError)
      } else {
        callRecordId = callRecord?.id
        console.log('Created call_record:', callRecordId)
      }

      // Also insert into call_events_pending for real-time tracking
      await supabase.from('call_events_pending').insert({
        call_id: responseData?.callId || `manual_${Date.now()}`,
        phone: formattedPhone,
        event_type: 'offer',
        from_me: true,
        contact_name: contact_name || null,
        instance_name: instance.instance_name,
      }).then(({ error }) => {
        if (error) console.error('Error creating call_events_pending:', error)
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: responseData,
        instance_name: instance.instance_name,
        call_record_id: callRecordId,
      }),
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
