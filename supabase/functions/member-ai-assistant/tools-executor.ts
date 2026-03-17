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
    default: return { error: 'Ferramenta desconhecida: ' + fnName }
  }
}

// ========== EXISTING TOOLS ==========

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
  return { success: true, activity_id: data.id, title: data.title }
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
  return { success: true, lead_id: data.id, lead_name: data.lead_name, stage: data.current_stage }
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
  return { success: true, contact_id: data.id, full_name: data.full_name }
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
