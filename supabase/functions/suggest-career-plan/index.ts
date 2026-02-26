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

${promptText}

${existingPositions?.length ? `Existing positions: ${existingPositions.join(', ')}. Build upon these.` : ''}

Return a JSON response using the suggest_career_plan function with:
- positions: array of 4-6 positions from junior to senior, each with name (in Portuguese), description (in Portuguese), level (1-5), suggested color hex
- steps: array of progression steps between positions, each with from_index (null for entry), to_index, requirements (in Portuguese), estimated_months

Base this on real US company structures and best practices. Use Portuguese for all text content.`;

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
            description: "Returns a structured career plan with positions and steps",
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
                    },
                    required: ["name", "description", "level", "color"],
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
