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
    const { commentId, message, accessToken } = await req.json();
    
    const token = accessToken || Deno.env.get("META_ACCESS_TOKEN");
    
    if (!token) {
      throw new Error("Access token não configurado");
    }

    if (!commentId) {
      throw new Error("ID do comentário é obrigatório");
    }

    if (!message || message.trim().length === 0) {
      throw new Error("Mensagem de resposta é obrigatória");
    }

    console.log(`📤 Postando resposta para comentário ${commentId}...`);

    // Post reply to the comment using Instagram Graph API
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${commentId}/replies`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message.trim(),
          access_token: token,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("Erro da API do Instagram:", data.error);
      
      // Handle specific errors
      if (data.error.code === 10 || data.error.code === 100) {
        throw new Error("Não é possível responder a este comentário. Pode ter sido excluído ou estar em um post privado.");
      }
      if (data.error.code === 190) {
        throw new Error("Token de acesso expirado. Por favor, reconecte sua conta.");
      }
      if (data.error.code === 368) {
        throw new Error("Ação bloqueada temporariamente pelo Instagram. Tente novamente mais tarde.");
      }
      
      throw new Error(data.error.message || "Erro ao postar resposta");
    }

    console.log(`✅ Resposta postada com sucesso! ID: ${data.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        replyId: data.id,
        message: "Resposta postada com sucesso!"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Erro ao postar resposta:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || "Erro desconhecido"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
