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

    const campaignRes = await fetch(campaignUrl);
    const campaignData = await campaignRes.json();

    if (campaignData.error) {
      throw new Error(campaignData.error.message || 'Failed to fetch campaigns');
    }

    const campaigns = campaignData.data || [];

    // Fetch insights and destination phone for each campaign
    const campaignsWithInsights = await Promise.all(
      campaigns.map(async (campaign: any) => {
        try {
          // Fetch insights
          const insightUrl = `https://graph.facebook.com/v21.0/${campaign.id}/insights?fields=${insightFields}&date_preset=maximum&access_token=${accessToken}`;
          const insightRes = await fetch(insightUrl);
          const insightData = await insightRes.json();
          const insights = insightData.data?.[0] || {};

          // Fetch ads to get destination phone number (CTWA)
          let destinationPhone: string | null = null;
          try {
            const adsUrl = `https://graph.facebook.com/v21.0/${campaign.id}/ads?fields=creative{object_story_spec,asset_feed_spec,url_tags}&limit=5&access_token=${accessToken}`;
            const adsRes = await fetch(adsUrl);
            const adsData = await adsRes.json();
            const ads = adsData.data || [];
            
            for (const ad of ads) {
              if (destinationPhone) break;
              const creative = ad.creative;
              if (!creative) continue;
              
              // Helper to extract phone from various spec locations
              const extractPhone = (spec: any): string | null => {
                if (!spec) return null;
                // Check link_data CTA
                const linkCta = spec.link_data?.call_to_action?.value;
                if (linkCta?.whatsapp_number) return linkCta.whatsapp_number;
                if (linkCta?.app_destination === 'WHATSAPP' && linkCta?.link) {
                  const m = linkCta.link.match(/wa\.me\/(\d+)/);
                  if (m) return m[1];
                }
                // Check video_data CTA
                const videoCta = spec.video_data?.call_to_action?.value;
                if (videoCta?.whatsapp_number) return videoCta.whatsapp_number;
                if (videoCta?.app_destination === 'WHATSAPP' && videoCta?.link) {
                  const m = videoCta.link.match(/wa\.me\/(\d+)/);
                  if (m) return m[1];
                }
                // Check page_welcome_message (common in CTWA)
                const pwm = spec.page_welcome_message;
                if (pwm) {
                  try {
                    const parsed = typeof pwm === 'string' ? JSON.parse(pwm) : pwm;
                    if (parsed?.ctwa_clid || parsed?.type === 'WHATSAPP') {
                      // Phone might be in referral or not directly here
                    }
                  } catch {}
                }
                return null;
              };

              // Check object_story_spec
              destinationPhone = extractPhone(creative.object_story_spec);
              
              // Check asset_feed_spec
              if (!destinationPhone && creative.asset_feed_spec) {
                const assetFeed = creative.asset_feed_spec;
                // Check call_to_actions array
                if (assetFeed.call_to_actions) {
                  for (const cta of assetFeed.call_to_actions) {
                    if (cta?.value?.whatsapp_number) {
                      destinationPhone = cta.value.whatsapp_number;
                      break;
                    }
                    if (cta?.value?.link?.includes('wa.me/')) {
                      const m = cta.value.link.match(/wa\.me\/(\d+)/);
                      if (m) { destinationPhone = m[1]; break; }
                    }
                  }
                }
                // Check link_urls
                if (!destinationPhone && assetFeed.link_urls) {
                  for (const linkUrl of assetFeed.link_urls) {
                    const url = linkUrl?.website_url || linkUrl?.display_url || '';
                    if (url.includes('wa.me/')) {
                      const m = url.match(/wa\.me\/(\d+)/);
                      if (m) { destinationPhone = m[1]; break; }
                    }
                  }
                }
              }
              
              // Check url_tags for phone hints
              if (!destinationPhone && creative.url_tags) {
                const m = creative.url_tags.match(/wa\.me\/(\d+)/);
                if (m) destinationPhone = m[1];
              }
            }

            // If still no phone, try fetching ad-level promoted_object
            if (!destinationPhone && ads.length > 0) {
              try {
                const adDetailUrl = `https://graph.facebook.com/v21.0/${ads[0].id}?fields=promoted_object&access_token=${accessToken}`;
                const adDetailRes = await fetch(adDetailUrl);
                const adDetail = await adDetailRes.json();
                if (adDetail?.promoted_object?.page_id) {
                  // It's a CTWA ad but phone might be in the page's whatsapp number
                }
              } catch {}
            }

            // Try campaign-level promoted_object
            if (!destinationPhone) {
              try {
                const campDetailUrl = `https://graph.facebook.com/v21.0/${campaign.id}?fields=promoted_object&access_token=${accessToken}`;
                const campDetailRes = await fetch(campDetailUrl);
                const campDetail = await campDetailRes.json();
                // Some CTWA campaigns have the phone in promoted_object
                if (campDetail?.promoted_object?.whatsapp_phone_number) {
                  destinationPhone = campDetail.promoted_object.whatsapp_phone_number;
                }
              } catch {}
            }

            console.log(`Campaign ${campaign.name}: destination_phone=${destinationPhone}`);
          } catch (e) {
            console.error('Error fetching ads for destination phone:', e);
          }

          // Extract follower actions
          const actions = insights.actions || [];
          const followAction = actions.find((a: any) => a.action_type === 'page_engagement' || a.action_type === 'like');
          const commentAction = actions.find((a: any) => a.action_type === 'comment');
          const likeAction = actions.find((a: any) => a.action_type === 'post_reaction' || a.action_type === 'like');

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
