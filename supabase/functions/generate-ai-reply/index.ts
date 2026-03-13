import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

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

    const toneInstructions: Record<string, string> = {
      friendly: "Seja amigável, caloroso e acolhedor. Use emojis com moderação.",
      professional: "Seja profissional e formal, mantendo cordialidade.",
      empathetic: "Demonstre empatia e compreensão genuína pela situação da pessoa.",
      sales: "Seja persuasivo mas não agressivo. Foque em gerar interesse e conduzir para uma conversa.",
      casual: "Seja descontraído e casual, como se já conhecesse a pessoa. Use linguagem informal e próxima, sem ser forçado."
    };

    const selectedTone = toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.friendly;

    let contextSection = `- Autor do comentário: ${authorUsername || 'usuário'} (NÃO use @ antes do nome)`;
    if (postContext) contextSection += `\n- Sobre a postagem: ${postContext}`;
    if (parentComment) {
      contextSection += `\n- Este é uma RESPOSTA ao comentário de @${parentComment.author}: "${parentComment.text}"`;
      contextSection += `\n- Considere o contexto da conversa ao responder`;
    }

    let customInstructions = "";
    if (customPrompt && customPrompt.trim()) {
      customInstructions = `\n\nINSTRUÇÕES PERSONALIZADAS DO OPERADOR:\n${customPrompt.trim()}\nIMPORTANTE: Siga estas instruções ao gerar a resposta.`;
    }

    const systemPrompt = `Você é um assistente especializado em responder comentários do Instagram para uma empresa brasileira de advocacia especializada em acidentes e indenizações.

OBJETIVO PRINCIPAL:
Gerar respostas que ESTIMULEM O CONTATO A RESPONDER DE VOLTA ou VERIFICAR O DIRECT (DM).

REGRAS CRÍTICAS DE ABORDAGEM:
1. NUNCA prometa apoio, ajuda jurídica ou assessoria logo de cara
2. PRIMEIRO precisamos CONHECER A HISTÓRIA da pessoa
3. A abordagem deve ser de CURIOSIDADE e ESCUTA
4. Se a postagem ou comentário indicam LUTO, MORTE ou TRAGÉDIA: Use tom de CONDOLÊNCIAS e SOLIDARIEDADE

REGRAS DE FORMATAÇÃO:
1. NUNCA use @ antes do nome do usuário
2. Responda SEMPRE em português brasileiro
3. Seja conciso - máximo 200 caracteres
4. ${selectedTone}
5. Use no máximo 1-2 emojis
6. FINALIZE com menção ao Direct ou pergunta
${parentComment ? '7. IMPORTANTE: Este comentário é uma resposta em uma thread - mantenha a coerência' : ''}
${customInstructions}

CONTEXTO:
${contextSection}`;

    const result = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Responda este comentário do Instagram:\n\n"${comment}"` }
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const reply = result.choices?.[0]?.message?.content?.trim() || "";

    // Generate alternative suggestions
    const altResult = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Crie 2 respostas ALTERNATIVAS (diferentes da original) para este comentário do Instagram. Retorne apenas as respostas, uma por linha, sem numeração ou explicações.\n\nComentário: "${comment}"\n\nResposta original gerada: "${reply}"` }
      ],
      max_tokens: 300,
      temperature: 0.9,
    });

    const altText = altResult.choices?.[0]?.message?.content?.trim() || "";
    const alternatives = altText.split('\n').filter((line: string) => line.trim().length > 0).slice(0, 2);

    // Generate DM suggestion if requested
    let dmSuggestion: string | null = null;
    if (generateDM) {
      let dmContextSection = `- Pessoa que você vai enviar a DM: @${authorUsername || 'usuário'}`;
      if (postContext) dmContextSection += `\n- Sobre a postagem: ${postContext}`;
      if (parentComment) {
        dmContextSection += `\n- O comentário de @${authorUsername} foi uma resposta a outro comentário de @${parentComment.author}`;
        dmContextSection += `\n- Contexto: @${authorUsername} escreveu "${comment}" respondendo a @${parentComment.author} que disse "${parentComment.text}"`;
      } else {
        dmContextSection += `\n- Comentário de @${authorUsername}: "${comment}"`;
      }

      const dmSystemPrompt = `Você é um assistente especializado em criar mensagens para Direct (DM) do Instagram para uma empresa brasileira de advocacia.

REGRAS:
1. Escreva em português brasileiro
2. ${selectedTone}
3. Seja breve (máximo 300 caracteres)
4. NUNCA use @ antes do nome
5. NUNCA prometa apoio jurídico - PRIMEIRO queremos CONHECER A HISTÓRIA
6. Faça perguntas para entender o caso
7. Use 1-2 emojis

CONTEXTO:
${dmContextSection}
- Resposta que você deu no comentário: "${reply}"`;

      const dmResult = await geminiChat({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: dmSystemPrompt },
          { role: "user", content: `Crie uma mensagem para enviar no Direct do Instagram para ${authorUsername || 'o usuário'}.` }
        ],
        max_tokens: 200,
        temperature: 0.7,
      });

      dmSuggestion = dmResult.choices?.[0]?.message?.content?.trim() || null;
    }

    return new Response(
      JSON.stringify({ success: true, reply, alternatives, dmSuggestion }),
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
