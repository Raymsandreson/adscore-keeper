const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Parse form data (Twilio sends POST with form-encoded data)
    let to = ''
    let callerId = ''

    const contentType = req.headers.get('content-type') || ''
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData()
      to = formData.get('To') as string || ''
      callerId = formData.get('From') as string || ''
      
      // If To is empty, check custom params
      if (!to) {
        to = formData.get('phone') as string || ''
      }
    } else {
      // JSON body (from our frontend)
      try {
        const body = await req.json()
        to = body.To || body.phone || ''
        callerId = body.callerId || ''
      } catch {
        // empty body is ok for incoming
      }
    }

    // Clean phone number
    const cleanTo = to.replace(/\D/g, '')
    
    let twiml: string

    if (cleanTo) {
      // Outbound call - Dial the number
      // Format for Brazil: +55XXXXXXXXXXX
      const formattedTo = cleanTo.startsWith('55') ? `+${cleanTo}` : `+55${cleanTo}`
      
      // Use Twilio caller ID or a verified number
      // For trial accounts, callerId must be a verified number
      const callerIdToUse = callerId || Deno.env.get('TWILIO_CALLER_ID') || ''
      
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${callerIdToUse ? ` callerId="${callerIdToUse}"` : ''} answerOnBridge="true" timeout="30">
    <Number>${formattedTo}</Number>
  </Dial>
</Response>`
    } else {
      // Incoming call or no destination - just say something
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Obrigado por ligar. Estamos transferindo sua chamada.</Say>
  <Dial>
    <Client>browser</Client>
  </Dial>
</Response>`
    }

    console.log('TwiML response:', twiml)

    return new Response(twiml, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/xml',
      },
    })

  } catch (error) {
    console.error('TwiML error:', error)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Ocorreu um erro. Tente novamente.</Say>
</Response>`
    return new Response(twiml, {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
    })
  }
})
