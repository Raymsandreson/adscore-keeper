import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Facebook CAPI - Supports TWO modes:
 * 
 * 1. BUSINESS MESSAGING (CTWA/WhatsApp ads) — Official format per:
 *    https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/
 *    Requires: ctwa_clid, dataset_id, whatsapp_business_account_id
 *    action_source: "business_messaging", messaging_channel: "whatsapp"
 * 
 * 2. WEBSITE/PIXEL — Legacy format for pixel-based tracking
 *    Uses: FACEBOOK_PIXEL_ID + hashed user data
 */

const PIXEL_ID = Deno.env.get('FACEBOOK_PIXEL_ID');
const ACCESS_TOKEN = Deno.env.get('FACEBOOK_CAPI_ACCESS_TOKEN');

interface BusinessMessagingEvent {
  event_name: string;
  event_time?: number;
  action_source: 'business_messaging';
  messaging_channel: 'whatsapp';
  user_data: {
    whatsapp_business_account_id: string;
    ctwa_clid: string;
  };
  custom_data?: {
    currency?: string;
    value?: number;
    content_category?: string;
    lead_id?: string;
    status?: string;
  };
}

interface PixelEvent {
  event_name: string;
  event_time?: number;
  event_source_url?: string;
  user_data?: Record<string, string>;
  custom_data?: Record<string, unknown>;
  action_source: string;
}

async function hashData(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get or create the dataset_id for a given WABA ID.
 * Caches in meta_capi_config table.
 */
async function getDatasetId(wabaId: string, accessToken: string): Promise<string | null> {
  const sb = createClient(resolveSupabaseUrl(), resolveServiceRoleKey());

  // Check cache first
  const { data: cached } = await sb
    .from('meta_capi_config')
    .select('dataset_id')
    .eq('waba_id', wabaId)
    .maybeSingle();

  if (cached?.dataset_id) return cached.dataset_id;

  // Create/get dataset via Meta API
  try {
    const resp = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/dataset?access_token=${accessToken}`,
      { method: 'POST' }
    );
    const result = await resp.json();
    
    if (result.id) {
      // Cache it
      await sb.from('meta_capi_config').upsert({
        waba_id: wabaId,
        dataset_id: result.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'waba_id' });
      
      console.log(`[CAPI] Created/retrieved dataset ${result.id} for WABA ${wabaId}`);
      return result.id;
    }

    // Try GET if POST didn't return an id
    const getResp = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/dataset?access_token=${accessToken}`
    );
    const getData = await getResp.json();
    const dsId = getData?.data?.[0]?.id || getData?.id;
    
    if (dsId) {
      await sb.from('meta_capi_config').upsert({
        waba_id: wabaId,
        dataset_id: dsId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'waba_id' });
      return dsId;
    }

    console.error('[CAPI] Failed to get dataset_id:', JSON.stringify(result), JSON.stringify(getData));
    return null;
  } catch (err) {
    console.error('[CAPI] Error getting dataset:', err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!ACCESS_TOKEN) {
      console.error('Missing Facebook CAPI access token');
      return new Response(
        JSON.stringify({ error: 'Facebook CAPI credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { events, test_event_code, mode } = body as {
      events: any[];
      test_event_code?: string;
      mode?: 'business_messaging' | 'pixel';
    };

    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Events array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== MODE: BUSINESS MESSAGING (CTWA WhatsApp) =====
    if (mode === 'business_messaging') {
      const firstEvent = events[0] as BusinessMessagingEvent;
      const wabaId = firstEvent.user_data?.whatsapp_business_account_id;
      
      if (!wabaId) {
        return new Response(
          JSON.stringify({ error: 'whatsapp_business_account_id is required for business_messaging mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get dataset_id
      const datasetId = await getDatasetId(wabaId, ACCESS_TOKEN);
      if (!datasetId) {
        return new Response(
          JSON.stringify({ error: 'Could not retrieve dataset_id for WABA. Check permissions: whatsapp_business_manage_events' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Build events in official format
      const processedEvents = events.map((event: any) => ({
        event_name: event.event_name,
        event_time: event.event_time || Math.floor(Date.now() / 1000),
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: {
          whatsapp_business_account_id: wabaId,
          ctwa_clid: event.user_data.ctwa_clid,
        },
        ...(event.custom_data && { custom_data: event.custom_data }),
      }));

      // Filter out events without ctwa_clid
      const validEvents = processedEvents.filter((e: any) => e.user_data.ctwa_clid);
      
      if (validEvents.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No events with valid ctwa_clid', skipped: processedEvents.length }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const payload: any = { data: validEvents, access_token: ACCESS_TOKEN };
      if (test_event_code) payload.test_event_code = test_event_code;

      console.log(`[CAPI BM] Sending ${validEvents.length} events to dataset ${datasetId}`);

      const response = await fetch(
        `https://graph.facebook.com/v21.0/${datasetId}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error('[CAPI BM] Error:', JSON.stringify(result));
        return new Response(
          JSON.stringify({ error: 'Facebook API error', details: result }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[CAPI BM] Success:', JSON.stringify(result));
      return new Response(
        JSON.stringify({ success: true, events_received: result.events_received, fbtrace_id: result.fbtrace_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== MODE: PIXEL (legacy website tracking) =====
    if (!PIXEL_ID) {
      return new Response(
        JSON.stringify({ error: 'FACEBOOK_PIXEL_ID not configured for pixel mode' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const processedEvents = await Promise.all(events.map(async (event: any) => {
      const processedEvent: any = {
        event_name: event.event_name,
        event_time: event.event_time || Math.floor(Date.now() / 1000),
        action_source: event.action_source || 'system_generated',
      };

      if (event.event_source_url) processedEvent.event_source_url = event.event_source_url;

      if (event.user_data) {
        processedEvent.user_data = {};
        if (event.user_data.em) processedEvent.user_data.em = await hashData(event.user_data.em);
        if (event.user_data.ph) {
          const cleanPhone = event.user_data.ph.replace(/\D/g, '');
          processedEvent.user_data.ph = await hashData(cleanPhone);
        }
        if (event.user_data.fn) processedEvent.user_data.fn = await hashData(event.user_data.fn);
        if (event.user_data.ln) processedEvent.user_data.ln = await hashData(event.user_data.ln);
        if (event.user_data.external_id) processedEvent.user_data.external_id = await hashData(event.user_data.external_id);
        if (event.user_data.client_ip_address) processedEvent.user_data.client_ip_address = event.user_data.client_ip_address;
        if (event.user_data.client_user_agent) processedEvent.user_data.client_user_agent = event.user_data.client_user_agent;
        if (event.user_data.fbc) processedEvent.user_data.fbc = event.user_data.fbc;
        if (event.user_data.fbp) processedEvent.user_data.fbp = event.user_data.fbp;
      }

      if (event.custom_data) processedEvent.custom_data = event.custom_data;
      return processedEvent;
    }));

    const payload: any = { data: processedEvents, access_token: ACCESS_TOKEN };
    if (test_event_code) payload.test_event_code = test_event_code;

    console.log(`[CAPI Pixel] Sending ${processedEvents.length} events`);

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const responseText = await response.text();
    let result: any;
    try { result = JSON.parse(responseText); } catch {
      return new Response(
        JSON.stringify({ error: 'Facebook API returned non-JSON response', details: responseText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      console.error('[CAPI Pixel] Error:', JSON.stringify(result));
      return new Response(
        JSON.stringify({ error: 'Facebook API error', details: result }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[CAPI Pixel] Success:', JSON.stringify(result));
    return new Response(
      JSON.stringify({ success: true, events_received: result.events_received, fbtrace_id: result.fbtrace_id }),
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
