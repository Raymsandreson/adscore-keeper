import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { context, references, previousSuggestions, refinement } = await req.json();

    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const [companiesRes, productsRes, costCentersRes, nucleiRes] = await Promise.all([
      supabase.from("companies").select("id,name,cnpj,trading_name").eq("is_active", true).order("display_order", { ascending: true }).limit(30),
      supabase.from("products_services").select("id,name,company_id,ticket_tier,product_type,strategy_focus,area").order("created_at", { ascending: false }).limit(120),
      supabase.from("cost_centers").select("id,name,company_id,area,ticket_tier,strategy_focus").order("created_at", { ascending: false }).limit(120),
      supabase.from("specialized_nuclei").select("id,name,prefix").eq("is_active", true).order("name", { ascending: true }).limit(40),
    ]);

    const companies = companiesRes.data || [];
    const products = productsRes.data || [];
    const costCenters = costCentersRes.data || [];
    const nuclei = nucleiRes.data || [];

    const productsByCompany = companies.map((company) => ({
      company_id: company.id, company_name: company.name,
      products: products.filter((p) => p.company_id === company.id).slice(0, 12).map((p) => ({ name: p.name, ticket_tier: p.ticket_tier, strategy_focus: p.strategy_focus, product_type: p.product_type, area: p.area })),
    }));

    const costCentersByCompany = companies.map((company) => ({
      company_id: company.id, company_name: company.name,
      cost_centers: costCenters.filter((cc) => cc.company_id === company.id).slice(0, 20).map((cc) => ({ name: cc.name, area: cc.area, ticket_tier: cc.ticket_tier, strategy_focus: cc.strategy_focus })),
    }));

    const compactContext = { companies, products_total: products.length, cost_centers_total: costCenters.length, nuclei, products_by_company: productsByCompany, cost_centers_by_company: costCentersByCompany };

    const referencesBlock = references
      ? `\n\nREFERÊNCIAS DE EMPRESÁRIOS/EMPRESAS INFORMADAS PELO USUÁRIO:\n${references}\nUse esses modelos de negócios como inspiração nas sugestões.`
      : `\n\nSUGIRA TAMBÉM referências de empresários e empresas brasileiras conhecidas cujos modelos de negócio podem inspirar a estruturação do grupo.`;

    const refinementBlock = previousSuggestions && refinement
      ? `\n\nSUGESTÕES ANTERIORES:\n${JSON.stringify(previousSuggestions)}\n\nINSTRUÇÃO DE REFINAMENTO:\n${refinement}\n\nAplique as alterações solicitadas.`
      : '';

    const systemPrompt = `Você é um advogado tributarista e consultor financeiro-estratégico especializado em estruturação de grupos empresariais brasileiros.

Sua missão é analisar a estrutura atual e sugerir a MELHOR organização de:
1. Centros de Custo 2. Produtos/Serviços 3. Novos Núcleos Especializados 4. Novas Empresas 5. Estrutura de Holdings

Considere planejamento tributário, preservação patrimonial, construção de equity e geração de caixa.${referencesBlock}${refinementBlock}

DADOS ATUAIS DO GRUPO:
${JSON.stringify(compactContext)}`;

    const data = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: context || "Analise a estrutura atual e sugira a melhor organização completa para o grupo." },
      ],
      tools: [{
        type: "function",
        function: {
          name: "suggest_organization",
          description: "Retorna sugestões de organização financeira e estratégica do grupo",
          parameters: {
            type: "object",
            properties: {
              analysis: { type: "string" },
              suggested_products: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    company_name: { type: "string" }, name: { type: "string" }, description: { type: "string" },
                    ticket_tier: { type: "string", enum: ["low", "medium", "high"] },
                    product_type: { type: "string", enum: ["product", "service", "subscription", "consulting"] },
                    strategy_focus: { type: "string", enum: ["cash", "equity", "hybrid"] },
                    area: { type: "string", enum: ["marketing", "sales", "product_engineering", "tax_planning", "operations"] },
                    price_suggestion: { type: "string" }, rationale: { type: "string" },
                  },
                  required: ["company_name", "name", "ticket_tier", "strategy_focus", "rationale"],
                },
              },
              suggested_cost_centers: {
                type: "array",
                items: {
                  type: "object",
                  properties: { company_name: { type: "string" }, name: { type: "string" }, description: { type: "string" }, area: { type: "string" }, ticket_tier: { type: "string" }, strategy_focus: { type: "string" }, rationale: { type: "string" } },
                  required: ["company_name", "name", "rationale"],
                },
              },
              suggested_nuclei: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, prefix: { type: "string" }, description: { type: "string" }, rationale: { type: "string" } },
                  required: ["name", "prefix", "rationale"],
                },
              },
              suggested_companies: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, purpose: { type: "string" }, tax_regime: { type: "string" }, rationale: { type: "string" } },
                  required: ["name", "purpose", "rationale"],
                },
              },
              equity_vs_cash_strategy: { type: "string" },
              tax_optimization_tips: { type: "string" },
              asset_preservation_strategy: { type: "string" },
            },
            required: ["analysis", "suggested_products", "suggested_cost_centers", "tax_optimization_tips", "asset_preservation_strategy"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "suggest_organization" } },
    });

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No structured response from AI");

    const suggestions = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    return new Response(JSON.stringify({ suggestions, current: { companies, products, costCenters, nuclei } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
    const message = isTimeout ? "A IA demorou mais que o esperado." : e.message || "Unknown error";
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    console.error("Error:", e);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
