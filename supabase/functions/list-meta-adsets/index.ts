import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// In-memory cache (persists across warm invocations)
const cache = new Map<string, { data: any; expiresAt: number; storedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh
const STALE_TTL_MS = 60 * 60 * 1000; // 1 hour stale fallback

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url);
    console.log(`[list-meta-adsets] ↩️ Meta response status=${res.status} attempt=${attempt + 1}/${maxRetries}`);
    
    if (res.status === 400 || res.status === 403) {
      const body = await res.json();
      console.warn(`[list-meta-adsets] ⚠️ Meta error payload attempt=${attempt + 1}: code=${body.error?.code ?? 'n/a'} subcode=${body.error?.error_subcode ?? 'n/a'} message=${body.error?.message ?? 'unknown'}`);
      if (body.error?.code === 17 || body.error?.error_subcode === 2446079) {
        const waitMs = Math.min(2000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
        console.warn(`Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(waitMs)}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
    }
    
    return res;
  }
  
  throw new Error('Meta API rate limit exceeded after retries. Aguarde alguns minutos e tente novamente.');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accessToken, adAccountId, campaignId, limit = 100 } = await req.json();

    if (!accessToken || !adAccountId) {
      return new Response(
        JSON.stringify({ error: 'Missing accessToken or adAccountId', adsets: [], fallback: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedCampaignId = typeof campaignId === 'string' && campaignId.trim() ? campaignId.trim() : null;

    console.log(`[list-meta-adsets] 📥 Request: adAccountId=${adAccountId}, campaignId=${normalizedCampaignId || 'NONE (account-wide)'}, limit=${limit}`);

    // Check fresh cache first
    const cacheKey = `${adAccountId}_${normalizedCampaignId || 'all'}_${limit}`;
    const cached = cache.get(cacheKey);
    if (!cached) {
      console.log(`[list-meta-adsets] ⚪ Cache miss for key=${cacheKey}`);
    } else if (cached.expiresAt <= Date.now()) {
      console.log(`[list-meta-adsets] 🕒 Cache expired for key=${cacheKey}, age=${Math.round((Date.now() - cached.storedAt) / 1000)}s, staleEligible=${(cached.storedAt + STALE_TTL_MS) > Date.now()}`);
    }
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[list-meta-adsets] 🟢 FRESH CACHE hit for key=${cacheKey}, returning ${cached.data.length} adsets (age: ${Math.round((Date.now() - cached.storedAt) / 1000)}s)`);
      return new Response(
        JSON.stringify({ success: true, adsets: cached.data, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fields = 'id,name,status,effective_status,campaign_id,campaign{name},promoted_object,destination_type';
    const basePath = normalizedCampaignId ? `${normalizedCampaignId}/adsets` : `${adAccountId}/adsets`;
    const url = `https://graph.facebook.com/v25.0/${basePath}?fields=${fields}&limit=${limit}&access_token=${accessToken}`;

    console.log(`[list-meta-adsets] 🌐 Calling Meta API: https://graph.facebook.com/v25.0/${basePath}?fields=${fields}&limit=${limit}&access_token=***`);

    let data: any;
    try {
      const res = await fetchWithRetry(url);
      data = await res.json();
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : 'Meta API unavailable';
      console.error(`[list-meta-adsets] ❌ Fetch failed: ${errMsg}`);
      if (cached && (cached.storedAt + STALE_TTL_MS) > Date.now()) {
        console.warn(`[list-meta-adsets] 🟡 STALE CACHE fallback (fetch err) for key=${cacheKey}, returning ${cached.data.length} adsets (age: ${Math.round((Date.now() - cached.storedAt) / 1000)}s)`);
        return new Response(
          JSON.stringify({ success: true, adsets: cached.data, cached: true, stale: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.warn(`[list-meta-adsets] 🚫 No stale cache available for key=${cacheKey} after fetch failure`);
      return new Response(
        JSON.stringify({ success: false, adsets: [], fallback: true, error: errMsg }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (data.error) {
      console.error(`[list-meta-adsets] ❌ Meta API error: ${JSON.stringify(data.error)}`);
      if (cached && (cached.storedAt + STALE_TTL_MS) > Date.now()) {
        console.warn(`[list-meta-adsets] 🟡 STALE CACHE fallback (meta err) for key=${cacheKey}, returning ${cached.data.length} adsets (age: ${Math.round((Date.now() - cached.storedAt) / 1000)}s)`);
        return new Response(
          JSON.stringify({ success: true, adsets: cached.data, cached: true, stale: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.warn(`[list-meta-adsets] 🚫 No stale cache available for key=${cacheKey} after Meta error`);
      return new Response(
        JSON.stringify({ success: false, adsets: [], fallback: true, error: data.error.message || 'Failed to fetch adsets', meta_error: data.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[list-meta-adsets] ✅ Meta returned ${(data.data || []).length} adsets (raw). Paging: ${data.paging?.next ? 'has next page' : 'no more pages'}`);

    const adsets = (data.data || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      campaign_id: a.campaign_id,
      campaign_name: a.campaign?.name || '',
      effective_status: a.effective_status || 'UNKNOWN',
      destination_phone: a.promoted_object?.whatsapp_phone_number || a.promoted_object?.page_id || null,
      destination_type: a.destination_type || null,
    }));

    cache.set(cacheKey, { data: adsets, expiresAt: Date.now() + CACHE_TTL_MS, storedAt: Date.now() });
    console.log(`[list-meta-adsets] 💾 Cached ${adsets.length} adsets for key=${cacheKey}, returning to client`);

    return new Response(
      JSON.stringify({ success: true, adsets }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error listing Meta adsets:', error);
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(
      JSON.stringify({ success: false, adsets: [], fallback: true, error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
