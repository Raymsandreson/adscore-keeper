import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, uf } = await req.json();

    if (!name || name.trim().length < 3) {
      return new Response(JSON.stringify({ lawyers: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ESCAVADOR_API_TOKEN = Deno.env.get('ESCAVADOR_API_TOKEN');
    if (!ESCAVADOR_API_TOKEN) {
      throw new Error('ESCAVADOR_API_TOKEN not configured');
    }

    // Use Escavador API v1 to search for people (lawyers)
    const searchTerm = encodeURIComponent(name.trim());
    const url = `https://api.escavador.com/api/v1/busca?q=${searchTerm}&qo=p&limit=20`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ESCAVADOR_API_TOKEN}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Escavador API error [${response.status}]:`, errorText);
      throw new Error(`Escavador API error: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.items || data?.dados || [];

    // Filter to people who have OAB numbers
    const lawyers: Array<{
      name: string;
      oab_number: string;
      oab_uf: string;
    }> = [];

    for (const item of items) {
      const person = item?.conteudo || item;
      const oabNumbers = person?.oab_numero || [];
      const oabUfs = person?.oab_uf || [];
      const personName = person?.nome || '';

      if (oabNumbers.length > 0 && personName) {
        for (let i = 0; i < oabNumbers.length; i++) {
          const oabUf = oabUfs[i] || oabUfs[0] || '';
          
          // If UF filter is set, only include matching UFs
          if (uf && oabUf && oabUf.toUpperCase() !== uf.toUpperCase()) {
            continue;
          }

          lawyers.push({
            name: personName,
            oab_number: String(oabNumbers[i]),
            oab_uf: oabUf.toUpperCase(),
          });
        }
      }
    }

    return new Response(JSON.stringify({ lawyers }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error searching OAB lawyer:', error);
    return new Response(JSON.stringify({ error: error.message, lawyers: [] }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
