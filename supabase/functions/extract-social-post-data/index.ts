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

    const systemPrompt = `Você é um assistente especializado em extrair informações de legendas de posts de redes sociais (Instagram, Facebook, TikTok) para um CRM jurídico de acidentes de trabalho.
Analise a legenda fornecida e extraia todas as informações relevantes para criar um registro no CRM.

Retorne APENAS um JSON válido com os campos abaixo. Se não encontrar a informação, use null.

{
  "nome": "Nome completo da pessoa / lead (se mencionado)",
  "telefone": "Telefone (com DDD se disponível)",
  "email": "Email se mencionado",
  "cpf": "CPF se mencionado",
  "cidade": "Cidade onde ocorreu o acidente (nome da cidade, sem estado)",
  "estado": "Estado/UF (sigla de 2 letras, ex: MG, SP, RJ)",
  "regiao": "Região/bairro/distrito dentro da cidade (se mencionado)",
  "profissao": "Profissão ou área de atuação",
  "interesse": "O que a pessoa busca ou precisa (produto/serviço)",
  "contexto": "Resumo breve do contexto da postagem",
  "tags": ["palavras-chave relevantes"],
  "urgencia": "alta/media/baixa baseado no tom da mensagem",
  "tipo_caso": "OBRIGATÓRIO: deve ser exatamente um destes valores: Queda de Altura, Soterramento, Choque Elétrico, Acidente com Máquinas, Intoxicação, Explosão, Incêndio, Acidente de Trânsito, Esmagamento, Corte/Amputação, Afogamento, Outro",
  "observacoes": "Qualquer informação adicional relevante",
  "victim_name": "Nome da vítima do acidente (pode ser o mesmo do lead)",
  "victim_age": "Idade da vítima (apenas número)",
  "accident_date": "Data do acidente no formato DD/MM/AAAA",
  "accident_address": "Local/endereço onde ocorreu o acidente",
  "damage_description": "Descrição das lesões ou danos sofridos pela vítima",
  "contractor_company": "Empresa terceirizada (se mencionada)",
  "main_company": "Empresa principal / tomadora de serviços (se mencionada)",
  "sector": "Setor/área de trabalho"
}

IMPORTANTE:
- Extraia TUDO que for relevante, mesmo informações parciais
- Se a legenda mencionar acidentes de trabalho, doenças ocupacionais, benefícios do INSS, extraia dados da vítima, local, data e descrição do dano
- victim_name geralmente é a mesma pessoa do nome do lead
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
