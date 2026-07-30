import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Busca de JURISPRUDÊNCIA por termo/assunto na API v1 do Escavador.
// A API v2 (search-escavador) só busca processo específico (nº, nome, CPF, OAB);
// não tem busca por assunto. A rota de jurisprudência existe apenas na v1:
//   GET /api/v1/jurisprudencias            -> filtros disponíveis (inclui tribunais)
//   GET /api/v1/jurisprudencias/busca      -> busca paginada por termo
//   GET /api/v1/jurisprudencias/documento/{tipo}/{id} -> detalhe de 1 decisão
// Ref: SDK oficial Escavador/escavador-python (v1/resources/jurisprudencia.py)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

const ESCAVADOR_V1 = 'https://api.escavador.com/api/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = Deno.env.get('ESCAVADOR_API_TOKEN');
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'ESCAVADOR_API_TOKEN não configurado' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      action,
      termo,
      pagina,
      ordena_por,
      de_data,      // 'YYYYMMDD'
      ate_data,     // 'YYYYMMDD'
      filtros,      // objeto opcional: { tribunais: [...], ... } (chaves de /jurisprudencias)
      tipo_documento,
      documento_id,
    } = await req.json();

    let url = '';

    switch (action) {
      case 'filtros':
        // Lista os filtros aceitos na busca (chaves + opções), incluindo tribunais.
        url = `${ESCAVADOR_V1}/jurisprudencias`;
        break;

      case 'buscar': {
        if (!termo || String(termo).trim().length < 2) {
          throw new Error('termo é obrigatório (mín. 2 caracteres)');
        }
        const qs = new URLSearchParams();
        qs.set('q', String(termo).trim());
        if (pagina) qs.set('pagina', String(pagina));
        if (ordena_por) qs.set('ordena_por', String(ordena_por));
        if (de_data) qs.set('de_data', String(de_data));
        if (ate_data) qs.set('ate_data', String(ate_data));
        // filtros: cada chave pode ser valor único ou array (ex.: tribunais)
        if (filtros && typeof filtros === 'object') {
          for (const [k, v] of Object.entries(filtros)) {
            if (Array.isArray(v)) {
              for (const item of v) qs.append(`${k}[]`, String(item));
            } else if (v !== null && v !== undefined) {
              qs.set(k, String(v));
            }
          }
        }
        url = `${ESCAVADOR_V1}/jurisprudencias/busca?${qs.toString()}`;
        break;
      }

      case 'documento':
        if (!tipo_documento || !documento_id) {
          throw new Error('tipo_documento e documento_id são obrigatórios');
        }
        url = `${ESCAVADOR_V1}/jurisprudencias/documento/${encodeURIComponent(tipo_documento)}/${encodeURIComponent(documento_id)}`;
        break;

      default:
        throw new Error('Ação inválida. Use: filtros, buscar, documento');
    }

    console.log(`Escavador jurisprudência: GET ${url}`);

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Escavador jurisprudência error:', response.status, JSON.stringify(data));
      return new Response(JSON.stringify({
        success: false,
        error: data.message || data.error || `Erro ${response.status} na API do Escavador`,
        status_code: response.status,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
