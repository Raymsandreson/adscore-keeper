const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const META_API_VERSION = 'v25.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { access_token, ad_account_id, date_preset, level } = await req.json();

    if (!access_token || !ad_account_id) {
      return new Response(JSON.stringify({ error: 'Missing credentials' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validLevel = level === 'ad' ? 'ad' : 'campaign';
    const validPreset = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'].includes(date_preset)
      ? date_preset
      : 'last_30d';

    const accountId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;

    const fields = [
      'campaign_name',
      'campaign_id',
      validLevel === 'ad' ? 'ad_name' : '',
      validLevel === 'ad' ? 'ad_id' : '',
      'spend',
      'impressions',
      'reach',
      'actions',
    ].filter(Boolean).join(',');

    const url = `${META_BASE}/${accountId}/insights?fields=${fields}&date_preset=${validPreset}&level=${validLevel}&action_breakdowns=action_type&limit=500&access_token=${access_token}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error('Meta API error:', data.error);
      return new Response(JSON.stringify({ error: data.error.message || 'Meta API error' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract follower-related actions
    const results = (data.data || []).map((item: any) => {
      const actions = item.actions || [];
      const followerActions = ['follow', 'like', 'page_engagement', 'post_engagement', 'onsite_conversion.post_save', 'link_click'];

      const actionMap: Record<string, number> = {};
      for (const a of actions) {
        if (followerActions.includes(a.action_type)) {
          actionMap[a.action_type] = parseInt(a.value, 10) || 0;
        }
      }

      const followers = actionMap['follow'] || actionMap['like'] || 0;
      const spend = parseFloat(item.spend || '0');
      const cps = followers > 0 ? spend / followers : null;

      return {
        campaign_id: item.campaign_id,
        campaign_name: item.campaign_name,
        ad_id: item.ad_id || null,
        ad_name: item.ad_name || null,
        spend,
        impressions: parseInt(item.impressions || '0', 10),
        reach: parseInt(item.reach || '0', 10),
        followers,
        page_engagement: actionMap['page_engagement'] || 0,
        post_engagement: actionMap['post_engagement'] || 0,
        link_clicks: actionMap['link_click'] || 0,
        cps,
        actions: actionMap,
      };
    });

    // Sort by followers desc
    results.sort((a: any, b: any) => b.followers - a.followers);

    return new Response(JSON.stringify({ data: results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('meta-follower-insights error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});