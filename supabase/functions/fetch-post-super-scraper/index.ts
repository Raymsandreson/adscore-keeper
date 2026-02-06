import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

// Instagram Post Super Scraper by Muhammad Noman Riaz
const ACTOR_ID = "muhammad_noman_riaz/instagram-post-super-scraper";

interface PostSuperScraperRequest {
  postUrls: string[];
  maxComments?: number;
  saveToDatabase?: boolean;
  myUsername?: string;
}

interface ApifyPostResult {
  id: string;
  postUrl: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  likesCount: number;
  commentsCount: number;
  ownerUsername: string;
  ownerId: string;
  timestamp: string;
  mediaUrls: string[];
  comments?: ApifyComment[];
}

interface ApifyComment {
  id: string;
  text: string;
  ownerUsername: string;
  ownerId: string;
  timestamp: string;
  likesCount: number;
  repliesCount?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!APIFY_API_KEY) {
      throw new Error("APIFY_API_KEY não configurada. Adicione o secret nas configurações do projeto.");
    }

    const body: PostSuperScraperRequest = await req.json();
    const { postUrls, maxComments = 100, saveToDatabase = true, myUsername } = body;
    
    if (!postUrls || !Array.isArray(postUrls) || postUrls.length === 0) {
      throw new Error("postUrls é obrigatório e deve ser um array de URLs de posts do Instagram");
    }

    // Normalizar URLs
    const normalizedUrls = postUrls.map((url: string) => {
      let normalized = url.trim();
      // Converter /reels/ para /reel/ se necessário
      normalized = normalized.replace(/\/reels\//gi, '/reel/');
      // Remover trailing slash
      normalized = normalized.replace(/\/$/, '');
      return normalized;
    });

    console.log(`🔍 Buscando dados de ${normalizedUrls.length} posts via Instagram Post Super Scraper...`);
    console.log(`📝 URLs:`, normalizedUrls);
    console.log(`💬 Max comentários por post: ${maxComments}`);

    // Iniciar o Actor da Apify
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizedUrls, // Este actor aceita URLs de posts no campo username
          resultsLimit: normalizedUrls.length, // Apenas os posts especificados
          maxComments: Math.min(maxComments, 100), // Limite do actor é 100
          skipPinnedPosts: false,
        }),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error("Erro ao iniciar Actor:", errorText);
      throw new Error(`Falha ao iniciar scraper: ${runResponse.status}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data.id;
    
    console.log(`⏳ Actor iniciado. Run ID: ${runId}`);

    // Aguardar conclusão (poll a cada 5s, timeout 5 min)
    let status = "RUNNING";
    let attempts = 0;
    const maxAttempts = 60;

    while (status === "RUNNING" && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
      );
      const statusData = await statusResponse.json();
      status = statusData.data.status;
      attempts++;
      
      console.log(`📊 Status: ${status} (tentativa ${attempts}/${maxAttempts})`);
    }

    if (status !== "SUCCEEDED") {
      throw new Error(`Scraper não concluiu: status = ${status}`);
    }

    // Buscar resultados
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_API_KEY}`
    );
    const results = await datasetResponse.json();

    console.log(`📦 Resultados recebidos: ${Array.isArray(results) ? results.length : 0} posts`);

    // Processar resultados
    const allComments: any[] = [];
    let savedCount = 0;
    let errorCount = 0;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    for (const post of results) {
      console.log(`📝 Processando post: ${post.inputUrl || post.postUrl || post.url}`);
      
      const postUrl = post.inputUrl || post.postUrl || post.url || '';
      const comments = post.comments || [];
      
      console.log(`💬 Post tem ${comments.length} comentários`);

      for (const comment of comments) {
        if (!comment.id || !comment.text) {
          console.log(`⚠️ Comentário inválido:`, comment);
          continue;
        }

        const isOwnComment = myUsername && 
          comment.ownerUsername?.toLowerCase() === myUsername.toLowerCase();

        const commentData = {
          comment_id: comment.id,
          comment_text: comment.text,
          author_username: comment.ownerUsername || 'unknown',
          author_id: comment.ownerId,
          created_at: comment.timestamp || new Date().toISOString(),
          post_id: post.id,
          post_url: postUrl,
          comment_type: isOwnComment ? "sent" : "received",
          platform: "instagram",
          metadata: {
            source: "apify_post_super_scraper",
            likes_count: comment.likesCount || 0,
            post_owner: post.ownerUsername,
            post_caption: post.caption?.substring(0, 200),
          },
        };

        allComments.push(commentData);

        // Salvar no banco se solicitado
        if (saveToDatabase) {
          const { data: existing } = await supabase
            .from("instagram_comments")
            .select("id")
            .eq("comment_id", comment.id)
            .maybeSingle();

          if (!existing) {
            const { error } = await supabase
              .from("instagram_comments")
              .insert(commentData);

            if (error) {
              console.error(`Erro ao salvar comentário ${comment.id}:`, error.message);
              errorCount++;
            } else {
              savedCount++;
            }
          }
        }
      }
    }

    console.log(`✅ Processamento concluído: ${allComments.length} comentários encontrados, ${savedCount} salvos, ${errorCount} erros`);

    return new Response(
      JSON.stringify({
        success: true,
        comments: allComments,
        total: allComments.length,
        savedToDatabase: savedCount,
        saveErrors: errorCount,
        postsProcessed: results.length,
        posts: results.map((p: any) => ({
          id: p.id,
          url: p.inputUrl || p.postUrl || p.url,
          caption: p.caption,
          ownerUsername: p.ownerUsername,
          likesCount: p.likesCount,
          commentsCount: p.commentsCount,
          timestamp: p.timestamp,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        comments: [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
