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
    const { comment, authorUsername, postContext, parentComment, tone, generateDM } = await req.json();
    
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

    // Build context section
    let contextSection = `- Autor do comentário: @${authorUsername || 'usuário'}`;
    
    if (postContext) {
      contextSection += `\n- Sobre a postagem: ${postContext}`;
    }
    
    if (parentComment) {
      contextSection += `\n- Este é uma RESPOSTA ao comentário de @${parentComment.author}: "${parentComment.text}"`;
      contextSection += `\n- Considere o contexto da conversa ao responder`;
    }

    // Generate comment reply
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
${parentComment ? '9. IMPORTANTE: Este comentário é uma resposta em uma thread - mantenha a coerência com a conversa' : ''}

CONTEXTO:
${contextSection}`;

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

    // Generate DM suggestion if requested
    let dmSuggestion: string | null = null;
    if (generateDM) {
      // Build DM-specific context - always direct to the comment author, NOT the parent comment author
      let dmContextSection = `- Pessoa que você vai enviar a DM: @${authorUsername || 'usuário'}`;
      
      if (postContext) {
        dmContextSection += `\n- Sobre a postagem: ${postContext}`;
      }
      
      // If there's a parent comment, it means the current user was replying to someone else
      // The DM should still be directed to authorUsername (who made the comment we're responding to)
      if (parentComment) {
        dmContextSection += `\n- O comentário de @${authorUsername} foi uma resposta a outro comentário de @${parentComment.author}`;
        dmContextSection += `\n- Contexto: @${authorUsername} escreveu "${comment}" respondendo a @${parentComment.author} que disse "${parentComment.text}"`;
      } else {
        dmContextSection += `\n- Comentário de @${authorUsername}: "${comment}"`;
      }

      const dmSystemPrompt = `Você é um assistente especializado em criar mensagens para Direct (DM) do Instagram para uma empresa brasileira.

REGRAS IMPORTANTES:
1. Escreva SEMPRE em português brasileiro
2. A mensagem deve ser uma continuação natural da interação nos comentários
3. ${selectedTone}
4. Seja breve mas acolhedor (máximo 300 caracteres)
5. IMPORTANTE: A DM é para @${authorUsername || 'usuário'} - use APENAS este @ na saudação
6. NÃO mencione outros usuários na saudação da DM
7. Mencione brevemente o contexto da interação anterior
8. Faça uma pergunta ou convite para continuar a conversa
9. Evite ser muito formal ou robótico
10. Use 1-2 emojis se apropriado

CONTEXTO DA INTERAÇÃO:
${dmContextSection}
- Resposta que você deu no comentário: "${reply}"`;

      const dmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: dmSystemPrompt },
            { role: "user", content: `Crie uma mensagem para enviar no Direct do Instagram para @${authorUsername || 'usuário'}. IMPORTANTE: Dirija a mensagem APENAS para @${authorUsername}, não mencione outros usuários na saudação.` }
          ],
          max_tokens: 200,
          temperature: 0.7,
        }),
      });

      if (dmResponse.ok) {
        const dmData = await dmResponse.json();
        dmSuggestion = dmData.choices?.[0]?.message?.content?.trim() || null;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        reply,
        alternatives,
        dmSuggestion,
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
