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
    const { messages, campaignData, type } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    let systemPrompt = "";

    if (type === "questions") {
      systemPrompt = `Você é um especialista em marketing digital e tráfego pago, especialmente em Meta Ads (Facebook/Instagram).

Seu papel é fazer perguntas estratégicas sobre a campanha para entender melhor o contexto e dar sugestões personalizadas.

Dados da campanha/criativo:
- Nome: ${campaignData?.name || "Não informado"}
- Tipo: ${campaignData?.type || "Não informado"}
- Gasto: R$${campaignData?.spend?.toFixed(2) || "0"}
- CTR: ${campaignData?.ctr?.toFixed(2) || "0"}%
- CPC: R$${campaignData?.cpc?.toFixed(2) || "0"}
- Taxa de Conversão: ${campaignData?.conversionRate?.toFixed(2) || "0"}%
- Impressões: ${campaignData?.impressions || "0"}
- Cliques: ${campaignData?.clicks || "0"}

Faça perguntas relevantes sobre:
1. O público-alvo e segmentação atual
2. O objetivo da campanha (vendas, leads, engajamento)
3. O produto/serviço sendo promovido
4. O diferencial competitivo
5. O ticket médio ou valor do lead

Seja conversacional e faça 2-3 perguntas por vez. Mantenha respostas curtas e diretas.`;
    } else if (type === "copy_analysis") {
      systemPrompt = `Você é um copywriter expert e estrategista de tráfego pago especializado em Meta Ads.

Analise a copy fornecida e dê sugestões específicas sobre:

1. **GANCHOS (Hooks)**: Sugira 3-5 ganchos alternativos para o início do anúncio que prendam atenção nos primeiros 3 segundos.

2. **SEGMENTAÇÃO**: Com base na copy, sugira:
   - Interesses para segmentar no Facebook Ads
   - Comportamentos do público
   - Faixa etária ideal
   - Localização se aplicável
   - Públicos personalizados que poderiam funcionar

3. **MELHORIAS NA COPY**: 
   - Pontos fortes da copy atual
   - Pontos fracos a melhorar
   - CTAs mais efetivos
   - Elementos de urgência/escassez

Dados da campanha:
- Nome: ${campaignData?.name || "Não informado"}
- CTR atual: ${campaignData?.ctr?.toFixed(2) || "0"}%
- Taxa de Conversão: ${campaignData?.conversionRate?.toFixed(2) || "0"}%

Seja específico e prático nas sugestões. Use emojis para organizar visualmente.`;
    } else {
      systemPrompt = `Você é um consultor expert em Meta Ads (Facebook/Instagram Ads) e marketing digital.

Dados da campanha/criativo:
- Nome: ${campaignData?.name || "Não informado"}
- Tipo: ${campaignData?.type || "Não informado"}
- Gasto: R$${campaignData?.spend?.toFixed(2) || "0"}
- CTR: ${campaignData?.ctr?.toFixed(2) || "0"}%
- CPC: R$${campaignData?.cpc?.toFixed(2) || "0"}
- Taxa de Conversão: ${campaignData?.conversionRate?.toFixed(2) || "0"}%
- Impressões: ${campaignData?.impressions || "0"}
- Cliques: ${campaignData?.clicks || "0"}

Com base nas informações fornecidas, dê conselhos práticos e acionáveis para melhorar a performance.
Seja específico, use dados quando possível, e foque no que pode ser implementado imediatamente.
Mantenha respostas concisas e bem organizadas.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos na sua conta Lovable." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Erro ao conectar com a IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Campaign AI assistant error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
