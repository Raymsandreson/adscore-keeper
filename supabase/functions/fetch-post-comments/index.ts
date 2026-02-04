import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FetchCommentsRequest {
  postUrl: string;
  maxComments?: number;
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

    const body: FetchCommentsRequest = await req.json();
    const { postUrl, maxComments = 100 } = body;

    if (!postUrl) {
      throw new Error('URL do post é obrigatória');
    }

    console.log(`🔍 Buscando comentários do post: ${postUrl}`);

    // Use existing Instagram Comment Scraper actor
    const actorId = 'apify~instagram-comment-scraper';
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`;

    const actorInput = {
      directUrls: [postUrl],
      resultsLimit: maxComments,
      commentsPerPost: maxComments,
    };

    const runResponse = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput),
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error('Apify run error:', errorText);
      throw new Error(`Erro ao buscar comentários: ${runResponse.status}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;

    if (!runId) {
      throw new Error('Não foi possível iniciar busca de comentários');
    }

    console.log(`⏳ Run iniciado: ${runId}`);

    // Wait for run to complete (max 3 minutes)
    const maxWaitTime = 180000;
    const pollInterval = 3000;
    const startTime = Date.now();
    let runStatus = 'RUNNING';

    while (runStatus === 'RUNNING' || runStatus === 'READY') {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Timeout: busca de comentários demorou muito');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`;
      const statusResponse = await fetch(statusUrl);
      const statusData = await statusResponse.json();
      runStatus = statusData.data?.status;

      if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
        throw new Error(`Busca de comentários falhou: ${runStatus}`);
      }
    }

    // Fetch results
    const datasetId = runData.data?.defaultDatasetId;
    if (!datasetId) {
      throw new Error('Dataset não encontrado');
    }

    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`;
    const datasetResponse = await fetch(datasetUrl);
    const results = await datasetResponse.json();

    console.log(`✅ Encontrados ${results.length} comentários`);

    return new Response(
      JSON.stringify({
        success: true,
        comments: results,
        total: results.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Fetch comments error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        comments: [],
        total: 0,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
