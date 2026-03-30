import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log("n8n webhook received:", JSON.stringify(body));

    const { action, comment_id, comment_text, author_username, post_url, access_token, generate_ai_reply, tone } = body;

    // Action: fetch_pending_comments - Return comments that need AI response
    if (action === "fetch_pending_comments") {
      const { data: comments, error } = await supabase
        .from("instagram_comments")
        .select("*")
        .is("replied_at", null)
        .eq("comment_type", "received")
        .order("created_at", { ascending: false })
        .limit(body.limit || 10);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, comments }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: generate_reply - Generate AI reply for a comment
    if (action === "generate_reply") {
      if (!comment_text) {
        return new Response(
          JSON.stringify({ success: false, error: "comment_text is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const toneInstructions: Record<string, string> = {
        friendly: "Seja amigável, caloroso e acolhedor. Use emojis com moderação.",
        professional: "Seja profissional e formal, mantendo cordialidade.",
        empathetic: "Demonstre empatia e compreensão genuína.",
        sales: "Seja persuasivo mas não agressivo. Foque em gerar interesse.",
        casual: "Seja descontraído e casual, como se estivesse falando com um amigo."
      };

      const selectedTone = toneInstructions[tone || "friendly"] || toneInstructions.friendly;

      const systemPrompt = `Você é um assistente especializado em responder comentários do Instagram para uma empresa brasileira.

REGRAS:
1. Responda SEMPRE em português brasileiro
2. Seja conciso - máximo 200 caracteres
3. ${selectedTone}
4. Nunca use hashtags
5. Personalize mencionando o usuário quando apropriado
6. Use no máximo 1-2 emojis

CONTEXTO:
- Autor: @${author_username || 'usuário'}
${post_url ? `- Post: ${post_url}` : ''}`;

      const result = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Responda este comentário:\n\n"${comment_text}"` }
        ],
        max_tokens: 150,
        temperature: 0.7,
      });

      const reply = result.choices?.[0]?.message?.content?.trim() || "";

      return new Response(
        JSON.stringify({ success: true, reply, comment_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: post_reply - Post a reply to Instagram
    if (action === "post_reply") {
      if (!comment_id || !body.message) {
        return new Response(
          JSON.stringify({ success: false, error: "comment_id and message are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = access_token || Deno.env.get("META_ACCESS_TOKEN");
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: "access_token is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const igResponse = await fetch(
        `https://graph.facebook.com/v21.0/${comment_id}/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: body.message.trim(),
            access_token: token,
          }),
        }
      );

      const igData = await igResponse.json();

      if (!igResponse.ok) {
        console.error("Instagram API error:", igData);
        return new Response(
          JSON.stringify({ success: false, error: igData.error?.message || "Instagram API error" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase
        .from("instagram_comments")
        .update({ replied_at: new Date().toISOString() })
        .eq("comment_id", comment_id);

      await supabase.from("n8n_automation_logs").insert({
        action_type: "auto_reply",
        comment_id,
        message_sent: body.message,
        status: "success",
      });

      return new Response(
        JSON.stringify({ success: true, reply_id: igData.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: scheduled_run - Run from pg_cron schedule
    if (action === "scheduled_run") {
      const scheduleId = body.schedule_id;
      
      let scheduleConfig = {
        max_comments_per_run: body.limit || 5,
        auto_post: body.auto_post === true,
        tone: body.tone || "friendly",
      };

      if (scheduleId) {
        const { data: schedule } = await supabase
          .from("n8n_comment_schedules")
          .select("*")
          .eq("id", scheduleId)
          .single();

        if (schedule) {
          scheduleConfig = {
            max_comments_per_run: schedule.max_comments_per_run || 5,
            auto_post: schedule.auto_post === true,
            tone: schedule.tone || "friendly",
          };
        }
      }

      const token = access_token || Deno.env.get("META_ACCESS_TOKEN");

      const { data: comments, error } = await supabase
        .from("instagram_comments")
        .select("*")
        .is("replied_at", null)
        .eq("comment_type", "received")
        .order("created_at", { ascending: false })
        .limit(scheduleConfig.max_comments_per_run);

      if (error) throw error;

      const toneInstructions: Record<string, string> = {
        friendly: "Seja amigável, caloroso e acolhedor. Use emojis com moderação.",
        professional: "Seja profissional e formal, mantendo cordialidade.",
        empathetic: "Demonstre empatia e compreensão genuína.",
        sales: "Seja persuasivo mas não agressivo. Foque em gerar interesse.",
        casual: "Seja descontraído e casual, como se estivesse falando com um amigo."
      };

      const selectedTone = toneInstructions[scheduleConfig.tone] || toneInstructions.friendly;
      const results = [];
      let repliesPosted = 0;

      for (const comment of comments || []) {
        const systemPrompt = `Você é um assistente de Instagram. Responda em português brasileiro, máximo 200 caracteres. ${selectedTone} Autor: @${comment.author_username || 'usuário'}`;

        try {
          const aiResult = await geminiChat({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Responda: "${comment.comment_text}"` }
            ],
            max_tokens: 150,
            temperature: 0.7,
          });

          const reply = aiResult.choices?.[0]?.message?.content?.trim() || "";

          const result: any = {
            comment_id: comment.comment_id,
            author_username: comment.author_username,
            original_comment: comment.comment_text,
            generated_reply: reply,
            posted: false,
          };

          if (scheduleConfig.auto_post && token && comment.comment_id) {
            const igResponse = await fetch(
              `https://graph.facebook.com/v21.0/${comment.comment_id}/replies`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: reply,
                  access_token: token,
                }),
              }
            );

            if (igResponse.ok) {
              const igData = await igResponse.json();
              result.posted = true;
              result.reply_id = igData.id;
              repliesPosted++;

              await supabase
                .from("instagram_comments")
                .update({ replied_at: new Date().toISOString() })
                .eq("comment_id", comment.comment_id);
            }
          }

          results.push(result);
        } catch (e) {
          console.error("AI error for comment:", comment.comment_id, e);
          results.push({ comment_id: comment.comment_id, error: "AI generation failed" });
        }
      }

      if (scheduleId) {
        const { data: currentSchedule } = await supabase
          .from("n8n_comment_schedules")
          .select("total_runs, total_replies, interval_minutes")
          .eq("id", scheduleId)
          .single();

        if (currentSchedule) {
          const nextRunAt = new Date();
          nextRunAt.setMinutes(nextRunAt.getMinutes() + (currentSchedule.interval_minutes || 30));

          await supabase
            .from("n8n_comment_schedules")
            .update({
              last_run_at: new Date().toISOString(),
              next_run_at: nextRunAt.toISOString(),
              total_runs: (currentSchedule.total_runs || 0) + 1,
              total_replies: (currentSchedule.total_replies || 0) + repliesPosted,
            })
            .eq("id", scheduleId);
        }
      }

      await supabase.from("n8n_automation_logs").insert({
        action_type: "scheduled_run",
        status: "success",
        metadata: {
          schedule_id: scheduleId,
          comments_processed: results.length,
          replies_posted: repliesPosted,
        },
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: results.length, 
          replies_posted: repliesPosted,
          results 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: auto_process - Full automation: fetch, generate, and optionally post
    if (action === "auto_process") {
      const autoPost = body.auto_post === true;
      const token = access_token || Deno.env.get("META_ACCESS_TOKEN");

      const { data: comments, error } = await supabase
        .from("instagram_comments")
        .select("*")
        .is("replied_at", null)
        .eq("comment_type", "received")
        .order("created_at", { ascending: false })
        .limit(body.limit || 5);

      if (error) throw error;

      const results = [];

      for (const comment of comments || []) {
        try {
          const aiResult = await geminiChat({
            model: "google/gemini-2.5-flash",
            messages: [
              { 
                role: "system", 
                content: `Você é um assistente de Instagram. Responda em português brasileiro, máximo 200 caracteres, seja amigável. Autor: @${comment.author_username || 'usuário'}` 
              },
              { role: "user", content: `Responda: "${comment.comment_text}"` }
            ],
            max_tokens: 150,
            temperature: 0.7,
          });

          const reply = aiResult.choices?.[0]?.message?.content?.trim() || "";

          const result: any = {
            comment_id: comment.comment_id,
            author_username: comment.author_username,
            original_comment: comment.comment_text,
            generated_reply: reply,
            posted: false,
          };

          if (autoPost && token && comment.comment_id) {
            const igResponse = await fetch(
              `https://graph.facebook.com/v21.0/${comment.comment_id}/replies`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: reply,
                  access_token: token,
                }),
              }
            );

            if (igResponse.ok) {
              const igData = await igResponse.json();
              result.posted = true;
              result.reply_id = igData.id;

              await supabase
                .from("instagram_comments")
                .update({ replied_at: new Date().toISOString() })
                .eq("comment_id", comment.comment_id);

              await supabase.from("n8n_automation_logs").insert({
                action_type: "auto_reply",
                comment_id: comment.comment_id,
                message_sent: reply,
                status: "success",
              });
            }
          }

          results.push(result);
        } catch (e) {
          console.error("AI error for comment:", comment.comment_id, e);
          results.push({ comment_id: comment.comment_id, error: "AI generation failed" });
        }
      }

      return new Response(
        JSON.stringify({ success: true, processed: results.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: register_outbound - Register an outbound comment from n8n
    if (action === "register_outbound") {
      const { account_id, account_name, target_username, comment_text, post_url } = body;

      if (!target_username || !comment_text) {
        return new Response(
          JSON.stringify({ success: false, error: "target_username and comment_text are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase.from("instagram_comments").insert({
        ad_account_id: account_id || null,
        author_username: account_name?.replace("@", "") || null,
        comment_text,
        comment_type: "outbound_n8n",
        post_url: post_url || null,
        prospect_name: target_username,
        platform: "instagram",
        metadata: {
          target_username,
          source: "n8n_automation",
          registered_at: new Date().toISOString(),
        },
      }).select().single();

      if (error) throw error;

      await supabase.from("n8n_automation_logs").insert({
        action_type: "outbound_register",
        status: "success",
        metadata: { target_username, comment_id: data?.id },
      });

      return new Response(
        JSON.stringify({ success: true, comment: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Invalid action. Use: fetch_pending_comments, generate_reply, post_reply, scheduled_run, auto_process, or register_outbound" 
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("n8n webhook error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
