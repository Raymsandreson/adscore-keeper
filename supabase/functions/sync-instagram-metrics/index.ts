import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InstagramInsightsResponse {
  data: Array<{
    name: string;
    period: string;
    values: Array<{
      value: number;
      end_time: string;
    }>;
    title: string;
    description: string;
    id: string;
  }>;
}

interface InstagramUserResponse {
  id: string;
  username: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  profile_picture_url?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { account_id } = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: 'account_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('instagram_accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const instagramId = account.instagram_id;
    
    // Validate Instagram ID format - must be numeric
    if (!/^\d+$/.test(instagramId)) {
      console.error('Invalid Instagram ID format:', instagramId, '- must be a numeric ID, not username');
      return new Response(
        JSON.stringify({ 
          error: 'ID de conta Instagram inválido', 
          details: `O ID "${instagramId}" parece ser um username em vez do ID numérico do Instagram Business. Por favor, delete esta conta e adicione novamente usando o botão "Conectar Conta" que buscará as contas do seu Meta Business.`,
          invalid_format: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use global META_ACCESS_TOKEN if account doesn't have its own token
    const accessToken = account.access_token === 'USE_GLOBAL_TOKEN' 
      ? Deno.env.get('META_ACCESS_TOKEN') 
      : account.access_token;
    
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'No access token available. Configure META_ACCESS_TOKEN.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch user info using the Instagram Business Account ID
    const userResponse = await fetch(
      `https://graph.facebook.com/v18.0/${instagramId}?fields=id,username,followers_count,follows_count,media_count,profile_picture_url&access_token=${accessToken}`
    );
    
    const userData: InstagramUserResponse = await userResponse.json();

    if (!userResponse.ok) {
      console.error('Instagram API error:', userData);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch Instagram data', details: userData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update account with latest user info
    await supabase
      .from('instagram_accounts')
      .update({
        followers_count: userData.followers_count || 0,
        following_count: userData.follows_count || 0,
        media_count: userData.media_count || 0,
        profile_picture_url: userData.profile_picture_url || null,
        last_sync_at: new Date().toISOString(),
      })
      .eq('id', account_id);

    // Fetch insights (reach, impressions, etc.)
    let insightsData = {
      reach: 0,
      impressions: 0,
      profile_views: 0,
      website_clicks: 0,
      email_contacts: 0,
    };

    try {
      const insightsResponse = await fetch(
        `https://graph.facebook.com/v18.0/${instagramId}/insights?metric=reach,impressions,profile_views,website_clicks,email_contacts&period=day&access_token=${accessToken}`
      );
      
      if (insightsResponse.ok) {
        const insights: InstagramInsightsResponse = await insightsResponse.json();
        
        insights.data?.forEach((metric) => {
          const latestValue = metric.values?.[metric.values.length - 1]?.value || 0;
          if (metric.name === 'reach') insightsData.reach = latestValue;
          if (metric.name === 'impressions') insightsData.impressions = latestValue;
          if (metric.name === 'profile_views') insightsData.profile_views = latestValue;
          if (metric.name === 'website_clicks') insightsData.website_clicks = latestValue;
          if (metric.name === 'email_contacts') insightsData.email_contacts = latestValue;
        });
      }
    } catch (insightError) {
      console.log('Could not fetch insights (might need business account):', insightError);
    }

    // Calculate engagement rate
    const engagementRate = userData.followers_count > 0 
      ? ((insightsData.reach / userData.followers_count) * 100).toFixed(2)
      : 0;

    // Upsert metrics for today
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Fetch yesterday's followers count to calculate new followers
    let newFollowers = 0;
    try {
      const { data: yesterdayMetrics } = await supabase
        .from('instagram_metrics')
        .select('followers_count')
        .eq('account_id', account_id)
        .eq('metric_date', yesterday)
        .maybeSingle();
      
      if (yesterdayMetrics?.followers_count) {
        newFollowers = (userData.followers_count || 0) - yesterdayMetrics.followers_count;
        console.log('New followers calculated:', newFollowers, '(today:', userData.followers_count, ', yesterday:', yesterdayMetrics.followers_count, ')');
      } else {
        // If no yesterday data, try to get the most recent previous day
        const { data: lastMetrics } = await supabase
          .from('instagram_metrics')
          .select('followers_count, metric_date')
          .eq('account_id', account_id)
          .lt('metric_date', today)
          .order('metric_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (lastMetrics?.followers_count) {
          newFollowers = (userData.followers_count || 0) - lastMetrics.followers_count;
          console.log('New followers calculated from last metric:', newFollowers, '(today:', userData.followers_count, ', last:', lastMetrics.followers_count, 'date:', lastMetrics.metric_date, ')');
        } else {
          console.log('No previous metrics found, cannot calculate new followers');
        }
      }
    } catch (e) {
      console.warn('Error fetching previous followers:', e);
    }
    
    // Also try to get new followers from Instagram API insights
    let apiNewFollowers = 0;
    try {
      const followerInsightsResponse = await fetch(
        `https://graph.facebook.com/v18.0/${instagramId}/insights?metric=follower_count&period=day&access_token=${accessToken}`
      );
      
      if (followerInsightsResponse.ok) {
        const followerInsights = await followerInsightsResponse.json();
        if (followerInsights.data?.[0]?.values) {
          // Sum up the daily changes (follower_count returns net change per day)
          apiNewFollowers = followerInsights.data[0].values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          console.log('API follower_count insights:', apiNewFollowers, 'values:', followerInsights.data[0].values.length);
          
          // Use API value if available and different from calculated
          if (apiNewFollowers !== 0) {
            newFollowers = apiNewFollowers;
          }
        }
      }
    } catch (e) {
      console.log('Could not fetch follower_count insights:', e);
    }
    
    await supabase
      .from('instagram_metrics')
      .upsert({
        account_id,
        metric_date: today,
        followers_count: userData.followers_count || 0,
        following_count: userData.follows_count || 0,
        media_count: userData.media_count || 0,
        reach: insightsData.reach,
        impressions: insightsData.impressions,
        profile_views: insightsData.profile_views,
        website_clicks: insightsData.website_clicks,
        email_contacts: insightsData.email_contacts,
        engagement_rate: engagementRate,
        new_followers: newFollowers,
      }, {
        onConflict: 'account_id,metric_date',
      });
    
    console.log('Metrics saved. New followers:', newFollowers);

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: {
          ...userData,
          insights: insightsData,
          engagement_rate: engagementRate,
          new_followers: newFollowers,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
