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
const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "lovable_instagram_webhook_2024";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // GET request = Meta webhook verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    console.log("🔐 Webhook verification request:", { mode, token, challenge });

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified successfully");
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    } else {
      console.error("❌ Webhook verification failed - token mismatch");
      return new Response("Forbidden", { status: 403 });
    }
  }

  // POST request = Incoming webhook event
  if (req.method === "POST") {
    try {
      const body = await req.json();
      console.log("📥 Webhook received:", JSON.stringify(body, null, 2));

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      let processedCount = 0;
      let errorCount = 0;

      // Process Instagram webhook events
      if (body.object === "instagram") {
        for (const entry of body.entry || []) {
          const igAccountId = entry.id;
          
          // Process comment changes
          for (const change of entry.changes || []) {
            if (change.field === "comments") {
              const commentData = change.value;
              console.log("💬 New comment event:", commentData);

              try {
                // Fetch additional comment details from Meta API if needed
                const commentRecord: Record<string, unknown> = {
                  comment_id: commentData.id,
                  comment_text: commentData.text,
                  author_username: commentData.from?.username || null,
                  author_id: commentData.from?.id || null,
                  created_at: new Date().toISOString(),
                  post_id: commentData.media?.id || null,
                  comment_type: "received",
                  ad_account_id: igAccountId,
                  platform: "instagram",
                  metadata: {
                    webhook_received: true,
                    parent_id: commentData.parent_id || null,
                    media_id: commentData.media?.id,
                    timestamp: commentData.created_time
                  }
                };

                // Check if it's a reply to our comment
                if (commentData.parent_id) {
                  commentRecord.parent_comment_id = commentData.parent_id;
                }

                const { error } = await supabase
                  .from("instagram_comments")
                  .upsert(commentRecord, {
                    onConflict: "comment_id",
                    ignoreDuplicates: false
                  });

                if (error) {
                  console.error("❌ Error saving comment:", error.message);
                  errorCount++;
                } else {
                  console.log("✅ Comment saved:", commentData.id);
                  processedCount++;
                }
              } catch (err) {
                console.error("❌ Error processing comment:", err);
                errorCount++;
              }
            }

            // Process mentions
            if (change.field === "mentions") {
              const mentionData = change.value;
              console.log("📢 New mention event:", mentionData);

              try {
                const mentionRecord = {
                  comment_id: mentionData.comment_id || `mention_${Date.now()}`,
                  comment_text: mentionData.text || null,
                  author_username: mentionData.username || null,
                  created_at: new Date().toISOString(),
                  post_id: mentionData.media_id || null,
                  comment_type: "mention",
                  ad_account_id: igAccountId,
                  platform: "instagram",
                  metadata: {
                    webhook_received: true,
                    media_type: mentionData.media_type
                  }
                };

                const { error } = await supabase
                  .from("instagram_comments")
                  .upsert(mentionRecord, {
                    onConflict: "comment_id",
                    ignoreDuplicates: false
                  });

                if (error) {
                  console.error("❌ Error saving mention:", error.message);
                  errorCount++;
                } else {
                  console.log("✅ Mention saved");
                  processedCount++;
                }
              } catch (err) {
                console.error("❌ Error processing mention:", err);
                errorCount++;
              }
            }
          }
        }
      }

      // Facebook Page comments (if subscribed)
      if (body.object === "page") {
        for (const entry of body.entry || []) {
          const pageId = entry.id;
          
          for (const change of entry.changes || []) {
            if (change.field === "feed" && change.value?.item === "comment") {
              const commentData = change.value;
              console.log("💬 Facebook comment event:", commentData);

              try {
                const commentRecord: Record<string, unknown> = {
                  comment_id: commentData.comment_id,
                  comment_text: commentData.message,
                  author_username: commentData.from?.name || null,
                  author_id: commentData.from?.id || null,
                  created_at: new Date(commentData.created_time * 1000).toISOString(),
                  post_id: commentData.post_id || null,
                  comment_type: commentData.verb === "add" ? "received" : commentData.verb,
                  ad_account_id: pageId,
                  platform: "facebook",
                  metadata: {
                    webhook_received: true,
                    verb: commentData.verb,
                    parent_id: commentData.parent_id
                  }
                };

                if (commentData.parent_id) {
                  commentRecord.parent_comment_id = commentData.parent_id;
                }

                const { error } = await supabase
                  .from("instagram_comments")
                  .upsert(commentRecord, {
                    onConflict: "comment_id",
                    ignoreDuplicates: false
                  });

                if (error) {
                  console.error("❌ Error saving FB comment:", error.message);
                  errorCount++;
                } else {
                  console.log("✅ FB Comment saved:", commentData.comment_id);
                  processedCount++;
                }
              } catch (err) {
                console.error("❌ Error processing FB comment:", err);
                errorCount++;
              }
            }
          }
        }
      }

      console.log(`📊 Webhook processing complete: ${processedCount} saved, ${errorCount} errors`);

      return new Response(
        JSON.stringify({ 
          success: true,
          processed: processedCount,
          errors: errorCount
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );

    } catch (err) {
      console.error("❌ Webhook processing error:", err);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { 
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
