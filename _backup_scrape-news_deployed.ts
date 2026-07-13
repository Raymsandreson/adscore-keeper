rt { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL é obrigatória' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format URL
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping URL:', formattedUrl);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ['markdown', 'screenshot'],
        onlyMainContent: true, // Extrai apenas o conteúdo principal, ignora menus/ads
        proxy: 'auto', // Re-tenta com proxy stealth se o site bloquear o request básico (anti-bot)
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Firecrawl API error:', data);
      const errorMsg = typeof data.error === 'string' && data.error.includes('do not support this site')
        ? 'Este site não é suportado para scraping (ex: Instagram, Facebook). Tente um portal de notícias.'
        : (data.error || `Erro ao buscar página: ${response.status}`);
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract markdown content and screenshot
    const markdown = data.data?.markdown || data.markdown || '';
    const title = data.data?.metadata?.title || data.metadata?.title || '';
    const screenshot = data.data?.screenshot || data.screenshot || null;
    const statusCode = data.data?.metadata?.statusCode || data.metadata?.statusCode || 200;

    // Sites atrás de Cloudflare/anti-bot devolvem a página de bloqueio como HTML 200.
    // Sem essa detecção, o texto de bloqueio segue pro analyze-news-case como se fosse a notícia.
    const BLOCK_PATTERNS = /you have been blocked|você foi bloqueado|cloudflare ray id|please enable cookies|just a moment|attention required|access denied|verify you are a human|enable javascript and cookies to continue/i;
    const looksBlocked = BLOCK_PATTERNS.test(`${title}\n${markdown.slice(0, 3000)}`) || statusCode === 403 || statusCode === 503;
    if (looksBlocked) {
      console.warn('Scrape blocked by anti-bot page. statusCode:', statusCode, 'url:', formattedUrl);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'O site bloqueou a leitura automática da página. Abra o link no navegador, copie o texto da notícia e cole manualmente no campo de texto.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Scrape successful, content length:', markdown.length, 'has screenshot:', !!screenshot);

    return new Response(
      JSON.stringify({ 
        success: true, 
        content: markdown,
        title,
        url: formattedUrl,
        screenshot, // Base64 image of the page
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error scraping:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro ao buscar página';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
