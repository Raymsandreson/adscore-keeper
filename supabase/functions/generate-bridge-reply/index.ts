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

REGRAS DE GERAÇÃO:
1. Para CADA contato, gere: um COMENTÁRIO PÚBLICO (máx 200 chars) e uma DM (máx 400 chars).
2. **TOM EM AMBOS (comentário e DM)**: pessoal, próximo, como conhecida da pessoa. Sem se identificar de onde é, sem citar escritório, advogado, assessor, instituição, ONG, jornalista, projeto ou qualquer função profissional.
3. Escreva como se fosse alguém da mesma cidade/região, ou alguém que conhece "de longe" alguém da família — sem inventar vínculo específico que possa ser checado. Frases tipo "fiquei sabendo aqui...", "vi por aqui e meu coração apertou", "acompanho de longe" funcionam bem.
4. NUNCA prometa ajuda jurídica, indenização, processo, direitos, benefício. NUNCA ofereça serviço.
5. NUNCA use @ antes do nome no texto.
6. Português brasileiro coloquial, natural. 1-2 emojis no máximo (❤️ 🙏 🌹 funcionam).
7. Personalize pela relação:
   - FAMILIAR: solidariedade pura, "tô orando", "se precisar desabafar tô aqui".
   - AMIGO/COLEGA: "tava sabendo, que coisa triste", oferecer escuta.
   - TESTEMUNHA: empatia pelo baque de ter visto, sem pedir relato direto no comentário público.
8. O comentário deve estimular resposta natural (uma pergunta leve ou abertura), SEM mencionar "manda direct" de forma comercial — pode ser "te mandei msg" ou nada.
9. A DM continua o tom íntimo: chega como mensagem de alguém que se importou, oferece presença ("se quiser conversar, conta comigo"), sem revelar agenda profissional.
10. Comentário e DM devem soar como vindos da MESMA pessoa, coerentes em vocabulário.
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
      "comment": "texto do comentário público (tom de conhecida)",
      "dm": "texto da DM (tom de conhecida, sem se identificar)",
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
