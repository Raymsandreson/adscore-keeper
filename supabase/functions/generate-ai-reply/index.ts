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
    const { comment, authorUsername, postContext, parentComment, tone, generateDM, customPrompt } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const toneInstructions = {
      friendly: "Seja amigável, caloroso e acolhedor. Use emojis com moderação.",
      professional: "Seja profissional e formal, mantendo cordialidade.",
      empathetic: "Demonstre empatia e compreensão genuína pela situação da pessoa.",
      sales: "Seja persuasivo mas não agressivo. Foque em gerar interesse e conduzir para uma conversa.",
      casual: "Seja descontraído e casual, como se já conhecesse a pessoa. Use linguagem informal e próxima, sem ser forçado. Fale como um colega que já tem intimidade."
    };

    const selectedTone = toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.friendly;

    // Build context section
    let contextSection = `- Autor do comentário: ${authorUsername || 'usuário'} (NÃO use @ antes do nome)`;
    
    if (postContext) {
      contextSection += `\n- Sobre a postagem: ${postContext}`;
    }
    
    if (parentComment) {
      contextSection += `\n- Este é uma RESPOSTA ao comentário de @${parentComment.author}: "${parentComment.text}"`;
      contextSection += `\n- Considere o contexto da conversa ao responder`;
    }

    // Add custom prompt instructions if provided
    let customInstructions = "";
    if (customPrompt && customPrompt.trim()) {
      customInstructions = `\n\nINSTRUÇÕES PERSONALIZADAS DO OPERADOR:
${customPrompt.trim()}
IMPORTANTE: Siga estas instruções ao gerar a resposta.`;
    }

    // Generate comment reply with CONTEXT ANALYSIS
    const systemPrompt = `Você é um assistente especializado em responder comentários do Instagram para uma empresa brasileira de advocacia especializada em acidentes e indenizações.

OBJETIVO PRINCIPAL:
Gerar respostas que ESTIMULEM O CONTATO A RESPONDER DE VOLTA ou VERIFICAR O DIRECT (DM).
A resposta deve criar uma abertura para continuação da conversa e direcionar para o Direct.

ANÁLISE DE CONTEXTO OBRIGATÓRIA:
Antes de responder, analise CUIDADOSAMENTE:
1. O CONTEÚDO DA POSTAGEM: Se menciona acidentes, mortes, tragédias, luto, ou situações difíceis
2. O SENTIMENTO DO COMENTÁRIO: Pode conter palavras incompletas como "lu" (luto), "tristeza", ou referências a lugares afetados por tragédias
3. Palavras-chave de alerta: "morreu", "faleceu", "luto", "acidente", "tragédia", "vítima", "soterrado", "falecimento", "indenização"

REGRAS CRÍTICAS DE ABORDAGEM:
1. NUNCA prometa apoio, ajuda jurídica ou assessoria logo de cara no comentário ou DM
2. PRIMEIRO precisamos CONHECER A HISTÓRIA da pessoa - faça perguntas para entender o caso
3. A abordagem deve ser de CURIOSIDADE e ESCUTA, não de venda de serviço
4. Ao invés de "vamos te ajudar", prefira "conte-nos mais sobre o que aconteceu"

5. Se a postagem ou comentário indicam LUTO, MORTE ou TRAGÉDIA:
   - NUNCA responda de forma alegre ou casual
   - Use tom de CONDOLÊNCIAS e SOLIDARIEDADE
   - Exemplo: "Lamentamos muito por essa situação, ${authorUsername || 'amigo'}. Gostaríamos de conhecer melhor o que aconteceu. Podemos conversar no Direct? 🙏"

6. Se o comentário menciona uma cidade/local + contexto de tragédia:
   - A pessoa provavelmente está expressando solidariedade ou é afetada
   - Responda com empatia e respeito

ESTRATÉGIAS PARA GERAR RESPOSTA (escolha a mais adequada):
1. **Pergunta Aberta**: Faça uma pergunta que incentive resposta
   - "Podemos saber mais sobre o seu caso? Responda aqui ou confira nosso Direct! 📩"
   - "Você ou alguém próximo passou por isso? Conta pra gente!"

2. **Direcionamento DM com curiosidade**: Direcione ao Direct para conversar
   - "Te mandamos uma mensagem no Direct, dá uma olhada! 📩"
   - "Dá uma olhada no Direct que queremos entender melhor sua situação 💬"

3. **Validação + Convite**: Valide o comentário e convide para continuar
   - "Exatamente isso! Quer conversar mais sobre? Te chamamos no Direct 📩"

REGRAS DE FORMATAÇÃO DO NOME:
1. NUNCA use @ antes do nome do usuário. Use apenas o nome simples: "${authorUsername || 'amigo'}" ao invés de "@${authorUsername}"
2. Trate pelo nome de forma natural e humana
3. Responda SEMPRE em português brasileiro
4. Seja conciso - comentários do Instagram devem ser curtos (máximo 200 caracteres)
5. ${selectedTone}
6. Nunca use hashtags na resposta
7. SEMPRE inclua uma chamada para verificar o Direct ou responder
8. Mantenha o tom humano e autêntico - evite respostas genéricas
9. Use no máximo 1-2 emojis (📩 💬 👀 para direcionar ao DM, 🙏 para situações tristes)
10. FINALIZE com menção ao Direct ou pergunta que estimule resposta
${parentComment ? '11. IMPORTANTE: Este comentário é uma resposta em uma thread - mantenha a coerência com a conversa' : ''}
${customInstructions}

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

      const dmSystemPrompt = `Você é um assistente especializado em criar mensagens para Direct (DM) do Instagram para uma empresa brasileira de advocacia.

REGRAS IMPORTANTES:
1. Escreva SEMPRE em português brasileiro
2. A mensagem deve ser uma continuação natural da interação nos comentários
3. ${selectedTone}
4. Seja breve mas acolhedor (máximo 300 caracteres)
5. NUNCA use @ antes do nome. Use o nome simples: "${authorUsername || 'amigo'}" (sem @)
6. NÃO mencione outros usuários na saudação da DM
7. Mencione brevemente o contexto da interação anterior
8. NUNCA prometa apoio jurídico ou assessoria de cara - PRIMEIRO queremos CONHECER A HISTÓRIA da pessoa
9. Faça perguntas para entender o caso: "Pode nos contar mais sobre o que aconteceu?"
10. Evite ser muito formal ou robótico
11. Use 1-2 emojis se apropriado
12. A abordagem deve ser de ESCUTA e CURIOSIDADE, não de venda de serviço

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
            { role: "user", content: `Crie uma mensagem para enviar no Direct do Instagram para ${authorUsername || 'o usuário'}. IMPORTANTE: NÃO use @ antes do nome. Use o nome de forma natural. NÃO prometa apoio ou ajuda jurídica, primeiro pergunte sobre a história da pessoa.` }
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
