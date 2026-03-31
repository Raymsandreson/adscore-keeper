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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { phone, lead_name, board_id, contact_phone, creator_instance_id, lead_id } = await req.json()

    if (!lead_name) {
      return new Response(JSON.stringify({ success: false, error: 'lead_name is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get the creator instance
    let creatorInstance: any = null
    if (creator_instance_id) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('id', creator_instance_id)
        .eq('is_active', true)
        .single()
      creatorInstance = data
    }
    if (!creatorInstance) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single()
      creatorInstance = data
    }

    if (!creatorInstance) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma instância WhatsApp ativa encontrada' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    const normalizedPhone = (contact_phone || phone || '').replace(/\D/g, '')
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

    // Idempotência: se o lead já possui grupo, não cria novamente e não consome sequência
    if (leadData?.whatsapp_group_id) {
      return new Response(JSON.stringify({
        success: true,
        existing: true,
        group_id: leadData.whatsapp_group_id,
        group_name: groupName,
        participants_count: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    groupName = normalizeGroupName(groupName)

    // Build participant list
    const participants: string[] = []
    const normalizedContact = (contact_phone || phone || '').replace(/\D/g, '')
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
        const p = inst.owner_phone.replace(/\D/g, '')
        if (p && !participants.includes(p)) {
          participants.push(p)
        }
      }
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

    // Create group - try with valid participants first, fallback to creating empty group
    let createdWithoutParticipants = false

    let createRes = await postUazApiWithRetry(
      baseUrl,
      creatorInstance.instance_token,
      '/group/create',
      {
        name: groupName,
        participants: validParticipants,
      },
    )

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
          throw new Error('A instância atingiu limite temporário da API para criação de grupo. Aguarde 1-2 minutos e tente novamente.')
        }

        throw new Error(`Erro ao criar grupo: ${createRes.status} - ${errText2}`)
      }

      createdWithoutParticipants = true
    }

    const groupData = await createRes.json()
    console.log('Group created:', JSON.stringify(groupData).substring(0, 500))

    // Try to extract groupId from various response formats
    let groupId = groupData?.group?.JID || groupData?.id || groupData?.jid || groupData?.data?.id || groupData?.gid || null
    console.log('Resolved groupId:', groupId)

    // Só confirma incremento de sequência após criação bem-sucedida
    if (groupId && settings && board_id && nextSeq !== null) {
      const { error: sequenceError } = await supabase
        .from('board_group_settings')
        .update({ current_sequence: nextSeq, updated_at: new Date().toISOString() })
        .eq('board_id', board_id)
        .or(`current_sequence.is.null,current_sequence.lte.${nextSeq}`)

      if (sequenceError) {
        console.error('Error updating board sequence after group creation:', sequenceError)
      }
    }

    if (groupId && leadData?.id) {
      await supabase
        .from('leads')
        .update({ whatsapp_group_id: groupId } as any)
        .eq('id', leadData.id)
        .is('whatsapp_group_id', null)
    }

    // Extract conversation data and update lead
    if (leadData?.id && normalizedContact) {
      try {
        console.log('Extracting conversation data for lead', leadData.id)
        // Fetch recent messages from WhatsApp conversation
        const { data: recentMessages } = await supabase
          .from('whatsapp_messages')
          .select('direction, message_text, created_at')
          .or(`phone.eq.${normalizedContact},phone.ilike.%${normalizedContact.slice(-8)}%`)
          .order('created_at', { ascending: true })
          .limit(100)

        if (recentMessages && recentMessages.length > 0) {
          console.log(`Found ${recentMessages.length} messages for extraction`)
          
          // Call extract-conversation-data
          const extractRes = await fetch(`${cloudFunctionsUrl}/functions/v1/extract-conversation-data`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cloudAnonKey}`,
            },
            body: JSON.stringify({
              messages: recentMessages,
              targetType: 'lead',
            }),
          })

          if (extractRes.ok) {
            const extractData = await extractRes.json()
            const extracted = extractData?.data || {}
            console.log('Extracted data:', JSON.stringify(extracted).substring(0, 500))

            // Map extracted fields to lead columns
            const leadUpdate: Record<string, any> = {}
            const fieldMap: Record<string, string> = {
              victim_name: 'victim_name',
              lead_email: 'lead_email',
              city: 'city',
              state: 'state',
              neighborhood: 'neighborhood',
              main_company: 'main_company',
              contractor_company: 'contractor_company',
              accident_address: 'accident_address',
              accident_date: 'accident_date',
              damage_description: 'damage_description',
              case_number: 'case_number',
              case_type: 'case_type',
              sector: 'sector',
              liability_type: 'liability_type',
              news_link: 'news_link',
              notes: 'notes',
              visit_city: 'visit_city',
              visit_state: 'visit_state',
              visit_address: 'visit_address',
            }

            for (const [extractKey, leadKey] of Object.entries(fieldMap)) {
              if (extracted[extractKey] && !leadData[leadKey]) {
                leadUpdate[leadKey] = extracted[extractKey]
              }
            }

            // Special: lead_phone from extraction
            if (extracted.lead_phone && !leadData.lead_phone) {
              leadUpdate.lead_phone = extracted.lead_phone
            }

            if (Object.keys(leadUpdate).length > 0) {
              console.log('Updating lead with extracted data:', Object.keys(leadUpdate))
              await supabase.from('leads').update(leadUpdate).eq('id', leadData.id)
              // Refresh leadData for initial message
              const { data: refreshed } = await supabase.from('leads').select('*').eq('id', leadData.id).maybeSingle()
              if (refreshed) leadData = refreshed
            }
          } else {
            console.error('Extract conversation data failed:', extractRes.status, await extractRes.text())
          }
        } else {
          console.log('No messages found for extraction')
        }
      } catch (extractErr) {
        console.error('Error extracting conversation data:', extractErr)
      }
    }

    if (!groupId) {
      console.error('Could not resolve group ID from response:', JSON.stringify(groupData).substring(0, 300))
    }

    // Wait for WhatsApp to fully process the group creation
    await new Promise(resolve => setTimeout(resolve, 3000))

    // If group was created empty, add participants one by one
    if (groupId && createdWithoutParticipants && validParticipants.length > 0) {
      const groupJid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`
      for (const p of validParticipants) {
        try {
          const addRes = await postUazApiWithRetry(
            baseUrl,
            creatorInstance.instance_token,
            '/group/updateParticipants',
            { groupjid: groupJid, action: 'add', participants: [p] },
          )

          if (!addRes.ok) {
            console.warn(`Failed to add ${p} to group:`, await addRes.text())
          }
        } catch (e) {
          console.warn(`Error adding ${p} to group:`, e)
        }
        await sleep(600)
      }
    }

    // Promote ALL board instances as admins (except lead contact)
    if (groupId) {
      // Collect all phones to promote (all instances except creator who is already admin)
      const phonesToPromote: string[] = []
      const normalizedLeadContact = (contact_phone || phone || '').replace(/\D/g, '')

      for (const inst of boardInstances) {
        if (inst.id === creatorInstance.id) continue
        if (!inst.owner_phone) continue
        const instPhone = inst.owner_phone.replace(/\D/g, '')
        if (instPhone && instPhone !== normalizedLeadContact && !phonesToPromote.includes(instPhone)) {
          phonesToPromote.push(instPhone)
        }
      }

      if (phonesToPromote.length > 0) {
        const groupJid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`
        try {
          console.log(`Promoting ${phonesToPromote.length} participants as admin:`, phonesToPromote)

          for (const participant of phonesToPromote) {
            const promoteRes = await postUazApiWithRetry(
              baseUrl,
              creatorInstance.instance_token,
              '/group/updateParticipants',
              { groupjid: groupJid, action: 'promote', participants: [participant] },
            )

            if (!promoteRes.ok) {
              console.warn(`Failed to promote ${participant} as admin:`, await promoteRes.text())
            }

            await sleep(400)
          }
        } catch (e) {
          console.error('Error promoting instances as admin:', e)
        }
      }
    }

    // Send initial message if configured
    if (groupId && settings) {
      console.log('Sending initial message... use_ai_message:', settings.use_ai_message, 'template:', !!settings.initial_message_template)
      await sendInitialMessage(supabase, settings, leadData, lead_name, groupName, groupId, baseUrl, creatorInstance, board_id, boardInstances)
    } else {
      console.log('Skipping initial message. groupId:', groupId, 'settings:', !!settings)
    }

    // Forward documents if configured + conversation media
    // Use shared sentUrls set to avoid duplicate sends
    const sentUrls = new Set<string>()

    if (groupId && settings?.forward_document_types?.length > 0 && leadData) {
      console.log('Forwarding documents. Types:', settings.forward_document_types)
      await forwardDocuments(supabase, settings, leadData, groupId, baseUrl, creatorInstance, sentUrls)
    } else {
      console.log('Skipping document forwarding. groupId:', groupId, 'docTypes:', settings?.forward_document_types, 'hasLead:', !!leadData)
    }

    // Always forward conversation media (inbound images/documents) + signed ZapSign docs to the group
    if (groupId && leadData) {
      await forwardConversationMedia(supabase, leadData, normalizedPhone || (contact_phone || phone || '').replace(/\D/g, ''), groupId, baseUrl, creatorInstance, sentUrls)
    }

    // Auto-create legal process if configured
    if (groupId && leadData?.id && settings?.auto_create_process) {
      try {
        console.log(`[create-group] Auto-creating process for lead ${leadData.id}`)
        
        // Generate case number
        const nucleusId = settings.process_nucleus_id || null
        const { data: caseNumber } = await supabase.rpc('generate_case_number', { p_nucleus_id: nucleusId })
        
        if (caseNumber) {
          const caseTitle = `${leadData.lead_name || lead_name} - ${leadData.case_type || 'Processo'}`
          
          const { data: newCase, error: caseError } = await supabase
            .from('legal_cases')
            .insert({
              case_number: caseNumber,
              title: caseTitle,
              lead_id: leadData.id,
              nucleus_id: nucleusId,
              workflow_board_id: settings.process_workflow_board_id || null,
              status: 'em_andamento',
              description: `Processo criado automaticamente ao criar grupo WhatsApp "${groupName}"`,
              action_source: 'system',
              action_source_detail: 'Criação automática via grupo WhatsApp',
            })
            .select('id')
            .single()
          
          if (caseError) {
            console.error('[create-group] Error creating case:', caseError)
          } else if (newCase) {
            console.log(`[create-group] Created case ${caseNumber} (${newCase.id})`)
            
            // Create auto activities
            const activities = settings.process_auto_activities || []
            for (const act of activities) {
              if (!act.title) continue
              
              // Resolve assigned_to name
              let assignedName = null
              if (act.assigned_to) {
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('full_name')
                  .eq('user_id', act.assigned_to)
                  .maybeSingle()
                assignedName = profile?.full_name || null
              }
              
              // Calculate deadline
              const deadlineDays = act.deadline_days || 1
              const deadline = new Date()
              deadline.setDate(deadline.getDate() + deadlineDays)
              
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
              
              console.log(`[create-group] Created activity: ${act.title} -> ${assignedName || 'unassigned'}`)
            }
          }
        }
      } catch (processErr) {
        console.error('[create-group] Error in auto-create process:', processErr)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      group_id: groupId,
      group_name: groupName,
      participants_count: participants.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Create group error:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      // Check if there's a saved AI-generated message model
      if (settings.ai_generated_message) {
        console.log('Using saved AI message model with real data substitution')
        // Use the saved model and ask AI to fill in real data
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
            max_tokens: 4096,
          })
          messageText = aiResult?.choices?.[0]?.message?.content || ''
          console.log('AI message substitution result length:', messageText.length)
        } catch (aiErr) {
          console.error('AI message substitution error:', aiErr)
        }
      } else {
        // Fallback: generate from scratch (legacy behavior)
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
            max_tokens: 2048,
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
      // Use template with variable substitution
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
      
      // Remove incomplete/dangling lines (e.g., "* *Meses" without content)
      messageText = messageText
        .split('\n')
        .filter(line => {
          const trimmed = line.trim()
          // Remove lines that are just bullets with no real content
          if (/^\*?\s*\*[^*]*$/.test(trimmed) && trimmed.length < 15 && !trimmed.includes(':')) return false
          // Remove lines that look like incomplete field labels
          if (/^\*\s*\*\w+$/.test(trimmed)) return false
          return true
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      // Split long messages (WhatsApp limit ~4096 chars)
      const messageParts: string[] = []
      if (messageText.length > 3800) {
        // Split on double newlines
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

      // Send activity links separately (so they're clickable but not in audio)
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

      // Generate and send audio if configured - get voice from member profile (instance owner)
      let audioVoiceId = settings.audio_voice_id
      if (creatorInstance.owner_phone) {
        const ownerPhone = creatorInstance.owner_phone.replace(/\D/g, '')
        // Try multiple phone format matches
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
    }
  } catch (err) {
    console.error('Error sending initial message:', err)
  }
}

async function sendAudioMessage(
  supabase: any, text: string, voiceId: string, groupId: string,
  baseUrl: string, creatorInstance: any
) {
  try {
    // Remove links/URLs from text for audio
    const audioText = text
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/🔗[^\n]*/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (!audioText) return

    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY')
    if (!ELEVENLABS_API_KEY) {
      console.log('ElevenLabs API key not configured, skipping audio')
      return
    }

    // Generate TTS
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: audioText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    )

    if (!ttsRes.ok) {
      console.error('TTS error:', ttsRes.status)
      return
    }

    const audioBuffer = await ttsRes.arrayBuffer()
    const audioBytes = new Uint8Array(audioBuffer)

    // Upload to storage
    const fileName = `group-audio/${Date.now()}.mp3`
    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(fileName, audioBytes, { contentType: 'audio/mpeg' })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return
    }

    const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(fileName)
    const audioUrl = urlData?.publicUrl

    if (!audioUrl) return

    // Send audio to group
    await fetch(`${baseUrl}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
      body: JSON.stringify({
        phone: groupId,
        media: audioUrl,
        type: 'audio',
        ptt: true,
      }),
    })
    console.log('Audio message sent to group')
  } catch (err) {
    console.error('Error sending audio message:', err)
  }
}

async function forwardDocuments(
  supabase: any, settings: any, leadData: any, groupId: string,
  baseUrl: string, creatorInstance: any
) {
  try {
    const docTypes = settings.forward_document_types || []
    const leadName = leadData.lead_name || leadData.victim_name || 'Lead'

    // Get collected documents from whatsapp collection sessions
    const { data: sessions } = await supabase
      .from('whatsapp_collection_sessions')
      .select('id, collected_data')
      .eq('lead_id', leadData.id)
      .order('created_at', { ascending: false })
      .limit(5)

    // Get ZapSign signed documents
    let signedDocs: any[] = []
    if (docTypes.includes('zapsign_signed') || docTypes.includes('procuracao')) {
      const { data } = await supabase
        .from('zapsign_documents')
        .select('*')
        .eq('lead_id', leadData.id)
        .not('signed_file_url', 'is', null)
      signedDocs = data || []
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
      if (!doc.signed_file_url) continue
      const docLabel = doc.template_name || docLabels['zapsign_signed']
      const fileName = `${docLabel} - ${leadName}.pdf`
      try {
        await fetch(`${baseUrl}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify({ number: groupId, media: doc.signed_file_url, type: 'document', fileName, caption: `📄 ${docLabel} - ${leadName}` }),
        })
        console.log(`Sent signed doc: ${fileName}`)
        await sleep(800)
      } catch (e) {
        console.error(`Error sending signed doc:`, e)
      }
    }

    // Send collected documents from sessions
    if (sessions) {
      for (const session of sessions) {
        const collected = session.collected_data || {}
        for (const docType of docTypes) {
          if (docType === 'zapsign_signed') continue
          const docKey = docType + '_url'
          const docUrl = collected[docKey] || collected[docType]
          if (docUrl && typeof docUrl === 'string' && (docUrl.startsWith('http') || docUrl.startsWith('/'))) {
            const label = docLabels[docType] || docType
            const fileName = `${label} - ${leadName}.pdf`
            try {
              await fetch(`${baseUrl}/send/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
                body: JSON.stringify({ number: groupId, media: docUrl, type: 'document', fileName, caption: `📄 ${label} - ${leadName}` }),
              })
              console.log(`Sent doc: ${fileName}`)
              await sleep(800)
            } catch (e) {
              console.error(`Error sending doc ${docType}:`, e)
            }
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

      if (leadDocs) {
        for (const doc of leadDocs) {
          const docType = (doc.document_type || '').toLowerCase()
          if (docTypes.some((dt: string) => docType.includes(dt) || dt === 'outros')) {
            const label = doc.document_name || docLabels[docType] || 'Documento'
            const fileName = `${label} - ${leadName}.pdf`
            try {
              await fetch(`${baseUrl}/send/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
                body: JSON.stringify({ number: groupId, media: doc.file_url, type: 'document', fileName, caption: `📄 ${label} - ${leadName}` }),
              })
              console.log(`Sent lead doc: ${fileName}`)
              await sleep(800)
            } catch (e) {
              console.error(`Error sending lead doc:`, e)
            }
          }
        }
      }
    } catch (e) {
      console.log('lead_documents table not available')
    }
  } catch (err) {
    console.error('Error forwarding documents:', err)
  }
}

async function forwardConversationMedia(
  supabase: any, leadData: any, phone: string, groupId: string,
  baseUrl: string, creatorInstance: any
) {
  try {
    const leadName = leadData.lead_name || leadData.victim_name || 'Lead'
    const sentUrls = new Set<string>()

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
            body: JSON.stringify({ number: groupId, media: doc.signed_file_url, type: 'document', fileName, caption: `📄 ${docLabel} - ${leadName}` }),
          })
          console.log(`[conv-media] Sent signed doc: ${fileName}`)
          await sleep(800)
        } catch (e) {
          console.error(`[conv-media] Error sending signed doc:`, e)
        }
      }
    }

    // 2. Forward inbound media from WhatsApp conversation (images, documents, PDFs)
    if (!phone) {
      console.log('[conv-media] No phone to search conversation media')
      return
    }

    const phoneSuffix = phone.slice(-8)
    const { data: mediaMessages } = await supabase
      .from('whatsapp_messages')
      .select('media_url, message_type, message_text, contact_name')
      .or(`phone.eq.${phone},phone.ilike.%${phoneSuffix}%`)
      .eq('direction', 'inbound')
      .in('message_type', ['image', 'document', 'video', 'sticker'])
      .not('media_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50)

    if (!mediaMessages || mediaMessages.length === 0) {
      console.log('[conv-media] No inbound media found in conversation')
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
      
      // Determine file extension based on type
      const ext = isDoc ? 'pdf' : (msg.message_type === 'video' ? 'mp4' : 'jpg')
      const fileName = isDoc ? `Documento_${mediaCount + 1}_${leadName}.${ext}` : undefined

      try {
        const payload: any = { number: groupId, media: msg.media_url, type: mediaType }
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
  }
}
