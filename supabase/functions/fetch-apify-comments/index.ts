import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

const ACTOR_ID = "apify~instagram-comment-scraper";

interface ApifyComment {
  id: string;
  text: string;
  ownerUsername: string;
  ownerId: string;
  timestamp: string;
  likesCount: number;
  repliesCount: number;
  replies?: ApifyComment[];
}

interface ApifyResult {
  inputUrl: string;
  postUrl: string;
  ownerUsername: string;
  comments: ApifyComment[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!APIFY_API_KEY) {
      throw new Error("APIFY_API_KEY não configurada. Adicione o secret nas configurações do projeto.");
    }

    const { postUrls, myUsername } = await req.json();
    
    if (!postUrls || !Array.isArray(postUrls) || postUrls.length === 0) {
      throw new Error("postUrls é obrigatório e deve ser um array de URLs de posts do Instagram");
    }

    console.log(`🔍 Buscando comentários de ${postUrls.length} posts via Apify...`);

    // Iniciar o Actor da Apify
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: postUrls,
          resultsLimit: 100, // Máximo de comentários por post
          includeReplies: true,
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

    // Aguardar conclusão (poll a cada 5s, timeout 2 min)
    let status = "RUNNING";
    let attempts = 0;
    const maxAttempts = 24; // 2 minutos

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
    const results: ApifyResult[] = await datasetResponse.json();

    console.log(`📦 Resultados recebidos: ${results.length} posts`);

    // Processar e salvar comentários
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const allComments: any[] = [];
    let savedCount = 0;
    let errorCount = 0;

    for (const result of results) {
      const postOwner = result.ownerUsername;
      const postUrl = result.postUrl || result.inputUrl;

      for (const comment of result.comments || []) {
        // Detectar se é nosso comentário (outbound sent) ou de outro usuário
        const isOwnComment = myUsername && 
          comment.ownerUsername?.toLowerCase() === myUsername.toLowerCase();

        const commentData = {
          comment_id: comment.id,
          comment_text: comment.text,
          author_username: comment.ownerUsername,
          author_id: comment.ownerId,
          created_at: comment.timestamp,
          post_id: null, // Apify não retorna o ID do post
          post_url: postUrl,
          comment_type: isOwnComment ? "sent" : "received",
          platform: "instagram",
          metadata: {
            source: "apify",
            post_owner: postOwner,
            likes_count: comment.likesCount,
            replies_count: comment.repliesCount,
            is_outbound: true, // Marcador para posts de terceiros
          },
        };

        allComments.push(commentData);

        // Salvar no banco
        const { error } = await supabase
          .from("instagram_comments")
          .upsert(commentData, {
            onConflict: "comment_id",
            ignoreDuplicates: false,
          });

        if (error) {
          console.error(`Erro ao salvar comentário ${comment.id}:`, error.message);
          errorCount++;
        } else {
          savedCount++;
        }

        // Processar respostas
        if (comment.replies) {
          for (const reply of comment.replies) {
            const isOwnReply = myUsername && 
              reply.ownerUsername?.toLowerCase() === myUsername.toLowerCase();

            const replyData = {
              comment_id: reply.id,
              comment_text: reply.text,
              author_username: reply.ownerUsername,
              author_id: reply.ownerId,
              created_at: reply.timestamp,
              post_id: null,
              post_url: postUrl,
              comment_type: isOwnReply ? "sent" : "received",
              parent_comment_id: comment.id,
              platform: "instagram",
              metadata: {
                source: "apify",
                post_owner: postOwner,
                likes_count: reply.likesCount,
                is_outbound: true,
              },
            };

            allComments.push(replyData);

            const { error: replyError } = await supabase
              .from("instagram_comments")
              .upsert(replyData, {
                onConflict: "comment_id",
                ignoreDuplicates: false,
              });

            if (replyError) {
              errorCount++;
            } else {
              savedCount++;
            }
          }
        }
      }
    }

    console.log(`✅ Processamento concluído: ${savedCount} salvos, ${errorCount} erros`);

    return new Response(
      JSON.stringify({
        success: true,
        comments: allComments,
        total: allComments.length,
        savedToDatabase: savedCount,
        saveErrors: errorCount,
        postsProcessed: results.length,
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
