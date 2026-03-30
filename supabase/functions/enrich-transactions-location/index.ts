import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function lookupCNPJ(cnpj: string): Promise<{ city: string; state: string } | null> {
  try {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (cleanCnpj.length !== 14) return null;
    
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      city: data.municipio || null,
      state: data.uf || null,
    };
  } catch (error) {
    console.error(`Error looking up CNPJ ${cnpj}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get transactions with CNPJ but without city/state
    const { data: transactions, error: fetchError } = await supabase
      .from('credit_card_transactions')
      .select('id, merchant_cnpj')
      .not('merchant_cnpj', 'is', null)
      .or('merchant_city.is.null,merchant_state.is.null')
      .limit(50); // Process in batches to avoid timeout

    if (fetchError) throw fetchError;

    console.log(`Found ${transactions?.length || 0} transactions to enrich`);

    let enrichedCount = 0;
    const results: any[] = [];

    for (const transaction of transactions || []) {
      const location = await lookupCNPJ(transaction.merchant_cnpj);
      
      if (location && (location.city || location.state)) {
        const { error: updateError } = await supabase
          .from('credit_card_transactions')
          .update({
            merchant_city: location.city,
            merchant_state: location.state,
          })
          .eq('id', transaction.id);

        if (!updateError) {
          enrichedCount++;
          results.push({
            id: transaction.id,
            cnpj: transaction.merchant_cnpj,
            city: location.city,
            state: location.state,
          });
        }
      }

      // Rate limiting - BrasilAPI has limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Enriched ${enrichedCount} of ${transactions?.length || 0} transactions`,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error enriching transactions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
