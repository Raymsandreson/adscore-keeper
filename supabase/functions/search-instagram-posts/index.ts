import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchRequest {
  keywords: string[];
  maxPosts?: number;
  instagramCookies?: string;
  minComments?: number;
  commentKeywords?: string[];
}

interface ApifySearchResult {
  post_id: string;
  post_url: string;
  username: string;
  user_url: string;
  caption: string;
  posted_date: string | null;
  location: string | null;
  media_type: string;
  media_count: number;
  thumbnail_url: string;
  media_urls: string[];
  hashtags: string[];
  mentions: string[];
  likes_count: number;
  comments_count: number;
  views_count: number;
  is_ad: boolean;
  is_carousel: boolean;
  search_keyword: string;
  scraped_at: string;
  source: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY não configurada');
    }

    const body: SearchRequest = await req.json();
    const { keywords, maxPosts = 50, instagramCookies, minComments = 0, commentKeywords = [] } = body;

    if (!keywords || keywords.length === 0) {
      throw new Error('Palavras-chave são obrigatórias');
    }

    console.log(`🔍 Buscando posts com palavras-chave: ${keywords.join(', ')}`);

    // Prepare input for Apify actor
    const actorInput = {
      keywords: keywords,
      maxPosts: maxPosts,
      minDelayBetweenRequests: 2,
      maxDelayBetweenRequests: 5,
      humanizeBehavior: true,
      ...(instagramCookies && { cookies: instagramCookies }),
    };

    // Call Apify Actor - Instagram Keyword Search Scraper
    const actorId = 'crawlerbros~instagram-keyword-search-scraper';
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`;

    console.log('📡 Iniciando busca no Apify...');
    
    const runResponse = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput),
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error('Apify run error:', errorText);
      throw new Error(`Erro ao iniciar busca: ${runResponse.status}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;

    if (!runId) {
      throw new Error('Não foi possível iniciar a busca');
    }

    console.log(`⏳ Run iniciado: ${runId}`);

    // Wait for run to complete (max 5 minutes)
    const maxWaitTime = 300000; // 5 minutes
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();
    let runStatus = 'RUNNING';

    while (runStatus === 'RUNNING' || runStatus === 'READY') {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Timeout: busca demorou muito para completar');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`;
      const statusResponse = await fetch(statusUrl);
      const statusData = await statusResponse.json();
      runStatus = statusData.data?.status;

      console.log(`📊 Status: ${runStatus}`);

      if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
        throw new Error(`Busca falhou: ${runStatus}`);
      }
    }

    // Fetch results
    const datasetId = runData.data?.defaultDatasetId;
    if (!datasetId) {
      throw new Error('Dataset não encontrado');
    }

    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`;
    const datasetResponse = await fetch(datasetUrl);
    const results: ApifySearchResult[] = await datasetResponse.json();

    console.log(`✅ Encontrados ${results.length} posts`);

    // Filter results
    let filteredResults = results;

    // Filter by minimum comments
    if (minComments > 0) {
      filteredResults = filteredResults.filter(p => (p.comments_count || 0) >= minComments);
    }

    // Note: Filtering by comment keywords would require fetching comments for each post
    // This is a limitation - the keyword search doesn't return comment content

    // Transform results for frontend
    const transformedResults = filteredResults.map(post => ({
      postId: post.post_id,
      postUrl: post.post_url,
      username: post.username,
      userUrl: post.user_url,
      caption: post.caption,
      postedDate: post.posted_date,
      location: post.location,
      mediaType: post.media_type,
      thumbnailUrl: post.thumbnail_url,
      mediaUrls: post.media_urls,
      hashtags: post.hashtags,
      mentions: post.mentions,
      likesCount: post.likes_count || 0,
      commentsCount: post.comments_count || 0,
      viewsCount: post.views_count || 0,
      isAd: post.is_ad,
      searchKeyword: post.search_keyword,
      scrapedAt: post.scraped_at,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        posts: transformedResults,
        total: transformedResults.length,
        message: `Encontrados ${transformedResults.length} posts`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        posts: [],
        total: 0,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
