import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
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
 * Normaliza telefone brasileiro para E.164 (só dígitos, com DDI 55) antes do hash.
 * Idempotente: não duplica o 55 em números que já vêm no formato internacional.
 * Meta espera country code no telefone; sem isso o hash não bate e o match cai.
 * Casos:
 *  - 13 díg. começando com 55 (55 + DDD + 9 dígitos)  -> mantém
 *  - 12 díg. começando com 55 (55 + DDD + 8 dígitos)  -> mantém
 *  - 11 díg. (DDD + 9 dígitos)                        -> prefixa 55
 *  - 10 díg. (DDD + 8 dígitos)                        -> prefixa 55
 *  - outro                                            -> mantém (formato desconhecido, não corrompe)
 */
function toE164BR(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return digits;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/**
 * POST resiliente para a Graph API: retenta em falha de rede, 429 (rate limit)
 * e 5xx, com backoff exponencial. Erros 4xx (exceto 429) não são retentados.
 */
async function postToMetaWithRetry(
  url: string,
  body: string,
  maxAttempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      // Retenta apenas rate-limit e erros de servidor
      if ((resp.status === 429 || resp.status >= 500) && attempt < maxAttempts) {
        const retryAfter = Number(resp.headers.get('retry-after')) || 0;
        const backoffMs = Math.max(retryAfter * 1000, 500 * 2 ** (attempt - 1));
        console.warn(`[CAPI] HTTP ${resp.status}, retry ${attempt}/${maxAttempts} em ${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const backoffMs = 500 * 2 ** (attempt - 1);
        console.warn(`[CAPI] Erro de rede, retry ${attempt}/${maxAttempts} em ${backoffMs}ms:`, err);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
    }
  }
  throw lastErr ?? new Error('postToMetaWithRetry: esgotou tentativas');
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
        ...(event.event_id && { event_id: event.event_id }),
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

      const response = await postToMetaWithRetry(
        `https://graph.facebook.com/v21.0/${datasetId}/events`,
        JSON.stringify(payload),
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
        ...(event.event_id && { event_id: event.event_id }),
        event_time: event.event_time || Math.floor(Date.now() / 1000),
        action_source: event.action_source || 'system_generated',
      };

      if (event.event_source_url) processedEvent.event_source_url = event.event_source_url;

      if (event.user_data) {
        processedEvent.user_data = {};
        if (event.user_data.em) processedEvent.user_data.em = await hashData(event.user_data.em);
        if (event.user_data.ph) {
          // E.164 (com DDI 55) antes do hash — sem isso o match do Meta cai (bug B).
          const e164Phone = toE164BR(event.user_data.ph);
          if (e164Phone) processedEvent.user_data.ph = await hashData(e164Phone);
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

    const response = await postToMetaWithRetry(
      `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`,
      JSON.stringify(payload),
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
