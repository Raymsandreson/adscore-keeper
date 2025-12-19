import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PIXEL_ID = Deno.env.get('FACEBOOK_PIXEL_ID');
const ACCESS_TOKEN = Deno.env.get('FACEBOOK_CAPI_ACCESS_TOKEN');

interface EventData {
  event_name: string;
  event_time?: number;
  event_source_url?: string;
  user_data?: {
    em?: string; // hashed email
    ph?: string; // hashed phone
    fn?: string; // hashed first name
    ln?: string; // hashed last name
    external_id?: string;
    client_ip_address?: string;
    client_user_agent?: string;
    fbc?: string; // Facebook click ID
    fbp?: string; // Facebook browser ID
  };
  custom_data?: {
    value?: number;
    currency?: string;
    content_name?: string;
    content_category?: string;
    content_ids?: string[];
    content_type?: string;
    lead_id?: string;
    status?: string;
  };
  action_source: 'website' | 'app' | 'phone_call' | 'chat' | 'email' | 'other' | 'system_generated';
}

async function hashData(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!PIXEL_ID || !ACCESS_TOKEN) {
      console.error('Missing Facebook CAPI credentials');
      return new Response(
        JSON.stringify({ error: 'Facebook CAPI credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { events, test_event_code } = body as { events: EventData[], test_event_code?: string };

    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Events array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process events - hash user data if provided
    const processedEvents = await Promise.all(events.map(async (event) => {
      const processedEvent: any = {
        event_name: event.event_name,
        event_time: event.event_time || Math.floor(Date.now() / 1000),
        action_source: event.action_source || 'system_generated',
      };

      if (event.event_source_url) {
        processedEvent.event_source_url = event.event_source_url;
      }

      // Hash user data
      if (event.user_data) {
        processedEvent.user_data = {};
        
        if (event.user_data.em) {
          processedEvent.user_data.em = await hashData(event.user_data.em);
        }
        if (event.user_data.ph) {
          // Remove non-numeric characters before hashing
          const cleanPhone = event.user_data.ph.replace(/\D/g, '');
          processedEvent.user_data.ph = await hashData(cleanPhone);
        }
        if (event.user_data.fn) {
          processedEvent.user_data.fn = await hashData(event.user_data.fn);
        }
        if (event.user_data.ln) {
          processedEvent.user_data.ln = await hashData(event.user_data.ln);
        }
        if (event.user_data.external_id) {
          processedEvent.user_data.external_id = await hashData(event.user_data.external_id);
        }
        if (event.user_data.client_ip_address) {
          processedEvent.user_data.client_ip_address = event.user_data.client_ip_address;
        }
        if (event.user_data.client_user_agent) {
          processedEvent.user_data.client_user_agent = event.user_data.client_user_agent;
        }
        if (event.user_data.fbc) {
          processedEvent.user_data.fbc = event.user_data.fbc;
        }
        if (event.user_data.fbp) {
          processedEvent.user_data.fbp = event.user_data.fbp;
        }
      }

      // Add custom data
      if (event.custom_data) {
        processedEvent.custom_data = event.custom_data;
      }

      return processedEvent;
    }));

    // Build request payload
    const payload: any = {
      data: processedEvents,
      access_token: ACCESS_TOKEN,
    };

    // Add test event code if provided (for testing in Facebook Events Manager)
    if (test_event_code) {
      payload.test_event_code = test_event_code;
    }

    console.log(`Sending ${processedEvents.length} events to Facebook CAPI`);
    console.log('Event names:', processedEvents.map(e => e.event_name).join(', '));

    // Send to Facebook Conversions API
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${PIXEL_ID}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Facebook CAPI error:', JSON.stringify(result));
      return new Response(
        JSON.stringify({ 
          error: 'Facebook API error', 
          details: result,
          events_received: processedEvents.length 
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Facebook CAPI success:', JSON.stringify(result));

    return new Response(
      JSON.stringify({ 
        success: true, 
        events_received: result.events_received,
        messages: result.messages || [],
        fbtrace_id: result.fbtrace_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in facebook-capi function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
