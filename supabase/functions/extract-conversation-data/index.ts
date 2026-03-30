import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { messages, targetType, customPrompt } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'No messages provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const conversationText = messages
      .map((m: any) => {
        const dir = m.direction === 'outbound' ? 'Atendente' : 'Cliente';
        return `[${dir}]: ${m.message_text || ''}`;
      })
      .join('\n');

    let schemaPrompt: string;

    if (targetType === 'contact') {
      schemaPrompt = `{
  "full_name": "nome completo da pessoa",
  "phone": "telefone adicional mencionado",
  "email": "e-mail mencionado",
  "city": "cidade",
  "state": "sigla do estado (ex: SP, RJ, MG)",
  "neighborhood": "bairro",
  "notes": "informações importantes resumidas da conversa",
  "instagram_url": "perfil do instagram se mencionado",
  "profession": "profissão mencionada"
}`;
    } else if (targetType === 'case') {
      schemaPrompt = `{
  "title": "título do caso jurídico (formato: Local/Vítima/Empresa)",
  "victim_name": "nome da vítima",
  "main_company": "empresa onde a vítima trabalha",
  "contractor_company": "empresa contratante/terceirizada",
  "damage_description": "descrição do dano/lesão",
  "accident_date": "data do acidente (formato YYYY-MM-DD se possível)",
  "accident_address": "endereço do acidente",
  "city": "cidade",
  "state": "sigla do estado",
  "sector": "setor/área de atuação",
  "case_number": "número do processo se mencionado",
  "case_type": "tipo do caso",
  "liability_type": "tipo de responsabilidade",
  "news_link": "link de notícia mencionado",
  "notes": "resumo das informações importantes",
  "processes": [
    {
      "title": "título do processo",
      "process_number": "número do processo",
      "process_type": "judicial ou administrativo",
      "description": "descrição breve"
    }
  ]
}

IMPORTANTE sobre "processes": Identifique TODOS os processos mencionados na conversa.`;
    } else {
      schemaPrompt = `{
  "lead_name": "nome do lead/caso",
  "victim_name": "nome da vítima",
  "lead_phone": "telefone principal",
  "lead_email": "e-mail",
  "city": "cidade",
  "state": "sigla do estado",
  "neighborhood": "bairro",
  "main_company": "empresa principal",
  "contractor_company": "empresa terceirizada",
  "accident_address": "endereço do acidente",
  "accident_date": "data do acidente (formato YYYY-MM-DD)",
  "damage_description": "descrição do dano/lesão",
  "case_number": "número do caso/processo",
  "case_type": "tipo do caso",
  "notes": "resumo das informações importantes",
  "sector": "setor/área de atuação",
  "visit_city": "cidade para visita",
  "visit_state": "estado para visita",
  "visit_address": "endereço para visita",
  "liability_type": "tipo de responsabilidade",
  "news_link": "link de notícia mencionado"
}`;
    }

    const systemPrompt = `Você é um assistente especializado em extrair informações estruturadas de conversas de WhatsApp para um escritório de advocacia focado em acidentes de trabalho.

Analise a conversa abaixo e extraia TODAS as informações relevantes que encontrar. Retorne APENAS um JSON válido (sem markdown) com os seguintes campos (use null para campos não encontrados):

${schemaPrompt}

IMPORTANTE:
- Extraia APENAS informações explicitamente mencionadas na conversa
- Não invente dados
- Para o campo "notes", faça um resumo útil
- Retorne APENAS o JSON, sem nenhum texto adicional ou markdown`;

    const result = await geminiChat({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: conversationText },
      ],
      temperature: 0.1,
    });

    const content = result.choices?.[0]?.message?.content || '{}';
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let extracted: Record<string, any>;
    try {
      extracted = JSON.parse(jsonStr);
    } catch {
      extracted = {};
    }

    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== null && value !== undefined && value !== '') {
        if (Array.isArray(value)) {
          cleaned[key] = value.filter((item: any) => item && typeof item === 'object');
        } else {
          cleaned[key] = value;
        }
      }
    }

    return new Response(JSON.stringify({ data: cleaned }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
