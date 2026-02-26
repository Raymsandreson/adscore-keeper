import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { careerName, department, existingPositions, userPrompt, editMode, currentStructure } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let promptText: string;

    if (editMode && currentStructure) {
      // Edit mode: AI receives the full current structure and an edit instruction
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

1. JÚNIOR (Jr):
   - Executa tarefas sob supervisão direta
   - Precisa de orientação frequente
   - Foco em aprender processos, ferramentas e metodologias
   - Critérios para subir: Demonstrar autonomia em tarefas rotineiras, dominar as ferramentas essenciais, entregar com qualidade e prazo

2. PLENO (Pl):
   - Executa com autonomia tarefas de complexidade média
   - Resolve problemas sem precisar de orientação constante
   - Começa a influenciar decisões técnicas
   - Critérios para subir: Resolver problemas complexos de forma independente, mentorar juniores, propor melhorias de processo, ter visão sistêmica

3. SÊNIOR (Sr):
   - Referência técnica na equipe
   - Resolve os problemas mais complexos
   - Mentora plenos e juniores
   - Influencia decisões estratégicas técnicas
   - Critérios para subir: Impacto cross-funcional, liderança técnica sem autoridade formal, inovação, contribuição para cultura organizacional

4. ESPECIALISTA / PRINCIPAL (opcional, para tracks mais avançados):
   - Referência técnica em toda a organização
   - Define padrões e melhores práticas
   - Pode ganhar equivalente a um Gerente/Diretor

5. DISTINGUISHED (topo do IC track):
   - Reconhecido no mercado como autoridade
   - Ganha equivalente a um Diretor
   - Impacto estratégico na organização inteira

Para cada cargo técnico, DETALHE os critérios específicos para transição entre subníveis (Jr → Pl → Sr), incluindo competências técnicas, comportamentais e entregas esperadas.

===== PRINCÍPIOS GERAIS =====

1. DUAL TRACK CAREER (Carreira em Y): Sempre criar DOIS tracks paralelos:
   - IC track com subníveis: Júnior → Pleno → Sênior → Principal → Distinguished
   - Management track baseado no Pipeline de Liderança: Coordenador → Gerente → Diretor → VP
   O IC track deve ir ATÉ O TOPO, com "Distinguished" ganhando equivalente a um Diretor.

2. PROMOÇÃO PARA GESTÃO BASEADA EM COMPETÊNCIAS DE GESTÃO:
   - Antes de promover para gestão, a pessoa deve demonstrar:
     - Consegue dar feedback difícil?
     - Consegue recrutar/entrevistar bem?
     - Gosta de desenvolver pessoas?
   - Se não, crescer no track IC.

3. DEMOÇÃO SEM ESTIGMA:
   - Se alguém foi promovido para gestão e não funcionou, pode voltar ao IC SEM perder salário.

4. OTE (On-Target Earnings):
   - Para CADA cargo, sugerir salary_fixed (base) e salary_variable (comissão/bônus a 100% da meta).
   - Usar valores em BRL realistas para o mercado brasileiro.
   - Níveis IC sênior devem ganhar comparável aos níveis de gestão equivalentes.
   - Componente variável maior para cargos comerciais, menor para técnicos/jurídicos.

${promptText}

${!editMode && existingPositions?.length ? `Existing positions: ${existingPositions.join(', ')}. Build upon these.` : ''}

Return a JSON response using the suggest_career_plan function with:
- positions: array of 5-8 positions covering BOTH IC and management tracks, each with:
  - name (in Portuguese)
  - description (in Portuguese, include key responsibilities and promotion criteria)
  - level (1-5)
  - color (hex)
  - track_type: "ic" or "management"
  - salary_fixed: monthly base salary in BRL (number)
  - salary_variable: monthly variable/commission at target in BRL (number)
  - allows_demotion: boolean (true for management positions)
  - demotion_note: string explaining demotion path if applicable (in Portuguese)
- steps: array of progression steps between positions, each with from_index (null for entry), to_index, requirements (in Portuguese, be specific about metrics and competencies), estimated_months

Base this on real US company structures adapted for Brazilian market. Use Portuguese for all text content.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
                      from_index: { type: ["number", "null"] },
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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-career-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
