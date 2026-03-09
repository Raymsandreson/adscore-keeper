import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// URLs that Firecrawl doesn't support
const UNSUPPORTED_DOMAINS = [
  'instagram.com',
  'www.instagram.com',
  'facebook.com',
  'www.facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'www.tiktok.com',
];

function isUnsupportedUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return UNSUPPORTED_DOMAINS.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

async function scrapeUrl(url: string): Promise<string | null> {
  // Check if URL is from an unsupported site
  if (isUnsupportedUrl(url)) {
    console.log('URL from unsupported site:', url);
    return null;
  }

  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    console.log('FIRECRAWL_API_KEY not configured, skipping URL scraping');
    return null;
  }

  try {
    console.log('Scraping URL with Firecrawl:', url);
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Firecrawl error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown;
    console.log('Scraped content length:', markdown?.length || 0);
    return markdown;
  } catch (error) {
    console.error('Error scraping URL:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, type, images, url, mimeType } = await req.json();
    
    if (!content && (!images || images.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'Conteúdo ou imagens são obrigatórios' }),
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

    // Handle different input types
    let textContent = '';
    let imageContent: string[] = [];

    if (type === 'url' || type === 'link') {
      // Scrape the URL content
      const urlToScrape = url || content;
      
      // Check if it's an unsupported URL first (before calling scrapeUrl)
      if (isUnsupportedUrl(urlToScrape)) {
        return new Response(
          JSON.stringify({ 
            success: false,
            error: 'Links do Instagram, Facebook, TikTok e X/Twitter não são suportados para extração automática. Por favor, copie e cole o texto da publicação diretamente ou faça um print da tela e use a opção de imagem.' 
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const scrapedContent = await scrapeUrl(urlToScrape);
      if (scrapedContent) {
        textContent = scrapedContent;
      } else {
        return new Response(
          JSON.stringify({ success: false, error: 'Não foi possível acessar o link. Verifique se a URL está correta e tente novamente.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (type === 'image') {
      // Image uploaded as base64
      if (content && mimeType) {
        imageContent.push(`data:${mimeType};base64,${content}`);
      }
    } else if (type === 'document') {
      // Document uploaded as base64
      if (mimeType === 'text/plain') {
        try {
          textContent = atob(content);
        } catch {
          textContent = content;
        }
      } else if (mimeType?.includes('pdf')) {
        // Send PDF as inline_data to Gemini which supports PDF natively
        imageContent.push(`data:application/pdf;base64,${content}`);
      } else if (mimeType?.includes('word') || mimeType?.includes('openxmlformats')) {
        // Word docs can't be processed directly - inform the user
        return new Response(
          JSON.stringify({ 
            error: 'Para documentos Word, por favor copie e cole o texto diretamente ou salve como PDF e envie novamente.' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        textContent = content;
      }
    } else {
      // Plain text
      textContent = content;
    }
    
    // Check if we have images to analyze
    const hasImages = (images && Array.isArray(images) && images.length > 0) || imageContent.length > 0;
    const allImages = [...(images || []), ...imageContent];

    const MAX_TEXT_LENGTH = 30000;
    if (textContent.length > MAX_TEXT_LENGTH) {
      console.log(`Text content too long (${textContent.length}), truncating to ${MAX_TEXT_LENGTH}`);
      textContent = textContent.slice(0, MAX_TEXT_LENGTH);
    }

    const currentYear = new Date().getFullYear();
    
    const imageAnalysisInstructions = hasImages ? `
ANÁLISE DE IMAGENS:
Além do texto, você receberá imagens do acidente/local. Analise-as para extrair:
- Identificar se a empresa é de GRANDE PORTE (instalações amplas, muitos funcionários, equipamentos industriais, veículos de frota)
- Identificar o SETOR pela aparência visual (construção civil, mineração, agronegócio, indústria, etc.)
- Identificar CONDIÇÕES DE SEGURANÇA visíveis (EPIs, sinalização, condições do local)
- Identificar MARCAS ou LOGOS visíveis em uniformes, veículos, equipamentos
- EXTRAIR TEXTO VISÍVEL na imagem (OCR) - nomes, datas, endereços, empresas mencionadas
- Qualquer outro insight relevante para o caso

O campo company_size_justification deve conter sua análise do porte da empresa baseado nas imagens.
` : '';

    const systemPrompt = `Você é um assistente especializado em extrair informações de casos de acidentes de trabalho a partir de notícias, petições iniciais, decisões judiciais e IMAGENS.

ATENÇÃO - REGRAS CRÍTICAS:
1. NUNCA INVENTE informações que não estão explícitas no texto ou visíveis nas imagens
2. Para DATAS: Se o texto menciona apenas dia/mês sem ano, use o ano atual (${currentYear}). NÃO invente anos.
3. DIFERENCIE CLARAMENTE:
   - LOCAL DO ACIDENTE (accident_address): onde o acidente ACONTECEU
   - LOCAL DA FAMÍLIA/VISITA (visit_city, visit_state): onde a família mora, onde será o velório/sepultamento, ou cidade mencionada como residência
4. FOQUE APENAS NO CONTEÚDO PRINCIPAL da notícia/texto:
   - IGNORE completamente: propagandas, anúncios, "Leia também", "Notícias relacionadas", "Veja mais", links para outras matérias
   - IGNORE seções de comentários, rodapés, barras laterais
   - EXTRAIA APENAS dados do acidente/caso principal mencionado na notícia
   - Se o texto contiver múltiplas notícias, foque APENAS na primeira/principal
${imageAnalysisInstructions}
Extraia as seguintes informações do texto e/ou imagens fornecidos:

- victim_name: Nome COMPLETO da vítima (string ou null)
- victim_age: Idade da vítima (número ou null)  
- accident_date: Data do acidente no formato YYYY-MM-DD. Se não houver ano explícito, use ${currentYear} (string ou null)
- accident_address: Local/endereço onde OCORREU o acidente - NÃO confundir com local de velório/família (string ou null)
- damage_description: Descrição curta do dano/lesão (ex: "Óbito", "Amputação de mão", "Fratura de fêmur") (string ou null)
- contractor_company: Nome da empresa terceirizada (string ou null)
- main_company: Nome da empresa tomadora/contratante principal (string ou null)
- sector: Setor de atuação (construção civil, mineração, agronegócio, etc.) (string ou null)
- case_type: Tipo de caso (Queda de Altura, Soterramento, Choque Elétrico, Acidente com Máquinas, Intoxicação, etc.) (string ou null)
- liability_type: Tipo de responsabilidade identificada (solidária, subsidiária, objetiva, subjetiva) (string ou null)
- legal_viability: Breve análise da viabilidade jurídica do caso (string ou null)
- visit_city: Cidade da FAMÍLIA/RESIDÊNCIA da vítima - onde será velório, sepultamento ou onde a família mora (string ou null)
- visit_state: Estado da FAMÍLIA/RESIDÊNCIA - sigla UF (string ou null)
- company_size_justification: Análise do porte da empresa baseado nas imagens (string ou null) - APENAS se houver imagens

IMPORTANTE:
- Retorne APENAS o JSON, sem nenhum texto adicional
- Se não conseguir identificar uma informação com certeza, coloque null - NÃO INVENTE
- Para estados, use a sigla (SP, RJ, MG, SE, BA, etc.)
- Preste atenção em frases como "será sepultado em", "residência da família em", "natural de" para identificar visit_city/visit_state
- Se houver imagens, analise-as cuidadosamente para insights visuais e extraia TODO TEXTO VISÍVEL
- IGNORE completamente conteúdo de outras notícias, propagandas ou links relacionados`;

    // Build user message content (can be multimodal with images)
    const userMessageContent: any[] = [];
    
    // Add text content if available
    if (textContent) {
      const textMessage = type === 'url' || type === 'link'
        ? `Extraia os dados de acidente de trabalho do seguinte conteúdo da notícia:\n\n${textContent}`
        : `Extraia os dados de acidente de trabalho do seguinte documento:\n\n${textContent}`;
      userMessageContent.push({ type: 'text', text: textMessage });
    } else if (hasImages) {
      userMessageContent.push({ type: 'text', text: 'Analise as imagens fornecidas e extraia dados do acidente de trabalho. EXTRAIA TODO O TEXTO VISÍVEL na imagem.' });
    }
    
    // Add images if available
    if (hasImages) {
      for (const imageUrl of allImages) {
        userMessageContent.push({
          type: 'image_url',
          image_url: { url: imageUrl }
        });
      }
      // Add reminder to analyze images
      userMessageContent.push({ 
        type: 'text', 
        text: '\n\nANALISE AS IMAGENS ACIMA para identificar porte da empresa, setor, condições de segurança, logos/marcas visíveis, TEXTO VISÍVEL (OCR) e outros insights relevantes.' 
      });
    }

    console.log('Calling Lovable AI for accident data extraction...', hasImages ? `with ${allImages.length} images` : 'text only');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessageContent },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_accident_data',
              description: 'Extrai dados estruturados de um acidente de trabalho a partir de texto e/ou imagens',
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
                  company_size_justification: { type: ['string', 'null'], description: 'Análise do porte da empresa baseado nas imagens' },
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

      let apiErrorMessage = 'Erro ao processar com IA';
      try {
        const parsed = JSON.parse(errorText);
        apiErrorMessage = parsed?.error?.message || parsed?.error || parsed?.message || apiErrorMessage;
      } catch {
        if (errorText) {
          apiErrorMessage = errorText.slice(0, 220);
        }
      }

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
      if (response.status === 413) {
        return new Response(
          JSON.stringify({ error: 'Conteúdo muito grande para análise. Cole um trecho menor do texto.' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: apiErrorMessage }),
        { status: response.status >= 400 && response.status < 600 ? response.status : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
