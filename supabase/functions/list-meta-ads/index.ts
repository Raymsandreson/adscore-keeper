import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchJson(url: string) {
  const res = await fetch(url);
  return res.json();
}

async function findDestinationPhone(campaignId: string, accessToken: string): Promise<string | null> {
  try {
    // 1. Check adsets for promoted_object (most reliable for CTWA)
    const adsetsUrl = `https://graph.facebook.com/v21.0/${campaignId}/adsets?fields=promoted_object,destination_type&limit=5&access_token=${accessToken}`;
    const adsetsData = await fetchJson(adsetsUrl);
    const adsets = adsetsData.data || [];
    
    for (const adset of adsets) {
      // Check promoted_object for whatsapp phone
      if (adset.promoted_object?.whatsapp_phone_number) {
        return adset.promoted_object.whatsapp_phone_number;
      }
      // If destination_type is WHATSAPP, try to get the page's whatsapp number
      if (adset.destination_type === 'WHATSAPP' && adset.promoted_object?.page_id) {
        try {
          const pageUrl = `https://graph.facebook.com/v21.0/${adset.promoted_object.page_id}?fields=whatsapp_number&access_token=${accessToken}`;
          const pageData = await fetchJson(pageUrl);
          if (pageData.whatsapp_number) return pageData.whatsapp_number;
        } catch {}
      }
    }

    // 2. Check campaign-level promoted_object
    const campUrl = `https://graph.facebook.com/v21.0/${campaignId}?fields=promoted_object&access_token=${accessToken}`;
    const campData = await fetchJson(campUrl);
    if (campData.promoted_object?.whatsapp_phone_number) {
      return campData.promoted_object.whatsapp_phone_number;
    }

    // 3. Check ad creatives for whatsapp links/numbers
    const adsUrl = `https://graph.facebook.com/v21.0/${campaignId}/ads?fields=creative{object_story_spec,asset_feed_spec,url_tags}&limit=3&access_token=${accessToken}`;
    const adsData = await fetchJson(adsUrl);
    const ads = adsData.data || [];

    for (const ad of ads) {
      const creative = ad.creative;
      if (!creative) continue;

      const phone = extractPhoneFromCreative(creative);
      if (phone) return phone;
    }

    return null;
  } catch (e) {
    console.error('Error finding destination phone:', e);
    return null;
  }
}

function extractPhoneFromCreative(creative: any): string | null {
  // Check object_story_spec
  const spec = creative.object_story_spec;
  if (spec) {
    // link_data CTA
    const linkCta = spec.link_data?.call_to_action?.value;
    if (linkCta?.whatsapp_number) return linkCta.whatsapp_number;
    if (linkCta?.link) {
      const m = linkCta.link.match(/wa\.me\/(\d+)/);
      if (m) return m[1];
    }
    // video_data CTA
    const videoCta = spec.video_data?.call_to_action?.value;
    if (videoCta?.whatsapp_number) return videoCta.whatsapp_number;
    if (videoCta?.link) {
      const m = videoCta.link.match(/wa\.me\/(\d+)/);
      if (m) return m[1];
    }
  }

  // Check asset_feed_spec
  const assetFeed = creative.asset_feed_spec;
  if (assetFeed?.call_to_actions) {
    for (const cta of assetFeed.call_to_actions) {
      if (cta?.value?.whatsapp_number) return cta.value.whatsapp_number;
      if (cta?.value?.link?.includes('wa.me/')) {
        const m = cta.value.link.match(/wa\.me\/(\d+)/);
        if (m) return m[1];
      }
    }
  }
  if (assetFeed?.link_urls) {
    for (const linkUrl of assetFeed.link_urls) {
      const url = linkUrl?.website_url || linkUrl?.display_url || '';
      if (url.includes('wa.me/')) {
        const m = url.match(/wa\.me\/(\d+)/);
        if (m) return m[1];
      }
    }
  }

  // Check url_tags
  if (creative.url_tags) {
    const m = creative.url_tags.match(/wa\.me\/(\d+)/);
    if (m) return m[1];
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accessToken, adAccountId, limit = 50, status } = await req.json();

    if (!accessToken || !adAccountId) {
      return new Response(
        JSON.stringify({ error: 'Missing accessToken or adAccountId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fields = [
      'name', 'status', 'effective_status', 'objective', 'daily_budget', 'lifetime_budget',
      'start_time', 'stop_time', 'created_time', 'updated_time'
    ].join(',');

    const insightFields = [
      'impressions', 'reach', 'clicks', 'spend', 'cpm', 'cpc', 'ctr',
      'actions', 'cost_per_action_type'
    ].join(',');

    let campaignUrl = `https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=${fields}&limit=${limit}&access_token=${accessToken}`;
    if (status) {
      campaignUrl += `&filtering=[{"field":"effective_status","operator":"IN","value":${JSON.stringify(status)}}]`;
    }

    const campaignData = await fetchJson(campaignUrl);
    if (campaignData.error) {
      throw new Error(campaignData.error.message || 'Failed to fetch campaigns');
    }

    const campaigns = campaignData.data || [];

    const campaignsWithInsights = await Promise.all(
      campaigns.map(async (campaign: any) => {
        try {
          // Fetch insights and destination phone in parallel
          const [insightData, destinationPhone] = await Promise.all([
            fetchJson(`https://graph.facebook.com/v21.0/${campaign.id}/insights?fields=${insightFields}&date_preset=maximum&access_token=${accessToken}`),
            findDestinationPhone(campaign.id, accessToken),
          ]);

          const insights = insightData.data?.[0] || {};
          const actions = insights.actions || [];
          const followAction = actions.find((a: any) => a.action_type === 'page_engagement' || a.action_type === 'like');
          const commentAction = actions.find((a: any) => a.action_type === 'comment');
          const likeAction = actions.find((a: any) => a.action_type === 'post_reaction' || a.action_type === 'like');

          console.log(`Campaign ${campaign.name}: destination_phone=${destinationPhone}`);

          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            status: (campaign.effective_status || campaign.status || 'UNKNOWN').toUpperCase(),
            objective: campaign.objective,
            daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetime_budget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
            start_time: campaign.start_time,
            stop_time: campaign.stop_time,
            created_time: campaign.created_time,
            destination_phone: destinationPhone,
            impressions: Number(insights.impressions || 0),
            reach: Number(insights.reach || 0),
            clicks: Number(insights.clicks || 0),
            spend: Number(insights.spend || 0),
            cpm: Number(insights.cpm || 0),
            cpc: Number(insights.cpc || 0),
            ctr: Number(insights.ctr || 0),
            followers_gained: Number(followAction?.value || 0),
            comments_count: Number(commentAction?.value || 0),
            likes_count: Number(likeAction?.value || 0),
          };
        } catch {
          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            status: (campaign.effective_status || campaign.status || 'UNKNOWN').toUpperCase(),
            objective: campaign.objective,
            daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetime_budget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
            destination_phone: null,
            impressions: 0, reach: 0, clicks: 0, spend: 0,
            cpm: 0, cpc: 0, ctr: 0,
            followers_gained: 0, comments_count: 0, likes_count: 0,
          };
        }
      })
    );

    return new Response(
      JSON.stringify({ success: true, campaigns: campaignsWithInsights }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error listing Meta ads:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
