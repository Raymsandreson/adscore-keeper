import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CampaignRequest {
  action: 'update_status' | 'update_budget' | 'update_bid' | 'duplicate' | 'update_creative';
  accessToken: string;
  entityId: string; // campaign_id, adset_id, or ad_id
  entityType: 'campaign' | 'adset' | 'ad';
  // For update_status
  status?: 'ACTIVE' | 'PAUSED';
  // For update_budget
  dailyBudget?: number;
  lifetimeBudget?: number;
  // For update_bid
  bidAmount?: number;
  bidStrategy?: string;
  // For duplicate
  adAccountId?: string;
  // For update_creative
  creativeData?: {
    title?: string;
    body?: string;
    linkDescription?: string;
    callToActionType?: string;
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CampaignRequest = await req.json();
    const { action, accessToken, entityId, entityType } = body;

    if (!accessToken || !entityId || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: accessToken, entityId, action' }),
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
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log(`Action ${action} completed for ${entityType} ${entityId}:`, result);

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

async function updateStatus(accessToken: string, entityId: string, status: 'ACTIVE' | 'PAUSED') {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      status: status,
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'Failed to update status');
  }
  
  return { entityId, newStatus: status, ...data };
}

async function updateBudget(
  accessToken: string, 
  entityId: string, 
  entityType: string,
  dailyBudget?: number, 
  lifetimeBudget?: number
) {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  
  const params: Record<string, any> = {
    access_token: accessToken,
  };

  // Budget values need to be in cents for Meta API
  if (dailyBudget !== undefined) {
    params.daily_budget = Math.round(dailyBudget * 100);
  }
  if (lifetimeBudget !== undefined) {
    params.lifetime_budget = Math.round(lifetimeBudget * 100);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'Failed to update budget');
  }
  
  return { entityId, dailyBudget, lifetimeBudget, ...data };
}

async function updateBid(
  accessToken: string, 
  entityId: string, 
  bidAmount?: number,
  bidStrategy?: string
) {
  const url = `https://graph.facebook.com/v21.0/${entityId}`;
  
  const params: Record<string, any> = {
    access_token: accessToken,
  };

  if (bidAmount !== undefined) {
    // Bid amount in cents
    params.bid_amount = Math.round(bidAmount * 100);
  }
  if (bidStrategy) {
    params.bid_strategy = bidStrategy;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'Failed to update bid');
  }
  
  return { entityId, bidAmount, bidStrategy, ...data };
}

async function duplicateEntity(
  accessToken: string, 
  entityId: string, 
  entityType: string,
  adAccountId: string
) {
  // For campaigns
  if (entityType === 'campaign') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        deep_copy: true,
        status_option: 'PAUSED',
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Failed to duplicate campaign');
    }
    
    return { originalId: entityId, newId: data.copied_campaign_id, ...data };
  }
  
  // For ad sets
  if (entityType === 'adset') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        deep_copy: true,
        status_option: 'PAUSED',
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Failed to duplicate ad set');
    }
    
    return { originalId: entityId, newId: data.copied_adset_id, ...data };
  }

  // For ads
  if (entityType === 'ad') {
    const url = `https://graph.facebook.com/v21.0/${entityId}/copies`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Failed to duplicate ad');
    }
    
    return { originalId: entityId, newId: data.copied_ad_id, ...data };
  }

  throw new Error('Invalid entity type for duplication');
}

async function updateCreative(
  accessToken: string,
  adId: string,
  creativeData: {
    title?: string;
    body?: string;
    linkDescription?: string;
    callToActionType?: string;
  }
) {
  console.log('Updating creative for ad:', adId, creativeData);
  
  // First, get the current ad to find the creative ID
  const adUrl = `https://graph.facebook.com/v21.0/${adId}?fields=creative{id}&access_token=${accessToken}`;
  const adResponse = await fetch(adUrl);
  const adData = await adResponse.json();
  
  if (adData.error) {
    throw new Error(adData.error.message || 'Failed to get ad creative');
  }
  
  const creativeId = adData.creative?.id;
  if (!creativeId) {
    throw new Error('Creative ID not found for this ad');
  }
  
  console.log('Found creative ID:', creativeId);
  
  // Get current creative data to preserve unchanged fields
  const creativeUrl = `https://graph.facebook.com/v21.0/${creativeId}?fields=object_story_spec,name&access_token=${accessToken}`;
  const creativeResponse = await fetch(creativeUrl);
  const currentCreative = await creativeResponse.json();
  
  if (currentCreative.error) {
    throw new Error(currentCreative.error.message || 'Failed to get creative details');
  }
  
  console.log('Current creative:', JSON.stringify(currentCreative, null, 2));
  
  // Build updated object_story_spec
  const objectStorySpec = currentCreative.object_story_spec || {};
  
  if (objectStorySpec.link_data) {
    if (creativeData.body !== undefined) {
      objectStorySpec.link_data.message = creativeData.body;
    }
    if (creativeData.title !== undefined) {
      objectStorySpec.link_data.name = creativeData.title;
    }
    if (creativeData.linkDescription !== undefined) {
      objectStorySpec.link_data.description = creativeData.linkDescription;
    }
    if (creativeData.callToActionType !== undefined) {
      objectStorySpec.link_data.call_to_action = {
        type: creativeData.callToActionType
      };
    }
  } else if (objectStorySpec.video_data) {
    if (creativeData.body !== undefined) {
      objectStorySpec.video_data.message = creativeData.body;
    }
    if (creativeData.title !== undefined) {
      objectStorySpec.video_data.title = creativeData.title;
    }
    if (creativeData.callToActionType !== undefined) {
      objectStorySpec.video_data.call_to_action = {
        type: creativeData.callToActionType
      };
    }
  }
  
  // Update the creative
  const updateUrl = `https://graph.facebook.com/v21.0/${creativeId}`;
  const updateResponse = await fetch(updateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      object_story_spec: JSON.stringify(objectStorySpec),
    }),
  });
  
  const updateData = await updateResponse.json();
  
  if (updateData.error) {
    console.error('Error updating creative:', updateData.error);
    throw new Error(updateData.error.message || 'Failed to update creative');
  }
  
  console.log('Creative updated successfully:', updateData);
  
  return { 
    adId, 
    creativeId, 
    updatedFields: creativeData,
    ...updateData 
  };
}
