import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ESCAVADOR_BASE = 'https://api.escavador.com/api/v2';

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

    const { action, numero_cnj, nome, cpf_cnpj, oab_numero, oab_estado, cursor, documento_id } = await req.json();

    let url = '';
    let method = 'GET';

    switch (action) {
      case 'buscar_por_numero':
        if (!numero_cnj) throw new Error('numero_cnj é obrigatório');
        url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}`;
        break;
      case 'buscar_por_nome':
        if (!nome) throw new Error('nome é obrigatório');
        url = `${ESCAVADOR_BASE}/processos/buscar?nome=${encodeURIComponent(nome)}`;
        break;
      case 'buscar_por_cpf_cnpj':
        if (!cpf_cnpj) throw new Error('cpf_cnpj é obrigatório');
        const clean = cpf_cnpj.replace(/[.\-\/]/g, '');
        if (clean.length === 11) {
          url = `${ESCAVADOR_BASE}/processos/cpf/${clean}`;
        } else {
          url = `${ESCAVADOR_BASE}/processos/cnpj/${clean}`;
        }
        break;
      case 'buscar_por_oab':
        if (!oab_numero || !oab_estado) throw new Error('oab_numero e oab_estado são obrigatórios');
        url = `${ESCAVADOR_BASE}/processos/oab/${encodeURIComponent(oab_estado.toUpperCase())}/${encodeURIComponent(oab_numero)}`;
        break;
      case 'buscar_movimentacoes':
        if (!numero_cnj) throw new Error('numero_cnj é obrigatório');
        url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}/movimentacoes`;
        if (cursor) {
          url += `?cursor=${encodeURIComponent(cursor)}`;
        }
        break;
      case 'buscar_documentos':
        if (!numero_cnj) throw new Error('numero_cnj é obrigatório');
        url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}/documentos`;
        if (cursor) {
          url += `?cursor=${encodeURIComponent(cursor)}`;
        }
        break;
      case 'buscar_autos':
        if (!numero_cnj) throw new Error('numero_cnj é obrigatório');
        url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}/autos`;
        if (cursor) {
          url += `?cursor=${encodeURIComponent(cursor)}`;
        }
        break;
      case 'download_documento_pdf':
        if (!documento_id) throw new Error('documento_id é obrigatório');
        url = `${ESCAVADOR_BASE}/documentos/${encodeURIComponent(documento_id)}/pdf`;
        break;
      case 'buscar_envolvidos':
        if (!numero_cnj) throw new Error('numero_cnj é obrigatório');
        url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}/envolvidos`;
        if (cursor) {
          url += `?cursor=${encodeURIComponent(cursor)}`;
        }
        break;
      case 'buscar_completo':
        // Fetch process details + movimentações in one call
        if (!numero_cnj) throw new Error('numero_cnj é obrigatório');
        
        // 1. Fetch process details
        const processUrl = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}`;
        console.log(`Escavador process request: GET ${processUrl}`);
        const processResp = await fetch(processUrl, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        });
        const processData = await processResp.json();
        if (!processResp.ok) {
          return new Response(JSON.stringify({
            success: false,
            error: processData.message || processData.error || `Erro ${processResp.status}`,
          }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 2. Fetch movimentações
        const movUrl = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(numero_cnj)}/movimentacoes`;
        console.log(`Escavador movimentações request: GET ${movUrl}`);
        const movResp = await fetch(movUrl, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        });
        let movimentacoes: any[] = [];
        if (movResp.ok) {
          const movData = await movResp.json();
          movimentacoes = movData.items || movData.data || (Array.isArray(movData) ? movData : []);
        }

        return new Response(JSON.stringify({
          success: true,
          data: { ...processData, movimentacoes_detalhadas: movimentacoes },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
      default:
        throw new Error('Ação inválida. Use: buscar_por_numero, buscar_por_nome, buscar_por_cpf_cnpj, buscar_por_oab, buscar_movimentacoes, buscar_documentos, buscar_autos, download_documento_pdf, buscar_envolvidos, buscar_completo');
    }

    console.log(`Escavador request: ${method} ${url}`);

    // For PDF downloads, handle binary response
    if (action === 'download_documento_pdf') {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/pdf',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Escavador PDF error:', response.status, errorText);
        return new Response(JSON.stringify({
          success: false,
          error: `Erro ${response.status} ao baixar PDF`,
          status_code: response.status,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Return PDF as base64
      const pdfBuffer = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));
      
      return new Response(JSON.stringify({
        success: true,
        data: {
          pdf_base64: base64,
          content_type: response.headers.get('content-type') || 'application/pdf',
        },
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Escavador error:', response.status, JSON.stringify(data));
      return new Response(JSON.stringify({
        success: false,
        error: data.message || data.error || `Erro ${response.status} na API do Escavador`,
        status_code: response.status,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
