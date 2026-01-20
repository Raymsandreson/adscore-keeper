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
    const { comment, authorUsername, postContext, tone } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const toneInstructions = {
      friendly: "Seja amigável, caloroso e acolhedor. Use emojis com moderação.",
      professional: "Seja profissional e formal, mantendo cordialidade.",
      empathetic: "Demonstre empatia e compreensão genuína pela situação da pessoa.",
      sales: "Seja persuasivo mas não agressivo. Foque em gerar interesse e conduzir para uma conversa.",
      casual: "Seja descontraído e casual, como se estivesse falando com um amigo."
    };

    const selectedTone = toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.friendly;

    const systemPrompt = `Você é um assistente especializado em responder comentários do Instagram para uma empresa brasileira.

REGRAS IMPORTANTES:
1. Responda SEMPRE em português brasileiro
2. Seja conciso - comentários do Instagram devem ser curtos (máximo 200 caracteres)
3. ${selectedTone}
4. Nunca use hashtags na resposta
5. Personalize a resposta mencionando o nome do usuário quando apropriado
6. Se o comentário indicar interesse em serviços, convide para DM ou contato
7. Mantenha o tom humano e autêntico - evite respostas genéricas
8. Use no máximo 1-2 emojis se o tom permitir

CONTEXTO:
- Autor do comentário: @${authorUsername || 'usuário'}
${postContext ? `- Contexto do post: ${postContext}` : ''}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Responda este comentário do Instagram:\n\n"${comment}"` }
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add funds to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "";

    // Generate alternative suggestions
    const alternativesResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `Crie 2 respostas ALTERNATIVAS (diferentes da original) para este comentário do Instagram. Retorne apenas as respostas, uma por linha, sem numeração ou explicações.\n\nComentário: "${comment}"\n\nResposta original gerada: "${reply}"` 
          }
        ],
        max_tokens: 300,
        temperature: 0.9,
      }),
    });

    let alternatives: string[] = [];
    if (alternativesResponse.ok) {
      const altData = await alternativesResponse.json();
      const altText = altData.choices?.[0]?.message?.content?.trim() || "";
      alternatives = altText.split('\n').filter((line: string) => line.trim().length > 0).slice(0, 2);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        reply,
        alternatives,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error generating AI reply:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
