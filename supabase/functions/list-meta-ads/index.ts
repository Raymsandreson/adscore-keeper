import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Fetch campaigns with insights
    const fields = [
      'name', 'status', 'objective', 'daily_budget', 'lifetime_budget',
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

    const campaignRes = await fetch(campaignUrl);
    const campaignData = await campaignRes.json();

    if (campaignData.error) {
      throw new Error(campaignData.error.message || 'Failed to fetch campaigns');
    }

    const campaigns = campaignData.data || [];

    // Fetch insights for each campaign (batch)
    const campaignsWithInsights = await Promise.all(
      campaigns.map(async (campaign: any) => {
        try {
          const insightUrl = `https://graph.facebook.com/v21.0/${campaign.id}/insights?fields=${insightFields}&date_preset=maximum&access_token=${accessToken}`;
          const insightRes = await fetch(insightUrl);
          const insightData = await insightRes.json();
          const insights = insightData.data?.[0] || {};

          // Extract follower actions
          const actions = insights.actions || [];
          const followAction = actions.find((a: any) => a.action_type === 'page_engagement' || a.action_type === 'like');
          const commentAction = actions.find((a: any) => a.action_type === 'comment');
          const likeAction = actions.find((a: any) => a.action_type === 'post_reaction' || a.action_type === 'like');

          return {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            status: campaign.status?.toLowerCase() || 'unknown',
            objective: campaign.objective,
            daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetime_budget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
            start_time: campaign.start_time,
            stop_time: campaign.stop_time,
            created_time: campaign.created_time,
            // Insights
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
            status: campaign.status?.toLowerCase() || 'unknown',
            objective: campaign.objective,
            daily_budget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetime_budget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
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
