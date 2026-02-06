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
    const { content, type } = await req.json();
    
    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Conteúdo é obrigatório' }),
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

    const currentYear = new Date().getFullYear();
    
    const systemPrompt = `Você é um assistente especializado em extrair informações de casos de acidentes de trabalho a partir de notícias, petições iniciais e decisões judiciais.

ATENÇÃO - REGRAS CRÍTICAS:
1. NUNCA INVENTE informações que não estão explícitas no texto
2. Para DATAS: Se o texto menciona apenas dia/mês sem ano, use o ano atual (${currentYear}). NÃO invente anos.
3. DIFERENCIE CLARAMENTE:
   - LOCAL DO ACIDENTE (accident_address): onde o acidente ACONTECEU
   - LOCAL DA FAMÍLIA/VISITA (visit_city, visit_state): onde a família mora, onde será o velório/sepultamento, ou cidade mencionada como residência

Extraia as seguintes informações do texto fornecido:

- victim_name: Nome da vítima (string ou null)
- victim_age: Idade da vítima (número ou null)  
- accident_date: Data do acidente no formato YYYY-MM-DD. Se não houver ano explícito, use ${currentYear} (string ou null)
- accident_address: Local/endereço onde OCORREU o acidente - NÃO confundir com local de velório/família (string ou null)
- damage_description: Descrição do dano/lesão sofrida (string ou null)
- contractor_company: Nome da empresa terceirizada (string ou null)
- main_company: Nome da empresa tomadora/contratante (string ou null)
- sector: Setor de atuação (construção civil, mineração, agronegócio, etc.) (string ou null)
- case_type: Tipo de caso (Queda de Altura, Soterramento, Choque Elétrico, Acidente com Máquinas, Intoxicação, etc.) (string ou null)
- liability_type: Tipo de responsabilidade identificada (solidária, subsidiária, objetiva, subjetiva) (string ou null)
- legal_viability: Breve análise da viabilidade jurídica do caso (string ou null)
- visit_city: Cidade da FAMÍLIA/RESIDÊNCIA da vítima - onde será velório, sepultamento ou onde a família mora (string ou null)
- visit_state: Estado da FAMÍLIA/RESIDÊNCIA - sigla UF (string ou null)

IMPORTANTE:
- Retorne APENAS o JSON, sem nenhum texto adicional
- Se não conseguir identificar uma informação com certeza, coloque null - NÃO INVENTE
- Para estados, use a sigla (SP, RJ, MG, SE, BA, etc.)
- Preste atenção em frases como "será sepultado em", "residência da família em", "natural de" para identificar visit_city/visit_state`;

    const userMessage = type === 'url' 
      ? `Extraia os dados de acidente de trabalho do seguinte link de notícia. O conteúdo foi obtido da URL: ${content}`
      : `Extraia os dados de acidente de trabalho do seguinte documento:\n\n${content}`;

    console.log('Calling Lovable AI for accident data extraction...');

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
          { role: 'user', content: userMessage },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_accident_data',
              description: 'Extrai dados estruturados de um acidente de trabalho',
              parameters: {
                type: 'object',
                properties: {
                  victim_name: { type: ['string', 'null'] },
                  victim_age: { type: ['integer', 'null'] },
                  accident_date: { type: ['string', 'null'] },
                  accident_address: { type: ['string', 'null'] },
                  damage_description: { type: ['string', 'null'] },
                  contractor_company: { type: ['string', 'null'] },
                  main_company: { type: ['string', 'null'] },
                  sector: { type: ['string', 'null'] },
                  case_type: { type: ['string', 'null'] },
                  liability_type: { type: ['string', 'null'] },
                  legal_viability: { type: ['string', 'null'] },
                  visit_city: { type: ['string', 'null'] },
                  visit_state: { type: ['string', 'null'] },
                },
                required: [],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_accident_data' } },
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
        JSON.stringify({ error: 'Erro ao processar com IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('AI response received:', JSON.stringify(data).slice(0, 500));

    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const extractedData = JSON.parse(toolCall.function.arguments);
      console.log('Extracted data:', extractedData);
      
      return new Response(
        JSON.stringify({ success: true, data: extractedData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fallback: try to parse from content
    const content_response = data.choices?.[0]?.message?.content;
    if (content_response) {
      try {
        // Try to extract JSON from the response
        const jsonMatch = content_response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extractedData = JSON.parse(jsonMatch[0]);
          return new Response(
            JSON.stringify({ success: true, data: extractedData }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        console.error('Error parsing JSON from content:', e);
      }
    }

    return new Response(
      JSON.stringify({ error: 'Não foi possível extrair dados do conteúdo' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-accident-data:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
