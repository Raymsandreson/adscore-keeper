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
    const { contacts, postUrl, postCaption, leadContext, customPrompt } = await req.json();

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Nenhum contato fornecido" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "AI API key not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const defaultPrompt = `Você está escrevendo como uma PESSOA COMUM, alguém da rede social que viu o post e ficou tocada pela história. Você NÃO representa escritório, empresa, instituição ou serviço. Fale como alguém que poderia ser amiga de amiga, conhecida de bairro, alguém que cruzou com a família em algum momento — sem afirmar nada específico que possa ser desmentido. Tom acolhedor, próximo, humano, como se mandasse mensagem para alguém conhecido. NUNCA se identifique como representante, advogado, assessor, escritório, ONG, jornalista ou qualquer função profissional.`;

    const bridgePrompt = customPrompt?.trim() || defaultPrompt;

    const leadCtx = leadContext
      ? `\nCONTEXTO DO CASO:
- Vítima: ${leadContext.victim_name || 'Não identificada'}
- Tipo: ${leadContext.case_type || 'Acidente de trabalho'}
- Data: ${leadContext.accident_date || 'Não informada'}
- Empresa: ${leadContext.main_company || leadContext.contractor_company || 'Não informada'}
- Cidade/Estado: ${leadContext.city || ''}/${leadContext.state || ''}
- Descrição do dano: ${leadContext.damage_description || 'Não informada'}`
      : '';

    const contactsList = contacts.map((c: any, i: number) => 
      `${i + 1}. @${c.username?.replace('@', '') || 'usuario'} - Tipo: ${c.type || 'contato'} - Relação: ${c.relationship || 'desconhecida'} - Info: ${c.info || 'nenhuma'}`
    ).join('\n');

    const systemPrompt = `${bridgePrompt}

REGRAS:
1. Gere para CADA contato: um COMENTÁRIO PÚBLICO (máx 200 chars) e uma DM (máx 400 chars)
2. O comentário deve ser natural, empático, e estimular resposta
3. A DM deve ser mais pessoal, se apresentar como representante de um escritório, demonstrar solidariedade
4. NUNCA use @ antes do nome no texto da mensagem
5. Use português brasileiro natural e informal
6. Use 1-2 emojis por mensagem
7. Personalize baseado na relação da pessoa (familiar, amigo, testemunha, colega)
8. Para FAMILIARES: foco em solidariedade e apoio emocional
9. Para TESTEMUNHAS: foco em importância do relato e proteção de direitos
10. Para AMIGOS/COLEGAS: foco em como podem ajudar a família
11. FINALIZE o comentário com pergunta ou menção ao direct
12. Na DM, convide para conversa privada sobre direitos da vítima
${leadCtx}

POST: ${postUrl || 'Publicação sobre acidente de trabalho'}
${postCaption ? `LEGENDA: ${postCaption.substring(0, 500)}` : ''}

CONTATOS PARA GERAR MENSAGENS:
${contactsList}

Retorne SOMENTE um JSON válido:
{
  "replies": [
    {
      "username": "@usuario",
      "comment": "texto do comentário público",
      "dm": "texto da mensagem direta",
      "comment_alternatives": ["alternativa 1", "alternativa 2"],
      "dm_alternatives": ["alternativa DM 1"]
    }
  ]
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Gere as mensagens personalizadas para cada contato listado." },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI API error:", errText);
      throw new Error("Falha na geração de mensagens pela IA");
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "{}";

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = { replies: [] };
    }

    console.log(`✅ Generated replies for ${result.replies?.length || 0} contacts`);

    return new Response(
      JSON.stringify({ success: true, replies: result.replies || [] }),
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
