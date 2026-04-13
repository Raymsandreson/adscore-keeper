import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, postUrl, username, message } = await req.json();

    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
    if (!APIFY_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Apify API key não configurada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!message?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "Mensagem é obrigatória" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    let result;

    if (action === "comment") {
      // Post a comment on Instagram using Apify
      if (!postUrl) {
        return new Response(
          JSON.stringify({ success: false, error: "URL do post é obrigatória para comentar" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      console.log(`Posting comment on ${postUrl}: ${message.substring(0, 50)}...`);

      const runResponse = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-comment-scraper/runs?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directUrls: [postUrl],
            commentText: message,
            resultsLimit: 1,
          }),
        }
      );

      // Alternative: use a dedicated comment posting actor
      // Try the comment poster actor first
      const commentActorResponse = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-post-commenter/runs?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postUrls: [postUrl],
            comment: message,
          }),
        }
      );

      if (commentActorResponse.ok) {
        const runData = await commentActorResponse.json();
        result = { 
          success: true, 
          action: "comment", 
          runId: runData?.data?.id,
          status: "queued",
          message: "Comentário enviado para processamento via Apify"
        };
      } else {
        const errText = await commentActorResponse.text();
        console.error("Apify comment error:", errText);
        throw new Error("Erro ao enviar comentário via Apify. Verifique se o actor está configurado.");
      }

    } else if (action === "dm") {
      // Send a DM on Instagram using Apify
      if (!username) {
        return new Response(
          JSON.stringify({ success: false, error: "Username é obrigatório para enviar DM" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const cleanUsername = username.replace('@', '');
      console.log(`Sending DM to @${cleanUsername}: ${message.substring(0, 50)}...`);

      const dmResponse = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-dm-sender/runs?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients: [cleanUsername],
            message: message,
          }),
        }
      );

      if (dmResponse.ok) {
        const runData = await dmResponse.json();
        result = {
          success: true,
          action: "dm",
          runId: runData?.data?.id,
          status: "queued",
          message: `DM enviada para @${cleanUsername} via Apify`
        };
      } else {
        const errText = await dmResponse.text();
        console.error("Apify DM error:", errText);
        throw new Error("Erro ao enviar DM via Apify. Verifique se o actor está configurado.");
      }

    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Ação inválida. Use 'comment' ou 'dm'" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
