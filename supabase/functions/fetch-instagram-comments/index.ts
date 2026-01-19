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

    // First, detect if this is a Page Token by checking /me endpoint
    const meResponse = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name,instagram_business_account&access_token=${token}`
    );
    const meData = await meResponse.json();
    
    console.log("Token /me response:", JSON.stringify(meData));

    let igAccountId = instagramAccountId;
    let detectedPageId = pageId;

    // Check if /me returns a page (Page Token) or user (User Token)
    if (meData.instagram_business_account?.id) {
      // Page Token - /me directly returns the page with Instagram account
      igAccountId = meData.instagram_business_account.id;
      detectedPageId = meData.id;
      console.log(`Page Token detected - Instagram Account: ${igAccountId}`);
    } else if (!igAccountId) {
      // User Token - need to fetch pages
      const pagesResponse = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account,name&access_token=${token}`
      );
      const pagesData = await pagesResponse.json();
      
      console.log("Pages response:", JSON.stringify(pagesData));
      
      if (pagesData.data && pagesData.data.length > 0) {
        for (const page of pagesData.data) {
          if (page.instagram_business_account?.id) {
            igAccountId = page.instagram_business_account.id;
            detectedPageId = page.id;
            console.log(`Found Instagram Account from pages: ${igAccountId}`);
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

    // Fetch mentions on third-party posts (where someone tagged us)
    const mentions: any[] = [];
    try {
      console.log("🏷️ Buscando menções em posts de terceiros...");
      
      const mentionsResponse = await fetch(
        `https://graph.facebook.com/v21.0/${igAccountId}/mentioned_comment?fields=id,text,timestamp,username,media{id,permalink,caption,owner{username}}&limit=50&access_token=${token}`
      );
      const mentionsData = await mentionsResponse.json();
      
      if (mentionsData.error) {
        console.log("⚠️ Erro ao buscar menções (pode ser permissão):", mentionsData.error.message);
      } else if (mentionsData.data) {
        console.log(`🏷️ Menções encontradas: ${mentionsData.data.length}`);
        
        for (const mention of mentionsData.data) {
          mentions.push({
            comment_id: mention.id,
            comment_text: mention.text,
            author_username: mention.username,
            created_at: mention.timestamp,
            post_id: mention.media?.id || null,
            post_url: mention.media?.permalink || null,
            comment_type: "mention",
            metadata: {
              post_owner: mention.media?.owner?.username || null,
              post_caption: mention.media?.caption || null,
              is_third_party: true
            }
          });
        }
      }
    } catch (mentionErr) {
      console.log("⚠️ Não foi possível buscar menções:", mentionErr);
    }

    // Combine all comments and mentions
    const allData = [...allComments, ...mentions];
    console.log(`📊 Total (comentários + menções): ${allData.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        comments: allData,
        total: allData.length,
        commentsCount: allComments.length,
        mentionsCount: mentions.length,
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
