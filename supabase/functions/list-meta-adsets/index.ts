import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accessToken, adAccountId, limit = 100 } = await req.json();

    if (!accessToken || !adAccountId) {
      return new Response(
        JSON.stringify({ error: 'Missing accessToken or adAccountId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fields = 'id,name,status,effective_status,campaign_id,campaign{name}';
    const url = `https://graph.facebook.com/v25.0/${adAccountId}/adsets?fields=${fields}&limit=${limit}&access_token=${accessToken}`;

    console.log('Fetching adsets from:', url.replace(accessToken, '***'));

    const res = await fetch(url);
    const data = await res.json();

    console.log('Meta API response status:', res.status, 'data keys:', Object.keys(data));

    if (data.error) {
      console.error('Meta API error:', JSON.stringify(data.error));
      return new Response(
        JSON.stringify({ error: data.error.message || 'Failed to fetch adsets', meta_error: data.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adsets = (data.data || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      campaign_id: a.campaign_id,
      campaign_name: a.campaign?.name || '',
      effective_status: a.effective_status || 'UNKNOWN',
    }));

    return new Response(
      JSON.stringify({ success: true, adsets }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error listing Meta adsets:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
