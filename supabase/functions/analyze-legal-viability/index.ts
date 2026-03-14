import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { content, existingData } = await req.json();

    if (!content) {
      return new Response(JSON.stringify({ error: 'Conteúdo é obrigatório para análise' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `Você é um advogado especialista em direito do trabalho e acidentes de trabalho no Brasil.
Sua tarefa é analisar casos de acidentes de trabalho e fornecer uma análise detalhada sobre a viabilidade jurídica.

CRITÉRIOS DE ANÁLISE:
1. PORTE DA EMPRESA
2. TIPO DE ACIDENTE
3. RESPONSABILIDADE CIVIL (Solidária, Subsidiária, Objetiva, Subjetiva)
4. NEXO CAUSAL
5. VALOR POTENCIAL

FORMATO DA RESPOSTA:
- Parecer sobre viabilidade (Viável/Parcialmente Viável/Inviável)
- Justificativa com base nos critérios
- Tipo de responsabilidade recomendado
- Pontos fortes e fracos do caso
- Estimativa de potencial indenizatório`;

    const userPrompt = `Analise a viabilidade jurídica deste caso de acidente de trabalho:

${content}

${existingData ? `
DADOS JÁ CADASTRADOS:
- Tipo de Caso: ${existingData.case_type || 'Não informado'}
- Descrição do Dano: ${existingData.damage_description || 'Não informado'}
- Empresa Terceirizada: ${existingData.contractor_company || 'Não informada'}
- Empresa Tomadora: ${existingData.main_company || 'Não informada'}
- Setor: ${existingData.sector || 'Não informado'}
` : ''}

Forneça sua análise estruturada.`;

    const data = await geminiChat({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'analyze_legal_viability',
            description: 'Analisa a viabilidade jurídica de um caso de acidente de trabalho',
            parameters: {
              type: 'object',
              properties: {
                legal_viability: { type: 'string', description: 'Análise completa da viabilidade jurídica' },
                liability_type: { type: 'string', enum: ['Solidária', 'Subsidiária', 'Objetiva', 'Subjetiva', 'A Definir'] },
                company_size_justification: { type: 'string' },
                sector: { type: 'string' },
                case_type: { type: 'string' },
                viability_score: { type: 'string', enum: ['Alta', 'Média', 'Baixa'] },
              },
              required: ['legal_viability'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'analyze_legal_viability' } },
    });

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const extractedData = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify({ success: true, data: extractedData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const content_response = data.choices?.[0]?.message?.content;
    if (content_response) {
      return new Response(JSON.stringify({
        success: true,
        data: { legal_viability: content_response, liability_type: null, company_size_justification: null }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Não foi possível analisar o caso' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in analyze-legal-viability:', error);
    const status = error instanceof GeminiError ? (error.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: error.message || 'Erro desconhecido' }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
