import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { postUrl, caption, targetType } = await req.json();

    if (!caption || !caption.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "Legenda vazia - não há dados para extrair" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "AI API key not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const systemPrompt = `Você é um assistente especializado em extrair informações de legendas de posts de redes sociais (Instagram, Facebook, TikTok).
Analise a legenda fornecida e extraia todas as informações relevantes para criar um registro no CRM.

Retorne APENAS um JSON válido com os campos abaixo. Se não encontrar a informação, use null.

{
  "nome": "Nome completo da pessoa (se mencionado)",
  "telefone": "Telefone (com DDD se disponível)",
  "email": "Email se mencionado",
  "cpf": "CPF se mencionado",
  "cidade": "Cidade mencionada",
  "estado": "Estado/UF",
  "profissao": "Profissão ou área de atuação",
  "interesse": "O que a pessoa busca ou precisa (produto/serviço)",
  "contexto": "Resumo breve do contexto da postagem",
  "tags": ["palavras-chave relevantes"],
  "urgencia": "alta/media/baixa baseado no tom da mensagem",
  "tipo_caso": "Se parecer um caso jurídico, qual tipo (trabalhista, previdenciário, etc)",
  "observacoes": "Qualquer informação adicional relevante"
}

IMPORTANTE:
- Extraia TUDO que for relevante, mesmo informações parciais
- Se a legenda mencionar acidentes de trabalho, doenças ocupacionais, benefícios do INSS, etc., identifique como caso jurídico
- Identifique menções a localidades, profissões e situações
- Se houver hashtags relevantes, inclua nos tags`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Legenda do post (${postUrl || 'sem URL'}):\n\n${caption}` },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI API error:", errText);
      throw new Error("Falha na análise por IA");
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "{}";
    
    let extracted;
    try {
      extracted = JSON.parse(content);
    } catch {
      extracted = { contexto: content, observacoes: "Extração parcial" };
    }

    console.log("✅ Dados extraídos:", JSON.stringify(extracted).substring(0, 500));

    return new Response(
      JSON.stringify({ success: true, extracted, postUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
