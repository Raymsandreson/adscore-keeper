import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { topic } = await req.json();
    
    if (!topic) {
      throw new Error('Tópico é obrigatório');
    }

    const systemPrompt = `Você é um especialista em busca de casos de acidentes de trabalho e tragédias no Instagram/redes sociais para advogados que buscam potenciais clientes.

Dado um assunto/tópico, sugira de 8 a 12 palavras-chave ou expressões que seriam eficazes para encontrar posts relevantes no Instagram.

Regras:
- Foque em termos que aparecem naturalmente em posts de notícias, familiares ou testemunhas
- Inclua variações como "acidente de trabalho", "morte no trabalho", "vítima fatal"
- Considere termos regionais brasileiros
- Inclua termos emocionais que familiares usam (luto, saudade, descanse em paz)
- Pense em hashtags comuns sem o símbolo #
- Seja específico para o contexto brasileiro

Retorne APENAS as palavras-chave separadas por vírgula, sem explicações.`;

    const result = await geminiChat({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Sugira palavras-chave para buscar posts sobre: ${topic}` }
      ],
      temperature: 0.7,
    });

    const content = result.choices?.[0]?.message?.content || '';
    
    const keywords = content
      .split(',')
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0 && k.length < 50);

    return new Response(
      JSON.stringify({ success: true, keywords }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
