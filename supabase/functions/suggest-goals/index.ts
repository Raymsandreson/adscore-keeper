import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { user_id, current_goals } = await req.json();

    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const [teamMembersRes, profileRes, boardsRes] = await Promise.all([
      supabase.from("team_members").select("team_id, evaluated_metrics, teams(name, description)").eq("user_id", user_id),
      supabase.from("profiles").select("full_name").eq("user_id", user_id).single(),
      supabase.from("kanban_boards").select("id, name").order("display_order"),
    ]);

    const teamMembers = teamMembersRes.data || [];
    const userName = profileRes.data?.full_name || "Usuário";
    const boards = boardsRes.data || [];

    const allEvaluatedMetrics = new Set<string>();
    const teamContexts: string[] = [];

    for (const tm of teamMembers) {
      const metrics = (tm as any).evaluated_metrics || [];
      metrics.forEach((m: string) => allEvaluatedMetrics.add(m));
      const team = (tm as any).teams;
      if (team) {
        teamContexts.push(`Time "${team.name}": ${team.description || 'Sem descrição'}. Métricas avaliadas: ${metrics.length > 0 ? metrics.join(', ') : 'todas'}`);
      }
    }

    const teamIds = teamMembers.map((tm: any) => tm.team_id).filter(Boolean);
    let commissionGoalsContext = '';
    if (teamIds.length > 0) {
      const { data: commGoals } = await supabase
        .from("commission_goals")
        .select("metric_key, target_value, period, period_start, period_end, team_id")
        .in("team_id", teamIds)
        .eq("is_active", true);

      if (commGoals && commGoals.length > 0) {
        commissionGoalsContext = `\nMETAS DE COMISSÃO DO TIME (referência de expectativa):\n${commGoals.map(g =>
          `- ${g.metric_key}: ${g.target_value} (${g.period}, ${g.period_start} a ${g.period_end})`
        ).join('\n')}`;
      }
    }

    const METRIC_DEFINITIONS = `
MÉTRICAS DISPONÍVEIS POR CATEGORIA:

⚡ METAS DE AÇÃO (diárias):
- calls: Ligações realizadas
- dms_sent: DMs enviadas
- replies: Respostas de comentários
- time_online: Tempo online (minutos)
- contacts_created: Contatos criados
- activities_on_time: Atividades feitas
- leads_created: Leads criados
- follow_requests: Solicitações para seguir

📈 METAS DE PROGRESSO (mensal):
- stages: Fases concluídas (requer board_id)

🏆 METAS DE RESULTADO (mensal):
- deals_closed: Leads fechados (comercial, requer board_id)
- deals_refused: Leads recusados (comercial, requer board_id)
- meta_leads_generated: Leads gerados via Meta (marketing)
- meta_roas: ROAS (marketing)`;

    const evaluatedList = allEvaluatedMetrics.size > 0
      ? `\nMÉTRICAS AVALIADAS PARA ESTE MEMBRO: ${[...allEvaluatedMetrics].join(', ')}\nIMPORTANTE: Sugira metas APENAS para essas métricas.`
      : '\nNenhuma restrição de métricas — sugira as mais relevantes.';

    const currentGoalsStr = current_goals && current_goals.length > 0
      ? `\nMETAS ATUAIS CONFIGURADAS:\n${current_goals.map((g: any) => `- ${g.metric_key}: ${g.target_value} (board: ${g.board_id || 'todos'})`).join('\n')}`
      : '\nNenhuma meta configurada ainda.';

    const boardsList = boards.map((b: any) => `- ${b.id}: ${b.name}`).join('\n');

    const systemPrompt = `Você é um consultor de gestão de metas especialista em produtividade e vendas.
Sua tarefa é analisar o contexto do membro da equipe e sugerir metas de processo equilibradas, alcançáveis e desafiadoras.

CONTEXTO DO MEMBRO:
Nome: ${userName}
${teamContexts.join('\n')}
${evaluatedList}
${commissionGoalsContext}
${currentGoalsStr}

${METRIC_DEFINITIONS}

FUNIS/BOARDS DISPONÍVEIS:
${boardsList}

REGRAS DE CONSISTÊNCIA (CRÍTICAS):
1. Metas de ação diárias × dias úteis (~22) devem ser compatíveis com metas de resultado mensais
2. Se a meta de resultado é "fechar X leads/mês", as ações diárias devem gerar volume suficiente de pipeline
3. Exemplo de INCONSISTÊNCIA: 10 contatos/dia × 22 dias = 220 contatos → não é realista esperar 1000 fechamentos
4. Taxa de conversão típica: 5-15% de contatos → leads qualificados, 10-30% de leads → fechamento
5. Se houver meta de "deals_refused" ela deve ser proporcional a "deals_closed" (normalmente 2-4x mais recusas que fechamentos)
6. Metas de ação devem somar para gerar resultado, não serem arbitrárias
7. Para métricas que precisam de board_id, use um dos boards disponíveis

RESPONDA USANDO TOOL CALLING com a função suggest_goals.`;

    const aiData = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analise o contexto e sugira metas equilibradas para ${userName}. Se houver metas atuais, analise inconsistências e sugira correções.` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "suggest_goals",
            description: "Retorna sugestões de metas com análise de consistência",
            parameters: {
              type: "object",
              properties: {
                analysis: { type: "string", description: "Análise breve da situação atual e inconsistências encontradas (max 300 chars)" },
                inconsistencies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      issue: { type: "string", description: "Descrição da inconsistência" },
                      severity: { type: "string", enum: ["warning", "error"] }
                    },
                    required: ["issue", "severity"]
                  },
                },
                suggested_goals: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      metric_key: { type: "string" },
                      target_value: { type: "number" },
                      board_id: { type: "string", description: "ID do board/funil, null se não aplicável" },
                      reasoning: { type: "string", description: "Justificativa breve para o valor sugerido" }
                    },
                    required: ["metric_key", "target_value", "reasoning"]
                  },
                },
              },
              required: ["analysis", "inconsistencies", "suggested_goals"]
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "suggest_goals" } },
    });

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("IA não retornou sugestões estruturadas");

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("suggest-goals error:", e);
    const status = e instanceof GeminiError ? (e.status === 429 ? 429 : 500) : 500;
    return new Response(JSON.stringify({ error: e.message || "Erro desconhecido" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
