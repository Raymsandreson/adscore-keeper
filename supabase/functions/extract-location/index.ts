import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { commentText, authorUsername } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `Você é um analisador de texto que extrai informações de localização de comentários do Instagram.

TAREFA: Analisar o texto do comentário e extrair cidade e/ou estado brasileiro mencionado.

REGRAS:
1. Procure por menções diretas de cidades ou estados brasileiros
2. Considere variações como "sou de X", "moro em X", "aqui em X", "cidade de X"
3. Identifique siglas de estados (SP, RJ, PI, etc.)
4. Retorne null se não encontrar nenhuma localização
5. Se encontrar apenas cidade, tente inferir o estado se for uma cidade conhecida
6. Se encontrar apenas estado, deixe cidade como null

FORMATO DE RESPOSTA (JSON apenas):
{
  "city": "nome da cidade ou null",
  "state": "sigla do estado (2 letras) ou null",
  "confidence": "high" | "medium" | "low",
  "extractedFrom": "trecho do texto onde encontrou a informação"
}

EXEMPLOS:
- "sou de Piripiri-PI" → {"city": "Piripiri", "state": "PI", "confidence": "high", "extractedFrom": "Piripiri-PI"}
- "moro aqui em São Paulo" → {"city": "São Paulo", "state": "SP", "confidence": "high", "extractedFrom": "São Paulo"}
- "tragédia aqui no Ceará" → {"city": null, "state": "CE", "confidence": "medium", "extractedFrom": "Ceará"}
- "meus sentimentos" → {"city": null, "state": null, "confidence": null, "extractedFrom": null}`;

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
          { role: "user", content: `Comentário de @${authorUsername}:\n"${commentText}"` }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse the JSON response
    let locationData = { city: null, state: null, confidence: null, extractedFrom: null };
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        locationData = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse location response:", parseError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        location: locationData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Extract location error:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
