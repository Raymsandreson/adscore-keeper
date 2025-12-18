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

    // Helper function to format targeting data
    const formatTargeting = (targeting: any) => {
      if (!targeting) return "Não disponível";
      
      const parts: string[] = [];
      
      if (targeting.age_min || targeting.age_max) {
        parts.push(`Idade: ${targeting.age_min || '18'}-${targeting.age_max || '65'}+ anos`);
      }
      
      if (targeting.genders) {
        const genderMap: Record<number, string> = { 0: 'Todos', 1: 'Masculino', 2: 'Feminino' };
        const genderNames = targeting.genders.map((g: number) => genderMap[g] || 'Desconhecido');
        parts.push(`Gênero: ${genderNames.join(', ')}`);
      }
      
      if (targeting.geo_locations?.countries) {
        parts.push(`Países: ${targeting.geo_locations.countries.join(', ')}`);
      }
      
      if (targeting.geo_locations?.cities?.length > 0) {
        const cities = targeting.geo_locations.cities.map((c: any) => c.name).slice(0, 5);
        parts.push(`Cidades: ${cities.join(', ')}`);
      }
      
      if (targeting.interests?.length > 0) {
        const interests = targeting.interests.map((i: any) => i.name).slice(0, 10);
        parts.push(`Interesses: ${interests.join(', ')}`);
      }
      
      if (targeting.behaviors?.length > 0) {
        const behaviors = targeting.behaviors.map((b: any) => b.name).slice(0, 5);
        parts.push(`Comportamentos: ${behaviors.join(', ')}`);
      }
      
      if (targeting.custom_audiences?.length > 0) {
        const audiences = targeting.custom_audiences.map((a: any) => a.name).slice(0, 3);
        parts.push(`Públicos Personalizados: ${audiences.join(', ')}`);
      }
      
      if (targeting.optimization_goal) {
        parts.push(`Objetivo de Otimização: ${targeting.optimization_goal}`);
      }
      
      return parts.length > 0 ? parts.join('\n   ') : "Segmentação básica";
    };

    // Helper function to format creative data
    const formatCreative = (creative: any) => {
      if (!creative) return "Não disponível";
      
      const parts: string[] = [];
      
      if (creative.title) {
        parts.push(`Título: "${creative.title}"`);
      }
      
      if (creative.body) {
        parts.push(`Texto principal: "${creative.body}"`);
      }
      
      if (creative.link_description) {
        parts.push(`Descrição do link: "${creative.link_description}"`);
      }
      
      if (creative.call_to_action_type) {
        parts.push(`CTA: ${creative.call_to_action_type}`);
      }
      
      if (creative.object_story_spec?.link_data?.message) {
        parts.push(`Mensagem: "${creative.object_story_spec.link_data.message}"`);
      }
      
      if (creative.object_story_spec?.video_data?.message) {
        parts.push(`Mensagem do vídeo: "${creative.object_story_spec.video_data.message}"`);
      }
      
      return parts.length > 0 ? parts.join('\n   ') : "Dados do criativo não disponíveis";
    };

    // Build enriched data section
    const targetingSection = campaignData?.targeting 
      ? `\n\n📎 SEGMENTAÇÃO ATUAL:\n   ${formatTargeting(campaignData.targeting)}`
      : '';
    
    const creativeSection = campaignData?.creative 
      ? `\n\n📝 COPY DO ANÚNCIO:\n   ${formatCreative(campaignData.creative)}`
      : '';
    
    const objectiveSection = campaignData?.objective 
      ? `\n\n🎯 OBJETIVO DA CAMPANHA: ${campaignData.objective}`
      : '';

    let systemPrompt = "";

    if (type === "questions") {
      systemPrompt = `Você é um especialista em marketing digital e tráfego pago, especialmente em Meta Ads (Facebook/Instagram).

Seu papel é fazer perguntas estratégicas sobre a campanha para entender melhor o contexto e dar sugestões personalizadas.

📊 DADOS DE PERFORMANCE:
- Nome: ${campaignData?.name || "Não informado"}
- Tipo: ${campaignData?.type || "Não informado"}
- Gasto: R$${campaignData?.spend?.toFixed(2) || "0"}
- CTR: ${campaignData?.ctr?.toFixed(2) || "0"}%
- CPC: R$${campaignData?.cpc?.toFixed(2) || "0"}
- Taxa de Conversão: ${campaignData?.conversionRate?.toFixed(2) || "0"}%
- Impressões: ${campaignData?.impressions || "0"}
- Cliques: ${campaignData?.clicks || "0"}${objectiveSection}${targetingSection}${creativeSection}

IMPORTANTE: Use os dados de segmentação e copy acima para fazer perguntas mais precisas e dar sugestões contextualizadas.

Faça perguntas relevantes sobre:
1. Se a segmentação atual faz sentido para o produto/serviço
2. Melhorias na copy baseadas no que já está rodando
3. O produto/serviço sendo promovido e seu diferencial
4. O ticket médio ou valor do lead
5. Públicos lookalike ou de remarketing que podem funcionar

Seja conversacional e faça 2-3 perguntas por vez. Mantenha respostas curtas e diretas.`;
    } else if (type === "copy_analysis") {
      systemPrompt = `Você é um copywriter expert e estrategista de tráfego pago especializado em Meta Ads.

📊 DADOS DA CAMPANHA:
- Nome: ${campaignData?.name || "Não informado"}
- CTR atual: ${campaignData?.ctr?.toFixed(2) || "0"}%
- Taxa de Conversão: ${campaignData?.conversionRate?.toFixed(2) || "0"}%${objectiveSection}${targetingSection}

COPY ATUAL DO ANÚNCIO:
${campaignData?.creative ? formatCreative(campaignData.creative) : "O usuário vai fornecer a copy abaixo."}

Analise a copy fornecida e dê sugestões específicas sobre:

1. **GANCHOS (Hooks)**: Sugira 3-5 ganchos alternativos para o início do anúncio que prendam atenção nos primeiros 3 segundos.

2. **SEGMENTAÇÃO**: Com base na copy E na segmentação atual, sugira:
   - Novos interesses para testar
   - Comportamentos do público
   - Ajustes de faixa etária se necessário
   - Públicos personalizados que poderiam funcionar

3. **MELHORIAS NA COPY**: 
   - Pontos fortes da copy atual
   - Pontos fracos a melhorar
   - CTAs mais efetivos
   - Elementos de urgência/escassez

Seja específico e prático nas sugestões. Use emojis para organizar visualmente.`;
    } else {
      systemPrompt = `Você é um consultor expert em Meta Ads (Facebook/Instagram Ads) e marketing digital.

📊 DADOS DE PERFORMANCE:
- Nome: ${campaignData?.name || "Não informado"}
- Tipo: ${campaignData?.type || "Não informado"}
- Gasto: R$${campaignData?.spend?.toFixed(2) || "0"}
- CTR: ${campaignData?.ctr?.toFixed(2) || "0"}%
- CPC: R$${campaignData?.cpc?.toFixed(2) || "0"}
- Taxa de Conversão: ${campaignData?.conversionRate?.toFixed(2) || "0"}%
- Impressões: ${campaignData?.impressions || "0"}
- Cliques: ${campaignData?.clicks || "0"}${objectiveSection}${targetingSection}${creativeSection}

Com base nas informações fornecidas (incluindo segmentação e copy), dê conselhos práticos e acionáveis para melhorar a performance.
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
