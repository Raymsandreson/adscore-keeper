import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { careerName, department, existingPositions, userPrompt } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const promptText = userPrompt 
      ? `The user described: "${userPrompt}". Create a complete career plan based on this description.`
      : `Based on the career path "${careerName}" ${department ? `in the "${department}" department` : ''}, generate a structured career plan with job positions and progression steps.`;

    const prompt = `You are an expert HR consultant specializing in organizational design based on US best practices from companies like Google, Amazon, Salesforce, HubSpot, and other top US companies.

CRITICAL PRINCIPLES TO FOLLOW (based on Tallis Gomes / modern US practices):

1. DUAL TRACK CAREER: Always create TWO parallel tracks:
   - IC (Individual Contributor) track: Júnior → Pleno → Sênior → Principal → Distinguished
   - Management track: Coordenador → Gerente → Diretor → VP
   The IC track must go ALL THE WAY to the top, with "Distinguished" level earning the same as a Director.

2. PROMOTE TO MANAGEMENT BASED ON MANAGEMENT SKILLS, NOT EXECUTION:
   - Before promoting someone to management, they must demonstrate:
     - Consegue dar feedback difícil?
     - Consegue recrutar/entrevistar bem?
     - Gosta de desenvolver pessoas?
   - If not, DO NOT promote to management — grow them in the IC track instead.

3. ALLOW DEMOTION WITHOUT STIGMA:
   - If someone was promoted to management and it didn't work out, they should be able to return to their IC role WITHOUT losing salary or status.
   - Example: "Tentamos gestão, não é sua praia, volta pra IC sênior."

4. OTE (On-Target Earnings) COMPENSATION:
   - For EACH position, suggest realistic salary_fixed (base salary) and salary_variable (commission/bonus at 100% target).
   - OTE = fixed + variable
   - Use Brazilian Real (BRL) values that are realistic for the market.
   - IC senior levels should earn comparable to management levels (Distinguished Seller = Diretor Comercial salary).
   - Variable component should be higher percentage for sales/commercial roles, lower for technical/legal.

${promptText}

${existingPositions?.length ? `Existing positions: ${existingPositions.join(', ')}. Build upon these.` : ''}

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
