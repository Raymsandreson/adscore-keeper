const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SYSTEM_PROMPT = `Você é um especialista jurídico brasileiro em acidentes de trabalho. Analise o conteúdo fornecido e extraia dados estruturados sobre o acidente.

Retorne APENAS os dados que puder identificar com confiança. Use null para campos não encontrados.

Os campos a extrair são:
- victim_name: Nome da vítima
- victim_age: Idade da vítima (número)
- accident_date: Data do acidente (formato DD/MM/AAAA se possível)
- accident_address: Endereço/local do acidente
- damage_description: Descrição do dano/lesão sofrida
- contractor_company: Empresa terceirizada (empregadora direta)
- main_company: Empresa tomadora de serviço (contratante)
- sector: Setor de atuação (ex: construção civil, mineração, etc)
- case_type: Tipo de caso (ex: acidente_trabalho, doenca_ocupacional, acidente_trajeto, acidente_fatal)
- liability_type: Tipo de responsabilidade (ex: objetiva, subjetiva, solidária)
- legal_viability: Breve análise da viabilidade jurídica do caso
- visit_city: Cidade onde ocorreu o acidente
- visit_state: Estado (sigla UF) onde ocorreu o acidente`;

async function scrapeUrl(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }

  const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('Firecrawl error:', resp.status, errorText);
    throw new Error(`Erro ao acessar a página: ${resp.status}`);
  }

  const data = await resp.json();
  return data.data?.markdown || data.markdown || '';
}

async function callAI(prompt: string, images?: { mimeType: string; base64: string }[]): Promise<any> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY not configured');
  }

  const userContent: any[] = [{ type: 'text', text: prompt }];
  
  if (images && images.length > 0) {
    for (const img of images) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      });
    }
  }

  const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'extract_accident_data',
          description: 'Extrair dados estruturados de um acidente de trabalho',
          parameters: {
            type: 'object',
            properties: {
              victim_name: { type: ['string', 'null'] },
              victim_age: { type: ['number', 'null'] },
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
            required: ['victim_name', 'accident_date', 'damage_description'],
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'extract_accident_data' } },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('AI Gateway error:', resp.status, errText);
    if (resp.status === 429) throw new Error('Limite de requisições excedido. Tente novamente em alguns segundos.');
    if (resp.status === 402) throw new Error('Créditos de IA esgotados.');
    throw new Error('Erro ao processar com IA');
  }

  const data = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return JSON.parse(toolCall.function.arguments);
  }

  // Fallback: try to parse from content
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('Não foi possível extrair dados estruturados');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { content, type, url, mimeType, images } = body;

    let textForAnalysis = '';
    let imagePayloads: { mimeType: string; base64: string }[] = [];

    switch (type) {
      case 'url': {
        const scraped = await scrapeUrl(url || content);
        if (!scraped || scraped.trim().length < 50) {
          return new Response(
            JSON.stringify({ success: false, error: 'Não foi possível extrair conteúdo da página. Tente colar o texto diretamente.' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        textForAnalysis = `Conteúdo da notícia (URL: ${url || content}):\n\n${scraped.slice(0, 30000)}`;
        break;
      }

      case 'image': {
        if (!content) {
          return new Response(
            JSON.stringify({ success: false, error: 'Nenhuma imagem fornecida' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        imagePayloads.push({ mimeType: mimeType || 'image/jpeg', base64: content });
        textForAnalysis = 'Analise esta imagem e extraia os dados do acidente de trabalho.';
        break;
      }

      case 'document': {
        if (mimeType && content) {
          // Base64 document - treat as image for Gemini vision
          imagePayloads.push({ mimeType: mimeType, base64: content });
          textForAnalysis = 'Analise este documento e extraia os dados do acidente de trabalho.';
        } else {
          textForAnalysis = `Analise este texto e extraia os dados do acidente:\n\n${content}`;
        }
        break;
      }

      case 'text':
      default: {
        textForAnalysis = `Analise este texto e extraia os dados do acidente:\n\n${content}`;
        break;
      }
    }

    // Handle additional images from AIDataEnricher
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.base64 && img.mimeType) {
          imagePayloads.push({ mimeType: img.mimeType, base64: img.base64 });
        }
      }
      if (!textForAnalysis || textForAnalysis.trim().length < 10) {
        textForAnalysis = 'Analise estas imagens e extraia os dados do acidente de trabalho.';
      }
    }

    const extractedData = await callAI(textForAnalysis, imagePayloads.length > 0 ? imagePayloads : undefined);

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('extract-accident-data error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
