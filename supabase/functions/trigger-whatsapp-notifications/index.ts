import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Load notification config
    const { data: config, error: configErr } = await supabase
      .from('whatsapp_notification_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (configErr || !config) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nenhuma configuração de notificação ativa encontrada' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const phones: string[] = config.recipient_phones || []
    if (!phones.length) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nenhum destinatário configurado' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Resolve instance
    let instance: any = null
    if (config.instance_name) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url')
        .eq('instance_name', config.instance_name)
        .eq('is_active', true)
        .single()
      instance = data
    }
    if (!instance) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url')
        .eq('is_active', true)
        .limit(1)
        .single()
      instance = data
    }
    if (!instance) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nenhuma instância WhatsApp ativa encontrada' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const brDate = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const brTime = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

    const sections: string[] = []
    sections.push(`📊 *Relatório de Notificações*`)
    sections.push(`📅 ${brDate} às ${brTime}\n`)

    // ── Overdue Tasks ──
    if (config.notify_overdue_tasks) {
      const thresholdHours = config.overdue_threshold_hours || 24
      const cutoff = new Date(now.getTime() - thresholdHours * 60 * 60 * 1000).toISOString()
      
      const { data: overdue } = await supabase
        .from('lead_activities')
        .select('title, deadline, assigned_to_name')
        .eq('status', 'pending')
        .lt('deadline', now.toISOString())
        .lt('deadline', cutoff)
        .order('deadline', { ascending: true })
        .limit(20)

      sections.push(`⚠️ *Tarefas Atrasadas: ${overdue?.length || 0}*`)
      if (overdue && overdue.length > 0) {
        overdue.forEach((t: any, i: number) => {
          const deadlineDate = t.deadline ? new Date(t.deadline).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
          const assignee = t.assigned_to_name || 'Sem responsável'
          sections.push(`  ${i + 1}. ${t.title || 'Sem título'} (${deadlineDate}) - ${assignee}`)
        })
      } else {
        sections.push(`  ✅ Nenhuma tarefa atrasada`)
      }
      sections.push('')
    }

    // ── Goal Progress ──
    if (config.notify_goal_progress) {
      const alertPercent = config.goal_alert_percent || 50
      
      const { data: goals } = await supabase
        .from('commission_goals')
        .select('metric_key, target_value, period, period_start, period_end')
        .eq('is_active', true)
        .limit(10)

      if (goals && goals.length > 0) {
        sections.push(`🎯 *Metas Ativas: ${goals.length}*`)
        goals.forEach((g: any) => {
          sections.push(`  • ${g.metric_key}: alvo ${g.target_value} (${g.period})`)
        })
      } else {
        sections.push(`🎯 *Metas:* Nenhuma meta ativa configurada`)
      }
      sections.push('')
    }

    // ── Daily Summary ──
    if (config.notify_daily_summary) {
      const todayStart = new Date(now)
      todayStart.setHours(0, 0, 0, 0)

      const { count: activitiesCreated } = await supabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())

      const { count: activitiesCompleted } = await supabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('updated_at', todayStart.toISOString())

      const { count: leadsCreated } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())

      sections.push(`📋 *Resumo do Dia*`)
      sections.push(`  • Atividades criadas: ${activitiesCreated || 0}`)
      sections.push(`  • Atividades concluídas: ${activitiesCompleted || 0}`)
      sections.push(`  • Leads criados: ${leadsCreated || 0}`)
      sections.push('')
    }

    const message = sections.join('\n').trim()

    // Send to all recipients
    const results: any[] = []
    for (const phone of phones) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            phone,
            message,
            instance_id: instance.id,
          }),
        })
        const result = await resp.json()
        results.push({ phone, success: result.success })
      } catch (e) {
        results.push({ phone, success: false, error: String(e) })
      }
    }

    const successCount = results.filter(r => r.success).length

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        total: phones.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Trigger notification error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
