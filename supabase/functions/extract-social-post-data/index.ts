import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
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

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "GOOGLE_AI_API_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }


    // O alvo escolhido no dialog muda o que precisa ser extraído. Antes o
    // targetType chegava aqui e era ignorado: todo post era analisado como
    // lead de acidente, mesmo quando o usuário pediu contato ou atividade.
    const target = ["lead", "contact", "activity"].includes(targetType) ? targetType : "lead";

    const contactPrompt = `Você é um assistente que extrai dados de PESSOAS a partir de legendas de posts de redes sociais (Instagram, Facebook, TikTok), para cadastro na agenda de contatos de um escritório de advocacia.

Retorne APENAS um JSON válido com os campos abaixo. Se não encontrar a informação, use null.

{
  "nome": "Nome completo da pessoa (autor do post, pessoa citada ou perfil mencionado)",
  "telefone": "Telefone com DDD, se aparecer",
  "email": "Email, se aparecer",
  "cpf": "CPF, se aparecer",
  "cidade": "Cidade da pessoa",
  "estado": "UF (sigla de 2 letras)",
  "regiao": "Bairro/região, se mencionado",
  "profissao": "Profissão, cargo ou área de atuação",
  "instagram_username": "@usuário mencionado, sem o @",
  "interesse": "O que a pessoa busca ou oferece",
  "contexto": "Resumo breve de quem é essa pessoa e por que virou contato",
  "observacoes": "Qualquer informação adicional útil (relação com casos, indicações)",
  "tags": ["palavras-chave relevantes"]
}

IMPORTANTE:
- Foco é a PESSOA, não o caso jurídico. Não invente dados de acidente.
- Se a legenda não identificar nenhuma pessoa, devolva "nome": null e descreva no contexto.
- Não invente nome, telefone ou email: só extraia o que está escrito.`;

    const activityPrompt = `Você é um assistente que transforma legendas de posts de redes sociais (Instagram, Facebook, TikTok) em TAREFAS para a equipe de um escritório de advocacia (marketing jurídico + captação).

Retorne APENAS um JSON válido com os campos abaixo. Se não encontrar a informação, use null.

{
  "titulo": "Título curto e imperativo do que precisa ser feito (máx. 100 caracteres, comece com verbo)",
  "descricao": "Resumo do conteúdo do post e o que a equipe deve fazer com ele",
  "prioridade": "baixa, normal, alta ou urgente",
  "prazo_sugerido": "Data sugerida no formato DD/MM/AAAA, se o post indicar prazo/evento. Senão null",
  "contexto": "Assunto do post em uma frase",
  "observacoes": "Pontos de atenção",
  "tags": ["palavras-chave relevantes"]
}

IMPORTANTE:
- O título é o que a pessoa vai ler na lista de atividades: precisa dizer a AÇÃO, não repetir a legenda inteira.
- Post informativo/educativo (tese, decisão, tema de tribunal) normalmente vira tarefa de estudo, conteúdo ou divulgação.
- Post sobre acidente ou vítima normalmente vira tarefa de apuração/contato.
- prioridade "urgente" só quando a legenda indicar prazo curto ou risco real.
- Não invente prazo: se o post não sugerir data, devolva null.`;

    const leadPrompt = `Você é um assistente especializado em extrair informações de legendas de posts de redes sociais (Instagram, Facebook, TikTok) para um CRM jurídico de acidentes de trabalho.
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
  "victim_name": "Nome da vítima PRINCIPAL do acidente",
  "victim_age": "Idade da vítima (apenas número)",
  "accident_date": "Data do acidente no formato DD/MM/AAAA",
  "accident_address": "Local/endereço onde ocorreu o acidente",
  "damage_description": "Descrição das lesões ou danos sofridos pela vítima",
  "contractor_company": "Empresa terceirizada (se mencionada)",
  "main_company": "Empresa principal / tomadora de serviços (se mencionada)",
  "sector": "Setor/área de trabalho",
  "additional_victims": [
    {
      "victim_name": "Nome de outra vítima",
      "victim_age": "Idade",
      "damage_description": "Lesões específicas desta vítima"
    }
  ]
}

IMPORTANTE:
- Extraia TUDO que for relevante, mesmo informações parciais
- Se a legenda mencionar acidentes de trabalho, doenças ocupacionais, benefícios do INSS, extraia dados da vítima, local, data e descrição do dano
- victim_name geralmente é a mesma pessoa do nome do lead
- Se houver MAIS DE UMA vítima mencionada, coloque a principal em victim_name e as demais no array additional_victims
- Identifique menções a localidades, profissões e situações
- Se houver hashtags relevantes, inclua nos tags`;

    const systemPrompt = target === "contact"
      ? contactPrompt
      : target === "activity"
        ? activityPrompt
        : leadPrompt;

    console.log(`🎯 Alvo da extração: ${target}`);

    let aiData: any;
    try {
      aiData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt + "\n\nIMPORTANTE: Responda APENAS com JSON válido, sem markdown." },
          { role: "user", content: `Legenda do post (${postUrl || 'sem URL'}):\n\n${caption}` },
        ],
        temperature: 0.2,
      });
    } catch (e: any) {
      console.error("Gemini error:", e);
      throw new Error("Falha na análise por IA");
    }

    let content = aiData.choices?.[0]?.message?.content || "{}";
    content = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    
    let extracted;
    try {
      extracted = JSON.parse(content);
    } catch {
      extracted = { contexto: content, observacoes: "Extração parcial" };
    }

    console.log("✅ Dados extraídos:", JSON.stringify(extracted).substring(0, 500));

    return new Response(
      JSON.stringify({ success: true, extracted, postUrl, targetType: target }),
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
