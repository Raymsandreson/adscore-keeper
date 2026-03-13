import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

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

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Comentário de @${authorUsername}:\n"${commentText}"` }
      ],
      temperature: 0.1,
    });

    const content = result.choices?.[0]?.message?.content || "";
    
    let locationData = { city: null, state: null, confidence: null, extractedFrom: null };
    try {
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        locationData = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse location response:", parseError);
    }

    return new Response(
      JSON.stringify({ success: true, location: locationData }),
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
