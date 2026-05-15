// Edge function: classify-document
// Analisa 1+ mídias (imagens/PDFs) e retorna análise estruturada.
// Backwards compatible: aceita { url, name } (legado, single) OU { urls: [{url,label}], name }
// Retorna: { success, type, title, holder_name, holder_cpf, description, pages_label }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const MODEL = 'google/gemini-2.5-flash';

const SYSTEM_PROMPT = `Você analisa documentos pessoais/processuais brasileiros a partir de uma ou mais imagens (que podem ser páginas distintas do MESMO documento).

Retorne SOMENTE um JSON com:
- "type": categoria curta (ex.: "rg", "cpf", "cnh", "comprovante_residencia", "comprovante_renda", "carteira_trabalho", "certidao", "procuracao", "contrato", "laudo_pericial", "exame_medico", "receita", "boletim_ocorrencia", "outros").
- "title": título humano curto que identifica o documento (ex.: "Laudo Pericial", "RG - Frente", "Comprovante de residência"). NÃO inclua nome de titular nem datas no título.
- "holder_name": nome do titular do documento (string ou null).
- "holder_cpf": CPF formatado XXX.XXX.XXX-XX (string ou null).
- "description": 1-3 frases descrevendo OBJETIVAMENTE o conteúdo (do que se trata, dados principais, finalidade). Não invente.
- "pages_label": se foram fornecidos rótulos de página, devolva-os concatenados (ex.: "página 1 de 9; página 2 de 9"). Caso contrário, null.

Responda apenas com o JSON, sem texto extra.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const legacyUrl: string | undefined = body?.url;
    const urls: Array<{ url: string; label?: string }> = Array.isArray(body?.urls)
      ? body.urls.filter((x: any) => x && typeof x.url === 'string')
      : (legacyUrl ? [{ url: legacyUrl }] : []);
    const name: string | undefined = body?.name;

    if (urls.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'urls is required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userContent: any[] = [
      {
        type: 'text',
        text:
          `Nome do(s) arquivo(s): ${name ?? '(desconhecido)'}\n` +
          `Foram fornecidas ${urls.length} imagem(ns)/página(s) na ordem indicada.\n` +
          (urls.some((u) => u.label) ? `Rótulos: ${urls.map((u, i) => u.label || `item ${i + 1}`).join('; ')}\n` : '') +
          `Analise TODAS como partes possivelmente do MESMO documento e devolva o JSON conforme instruído.`,
      },
      ...urls.map((u) => ({ type: 'image_url', image_url: { url: u.url } })),
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
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    return new Response(
      JSON.stringify({
        success: true,
        type: parsed.type ?? 'outros',
        title: parsed.title ?? (name ?? 'Documento'),
        holder_name: parsed.holder_name ?? null,
        holder_cpf: parsed.holder_cpf ?? null,
        description: parsed.description ?? null,
        pages_label: parsed.pages_label ?? null,
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
