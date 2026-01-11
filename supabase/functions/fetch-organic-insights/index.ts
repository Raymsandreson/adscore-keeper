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

interface PlatformData {
  platform: 'facebook' | 'instagram';
  accountId: string;
  accountName?: string;
  insights: OrganicInsights;
  dailyData: DailyOrganicData[];
}

serve(async (req) => {
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
          platforms: [
            {
              platform: 'instagram',
              accountId: 'demo',
              accountName: '@demo_account',
              insights: generateSimulatedInsights(),
              dailyData: generateSimulatedDailyData()
            },
            {
              platform: 'facebook',
              accountId: 'demo',
              accountName: 'Demo Page',
              insights: generateSimulatedInsights(),
              dailyData: generateSimulatedDailyData()
            }
          ],
          message: 'Dados simulados - Configure FACEBOOK_PAGE_ID e FACEBOOK_CAPI_ACCESS_TOKEN'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching insights for page:', pageId);

    const platforms: PlatformData[] = [];

    // Fetch Instagram Business Account connected to this page
    const igAccountResponse = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account,name&access_token=${accessToken}`
    );
    const igAccountData = await igAccountResponse.json();
    console.log('Page data:', igAccountData);

    const pageName = igAccountData.name || 'Facebook Page';

    // Fetch Instagram data if available
    if (igAccountData.instagram_business_account?.id) {
      const igData = await fetchInstagramData(igAccountData.instagram_business_account.id, accessToken);
      if (igData) {
        platforms.push(igData);
      }
    }

    // Fetch Facebook Page data
    const fbData = await fetchFacebookData(pageId, accessToken, pageName);
    if (fbData) {
      platforms.push(fbData);
    }

    console.log('Returning data for', platforms.length, 'platforms');

    return new Response(
      JSON.stringify({
        success: true,
        simulated: false,
        platforms
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching organic insights:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const isPermissionError = errorMessage.includes('pages_read_engagement') || 
                              errorMessage.includes('permission') ||
                              errorMessage.includes('OAuthException') ||
                              errorMessage.includes('instagram_basic');
    
    return new Response(
      JSON.stringify({
        success: false,
        simulated: true,
        platforms: [],
        error: errorMessage,
        isPermissionError,
        message: isPermissionError 
          ? 'Token sem permissões necessárias.'
          : 'Erro ao buscar dados reais.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function fetchInstagramData(igAccountId: string, accessToken: string): Promise<PlatformData | null> {
  try {
    console.log('Fetching Instagram data for:', igAccountId);

    const accountResponse = await fetch(
      `https://graph.facebook.com/v18.0/${igAccountId}?fields=followers_count,follows_count,media_count,username,name&access_token=${accessToken}`
    );
    const accountData = await accountResponse.json();

    if (accountData.error) {
      console.error('Instagram account error:', accountData.error);
      return null;
    }

    const totalFollowers = accountData.followers_count || 0;
    const username = accountData.username || 'instagram';

    let reach = 0, impressions = 0, profileViews = 0, websiteClicks = 0, newFollowers = 0;
    const dailyData: DailyOrganicData[] = [];

    // Fetch insights
    try {
      const insightsResponse = await fetch(
        `https://graph.facebook.com/v18.0/${igAccountId}/insights?metric=reach,impressions,profile_views,website_clicks,follower_count&period=day&metric_type=total_value&access_token=${accessToken}`
      );
      const insightsData = await insightsResponse.json();

      if (insightsData.data) {
        for (const metric of insightsData.data) {
          const totalValue = metric.total_value?.value || 0;
          switch (metric.name) {
            case 'reach': reach = totalValue; break;
            case 'impressions': impressions = totalValue; break;
            case 'profile_views': profileViews = totalValue; break;
            case 'website_clicks': websiteClicks = totalValue; break;
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch Instagram insights:', e);
    }

    // Fetch daily data
    try {
      const dailyResponse = await fetch(
        `https://graph.facebook.com/v18.0/${igAccountId}/insights?metric=reach,follower_count&period=day&access_token=${accessToken}`
      );
      const dailyInsights = await dailyResponse.json();
      
      if (dailyInsights.data) {
        const reachMetric = dailyInsights.data.find((m: any) => m.name === 'reach');
        const followerMetric = dailyInsights.data.find((m: any) => m.name === 'follower_count');
        
        if (reachMetric?.values) {
          let prevFollowerCount = totalFollowers;
          reachMetric.values.forEach((v: any, index: number) => {
            const dateStr = v.end_time?.split('T')[0];
            const dailyReach = v.value || 0;
            const dailyFollowers = followerMetric?.values?.[index]?.value || prevFollowerCount;
            const dailyNew = index === 0 ? 0 : Math.max(0, dailyFollowers - prevFollowerCount);
            
            if (dateStr) {
              dailyData.push({
                date: dateStr,
                followers: dailyFollowers,
                newFollowers: dailyNew,
                reach: dailyReach,
                engagement: dailyReach > 0 ? (dailyReach / totalFollowers) * 100 : 0
              });
              newFollowers += dailyNew;
            }
            prevFollowerCount = dailyFollowers;
          });
        }
      }
    } catch (e) {
      console.warn('Could not fetch daily Instagram data:', e);
    }

    // Fetch media engagement
    let likes = 0, comments = 0, shares = 0, saves = 0;
    try {
      const mediaResponse = await fetch(
        `https://graph.facebook.com/v18.0/${igAccountId}/media?fields=like_count,comments_count,insights.metric(saved,shares)&limit=25&access_token=${accessToken}`
      );
      const mediaData = await mediaResponse.json();

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
    } catch (e) {
      console.warn('Could not fetch media insights:', e);
    }

    const engagementRate = totalFollowers > 0 ? ((likes + comments + saves + shares) / totalFollowers) * 100 : 0;
    const followerChange = totalFollowers > 0 ? (newFollowers / totalFollowers) * 100 : 0;

    return {
      platform: 'instagram',
      accountId: igAccountId,
      accountName: `@${username}`,
      insights: {
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
      },
      dailyData: dailyData.length > 0 ? dailyData : generateSimulatedDailyData()
    };
  } catch (error) {
    console.error('Error fetching Instagram data:', error);
    return null;
  }
}

async function fetchFacebookData(pageId: string, accessToken: string, pageName: string): Promise<PlatformData | null> {
  try {
    console.log('Fetching Facebook data for:', pageId);

    const fansResponse = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=followers_count,fan_count&access_token=${accessToken}`
    );
    const fansData = await fansResponse.json();

    if (fansData.error) {
      console.error('Facebook page error:', fansData.error);
      return null;
    }

    const totalFollowers = fansData.followers_count || fansData.fan_count || 0;

    let newFollowers = 0, reach = 0, impressions = 0, engagement = 0, profileViews = 0, websiteClicks = 0;
    const dailyMap: Record<string, DailyOrganicData> = {};

    // Fetch insights
    try {
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
    } catch (e) {
      console.warn('Could not fetch Facebook insights:', e);
    }

    // Build daily data
    const dailyData: DailyOrganicData[] = [];
    let cumulativeFollowers = totalFollowers - newFollowers;
    const sortedDates = Object.keys(dailyMap).sort();
    for (const date of sortedDates) {
      cumulativeFollowers += dailyMap[date].newFollowers;
      dailyData.push({
        ...dailyMap[date],
        followers: cumulativeFollowers
      });
    }

    // Fetch posts engagement
    let likes = 0, comments = 0, shares = 0;
    try {
      const postsResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/posts?fields=reactions.summary(total_count),comments.summary(total_count),shares&limit=50&access_token=${accessToken}`
      );
      const postsData = await postsResponse.json();

      if (postsData.data) {
        for (const post of postsData.data) {
          likes += post.reactions?.summary?.total_count || 0;
          comments += post.comments?.summary?.total_count || 0;
          shares += post.shares?.count || 0;
        }
      }
    } catch (e) {
      console.warn('Could not fetch posts:', e);
    }

    const engagementRate = totalFollowers > 0 ? ((likes + comments + shares) / totalFollowers) * 100 : 0;
    const followerChange = totalFollowers > 0 ? (newFollowers / totalFollowers) * 100 : 0;

    return {
      platform: 'facebook',
      accountId: pageId,
      accountName: pageName,
      insights: {
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
      },
      dailyData: dailyData.length > 0 ? dailyData : generateSimulatedDailyData()
    };
  } catch (error) {
    console.error('Error fetching Facebook data:', error);
    return null;
  }
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
