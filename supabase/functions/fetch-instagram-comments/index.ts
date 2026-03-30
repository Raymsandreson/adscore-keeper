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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accessToken, pageId, instagramAccountId } = await req.json();
    
    if (!accessToken) {
      throw new Error("Access token não fornecido. Atualize o token da conta Instagram.");
    }
    
    const token = accessToken;

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
    
    // Map to track which comments have been replied by owner (manual replies detection)
    const manuallyRepliedComments = new Map<string, { replied_at: string; reply_text: string }>();

    // Get comments for each media
    if (mediaData.data) {
      for (const media of mediaData.data) {
        if (media.comments_count > 0) {
          try {
            const commentsResponse = await fetch(
              `https://graph.facebook.com/v21.0/${media.id}/comments?fields=id,text,timestamp,username,from{id,username},like_count,replies{id,text,timestamp,username,from{id,username}}&limit=50&access_token=${token}`
            );
            const commentsData = await commentsResponse.json();

            if (commentsData.data) {
              for (const comment of commentsData.data) {
                // Determine if this is received or sent
                const isOwnComment = myUsername && comment.username?.toLowerCase() === myUsername.toLowerCase();
                
                // Check if this comment has a reply from the account owner (manual reply detection)
                let wasManuallyReplied = false;
                let manualReplyTimestamp: string | null = null;
                
                if (!isOwnComment && comment.replies?.data) {
                  // Look for replies from the account owner
                  for (const reply of comment.replies.data) {
                    const isOwnerReply = myUsername && reply.username?.toLowerCase() === myUsername.toLowerCase();
                    if (isOwnerReply) {
                      wasManuallyReplied = true;
                      manualReplyTimestamp = reply.timestamp;
                      // Store the earliest reply from owner
                      if (!manuallyRepliedComments.has(comment.id) || 
                          new Date(reply.timestamp) < new Date(manuallyRepliedComments.get(comment.id)!.replied_at)) {
                        manuallyRepliedComments.set(comment.id, {
                          replied_at: reply.timestamp,
                          reply_text: reply.text
                        });
                      }
                      break;
                    }
                  }
                }
                
                allComments.push({
                  comment_id: comment.id,
                  comment_text: comment.text,
                  author_username: comment.username,
                  author_id: comment.from?.id || null,
                  created_at: comment.timestamp,
                  post_id: media.id,
                  post_url: media.permalink,
                  comment_type: isOwnComment ? "sent" : "received",
                  like_count: comment.like_count || 0,
                  was_manually_replied: wasManuallyReplied,
                  manual_reply_at: manualReplyTimestamp,
                });

                // Add replies
                if (comment.replies?.data) {
                  for (const reply of comment.replies.data) {
                    const isOwnReply = myUsername && reply.username?.toLowerCase() === myUsername.toLowerCase();
                    
                    allComments.push({
                      comment_id: reply.id,
                      comment_text: reply.text,
                      author_username: reply.username,
                      author_id: reply.from?.id || null,
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

    // Fetch mentions (comments where the account was tagged)
    console.log("🏷️ Buscando menções...");
    try {
      const mentionsResponse = await fetch(
        `https://graph.facebook.com/v21.0/${igAccountId}/mentioned_comment?fields=id,text,timestamp,from{id,username},media{id,permalink}&access_token=${token}`
      );
      const mentionsData = await mentionsResponse.json();
      
      if (mentionsData.data && mentionsData.data.length > 0) {
        console.log(`🏷️ Menções encontradas: ${mentionsData.data.length}`);
        
        for (const mention of mentionsData.data) {
          // Check if we already have this comment
          const existingComment = allComments.find(c => c.comment_id === mention.id);
          if (!existingComment) {
            allComments.push({
              comment_id: mention.id,
              comment_text: mention.text,
              author_username: mention.from?.username || null,
              author_id: mention.from?.id || null,
              created_at: mention.timestamp,
              post_id: mention.media?.id || null,
              post_url: mention.media?.permalink || null,
              comment_type: "received", // Mentions are treated as received
              metadata: { is_mention: true }
            });
          }
        }
      } else {
        console.log("🏷️ Nenhuma menção encontrada ou API não disponível");
      }
    } catch (mentionError) {
      console.log("🏷️ Menções não disponíveis (requer permissão instagram_manage_comments):", mentionError);
    }

    console.log(`💬 Total de comentários encontrados: ${allComments.length}`);
    console.log(`🔄 Comentários com resposta manual detectada: ${manuallyRepliedComments.size}`);

    // Note: Outbound comments (on third-party posts) are tracked via userscript/n8n integration
    // This function only fetches comments on our own posts

    // Convert manuallyRepliedComments Map to array for response
    const manualRepliesArray = Array.from(manuallyRepliedComments.entries()).map(([commentId, data]) => ({
      comment_id: commentId,
      replied_at: data.replied_at,
      reply_text: data.reply_text
    }));

    // Save comments to Supabase database
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let savedCount = 0;
    let errorCount = 0;

    for (const comment of allComments) {
      try {
        const { error } = await supabase
          .from('instagram_comments')
          .upsert({
            comment_id: comment.comment_id,
            comment_text: comment.comment_text,
            author_username: comment.author_username,
            author_id: comment.author_id,
            created_at: comment.created_at,
            post_id: comment.post_id,
            post_url: comment.post_url,
            comment_type: comment.comment_type,
            parent_comment_id: comment.parent_comment_id || null,
            ad_account_id: igAccountId,
            platform: 'instagram',
            metadata: comment.metadata || null,
            // Mark as replied if was manually replied
            replied_at: comment.was_manually_replied ? comment.manual_reply_at : null,
            replied_by: comment.was_manually_replied ? 'manual' : null,
          }, {
            onConflict: 'comment_id',
            ignoreDuplicates: false
          });

        if (error) {
          console.error(`Erro ao salvar comentário ${comment.comment_id}:`, error.message);
          errorCount++;
        } else {
          savedCount++;
        }
      } catch (err) {
        console.error(`Erro inesperado ao salvar comentário:`, err);
        errorCount++;
      }
    }

    console.log(`💾 Comentários salvos: ${savedCount}, Erros: ${errorCount}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        comments: allComments,
        total: allComments.length,
        commentsCount: allComments.length,
        instagramAccountId: igAccountId,
        // Database save stats
        savedToDatabase: savedCount,
        saveErrors: errorCount,
        // Manual replies detection data
        manualReplies: manualRepliesArray,
        manualRepliesCount: manualRepliesArray.length
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
