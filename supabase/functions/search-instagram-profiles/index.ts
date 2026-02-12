import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchRequest {
  keywords: string[];
  maxResults?: number;
  // Polling
  runId?: string;
  action?: 'start' | 'status' | 'results';
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
    const action = body.action || 'start';

    // ACTION: Check status
    if (action === 'status' && body.runId) {
      const statusUrl = `https://api.apify.com/v2/actor-runs/${body.runId}?token=${APIFY_API_KEY}`;
      const statusResponse = await fetch(statusUrl);
      const statusData = await statusResponse.json();
      const status = statusData.data?.status;

      return new Response(
        JSON.stringify({
          success: true,
          status,
          isComplete: status === 'SUCCEEDED',
          isFailed: status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ACTION: Get results
    if (action === 'results' && body.runId) {
      const statusUrl = `https://api.apify.com/v2/actor-runs/${body.runId}?token=${APIFY_API_KEY}`;
      const statusResponse = await fetch(statusUrl);
      const statusData = await statusResponse.json();
      const datasetId = statusData.data?.defaultDatasetId;
      const usageTotalUsd = statusData.data?.usageTotalUsd || 0;

      if (!datasetId) {
        throw new Error('Dataset não encontrado');
      }

      const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`;
      const datasetResponse = await fetch(datasetUrl);
      const results = await datasetResponse.json();

      console.log(`✅ Encontrados ${Array.isArray(results) ? results.length : 0} perfis`);

      // Transform results - instagram-search-scraper returns user search results
      const profiles = (Array.isArray(results) ? results : []).map((item: any) => ({
        username: item.username || item.user?.username || '',
        fullName: item.fullName || item.full_name || item.user?.full_name || '',
        biography: item.biography || item.bio || item.user?.biography || '',
        followersCount: item.followersCount ?? item.follower_count ?? item.user?.follower_count ?? 0,
        followingCount: item.followingCount ?? item.following_count ?? item.user?.following_count ?? 0,
        postsCount: item.postsCount ?? item.media_count ?? item.user?.media_count ?? 0,
        profilePicUrl: item.profilePicUrl || item.profile_pic_url || item.user?.profile_pic_url || '',
        isVerified: item.isVerified ?? item.is_verified ?? item.user?.is_verified ?? false,
        isPrivate: item.isPrivate ?? item.is_private ?? item.user?.is_private ?? false,
        externalUrl: item.externalUrl || item.external_url || item.user?.external_url || '',
        category: item.category || item.user?.category || '',
        searchTerm: item.searchTerm || item.search_term || '',
        profileUrl: `https://www.instagram.com/${item.username || item.user?.username || ''}/`,
      }));

      return new Response(
        JSON.stringify({
          success: true,
          profiles,
          total: profiles.length,
          costUsd: usageTotalUsd,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ACTION: Start new search
    const { keywords, maxResults = 50 } = body;

    if (!keywords || keywords.length === 0) {
      throw new Error('Palavras-chave são obrigatórias');
    }

    console.log(`🔍 Buscando perfis com palavras-chave: ${keywords.join(', ')}`);

    // Use apify/instagram-search-scraper with type "user"
    const actorId = 'apify~instagram-search-scraper';
    const actorInput = {
      search: keywords.join(', '),
      searchType: 'user',
      resultsLimit: maxResults,
    };

    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`;

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

    return new Response(
      JSON.stringify({
        success: true,
        runId,
        status: 'RUNNING',
        message: 'Busca de perfis iniciada.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Profile search error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        profiles: [],
        total: 0,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
