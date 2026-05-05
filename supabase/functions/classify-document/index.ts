// Edge function: classify-document
// Recebe { url, name } e retorna { type, title } usando Lovable AI Gateway (Gemini)
// Chamada por Railway/zapsign-post-sign-extras — sem expor LOVABLE_API_KEY fora do Cloud

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const MODEL = 'google/gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `Você classifica documentos pessoais brasileiros a partir de uma imagem ou PDF.
Retorne SOMENTE um JSON com:
- "type": um dos valores ["rg", "cpf", "cnh", "comprovante_residencia", "comprovante_renda", "carteira_trabalho", "certidao", "procuracao", "contrato", "outros"]
- "title": título curto humano (ex.: "RG - Frente", "Comprovante de residência")
Sem texto fora do JSON.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, name } = await req.json();
    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'url is required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userContent: any[] = [
      { type: 'text', text: `Nome do arquivo: ${name ?? '(desconhecido)'}\nClassifique o documento abaixo.` },
      { type: 'image_url', image_url: { url } },
    ];

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return new Response(
        JSON.stringify({ success: false, error: `gateway ${aiRes.status}: ${errText.slice(0, 300)}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await aiRes.json();
    const content = data?.choices?.[0]?.message?.content ?? '{}';
    let parsed: { type?: string; title?: string } = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    return new Response(
      JSON.stringify({
        success: true,
        type: parsed.type ?? 'outros',
        title: parsed.title ?? (name ?? 'Documento'),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String((e as Error).message ?? e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
