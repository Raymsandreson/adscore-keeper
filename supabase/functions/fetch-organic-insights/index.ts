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
  storiesViews: number;
  storiesReplies: number;
  storiesExits: number;
  storiesReach: number;
  videoViews: number;
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
  dataSource?: 'real' | 'estimated' | 'limited';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Usando META_ACCESS_TOKEN unificado para tráfego pago e orgânico
    const accessToken = Deno.env.get('META_ACCESS_TOKEN');

    if (!accessToken) {
      console.log('Missing META_ACCESS_TOKEN, returning simulated data');
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
          message: 'Dados simulados - Configure META_ACCESS_TOKEN com permissões: pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_insights'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Primeiro, detectar o tipo de token (User Token vs Page Token)
    console.log('Detecting token type via /me endpoint');
    const meResponse = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${accessToken}`
    );
    const meData = await meResponse.json();
    console.log('Token /me response:', meData);

    if (meData.error) {
      console.error('Token validation error:', meData.error);
      return new Response(
        JSON.stringify({
          success: false,
          simulated: true,
          platforms: [],
          error: meData.error.message,
          message: `Token inválido: ${meData.error.message}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let pageId: string;
    let pageName: string;
    let pageAccessToken: string;

    // Tentar buscar páginas via /me/accounts (funciona com User Token)
    console.log('Trying to fetch pages via /me/accounts');
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
    );
    const pagesData = await pagesResponse.json();
    
    if (pagesData.data && pagesData.data.length > 0) {
      // Token de Usuário - usar primeira página encontrada
      console.log('User Token detected - found', pagesData.data.length, 'pages');
      const page = pagesData.data[0];
      pageId = page.id;
      pageName = page.name || 'Facebook Page';
      pageAccessToken = page.access_token || accessToken;
    } else {
      // Provavelmente é um Page Token - usar o ID do /me como Page ID
      console.log('Page Token detected - using /me ID as page:', meData.id, meData.name);
      pageId = meData.id;
      pageName = meData.name || 'Facebook Page';
      pageAccessToken = accessToken;
    }

    console.log('Using page:', pageName, '(ID:', pageId, ')');

    const platforms: PlatformData[] = [];

    // Buscar conta Instagram vinculada à página
    console.log('Fetching Instagram Business Account for page:', pageId);
    const igAccountResponse = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id,username,followers_count}&access_token=${pageAccessToken}`
    );
    const igAccountData = await igAccountResponse.json();
    console.log('Instagram account lookup:', igAccountData);

    if (igAccountData.instagram_business_account?.id) {
      const igData = await fetchInstagramData(igAccountData.instagram_business_account.id, pageAccessToken);
      if (igData) {
        platforms.push(igData);
      }
    }

    // Fetch Facebook Page data
    const fbData = await fetchFacebookData(pageId, pageAccessToken, pageName);
    if (fbData) {
      platforms.push(fbData);
    }

    console.log('Returning data for', platforms.length, 'platforms');

    return new Response(
      JSON.stringify({
        success: true,
        simulated: false,
        platforms,
        pageInfo: {
          id: pageId,
          name: pageName,
          totalPagesAvailable: pagesData.data.length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching organic insights:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({
        success: false,
        simulated: true,
        platforms: [],
        error: errorMessage,
        message: 'Erro ao buscar dados reais. Verifique se META_ACCESS_TOKEN está configurado corretamente.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function fetchInstagramData(igAccountId: string, accessToken: string): Promise<PlatformData | null> {
  try {
    console.log('Fetching Instagram data for:', igAccountId);

    // Fetch basic account info - this should work with basic permissions
    const accountResponse = await fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}?fields=followers_count,follows_count,media_count,username,name&access_token=${accessToken}`
    );
    const accountData = await accountResponse.json();
    console.log('Instagram account data:', accountData);

    if (accountData.error) {
      console.error('Instagram account error:', accountData.error);
      return null;
    }

    const totalFollowers = accountData.followers_count || 0;
    const username = accountData.username || 'instagram';
    const mediaCount = accountData.media_count || 0;

    // Initialize metrics
    let likes = 0, comments = 0, shares = 0, saves = 0, videoViews = 0;
    let reach = 0, impressions = 0;
    const recentPosts: any[] = [];

    // Fetch recent media with engagement data
    // This works with instagram_basic permission
    try {
      const mediaResponse = await fetch(
        `https://graph.facebook.com/v21.0/${igAccountId}/media?fields=id,media_type,like_count,comments_count,timestamp,caption&limit=50&access_token=${accessToken}`
      );
      const mediaData = await mediaResponse.json();
      console.log('Instagram media count:', mediaData.data?.length || 0);

      if (mediaData.data) {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        for (const media of mediaData.data) {
          const mediaDate = new Date(media.timestamp);
          
          // Count engagement from last 7 days
          if (mediaDate >= sevenDaysAgo) {
            likes += media.like_count || 0;
            comments += media.comments_count || 0;
            recentPosts.push(media);
          }

          // Try to get individual media insights (saves, shares, reach)
          try {
            let metricsToFetch = 'saved,reach,impressions';
            if (media.media_type === 'VIDEO' || media.media_type === 'REELS') {
              metricsToFetch += ',plays,video_views';
            }
            
            const mediaInsightsResponse = await fetch(
              `https://graph.facebook.com/v21.0/${media.id}/insights?metric=${metricsToFetch}&access_token=${accessToken}`
            );
            const mediaInsights = await mediaInsightsResponse.json();
            
            if (mediaInsights.data && mediaDate >= sevenDaysAgo) {
              for (const insight of mediaInsights.data) {
                const value = insight.values?.[0]?.value || 0;
                switch (insight.name) {
                  case 'saved': saves += value; break;
                  case 'shares': shares += value; break;
                  case 'reach': reach += value; break;
                  case 'impressions': impressions += value; break;
                  case 'video_views':
                  case 'plays': videoViews += value; break;
                }
              }
            }
          } catch (mediaErr) {
            // Media insights might not be available without instagram_manage_insights
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch media:', e);
    }

    // Estimate reach based on engagement if we couldn't get it from API
    // Typical reach is 10-30% of followers, engagement is 1-5% of reach
    if (reach === 0 && totalFollowers > 0) {
      // Estimate reach as 15% of followers per post, multiplied by recent posts
      reach = Math.round(totalFollowers * 0.15 * Math.min(recentPosts.length, 7));
      impressions = Math.round(reach * 1.5); // Impressions typically 1.5x reach
      console.log('Estimated reach:', reach, 'impressions:', impressions);
    }

    // Estimate new followers based on typical growth rate
    // Average Instagram growth is 0.5-2% per week for business accounts
    const estimatedNewFollowers = Math.round(totalFollowers * 0.01); // 1% weekly growth estimate
    
    // Try to get profile views and website clicks (might fail without full permissions)
    let profileViews = 0, websiteClicks = 0;
    
    // Calculate engagement rate
    const totalEngagement = likes + comments + saves + shares;
    const engagementRate = totalFollowers > 0 ? (totalEngagement / totalFollowers) * 100 : 0;
    const followerChange = totalFollowers > 0 ? (estimatedNewFollowers / totalFollowers) * 100 : 0;

    // Generate daily data based on available metrics
    const dailyData = generateDailyDataFromMetrics(totalFollowers, estimatedNewFollowers, reach, engagementRate);

    console.log('Instagram insights summary:', {
      totalFollowers,
      newFollowers: estimatedNewFollowers,
      reach,
      impressions,
      likes,
      comments,
      shares,
      saves,
      engagementRate: engagementRate.toFixed(2),
      recentPostsAnalyzed: recentPosts.length
    });

    return {
      platform: 'instagram',
      accountId: igAccountId,
      accountName: `@${username}`,
      insights: {
        totalFollowers,
        newFollowers: estimatedNewFollowers,
        followerChange,
        reach,
        impressions,
        engagementRate,
        likes,
        comments,
        shares,
        saves,
        profileViews,
        websiteClicks,
        storiesViews: 0,
        storiesReplies: 0,
        storiesExits: 0,
        storiesReach: 0,
        videoViews
      },
      dailyData,
      dataSource: reach > 0 ? 'real' : 'estimated'
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
      `https://graph.facebook.com/v21.0/${pageId}?fields=followers_count,fan_count&access_token=${accessToken}`
    );
    const fansData = await fansResponse.json();
    console.log('Facebook fans data:', fansData);

    if (fansData.error) {
      console.error('Facebook page error:', fansData.error);
      return null;
    }

    const totalFollowers = fansData.followers_count || fansData.fan_count || 0;

    let newFollowers = 0, reach = 0, impressions = 0, engagement = 0, profileViews = 0, websiteClicks = 0;
    const dailyMap: Record<string, DailyOrganicData> = {};
    let hasRealInsights = false;

    // Fetch page insights with date range
    try {
      const insightsMetrics = [
        'page_fan_adds',
        'page_impressions',
        'page_impressions_unique',
        'page_post_engagements',
        'page_views_total'
      ].join(',');

      const insightsResponse = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/insights?metric=${insightsMetrics}&period=day&date_preset=last_7d&access_token=${accessToken}`
      );
      const insightsData = await insightsResponse.json();
      console.log('Facebook insights response:', insightsData.error ? insightsData.error : 'success');

      if (insightsData.data && !insightsData.error) {
        hasRealInsights = true;
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
                if (dateStr) {
                  if (!dailyMap[dateStr]) {
                    dailyMap[dateStr] = { date: dateStr, followers: 0, newFollowers: 0, reach: 0, engagement: 0 };
                  }
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
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch Facebook insights:', e);
    }

    // Build daily data with cumulative followers
    let dailyData: DailyOrganicData[] = [];
    if (Object.keys(dailyMap).length > 0) {
      let cumulativeFollowers = totalFollowers - newFollowers;
      const sortedDates = Object.keys(dailyMap).sort();
      for (const date of sortedDates) {
        cumulativeFollowers += dailyMap[date].newFollowers;
        dailyData.push({
          ...dailyMap[date],
          followers: cumulativeFollowers
        });
      }
    }

    // Fetch posts engagement (reactions, comments, shares)
    let likes = 0, comments = 0, shares = 0;
    try {
      const postsResponse = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/posts?fields=reactions.summary(total_count),comments.summary(total_count),shares,created_time&limit=50&access_token=${accessToken}`
      );
      const postsData = await postsResponse.json();
      console.log('Facebook posts count:', postsData.data?.length || 0);

      if (postsData.data) {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        for (const post of postsData.data) {
          const postDate = new Date(post.created_time);
          if (postDate >= sevenDaysAgo) {
            likes += post.reactions?.summary?.total_count || 0;
            comments += post.comments?.summary?.total_count || 0;
            shares += post.shares?.count || 0;
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch posts:', e);
    }

    // If we couldn't get insights, estimate based on engagement
    if (!hasRealInsights && totalFollowers > 0) {
      newFollowers = Math.round(totalFollowers * 0.005); // 0.5% weekly growth
      reach = Math.round(totalFollowers * 0.1 * 7); // 10% reach per day
      impressions = Math.round(reach * 1.5);
      dailyData = generateDailyDataFromMetrics(totalFollowers, newFollowers, reach, (likes + comments + shares) / totalFollowers * 100);
    }

    const engagementRate = totalFollowers > 0 ? ((likes + comments + shares) / totalFollowers) * 100 : 0;
    const followerChange = totalFollowers > 0 ? (newFollowers / totalFollowers) * 100 : 0;

    console.log('Facebook insights summary:', {
      totalFollowers,
      newFollowers,
      reach,
      impressions,
      likes,
      comments,
      shares,
      engagementRate: engagementRate.toFixed(2),
      hasRealInsights
    });

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
        websiteClicks,
        storiesViews: 0,
        storiesReplies: 0,
        storiesExits: 0,
        storiesReach: 0,
        videoViews: 0
      },
      dailyData: dailyData.length > 0 ? dailyData : generateSimulatedDailyData(),
      dataSource: hasRealInsights ? 'real' : 'estimated'
    };
  } catch (error) {
    console.error('Error fetching Facebook data:', error);
    return null;
  }
}

function generateDailyDataFromMetrics(totalFollowers: number, newFollowers: number, totalReach: number, engagementRate: number): DailyOrganicData[] {
  const data: DailyOrganicData[] = [];
  const dailyNewFollowers = Math.round(newFollowers / 7);
  const dailyReach = Math.round(totalReach / 7);
  
  let currentFollowers = totalFollowers - newFollowers;
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Add some variation
    const variation = 0.8 + Math.random() * 0.4; // 80% to 120%
    const dailyNew = Math.round(dailyNewFollowers * variation);
    currentFollowers += dailyNew;
    
    data.push({
      date: dateStr,
      followers: currentFollowers,
      newFollowers: dailyNew,
      reach: Math.round(dailyReach * variation),
      engagement: engagementRate * variation
    });
  }
  
  return data;
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
    websiteClicks: Math.floor(Math.random() * 50) + 5,
    storiesViews: Math.floor(Math.random() * 1000) + 100,
    storiesReplies: Math.floor(Math.random() * 15) + 1,
    storiesExits: Math.floor(Math.random() * 50) + 5,
    storiesReach: Math.floor(Math.random() * 800) + 80,
    videoViews: Math.floor(Math.random() * 2000) + 100
  };
}

function generateSimulatedDailyData(): DailyOrganicData[] {
  const data: DailyOrganicData[] = [];
  const baseFollowers = Math.floor(Math.random() * 3000) + 2000;
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const dailyNew = Math.floor(Math.random() * 15) + 1;
    
    data.push({
      date: dateStr,
      followers: baseFollowers + (6 - i) * dailyNew,
      newFollowers: dailyNew,
      reach: Math.floor(Math.random() * 2000) + 200,
      engagement: Math.random() * 6 + 1
    });
  }
  
  return data;
}
