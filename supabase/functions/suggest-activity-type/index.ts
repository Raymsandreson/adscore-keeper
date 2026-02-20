import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { title } = await req.json();
    if (!title || title.trim().length < 3) {
      return new Response(JSON.stringify({ suggested_type: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch available activity types from DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: types } = await sb.from("activity_types").select("key, label").eq("is_active", true).order("display_order");
    const typesList = (types || []).map((t: any) => `- "${t.key}" = ${t.label}`).join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `Você é um classificador de atividades jurídicas/empresariais. Dado o assunto de uma atividade, retorne o tipo mais adequado.

Tipos disponíveis:
${typesList}

Responda APENAS com a key do tipo mais adequado, sem explicação.`,
          },
          { role: "user", content: title },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_activity",
              description: "Classifica o tipo de atividade baseado no assunto",
              parameters: {
                type: "object",
                properties: {
                  activity_type_key: {
                    type: "string",
                    description: "A key do tipo de atividade mais adequado",
                  },
                },
                required: ["activity_type_key"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_activity" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 402) {
        return new Response(JSON.stringify({ suggested_type: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    let suggestedType: string | null = null;

    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        suggestedType = args.activity_type_key || null;
      } catch {
        // Try plain text fallback
        const content = result.choices?.[0]?.message?.content?.trim();
        if (content) suggestedType = content;
      }
    }

    return new Response(JSON.stringify({ suggested_type: suggestedType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-activity-type error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", suggested_type: null }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
