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

    // Parse optional target_user_id for per-user sending
    let targetUserId: string | null = null
    try {
      const body = await req.json()
      targetUserId = body?.target_user_id || null
    } catch {
      // No body or invalid JSON — send to all
    }

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

    // Determine target phones
    let phones: string[] = []
    let targetName = ''

    if (targetUserId) {
      // Send only to this specific user
      const { data: profile } = await supabase
        .from('profiles')
        .select('phone, full_name')
        .eq('user_id', targetUserId)
        .single()

      if (!profile?.phone) {
        return new Response(
          JSON.stringify({ success: false, error: 'Usuário não possui telefone cadastrado no perfil' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      phones = [profile.phone]
      targetName = profile.full_name || ''
    } else {
      phones = config.recipient_phones || []
    }

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
    if (targetName) {
      sections.push(`👤 Para: ${targetName}`)
    }
    sections.push(`📅 ${brDate} às ${brTime}\n`)

    // ── Overdue Tasks ──
    if (config.notify_overdue_tasks) {
      const thresholdHours = config.overdue_threshold_hours || 24
      const cutoff = new Date(now.getTime() - thresholdHours * 60 * 60 * 1000).toISOString()
      
      let query = supabase
        .from('lead_activities')
        .select('title, deadline, assigned_to_name, assigned_to')
        .eq('status', 'pending')
        .lt('deadline', now.toISOString())
        .lt('deadline', cutoff)
        .order('deadline', { ascending: true })
        .limit(20)

      if (targetUserId) {
        query = query.eq('assigned_to', targetUserId)
      }

      const { data: overdue } = await query

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
      let goalQuery = supabase
        .from('commission_goals')
        .select('metric_key, target_value, period, period_start, period_end, user_id')
        .eq('is_active', true)
        .limit(10)

      if (targetUserId) {
        goalQuery = goalQuery.eq('user_id', targetUserId)
      }

      const { data: goals } = await goalQuery

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

      let actCreatedQ = supabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())

      let actCompletedQ = supabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('updated_at', todayStart.toISOString())

      if (targetUserId) {
        actCreatedQ = actCreatedQ.eq('assigned_to', targetUserId)
        actCompletedQ = actCompletedQ.eq('assigned_to', targetUserId)
      }

      const { count: activitiesCreated } = await actCreatedQ
      const { count: activitiesCompleted } = await actCompletedQ

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

    // ── WhatsApp Dashboard Report ──
    if (config.notify_whatsapp_dashboard) {
      const todayStart = new Date(now)
      todayStart.setHours(0, 0, 0, 0)
      const sinceIso = todayStart.toISOString()

      const dashInstanceNames: string[] = (config as any).dashboard_instance_names || []
      const filterByInstance = dashInstanceNames.length > 0

      // Fetch inbound messages (new conversations)
      const fetchPaginated = async (direction: string) => {
        const allRows: any[] = []
        let from = 0
        const pageSize = 1000
        while (true) {
          let q = supabase
            .from('whatsapp_messages')
            .select('phone, contact_name, created_at, instance_name, lead_id')
            .eq('direction', direction)
            .not('phone', 'like', '%@g.us')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: true })
            .range(from, from + pageSize - 1)
          if (filterByInstance) q = q.in('instance_name', dashInstanceNames)
          const { data } = await q
          if (!data || data.length === 0) break
          allRows.push(...data)
          if (data.length < pageSize) break
          from += pageSize
        }
        return allRows
      }

      const [inboundMsgs, outboundMsgs] = await Promise.all([
        fetchPaginated('inbound'),
        fetchPaginated('outbound'),
      ])

      // Unique new conversations (first inbound per phone today)
      const phoneFirstInbound = new Map<string, any>()
      for (const m of inboundMsgs) {
        if (!phoneFirstInbound.has(m.phone)) phoneFirstInbound.set(m.phone, m)
      }
      const newConversations = phoneFirstInbound.size

      // Outbound phones set
      const outboundPhones = new Set(outboundMsgs.map((m: any) => m.phone))

      // Responded conversations
      let respondedCount = 0
      let totalResponseMinutes = 0
      let responseCount = 0
      for (const [phone, firstIn] of phoneFirstInbound) {
        if (outboundPhones.has(phone)) {
          respondedCount++
          const firstOut = outboundMsgs.find((m: any) => m.phone === phone && new Date(m.created_at) > new Date(firstIn.created_at))
          if (firstOut) {
            const diff = Math.round((new Date(firstOut.created_at).getTime() - new Date(firstIn.created_at).getTime()) / 60000)
            totalResponseMinutes += diff
            responseCount++
          }
        }
      }
      const waitingCount = newConversations - respondedCount
      const avgResponseMin = responseCount > 0 ? Math.round(totalResponseMinutes / responseCount) : 0

      // Contacts created today
      let contactsQ = supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso)
      const { count: contactsCreated } = await contactsQ

      // Documents signed today
      const { count: docsCount } = await supabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .eq('activity_type', 'documento')
        .gte('created_at', sinceIso)

      // Format response time
      const fmtTime = (min: number) => {
        if (min < 60) return `${min}min`
        const h = Math.floor(min / 60)
        const m = min % 60
        return m > 0 ? `${h}h${m}m` : `${h}h`
      }

      const instanceLabel = filterByInstance
        ? `(${dashInstanceNames.join(', ')})`
        : '(todas as instâncias)'

      sections.push(`📱 *Relatório WhatsApp* ${instanceLabel}`)
      sections.push(`  • Conversas novas: ${newConversations}`)
      sections.push(`  • Respondidas: ${respondedCount} | Aguardando: ${waitingCount}`)
      sections.push(`  • Tempo médio de resposta: ${responseCount > 0 ? fmtTime(avgResponseMin) : 'N/A'}`)
      sections.push(`  • Contatos criados: ${contactsCreated || 0}`)
      sections.push(`  • Documentos: ${docsCount || 0}`)
      sections.push(`  • Total mensagens: ${inboundMsgs.length} recebidas / ${outboundMsgs.length} enviadas`)
      sections.push('')
    }

    const message = sections.join('\n').trim()

    // Send to all target phones
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