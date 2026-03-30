import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = RESOLVED_SUPABASE_URL;
const supabaseServiceKey = RESOLVED_SERVICE_ROLE_KEY;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

// Instagram Comment Scraper by Apify
// Documentação: https://apify.com/apify/instagram-comment-scraper
const ACTOR_ID = "apify~instagram-comment-scraper";

interface PostCommentsRequest {
  postUrls: string[];
  maxComments?: number;
  saveToDatabase?: boolean;
  myUsername?: string;
}

interface ApifyComment {
  id: string;
  text: string;
  ownerUsername: string;
  ownerId: string;
  timestamp: string;
  likesCount: number;
  repliesCount?: number;
  replies?: ApifyComment[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!APIFY_API_KEY) {
      throw new Error("APIFY_API_KEY não configurada. Adicione o secret nas configurações do projeto.");
    }

    const body: PostCommentsRequest = await req.json();
    const { postUrls, maxComments = 500, saveToDatabase = true, myUsername } = body;
    
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

    console.log(`🔍 Buscando comentários de ${normalizedUrls.length} posts via Instagram Comment Scraper...`);
    console.log(`📝 URLs:`, normalizedUrls);
    console.log(`💬 Max comentários por post: ${maxComments}`);

    // Apify Instagram Comment Scraper
    // Usa directUrls, resultsLimit, includeNestedComments e isNewestComments
    const inputPayload = {
      directUrls: normalizedUrls,
      resultsLimit: maxComments > 0 ? maxComments : 1000, // Default 1000 como no console
      includeNestedComments: true, // CRUCIAL: Extrai respostas aos comentários
      isNewestComments: true, // Começa pelos mais recentes
    };
    
    console.log(`📤 Payload enviado para Apify:`, JSON.stringify(inputPayload));
    
    // Limite de custo: $2 USD por requisição (via query param)
    const maxCostUsd = 2;
    
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_API_KEY}&maxTotalChargeUsd=${maxCostUsd}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputPayload),
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

    // Aguardar conclusão (poll a cada 5s, timeout 10 min para suportar muitos comentários)
    let status = "RUNNING";
    let attempts = 0;
    const maxAttempts = 120; // 10 minutos
    let usageTotalUsd = 0;

    while (status === "RUNNING" && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
      );
      const statusData = await statusResponse.json();
      status = statusData.data.status;
      usageTotalUsd = statusData.data?.usageTotalUsd || 0;
      attempts++;
      
      console.log(`📊 Status: ${status} (tentativa ${attempts}/${maxAttempts}) - Custo: $${usageTotalUsd}`);
    }

    if (status !== "SUCCEEDED") {
      throw new Error(`Scraper não concluiu: status = ${status}`);
    }

    // Buscar custo final da execução
    const finalStatusResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
    );
    const finalStatusData = await finalStatusResponse.json();
    usageTotalUsd = finalStatusData.data?.usageTotalUsd || 0;
    
    console.log(`💰 Custo total da execução: $${usageTotalUsd} USD`);

    // Buscar resultados
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_API_KEY}`
    );
    const results = await datasetResponse.json();

    console.log(`📦 Resultados recebidos: ${Array.isArray(results) ? results.length : 0} comentários`);

    // Processar resultados
    const allComments: any[] = [];
    let savedCount = 0;
    let errorCount = 0;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // O actor retorna cada comentário como um item separado
    const commentsArray: ApifyComment[] = Array.isArray(results) ? results : [];

    for (const comment of commentsArray) {
      if (!comment.id || !comment.text) {
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
        post_id: null,
        post_url: normalizedUrls[0], // Usar primeira URL como referência
        comment_type: isOwnComment ? "sent" : "received",
        platform: "instagram",
        metadata: {
          source: "apify_comment_scraper",
          likes_count: comment.likesCount || 0,
          replies_count: comment.repliesCount || 0,
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

      // Processar respostas aninhadas se existirem
      if (comment.replies && Array.isArray(comment.replies)) {
        for (const reply of comment.replies) {
          if (!reply.id || !reply.text) continue;

          const isOwnReply = myUsername && 
            reply.ownerUsername?.toLowerCase() === myUsername.toLowerCase();

          const replyData = {
            comment_id: reply.id,
            comment_text: reply.text,
            author_username: reply.ownerUsername || 'unknown',
            author_id: reply.ownerId,
            created_at: reply.timestamp || new Date().toISOString(),
            post_id: null,
            post_url: normalizedUrls[0],
            comment_type: isOwnReply ? "sent" : "received",
            parent_comment_id: comment.id,
            platform: "instagram",
            metadata: {
              source: "apify_comment_scraper",
              likes_count: reply.likesCount || 0,
            },
          };

          allComments.push(replyData);

          if (saveToDatabase) {
            const { data: existingReply } = await supabase
              .from("instagram_comments")
              .select("id")
              .eq("comment_id", reply.id)
              .maybeSingle();

            if (!existingReply) {
              const { error: replyError } = await supabase
                .from("instagram_comments")
                .insert(replyData);

              if (replyError) {
                errorCount++;
              } else {
                savedCount++;
              }
            }
          }
        }
      }
    }

    console.log(`✅ Processamento concluído: ${allComments.length} comentários encontrados, ${savedCount} salvos, ${errorCount} erros, custo: $${usageTotalUsd}`);

    return new Response(
      JSON.stringify({
        success: true,
        comments: allComments,
        total: allComments.length,
        savedToDatabase: savedCount,
        saveErrors: errorCount,
        postsProcessed: normalizedUrls.length,
        costUsd: usageTotalUsd,
        runId: runId,
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
