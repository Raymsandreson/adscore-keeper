import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { goal, history } = await req.json();
    const apiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!apiKey) {
      throw new Error('API key não configurada');
    }

    const systemPrompt = `Você é um especialista em marketing digital e growth hacking. Sua tarefa é analisar metas de marketing e fornecer sugestões práticas e acionáveis para ajudar a atingi-las.

CONTEXTO DA META:
- Título: ${goal.title}
- Tipo: ${goal.type}
- Valor Atual: ${goal.currentValue} ${goal.unit}
- Meta: ${goal.targetValue} ${goal.unit}
- Progresso: ${goal.progress}%
- Dias restantes: ${goal.daysLeft}
- Status: ${goal.status}

${history && history.length > 0 ? `
HISTÓRICO DE METAS ANTERIORES (para contexto):
${history.map((h: any) => `- ${h.goal_title}: ${h.achieved_value}/${h.target_value} (${h.achievement_percentage}%) - ${h.status}`).join('\n')}
` : ''}

INSTRUÇÕES:
1. Analise o progresso atual em relação à meta
2. Calcule o ritmo diário necessário para atingir a meta
3. Forneça 3-5 sugestões práticas e específicas baseadas no tipo de meta
4. Considere o histórico para identificar padrões de sucesso ou falha
5. Seja direto e objetivo

FORMATO DA RESPOSTA (use markdown):
## 📊 Análise do Progresso
[Breve análise do status atual]

## 🎯 Ritmo Necessário
[Cálculo do que precisa ser feito por dia/semana]

## 💡 Sugestões para Atingir a Meta
1. **[Título da sugestão]**: [Detalhes práticos]
2. ...

## ⚠️ Pontos de Atenção
[Se houver riscos ou alertas baseados no histórico]`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Por favor, analise minha meta "${goal.title}" e me dê sugestões para atingi-la.` }
        ],
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Erro na API: ${error}`);
    }

    const data = await response.json();
    const suggestion = data.choices[0]?.message?.content || 'Não foi possível gerar sugestões.';

    return new Response(
      JSON.stringify({ suggestion }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Erro:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
