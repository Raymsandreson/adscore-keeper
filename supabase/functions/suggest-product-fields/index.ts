import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { name, description, companies } = await req.json();

    if (!name?.trim()) {
      return new Response(JSON.stringify({ error: "Nome é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um consultor estratégico especializado em estruturação de grupos empresariais brasileiros.

Dado o nome e descrição de um produto/serviço, você deve sugerir o preenchimento correto dos campos:

- ticket_tier: "low" (entrada, geração de caixa rápida, até R$500), "medium" (crescimento, R$500-5000), "high" (premium, equity, acima de R$5000)
- product_type: "product" (produto digital/físico), "service" (serviço pontual), "subscription" (recorrência mensal), "consulting" (consultoria personalizada)
- strategy_focus: "cash" (foco em gerar caixa rápido), "equity" (construir valor/marca de longo prazo), "hybrid" (ambos)
- area: "marketing" (aquisição de clientes), "sales" (conversão/vendas), "product_engineering" (desenvolvimento de produto), "tax_planning" (planejamento tributário), "operations" (operações/backoffice)
- price_range_min e price_range_max: valores em reais sugeridos
- company_suggestion: qual tipo de empresa deveria vender este produto (se houver lista de empresas disponíveis, sugerir o ID)
- rationale: explicação breve de por que estas classificações são as mais adequadas

Empresas disponíveis: ${JSON.stringify(companies || [])}`;

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
          { role: "user", content: `Nome: ${name}\nDescrição: ${description || 'não informada'}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_fields",
            description: "Retorna sugestões de preenchimento dos campos do produto/serviço",
            parameters: {
              type: "object",
              properties: {
                ticket_tier: { type: "string", enum: ["low", "medium", "high"] },
                product_type: { type: "string", enum: ["product", "service", "subscription", "consulting"] },
                strategy_focus: { type: "string", enum: ["cash", "equity", "hybrid"] },
                area: { type: "string", enum: ["marketing", "sales", "product_engineering", "tax_planning", "operations"] },
                price_range_min: { type: "number" },
                price_range_max: { type: "number" },
                company_id: { type: "string", description: "ID da empresa sugerida, se aplicável" },
                description_suggestion: { type: "string", description: "Sugestão de descrição se não foi informada" },
                rationale: { type: "string", description: "Explicação da classificação sugerida" },
              },
              required: ["ticket_tier", "product_type", "strategy_focus", "area", "rationale"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_fields" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];

    let suggestion;
    if (toolCall?.function?.arguments) {
      suggestion = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } else {
      throw new Error("No structured response from AI");
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
