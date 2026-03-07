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

    const { context, references, previousSuggestions, refinement } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch only the essential columns and cap rows to keep the AI request fast
    const [companiesRes, productsRes, costCentersRes, nucleiRes] = await Promise.all([
      supabase
        .from("companies")
        .select("id,name,cnpj,trading_name")
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .limit(30),
      supabase
        .from("products_services")
        .select("id,name,company_id,ticket_tier,product_type,strategy_focus,area")
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("cost_centers")
        .select("id,name,company_id,area,ticket_tier,strategy_focus")
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("specialized_nuclei")
        .select("id,name,prefix")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(40),
    ]);

    const companies = companiesRes.data || [];
    const products = productsRes.data || [];
    const costCenters = costCentersRes.data || [];
    const nuclei = nucleiRes.data || [];

    const productsByCompany = companies.map((company) => ({
      company_id: company.id,
      company_name: company.name,
      products: products
        .filter((p) => p.company_id === company.id)
        .slice(0, 12)
        .map((p) => ({
          name: p.name,
          ticket_tier: p.ticket_tier,
          strategy_focus: p.strategy_focus,
          product_type: p.product_type,
          area: p.area,
        })),
    }));

    const costCentersByCompany = companies.map((company) => ({
      company_id: company.id,
      company_name: company.name,
      cost_centers: costCenters
        .filter((cc) => cc.company_id === company.id)
        .slice(0, 20)
        .map((cc) => ({
          name: cc.name,
          area: cc.area,
          ticket_tier: cc.ticket_tier,
          strategy_focus: cc.strategy_focus,
        })),
    }));

    const compactContext = {
      companies,
      products_total: products.length,
      cost_centers_total: costCenters.length,
      nuclei,
      products_by_company: productsByCompany,
      cost_centers_by_company: costCentersByCompany,
    };

    const referencesBlock = references
      ? `\n\nREFERÊNCIAS DE EMPRESÁRIOS/EMPRESAS INFORMADAS PELO USUÁRIO:\n${references}\nUse esses modelos de negócios como inspiração nas sugestões.`
      : `\n\nSUGIRA TAMBÉM referências de empresários e empresas brasileiras conhecidas (como XP, Stone, Nubank, Havan, G4 Educação, Empiricus, WiseUp, etc.) cujos modelos de negócio podem inspirar a estruturação do grupo. Explique brevemente por que cada referência é relevante.`;

    const refinementBlock = previousSuggestions && refinement
      ? `\n\nSUGESTÕES ANTERIORES (que o usuário quer refinar/alterar):\n${JSON.stringify(previousSuggestions)}\n\nINSTRUÇÃO DE REFINAMENTO DO USUÁRIO:\n${refinement}\n\nAplique as alterações solicitadas mantendo o que não foi mencionado. Retorne a estrutura COMPLETA atualizada.`
      : '';

    const systemPrompt = `Você é um advogado tributarista e consultor financeiro-estratégico especializado em estruturação de grupos empresariais brasileiros, planejamento tributário e preservação patrimonial.

Sua missão é analisar a estrutura atual do grupo e sugerir a MELHOR organização de:
1. **Centros de Custo** - organizados por área (tributária, marketing/vendas, engenharia de produto, operações)
2. **Produtos/Serviços** - classificados por faixa de ticket (low=geração de caixa, medium=crescimento, high=equity/margem)
3. **Novos Núcleos Especializados** - áreas jurídicas que podem ser necessárias
4. **Novas Empresas** - se identificar oportunidades tributárias ou estratégicas
5. **Estrutura de Holdings** - para preservação patrimonial e otimização fiscal

PRESERVAÇÃO PATRIMONIAL - HOLDINGS:
Sempre considere a criação e organização de holdings no planejamento:

- **Holding Patrimonial**: Empresa que detém bens imóveis, participações societárias e ativos financeiros do grupo. Foco em blindagem patrimonial, planejamento sucessório e redução de carga tributária sobre rendimentos de aluguéis e dividendos. Regime tributário ideal: Lucro Presumido (alíquota efetiva ~11-14% sobre receita de aluguéis vs até 27,5% na pessoa física).

- **Holding Operacional (Holding Pura)**: Empresa que detém participações em outras empresas operacionais do grupo. Centraliza o controle societário, facilita a gestão de dividendos entre empresas e permite planejamento tributário na distribuição de lucros. Avalie se o grupo necessita de uma holding pura para consolidar o controle acionário.

- **Holding Administrativa (Holding Mista)**: Empresa que, além de deter participações, presta serviços administrativos compartilhados (contabilidade, RH, TI, jurídico) para as empresas do grupo. Permite dedução de despesas operacionais e centraliza custos administrativos com rateio entre empresas.

Ao sugerir a estrutura, considere:
- Planejamento sucessório e proteção contra ações judiciais
- Economia tributária na transferência de bens entre PF e PJ
- Cláusulas de incomunicabilidade, inalienabilidade e impenhorabilidade
- Integralização de bens no capital social da holding pelo valor histórico (art. 23 da Lei 9.249/95)
- Elisão fiscal legítima vs evasão fiscal

PLANEJAMENTO TRIBUTÁRIO:
Você atua como advogado tributarista. Ao analisar e sugerir a estrutura, considere:
- Escolha de regime tributário ideal para cada empresa (Simples Nacional, Lucro Presumido, Lucro Real)
- Separação de atividades por CNAE para maximizar benefícios fiscais
- Aproveitamento de créditos de PIS/COFINS no Lucro Real
- Impacto do ISS vs ICMS conforme a natureza da atividade
- Planejamento de pró-labore vs distribuição de lucros
- Tributação de operações entre empresas do mesmo grupo (preços de transferência)
- Split de faturamento legítimo entre CNPJs para manter limites do Simples
- Incentivos fiscais regionais e setoriais aplicáveis

Considere também:
- Construção de equity de longo prazo vs geração de caixa imediata
- Posicionamento de marca e marketing por faixa de ticket
- Engenharia de produto com foco em recorrência e escalabilidade
- Referências de modelos de negócios de empresas e empresários de sucesso${referencesBlock}${refinementBlock}

DADOS ATUAIS DO GRUPO (resumidos para análise rápida):
${JSON.stringify(compactContext)}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
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
        return new Response(JSON.stringify({ success: false, error: "Limite de uso da IA atingido. Tente novamente em instantes." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ success: false, error: "Créditos de IA insuficientes no workspace." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      return new Response(JSON.stringify({ success: false, error: "Falha ao gerar sugestões de IA" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
    const message = isTimeout
      ? "A IA demorou mais que o esperado. Tente novamente com menos dados." 
      : e instanceof Error
      ? e.message
      : "Unknown error";

    console.error("Error:", e);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
