import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mapeamento de status local para status do Facebook
const statusMapping: Record<string, string> = {
  'new': 'POTENTIAL', // Ainda em análise
  'contacted': 'POTENTIAL', // Contatado mas ainda em potencial
  'qualified': 'QUALIFIED', // Lead qualificado
  'not_qualified': 'DISQUALIFIED', // Não qualificado
  'converted': 'CONVERTED', // Converteu/comprou
  'lost': 'DISQUALIFIED', // Perdido = desqualificado
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { leadId, facebookLeadId, status, accessToken } = await req.json();

    console.log('📤 Sincronizando lead com Facebook:', {
      leadId,
      facebookLeadId,
      status,
      hasToken: !!accessToken
    });

    // Validações
    if (!facebookLeadId) {
      console.log('⚠️ Lead sem Facebook Lead ID, não é possível sincronizar');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Este lead não possui um Facebook Lead ID. Leads adicionados manualmente não podem ser sincronizados com o Facebook.',
          code: 'NO_FACEBOOK_LEAD_ID'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }

    if (!accessToken) {
      console.log('❌ Access token não fornecido');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Access token do Facebook não configurado',
          code: 'NO_ACCESS_TOKEN'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }

    const facebookStatus = statusMapping[status] || 'POTENTIAL';
    
    console.log(`📊 Convertendo status: ${status} → ${facebookStatus}`);

    // Chamada para a API do Facebook para atualizar o status do lead
    // Endpoint: POST /{lead-id}
    // Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
    const facebookUrl = `https://graph.facebook.com/v18.0/${facebookLeadId}`;
    
    const response = await fetch(facebookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_token: accessToken,
        status: facebookStatus,
      }),
    });

    const responseText = await response.text();
    console.log('📥 Resposta do Facebook:', response.status, responseText);

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    if (!response.ok) {
      console.error('❌ Erro ao sincronizar com Facebook:', responseData);
      
      // Verifica se é erro de permissão ou lead não encontrado
      if (responseData.error?.code === 100) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Lead não encontrado no Facebook ou sem permissão de acesso',
            code: 'LEAD_NOT_FOUND',
            details: responseData.error
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 404
          }
        );
      }

      if (responseData.error?.code === 190) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Token do Facebook expirado ou inválido',
            code: 'INVALID_TOKEN',
            details: responseData.error
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 401
          }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: responseData.error?.message || 'Erro ao sincronizar com Facebook',
          code: 'FACEBOOK_ERROR',
          details: responseData.error
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: response.status
        }
      );
    }

    console.log('✅ Lead sincronizado com sucesso!');
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Status sincronizado com o Facebook',
        facebookStatus,
        data: responseData
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('❌ Erro na função:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        code: 'INTERNAL_ERROR'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
