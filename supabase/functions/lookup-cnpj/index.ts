import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CNPJResponse {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  municipio: string;
  uf: string;
  situacao_cadastral: string;
}

async function lookupCNPJ(cnpj: string): Promise<{ city: string; state: string } | null> {
  // Clean CNPJ - remove non-numeric characters
  const cleanCnpj = cnpj.replace(/\D/g, '');
  
  if (cleanCnpj.length !== 14) {
    console.log('Invalid CNPJ length:', cleanCnpj.length);
    return null;
  }

  try {
    // Use BrasilAPI - free and reliable
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.log('CNPJ lookup failed:', response.status);
      return null;
    }

    const data: CNPJResponse = await response.json();
    
    if (data.municipio && data.uf) {
      return {
        city: data.municipio,
        state: data.uf
      };
    }
  } catch (error) {
    console.error('Error looking up CNPJ:', error);
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj } = await req.json();

    if (!cnpj) {
      return new Response(
        JSON.stringify({ error: 'CNPJ is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const location = await lookupCNPJ(cnpj);

    if (location) {
      return new Response(
        JSON.stringify({ success: true, ...location }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, message: 'Location not found for CNPJ' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
