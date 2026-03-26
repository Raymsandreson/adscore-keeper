import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { board_name, board_id, instructions, participants, lead_fields, refinement, current_message } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch existing custom fields for this board to check what exists
    let existingCustomFields: string[] = [];
    if (board_id) {
      const { data: fields } = await supabase
        .from('lead_custom_fields')
        .select('field_name')
        .or(`board_id.eq.${board_id},board_id.is.null`);
      existingCustomFields = (fields || []).map((f: any) => f.field_name);
    }

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

    // Analyze instructions to detect fields that may not exist
    const instructionFieldAnalysis = existingCustomFields.length > 0
      ? `\nCAMPOS PERSONALIZADOS EXISTENTES NO SISTEMA:\n${existingCustomFields.map(f => `- ${f}`).join('\n')}\n\nIMPORTANTE: Após gerar a mensagem, analise as instruções do usuário. Se as instruções mencionam informações que NÃO existem como campos personalizados no sistema (listados acima), adicione ao final uma seção "⚠️ OBSERVAÇÃO PARA O ADMINISTRADOR:" listando quais campos personalizados precisam ser CRIADOS no sistema para que essas informações possam ser preenchidas e usadas na mensagem real. Exemplo: se as instruções pedem "data provável do parto" mas esse campo não existe, sugira a criação dele.`
      : `\nNENHUM CAMPO PERSONALIZADO foi encontrado para este funil. Se as instruções mencionam informações específicas (como datas, valores, condições), adicione ao final uma seção "⚠️ OBSERVAÇÃO PARA O ADMINISTRADOR:" sugerindo quais campos personalizados devem ser CRIADOS no sistema.`;

    const systemPrompt = `Você é um assistente que gera mensagens iniciais para grupos de WhatsApp de um escritório de advocacia.

Gere uma mensagem COMPLETA de exemplo usando os DADOS FICTÍCIOS fornecidos abaixo para demonstrar como ficará a mensagem real quando um grupo for criado. NÃO corte ou encurte a mensagem.

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
${instructionFieldAnalysis}

Gere a mensagem COMPLETA formatada para WhatsApp usando *negrito*, emojis e organização clara. Use TODOS os dados fictícios acima para mostrar como ficará na prática. A mensagem deve ser EXTENSA e DETALHADA, incluindo todas as seções solicitadas nas instruções.`;

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (refinement && current_message) {
      // Refinement mode: send current message as assistant, then refinement as user
      messages.push({ role: 'assistant', content: current_message });
      messages.push({ role: 'user', content: `Refine a mensagem acima com a seguinte instrução: ${refinement}\n\nRetorne a mensagem COMPLETA refinada, não apenas as alterações.` });
    } else {
      messages.push({ role: 'user', content: 'Gere a mensagem de pré-visualização COMPLETA do grupo, sem cortar nenhuma seção.' });
    }

    const result = await geminiChat({
      model: 'google/gemini-2.5-flash',
      messages,
      temperature: 0.7,
      max_tokens: 8192,
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
