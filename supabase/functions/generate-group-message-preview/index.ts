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
    const { board_name, instructions, participants, lead_fields } = await req.json();

    const fieldLabels: Record<string, string> = {
      lead_name: 'Nome do Lead',
      victim_name: 'Nome da Vítima',
      lead_phone: 'Telefone',
      case_type: 'Tipo de Caso',
      city: 'Cidade',
      state: 'Estado',
      source: 'Origem',
      case_number: 'Número do Caso',
      main_company: 'Empresa Principal',
      contractor_company: 'Empresa Contratante',
      sector: 'Setor',
      neighborhood: 'Bairro',
    };

    const sampleData: Record<string, string> = {
      lead_name: 'Maria Silva vs. Construtora ABC',
      victim_name: 'José Carlos Silva',
      lead_phone: '(86) 99999-1234',
      case_type: 'Acidente de Trabalho - Queda de Altura',
      city: 'Teresina',
      state: 'PI',
      source: 'Instagram',
      case_number: 'CASO 0042',
      main_company: 'Construtora ABC Ltda',
      contractor_company: 'Engenharia XYZ S.A.',
      sector: 'Construção Civil',
      neighborhood: 'Centro',
    };

    const fieldsContext = (lead_fields || ['lead_name']).map((f: string) => {
      const label = fieldLabels[f] || f;
      const value = sampleData[f] || 'Não informado';
      return `- ${label}: ${value}`;
    }).join('\n');

    const systemPrompt = `Você é um assistente que gera mensagens iniciais para grupos de WhatsApp de um escritório de advocacia.

Gere uma mensagem de exemplo usando os DADOS FICTÍCIOS fornecidos abaixo para demonstrar como ficará a mensagem real quando um grupo for criado.

DADOS FICTÍCIOS DO LEAD:
${fieldsContext}
- Data de início: 25/03/2026
- Data envio procuração: 25/03/2026
- Data assinatura: 26/03/2026
- Endereço: Rua das Flores, 123, Centro, Teresina-PI, CEP 64000-000

CAMPOS PERSONALIZADOS FICTÍCIOS:
- Valor estimado da causa: R$ 150.000,00
- Tipo de lesão: Fratura no fêmur
- Tempo de afastamento: 6 meses
- CID: S72.0

ATIVIDADES ABERTAS FICTÍCIAS:
- Coletar documentos médicos (prazo: 28/03/2026) - Link: https://app.exemplo.com/?openActivity=abc123
- Agendar perícia (prazo: 02/04/2026) - Link: https://app.exemplo.com/?openActivity=def456

PARTICIPANTES DO GRUPO:
${participants || '- Nenhum participante configurado'}

FUNIL: ${board_name || 'Não informado'}

${instructions ? `INSTRUÇÕES ADICIONAIS DO USUÁRIO:\n${instructions}` : ''}

Gere a mensagem formatada para WhatsApp usando *negrito*, emojis e organização clara. Use TODOS os dados fictícios acima para mostrar como ficará na prática.`;

    const result = await geminiChat({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Gere a mensagem de pré-visualização do grupo.' },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    const message = result.choices?.[0]?.message?.content || 'Não foi possível gerar a mensagem.';

    return new Response(
      JSON.stringify({ success: true, message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
