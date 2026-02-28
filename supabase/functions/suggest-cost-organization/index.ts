import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch current data
    const [companiesRes, productsRes, costCentersRes, nucleiRes] = await Promise.all([
      supabase.from("companies").select("*").eq("is_active", true),
      supabase.from("products_services").select("*"),
      supabase.from("cost_centers").select("*"),
      supabase.from("specialized_nuclei").select("*").eq("is_active", true),
    ]);

    const companies = companiesRes.data || [];
    const products = productsRes.data || [];
    const costCenters = costCentersRes.data || [];
    const nuclei = nucleiRes.data || [];

    const { context } = await req.json();

    const systemPrompt = `Você é um consultor financeiro e estratégico especializado em estruturação de grupos empresariais brasileiros.

Sua missão é analisar a estrutura atual do grupo e sugerir a MELHOR organização de:
1. **Centros de Custo** - organizados por área (tributária, marketing/vendas, engenharia de produto, operações)
2. **Produtos/Serviços** - classificados por faixa de ticket (low=geração de caixa, medium=crescimento, high=equity/margem)
3. **Novos Núcleos Especializados** - áreas jurídicas que podem ser necessárias
4. **Novas Empresas** - se identificar oportunidades tributárias ou estratégicas

Considere sempre:
- Otimização tributária (Simples, Lucro Presumido, Lucro Real)
- Separação de atividades por CNAE para benefícios fiscais
- Construção de equity de longo prazo vs geração de caixa imediata
- Posicionamento de marca e marketing por faixa de ticket
- Engenharia de produto com foco em recorrência e escalabilidade

DADOS ATUAIS DO GRUPO:
Empresas: ${JSON.stringify(companies.map(c => ({ id: c.id, name: c.name, cnpj: c.cnpj, trading_name: c.trading_name })))}
Produtos/Serviços: ${JSON.stringify(products.map(p => ({ id: p.id, name: p.name, company_id: p.company_id, ticket_tier: p.ticket_tier, product_type: p.product_type, strategy_focus: p.strategy_focus })))}
Centros de Custo: ${JSON.stringify(costCenters.map(cc => ({ id: cc.id, name: cc.name, company_id: cc.company_id, area: cc.area, ticket_tier: cc.ticket_tier })))}
Núcleos: ${JSON.stringify(nuclei.map(n => ({ id: n.id, name: n.name, prefix: n.prefix })))}`;

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
          { role: "user", content: context || "Analise a estrutura atual e sugira a melhor organização completa para o grupo, com foco em otimização tributária, construção de equity e geração de caixa." },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_organization",
            description: "Retorna sugestões de organização financeira e estratégica do grupo",
            parameters: {
              type: "object",
              properties: {
                analysis: { type: "string", description: "Análise geral da estrutura atual e oportunidades" },
                suggested_products: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      company_name: { type: "string" },
                      name: { type: "string" },
                      description: { type: "string" },
                      ticket_tier: { type: "string", enum: ["low", "medium", "high"] },
                      product_type: { type: "string", enum: ["product", "service", "subscription", "consulting"] },
                      strategy_focus: { type: "string", enum: ["cash", "equity", "hybrid"] },
                      area: { type: "string", enum: ["marketing", "sales", "product_engineering", "tax_planning", "operations"] },
                      price_suggestion: { type: "string" },
                      rationale: { type: "string" },
                    },
                    required: ["company_name", "name", "ticket_tier", "strategy_focus", "rationale"],
                  },
                },
                suggested_cost_centers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      company_name: { type: "string" },
                      name: { type: "string" },
                      description: { type: "string" },
                      area: { type: "string" },
                      ticket_tier: { type: "string" },
                      strategy_focus: { type: "string" },
                      rationale: { type: "string" },
                    },
                    required: ["company_name", "name", "rationale"],
                  },
                },
                suggested_nuclei: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      prefix: { type: "string" },
                      description: { type: "string" },
                      rationale: { type: "string" },
                    },
                    required: ["name", "prefix", "rationale"],
                  },
                },
                suggested_companies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      purpose: { type: "string" },
                      tax_regime: { type: "string" },
                      rationale: { type: "string" },
                    },
                    required: ["name", "purpose", "rationale"],
                  },
                },
                equity_vs_cash_strategy: { type: "string", description: "Estratégia macro de equity vs caixa" },
                tax_optimization_tips: { type: "string", description: "Dicas de otimização tributária" },
              },
              required: ["analysis", "suggested_products", "suggested_cost_centers"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_organization" } },
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
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    
    let suggestions;
    if (toolCall?.function?.arguments) {
      suggestions = typeof toolCall.function.arguments === "string" 
        ? JSON.parse(toolCall.function.arguments) 
        : toolCall.function.arguments;
    } else {
      throw new Error("No structured response from AI");
    }

    return new Response(JSON.stringify({ suggestions, current: { companies, products, costCenters, nuclei } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
