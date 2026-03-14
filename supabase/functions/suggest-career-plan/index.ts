import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { careerName, department, existingPositions, userPrompt, editMode, currentStructure } = await req.json();

    let promptText: string;

    if (editMode && currentStructure) {
      promptText = `You are editing an EXISTING career plan called "${careerName}"${department ? ` in the "${department}" department` : ''}.

CURRENT STRUCTURE (positions and progression steps):
${JSON.stringify(currentStructure, null, 2)}

THE USER WANTS THE FOLLOWING CHANGES:
"${userPrompt}"

Analyze the current structure carefully and apply the requested changes. You may:
- Add new positions
- Modify existing position descriptions, salaries, levels, or tracks
- Remove positions
- Add, modify, or remove progression steps
- Restructure the entire plan if needed

Return the COMPLETE updated plan (not just the changes). All positions and steps should be included in the response, even unchanged ones.`;
    } else if (userPrompt) {
      promptText = `The user described: "${userPrompt}". Create a complete career plan based on this description.`;
    } else {
      promptText = `Based on the career path "${careerName}" ${department ? `in the "${department}" department` : ''}, generate a structured career plan with job positions and progression steps.`;
    }

    const prompt = `You are an expert HR consultant specializing in organizational design. You combine two key frameworks:

===== FRAMEWORK 1: PIPELINE DE LIDERANÇA (Ram Charan) — FOR MANAGEMENT TRACK =====

The management track MUST follow the 6 leadership passages from the book "Pipeline de Liderança" (The Leadership Pipeline by Ram Charan, Stephen Drotter, James Noel):

1. PASSAGEM 1 — De Gerenciar a Si Mesmo para Gerenciar Outros:
   - Transição de contribuidor individual para líder de primeira linha
   - Habilidades: planejamento, delegação, coaching, medição de resultados dos outros
   - Critério: Deixar de fazer o trabalho técnico pessoalmente e passar a obter resultados ATRAVÉS de outros

2. PASSAGEM 2 — De Gerenciar Outros para Gerenciar Gestores:
   - Selecionar e desenvolver líderes de primeira linha
   - Critério: Saber identificar e desenvolver talentos de liderança, não apenas talentos técnicos

3. PASSAGEM 3 — De Gerenciar Gestores para Gestor Funcional:
   - Gerenciar uma função completa (ex: toda a área jurídica, comercial, etc.)
   - Critério: Visão estratégica da função, integração com outras áreas, pensamento de longo prazo

4. PASSAGEM 4 — De Gestor Funcional para Gestor de Negócios:
   - Responsável pelo P&L de uma unidade de negócio
   - Critério: Equilibrar resultados de curto prazo com investimentos de longo prazo

5. PASSAGEM 5 — De Gestor de Negócios para Gestor de Grupo:
   - Gerenciar múltiplas unidades de negócio
   - Critério: Alocar capital e talento entre negócios, avaliar estratégia de portfólio

6. PASSAGEM 6 — De Gestor de Grupo para CEO/Gestor Corporativo:
   - Visão, valores, direção estratégica de toda a organização

Para cada cargo de gestão, EXPLICITE qual passagem do Pipeline de Liderança ele representa e quais são os critérios de transição específicos.

===== FRAMEWORK 2: SUBNÍVEIS DE SENIORIDADE — FOR TECHNICAL/IC TRACK =====

O track técnico (IC - Individual Contributor) DEVE ter subníveis claros de senioridade com critérios objetivos:

1. JÚNIOR (Jr): Executa tarefas sob supervisão direta
2. PLENO (Pl): Executa com autonomia tarefas de complexidade média
3. SÊNIOR (Sr): Referência técnica na equipe
4. ESPECIALISTA / PRINCIPAL: Referência técnica em toda a organização
5. DISTINGUISHED: Reconhecido no mercado como autoridade

===== PRINCÍPIOS GERAIS =====

1. DUAL TRACK CAREER (Carreira em Y): Sempre criar DOIS tracks paralelos
2. PROMOÇÃO PARA GESTÃO BASEADA EM COMPETÊNCIAS DE GESTÃO
3. DEMOÇÃO SEM ESTIGMA
4. OTE (On-Target Earnings): salary_fixed e salary_variable em BRL

${promptText}

${!editMode && existingPositions?.length ? `Existing positions: ${existingPositions.join(', ')}. Build upon these.` : ''}

Return a JSON response using the suggest_career_plan function with:
- positions: array of 5-8 positions covering BOTH IC and management tracks
- steps: array of progression steps between positions

Base this on real US company structures adapted for Brazilian market. Use Portuguese for all text content.`;

    const data = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "You are an expert HR consultant. Always respond using the provided function tool." },
        { role: "user", content: prompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "suggest_career_plan",
          description: "Returns a structured career plan with positions, OTE compensation, and steps",
          parameters: {
            type: "object",
            properties: {
              positions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    level: { type: "number" },
                    color: { type: "string" },
                    track_type: { type: "string", enum: ["ic", "management"] },
                    salary_fixed: { type: "number" },
                    salary_variable: { type: "number" },
                    allows_demotion: { type: "boolean" },
                    demotion_note: { type: "string" },
                  },
                  required: ["name", "description", "level", "color", "track_type", "salary_fixed", "salary_variable"],
                },
              },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    from_index: { type: "number" },
                    to_index: { type: "number" },
                    requirements: { type: "string" },
                    estimated_months: { type: "number" },
                  },
                  required: ["from_index", "to_index", "requirements", "estimated_months"],
                },
              },
            },
            required: ["positions", "steps"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "suggest_career_plan" } },
    });

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");
    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("suggest-career-plan error:", e);
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
