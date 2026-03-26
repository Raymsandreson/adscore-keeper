export async function executeToolCall(
  supabase: any,
  fnName: string,
  args: any,
  userId: string,
  userName: string,
): Promise<any> {
  switch (fnName) {
    case 'get_overdue_tasks': return getOverdueTasks(supabase, args, userId)
    case 'get_daily_summary': return getDailySummary(supabase, args, userId)
    case 'get_leads_summary': return getLeadsSummary(supabase, args, userId)
    case 'create_activity': return createActivity(supabase, args, userId, userName)
    case 'get_goals_progress': return getGoalsProgress(supabase, args, userId)
    case 'create_lead': return createLead(supabase, args, userId)
    case 'update_lead': return updateLead(supabase, args)
    case 'change_lead_stage': return changeLeadStage(supabase, args, userId)
    case 'list_boards': return listBoards(supabase)
    case 'list_board_stages': return listBoardStages(supabase, args)
    case 'create_contact': return createContact(supabase, args, userId)
    case 'link_contact_to_lead': return linkContactToLead(supabase, args)
    case 'search_contacts': return searchContacts(supabase, args)
    case 'list_team_members': return listTeamMembers(supabase)
    case 'get_leads_by_location': return getLeadsByLocation(supabase, args)
    case 'get_lead_details': return getLeadDetails(supabase, args)
    case 'get_lead_contacts_summary': return getLeadContactsSummary(supabase, args)
    case 'manage_conversation_agent': return manageConversationAgent(supabase, args)
    default: return { error: 'Ferramenta desconhecida: ' + fnName }
  }
}

// ========== EXISTING TOOLS ==========

function normalizeText(value: string = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function sanitizeAssigneeHint(value: string) {
  return value
    .replace(/^\s*(?:atividade|atv|tarefa)?\s*(?:para|pra)?\s*/i, '')
    .replace(/\s*(?:e\s+mandar|e\s+enviar|mandar|enviar|avisar|com)\b.*$/i, '')
    .trim()
}

function scoreProfileMatch(hint: string, profileName: string | null | undefined) {
  const normalizedHint = normalizeText(hint)
  const normalizedName = normalizeText(profileName || '')
  if (!normalizedHint || !normalizedName) return -1

  if (normalizedName === normalizedHint) return 100

  const hintTokens = normalizedHint.split(/\s+/).filter(Boolean)
  const nameTokens = normalizedName.split(/\s+/).filter(Boolean)

  if (hintTokens.length === 1 && nameTokens[0] === hintTokens[0]) return 96
  if (normalizedName.startsWith(`${normalizedHint} `)) return 92
  if (hintTokens.every((t) => nameTokens.includes(t))) return 88
  if (normalizedName.includes(normalizedHint)) return 76

  return -1
}

async function resolveAssignee(supabase: any, assigneeRaw: unknown, userId: string, userName: string) {
  const raw = typeof assigneeRaw === 'string' ? assigneeRaw : ''
  const hint = sanitizeAssigneeHint(raw)

  if (!hint) {
    return { assignedToId: userId, assignedToName: userName }
  }

  const normalizedHint = normalizeText(hint)
  if (normalizedHint === 'mim' || normalizedHint === 'eu') {
    return { assignedToId: userId, assignedToName: userName }
  }

  const firstToken = normalizedHint.split(' ')[0] || hint
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('user_id, full_name')
    .not('full_name', 'is', null)
    .ilike('full_name', `%${firstToken}%`)
    .limit(25)

  if (error || !profiles || profiles.length === 0) {
    return {
      error: 'assignee_not_found',
      hint,
      candidates: [],
    }
  }

  const scored = profiles
    .map((p: any) => ({ ...p, score: scoreProfileMatch(hint, p.full_name) }))
    .filter((p: any) => p.score >= 0)
    .sort((a: any, b: any) => b.score - a.score)

  if (scored.length === 0) {
    return {
      error: 'assignee_not_found',
      hint,
      candidates: profiles.map((p: any) => p.full_name).filter(Boolean),
    }
  }

  const best = scored[0]
  const second = scored[1]

  // If there's only one candidate, or the best is clearly ahead, auto-select
  // Only reject if there are multiple candidates with identical top scores
  const trulyAmbiguous = second && best.score === second.score && best.score < 100

  if (trulyAmbiguous) {
    return {
      error: 'assignee_ambiguous',
      hint,
      candidates: scored.slice(0, 5).map((p: any) => p.full_name).filter(Boolean),
    }
  }

  // If best score is very low (< 30) and there are multiple candidates, reject
  if (best.score < 30 && scored.length > 1) {
    return {
      error: 'assignee_not_found',
      hint,
      candidates: scored.slice(0, 5).map((p: any) => p.full_name).filter(Boolean),
    }
  }

  return {
    assignedToId: best.user_id,
    assignedToName: best.full_name || hint,
  }
}

async function getOverdueTasks(supabase: any, args: any, userId: string) {
  const now = new Date()
  let query = supabase
    .from('lead_activities')
    .select('title, deadline, assigned_to_name, status, priority, lead_name')
    .in('status', ['pendente', 'pending', 'em_andamento'])
    .lt('deadline', now.toISOString())
    .order('deadline', { ascending: true })
    .limit(args.limit || 15)

  if (args.scope === 'mine') query = query.eq('assigned_to', userId)

  const { data, error } = await query
  if (error) return { error: error.message }
  return {
    total: data?.length || 0,
    tasks: (data || []).map((t: any) => ({
      title: t.title, deadline: t.deadline, assigned_to: t.assigned_to_name,
      priority: t.priority, lead: t.lead_name, status: t.status,
    })),
  }
}

async function getDailySummary(supabase: any, args: any, userId: string) {
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

async function getLeadsSummary(supabase: any, args: any, userId: string) {
  let query = supabase
    .from('leads')
    .select('id, lead_name, current_stage, assigned_to, created_at, lead_value, board_id')
    .order('created_at', { ascending: false })
    .limit(args.limit || 10)

  if (args.scope === 'mine') query = query.eq('assigned_to', userId)
  if (args.search) query = query.ilike('lead_name', `%${args.search}%`)

  const { data, error } = await query
  if (error) return { error: error.message }
  return {
    total: data?.length || 0,
    leads: (data || []).map((l: any) => ({
      id: l.id, name: l.lead_name, stage: l.current_stage,
      value: l.lead_value, board_id: l.board_id, created: l.created_at,
    })),
  }
}

async function createActivity(supabase: any, args: any, userId: string, userName: string) {
  const assigneeResolution = await resolveAssignee(supabase, args.assigned_to_name, userId, userName)
  if ('error' in assigneeResolution) {
    const isAmbiguous = assigneeResolution.error === 'assignee_ambiguous'
    return {
      error: isAmbiguous
        ? `Nome do assessor "${assigneeResolution.hint}" ficou ambíguo. Informe o nome completo.`
        : `Não encontrei o assessor "${assigneeResolution.hint}".`,
      assignee_resolution: assigneeResolution.error,
      assignee_hint: assigneeResolution.hint,
      assignee_candidates: assigneeResolution.candidates || [],
    }
  }

  const assignedToId = assigneeResolution.assignedToId
  const assignedToName = assigneeResolution.assignedToName

  // Resolve activity type: prioritize assignee's routine types
  const requestedActivityType = typeof args.activity_type === 'string' ? args.activity_type.trim() : ''
  const rawCommandText = typeof args.raw_command_text === 'string' ? args.raw_command_text.trim() : ''
  let resolvedActivityType = requestedActivityType

  // Fetch assignee's routine (time block settings) and all active types in parallel
  const [routineResult, allTypesResult] = await Promise.all([
    supabase
      .from('user_timeblock_settings')
      .select('activity_type')
      .eq('user_id', assignedToId),
    supabase
      .from('activity_types')
      .select('key, label')
      .or('is_active.eq.true,is_active.is.null')
      .order('display_order')
      .limit(200),
  ])

  const allActiveTypes = (allTypesResult.data || []) as any[]
  const routineTypeKeys = new Set(
    (routineResult.data || []).map((r: any) => r.activity_type)
  )

  // Filter to only types present in the assignee's routine
  const assigneeTypes = routineTypeKeys.size > 0
    ? allActiveTypes.filter((t: any) => routineTypeKeys.has(t.key))
    : allActiveTypes // fallback: if no routine configured, use all types

  const typesToSearch = assigneeTypes.length > 0 ? assigneeTypes : allActiveTypes

  if (typesToSearch.length > 0) {
    const normalizedType = normalizeText(requestedActivityType)
    const exactKey = typesToSearch.find((t: any) => normalizeText(t.key || '') === normalizedType)
    const byLabel = typesToSearch.find((t: any) => normalizeText(t.label || '') === normalizedType)
    const fuzzyLabel = typesToSearch.find((t: any) => {
      const label = normalizeText(t.label || '')
      const key = normalizeText(t.key || '')
      return normalizedType && (
        label.includes(normalizedType) ||
        normalizedType.includes(label) ||
        key.includes(normalizedType) ||
        normalizedType.includes(key)
      )
    })

    const typeContextText = normalizeText([
      args.title,
      rawCommandText,
      args.current_status_notes,
      args.notes,
      args.next_steps,
      args.what_was_done,
    ].filter((v: any) => typeof v === 'string' && v.trim()).join(' '))

    const contextTokens = Array.from(new Set(typeContextText.split(/[^a-z0-9]+/).filter((t) => t.length > 2)))

    const contextualMatch = !normalizedType && contextTokens.length > 0
      ? typesToSearch
          .map((t: any) => {
            const labelTokens = Array.from(new Set(normalizeText(t.label || '').split(/[^a-z0-9]+/).filter((x) => x.length > 2)))
            const keyTokens = Array.from(new Set(normalizeText(t.key || '').split(/[^a-z0-9]+/).filter((x) => x.length > 2 && !/^custom\d+$/.test(x))))
            const tokens = Array.from(new Set([...labelTokens, ...keyTokens]))
            const overlap = tokens.filter((token) => contextTokens.includes(token)).length
            return { key: t.key, overlap }
          })
          .sort((a: any, b: any) => b.overlap - a.overlap)[0]
      : null

    const preferredFallback = typesToSearch.find((t: any) => {
      const normalizedLabelAndKey = normalizeText(`${t.label || ''} ${t.key || ''}`)
      return /follow\s*up|followup|tarefa|atividade|geral/.test(normalizedLabelAndKey)
    })

    resolvedActivityType =
      exactKey?.key ||
      byLabel?.key ||
      fuzzyLabel?.key ||
      (contextualMatch && contextualMatch.overlap > 0 ? contextualMatch.key : undefined) ||
      preferredFallback?.key ||
      typesToSearch[0].key
  }

  if (!resolvedActivityType) resolvedActivityType = 'tarefa'

  const commandWithoutMediaMarker = rawCommandText.replace(/\[MÍDIA ANEXADA:[^\]]+\]\s*/gi, '').trim()
  const descriptionText = typeof args.description === 'string' ? args.description.trim() : ''
  const providedCurrentStatus = typeof args.current_status_notes === 'string' ? args.current_status_notes.trim() : ''
  const providedNotes = typeof args.notes === 'string' ? args.notes.trim() : ''
  const providedWhatWasDone = typeof args.what_was_done === 'string' ? args.what_was_done.trim() : ''
  const providedNextSteps = typeof args.next_steps === 'string' ? args.next_steps.trim() : ''

  const richestContent = [descriptionText, commandWithoutMediaMarker]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || ''

  const currentStatusNotes = providedCurrentStatus || richestContent || null
  const notes = providedNotes || (richestContent && richestContent !== currentStatusNotes ? richestContent : null)

  const safeTitle = typeof args.title === 'string' && args.title.trim()
    ? args.title.trim()
    : 'Nova atividade'

  const { data, error } = await supabase
    .from('lead_activities')
    .insert({
      title: safeTitle,
      description: null,
      activity_type: resolvedActivityType,
      priority: args.priority || 'normal',
      deadline: args.deadline || new Date().toISOString().split('T')[0],
      notification_date: args.notification_date || null,
      status: 'pendente',
      assigned_to: assignedToId,
      assigned_to_name: assignedToName,
      created_by: userId,
      lead_name: args.lead_name || null,
      notes,
      what_was_done: providedWhatWasDone || null,
      next_steps: providedNextSteps || null,
      current_status_notes: currentStatusNotes,
    })
    .select('id, title, description, created_at, activity_type, status, deadline, notification_date, lead_name, notes, what_was_done, next_steps, current_status_notes')
    .single()

  if (error) return { error: error.message }

  // Attach media if provided
  if (args.media_url && data?.id) {
    const mediaUrl = args.media_url
    const fileName = mediaUrl.split('/').pop() || 'anexo'
    const fileType = fileName.includes('.pdf') ? 'application/pdf' 
      : fileName.includes('.png') ? 'image/png'
      : fileName.includes('.jpg') || fileName.includes('.jpeg') ? 'image/jpeg'
      : 'application/octet-stream'
    
    await supabase.from('activity_attachments').insert({
      activity_id: data.id,
      file_name: fileName,
      file_type: fileType,
      file_url: mediaUrl,
      attachment_type: 'file',
      created_by: userId,
    })
  }

  const APP_URL = "https://adscore-keeper.lovable.app"
  return { 
    success: true, 
    activity_id: data.id, 
    title: data.title, 
    created_at: data.created_at,
    activity_type: data.activity_type,
    status: data.status,
    deadline: data.deadline,
    notification_date: data.notification_date,
    lead_name: data.lead_name,
    notes: data.notes,
    what_was_done: data.what_was_done,
    next_steps: data.next_steps,
    current_status_notes: data.current_status_notes,
    media_attached: !!args.media_url,
    activity_type_requested: requestedActivityType || null,
    assigned_to_name: assignedToName,
    assigned_to_id: assignedToId,
    link: `${APP_URL}/?openActivity=${data.id}` 
  }
}

async function getGoalsProgress(supabase: any, args: any, userId: string) {
  let query = supabase
    .from('commission_goals')
    .select('metric_key, target_value, period, period_start, period_end, ote_value')
    .eq('is_active', true)
    .limit(10)

  if (args.scope === 'mine') query = query.eq('user_id', userId)

  const { data, error } = await query
  if (error) return { error: error.message }
  return {
    total: data?.length || 0,
    goals: (data || []).map((g: any) => ({
      metric: g.metric_key, target: g.target_value, period: g.period,
      period_start: g.period_start, period_end: g.period_end, ote: g.ote_value,
    })),
  }
}

// ========== NEW CRM TOOLS ==========

async function createLead(supabase: any, args: any, userId: string) {
  let stageId = args.stage_id

  // If no stage provided, get the first stage of the board
  if (!stageId && args.board_id) {
    const { data: board } = await supabase
      .from('kanban_boards')
      .select('stages')
      .eq('id', args.board_id)
      .single()

    if (board?.stages) {
      const stages = typeof board.stages === 'string' ? JSON.parse(board.stages) : board.stages
      if (Array.isArray(stages) && stages.length > 0) {
        stageId = stages[0].id
      }
    }
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      lead_name: args.lead_name,
      board_id: args.board_id,
      current_stage: stageId || null,
      lead_value: args.lead_value || null,
      phone: args.phone || null,
      email: args.email || null,
      notes: args.notes || null,
      assigned_to: userId,
      created_by: userId,
    })
    .select('id, lead_name, current_stage')
    .single()

  if (error) return { error: error.message }
  const APP_URL = "https://adscore-keeper.lovable.app"
  return { success: true, lead_id: data.id, lead_name: data.lead_name, stage: data.current_stage, link: `${APP_URL}/leads?openLead=${data.id}` }
}

async function updateLead(supabase: any, args: any) {
  const updates: any = {}
  if (args.lead_name) updates.lead_name = args.lead_name
  if (args.lead_value !== undefined) updates.lead_value = args.lead_value
  if (args.notes !== undefined) updates.notes = args.notes
  if (args.assigned_to) updates.assigned_to = args.assigned_to

  if (Object.keys(updates).length === 0) return { error: 'Nenhum campo para atualizar' }

  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', args.lead_id)
    .select('id, lead_name')
    .single()

  if (error) return { error: error.message }
  return { success: true, lead_id: data.id, lead_name: data.lead_name, updated_fields: Object.keys(updates) }
}

async function changeLeadStage(supabase: any, args: any, userId: string) {
  // First get the lead to know current stage and board
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, lead_name, current_stage, board_id')
    .eq('id', args.lead_id)
    .single()

  if (leadErr || !lead) return { error: 'Lead não encontrado' }

  const boardId = args.board_id || lead.board_id
  if (!boardId) return { error: 'Lead sem quadro associado' }

  // Get board stages
  const { data: board } = await supabase
    .from('kanban_boards')
    .select('stages')
    .eq('id', boardId)
    .single()

  if (!board?.stages) return { error: 'Quadro não encontrado' }

  const stages = typeof board.stages === 'string' ? JSON.parse(board.stages) : board.stages
  if (!Array.isArray(stages)) return { error: 'Etapas inválidas' }

  // Find target stage by ID or name (case-insensitive)
  const newStageInput = args.new_stage.toLowerCase()
  const targetStage = stages.find((s: any) =>
    s.id === args.new_stage || s.name?.toLowerCase() === newStageInput
  )

  if (!targetStage) {
    return {
      error: 'Etapa não encontrada',
      available_stages: stages.map((s: any) => ({ id: s.id, name: s.name })),
    }
  }

  // Update lead stage
  const { error: updateErr } = await supabase
    .from('leads')
    .update({ current_stage: targetStage.id })
    .eq('id', args.lead_id)

  if (updateErr) return { error: updateErr.message }

  // Record stage history
  await supabase.from('lead_stage_history').insert({
    lead_id: args.lead_id,
    from_stage: lead.current_stage,
    to_stage: targetStage.id,
    from_board_id: boardId,
    to_board_id: boardId,
    changed_by: userId,
    notes: 'Alterado via assistente WhatsApp',
  })

  return {
    success: true,
    lead_name: lead.lead_name,
    from_stage: lead.current_stage,
    to_stage: targetStage.name || targetStage.id,
  }
}

async function listBoards(supabase: any) {
  const { data, error } = await supabase
    .from('kanban_boards')
    .select('id, name, board_type')
    .eq('is_active', true)
    .order('display_order')

  if (error) return { error: error.message }
  return {
    boards: (data || []).map((b: any) => ({
      id: b.id, name: b.name, type: b.board_type || 'sales',
    })),
  }
}

async function listBoardStages(supabase: any, args: any) {
  const { data: board, error } = await supabase
    .from('kanban_boards')
    .select('id, name, stages')
    .eq('id', args.board_id)
    .single()

  if (error || !board) return { error: 'Quadro não encontrado' }

  const stages = typeof board.stages === 'string' ? JSON.parse(board.stages) : board.stages
  return {
    board_name: board.name,
    stages: (Array.isArray(stages) ? stages : []).map((s: any) => ({
      id: s.id, name: s.name, color: s.color,
    })),
  }
}

async function createContact(supabase: any, args: any, userId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      full_name: args.full_name,
      phone: args.phone || null,
      email: args.email || null,
      city: args.city || null,
      state: args.state || null,
      classification: args.classification || null,
      notes: args.notes || null,
      created_by: userId,
    })
    .select('id, full_name')
    .single()

  if (error) return { error: error.message }
  const APP_URL = "https://adscore-keeper.lovable.app"
  return { success: true, contact_id: data.id, full_name: data.full_name, link: `${APP_URL}/leads?tab=contacts&openContact=${data.id}` }
}

async function linkContactToLead(supabase: any, args: any) {
  const { error } = await supabase
    .from('contact_leads')
    .insert({
      contact_id: args.contact_id,
      lead_id: args.lead_id,
      relationship_to_victim: args.relationship_to_victim || null,
      notes: args.notes || null,
    })

  if (error) {
    if (error.code === '23505') return { error: 'Este contato já está vinculado a este lead' }
    return { error: error.message }
  }
  return { success: true, contact_id: args.contact_id, lead_id: args.lead_id }
}

async function searchContacts(supabase: any, args: any) {
  const search = args.search
  const limit = args.limit || 10

  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, phone, email, city, state, classification')
    .or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { error: error.message }
  return {
    total: data?.length || 0,
    contacts: (data || []).map((c: any) => ({
      id: c.id, name: c.full_name, phone: c.phone, email: c.email,
      city: c.city, state: c.state, classification: c.classification,
    })),
  }
}

async function listTeamMembers(supabase: any) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email')
    .order('full_name')

  if (error) return { error: error.message }
  return {
    members: (data || []).map((p: any) => ({
      user_id: p.user_id, name: p.full_name, email: p.email,
    })),
  }
}

// ========== LOCATION & DETAIL TOOLS ==========

async function getLeadsByLocation(supabase: any, args: any) {
  const limit = args.limit || 10

  // Search contacts linked to leads by city/state, then return leads
  let contactQuery = supabase
    .from('contacts')
    .select('id, full_name, city, state, lead_id, phone')
    .not('lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 2)

  if (args.city) contactQuery = contactQuery.ilike('city', `%${args.city}%`)
  if (args.state) contactQuery = contactQuery.ilike('state', `%${args.state}%`)

  const { data: contacts, error: cErr } = await contactQuery
  if (cErr) return { error: cErr.message }

  // Also search leads directly via contact_leads table
  let clQuery = supabase
    .from('contact_leads')
    .select('lead_id, contact_id, contacts(full_name, city, state, phone)')
    .limit(limit * 2)

  const { data: contactLeads } = await clQuery

  // Collect unique lead IDs from both sources
  const leadIds = new Set<string>()
  const locationMap: Record<string, any> = {}

  for (const c of (contacts || [])) {
    if (c.lead_id) {
      leadIds.add(c.lead_id)
      locationMap[c.lead_id] = { city: c.city, state: c.state, contact_name: c.full_name }
    }
  }

  // Filter contactLeads by city/state
  for (const cl of (contactLeads || [])) {
    const contact = cl.contacts as any
    if (!contact) continue
    const cityMatch = !args.city || (contact.city || '').toLowerCase().includes(args.city.toLowerCase())
    const stateMatch = !args.state || (contact.state || '').toLowerCase().includes(args.state.toLowerCase())
    if (cityMatch && stateMatch) {
      leadIds.add(cl.lead_id)
      if (!locationMap[cl.lead_id]) {
        locationMap[cl.lead_id] = { city: contact.city, state: contact.state, contact_name: contact.full_name }
      }
    }
  }

  if (leadIds.size === 0) {
    return { total: 0, leads: [], message: `Nenhum lead encontrado na localização ${args.city || ''} ${args.state || ''}` }
  }

  const { data: leads, error: lErr } = await supabase
    .from('leads')
    .select('id, lead_name, current_stage, lead_value, board_id, created_at')
    .in('id', Array.from(leadIds).slice(0, limit))

  if (lErr) return { error: lErr.message }

  return {
    total: leads?.length || 0,
    location_filter: { city: args.city || null, state: args.state || null },
    leads: (leads || []).map((l: any) => ({
      id: l.id, name: l.lead_name, stage: l.current_stage,
      value: l.lead_value, board_id: l.board_id,
      location: locationMap[l.id] || null,
    })),
  }
}

async function getLeadDetails(supabase: any, args: any) {
  let lead: any = null

  if (args.lead_id) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', args.lead_id)
      .single()
    if (error) return { error: error.message }
    lead = data
  } else if (args.lead_name) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .ilike('lead_name', `%${args.lead_name}%`)
      .limit(1)
      .single()
    if (error) return { error: 'Lead não encontrado com esse nome' }
    lead = data
  } else {
    return { error: 'Informe lead_id ou lead_name' }
  }

  // Get board/stage name
  let stageName = lead.current_stage
  if (lead.board_id) {
    const { data: board } = await supabase
      .from('kanban_boards')
      .select('name, stages')
      .eq('id', lead.board_id)
      .single()
    if (board?.stages) {
      const stages = typeof board.stages === 'string' ? JSON.parse(board.stages) : board.stages
      const found = (stages || []).find((s: any) => s.id === lead.current_stage)
      if (found) stageName = found.name
    }
  }

  // Get assigned user name
  let assignedName = null
  if (lead.assigned_to) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', lead.assigned_to)
      .single()
    assignedName = profile?.full_name
  }

  // Get custom fields
  const { data: customFields } = await supabase
    .from('lead_custom_field_values')
    .select('field_id, value, lead_custom_field_definitions(field_name, field_type)')
    .eq('lead_id', lead.id)

  return {
    id: lead.id,
    name: lead.lead_name,
    stage: stageName,
    value: lead.lead_value,
    phone: lead.phone,
    email: lead.email,
    notes: lead.notes,
    assigned_to: assignedName,
    board_id: lead.board_id,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    followup_count: lead.followup_count,
    last_followup_at: lead.last_followup_at,
    custom_fields: (customFields || []).map((cf: any) => ({
      field: cf.lead_custom_field_definitions?.field_name,
      type: cf.lead_custom_field_definitions?.field_type,
      value: cf.value,
    })),
  }
}

async function getLeadContactsSummary(supabase: any, args: any) {
  let leadId = args.lead_id

  // Find lead by name if needed
  if (!leadId && args.lead_name) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .ilike('lead_name', `%${args.lead_name}%`)
      .limit(1)
      .single()
    if (!data) return { error: 'Lead não encontrado' }
    leadId = data.id
  }

  if (!leadId) return { error: 'Informe lead_id ou lead_name' }

  // Get linked contacts
  const { data: links, error } = await supabase
    .from('contact_leads')
    .select('relationship_to_victim, notes, contacts(id, full_name, phone, email, city, state, classification, notes, profession)')
    .eq('lead_id', leadId)

  if (error) return { error: error.message }

  // Get call records for this lead
  const { data: calls } = await supabase
    .from('call_records')
    .select('contact_name, call_type, call_result, created_at, duration_seconds, ai_summary')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Get recent activities
  const { data: activities } = await supabase
    .from('lead_activities')
    .select('title, status, activity_type, created_at, assigned_to_name')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(5)

  return {
    lead_id: leadId,
    total_contacts: links?.length || 0,
    contacts: (links || []).map((l: any) => ({
      name: l.contacts?.full_name,
      phone: l.contacts?.phone,
      email: l.contacts?.email,
      city: l.contacts?.city,
      state: l.contacts?.state,
      classification: l.contacts?.classification,
      profession: l.contacts?.profession,
      relationship: l.relationship_to_victim,
      notes: l.notes || l.contacts?.notes,
    })),
    recent_calls: (calls || []).map((c: any) => ({
      contact: c.contact_name, type: c.call_type, result: c.call_result,
      date: c.created_at, duration: c.duration_seconds, summary: c.ai_summary,
    })),
    recent_activities: (activities || []).map((a: any) => ({
      title: a.title, status: a.status, type: a.activity_type,
      date: a.created_at, assigned_to: a.assigned_to_name,
    })),
  }
}

// ========== AGENT MANAGEMENT TOOL ==========

async function manageConversationAgent(supabase: any, args: any) {
  let phone = args.phone
  let contactNameFound: string | null = null

  // If contact_name provided, search for their phone
  if (!phone && args.contact_name) {
    const search = args.contact_name
    // Search in contacts
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, phone')
      .ilike('full_name', `%${search}%`)
      .not('phone', 'is', null)
      .limit(5)

    // Also search in whatsapp_messages for contact_name
    const { data: messages } = await supabase
      .from('whatsapp_messages')
      .select('phone, contact_name')
      .ilike('contact_name', `%${search}%`)
      .not('phone', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5)

    if (contacts?.length > 0) {
      phone = contacts[0].phone?.replace(/\D/g, '')
      contactNameFound = contacts[0].full_name
    } else if (messages?.length > 0) {
      phone = messages[0].phone
      contactNameFound = messages[0].contact_name
    }

    if (!phone) {
      return { error: `Contato "${search}" não encontrado. Tente informar o número de telefone diretamente.` }
    }
  }

  if (!phone) {
    return { error: 'Informe o nome do contato ou o número de telefone da conversa.' }
  }

  // Normalize phone
  phone = phone.replace(/\D/g, '').replace(/^0+/, '')

  // Find the conversation agent assignment
  let agentQuery = supabase
    .from('whatsapp_conversation_agents')
    .select('id, phone, instance_name, agent_id, is_active, human_paused_until')
    .eq('phone', phone)

  if (args.instance_name) {
    agentQuery = agentQuery.eq('instance_name', args.instance_name)
  }

  const { data: assignments } = await agentQuery.limit(5)

  if (!assignments || assignments.length === 0) {
    // Try with phone variants
    const variants = []
    if (phone.startsWith('55')) variants.push(phone.slice(2))
    const local = phone.startsWith('55') ? phone.slice(2) : phone
    if (local.length === 10) variants.push(`${local.slice(0, 2)}9${local.slice(2)}`)
    if (local.length === 11 && local[2] === '9') variants.push(`${local.slice(0, 2)}${local.slice(3)}`)

    for (const variant of variants) {
      let vQuery = supabase
        .from('whatsapp_conversation_agents')
        .select('id, phone, instance_name, agent_id, is_active, human_paused_until')
        .eq('phone', variant)
      if (args.instance_name) vQuery = vQuery.eq('instance_name', args.instance_name)
      const { data: vAssignments } = await vQuery.limit(5)
      if (vAssignments?.length) {
        return await processAgentAction(supabase, args.action, vAssignments, contactNameFound)
      }
    }

    return { error: `Nenhum agente de IA atribuído à conversa com ${contactNameFound || phone}.` }
  }

  return await processAgentAction(supabase, args.action, assignments, contactNameFound)
}

async function processAgentAction(supabase: any, action: string, assignments: any[], contactName: string | null) {
  const results: any[] = []

  for (const assignment of assignments) {
    // Get agent name
    const { data: agent } = await supabase
      .from('whatsapp_ai_agents')
      .select('name')
      .eq('id', assignment.agent_id)
      .maybeSingle()

    const agentName = agent?.name || 'Agente'

    if (action === 'status') {
      const isPaused = assignment.human_paused_until && new Date(assignment.human_paused_until) > new Date()
      results.push({
        instance: assignment.instance_name,
        agent: agentName,
        active: assignment.is_active,
        paused: isPaused,
        paused_until: isPaused ? assignment.human_paused_until : null,
        phone: assignment.phone,
        contact: contactName,
      })
    } else if (action === 'deactivate') {
      const { error } = await supabase
        .from('whatsapp_conversation_agents')
        .update({ is_active: false })
        .eq('id', assignment.id)

      if (error) {
        results.push({ error: error.message, instance: assignment.instance_name })
      } else {
        results.push({
          success: true,
          action: 'desativado',
          agent: agentName,
          instance: assignment.instance_name,
          phone: assignment.phone,
          contact: contactName,
        })
      }
    } else if (action === 'activate') {
      const { error } = await supabase
        .from('whatsapp_conversation_agents')
        .update({ is_active: true, human_paused_until: null })
        .eq('id', assignment.id)

      if (error) {
        results.push({ error: error.message, instance: assignment.instance_name })
      } else {
        results.push({
          success: true,
          action: 'ativado',
          agent: agentName,
          instance: assignment.instance_name,
          phone: assignment.phone,
          contact: contactName,
        })
      }
    }
  }

  return { total: results.length, results }
}
