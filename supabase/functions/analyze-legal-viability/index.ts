import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, existingData } = await req.json();
    
    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Conteúdo é obrigatório para análise' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `Você é um advogado especialista em direito do trabalho e acidentes de trabalho no Brasil.
Sua tarefa é analisar casos de acidentes de trabalho e fornecer uma análise detalhada sobre a viabilidade jurídica.

CRITÉRIOS DE ANÁLISE:

1. PORTE DA EMPRESA:
   - Analise se as empresas mencionadas são de GRANDE PORTE (instalações amplas, muitos funcionários, faturamento alto)
   - Empresas de grande porte têm maior capacidade de pagamento de indenizações
   - Busque informações sobre o porte das empresas mencionadas

2. TIPO DE ACIDENTE:
   - Avalie a gravidade do acidente (morte, invalidez permanente, lesões graves, lesões leves)
   - Acidentes fatais ou com invalidez permanente têm maior potencial indenizatório

3. RESPONSABILIDADE CIVIL:
   - SOLIDÁRIA: Quando empresa terceirizada e tomadora respondem juntas
   - SUBSIDIÁRIA: Tomadora responde se terceirizada não puder pagar
   - OBJETIVA: Atividade de risco - não precisa provar culpa
   - SUBJETIVA: Precisa provar negligência/imprudência da empresa

4. NEXO CAUSAL:
   - Existe relação clara entre trabalho e acidente?
   - O acidente ocorreu durante atividade laboral?

5. VALOR POTENCIAL:
   - Considere danos materiais (despesas médicas, lucros cessantes)
   - Danos morais (sofrimento, impacto na vida)
   - Pensão vitalícia em casos de morte ou invalidez

FORMATO DA RESPOSTA:
Forneça uma análise completa e fundamentada, incluindo:
- Parecer sobre viabilidade (Viável/Parcialmente Viável/Inviável)
- Justificativa com base nos critérios acima
- Tipo de responsabilidade recomendado
- Pontos fortes e fracos do caso
- Estimativa de potencial indenizatório (quando possível)

ATENÇÃO: Seja objetivo e direto. Se faltar informações importantes, mencione quais dados seriam necessários.`;

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

    console.log('Calling Lovable AI for legal viability analysis...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
                  legal_viability: { 
                    type: ['string', 'null'],
                    description: 'Análise completa da viabilidade jurídica do caso, incluindo parecer, fundamentação, pontos fortes/fracos e estimativa de potencial indenizatório'
                  },
                  liability_type: { 
                    type: ['string', 'null'],
                    enum: ['Solidária', 'Subsidiária', 'Objetiva', 'Subjetiva', 'A Definir', null],
                    description: 'Tipo de responsabilidade civil recomendado para o caso'
                  },
                  company_size_justification: { 
                    type: ['string', 'null'],
                    description: 'Análise do porte das empresas envolvidas e sua capacidade de pagamento'
                  },
                  sector: {
                    type: ['string', 'null'],
                    description: 'Setor de atuação identificado (se não informado anteriormente)'
                  },
                  case_type: {
                    type: ['string', 'null'],
                    description: 'Tipo de acidente identificado (se não informado anteriormente)'
                  },
                  viability_score: {
                    type: ['string', 'null'],
                    enum: ['Alta', 'Média', 'Baixa', null],
                    description: 'Classificação geral da viabilidade do caso'
                  },
                },
                required: ['legal_viability'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'analyze_legal_viability' } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido. Tente novamente em alguns minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos ao workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Erro ao processar análise com IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('AI response received:', JSON.stringify(data).slice(0, 500));

    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const extractedData = JSON.parse(toolCall.function.arguments);
      console.log('Extracted viability data:', extractedData);
      
      return new Response(
        JSON.stringify({ success: true, data: extractedData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fallback: try to parse from content
    const content_response = data.choices?.[0]?.message?.content;
    if (content_response) {
      // Return the raw analysis as legal_viability
      return new Response(
        JSON.stringify({ 
          success: true, 
          data: { 
            legal_viability: content_response,
            liability_type: null,
            company_size_justification: null
          } 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Não foi possível analisar o caso' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-legal-viability:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
