import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrganicInsights {
  totalFollowers: number;
  newFollowers: number;
  followerChange: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileViews: number;
  websiteClicks: number;
}

interface DailyOrganicData {
  date: string;
  followers: number;
  newFollowers: number;
  reach: number;
  engagement: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get('FACEBOOK_CAPI_ACCESS_TOKEN');
    const pageId = Deno.env.get('FACEBOOK_PAGE_ID');

    if (!accessToken || !pageId) {
      console.log('Missing credentials, returning simulated data');
      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          insights: generateSimulatedInsights(),
          dailyData: generateSimulatedDailyData(),
          message: 'Dados simulados - Configure FACEBOOK_PAGE_ID e FACEBOOK_CAPI_ACCESS_TOKEN'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching insights for page:', pageId);

    // First, try to get Instagram Business Account connected to this page
    const igAccountResponse = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`
    );
    const igAccountData = await igAccountResponse.json();
    console.log('Instagram account data:', igAccountData);

    let platform = 'facebook';
    let targetId = pageId;

    if (igAccountData.instagram_business_account?.id) {
      // We have an Instagram Business Account - use Instagram API
      targetId = igAccountData.instagram_business_account.id;
      platform = 'instagram';
      console.log('Found Instagram Business Account:', targetId);
      
      return await fetchInstagramInsights(targetId, accessToken);
    } else {
      // No Instagram account connected - use Facebook Page API
      console.log('No Instagram account found, using Facebook Page API');
      return await fetchFacebookInsights(pageId, accessToken);
    }

  } catch (error) {
    console.error('Error fetching organic insights:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const isPermissionError = errorMessage.includes('pages_read_engagement') || 
                              errorMessage.includes('permission') ||
                              errorMessage.includes('OAuthException') ||
                              errorMessage.includes('instagram_basic') ||
                              errorMessage.includes('instagram_manage_insights');
    
    return new Response(
      JSON.stringify({
        success: false,
        simulated: true,
        insights: null,
        dailyData: [],
        error: errorMessage,
        isPermissionError,
        message: isPermissionError 
          ? 'Token sem permissões necessárias. Para Instagram: instagram_basic, instagram_manage_insights. Para Facebook: pages_read_engagement, read_insights'
          : 'Erro ao buscar dados reais.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function fetchInstagramInsights(igAccountId: string, accessToken: string): Promise<Response> {
  console.log('Fetching Instagram insights for account:', igAccountId);

  // Fetch basic account info
  const accountResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}?fields=followers_count,follows_count,media_count,username,name,profile_picture_url&access_token=${accessToken}`
  );
  const accountData = await accountResponse.json();
  console.log('Instagram account info:', accountData);

  if (accountData.error) {
    console.error('Error fetching Instagram account:', accountData.error);
    throw new Error(accountData.error.message);
  }

  const totalFollowers = accountData.followers_count || 0;

  // Fetch insights (follower demographics, reach, impressions)
  // Note: Some metrics require minimum 100 followers
  const insightsMetrics = [
    'follower_count',
    'reach',
    'impressions',
    'profile_views',
    'website_clicks',
    'accounts_engaged'
  ].join(',');

  let reach = 0;
  let impressions = 0;
  let profileViews = 0;
  let websiteClicks = 0;
  let newFollowers = 0;
  const dailyData: DailyOrganicData[] = [];

  try {
    // Get insights for the last 7 days
    const insightsResponse = await fetch(
      `https://graph.facebook.com/v18.0/${igAccountId}/insights?metric=reach,impressions,profile_views,website_clicks,follower_count&period=day&metric_type=total_value&access_token=${accessToken}`
    );
    const insightsData = await insightsResponse.json();
    console.log('Instagram insights data:', JSON.stringify(insightsData).substring(0, 500));

    if (insightsData.data) {
      for (const metric of insightsData.data) {
        const values = metric.values || [];
        const totalValue = metric.total_value?.value || values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
        
        switch (metric.name) {
          case 'reach':
            reach = totalValue;
            break;
          case 'impressions':
            impressions = totalValue;
            break;
          case 'profile_views':
            profileViews = totalValue;
            break;
          case 'website_clicks':
            websiteClicks = totalValue;
            break;
          case 'follower_count':
            // This gives daily follower count changes
            if (values.length > 0) {
              const firstValue = values[0]?.value || totalFollowers;
              const lastValue = values[values.length - 1]?.value || totalFollowers;
              newFollowers = lastValue - firstValue;
            }
            break;
        }
      }
    }
  } catch (insightsError) {
    console.warn('Could not fetch insights (may require more permissions):', insightsError);
  }

  // Try to get daily reach data
  try {
    const dailyInsightsResponse = await fetch(
      `https://graph.facebook.com/v18.0/${igAccountId}/insights?metric=reach,follower_count&period=day&access_token=${accessToken}`
    );
    const dailyInsightsData = await dailyInsightsResponse.json();
    
    if (dailyInsightsData.data) {
      const reachMetric = dailyInsightsData.data.find((m: any) => m.name === 'reach');
      const followerMetric = dailyInsightsData.data.find((m: any) => m.name === 'follower_count');
      
      if (reachMetric?.values) {
        let prevFollowerCount = totalFollowers;
        reachMetric.values.forEach((v: any, index: number) => {
          const dateStr = v.end_time?.split('T')[0];
          const dailyReach = v.value || 0;
          const dailyFollowers = followerMetric?.values?.[index]?.value || prevFollowerCount;
          const dailyNew = index === 0 ? 0 : (dailyFollowers - prevFollowerCount);
          
          if (dateStr) {
            dailyData.push({
              date: dateStr,
              followers: dailyFollowers,
              newFollowers: Math.max(0, dailyNew),
              reach: dailyReach,
              engagement: dailyReach > 0 ? (dailyReach / totalFollowers) * 100 : 0
            });
          }
          prevFollowerCount = dailyFollowers;
        });
      }
    }
  } catch (dailyError) {
    console.warn('Could not fetch daily insights:', dailyError);
  }

  // Fetch recent media for engagement metrics
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let saves = 0;

  try {
    const mediaResponse = await fetch(
      `https://graph.facebook.com/v18.0/${igAccountId}/media?fields=like_count,comments_count,insights.metric(saved,shares)&limit=25&access_token=${accessToken}`
    );
    const mediaData = await mediaResponse.json();
    console.log('Instagram media count:', mediaData.data?.length || 0);

    if (mediaData.data) {
      for (const media of mediaData.data) {
        likes += media.like_count || 0;
        comments += media.comments_count || 0;
        
        if (media.insights?.data) {
          for (const insight of media.insights.data) {
            if (insight.name === 'saved') saves += insight.values?.[0]?.value || 0;
            if (insight.name === 'shares') shares += insight.values?.[0]?.value || 0;
          }
        }
      }
    }
  } catch (mediaError) {
    console.warn('Could not fetch media insights:', mediaError);
  }

  // Calculate engagement rate
  const totalEngagement = likes + comments + saves + shares;
  const engagementRate = totalFollowers > 0 
    ? (totalEngagement / totalFollowers) * 100 
    : 0;

  const followerChange = totalFollowers > 0 
    ? (newFollowers / totalFollowers) * 100 
    : 0;

  const insights: OrganicInsights = {
    totalFollowers,
    newFollowers,
    followerChange,
    reach,
    impressions,
    engagementRate,
    likes,
    comments,
    shares,
    saves,
    profileViews,
    websiteClicks
  };

  console.log('Returning Instagram insights:', insights);

  return new Response(
    JSON.stringify({
      success: true,
      simulated: false,
      insights,
      dailyData: dailyData.length > 0 ? dailyData : generateSimulatedDailyData(),
      accountId: igAccountId,
      username: accountData.username,
      platform: 'instagram'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function fetchFacebookInsights(pageId: string, accessToken: string): Promise<Response> {
  console.log('Fetching Facebook insights for page:', pageId);

  // Fetch page fans (total followers)
  const fansResponse = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}?fields=followers_count,fan_count&access_token=${accessToken}`
  );
  const fansData = await fansResponse.json();
  console.log('Fans data:', fansData);

  if (fansData.error) {
    console.error('Error fetching fans:', fansData.error);
    throw new Error(fansData.error.message);
  }

  const totalFollowers = fansData.followers_count || fansData.fan_count || 0;

  // Fetch page insights (last 7 days)
  const insightsMetrics = [
    'page_fan_adds',
    'page_impressions',
    'page_impressions_unique',
    'page_post_engagements',
    'page_views_total',
    'page_website_clicks_logged_in_unique'
  ].join(',');

  const insightsResponse = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/insights?metric=${insightsMetrics}&period=day&date_preset=last_7d&access_token=${accessToken}`
  );
  const insightsData = await insightsResponse.json();
  console.log('Insights data received');

  let newFollowers = 0;
  let reach = 0;
  let impressions = 0;
  let engagement = 0;
  let profileViews = 0;
  let websiteClicks = 0;
  const dailyData: DailyOrganicData[] = [];
  const dailyMap: Record<string, DailyOrganicData> = {};

  if (insightsData.data) {
    for (const metric of insightsData.data) {
      const values = metric.values || [];
      
      switch (metric.name) {
        case 'page_fan_adds':
          newFollowers = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          values.forEach((v: any) => {
            const dateStr = v.end_time?.split('T')[0];
            if (dateStr) {
              if (!dailyMap[dateStr]) {
                dailyMap[dateStr] = { date: dateStr, followers: 0, newFollowers: 0, reach: 0, engagement: 0 };
              }
              dailyMap[dateStr].newFollowers = v.value || 0;
            }
          });
          break;
        case 'page_impressions_unique':
          reach = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          values.forEach((v: any) => {
            const dateStr = v.end_time?.split('T')[0];
            if (dateStr && dailyMap[dateStr]) {
              dailyMap[dateStr].reach = v.value || 0;
            }
          });
          break;
        case 'page_impressions':
          impressions = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          break;
        case 'page_post_engagements':
          engagement = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          values.forEach((v: any) => {
            const dateStr = v.end_time?.split('T')[0];
            if (dateStr && dailyMap[dateStr]) {
              dailyMap[dateStr].engagement = v.value || 0;
            }
          });
          break;
        case 'page_views_total':
          profileViews = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          break;
        case 'page_website_clicks_logged_in_unique':
          websiteClicks = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
          break;
      }
    }
  }

  // Build daily data array
  let cumulativeFollowers = totalFollowers - newFollowers;
  const sortedDates = Object.keys(dailyMap).sort();
  for (const date of sortedDates) {
    cumulativeFollowers += dailyMap[date].newFollowers;
    dailyData.push({
      ...dailyMap[date],
      followers: cumulativeFollowers
    });
  }

  // Fetch posts reactions
  const postsResponse = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/posts?fields=reactions.summary(total_count),comments.summary(total_count),shares&limit=50&access_token=${accessToken}`
  );
  const postsData = await postsResponse.json();

  let likes = 0;
  let comments = 0;
  let shares = 0;

  if (postsData.data) {
    for (const post of postsData.data) {
      likes += post.reactions?.summary?.total_count || 0;
      comments += post.comments?.summary?.total_count || 0;
      shares += post.shares?.count || 0;
    }
  }

  const engagementRate = totalFollowers > 0 
    ? ((likes + comments + shares) / totalFollowers) * 100 
    : 0;

  const followerChange = totalFollowers > 0 
    ? (newFollowers / totalFollowers) * 100 
    : 0;

  const insights: OrganicInsights = {
    totalFollowers,
    newFollowers,
    followerChange,
    reach,
    impressions,
    engagementRate,
    likes,
    comments,
    shares,
    saves: 0,
    profileViews,
    websiteClicks
  };

  console.log('Returning Facebook insights:', insights);

  return new Response(
    JSON.stringify({
      success: true,
      simulated: false,
      insights,
      dailyData: dailyData.length > 0 ? dailyData : generateSimulatedDailyData(),
      pageId,
      platform: 'facebook'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function generateSimulatedInsights(): OrganicInsights {
  const baseFollowers = Math.floor(Math.random() * 5000) + 1000;
  const newFollowers = Math.floor(Math.random() * 50) + 5;
  
  return {
    totalFollowers: baseFollowers,
    newFollowers,
    followerChange: (newFollowers / baseFollowers) * 100,
    reach: Math.floor(Math.random() * 10000) + 2000,
    impressions: Math.floor(Math.random() * 20000) + 5000,
    engagementRate: Math.random() * 5 + 1,
    likes: Math.floor(Math.random() * 500) + 50,
    comments: Math.floor(Math.random() * 50) + 5,
    shares: Math.floor(Math.random() * 20) + 2,
    saves: Math.floor(Math.random() * 30) + 3,
    profileViews: Math.floor(Math.random() * 200) + 20,
    websiteClicks: Math.floor(Math.random() * 50) + 5
  };
}

function generateSimulatedDailyData(): DailyOrganicData[] {
  const daily: DailyOrganicData[] = [];
  const baseFollowers = Math.floor(Math.random() * 5000) + 1000;
  let cumulativeFollowers = baseFollowers;
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dailyNew = Math.floor(Math.random() * 10) + 1;
    cumulativeFollowers += dailyNew;
    
    daily.push({
      date: date.toISOString().split('T')[0],
      followers: cumulativeFollowers,
      newFollowers: dailyNew,
      reach: Math.floor(Math.random() * 1500) + 300,
      engagement: Math.random() * 5 + 1
    });
  }
  
  return daily;
}
