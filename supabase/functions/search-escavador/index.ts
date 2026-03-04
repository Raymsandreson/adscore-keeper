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

    const { action, numero_cnj, nome, cpf_cnpj } = await req.json();

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
        // Remove formatting
        const clean = cpf_cnpj.replace(/[.\-\/]/g, '');
        if (clean.length === 11) {
          url = `${ESCAVADOR_BASE}/processos/cpf/${clean}`;
        } else {
          url = `${ESCAVADOR_BASE}/processos/cnpj/${clean}`;
        }
        break;
      default:
        throw new Error('Ação inválida. Use: buscar_por_numero, buscar_por_nome, buscar_por_cpf_cnpj');
    }

    console.log(`Escavador request: ${method} ${url}`);

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
