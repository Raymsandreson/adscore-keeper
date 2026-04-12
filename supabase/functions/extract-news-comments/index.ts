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
    const { url, leadContext } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL é obrigatória' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl não configurado' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping news page for comments:', formattedUrl);

    const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ['markdown'],
        onlyMainContent: false,
        waitFor: 3000,
      }),
    });

    const scrapeData = await scrapeResponse.json();

    if (!scrapeResponse.ok || !scrapeData) {
      const errorMsg = typeof scrapeData?.error === 'string' && scrapeData.error.includes('do not support this site')
        ? 'Este site não é suportado para scraping (ex: Instagram, Facebook). Tente um portal de notícias.'
        : 'Erro ao buscar página';
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pageContent = scrapeData.data?.markdown || scrapeData.markdown || '';
    const pageTitle = scrapeData.data?.metadata?.title || '';

    if (!pageContent || pageContent.length < 100) {
      return new Response(
        JSON.stringify({ success: false, error: 'Conteúdo da página muito curto ou vazio' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Page scraped, content length:', pageContent.length);

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_AI_API_KEY');
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Chave da IA não configurada' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build lead context string for personalized messages
    const leadCtx = leadContext
      ? `\n\nCONTEXTO DO CASO JURÍDICO DO LEAD:
- Nome da vítima: ${leadContext.victim_name || 'N/A'}
- Tipo do caso: ${leadContext.case_type || 'Acidente de trabalho'}
- Data do acidente: ${leadContext.accident_date || 'N/A'}
- Empresa: ${leadContext.main_company || leadContext.contractor_company || 'N/A'}
- Descrição: ${leadContext.damage_description || 'N/A'}`
      : '';

    const prompt = `Analise o conteúdo desta página de notícia e extraia:

1. **Comentários**: Extraia TODOS os comentários de leitores/usuários que encontrar na página. Para cada comentário retorne:
   - author: nome ou username do autor
   - text: texto completo do comentário
   - date: data/hora se disponível
   - likes: número de likes/curtidas se disponível
   - is_reply: se é resposta a outro comentário
   - contact_info: objeto com dados de contato encontrados NO TEXTO do comentário ou no perfil do autor:
     - full_name: nome completo real (se diferente do username)
     - phone: telefone ou WhatsApp mencionado
     - email: email mencionado
     - instagram: perfil Instagram mencionado (com @)
     - other_social: outras redes sociais mencionadas
   - suggested_reply: uma resposta pública empática e profissional para o comentário, como se fosse um escritório de advocacia interessado em ajudar. A resposta deve ser curta (máx 2 frases), humanizada, e NÃO deve parecer propaganda. Deve demonstrar solidariedade e oferecer apoio.
   - suggested_dm: uma mensagem direta (inbox/DM) personalizada para o comentarista, mais detalhada (3-5 frases), se apresentando como representante de um escritório de advocacia especializado, demonstrando empatia com a situação, e convidando para uma conversa privada sobre seus direitos. Deve mencionar que o serviço é gratuito se aplicável.

2. **Detalhes adicionais da notícia** que podem complementar um caso jurídico:
   - additional_victims: nomes de outras vítimas mencionadas
   - witnesses: testemunhas mencionadas  
   - companies_mentioned: empresas mencionadas
   - authorities_mentioned: autoridades/órgãos mencionados
   - timeline: cronologia dos eventos
   - summary: resumo breve da notícia (máx 200 palavras)
${leadCtx}

Retorne SOMENTE um JSON válido no formato:
{
  "comments": [
    {
      "author": "...",
      "text": "...",
      "date": "...",
      "likes": 0,
      "is_reply": false,
      "contact_info": {"full_name": null, "phone": null, "email": null, "instagram": null, "other_social": null},
      "suggested_reply": "...",
      "suggested_dm": "..."
    }
  ],
  "details": {
    "additional_victims": ["..."],
    "witnesses": ["..."],
    "companies_mentioned": ["..."],
    "authorities_mentioned": ["..."],
    "timeline": "...",
    "summary": "..."
  },
  "total_comments": 0
}

Se não houver comentários, retorne "comments" como array vazio.

CONTEÚDO DA PÁGINA:
${pageContent.substring(0, 15000)}`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const geminiData = await geminiResponse.json();
    const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let extracted;
    try {
      extracted = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('IA retornou formato inválido');
      }
    }

    console.log(`Extracted ${extracted.comments?.length || 0} comments, details: ${!!extracted.details}`);

    return new Response(
      JSON.stringify({
        success: true,
        comments: extracted.comments || [],
        details: extracted.details || {},
        total_comments: extracted.total_comments || extracted.comments?.length || 0,
        page_title: pageTitle,
        url: formattedUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error extracting news comments:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
