import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from '../_shared/gemini.ts'

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
const cloudAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_GROUP_NAME_LENGTH = 95
const RATE_LIMIT_RETRIES = 3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizePhone(rawValue: string | null | undefined): string {
  return String(rawValue || '')
    .replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '')
    .replace(/\D/g, '')
    .trim()
}

function phoneMatches(actual: string, expected: string): boolean {
  if (!actual || !expected) return false
  if (actual === expected) return true

  const actualSuffix = actual.slice(-8)
  const expectedSuffix = expected.slice(-8)
  return actualSuffix.length === 8 && actualSuffix === expectedSuffix
}

function extractParticipantPhones(rawParticipants: any[]): string[] {
  return (rawParticipants || [])
    .map((participant: any) => normalizePhone(
      participant?.id || participant?.jid || participant?.participant || participant?.phone || participant?.user || participant
    ))
    .filter(Boolean)
}

function countMatchedParticipants(rawParticipants: any[], expectedPhones: string[]): number {
  const actualPhones = extractParticipantPhones(rawParticipants)
  return expectedPhones.filter((expectedPhone) =>
    actualPhones.some((actualPhone) => phoneMatches(actualPhone, expectedPhone))
  ).length
}

async function fetchGroupInfo(baseUrl: string, token: string, groupId: string) {
  const groupJid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`

  // Try multiple parameter names since UazAPI versions vary
  const paramVariants = [
    { id: groupJid },
    { groupJid: groupJid },
    { jid: groupJid },
    { groupId: groupJid },
  ]

  for (const params of paramVariants) {
    try {
      const infoRes = await fetch(`${baseUrl}/group/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify(params),
      })

      if (!infoRes.ok) {
        const errText = await infoRes.text()
        console.warn(`Group info with params ${JSON.stringify(params)} failed:`, infoRes.status, errText)
        continue
      }

      const groupData = await infoRes.json()
      const participants = groupData?.participants || groupData?.data?.participants || []
      if (participants.length > 0 || groupData?.subject || groupData?.data?.subject) {
        return {
          groupName: groupData?.subject || groupData?.name || groupData?.data?.subject || '',
          participants,
        }
      }
    } catch (error) {
      console.warn(`Error fetching group info with params ${JSON.stringify(params)}:`, error)
    }
  }

  // Also try GET endpoint as fallback
  try {
    const getRes = await fetch(`${baseUrl}/group/info?jid=${encodeURIComponent(groupJid)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', token },
    })
    if (getRes.ok) {
      const groupData = await getRes.json()
      return {
        groupName: groupData?.subject || groupData?.name || groupData?.data?.subject || '',
        participants: groupData?.participants || groupData?.data?.participants || [],
      }
    }
  } catch (e) {
    console.warn('GET group info fallback failed:', e)
  }

  console.warn('All group info attempts failed for:', groupJid)
  return null
}

function normalizeGroupName(rawName: string): string {
  const cleaned = (rawName || '')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'Grupo de Atendimento'

  if (cleaned.length <= MAX_GROUP_NAME_LENGTH) return cleaned

  const shortened = cleaned.slice(0, MAX_GROUP_NAME_LENGTH).trim()
  console.warn(`Group name too long (${cleaned.length}), truncating to ${MAX_GROUP_NAME_LENGTH}:`, shortened)
  return shortened
}

function isRateLimited(status: number, bodyText: string): boolean {
  return status === 429 || /rate[-_ ]?overlimit|too\s+many\s+requests|429/i.test(bodyText || '')
}

async function postUazApiWithRetry(
  baseUrl: string,
  token: string,
  endpoint: string,
  payload: Record<string, unknown>,
  retries = RATE_LIMIT_RETRIES,
): Promise<Response> {
  let attempt = 0

  while (true) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify(payload),
    })

    if (res.ok) return res

    const bodyText = await res.clone().text()
    const shouldRetry = isRateLimited(res.status, bodyText) && attempt < retries

    if (!shouldRetry) return res

    const delayMs = 1200 * Math.pow(2, attempt)
    console.warn(`UazAPI rate limit on ${endpoint} (attempt ${attempt + 1}/${retries + 1}). Retrying in ${delayMs}ms...`)
    await sleep(delayMs)
    attempt++
  }
}

// ============================================================
// Isolated step runner: each post-creation step runs independently
// so a failure in one (e.g. document forwarding) does NOT block
// the others (e.g. participant addition, initial message).
// ============================================================
interface StepResult {
  step: string
  ok: boolean
  error?: string
  details?: string
}

async function runStep(name: string, fn: () => Promise<void>): Promise<StepResult> {
  try {
    await fn()
    return { step: name, ok: true }
  } catch (err: any) {
    console.error(`[create-group][${name}] STEP FAILED:`, err)
    return { step: name, ok: false, error: err?.message || String(err) }
  }
}

async function addParticipantsToGroup(
  baseUrl: string, token: string, groupJid: string,
  participants: string[], retries = 5
): Promise<{ added: string[]; failed: string[] }> {
  const added: string[] = []
  const failed: string[] = []

  if (participants.length === 0) return { added, failed }

  // Try bulk add first
  let bulkOk = false
  try {
    console.log(`[add-participants] Bulk adding ${participants.length} participants`)
    const bulkRes = await postUazApiWithRetry(baseUrl, token, '/group/updateParticipants', {
      groupjid: groupJid, action: 'add', participants,
    }, retries)
    if (bulkRes.ok) {
      bulkOk = true
      added.push(...participants)
      console.log('[add-participants] Bulk add succeeded')
    } else {
      const errText = await bulkRes.text()
      console.warn('[add-participants] Bulk add failed:', bulkRes.status, errText)
    }
  } catch (e) {
    console.warn('[add-participants] Bulk add error:', e)
  }

  // If bulk failed, try one by one
  if (!bulkOk) {
    console.log('[add-participants] Falling back to individual adds')
    await sleep(3000)
    for (const p of participants) {
      try {
        const addRes = await postUazApiWithRetry(baseUrl, token, '/group/updateParticipants', {
          groupjid: groupJid, action: 'add', participants: [p],
        }, retries)
        if (addRes.ok) {
          added.push(p)
          console.log(`[add-participants] Added ${p} successfully`)
        } else {
          const errText = await addRes.text()
          console.warn(`[add-participants] Failed to add ${p}:`, errText)
          failed.push(p)
        }
      } catch (e) {
        console.warn(`[add-participants] Error adding ${p}:`, e)
        failed.push(p)
      }
      await sleep(2000)
    }
  }

  return { added, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const diagnostics: StepResult[] = []

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    const { phone, lead_name, board_id, contact_phone, creator_instance_id, lead_id } = body

    if (!lead_name) {
      return new Response(JSON.stringify({ success: false, error: 'lead_name is required' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // DEDUP GUARD: If lead_id is provided, check if it already has a group
    if (lead_id) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('whatsapp_group_id')
        .eq('id', lead_id)
        .maybeSingle()
      
      if (existingLead?.whatsapp_group_id) {
        console.log(`[create-group] DEDUP: Lead ${lead_id} already has group ${existingLead.whatsapp_group_id}. Skipping creation.`)
        return new Response(JSON.stringify({ 
          success: true, 
          group_id: existingLead.whatsapp_group_id, 
          skipped: true, 
          reason: 'already_has_group' 
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Helper to check if an instance is connected via UazAPI
    async function isInstanceConnected(inst: any): Promise<boolean> {
      try {
        const url = (inst.base_url || 'https://abraci.uazapi.com') + '/status'
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', token: inst.instance_token },
        })
        if (!res.ok) return false
        const data = await res.json()
        console.log(`[create-group] Instance ${inst.instance_name} raw status response:`, JSON.stringify(data).substring(0, 300))
        
        // UazAPI returns nested structure: { status: { checked_instance: { connection_status: "connected" } } }
        const statusObj = data?.status
        
        // Check nested checked_instance.connection_status first (new UazAPI format)
        if (typeof statusObj === 'object' && statusObj !== null) {
          const checkedInstance = statusObj?.checked_instance
          if (checkedInstance?.connection_status === 'connected' || checkedInstance?.is_healthy === true) {
            console.log(`[create-group] Instance ${inst.instance_name} -> connected (checked_instance)`)
            return true
          }
        }
        
        // Fallback: flat status string
        const rawStatus = statusObj || data?.state || data?.connection || ''
        const status = typeof rawStatus === 'object' ? JSON.stringify(rawStatus) : String(rawStatus)
        const connected = ['connected', 'open', 'CONNECTED'].includes(status) 
          || data?.connected === true
          || data?.status === true
          || rawStatus === true
        console.log(`[create-group] Instance ${inst.instance_name} connection status: ${status} -> ${connected}`)
        return connected
      } catch (e) {
        console.warn(`[create-group] Failed to check status for ${inst.instance_name}:`, e)
        return false
      }
    }

    // Get the creator instance - try requested instance first, then board instances, then any active
    let creatorInstance: any = null
    
    // 1. Try the requested creator instance
    if (creator_instance_id) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('id', creator_instance_id)
        .eq('is_active', true)
        .single()
      if (data) {
        const connected = await isInstanceConnected(data)
        if (connected) {
          creatorInstance = data
          console.log(`[create-group] Using requested instance: ${data.instance_name}`)
        } else {
          console.warn(`[create-group] Requested instance ${data.instance_name} is NOT connected, trying board instances...`)
        }
      }
    }

    // 2. If not connected, try board-linked instances
    if (!creatorInstance && board_id) {
      const { data: boardInstances } = await supabase
        .from('board_group_instances')
        .select('instance_id')
        .eq('board_id', board_id)

      if (boardInstances?.length) {
        const instanceIds = boardInstances.map((bi: any) => bi.instance_id)
        const { data: instances } = await supabase
          .from('whatsapp_instances')
          .select('*')
          .in('id', instanceIds)
          .eq('is_active', true)

        if (instances?.length) {
          for (const inst of instances) {
            // Skip the already-tried instance
            if (inst.id === creator_instance_id) continue
            const connected = await isInstanceConnected(inst)
            if (connected) {
              creatorInstance = inst
              console.log(`[create-group] Using board-linked instance: ${inst.instance_name}`)
              break
            }
          }
        }
      }
    }

    // 3. Last resort: any active instance
    if (!creatorInstance) {
      const { data: allInstances } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .order('created_at')

      if (allInstances?.length) {
        for (const inst of allInstances) {
          if (inst.id === creator_instance_id) continue
          const connected = await isInstanceConnected(inst)
          if (connected) {
            creatorInstance = inst
            console.log(`[create-group] Using fallback instance: ${inst.instance_name}`)
            break
          }
        }
      }
    }

    if (!creatorInstance) {
      // All instances offline — queue for later processing
      const creation_origin = body.creation_origin || 'manual'
      
      // DEDUP: Check if there's already a pending item for same lead/phone
      const dedup_phone = normalizePhone(contact_phone || phone || '')
      const { data: existingQueue } = await supabase
        .from('group_creation_queue')
        .select('id')
        .eq('status', 'pending')
        .eq('lead_name', lead_name)
        .limit(1)
      
      if (existingQueue && existingQueue.length > 0) {
        console.log(`[create-group] DEDUP: Already queued for "${lead_name}". Skipping duplicate.`)
        return new Response(JSON.stringify({ 
          success: false, 
          queued: true,
          deduplicated: true,
          error: 'Este grupo já está na fila de criação.' 
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      
      const { error: queueError } = await supabase
        .from('group_creation_queue')
        .insert({
          lead_id: lead_id || null,
          lead_name,
          phone: phone || null,
          contact_phone: contact_phone || null,
          board_id: board_id || null,
          creator_instance_id: creator_instance_id || null,
          status: 'pending',
          creation_origin,
        })
      if (queueError) console.error('[create-group] Failed to queue:', queueError)
      return new Response(JSON.stringify({ 
        success: false, 
        queued: true,
        error: 'Todas as instâncias estão offline. A criação do grupo foi adicionada à fila e será processada automaticamente quando uma instância reconectar.' 
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const baseUrl = creatorInstance.base_url || 'https://abraci.uazapi.com'

    // Build group name from settings
    let groupName = lead_name
    let settings: any = null
    let leadData: any = null

    if (board_id) {
      const { data: s } = await supabase
        .from('board_group_settings')
        .select('*')
        .eq('board_id', board_id)
        .maybeSingle()
      settings = s
    }

    // Get lead data
    const normalizedPhone = normalizePhone(contact_phone || phone || '')
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle()
      leadData = data
    }
    if (!leadData && normalizedPhone) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle()
      leadData = data
    }

    let nextSeq: number | null = null

    if (settings) {
      nextSeq = Math.max(
        (settings.current_sequence || 0) + 1,
        settings.sequence_start || 1
      )

      // Build name parts
      const parts: string[] = []
      if (settings.group_name_prefix) parts.push(settings.group_name_prefix)
      parts.push(String(nextSeq).padStart(4, '0'))

      const leadFields = settings.lead_fields || ['lead_name']
      for (const field of leadFields) {
        if (leadData && leadData[field]) {
          parts.push(String(leadData[field]))
        } else if (field === 'lead_name') {
          parts.push(lead_name)
        }
      }

      groupName = parts.join(' ')
    }

    groupName = normalizeGroupName(groupName)

    // Build participant list
    const participants: string[] = []
    const normalizedContact = normalizePhone(contact_phone || phone || '')
    if (normalizedContact) {
      participants.push(normalizedContact)
    }

    // Get configured instances for this board with roles
    let boardInstances: any[] = []
    if (board_id) {
      const { data: bgi } = await supabase
        .from('board_group_instances')
        .select('instance_id, role_title, role_description')
        .eq('board_id', board_id)

      if (bgi && bgi.length > 0) {
        const instanceIds = bgi.map((b: any) => b.instance_id)
        const { data: instances } = await supabase
          .from('whatsapp_instances')
          .select('id, owner_phone, instance_name')
          .in('id', instanceIds)
          .eq('is_active', true)

        boardInstances = (instances || []).map((inst: any) => {
          const config = bgi.find((b: any) => b.instance_id === inst.id)
          return {
            ...inst,
            role_title: config?.role_title || null,
            role_description: config?.role_description || null,
          }
        })
      }
    }

    // Add board instances' owner phones (except creator's own phone)
    for (const inst of boardInstances) {
      if (inst.owner_phone && inst.id !== creatorInstance.id) {
        const p = normalizePhone(inst.owner_phone)
        if (p && !participants.includes(p)) {
          participants.push(p)
        }
      }
    }

    if (participants.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhum participante encontrado para criar o grupo.' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Idempotência: só reaproveita se o grupo existente realmente tiver participantes esperados.
    if (leadData?.whatsapp_group_id) {
      const existingGroupInfo = await fetchGroupInfo(baseUrl, creatorInstance.instance_token, leadData.whatsapp_group_id)
      const existingMatchedParticipants = countMatchedParticipants(existingGroupInfo?.participants || [], participants)
      const existingParticipantsTotal = existingGroupInfo?.participants?.length || 0

      if (existingGroupInfo && (existingMatchedParticipants > 0 || existingParticipantsTotal > 1)) {
        return new Response(JSON.stringify({
          success: true,
          existing: true,
          group_id: leadData.whatsapp_group_id,
          group_name: existingGroupInfo.groupName || groupName,
          participants_count: existingMatchedParticipants || existingParticipantsTotal,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      console.warn('Stale whatsapp_group_id found on lead, ignoring and creating a new group:', leadData.whatsapp_group_id)
      await supabase
        .from('leads')
        .update({ whatsapp_group_id: null } as any)
        .eq('id', leadData.id)
    }

    console.log(`Creating group "${groupName}" via instance ${creatorInstance.instance_name} with ${participants.length} participants:`, JSON.stringify(participants))

    // First try: validate numbers on WhatsApp before creating group
    const validParticipants: string[] = []
    for (const p of participants) {
      try {
        const checkRes = await fetch(`${baseUrl}/contact/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify({ number: p }),
        })
        if (checkRes.ok) {
          const checkData = await checkRes.json()
          const isValid = checkData?.exists || checkData?.numberExists || checkData?.onWhatsApp || checkData?.result === 'exists' || checkData?.jid
          if (isValid) {
            validParticipants.push(p)
          } else {
            console.warn(`Number ${p} not found on WhatsApp, skipping from group creation`)
          }
        } else {
          // If check fails, include the participant anyway
          validParticipants.push(p)
        }
      } catch (e) {
        // If check fails, include the participant anyway
        validParticipants.push(p)
      }
    }

    console.log(`Valid participants for group: ${validParticipants.length}/${participants.length}`, JSON.stringify(validParticipants))

    const participantsToCreate = validParticipants.length > 0 ? validParticipants : participants

    // Create group - try with valid participants first, fallback to creating empty group
    let createdWithoutParticipants = false

    let createRes = await postUazApiWithRetry(
      baseUrl,
      creatorInstance.instance_token,
      '/group/create',
      {
        name: groupName,
        participants: participantsToCreate,
      },
    )

    if (!createRes.ok && validParticipants.length > 0 && validParticipants.length !== participants.length) {
      const errText = await createRes.text()
      console.warn('Group create with validated participants failed:', createRes.status, errText, '- Retrying with raw participants')

      createRes = await postUazApiWithRetry(
        baseUrl,
        creatorInstance.instance_token,
        '/group/create',
        {
          name: groupName,
          participants,
        },
      )
    }

    // If creation fails with participants, try creating with no participants then adding them
    if (!createRes.ok) {
      const errText = await createRes.text()
      console.warn('Group create with participants failed:', createRes.status, errText, '- Trying empty group creation')

      createRes = await postUazApiWithRetry(
        baseUrl,
        creatorInstance.instance_token,
        '/group/create',
        {
          name: groupName,
          participants: [],
        },
      )

      if (!createRes.ok) {
        const errText2 = await createRes.text()

        if (isRateLimited(createRes.status, errText2)) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'A instância atingiu limite temporário da API para criação de grupo. Aguarde 1-2 minutos e tente novamente.' 
          }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({ 
          success: false, 
          error: `Erro ao criar grupo: ${createRes.status} - ${errText2}` 
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      createdWithoutParticipants = true
    }

    const groupData = await createRes.json()
    console.log('Group created:', JSON.stringify(groupData).substring(0, 500))

    // Try to extract groupId from various response formats
    let groupId = groupData?.group?.JID || groupData?.id || groupData?.jid || groupData?.data?.id || groupData?.gid || null
    console.log('Resolved groupId:', groupId)

    if (!groupId) {
      console.error('Could not resolve group ID from response:', JSON.stringify(groupData).substring(0, 300))
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Grupo criado mas não foi possível obter o ID do grupo da resposta da API' 
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Só confirma incremento de sequência após criação bem-sucedida
    if (settings && board_id && nextSeq !== null) {
      const { error: sequenceError } = await supabase
        .from('board_group_settings')
        .update({ current_sequence: nextSeq, updated_at: new Date().toISOString() })
        .eq('board_id', board_id)
        .or(`current_sequence.is.null,current_sequence.lte.${nextSeq}`)

      if (sequenceError) {
        console.error('Error updating board sequence after group creation:', sequenceError)
      }
    }

    const groupJid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`

    // Wait for WhatsApp to fully process the group creation
    await sleep(5000)

    // ============================================================
    // POST-CREATION STEPS — Each runs independently with error isolation
    // ============================================================

    // STEP 1: Extract conversation data and update lead
    diagnostics.push(await runStep('extract_conversation_data', async () => {
      if (!leadData?.id || !normalizedContact) return
      console.log('Extracting conversation data for lead', leadData.id)
      const { data: recentMessages } = await supabase
        .from('whatsapp_messages')
        .select('direction, message_text, created_at')
        .or(`phone.eq.${normalizedContact},phone.ilike.%${normalizedContact.slice(-8)}%`)
        .order('created_at', { ascending: true })
        .limit(100)

      if (!recentMessages || recentMessages.length === 0) {
        console.log('No messages found for extraction')
        return
      }

      console.log(`Found ${recentMessages.length} messages for extraction`)
      const extractRes = await fetch(`${cloudFunctionsUrl}/functions/v1/extract-conversation-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudAnonKey}`,
        },
        body: JSON.stringify({ messages: recentMessages, targetType: 'lead' }),
      })

      if (!extractRes.ok) {
        console.error('Extract conversation data failed:', extractRes.status, await extractRes.text())
        return
      }

      const extractData = await extractRes.json()
      const extracted = extractData?.data || {}
      console.log('Extracted data:', JSON.stringify(extracted).substring(0, 500))

      const leadUpdate: Record<string, any> = {}
      const fieldMap: Record<string, string> = {
        victim_name: 'victim_name', lead_email: 'lead_email', city: 'city',
        state: 'state', neighborhood: 'neighborhood', main_company: 'main_company',
        contractor_company: 'contractor_company', accident_address: 'accident_address',
        accident_date: 'accident_date', damage_description: 'damage_description',
        case_number: 'case_number', case_type: 'case_type', sector: 'sector',
        liability_type: 'liability_type', news_link: 'news_link', notes: 'notes',
        visit_city: 'visit_city', visit_state: 'visit_state', visit_address: 'visit_address',
      }

      for (const [extractKey, leadKey] of Object.entries(fieldMap)) {
        if (extracted[extractKey] && !leadData[leadKey]) {
          leadUpdate[leadKey] = extracted[extractKey]
        }
      }
      if (extracted.lead_phone && !leadData.lead_phone) {
        leadUpdate.lead_phone = extracted.lead_phone
      }

      if (Object.keys(leadUpdate).length > 0) {
        console.log('Updating lead with extracted data:', Object.keys(leadUpdate))
        await supabase.from('leads').update(leadUpdate).eq('id', leadData.id)
        const { data: refreshed } = await supabase.from('leads').select('*').eq('id', leadData.id).maybeSingle()
        if (refreshed) leadData = refreshed
      }
    }))

    // STEP 2: Add participants if group was created empty
    diagnostics.push(await runStep('add_participants', async () => {
      if (!createdWithoutParticipants || participantsToCreate.length === 0) return
      const result = await addParticipantsToGroup(
        baseUrl, creatorInstance.instance_token, groupJid, participantsToCreate
      )
      if (result.failed.length > 0) {
        console.warn(`[add-participants] ${result.failed.length} participants failed:`, result.failed)
      }
    }))

    // STEP 3: Verify & re-add missing participants
    let participantsCount = participantsToCreate.length
    let verificationWarning: string | null = null

    diagnostics.push(await runStep('verify_participants', async () => {
      let groupInfo = await fetchGroupInfo(baseUrl, creatorInstance.instance_token, groupId)

      if (!groupInfo) {
        verificationWarning = 'Não foi possível verificar participantes do grupo (problema na API), mas o grupo foi criado.'
        console.warn(verificationWarning)
        return
      }

      const actualPhones = extractParticipantPhones(groupInfo.participants || [])
      const missingParticipants = participantsToCreate.filter(
        (p) => !actualPhones.some((ap) => phoneMatches(ap, p))
      )

      if (missingParticipants.length > 0) {
        console.log(`[verify] ${missingParticipants.length} participants missing, re-adding:`, missingParticipants)
        const result = await addParticipantsToGroup(
          baseUrl, creatorInstance.instance_token, groupJid, missingParticipants
        )

        // Re-verify
        await sleep(2000)
        groupInfo = await fetchGroupInfo(baseUrl, creatorInstance.instance_token, groupId)
      }

      const matchedParticipants = countMatchedParticipants(groupInfo?.participants || [], participantsToCreate)
      const mainContactAdded = normalizedContact
        ? countMatchedParticipants(groupInfo?.participants || [], [normalizedContact]) > 0
        : true

      participantsCount = matchedParticipants || participantsToCreate.length

      if (normalizedContact && !mainContactAdded) {
        verificationWarning = 'O contato principal pode não ter entrado no grupo automaticamente.'
        console.warn(verificationWarning)
      }

      if (participantsToCreate.length > 0 && matchedParticipants === 0 && groupInfo) {
        verificationWarning = 'Nenhum participante verificado no grupo, mas prosseguindo com envios.'
        console.warn(verificationWarning)
      }
    }))

    // STEP 4: Get invite link
    let groupInviteLink: string | null = null
    diagnostics.push(await runStep('get_invite_link', async () => {
      const inviteRes = await fetch(`${baseUrl}/group/inviteCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
        body: JSON.stringify({ groupjid: groupJid }),
      })
      if (inviteRes.ok) {
        const inviteData = await inviteRes.json()
        const inviteCode = inviteData?.inviteCode || inviteData?.code || inviteData?.data?.inviteCode || inviteData?.data?.code || null
        if (inviteCode) {
          groupInviteLink = `https://chat.whatsapp.com/${inviteCode}`
          console.log(`[invite] Invite link obtained: ${groupInviteLink}`)
        } else {
          console.warn('[invite] inviteCode response had no code:', JSON.stringify(inviteData).substring(0, 300))
        }
      } else {
        console.warn('[invite] Failed to get invite code:', inviteRes.status, await inviteRes.text())
      }
    }))

    // STEP 5: Save group ID and link to lead
    diagnostics.push(await runStep('save_to_lead', async () => {
      if (!leadData?.id) return
      const updatePayload: any = { whatsapp_group_id: groupId }
      if (groupInviteLink) {
        updatePayload.group_link = groupInviteLink
      }
      // Use simpler update without .is() constraint that could fail if value was set to empty string
      await supabase
        .from('leads')
        .update(updatePayload)
        .eq('id', leadData.id)

      // Create/link a contact record for the group
      const groupContactName = `Grupo - ${leadData.lead_name || lead_name}`
      const { data: existingGroupContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('whatsapp_group_id', groupId)
        .maybeSingle()

      let groupContactId: string | null = existingGroupContact?.id || null

      if (!groupContactId) {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            full_name: groupContactName,
            lead_id: leadData.id,
            whatsapp_group_id: groupId,
            phone: normalizedContact || null,
            city: leadData.city || null,
            state: leadData.state || null,
            notes: groupInviteLink ? `Link do grupo: ${groupInviteLink}` : null,
            action_source: 'group_creation',
            action_source_detail: `Grupo criado automaticamente para o lead ${leadData.lead_name || lead_name}`,
          })
          .select('id')
          .single()
        groupContactId = newContact?.id || null
        console.log(`[save] Contact created for group: ${groupContactId}`)
      } else {
        await supabase
          .from('contacts')
          .update({ lead_id: leadData.id })
          .eq('id', groupContactId)
        console.log(`[save] Existing contact ${groupContactId} linked to lead ${leadData.id}`)
      }
    }))

    // STEP 6: Send private message to client with group link
    diagnostics.push(await runStep('send_link_to_client', async () => {
      if (!groupInviteLink) return
      const clientPhone = normalizePhone(contact_phone || phone)
      if (!clientPhone) return

      const linkMessage = `✅ Seu grupo foi criado com sucesso!\n\nAcesse pelo link abaixo:\n${groupInviteLink}`
      const sendLinkRes = await fetch(`${baseUrl}/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
        body: JSON.stringify({ number: clientPhone, text: linkMessage }),
      })
      if (sendLinkRes.ok) {
        console.log(`[send-link] Group link sent to client ${clientPhone}`)
        await supabase.from('whatsapp_messages').insert({
          instance_name: creatorInstance.instance_name,
          phone: clientPhone,
          message_text: linkMessage,
          message_type: 'text',
          direction: 'outbound',
          sender_name: 'Sistema',
          lead_id: leadData?.id || null,
          contact_id: leadData?.contact_id || null,
        } as any)
      } else {
        console.warn('[send-link] Failed to send group link to client:', sendLinkRes.status)
      }
    }))

    // STEP 7: Promote board instances as admins
    diagnostics.push(await runStep('promote_admins', async () => {
      const normalizedLeadContact = normalizePhone(contact_phone || phone)

      const phonesToPromote: string[] = []

      for (const inst of boardInstances) {
        if (inst.id === creatorInstance.id) continue
        if (!inst.owner_phone) continue
        const instPhone = normalizePhone(inst.owner_phone)
        if (instPhone && instPhone !== normalizedLeadContact && !phonesToPromote.includes(instPhone)) {
          phonesToPromote.push(instPhone)
        }
      }

      // Also promote any other active instance that was added to the group
      const { data: allInstances } = await supabase
        .from('whatsapp_instances')
        .select('id, owner_phone, instance_name')
        .eq('is_active', true)

      if (allInstances) {
        for (const inst of allInstances) {
          if (inst.id === creatorInstance.id) continue
          if (!inst.owner_phone) continue
          const instPhone = normalizePhone(inst.owner_phone)
          if (instPhone && instPhone !== normalizedLeadContact && !phonesToPromote.includes(instPhone)) {
            const isInGroup = participants.some(p => phoneMatches(p, instPhone))
            if (isInGroup) {
              phonesToPromote.push(instPhone)
            }
          }
        }
      }

      if (phonesToPromote.length === 0) return

      console.log(`[promote] Promoting ${phonesToPromote.length} participants as admin:`, phonesToPromote)

      for (const participant of phonesToPromote) {
        const promoteRes = await postUazApiWithRetry(
          baseUrl, creatorInstance.instance_token,
          '/group/updateParticipants',
          { groupjid: groupJid, action: 'promote', participants: [participant] },
        )
        if (!promoteRes.ok) {
          console.warn(`[promote] Failed to promote ${participant}:`, await promoteRes.text())
        }
        await sleep(400)
      }
    }))

    // STEP 8: Forward documents
    const sentUrls = new Set<string>()

    diagnostics.push(await runStep('forward_documents', async () => {
      if (!settings?.forward_document_types?.length || !leadData) return
      console.log('Forwarding documents. Types:', settings.forward_document_types)
      await forwardDocuments(supabase, settings, leadData, groupId, baseUrl, creatorInstance, sentUrls)
    }))

    // STEP 9: Forward conversation media
    diagnostics.push(await runStep('forward_conversation_media', async () => {
      if (!leadData) return
      const phonesToSearch = new Set<string>()
      const mainPhone = normalizedPhone || normalizePhone(contact_phone || phone)
      if (mainPhone) phonesToSearch.add(mainPhone)
      if (leadData.lead_phone) {
        const leadPh = normalizePhone(leadData.lead_phone)
        if (leadPh) phonesToSearch.add(leadPh)
      }
      await forwardConversationMedia(supabase, leadData, mainPhone, groupId, baseUrl, creatorInstance, sentUrls, Array.from(phonesToSearch))
    }))

    // STEP 10: Send initial message (AFTER documents so documents appear first)
    diagnostics.push(await runStep('send_initial_message', async () => {
      if (!settings) return
      console.log('Sending initial message... use_ai_message:', settings.use_ai_message, 'template:', !!settings.initial_message_template)
      await sendInitialMessage(supabase, settings, leadData, lead_name, groupName, groupId, baseUrl, creatorInstance, board_id, boardInstances)
    }))

    // STEP 11: Auto-create legal processes
    diagnostics.push(await runStep('auto_create_processes', async () => {
      if (!leadData?.id || !settings?.auto_create_process) return

      const workflows: Array<{ workflow_board_id: string; activities: any[] }> = []
      
      if (settings.process_workflows && Array.isArray(settings.process_workflows) && settings.process_workflows.length > 0) {
        workflows.push(...settings.process_workflows)
      } else if (settings.process_workflow_board_id) {
        workflows.push({ workflow_board_id: settings.process_workflow_board_id, activities: settings.process_auto_activities || [] })
      }

      for (const wf of workflows) {
        console.log(`[process] Auto-creating process for lead ${leadData.id}, workflow ${wf.workflow_board_id}`)
        
        let nucleusId = settings.process_nucleus_id || null
        if (!nucleusId && wf.workflow_board_id) {
          const { data: board } = await supabase.from('kanban_boards').select('product_service_id').eq('id', wf.workflow_board_id).maybeSingle()
          if (board?.product_service_id) {
            const { data: product } = await supabase.from('products_services').select('nucleus_id').eq('id', board.product_service_id).maybeSingle()
            nucleusId = product?.nucleus_id || null
          }
        }

        const { data: caseNumber } = await supabase.rpc('generate_case_number', { p_nucleus_id: nucleusId })
        if (!caseNumber) continue

        let workflowName = 'Processo'
        const { data: wfBoard } = await supabase.from('kanban_boards').select('name').eq('id', wf.workflow_board_id).maybeSingle()
        if (wfBoard?.name) workflowName = wfBoard.name

        const caseTitle = `${leadData.lead_name || lead_name} - ${workflowName}`
        
        const { data: newCase, error: caseError } = await supabase
          .from('legal_cases')
          .insert({
            case_number: caseNumber,
            title: caseTitle,
            lead_id: leadData.id,
            nucleus_id: nucleusId,
            workflow_board_id: wf.workflow_board_id || null,
            status: 'em_andamento',
            description: `Processo criado automaticamente ao criar grupo WhatsApp "${groupName}"`,
            action_source: 'system',
            action_source_detail: 'Criação automática via grupo WhatsApp',
          })
          .select('id')
          .single()
        
        if (caseError) {
          console.error('[process] Error creating case:', caseError)
          continue
        }
        
        console.log(`[process] Created case ${caseNumber} (${newCase.id})`)
        
        const activities = wf.activities || []
        for (const act of activities) {
          if (!act.title) continue
          let assignedName = null
          if (act.assigned_to) {
            const { data: profile } = await supabase.from('profiles').select('full_name').eq('user_id', act.assigned_to).maybeSingle()
            assignedName = profile?.full_name || null
          }
          const deadline = new Date()
          deadline.setDate(deadline.getDate() + (act.deadline_days || 1))
          
          await supabase.from('lead_activities').insert({
            lead_id: leadData.id,
            lead_name: leadData.lead_name || lead_name,
            title: act.title,
            description: `Atividade do processo ${caseNumber}. Criada automaticamente.`,
            activity_type: act.activity_type || 'tarefa',
            status: 'pendente',
            priority: act.priority || 'normal',
            assigned_to: act.assigned_to || null,
            assigned_to_name: assignedName,
            deadline: deadline.toISOString().split('T')[0],
          })
          console.log(`[process] Created activity: ${act.title} -> ${assignedName || 'unassigned'}`)
        }
      }
    }))

    // Summarize diagnostics
    const failedSteps = diagnostics.filter(d => !d.ok)
    if (failedSteps.length > 0) {
      console.warn(`[create-group] ${failedSteps.length}/${diagnostics.length} steps failed:`, 
        failedSteps.map(s => `${s.step}: ${s.error}`).join('; '))
    } else {
      console.log(`[create-group] All ${diagnostics.length} steps completed successfully`)
    }

    return new Response(JSON.stringify({
      success: true,
      group_id: groupId,
      group_name: groupName,
      group_link: groupInviteLink || undefined,
      participants_count: participantsCount,
      warning: verificationWarning || undefined,
      steps_total: diagnostics.length,
      steps_failed: failedSteps.length,
      failed_steps: failedSteps.length > 0 ? failedSteps.map(s => s.step) : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Create group error:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      diagnostics: diagnostics.filter(d => !d.ok),
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function sendInitialMessage(
  supabase: any, settings: any, leadData: any, lead_name: string,
  groupName: string, groupId: string, baseUrl: string, creatorInstance: any, boardId: string, boardInstances: any[]
) {
  try {
    let messageText = ''

    // Get board name
    let boardName = ''
    if (boardId) {
      const { data: board } = await supabase.from('kanban_boards').select('name').eq('id', boardId).maybeSingle()
      boardName = board?.name || ''
    }

    // Get custom fields for this lead
    let customFieldsText = ''
    if (leadData?.id) {
      try {
        const { data: customFields } = await supabase
          .from('lead_custom_field_values')
          .select('definition:lead_custom_field_definitions(label, field_type), value')
          .eq('lead_id', leadData.id)

        if (customFields && customFields.length > 0) {
          const fieldLines = customFields
            .filter((cf: any) => cf.value && cf.definition)
            .map((cf: any) => `${cf.definition.label}: ${cf.value}`)
          if (fieldLines.length > 0) {
            customFieldsText = '\n\nCampos personalizados:\n' + fieldLines.join('\n')
          }
        }
      } catch (e) {
        console.log('Custom fields not available:', e)
      }
    }

    // Get open activities for this lead
    let activitiesText = ''
    let activitiesLinks: string[] = []
    if (leadData?.id) {
      try {
        const { data: activities } = await supabase
          .from('lead_activities')
          .select('id, title, activity_type, status, due_date, assigned_to_name')
          .eq('lead_id', leadData.id)
          .in('status', ['pendente', 'em_andamento'])
          .order('due_date', { ascending: true })
          .limit(10)

        if (activities && activities.length > 0) {
          const actLines = activities.map((a: any) => {
            const dueStr = a.due_date ? ` (prazo: ${new Date(a.due_date).toLocaleDateString('pt-BR')})` : ''
            const assignee = a.assigned_to_name ? ` → ${a.assigned_to_name}` : ''
            return `• ${a.title}${dueStr}${assignee}`
          })
          activitiesText = '\n\nAtividades abertas:\n' + actLines.join('\n')

          activitiesLinks = activities.map((a: any) =>
            `🔗 ${a.title}: https://adscore-keeper.lovable.app/?openActivity=${a.id}`
          )
        }
      } catch (e) {
        console.log('Activities not available:', e)
      }
    }

    // Build participants info
    let participantsText = ''
    if (boardInstances && boardInstances.length > 0) {
      const participantLines = boardInstances.map((inst: any, idx: number) => {
        const num = idx + 1
        const role = inst.role_title ? ` - ${inst.role_title}` : ''
        const desc = inst.role_description ? `: ${inst.role_description}` : ''
        return `${num}. ${inst.instance_name}${role}${desc}`
      })
      participantsText = '\n\nParticipantes do grupo:\n' + participantLines.join('\n')
    }

    if (settings.use_ai_message) {
      if (settings.ai_generated_message) {
        console.log('Using saved AI message model with real data substitution')
        const leadInfo = leadData ? Object.entries(leadData)
          .filter(([k, v]) => v && !['id', 'created_at', 'updated_at', 'created_by', 'assigned_to'].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n') : `Nome: ${lead_name}`

        const aiPrompt = `Você tem um MODELO de mensagem de grupo de WhatsApp criado com dados fictícios. Sua tarefa é reescrever este modelo substituindo TODOS os dados fictícios pelos dados REAIS do lead fornecidos abaixo, mantendo EXATAMENTE a mesma estrutura, formatação, emojis e seções do modelo.

MODELO DA MENSAGEM (com dados fictícios):
${settings.ai_generated_message}

DADOS REAIS DO LEAD/CASO:
${leadInfo}
${customFieldsText}
${activitiesText}
${participantsText}

Funil: ${boardName}
Nome do grupo: ${groupName}

REGRAS:
1. Mantenha a MESMA estrutura e formatação do modelo original.
2. Substitua TODOS os dados fictícios pelos dados reais correspondentes.
3. Se um dado real não estiver disponível, OMITA a linha inteira em vez de escrever "Não informado".
4. NÃO adicione seções que não existam no modelo original.
5. NÃO inclua links na mensagem (serão adicionados separadamente).
6. NÃO inclua observações administrativas ou técnicas.
7. Certifique-se de que a mensagem está COMPLETA — não corte no meio de uma frase ou campo.
8. Retorne APENAS a mensagem final, sem explicações.`

        try {
          const aiResult = await geminiChat({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: aiPrompt }],
            max_tokens: 8192,
          })
          messageText = aiResult?.choices?.[0]?.message?.content || ''
          console.log('AI message substitution result length:', messageText.length)
        } catch (aiErr) {
          console.error('AI message substitution error:', aiErr)
        }
      } else {
        console.log('No saved AI model, generating from scratch')
        const leadInfo = leadData ? Object.entries(leadData)
          .filter(([k, v]) => v && !['id', 'created_at', 'updated_at', 'created_by', 'assigned_to'].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n') : `Nome: ${lead_name}`

        const aiPrompt = `Gere uma mensagem de boas-vindas para um grupo de WhatsApp de acompanhamento de caso.

REGRA FUNDAMENTAL: Use APENAS os dados fornecidos abaixo. NÃO invente, complete ou suponha nenhuma informação que não esteja explicitamente nos dados.

Dados do lead/caso:
${leadInfo}
${customFieldsText}
${activitiesText}
${participantsText}

Funil: ${boardName}
Nome do grupo: ${groupName}

${settings.initial_message_template ? `Instruções adicionais: ${settings.initial_message_template}` : ''}

Gere uma mensagem profissional e organizada com emojis, usando formatação do WhatsApp (*negrito*, _itálico_). NÃO inclua links.`

        try {
          const aiResult = await geminiChat({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: aiPrompt }],
            max_tokens: 8192,
          })
          messageText = aiResult?.choices?.[0]?.message?.content || ''
          console.log('AI message generation result length:', messageText.length)
        } catch (aiErr) {
          console.error('AI message generation error:', aiErr)
        }
      }

      if (!messageText) {
        messageText = `📋 *${groupName}*\n\nGrupo criado para acompanhamento do caso de *${lead_name}*.`
      }
    } else if (settings.initial_message_template) {
      messageText = settings.initial_message_template

      const replacements: Record<string, string> = {
        '{lead_name}': leadData?.lead_name || lead_name || '',
        '{victim_name}': leadData?.victim_name || '',
        '{case_type}': leadData?.case_type || '',
        '{city}': leadData?.city || '',
        '{state}': leadData?.state || '',
        '{case_number}': leadData?.case_number || '',
        '{group_name}': groupName || '',
        '{board_name}': boardName,
        '{source}': leadData?.source || '',
        '{main_company}': leadData?.main_company || '',
        '{neighborhood}': leadData?.neighborhood || '',
      }

      for (const [key, value] of Object.entries(replacements)) {
        messageText = messageText.replaceAll(key, value)
      }
    }

    if (messageText) {
      // Clean admin notes from AI output
      messageText = messageText.replace(/⚠️\s*OBSERV[AÇ]+[ÃO]+[:\s].*$/gims, '').trim()
      
      // Remove incomplete/dangling lines
      messageText = messageText
        .split('\n')
        .filter(line => {
          const trimmed = line.trim()
          if (/^\*?\s*\*[^*]*$/.test(trimmed) && trimmed.length < 15 && !trimmed.includes(':')) return false
          if (/^\*\s*\*\w+$/.test(trimmed)) return false
          return true
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      // Split long messages (WhatsApp limit ~4096 chars)
      const messageParts: string[] = []
      if (messageText.length > 3800) {
        const sections = messageText.split('\n\n')
        let currentPart = ''
        for (const section of sections) {
          if (currentPart.length + section.length + 2 > 3800) {
            if (currentPart.trim()) messageParts.push(currentPart.trim())
            currentPart = section
          } else {
            currentPart += (currentPart ? '\n\n' : '') + section
          }
        }
        if (currentPart.trim()) messageParts.push(currentPart.trim())
      } else {
        messageParts.push(messageText)
      }

      // Send text message parts
      for (let i = 0; i < messageParts.length; i++) {
        const sendTextRes = await fetch(`${baseUrl}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify({ number: groupId, text: messageParts[i] }),
        })
        if (!sendTextRes.ok) {
          console.error(`Failed to send initial message part ${i + 1}:`, sendTextRes.status, await sendTextRes.text())
        } else {
          console.log(`Initial message part ${i + 1}/${messageParts.length} sent to group`)
        }
        if (i < messageParts.length - 1) await sleep(1000)
      }

      await sleep(1000)

      // Send activity links separately
      if (activitiesLinks.length > 0) {
        const linksMessage = '📎 *Links das atividades:*\n\n' + activitiesLinks.join('\n')
        await fetch(`${baseUrl}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify({ number: groupId, text: linksMessage }),
        })
        console.log('Activity links sent to group')
        await sleep(1000)
      }

      // Generate and send audio if configured
      let audioVoiceId = settings.audio_voice_id
      if (creatorInstance.owner_phone) {
        const ownerPhone = creatorInstance.owner_phone.replace(/\D/g, '')
        const { data: ownerProfile } = await supabase
          .from('profiles')
          .select('voice_id')
          .or(`phone.eq.${ownerPhone},phone.ilike.%${ownerPhone.slice(-8)}%`)
          .not('voice_id', 'is', null)
          .limit(1)
          .maybeSingle()
        if (ownerProfile?.voice_id) {
          audioVoiceId = ownerProfile.voice_id
          console.log('Using member voice:', audioVoiceId)
        }
      }
      
      console.log('Audio check - send_audio_message:', settings.send_audio_message, 'audioVoiceId:', audioVoiceId, 'hasText:', !!messageText)
      
      if (settings.send_audio_message && audioVoiceId && messageText) {
        await sendAudioMessage(supabase, messageText, audioVoiceId, groupId, baseUrl, creatorInstance)
      } else if (!audioVoiceId) {
        console.log('Skipping audio: no voice ID configured')
      }

      // Set group description
      if (groupId) {
        try {
          const groupJidForDesc = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`
          const descriptionText = messageText.length > 2048 ? messageText.substring(0, 2045) + '...' : messageText
          const descRes = await fetch(`${baseUrl}/group/updateDescription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
            body: JSON.stringify({ groupjid: groupJidForDesc, description: descriptionText }),
          })
          if (!descRes.ok) {
            const descRes2 = await fetch(`${baseUrl}/group/description`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
              body: JSON.stringify({ groupjid: groupJidForDesc, description: descriptionText }),
            })
            if (!descRes2.ok) {
              console.warn('[initial-msg] Failed to set group description:', descRes2.status)
            }
          }
          console.log('[initial-msg] Group description set')
        } catch (descErr) {
          console.warn('[initial-msg] Error setting group description:', descErr)
        }
      }
    }
  } catch (err) {
    console.error('Error sending initial message:', err)
    throw err // Re-throw so runStep captures it
  }
}

async function sendAudioMessage(
  supabase: any, text: string, voiceId: string, groupId: string,
  baseUrl: string, creatorInstance: any
) {
  try {
    const cloudFunctionsUrl2 = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
    const cloudAnonKey2 = Deno.env.get('SUPABASE_ANON_KEY') || ''

    // Clean text for audio
    const cleanText = text
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~([^~]+)~/g, '$1')
      .replace(/```[^`]*```/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/📎\s*Links das atividades:.*$/gms, '')
      .replace(/🔗[^\n]*/g, '')
      .trim()

    if (!cleanText || cleanText.length < 10) {
      console.log('Text too short for audio, skipping')
      return
    }

    const ttsRes = await fetch(`${cloudFunctionsUrl2}/functions/v1/elevenlabs-sts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudAnonKey2}`,
      },
      body: JSON.stringify({
        text: cleanText.substring(0, 5000),
        voice_id: voiceId,
        output_format: 'mp3_44100_128',
      }),
    })

    if (!ttsRes.ok) {
      console.error('TTS API error:', ttsRes.status, await ttsRes.text())
      return
    }

    const ttsData = await ttsRes.json()
    const audioUrl = ttsData?.audio_url

    if (!audioUrl) {
      console.error('No audio URL in TTS response')
      return
    }

    await fetch(`${baseUrl}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
      body: JSON.stringify({
        number: groupId,
        file: audioUrl,
        type: 'audio',
      }),
    })
    console.log('Audio message sent to group')
  } catch (err) {
    console.error('Error sending audio message:', err)
  }
}

async function forwardDocuments(
  supabase: any, settings: any, leadData: any, groupId: string,
  baseUrl: string, creatorInstance: any, sentUrls: Set<string>
) {
  try {
    const docTypes = settings.forward_document_types || []
    const leadName = leadData.lead_name || leadData.victim_name || 'Lead'

    // Get collected documents from whatsapp collection sessions (by lead_id OR phone)
    let sessions: any[] = []
    const { data: sessionsByLead } = await supabase
      .from('whatsapp_collection_sessions')
      .select('id, collected_data, received_documents, phone')
      .eq('lead_id', leadData.id)
      .order('created_at', { ascending: false })
      .limit(5)
    if (sessionsByLead) sessions.push(...sessionsByLead)

    // Also search by lead_phone if available
    if (leadData.lead_phone) {
      const leadPh = leadData.lead_phone.replace(/\D/g, '')
      if (leadPh) {
        // FIX: use correct table name (was 'wjia_collection_sessions' which doesn't exist)
        const { data: sessionsByPhone } = await supabase
          .from('whatsapp_collection_sessions')
          .select('id, collected_data, received_documents, phone')
          .eq('phone', leadPh)
          .order('created_at', { ascending: false })
          .limit(5)
        if (sessionsByPhone) {
          const existingIds = new Set(sessions.map((s: any) => s.id))
          sessions.push(...sessionsByPhone.filter((s: any) => !existingIds.has(s.id)))
        }
      }
    }

    // Get ZapSign signed documents - always check for these regardless of type filter
    let signedDocs: any[] = []
    const { data: zapSignData, error: zapSignError } = await supabase
      .from('zapsign_documents')
      .select('*')
      .eq('lead_id', leadData.id)
      .not('signed_file_url', 'is', null)
    
    if (zapSignError) {
      console.error('[forward-docs] ZapSign query error:', zapSignError)
    } else {
      signedDocs = zapSignData || []
      console.log(`[forward-docs] Found ${signedDocs.length} ZapSign signed documents`)
    }

    const docLabels: Record<string, string> = {
      'procuracao': 'Procuração',
      'rg': 'RG',
      'cpf': 'CPF',
      'cnh': 'CNH',
      'comprovante_endereco': 'Comprovante de Endereço',
      'laudo_medico': 'Laudo Médico',
      'cat': 'CAT',
      'contrato': 'Contrato',
      'zapsign_signed': 'Documento Assinado',
      'outros': 'Documento',
    }

    // Send ZapSign signed documents
    for (const doc of signedDocs) {
      if (!doc.signed_file_url || sentUrls.has(doc.signed_file_url)) continue
      sentUrls.add(doc.signed_file_url)
      const docLabel = doc.template_name || docLabels['zapsign_signed']
      const fileName = `${docLabel} - ${leadName}.pdf`
      try {
        const sendRes = await fetch(`${baseUrl}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify({ number: groupId, file: doc.signed_file_url, type: 'document', fileName, caption: `📄 ${docLabel} - ${leadName}` }),
        })
        if (!sendRes.ok) {
          console.error(`[forward-docs] Failed to send signed doc ${fileName}:`, sendRes.status, await sendRes.text())
        } else {
          console.log(`[forward-docs] Sent signed doc: ${fileName}`)
        }
        await sleep(800)
      } catch (e) {
        console.error(`[forward-docs] Error sending signed doc:`, e)
      }
    }

    // Send collected documents from sessions
    if (sessions && sessions.length > 0) {
      console.log(`[forward-docs] Found ${sessions.length} collection sessions`)
      for (const session of sessions) {
        const collected = session.collected_data || {}
        for (const docType of docTypes) {
          if (docType === 'zapsign_signed') continue
          const docKey = docType + '_url'
          const docUrl = collected[docKey] || collected[docType]
          if (docUrl && typeof docUrl === 'string' && (docUrl.startsWith('http') || docUrl.startsWith('/')) && !sentUrls.has(docUrl)) {
            sentUrls.add(docUrl)
            const label = docLabels[docType] || docType
            const fileName = `${label} - ${leadName}.pdf`
            try {
              const sendRes = await fetch(`${baseUrl}/send/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
                body: JSON.stringify({ number: groupId, file: docUrl, type: 'document', fileName, caption: `📄 ${label} - ${leadName}` }),
              })
              if (!sendRes.ok) {
                console.error(`[forward-docs] Failed to send doc ${fileName}:`, sendRes.status)
              } else {
                console.log(`[forward-docs] Sent doc: ${fileName}`)
              }
              await sleep(800)
            } catch (e) {
              console.error(`[forward-docs] Error sending doc ${docType}:`, e)
            }
          }
        }

        // Also forward received_documents
        const receivedDocs = session.received_documents || []
        for (const rd of receivedDocs) {
          if (!rd.media_url || sentUrls.has(rd.media_url)) continue
          sentUrls.add(rd.media_url)
          const label = docLabels[rd.type] || rd.type || 'Documento'
          const fileName = `${label} - ${leadName}.pdf`
          try {
            const sendRes = await fetch(`${baseUrl}/send/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
              body: JSON.stringify({ number: groupId, file: rd.media_url, type: 'document', fileName, caption: `📄 ${label} - ${leadName}` }),
            })
            if (!sendRes.ok) {
              console.error(`[forward-docs] Failed to send received doc ${label}:`, sendRes.status)
            } else {
              console.log(`[forward-docs] Sent received doc: ${label}`)
            }
            await sleep(800)
          } catch (e) {
            console.error(`[forward-docs] Error sending received doc:`, e)
          }
        }
      }
    }

    // Check lead_documents table
    try {
      const { data: leadDocs } = await supabase
        .from('lead_documents')
        .select('*')
        .eq('lead_id', leadData.id)

      console.log(`[forward-docs] Found ${leadDocs?.length || 0} lead_documents`)
      
      if (leadDocs) {
        for (const doc of leadDocs) {
          if (!doc.file_url || sentUrls.has(doc.file_url)) continue
          const docType = (doc.document_type || '').toLowerCase()
          if (docTypes.some((dt: string) => docType.includes(dt) || dt === 'outros')) {
            sentUrls.add(doc.file_url)
            const label = doc.document_name || docLabels[docType] || 'Documento'
            const fileName = `${label} - ${leadName}.pdf`
            try {
              const sendRes = await fetch(`${baseUrl}/send/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
                body: JSON.stringify({ number: groupId, file: doc.file_url, type: 'document', fileName, caption: `📄 ${label} - ${leadName}` }),
              })
              if (!sendRes.ok) {
                console.error(`[forward-docs] Failed to send lead doc ${fileName}:`, sendRes.status)
              } else {
                console.log(`[forward-docs] Sent lead doc: ${fileName}`)
              }
              await sleep(800)
            } catch (e) {
              console.error(`[forward-docs] Error sending lead doc:`, e)
            }
          }
        }
      }
    } catch (e) {
      console.log('[forward-docs] lead_documents table not available:', e)
    }
    
    console.log(`[forward-docs] Total unique URLs sent: ${sentUrls.size}`)
  } catch (err) {
    console.error('[forward-docs] Error forwarding documents:', err)
    throw err // Re-throw so runStep captures it
  }
}

async function forwardConversationMedia(
  supabase: any, leadData: any, phone: string, groupId: string,
  baseUrl: string, creatorInstance: any, sentUrls: Set<string>, allPhones?: string[]
) {
  try {
    const leadName = leadData.lead_name || leadData.victim_name || 'Lead'

    // 1. Forward ZapSign signed documents
    const { data: signedDocs } = await supabase
      .from('zapsign_documents')
      .select('template_name, signed_file_url')
      .eq('lead_id', leadData.id)
      .not('signed_file_url', 'is', null)

    if (signedDocs && signedDocs.length > 0) {
      for (const doc of signedDocs) {
        if (!doc.signed_file_url || sentUrls.has(doc.signed_file_url)) continue
        sentUrls.add(doc.signed_file_url)
        const docLabel = doc.template_name || 'Procuração Assinada'
        const fileName = `${docLabel} - ${leadName}.pdf`
        try {
          await fetch(`${baseUrl}/send/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
            body: JSON.stringify({ number: groupId, file: doc.signed_file_url, type: 'document', fileName, caption: `📄 ${docLabel} - ${leadName}` }),
          })
          console.log(`[conv-media] Sent signed doc: ${fileName}`)
          await sleep(800)
        } catch (e) {
          console.error(`[conv-media] Error sending signed doc:`, e)
        }
      }
    }

    // 2. Forward inbound media from WhatsApp conversation
    const phonesToSearch = allPhones && allPhones.length > 0 ? allPhones : (phone ? [phone] : [])
    if (phonesToSearch.length === 0) {
      console.log('[conv-media] No phone to search conversation media')
      return
    }

    const phoneFilters = phonesToSearch.flatMap(p => {
      const suffix = p.slice(-8)
      return [`phone.eq.${p}`, `phone.ilike.%${suffix}%`]
    })
    const { data: mediaMessages } = await supabase
      .from('whatsapp_messages')
      .select('media_url, message_type, message_text, contact_name')
      .or(phoneFilters.join(','))
      .eq('direction', 'inbound')
      .in('message_type', ['image', 'document', 'video', 'sticker'])
      .not('media_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50)

    if (!mediaMessages || mediaMessages.length === 0) {
      console.log(`[conv-media] No inbound media found for phones: ${phonesToSearch.join(', ')}`)
      return
    }

    console.log(`[conv-media] Found ${mediaMessages.length} inbound media messages to forward`)

    let mediaCount = 0
    for (const msg of mediaMessages) {
      if (!msg.media_url || sentUrls.has(msg.media_url)) continue
      sentUrls.add(msg.media_url)

      const isDoc = msg.message_type === 'document'
      const mediaType = isDoc ? 'document' : (msg.message_type === 'video' ? 'video' : 'image')
      const caption = msg.message_text ? `📎 ${msg.message_text}` : `📎 Documento do cliente - ${leadName}`
      
      const ext = isDoc ? 'pdf' : (msg.message_type === 'video' ? 'mp4' : 'jpg')
      const fileName = isDoc ? `Documento_${mediaCount + 1}_${leadName}.${ext}` : undefined

      try {
        const payload: any = { number: groupId, file: msg.media_url, type: mediaType }
        if (isDoc && fileName) {
          payload.fileName = fileName
        }
        if (caption) {
          payload.caption = caption
        }

        await fetch(`${baseUrl}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify(payload),
        })
        mediaCount++
        console.log(`[conv-media] Sent ${mediaType}: ${msg.media_url.substring(0, 80)}...`)
        await sleep(800)
      } catch (e) {
        console.error(`[conv-media] Error sending media:`, e)
      }
    }

    console.log(`[conv-media] Forwarded ${mediaCount} media items to group`)
  } catch (err) {
    console.error('[conv-media] Error forwarding conversation media:', err)
    throw err // Re-throw so runStep captures it
  }
}
