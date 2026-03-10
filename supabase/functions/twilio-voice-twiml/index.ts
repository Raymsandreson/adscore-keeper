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
      // Normalize Brazilian mobile numbers - add 9th digit if missing
      let normalized = cleanTo.startsWith('55') ? cleanTo : `55${cleanTo}`
      
      // Brazilian mobile: 55 + 2-digit DDD + 9 + 8 digits = 13 digits
      // If we have 12 digits (55 + DDD + 8 digits), the 9 is missing
      if (normalized.length === 12) {
        const ddd = normalized.substring(2, 4)
        const number = normalized.substring(4)
        // Mobile numbers in Brazil start with 6,7,8,9 after the 9 prefix
        // If first digit is 6-9, it's likely a mobile missing the 9
        if (['6','7','8','9'].includes(number[0])) {
          normalized = `55${ddd}9${number}`
          console.log(`Auto-added 9th digit: ${cleanTo} -> ${normalized}`)
        }
      }
      
      const formattedTo = `+${normalized}`
      
      // MUST use a real Twilio phone number as callerId for PSTN calls
      // The "From" field from Twilio Client SDK is "client:xxx" which is NOT valid for PSTN
      const twilioCallerId = Deno.env.get('TWILIO_CALLER_ID') || ''
      
      // Only use callerId from request if it looks like a real phone number (starts with +)
      const callerIdToUse = (callerId && callerId.startsWith('+')) ? callerId : twilioCallerId
      
      console.log('Outbound call to:', formattedTo, 'callerId:', callerIdToUse, 'original From:', callerId)
      
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
