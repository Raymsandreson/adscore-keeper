import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Validate user auth
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseAnonKey = RESOLVED_ANON_KEY
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: userData, error: authError } = await userClient.auth.getUser()
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const identity = userData.user.id

    // Twilio credentials
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const apiKeySid = Deno.env.get('TWILIO_API_KEY_SID')
    const apiKeySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
    const twimlAppSid = Deno.env.get('TWILIO_TWIML_APP_SID')

    console.log('[TWILIO-TOKEN] Credentials check:', {
      accountSid: accountSid ? `${accountSid.substring(0, 6)}...${accountSid.substring(accountSid.length - 4)}` : 'MISSING',
      apiKeySid: apiKeySid ? `${apiKeySid.substring(0, 6)}...${apiKeySid.substring(apiKeySid.length - 4)}` : 'MISSING',
      apiKeySecret: apiKeySecret ? `length=${apiKeySecret.length}` : 'MISSING',
      twimlAppSid: twimlAppSid ? `${twimlAppSid.substring(0, 6)}...${twimlAppSid.substring(twimlAppSid.length - 4)}` : 'MISSING',
    })

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      console.error('Missing Twilio credentials')
      return new Response(JSON.stringify({ error: 'Twilio not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate credential formats
    if (!accountSid.startsWith('AC')) {
      console.error('TWILIO_ACCOUNT_SID should start with AC')
    }
    if (!apiKeySid.startsWith('SK')) {
      console.error('TWILIO_API_KEY_SID should start with SK')
    }
    if (!twimlAppSid.startsWith('AP')) {
      console.error('TWILIO_TWIML_APP_SID should start with AP')
    }

    // Generate AccessToken with Voice grant using Twilio REST API approach
    // Since we can't use the Twilio SDK in Deno, we build the JWT manually
    const now = Math.floor(Date.now() / 1000)
    const ttl = 3600 // 1 hour

    // Build JWT header
    const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' }

    // Build JWT payload with voice grant
    const payload = {
      jti: `${apiKeySid}-${now}`,
      iss: apiKeySid,
      sub: accountSid,
      exp: now + ttl,
      nbf: now,
      grants: {
        identity,
        voice: {
          incoming: { allow: true },
          outgoing: { application_sid: twimlAppSid },
        },
      },
    }

    // Base64url encode
    const enc = new TextEncoder()
    function b64url(data: Uint8Array): string {
      return btoa(String.fromCharCode(...data))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    }

    const headerB64 = b64url(enc.encode(JSON.stringify(header)))
    const payloadB64 = b64url(enc.encode(JSON.stringify(payload)))
    const signingInput = `${headerB64}.${payloadB64}`

    // HMAC-SHA256 sign
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(apiKeySecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput))
    const signatureB64 = b64url(new Uint8Array(signature))

    const token = `${signingInput}.${signatureB64}`

    console.log('[TWILIO-TOKEN] Token generated successfully, length:', token.length)
    console.log('[TWILIO-TOKEN] Token payload:', JSON.stringify(payload))

    return new Response(JSON.stringify({ token, identity }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Twilio token error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
