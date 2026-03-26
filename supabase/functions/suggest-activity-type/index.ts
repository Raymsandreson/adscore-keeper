import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: types } = await sb.from("activity_types").select("key, label, description").eq("is_active", true).order("display_order");
    const typesList = (types || []).map((t: any) => {
      let line = `- "${t.key}" = ${t.label}`;
      if (t.description) line += ` — ${t.description}`;
      return line;
    }).join("\n");

    const result = await geminiChat({
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
    });

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    let suggestedType: string | null = null;

    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        suggestedType = args.activity_type_key || null;
      } catch {
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
