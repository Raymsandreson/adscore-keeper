import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CampaignRequest {
  action: 'update_status' | 'update_budget' | 'update_bid' | 'duplicate';
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
