import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const CALLFACE_REGISTER_TOKEN = Deno.env.get('CALLFACE_REGISTER_TOKEN');
    if (!CALLFACE_REGISTER_TOKEN) {
      return new Response(JSON.stringify({ error: 'CALLFACE_REGISTER_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = RESOLVED_SUPABASE_URL;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/callface-webhook`;

    const registerPayload = {
      name: "ABRACI.IA",
      description: "CRM de gestão inteligente de leads e marketing - ABRACI.IA",
      webhook_url: webhookUrl,
      needed_credentials: ["user_email"],
      register_token: CALLFACE_REGISTER_TOKEN,
    };

    console.log('Registering app with CallFace:', JSON.stringify(registerPayload));

    const res = await fetch('https://api.dev.callface.io/integrate-app/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload),
    });

    const data = await res.json();
    console.log('CallFace register response:', JSON.stringify(data), 'status:', res.status);

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Registration failed', details: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, message: data.message, webhook_url: webhookUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('CallFace register error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
