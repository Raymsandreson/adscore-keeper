import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { phone, instance_name, message_text, member_user_id, member_name } = await req.json()
    if (!phone || !instance_name || !message_text) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get instance credentials for sending reply
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url')
      .eq('instance_name', instance_name)
      .eq('is_active', true)
      .single()

    if (!inst) {
      console.error('No active instance found:', instance_name)
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Load conversation history for context (last 20 messages)
    const { data: history } = await supabase
      .from('whatsapp_messages')
      .select('direction, message_text, created_at')
      .eq('phone', phone)
      .eq('instance_name', instance_name)
      .not('message_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)

    const conversationMessages = (history || [])
      .reverse()
      .filter((m: any) => m.message_text?.trim())
      .map((m: any) => ({
        role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
        content: m.message_text,
      }))

    // Build tools for the AI
    const tools = [
      {
        type: "function",
        function: {
          name: "get_overdue_tasks",
          description: "Busca tarefas/atividades atrasadas do membro ou de toda a equipe",
          parameters: {
            type: "object",
            properties: {
              scope: { type: "string", enum: ["mine", "all"], description: "mine = apenas do membro, all = toda equipe" },
              limit: { type: "number", description: "Quantidade máxima de resultados" },
            },
            required: ["scope"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_daily_summary",
          description: "Gera um resumo de produtividade do dia (atividades criadas, concluídas, leads novos)",
          parameters: {
            type: "object",
            properties: {
              scope: { type: "string", enum: ["mine", "all"], description: "mine = apenas do membro, all = toda equipe" },
            },
            required: ["scope"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_leads_summary",
          description: "Retorna informações sobre leads recentes, contagem por etapa, ou detalhes de um lead específico",
          parameters: {
            type: "object",
            properties: {
              scope: { type: "string", enum: ["mine", "all"] },
              search: { type: "string", description: "Nome do lead para buscar (opcional)" },
              limit: { type: "number" },
            },
            required: ["scope"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_activity",
          description: "Cria uma nova atividade/tarefa no sistema",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Título da atividade" },
              description: { type: "string", description: "Descrição detalhada" },
              priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"] },
              deadline: { type: "string", description: "Data limite no formato YYYY-MM-DD" },
              lead_name: { type: "string", description: "Nome do lead associado (opcional)" },
            },
            required: ["title"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_goals_progress",
          description: "Consulta o progresso das metas (comissões) ativas",
          parameters: {
            type: "object",
            properties: {
              scope: { type: "string", enum: ["mine", "all"] },
            },
            required: ["scope"],
          },
        },
      },
    ]

    const systemPrompt = `Você é o assistente interno da equipe, acessado via WhatsApp. 
O membro que está falando com você é: ${member_name || 'Membro da equipe'} (ID: ${member_user_id}).

Você pode:
- Buscar tarefas atrasadas (do membro ou da equipe)
- Gerar resumos de produtividade do dia
- Consultar leads e seus status
- Criar novas atividades/tarefas
- Consultar progresso de metas

Regras:
- Responda de forma concisa e direta, formatado para WhatsApp (use *negrito* e listas com •)
- Quando o usuário pedir algo vago como "resumo", use a ferramenta get_daily_summary
- Quando perguntar sobre tarefas, use get_overdue_tasks
- Sempre execute as ferramentas necessárias antes de responder
- Use "mine" como scope padrão, a menos que o membro peça informações da equipe toda
- Ao criar atividades, preencha campos automaticamente com base no contexto (prioridade, deadline)
- Inclua emojis relevantes nas respostas para melhor legibilidade`

    // First AI call with tools
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationMessages.slice(-10), // Last 10 for context
      { role: 'user' as const, content: message_text },
    ]

    let response = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: aiMessages,
      tools,
    })

    let assistantMessage = response.choices?.[0]?.message
    let finalText = assistantMessage?.content || ''

    // Process tool calls if any
    if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolResults: any[] = []

      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function?.name
        const fnArgs = JSON.parse(toolCall.function?.arguments || '{}')
        
        console.log('Executing tool:', fnName, 'with args:', fnArgs)
        
        let result: any = null

        try {
          if (fnName === 'get_overdue_tasks') {
            result = await executeGetOverdueTasks(supabase, fnArgs, member_user_id)
          } else if (fnName === 'get_daily_summary') {
            result = await executeGetDailySummary(supabase, fnArgs, member_user_id)
          } else if (fnName === 'get_leads_summary') {
            result = await executeGetLeadsSummary(supabase, fnArgs, member_user_id)
          } else if (fnName === 'create_activity') {
            result = await executeCreateActivity(supabase, fnArgs, member_user_id, member_name)
          } else if (fnName === 'get_goals_progress') {
            result = await executeGetGoalsProgress(supabase, fnArgs, member_user_id)
          }
        } catch (e) {
          result = { error: String(e) }
        }

        toolResults.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result || { error: 'Unknown tool' }),
        })
      }

      // Second AI call with tool results
      const followUpMessages = [
        ...aiMessages,
        assistantMessage,
        ...toolResults,
      ]

      const followUp = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: followUpMessages,
      })

      finalText = followUp.choices?.[0]?.message?.content || 'Não consegui processar sua solicitação.'
    }

    if (!finalText) {
      finalText = 'Desculpe, não consegui gerar uma resposta. Tente novamente.'
    }

    // Send reply via WhatsApp
    const sendResp = await fetch(`${inst.base_url}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
      body: JSON.stringify({ number: phone, text: finalText }),
    })

    const sendResult = await sendResp.json().catch(() => ({}))
    console.log('Member assistant reply sent:', sendResp.status, 'to:', phone)

    return new Response(
      JSON.stringify({ success: true, reply_sent: sendResp.ok }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Member AI assistant error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ========== TOOL IMPLEMENTATIONS ==========

async function executeGetOverdueTasks(supabase: any, args: any, userId: string) {
  const now = new Date()
  let query = supabase
    .from('lead_activities')
    .select('title, deadline, assigned_to_name, status, priority, lead_name')
    .in('status', ['pendente', 'pending', 'em_andamento'])
    .lt('deadline', now.toISOString())
    .order('deadline', { ascending: true })
    .limit(args.limit || 15)

  if (args.scope === 'mine') {
    query = query.eq('assigned_to', userId)
  }

  const { data, error } = await query
  if (error) return { error: error.message }
  
  return {
    total: data?.length || 0,
    tasks: (data || []).map((t: any) => ({
      title: t.title,
      deadline: t.deadline,
      assigned_to: t.assigned_to_name,
      priority: t.priority,
      lead: t.lead_name,
      status: t.status,
    })),
  }
}

async function executeGetDailySummary(supabase: any, args: any, userId: string) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()

  const buildQuery = (base: any) => args.scope === 'mine' ? base.eq('assigned_to', userId) : base

  const [created, completed, leadsNew] = await Promise.all([
    buildQuery(supabase.from('lead_activities').select('id', { count: 'exact', head: true }).gte('created_at', todayIso)),
    buildQuery(supabase.from('lead_activities').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('updated_at', todayIso)),
    supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
  ])

  return {
    activities_created: created.count || 0,
    activities_completed: completed.count || 0,
    leads_created: leadsNew.count || 0,
  }
}

async function executeGetLeadsSummary(supabase: any, args: any, userId: string) {
  let query = supabase
    .from('leads')
    .select('id, lead_name, current_stage, assigned_to, created_at, lead_value')
    .order('created_at', { ascending: false })
    .limit(args.limit || 10)

  if (args.scope === 'mine') {
    query = query.eq('assigned_to', userId)
  }

  if (args.search) {
    query = query.ilike('lead_name', `%${args.search}%`)
  }

  const { data, error } = await query
  if (error) return { error: error.message }

  return {
    total: data?.length || 0,
    leads: (data || []).map((l: any) => ({
      name: l.lead_name,
      stage: l.current_stage,
      value: l.lead_value,
      created: l.created_at,
    })),
  }
}

async function executeCreateActivity(supabase: any, args: any, userId: string, userName: string) {
  const { data, error } = await supabase
    .from('lead_activities')
    .insert({
      title: args.title,
      description: args.description || null,
      priority: args.priority || 'normal',
      deadline: args.deadline || new Date().toISOString().split('T')[0],
      activity_type: 'tarefa',
      status: 'pendente',
      assigned_to: userId,
      assigned_to_name: userName,
      created_by: userId,
      lead_name: args.lead_name || null,
    })
    .select('id, title')
    .single()

  if (error) return { error: error.message }

  const appUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '') || ''
  return {
    success: true,
    activity_id: data.id,
    title: data.title,
    link: `/?openActivity=${data.id}`,
  }
}

async function executeGetGoalsProgress(supabase: any, args: any, userId: string) {
  let query = supabase
    .from('commission_goals')
    .select('metric_key, target_value, period, period_start, period_end, ote_value')
    .eq('is_active', true)
    .limit(10)

  if (args.scope === 'mine') {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query
  if (error) return { error: error.message }

  return {
    total: data?.length || 0,
    goals: (data || []).map((g: any) => ({
      metric: g.metric_key,
      target: g.target_value,
      period: g.period,
      period_start: g.period_start,
      period_end: g.period_end,
      ote: g.ote_value,
    })),
  }
}
