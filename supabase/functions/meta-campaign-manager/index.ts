import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CampaignRequest {
  action: 'update_status' | 'update_budget' | 'update_bid' | 'duplicate' | 'update_creative' | 'get_targeting' | 'update_targeting' | 'search_locations';
  accessToken: string;
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad';
  status?: 'ACTIVE' | 'PAUSED';
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
  bidStrategy?: string;
  adAccountId?: string;
  creativeData?: {
    title?: string;
    body?: string;
    linkDescription?: string;
    callToActionType?: string;
  };
  targeting?: {
    geo_locations?: {
      countries?: string[];
      cities?: { key: string; name?: string; radius?: number; distance_unit?: string }[];
      zips?: { key: string; name?: string }[];
      regions?: { key: string; name?: string }[];
      custom_locations?: { latitude: number; longitude: number; radius?: number; distance_unit?: string; name?: string }[];
    };
  };
  searchQuery?: string;
  locationType?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CampaignRequest = await req.json();
    const { action, accessToken, entityId, entityType } = body;

    if (!accessToken || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: accessToken, action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result;

    switch (action) {
      case 'update_status':
        result = await updateStatus(accessToken, entityId, body.status!);
        break;
      case 'update_budget':
        result = await updateBudget(accessToken, entityId, entityType, body.dailyBudget, body.lifetimeBudget);
        break;
      case 'update_bid':
        result = await updateBid(accessToken, entityId, body.bidAmount, body.bidStrategy);
        break;
      case 'duplicate':
        result = await duplicateEntity(accessToken, entityId, entityType, body.adAccountId!);
        break;
      case 'update_creative':
        result = await updateCreative(accessToken, entityId, body.creativeData!);
        break;
      case 'get_targeting':
        if (entityType === 'campaign') {
          result = await getCampaignTargeting(accessToken, entityId);
        } else {
          result = await getTargeting(accessToken, entityId);
        }
        break;
      case 'update_targeting':
        if (entityType === 'campaign') {
          result = await updateCampaignTargeting(accessToken, entityId, body.targeting!);
        } else {
          result = await updateTargeting(accessToken, entityId, body.targeting!);
        }
        break;
      case 'search_locations':
        result = await searchLocations(accessToken, body.searchQuery!, body.locationType || 'adgeolocation');
        break;
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log(`Action ${action} completed for ${entityType} ${entityId}:`, JSON.stringify(result).substring(0, 500));

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in meta-campaign-manager:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getTargeting(accessToken: string, adSetId: string) {
  const url = `https://graph.facebook.com/v21.0/${adSetId}?access_token=${accessToken}&fields=targeting,name`;
  console.log(`[get_targeting] Fetching: ${url.replace(accessToken, 'TOKEN_HIDDEN')}`);
  const response = await fetch(url);
  const data = await response.json();

  console.log(`[get_targeting] Full API response keys:`, Object.keys(data));
  console.log(`[get_targeting] Full response JSON:`, JSON.stringify(data).substring(0, 3000));

  if (data.error) {
    throw new Error(data.error.message || 'Failed to get targeting');
  }

  const targeting = data.targeting || {};
  const geoLocations = targeting.geo_locations || {};
  
  console.log(`[get_targeting] targeting keys:`, Object.keys(targeting));
  console.log(`[get_targeting] geo_locations keys:`, Object.keys(geoLocations));
  console.log(`[get_targeting] geo_locations full:`, JSON.stringify(geoLocations));
  
  return {
    adSetId,
    name: data.name,
    targeting,
  };
}

async function getAdSetsForCampaign(accessToken: string, campaignId: string): Promise<string[]> {
  const url = `https://graph.facebook.com/v21.0/${campaignId}/adsets?access_token=${accessToken}&fields=id&limit=100`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to get ad sets');
  return (data.data || []).map((a: any) => a.id);
}

async function getCampaignTargeting(accessToken: string, campaignId: string) {
  const adSetIds = await getAdSetsForCampaign(accessToken, campaignId);
  if (adSetIds.length === 0) {
    return { campaignId, adSetCount: 0, targeting: { geo_locations: {} } };
  }
  const first = await getTargeting(accessToken, adSetIds[0]);
  return { campaignId, adSetCount: adSetIds.length, adSetIds, ...first };
}

async function updateCampaignTargeting(
  accessToken: string,
  campaignId: string,
  targeting: { geo_locations?: any }
) {
  const adSetIds = await getAdSetsForCampaign(accessToken, campaignId);
  if (adSetIds.length === 0) throw new Error('Nenhum conjunto de anúncios encontrado nesta campanha');
  
  const results = [];
  const errors: any[] = [];
  for (const adSetId of adSetIds) {
    try {
      const r = await updateTargeting(accessToken, adSetId, targeting);
      results.push({ adSetId, success: true, ...r });
    } catch (e: any) {
      errors.push({ adSetId, error: e.message });
    }
  }
  return { campaignId, totalAdSets: adSetIds.length, updated: results.length, errors, results };
}

async function updateTargeting(
  accessToken: string,
  adSetId: string,
  targeting: {
    geo_locations?: {
      countries?: string[];
      cities?: { key: string; name?: string; radius?: number; distance_unit?: string }[];
      zips?: { key: string; name?: string }[];
      regions?: { key: string; name?: string }[];
      custom_locations?: { latitude: number; longitude: number; radius?: number; distance_unit?: string }[];
    };
  }
) {
  // Only send geo_locations in the targeting update - do NOT merge full targeting
  // as it includes read-only fields (targeting_automation, publisher_platforms, etc.)
  // that cause "Application does not have permission" errors
  const updateTargetingPayload = {
    geo_locations: targeting.geo_locations,
  };

  console.log(`[update_targeting] Updating adset ${adSetId} with:`, JSON.stringify(updateTargetingPayload));

  // Use form-encoded POST as per Meta API docs
  const params = new URLSearchParams();
  params.append('access_token', accessToken);
  params.append('targeting', JSON.stringify(updateTargetingPayload));

  const updateUrl = `https://graph.facebook.com/v21.0/${adSetId}`;
  const updateResp = await fetch(updateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const updateData = await updateResp.json();

  if (updateData.error) {
    throw new Error(updateData.error.message || 'Failed to update targeting');
  }

  return { adSetId, updatedGeoLocations: targeting.geo_locations, ...updateData };
}

// Search locations using Meta Marketing API
// Docs: https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting/
// type=adgeolocation searches across all location types (cities, regions, countries, zips)
// type=adcountry, adregion, adcity, adzip for specific types
async function searchLocations(accessToken: string, query: string, locationType: string) {
  // Use adgeolocation for broad search, which returns cities, regions, countries, zips
  const url = `https://graph.facebook.com/v21.0/search?type=${locationType}&q=${encodeURIComponent(query)}&access_token=${accessToken}&locale=pt_BR&limit=25`;
  
  console.log(`[search_locations] Searching for "${query}" with type=${locationType}`);
  
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error(`[search_locations] Error:`, JSON.stringify(data.error));
    throw new Error(data.error.message || 'Failed to search locations');
  }

  console.log(`[search_locations] Found ${data.data?.length || 0} results for "${query}"`);
  if (data.data?.length > 0) {
    console.log(`[search_locations] First result:`, JSON.stringify(data.data[0]));
  }

  return { results: data.data || [] };
}

async function updateStatus(accessToken: string, entityId: string, status: 'ACTIVE' | 'PAUSED') {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken, status }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to update status');
  return { entityId, newStatus: status, ...data };
}

async function updateBudget(accessToken: string, entityId: string, entityType: string, dailyBudget?: number, lifetimeBudget?: number) {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  const params: Record<string, any> = { access_token: accessToken };
  if (dailyBudget !== undefined) params.daily_budget = Math.round(dailyBudget * 100);
  if (lifetimeBudget !== undefined) params.lifetime_budget = Math.round(lifetimeBudget * 100);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to update budget');
  return { entityId, dailyBudget, lifetimeBudget, ...data };
}

async function updateBid(accessToken: string, entityId: string, bidAmount?: number, bidStrategy?: string) {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  const params: Record<string, any> = { access_token: accessToken };
  if (bidAmount !== undefined) params.bid_amount = Math.round(bidAmount * 100);
  if (bidStrategy) params.bid_strategy = bidStrategy;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Failed to update bid');
  return { entityId, bidAmount, bidStrategy, ...data };
}

async function duplicateEntity(accessToken: string, entityId: string, entityType: string, adAccountId: string) {
  if (entityType === 'campaign') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken, deep_copy: true, status_option: 'PAUSED' }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Failed to duplicate campaign');
    return { originalId: entityId, newId: data.copied_campaign_id, ...data };
  }
  if (entityType === 'adset') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken, deep_copy: true, status_option: 'PAUSED' }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Failed to duplicate ad set');
    return { originalId: entityId, newId: data.copied_adset_id, ...data };
  }
  if (entityType === 'ad') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Failed to duplicate ad');
    return { originalId: entityId, newId: data.copied_ad_id, ...data };
  }
  throw new Error('Invalid entity type for duplication');
}

async function updateCreative(accessToken: string, adId: string, creativeData: { title?: string; body?: string; linkDescription?: string; callToActionType?: string }) {
  const adUrl = `https://graph.facebook.com/v21.0/${adId}?fields=creative{id}&access_token=${accessToken}`;
  const adResponse = await fetch(adUrl);
  const adData = await adResponse.json();
  if (adData.error) throw new Error(adData.error.message || 'Failed to get ad creative');
  const creativeId = adData.creative?.id;
  if (!creativeId) throw new Error('Creative ID not found for this ad');

  const creativeUrl = `https://graph.facebook.com/v21.0/${creativeId}?fields=object_story_spec,name&access_token=${accessToken}`;
  const creativeResponse = await fetch(creativeUrl);
  const currentCreative = await creativeResponse.json();
  if (currentCreative.error) throw new Error(currentCreative.error.message || 'Failed to get creative details');

  const objectStorySpec = currentCreative.object_story_spec || {};
  if (objectStorySpec.link_data) {
    if (creativeData.body !== undefined) objectStorySpec.link_data.message = creativeData.body;
    if (creativeData.title !== undefined) objectStorySpec.link_data.name = creativeData.title;
    if (creativeData.linkDescription !== undefined) objectStorySpec.link_data.description = creativeData.linkDescription;
    if (creativeData.callToActionType !== undefined) objectStorySpec.link_data.call_to_action = { type: creativeData.callToActionType };
  } else if (objectStorySpec.video_data) {
    if (creativeData.body !== undefined) objectStorySpec.video_data.message = creativeData.body;
    if (creativeData.title !== undefined) objectStorySpec.video_data.title = creativeData.title;
    if (creativeData.callToActionType !== undefined) objectStorySpec.video_data.call_to_action = { type: creativeData.callToActionType };
  }

  const updateUrl = `https://graph.facebook.com/v21.0/${creativeId}`;
  const updateResponse = await fetch(updateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken, object_story_spec: JSON.stringify(objectStorySpec) }) });
  const updateData = await updateResponse.json();
  if (updateData.error) throw new Error(updateData.error.message || 'Failed to update creative');
  return { adId, creativeId, updatedFields: creativeData, ...updateData };
}
