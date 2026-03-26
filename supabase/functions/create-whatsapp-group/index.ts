import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

    if (settings) {
      // Increment sequence
      const nextSeq = Math.max(
        (settings.current_sequence || 0) + 1,
        settings.sequence_start || 1
      )

      await supabase
        .from('board_group_settings')
        .update({ current_sequence: nextSeq, updated_at: new Date().toISOString() })
        .eq('board_id', board_id)

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

    // Build participant list
    const participants: string[] = []
    const normalizedContact = (contact_phone || phone || '').replace(/\D/g, '')
    if (normalizedContact) {
      participants.push(normalizedContact)
    }

    // Get configured instances for this board
    let boardInstances: any[] = []
    if (board_id) {
      const { data: bgi } = await supabase
        .from('board_group_instances')
        .select('instance_id')
        .eq('board_id', board_id)

      if (bgi && bgi.length > 0) {
        const instanceIds = bgi.map((b: any) => b.instance_id)
        const { data: instances } = await supabase
          .from('whatsapp_instances')
          .select('id, owner_phone, instance_name')
          .in('id', instanceIds)
          .eq('is_active', true)

        boardInstances = instances || []
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

    console.log(`Creating group "${groupName}" via instance ${creatorInstance.instance_name} with ${participants.length} participants`)

    // Create group via UazAPI
    const createRes = await fetch(`${baseUrl}/group/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
      body: JSON.stringify({
        name: groupName,
        participants: participants,
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error('Group create error:', createRes.status, errText)
      throw new Error(`Erro ao criar grupo: ${createRes.status} - ${errText}`)
    }

    const groupData = await createRes.json()
    console.log('Group created:', JSON.stringify(groupData).substring(0, 500))

    const groupId = groupData?.id || groupData?.jid || groupData?.data?.id || groupData?.gid || null

    // Promote board instances as admins
    for (const inst of boardInstances) {
      if (inst.id === creatorInstance.id) continue
      if (!inst.owner_phone) continue

      const instPhone = inst.owner_phone.replace(/\D/g, '')
      if (!instPhone) continue

      try {
        if (groupId) {
          await fetch(`${baseUrl}/group/promote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
            body: JSON.stringify({ id: groupId, participants: [instPhone] }),
          })
        }
      } catch (e) {
        console.error(`Error promoting instance ${inst.instance_name}:`, e)
      }
    }

    // Send initial message if configured
    if (groupId && settings) {
      await sendInitialMessage(supabase, settings, leadData, lead_name, groupName, groupId, baseUrl, creatorInstance, board_id)
    }

    // Forward documents if configured
    if (groupId && settings?.forward_document_types?.length > 0 && leadData) {
      await forwardDocuments(supabase, settings, leadData, groupId, baseUrl, creatorInstance)
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
  groupName: string, groupId: string, baseUrl: string, creatorInstance: any, boardId: string
) {
  try {
    let messageText = ''

    if (settings.use_ai_message) {
      // Generate message with AI
      const leadInfo = leadData ? Object.entries(leadData)
        .filter(([k, v]) => v && !['id', 'created_at', 'updated_at', 'created_by', 'assigned_to'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n') : `Nome: ${lead_name}`

      // Get board name
      let boardName = ''
      if (boardId) {
        const { data: board } = await supabase.from('kanban_boards').select('name').eq('id', boardId).maybeSingle()
        boardName = board?.name || ''
      }

      const aiPrompt = `Gere uma mensagem de boas-vindas para um grupo de WhatsApp de acompanhamento de caso jurídico.
Dados do lead/caso:
${leadInfo}
Funil: ${boardName}
Nome do grupo: ${groupName}

${settings.initial_message_template ? `Instruções adicionais: ${settings.initial_message_template}` : ''}

Gere uma mensagem profissional e organizada com emojis, destacando os dados principais do caso. Use formatação do WhatsApp (*negrito*, _itálico_). Não inclua IDs ou dados técnicos.`

      try {
        const aiRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/lovable-ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: aiPrompt }],
            max_tokens: 1024,
          }),
        })

        if (aiRes.ok) {
          const aiData = await aiRes.json()
          messageText = aiData?.choices?.[0]?.message?.content || aiData?.content || ''
        }
      } catch (aiErr) {
        console.error('AI message generation error:', aiErr)
      }

      if (!messageText) {
        messageText = `📋 *${groupName}*\n\nGrupo criado para acompanhamento do caso de *${lead_name}*.`
      }
    } else if (settings.initial_message_template) {
      // Use template with variable substitution
      messageText = settings.initial_message_template

      // Get board name for substitution
      let boardName = ''
      if (boardId) {
        const { data: board } = await supabase.from('kanban_boards').select('name').eq('id', boardId).maybeSingle()
        boardName = board?.name || ''
      }

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
      await fetch(`${baseUrl}/message/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
        body: JSON.stringify({ phone: groupId, message: messageText }),
      })
      console.log('Initial message sent to group')
    }
  } catch (err) {
    console.error('Error sending initial message:', err)
  }
}

async function forwardDocuments(
  supabase: any, settings: any, leadData: any, groupId: string,
  baseUrl: string, creatorInstance: any
) {
  try {
    const docTypes = settings.forward_document_types || []
    const leadName = leadData.lead_name || leadData.victim_name || 'Lead'
    const leadPhone = (leadData.lead_phone || '').replace(/\D/g, '')

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

    // Map document type to label for naming
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
        await fetch(`${baseUrl}/message/send-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
          body: JSON.stringify({
            phone: groupId,
            document: doc.signed_file_url,
            fileName: fileName,
            caption: `📄 ${docLabel} - ${leadName}`,
          }),
        })
        console.log(`Sent signed doc: ${fileName}`)
      } catch (e) {
        console.error(`Error sending signed doc:`, e)
      }
    }

    // Send collected documents from sessions
    if (sessions) {
      for (const session of sessions) {
        const collected = session.collected_data || {}

        for (const docType of docTypes) {
          if (docType === 'zapsign_signed') continue // already handled

          // Check collected_data for document URLs
          const docKey = docType + '_url'
          const docUrl = collected[docKey] || collected[docType]
          if (docUrl && typeof docUrl === 'string' && (docUrl.startsWith('http') || docUrl.startsWith('/'))) {
            const label = docLabels[docType] || docType
            const fileName = `${label} - ${leadName}.pdf`

            try {
              await fetch(`${baseUrl}/message/send-document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
                body: JSON.stringify({
                  phone: groupId,
                  document: docUrl,
                  fileName: fileName,
                  caption: `📄 ${label} - ${leadName}`,
                }),
              })
              console.log(`Sent doc: ${fileName}`)
            } catch (e) {
              console.error(`Error sending doc ${docType}:`, e)
            }
          }
        }
      }
    }

    // Also check lead_documents table if it exists
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
              await fetch(`${baseUrl}/message/send-document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
                body: JSON.stringify({
                  phone: groupId,
                  document: doc.file_url,
                  fileName: fileName,
                  caption: `📄 ${label} - ${leadName}`,
                }),
              })
              console.log(`Sent lead doc: ${fileName}`)
            } catch (e) {
              console.error(`Error sending lead doc:`, e)
            }
          }
        }
      }
    } catch (e) {
      // lead_documents table may not exist
      console.log('lead_documents table not available')
    }
  } catch (err) {
    console.error('Error forwarding documents:', err)
  }
}
