import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateCampaignRequest {
  accessToken: string;
  adAccountId: string;
  postId: string; // Instagram/Facebook post ID
  campaignName: string;
  objective: string; // OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS, OUTCOME_LEADS, OUTCOME_SALES
  // Budget
  dailyBudget?: number;
  lifetimeBudget?: number;
  startDate: string; // ISO date
  endDate?: string;
  // Targeting
  locations?: { key: string; name: string }[];
  ageMin?: number;
  ageMax?: number;
  genders?: number[]; // 0=all, 1=male, 2=female
  interests?: { id: string; name: string }[];
  customAudiences?: { id: string; name: string }[];
  // Placements
  placements?: string[];
  // Metadata
  editorialPostId?: string;
  postTitle?: string;
  postPlatform?: string;
  pageId?: string;
  leadId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CreateCampaignRequest = await req.json();
    const { accessToken, adAccountId, postId, campaignName, objective } = body;

    if (!accessToken || !adAccountId || !postId || !campaignName || !objective) {
      return new Response(
        JSON.stringify({ error: 'Missing required: accessToken, adAccountId, postId, campaignName, objective' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    // Step 1: Create Campaign
    console.log('Creating campaign:', campaignName, 'objective:', objective);
    const campaignResponse = await fetch(`https://graph.facebook.com/v21.0/${actId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        name: campaignName,
        objective: objective,
        status: 'PAUSED',
        special_ad_categories: [],
      }),
    });
    const campaignData = await campaignResponse.json();
    if (campaignData.error) {
      throw new Error(`Campaign: ${campaignData.error.message}`);
    }
    const campaignId = campaignData.id;
    console.log('Campaign created:', campaignId);

    // Step 2: Create Ad Set
    const adsetName = `${campaignName} - Conjunto`;
    const targeting: Record<string, any> = {};

    // Locations
    if (body.locations && body.locations.length > 0) {
      targeting.geo_locations = {
        countries: body.locations.map(l => l.key),
      };
    } else {
      targeting.geo_locations = { countries: ['BR'] };
    }

    // Age
    targeting.age_min = body.ageMin || 18;
    targeting.age_max = body.ageMax || 65;

    // Genders
    if (body.genders && body.genders.length > 0 && !body.genders.includes(0)) {
      targeting.genders = body.genders;
    }

    // Interests
    if (body.interests && body.interests.length > 0) {
      targeting.flexible_spec = [{
        interests: body.interests.map(i => ({ id: i.id, name: i.name })),
      }];
    }

    // Custom audiences
    if (body.customAudiences && body.customAudiences.length > 0) {
      targeting.custom_audiences = body.customAudiences.map(ca => ({ id: ca.id }));
    }

    const adsetParams: Record<string, any> = {
      access_token: accessToken,
      name: adsetName,
      campaign_id: campaignId,
      billing_event: 'IMPRESSIONS',
      optimization_goal: objective === 'OUTCOME_TRAFFIC' ? 'LINK_CLICKS' 
        : objective === 'OUTCOME_ENGAGEMENT' ? 'POST_ENGAGEMENT'
        : objective === 'OUTCOME_AWARENESS' ? 'REACH'
        : objective === 'OUTCOME_LEADS' ? 'LEAD_GENERATION'
        : 'IMPRESSIONS',
      targeting: targeting,
      status: 'PAUSED',
      start_time: body.startDate,
    };

    // Budget (in cents)
    if (body.dailyBudget) {
      adsetParams.daily_budget = Math.round(body.dailyBudget * 100);
    } else if (body.lifetimeBudget) {
      adsetParams.lifetime_budget = Math.round(body.lifetimeBudget * 100);
      if (body.endDate) {
        adsetParams.end_time = body.endDate;
      }
    }

    if (body.endDate) {
      adsetParams.end_time = body.endDate;
    }

    console.log('Creating adset with targeting:', JSON.stringify(targeting));
    const adsetResponse = await fetch(`https://graph.facebook.com/v21.0/${actId}/adsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adsetParams),
    });
    const adsetData = await adsetResponse.json();
    if (adsetData.error) {
      // Cleanup: delete the campaign
      await fetch(`https://graph.facebook.com/v21.0/${campaignId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      throw new Error(`AdSet: ${adsetData.error.message}`);
    }
    const adsetId = adsetData.id;
    console.log('AdSet created:', adsetId);

    // Step 3: Create Ad Creative using existing post
    const pageId = body.pageId || Deno.env.get('FACEBOOK_PAGE_ID');
    
    const creativeParams: Record<string, any> = {
      access_token: accessToken,
      name: `${campaignName} - Criativo`,
      object_story_id: `${pageId}_${postId}`,
    };

    console.log('Creating creative with post:', postId);
    const creativeResponse = await fetch(`https://graph.facebook.com/v21.0/${actId}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creativeParams),
    });
    const creativeData = await creativeResponse.json();
    if (creativeData.error) {
      // Try alternative: use the post_id directly as effective_object_story_id
      console.log('First creative attempt failed, trying with source_story_id...');
      const altCreativeParams = {
        access_token: accessToken,
        name: `${campaignName} - Criativo`,
        effective_object_story_id: postId,
      };
      const altCreativeResponse = await fetch(`https://graph.facebook.com/v21.0/${actId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(altCreativeParams),
      });
      const altCreativeData = await altCreativeResponse.json();
      if (altCreativeData.error) {
        throw new Error(`Creative: ${altCreativeData.error.message}`);
      }
      // Use this creative
      const creativeId = altCreativeData.id;
      console.log('Creative created (alt):', creativeId);
      
      // Step 4: Create Ad
      return await createAd(accessToken, actId, adsetId, creativeId, campaignName, campaignId, body);
    }

    const creativeId = creativeData.id;
    console.log('Creative created:', creativeId);

    // Step 4: Create Ad
    return await createAd(accessToken, actId, adsetId, creativeId, campaignName, campaignId, body);

  } catch (error) {
    console.error('Error creating campaign:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function createAd(
  accessToken: string,
  actId: string,
  adsetId: string,
  creativeId: string,
  campaignName: string,
  campaignId: string,
  body: CreateCampaignRequest
) {
  const adParams = {
    access_token: accessToken,
    name: `${campaignName} - Anúncio`,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: 'PAUSED',
  };

  const adResponse = await fetch(`https://graph.facebook.com/v21.0/${actId}/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adParams),
  });
  const adData = await adResponse.json();
  if (adData.error) {
    throw new Error(`Ad: ${adData.error.message}`);
  }
  const adId = adData.id;
  console.log('Ad created:', adId);

  // Save to database
  const supabaseUrl = RESOLVED_SUPABASE_URL;
  const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  await supabase.from('promoted_posts').insert({
    post_title: body.postTitle || campaignName,
    post_platform: body.postPlatform || 'instagram',
    post_id: body.postId,
    campaign_id: campaignId,
    adset_id: adsetId,
    ad_id: adId,
    ad_account_id: body.adAccountId,
    campaign_name: campaignName,
    objective: body.objective,
    status: 'paused',
    daily_budget: body.dailyBudget || null,
    lifetime_budget: body.lifetimeBudget || null,
    start_date: body.startDate,
    end_date: body.endDate || null,
    targeting_locations: body.locations?.map(l => l.name) || ['Brasil'],
    targeting_age_min: body.ageMin || 18,
    targeting_age_max: body.ageMax || 65,
    targeting_genders: body.genders || [0],
    targeting_interests: body.interests || null,
    targeting_custom_audiences: body.customAudiences || null,
    placements: body.placements || null,
    editorial_post_id: body.editorialPostId || null,
    lead_id: body.leadId || null,
  });

  const result = {
    campaignId,
    adsetId,
    adId,
    creativeId,
    status: 'paused',
  };

  console.log('Full campaign created:', result);

  return new Response(
    JSON.stringify({ success: true, data: result }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
