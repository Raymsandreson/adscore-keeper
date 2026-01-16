import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accessToken, pageId, instagramAccountId } = await req.json();
    
    const token = accessToken || Deno.env.get("META_ACCESS_TOKEN");
    
    if (!token) {
      throw new Error("Access token não configurado");
    }

    console.log("🔍 Buscando comentários do Instagram...");

    // First, get the Instagram Business Account ID if not provided
    let igAccountId = instagramAccountId;
    
    if (!igAccountId && pageId) {
      const pageResponse = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${token}`
      );
      const pageData = await pageResponse.json();
      igAccountId = pageData.instagram_business_account?.id;
    }

    if (!igAccountId) {
      // Try to get from pages
      const pagesResponse = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account,name&access_token=${token}`
      );
      const pagesData = await pagesResponse.json();
      
      if (pagesData.data && pagesData.data.length > 0) {
        for (const page of pagesData.data) {
          if (page.instagram_business_account?.id) {
            igAccountId = page.instagram_business_account.id;
            break;
          }
        }
      }
    }

    if (!igAccountId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Conta Instagram Business não encontrada. Verifique se sua conta está conectada a uma página do Facebook.",
          comments: [] 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📱 Instagram Account ID: ${igAccountId}`);

    // Get recent media
    const mediaResponse = await fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}/media?fields=id,caption,timestamp,media_type,permalink,comments_count&limit=25&access_token=${token}`
    );
    const mediaData = await mediaResponse.json();

    if (mediaData.error) {
      console.error("Erro ao buscar mídia:", mediaData.error);
      throw new Error(mediaData.error.message);
    }

    console.log(`📸 Mídias encontradas: ${mediaData.data?.length || 0}`);

    const allComments: any[] = [];
    const myUsername = await getAccountUsername(igAccountId, token);

    // Get comments for each media
    if (mediaData.data) {
      for (const media of mediaData.data) {
        if (media.comments_count > 0) {
          try {
            const commentsResponse = await fetch(
              `https://graph.facebook.com/v21.0/${media.id}/comments?fields=id,text,timestamp,username,like_count,replies{id,text,timestamp,username}&limit=50&access_token=${token}`
            );
            const commentsData = await commentsResponse.json();

            if (commentsData.data) {
              for (const comment of commentsData.data) {
                // Determine if this is received or sent
                const isOwnComment = myUsername && comment.username?.toLowerCase() === myUsername.toLowerCase();
                
                allComments.push({
                  comment_id: comment.id,
                  comment_text: comment.text,
                  author_username: comment.username,
                  created_at: comment.timestamp,
                  post_id: media.id,
                  post_url: media.permalink,
                  comment_type: isOwnComment ? "sent" : "received",
                  like_count: comment.like_count || 0,
                });

                // Add replies
                if (comment.replies?.data) {
                  for (const reply of comment.replies.data) {
                    const isOwnReply = myUsername && reply.username?.toLowerCase() === myUsername.toLowerCase();
                    
                    allComments.push({
                      comment_id: reply.id,
                      comment_text: reply.text,
                      author_username: reply.username,
                      created_at: reply.timestamp,
                      post_id: media.id,
                      post_url: media.permalink,
                      comment_type: isOwnReply ? "sent" : "received",
                      parent_comment_id: comment.id
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.error(`Erro ao buscar comentários da mídia ${media.id}:`, err);
          }
        }
      }
    }

    console.log(`💬 Total de comentários encontrados: ${allComments.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        comments: allComments,
        total: allComments.length,
        instagramAccountId: igAccountId
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        comments: [] 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

async function getAccountUsername(igAccountId: string, token: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${igAccountId}?fields=username&access_token=${token}`
    );
    const data = await response.json();
    return data.username || null;
  } catch (error) {
    console.error("Erro ao buscar username:", error);
    return null;
  }
}
