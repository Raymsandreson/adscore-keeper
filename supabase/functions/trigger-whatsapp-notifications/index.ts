import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// External DB for business data (leads, activities, messages, notification config)
function resolveSupabaseUrl(): string {
  const candidates = [Deno.env.get('EXTERNAL_SUPABASE_URL'), Deno.env.get('SUPABASE_URL')];
  for (const c of candidates) { const v = (c || '').trim(); if (v.startsWith('https://') || v.startsWith('http://')) return v; }
  return 'https://kmedldlepwiityjsdahz.supabase.co';
}
const EXTERNAL_URL = resolveSupabaseUrl();
const EXTERNAL_KEY = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Cloud DB for profiles & whatsapp_instances (user_ids from Cloud auth)
const CLOUD_URL = Deno.env.get('SUPABASE_URL') || '';
const CLOUD_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // External DB for business data (notification config, leads, activities, messages)
    const supabase = createClient(EXTERNAL_URL, EXTERNAL_KEY)
    // Cloud DB for profiles & whatsapp_instances (auth user_ids match)
    const cloudDb = createClient(CLOUD_URL, CLOUD_KEY)

    let targetUserId: string | null = null
    let isScheduled = false
    try {
      const body = await req.json()
      targetUserId = body?.target_user_id || null
      isScheduled = body?.scheduled === true
    } catch {
      // No body
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

    // If triggered by cron, check schedule
    if (isScheduled) {
      const now = new Date()
      const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      const currentHH = String(brNow.getHours()).padStart(2, '0')
      const currentMM = String(brNow.getMinutes()).padStart(2, '0')
      const currentTime = `${currentHH}:${currentMM}`
      const currentDay = brNow.getDay()

      const scheduleTimes: string[] = (config as any).schedule_times || (config as any).dashboard_schedule_times || []
      const scheduleDays: number[] = (config as any).schedule_days || (config as any).dashboard_schedule_days || [1, 2, 3, 4, 5]

      const timeMatch = scheduleTimes.some((t: string) => t === currentTime)
      const dayMatch = scheduleDays.includes(currentDay)

      if (!timeMatch || !dayMatch) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: `Not scheduled now (${currentTime}, day ${currentDay})` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Resolve instance for sending
    let instance: any = null
    if (config.instance_name) {
      const { data } = await cloudDb
        .from('whatsapp_instances')
        .select('id, instance_name, instance_token, base_url')
        .eq('instance_name', config.instance_name)
        .eq('is_active', true)
        .single()
      instance = data
    }
    if (!instance) {
      const { data } = await cloudDb
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

    // Build recipient list with user context
    interface Recipient {
      phone: string
      userId: string | null
      fullName: string
      instanceNames: string[] // which instances to report for this user
    }

    const recipients: Recipient[] = []

    if (targetUserId) {
      const { data: profile } = await cloudDb
        .from('profiles')
        .select('phone, full_name, default_instance_id')
        .eq('user_id', targetUserId)
        .single()

      if (!profile?.phone) {
        return new Response(
          JSON.stringify({ success: false, error: 'Usuário não possui telefone cadastrado' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get user's instance name
      let userInstanceNames: string[] = []
      if (profile.default_instance_id) {
        const { data: inst } = await cloudDb
          .from('whatsapp_instances')
          .select('instance_name')
          .eq('id', profile.default_instance_id)
          .single()
        if (inst) userInstanceNames = [inst.instance_name]
      }

      recipients.push({
        phone: profile.phone,
        userId: targetUserId,
        fullName: profile.full_name || '',
        instanceNames: userInstanceNames,
      })
    } else {
      // Get all recipient user IDs with their profiles
      const recipientUserIds: string[] = config.recipient_user_ids || []
      const recipientPhones: string[] = config.recipient_phones || []

      if (recipientUserIds.length > 0) {
        const { data: profiles } = await cloudDb
          .from('profiles')
          .select('user_id, phone, full_name, default_instance_id')
          .in('user_id', recipientUserIds)

        if (profiles) {
          // Get all instance names in one query
          const instanceIds = profiles
            .map(p => p.default_instance_id)
            .filter(Boolean) as string[]

          let instanceMap: Record<string, string> = {}
          if (instanceIds.length > 0) {
            const { data: instances } = await supabase
              .from('whatsapp_instances')
              .select('id, instance_name')
              .in('id', instanceIds)
            if (instances) {
              instanceMap = Object.fromEntries(instances.map(i => [i.id, i.instance_name]))
            }
          }

          for (const p of profiles) {
            if (!p.phone) continue
            const instName = p.default_instance_id ? instanceMap[p.default_instance_id] : null
            recipients.push({
              phone: p.phone,
              userId: p.user_id,
              fullName: p.full_name || '',
              instanceNames: instName ? [instName] : [],
            })
          }
        }
      } else if (recipientPhones.length > 0) {
        // Fallback: match phones to profiles
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, phone, full_name, default_instance_id')
          .in('phone', recipientPhones)

        const instanceIds = (profiles || [])
          .map(p => p.default_instance_id)
          .filter(Boolean) as string[]

        let instanceMap: Record<string, string> = {}
        if (instanceIds.length > 0) {
          const { data: instances } = await supabase
            .from('whatsapp_instances')
            .select('id, instance_name')
            .in('id', instanceIds)
          if (instances) {
            instanceMap = Object.fromEntries(instances.map(i => [i.id, i.instance_name]))
          }
        }

        for (const phone of recipientPhones) {
          const profile = (profiles || []).find(p => p.phone === phone)
          const instName = profile?.default_instance_id ? instanceMap[profile.default_instance_id] : null
          recipients.push({
            phone,
            userId: profile?.user_id || null,
            fullName: profile?.full_name || '',
            instanceNames: instName ? [instName] : [],
          })
        }
      }
    }

    if (!recipients.length) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nenhum destinatário configurado' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const brDate = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const brTime = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

    // Send personalized report to each recipient
    const results: any[] = []

    for (const recipient of recipients) {
      try {
        const message = await buildPersonalizedReport(
          supabase, config, recipient, now, brDate, brTime
        )

        const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            phone: recipient.phone,
            message,
            instance_id: instance.id,
          }),
        })
        const result = await resp.json()
        results.push({ phone: recipient.phone, name: recipient.fullName, success: result.success })
      } catch (e) {
        results.push({ phone: recipient.phone, name: recipient.fullName, success: false, error: String(e) })
      }
    }

    const successCount = results.filter(r => r.success).length

    return new Response(
      JSON.stringify({ success: true, sent: successCount, total: recipients.length, results }),
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

async function buildPersonalizedReport(
  supabase: any,
  config: any,
  recipient: { phone: string; userId: string | null; fullName: string; instanceNames: string[] },
  now: Date,
  brDate: string,
  brTime: string
): Promise<string> {
  const sections: string[] = []
  sections.push(`📊 *Relatório de Notificações*`)
  sections.push(`👤 ${recipient.fullName || 'Usuário'}`)
  sections.push(`📅 ${brDate} às ${brTime}\n`)

  const userId = recipient.userId

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

    if (userId) {
      query = query.eq('assigned_to', userId)
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

    if (userId) {
      goalQuery = goalQuery.eq('user_id', userId)
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
    // Use São Paulo timezone for "today" start
    const brStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    const brD = new Date(brStr)
    const todayStart = new Date(Date.UTC(brD.getFullYear(), brD.getMonth(), brD.getDate(), 3, 0, 0, 0))

    let actCreatedQ = supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString())

    let actCompletedQ = supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('updated_at', todayStart.toISOString())

    if (userId) {
      actCreatedQ = actCreatedQ.eq('assigned_to', userId)
      actCompletedQ = actCompletedQ.eq('assigned_to', userId)
    }

    const { count: activitiesCreated } = await actCreatedQ
    const { count: activitiesCompleted } = await actCompletedQ

    // Leads created - filter by user if possible
    let leadsQ = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString())

    if (userId) {
      leadsQ = leadsQ.eq('created_by', userId)
    }

    const { count: leadsCreated } = await leadsQ

    sections.push(`📋 *Resumo do Dia*`)
    sections.push(`  • Atividades criadas: ${activitiesCreated || 0}`)
    sections.push(`  • Atividades concluídas: ${activitiesCompleted || 0}`)
    sections.push(`  • Leads criados: ${leadsCreated || 0}`)
    sections.push('')
  }

  // ── WhatsApp Dashboard Report ──
  if (config.notify_whatsapp_dashboard) {
    // Use São Paulo timezone for "today" start
    const brNowStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    const brNowDate = new Date(brNowStr)
    const brYear = brNowDate.getFullYear()
    const brMonth = brNowDate.getMonth()
    const brDay = brNowDate.getDate()
    // Midnight in São Paulo = +3h in UTC
    const todayStartBR = new Date(Date.UTC(brYear, brMonth, brDay, 3, 0, 0, 0))
    const sinceIso = todayStartBR.toISOString()

    // Use the user's own instance(s) for filtering, not the global config list
    const userInstances = recipient.instanceNames.length > 0
      ? recipient.instanceNames
      : ((config as any).dashboard_instance_names || [])
    const filterByInstance = userInstances.length > 0

    const instanceLabel = filterByInstance
      ? `(${userInstances.join(', ')})`
      : '(todas as instâncias)'

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
        if (filterByInstance) q = q.in('instance_name', userInstances)
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

    // Unique phones with inbound messages today = total conversations
    const phoneFirstInbound = new Map<string, any>()
    for (const m of inboundMsgs) {
      if (!phoneFirstInbound.has(m.phone)) phoneFirstInbound.set(m.phone, m)
    }
    const totalConversations = phoneFirstInbound.size

    // Determine truly NEW conversations (no messages before today)
    let newConversations = 0
    if (totalConversations > 0) {
      const phonesToCheck = Array.from(phoneFirstInbound.keys())
      // Check in batches of 50
      for (let i = 0; i < phonesToCheck.length; i += 50) {
        const batch = phonesToCheck.slice(i, i + 50)
        let priorQ = supabase
          .from('whatsapp_messages')
          .select('phone')
          .in('phone', batch)
          .lt('created_at', sinceIso)
          .limit(batch.length)
        if (filterByInstance) priorQ = priorQ.in('instance_name', userInstances)
        const { data: priorMsgs } = await priorQ
        const phonesWithHistory = new Set((priorMsgs || []).map((m: any) => m.phone))
        for (const p of batch) {
          if (!phonesWithHistory.has(p)) newConversations++
        }
      }
    }

    const outboundPhones = new Set(outboundMsgs.map((m: any) => m.phone))

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
    const waitingCount = totalConversations - respondedCount
    const avgResponseMin = responseCount > 0 ? Math.round(totalResponseMinutes / responseCount) : 0

    // Contacts created today
    const { count: contactsCreated } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso)

    // Documents
    let docsQ = supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('activity_type', 'documento')
      .gte('created_at', sinceIso)
    if (userId) {
      docsQ = docsQ.eq('assigned_to', userId)
    }
    const { count: docsCount } = await docsQ

    const fmtTime = (min: number) => {
      if (min < 60) return `${min}min`
      const h = Math.floor(min / 60)
      const m = min % 60
      return m > 0 ? `${h}h${m}m` : `${h}h`
    }

    sections.push(`📱 *Relatório WhatsApp* ${instanceLabel}`)
    sections.push(`  • Conversas: ${totalConversations}`)
    sections.push(`  • Conversas novas: ${newConversations}`)
    sections.push(`  • Respondidas: ${respondedCount} | Aguardando: ${waitingCount}`)
    sections.push(`  • Tempo médio de resposta: ${responseCount > 0 ? fmtTime(avgResponseMin) : 'N/A'}`)
    sections.push(`  • Contatos criados: ${contactsCreated || 0}`)
    sections.push(`  • Documentos: ${docsCount || 0}`)
    sections.push(`  • Total mensagens: ${inboundMsgs.length} recebidas / ${outboundMsgs.length} enviadas`)
    sections.push('')

    // ── Leads by status today ──
    const closedStageIds = ['closed', 'fechado', 'done']
    const refusedStageIds = ['recusado', 'not_qualified', 'lost']

    // Leads closed today (moved to closed stage today)
    let closedQ = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .in('status', closedStageIds)
      .gte('updated_at', sinceIso)
    if (userId) closedQ = closedQ.eq('assigned_to', userId)
    const { count: closedToday } = await closedQ

    // Leads refused today
    let refusedQ = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .in('status', refusedStageIds)
      .gte('updated_at', sinceIso)
    if (userId) refusedQ = refusedQ.eq('assigned_to', userId)
    const { count: refusedToday } = await refusedQ

    // Leads in progress (not closed/refused, created today)
    let inProgressQ = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', `(${[...closedStageIds, ...refusedStageIds].join(',')})`)
      .gte('created_at', sinceIso)
    if (userId) inProgressQ = inProgressQ.eq('assigned_to', userId)
    const { count: inProgressToday } = await inProgressQ

    // All leads created today
    let allLeadsQ = supabase
      .from('leads')
      .select('id, created_at', { count: 'exact' })
      .gte('created_at', sinceIso)
    if (userId) allLeadsQ = allLeadsQ.eq('assigned_to', userId)
    const { data: allLeadsToday, count: totalLeadsToday } = await allLeadsQ

    // Distribution by time of day based on NEW CONVERSATIONS (first inbound message from each phone)
    let manha = 0, tarde = 0, noite = 0, madrugada = 0
    for (const [phone, firstMsg] of phoneFirstInbound) {
      // Only count truly new conversations (no prior history)
      const msgBR = new Date(new Date(firstMsg.created_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      const h = msgBR.getHours()
      if (h >= 6 && h < 12) manha++
      else if (h >= 12 && h < 18) tarde++
      else if (h >= 18 && h < 24) noite++
      else madrugada++
    }

    sections.push(`📈 *Leads do Dia*`)
    sections.push(`  • Total criados: ${totalLeadsToday || 0}`)
    sections.push(`  • ✅ Fechados: ${closedToday || 0}`)
    sections.push(`  • ❌ Recusados: ${refusedToday || 0}`)
    sections.push(`  • 🔄 Em andamento: ${inProgressToday || 0}`)
    sections.push(``)
    sections.push(`📥 *Conversas Novas por Período*`)
    sections.push(`  • 🌅 Manhã (6h-12h): ${manha}`)
    sections.push(`  • ☀️ Tarde (12h-18h): ${tarde}`)
    sections.push(`  • 🌙 Noite (18h-00h): ${noite}`)
    sections.push(`  • 🌃 Madrugada (00h-6h): ${madrugada}`)
    sections.push('')

    // ── Follow-ups today ──
    // Get user's lead IDs for filtering
    let userLeadIds: string[] | null = null
    if (userId) {
      const { data: userLeads } = await supabase
        .from('leads')
        .select('id')
        .eq('assigned_to', userId)
        .limit(500)
      userLeadIds = (userLeads || []).map((l: any) => l.id)
    }

    let followupsQ = supabase
      .from('lead_followups')
      .select('followup_type', { count: 'exact' })
      .gte('created_at', sinceIso)
    if (userLeadIds && userLeadIds.length > 0) {
      followupsQ = followupsQ.in('lead_id', userLeadIds)
    } else if (userId && (!userLeadIds || userLeadIds.length === 0)) {
      // User has no leads, skip
      followupsQ = followupsQ.eq('lead_id', '00000000-0000-0000-0000-000000000000')
    }
    const { data: followupsData, count: followupsTotal } = await followupsQ

    const fTypes: Record<string, number> = {}
    const fLabels: Record<string, string> = { whatsapp: '💬 WhatsApp', call: '📞 Ligação', email: '📧 E-mail', visit: '🏠 Visita', meeting: '🤝 Reunião' }
    for (const f of (followupsData || [])) {
      fTypes[f.followup_type] = (fTypes[f.followup_type] || 0) + 1
    }

    sections.push(`📋 *Follow-ups: ${followupsTotal || 0}*`)
    if (Object.keys(fTypes).length > 0) {
      for (const [k, v] of Object.entries(fTypes)) {
        sections.push(`  ${fLabels[k] || k}: ${v}`)
      }
    }
    sections.push('')
  }

  // ── ZapSign Documents ──
  if (config.notify_zapsign_documents) {
    const brNowStrZ = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    const brNowDateZ = new Date(brNowStrZ)
    const todayStartZ = new Date(Date.UTC(brNowDateZ.getFullYear(), brNowDateZ.getMonth(), brNowDateZ.getDate(), 3, 0, 0, 0))
    const sinceZ = todayStartZ.toISOString()

    let docsGenQ = supabase
      .from('zapsign_documents')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceZ)
    if (userId) docsGenQ = docsGenQ.eq('created_by', userId)
    const { count: docsGenerated } = await docsGenQ

    let docsSignedQ = supabase
      .from('zapsign_documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'signed')
      .gte('updated_at', sinceZ)
    if (userId) docsSignedQ = docsSignedQ.eq('created_by', userId)
    const { count: docsSigned } = await docsSignedQ

    let docsPendQ = supabase
      .from('zapsign_documents')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'sent'])
      .gte('created_at', sinceZ)
    if (userId) docsPendQ = docsPendQ.eq('created_by', userId)
    const { count: docsPending } = await docsPendQ

    sections.push(`📝 *Documentos ZapSign*`)
    sections.push(`  • Gerados hoje: ${docsGenerated || 0}`)
    sections.push(`  • Assinados: ${docsSigned || 0}`)
    sections.push(`  • Pendentes: ${docsPending || 0}`)
    sections.push('')
  }

  // ── CallFace Calls ──
  if (config.notify_callface_calls) {
    const brNowStrC = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    const brNowDateC = new Date(brNowStrC)
    const todayStartC = new Date(Date.UTC(brNowDateC.getFullYear(), brNowDateC.getMonth(), brNowDateC.getDate(), 3, 0, 0, 0))
    const sinceC = todayStartC.toISOString()

    let callsQ = supabase
      .from('call_records')
      .select('call_result, duration_seconds')
      .gte('created_at', sinceC)
    if (userId) callsQ = callsQ.eq('user_id', userId)
    const { data: calls } = await callsQ

    const totalCalls = (calls || []).length
    let answered = 0, notAnswered = 0, totalSeconds = 0
    for (const c of (calls || [])) {
      if (c.call_result === 'completed' || c.call_result === 'answered') {
        answered++
      } else {
        notAnswered++
      }
      totalSeconds += (c.duration_seconds || 0)
    }

    const fmtDuration = (secs: number) => {
      if (secs < 60) return `${secs}s`
      const mins = Math.floor(secs / 60)
      const s = secs % 60
      if (mins < 60) return s > 0 ? `${mins}m${s}s` : `${mins}m`
      const h = Math.floor(mins / 60)
      const m = mins % 60
      return m > 0 ? `${h}h${m}m` : `${h}h`
    }

    sections.push(`📞 *Ligações CallFace*`)
    sections.push(`  • Total: ${totalCalls}`)
    sections.push(`  • ✅ Atendidas: ${answered}`)
    sections.push(`  • ❌ Não atendidas: ${notAnswered}`)
    sections.push(`  • ⏱️ Tempo total: ${fmtDuration(totalSeconds)}`)
    sections.push('')
  }

  // ── Checklist Steps ──
  if (config.notify_checklist_steps) {
    const brNowStr2 = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
    const brNowDate2 = new Date(brNowStr2)
    const todayStartCL = new Date(Date.UTC(brNowDate2.getFullYear(), brNowDate2.getMonth(), brNowDate2.getDate(), 3, 0, 0, 0))
    const sinceCL = todayStartCL.toISOString()

    // Get user's lead IDs for filtering checklist
    let clLeadIds: string[] | null = null
    if (userId) {
      const { data: userLeads } = await supabase
        .from('leads')
        .select('id')
        .eq('assigned_to', userId)
        .limit(500)
      clLeadIds = (userLeads || []).map((l: any) => l.id)
    }

    let clQuery = supabase
      .from('lead_checklist_instances')
      .select('items, updated_at')
      .gte('updated_at', sinceCL)
    if (clLeadIds && clLeadIds.length > 0) {
      clQuery = clQuery.in('lead_id', clLeadIds)
    } else if (userId && (!clLeadIds || clLeadIds.length === 0)) {
      clQuery = clQuery.eq('lead_id', '00000000-0000-0000-0000-000000000000')
    }
    const { data: checklists } = await clQuery

    let totalSteps = 0
    let completedSteps = 0
    for (const cl of (checklists || [])) {
      const items = Array.isArray(cl.items) ? cl.items : []
      for (const item of items) {
        totalSteps++
        if ((item as any).checked || (item as any).completed) completedSteps++
      }
    }

    sections.push(`✅ *Passos Dados (Checklist): ${completedSteps}*`)
    sections.push(`  • Total de passos em checklists atualizados: ${totalSteps}`)
    sections.push(`  • Concluídos hoje: ${completedSteps}`)
    sections.push('')
  }

  return sections.join('\n').trim()
}
