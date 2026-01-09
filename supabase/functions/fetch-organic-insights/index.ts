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

    console.log('Fetching organic insights for page:', pageId);

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

    // Fetch page insights (last 28 days is max for some metrics)
    const insightsMetrics = [
      'page_fans_online',
      'page_fan_adds',
      'page_fan_removes',
      'page_impressions',
      'page_impressions_unique',
      'page_engaged_users',
      'page_post_engagements',
      'page_views_total',
      'page_website_clicks_logged_in_unique'
    ].join(',');

    const insightsResponse = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/insights?metric=${insightsMetrics}&period=day&date_preset=last_7d&access_token=${accessToken}`
    );
    const insightsData = await insightsResponse.json();
    console.log('Insights data received');

    if (insightsData.error) {
      console.error('Error fetching insights:', insightsData.error);
      // Continue with partial data
    }

    // Process insights data
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
            // Build daily data
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

    // Fetch posts reactions for likes, comments, shares
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

    // Calculate engagement rate
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
      saves: 0, // Facebook Graph API doesn't provide saves
      profileViews,
      websiteClicks
    };

    console.log('Returning organic insights:', insights);

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

  } catch (error) {
    console.error('Error fetching organic insights:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check if it's a permissions error
    const isPermissionError = errorMessage.includes('pages_read_engagement') || 
                              errorMessage.includes('permission') ||
                              errorMessage.includes('OAuthException');
    
    return new Response(
      JSON.stringify({
        success: false,
        simulated: true,
        insights: null,
        dailyData: [],
        error: errorMessage,
        isPermissionError,
        message: isPermissionError 
          ? 'Token sem permissões necessárias. Verifique se o token tem: pages_read_engagement, read_insights, pages_show_list'
          : 'Erro ao buscar dados reais.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function generateSimulatedInsights(): OrganicInsights {
  const baseFollowers = Math.floor(Math.random() * 50000) + 10000;
  const newFollowers = Math.floor(Math.random() * 500) + 50;
  
  return {
    totalFollowers: baseFollowers,
    newFollowers,
    followerChange: (newFollowers / baseFollowers) * 100,
    reach: Math.floor(Math.random() * 100000) + 20000,
    impressions: Math.floor(Math.random() * 200000) + 50000,
    engagementRate: Math.random() * 5 + 1,
    likes: Math.floor(Math.random() * 5000) + 500,
    comments: Math.floor(Math.random() * 500) + 50,
    shares: Math.floor(Math.random() * 200) + 20,
    saves: Math.floor(Math.random() * 300) + 30,
    profileViews: Math.floor(Math.random() * 2000) + 200,
    websiteClicks: Math.floor(Math.random() * 500) + 50
  };
}

function generateSimulatedDailyData(): DailyOrganicData[] {
  const daily: DailyOrganicData[] = [];
  const baseFollowers = Math.floor(Math.random() * 50000) + 10000;
  let cumulativeFollowers = baseFollowers;
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dailyNew = Math.floor(Math.random() * 100) + 10;
    cumulativeFollowers += dailyNew;
    
    daily.push({
      date: date.toISOString().split('T')[0],
      followers: cumulativeFollowers,
      newFollowers: dailyNew,
      reach: Math.floor(Math.random() * 15000) + 3000,
      engagement: Math.random() * 5 + 1
    });
  }
  
  return daily;
}
