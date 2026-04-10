import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from '../_shared/gemini.ts'

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_INBOUND_THRESHOLD = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { phone, instance_name, lead_id, contact_id, group_jid, force } = await req.json()

    const isGroupEnrich = !!group_jid && !!lead_id

    if (!isGroupEnrich && (!phone || !instance_name)) {
      return new Response(JSON.stringify({ error: 'phone and instance_name required (or group_jid + lead_id)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[auto-enrich] phone=${phone} instance=${instance_name} lead=${lead_id} contact=${contact_id} group_jid=${group_jid} force=${force}`)

    let messages: any[] | null = null

    if (isGroupEnrich) {
      // Fetch messages from the group conversation
      const { data: groupMsgs } = await supabase
        .from('whatsapp_messages')
        .select('direction, message_text, created_at, phone')
        .eq('phone', group_jid)
        .order('created_at', { ascending: true })
        .limit(200)

      if (!groupMsgs || groupMsgs.length === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no_messages' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      messages = groupMsgs
    } else {
      // Original flow: private conversation enrichment
      // Read configurable threshold from system_settings
      let INBOUND_THRESHOLD = DEFAULT_INBOUND_THRESHOLD
      const { data: thresholdSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'enrich_message_threshold')
        .single()
      
      if (thresholdSetting?.value) {
        INBOUND_THRESHOLD = parseInt(thresholdSetting.value, 10) || DEFAULT_INBOUND_THRESHOLD
      }

      const phoneSuffix = phone.replace(/\D/g, '').slice(-8)

      if (!force) {
        // Check if we already enriched recently (within 2 hours)
        const { data: recentEnrich } = await supabase
          .from('lead_enrichment_log')
          .select('id')
          .ilike('phone', `%${phoneSuffix}`)
          .eq('instance_name', instance_name)
          .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
          .limit(1)

        if (recentEnrich && recentEnrich.length > 0) {
          console.log('[auto-enrich] Already enriched recently, skipping')
          return new Response(JSON.stringify({ ok: true, skipped: 'recent_enrich' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        // Count inbound messages from this contact
        const { count } = await supabase
          .from('whatsapp_messages')
          .select('id', { count: 'exact', head: true })
          .eq('instance_name', instance_name)
          .ilike('phone', `%${phoneSuffix}`)
          .eq('direction', 'inbound')

        if (!count || count < INBOUND_THRESHOLD) {
          console.log(`[auto-enrich] Only ${count} inbound messages, need ${INBOUND_THRESHOLD}`)
          return new Response(JSON.stringify({ ok: true, skipped: 'not_enough_messages', count }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      // Fetch conversation messages
      const { data: privateMsgs } = await supabase
        .from('whatsapp_messages')
        .select('direction, message_text, created_at')
        .eq('instance_name', instance_name)
        .ilike('phone', `%${phoneSuffix}`)
        .order('created_at', { ascending: true })
        .limit(100)

      if (!privateMsgs || privateMsgs.length === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no_messages' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      messages = privateMsgs
    }

    // Build conversation text
    const conversationText = messages
      .map((m: any) => {
        const dir = m.direction === 'outbound' ? 'Atendente' : 'Cliente'
        return `[${dir}]: ${m.message_text || ''}`
      })
      .join('\n')

    // Extract data using AI
    const groupEnrichFields = isGroupEnrich ? `
  "case_notes": "observações e atualizações relevantes sobre o caso jurídico mencionadas na conversa do grupo",
  "case_outcome": "resultado/desfecho do caso se mencionado (deferido, indeferido, acordo, etc)",
  "process_notes": "informações sobre andamento processual, audiências, perícias, prazos mencionados",
  "process_number": "número de processo judicial mencionado (CNJ)",
  "next_steps": "próximos passos ou pendências mencionadas na conversa",
  "documents_mentioned": "documentos mencionados ou solicitados na conversa",` : ''

    const groupEnrichRules = isGroupEnrich ? `
- Esta é uma conversa de GRUPO de trabalho. Extraia informações sobre o caso, processo e cliente mencionados.
- case_notes, process_notes e next_steps devem conter resumos úteis das discussões do grupo.
- Não confunda mensagens de diferentes participantes do grupo.` : ''

    const systemPrompt = `Você é um assistente especializado em extrair informações de conversas de WhatsApp.

Analise a conversa e extraia TODAS as informações pessoais e profissionais do CLIENTE. Retorne APENAS um JSON válido:

{
  "full_name": "nome completo",
  "phone": "outro telefone mencionado",
  "email": "e-mail",
  "city": "cidade",
  "state": "sigla do estado (SP, RJ, MG...)",
  "neighborhood": "bairro",
  "street": "logradouro/endereço",
  "cep": "CEP",
  "profession": "profissão/cargo",
  "notes": "resumo útil da conversa",
  "instagram_url": "perfil instagram",
  "victim_name": "nome da vítima (se caso jurídico)",
  "main_company": "empresa principal",
  "contractor_company": "empresa terceirizada",
  "damage_description": "descrição do dano/lesão",
  "accident_date": "data do acidente (YYYY-MM-DD)",
  "accident_address": "endereço do acidente",
  "sector": "setor de atuação",
  "case_type": "tipo do caso",
  "liability_type": "tipo de responsabilidade",
  "visit_city": "cidade da visita/residência da família",
  "visit_state": "estado da visita/residência (sigla UF)",
  "visit_region": "região da visita (ex: norte, sul, centro-oeste, sudeste, nordeste)",
  "visit_address": "endereço completo para visita",${groupEnrichFields}
  "lead_status": "status do lead baseado na conversa: use null na maioria dos casos. Só preencha com 'closed' se houve assinatura/contrato EXPLÍCITO, 'refused' APENAS se o cliente disse CLARAMENTE que NÃO quer prosseguir (ex: 'não quero', 'desisto', 'não tenho interesse'), 'unviable' se: (1) o atendente determinou que o caso é inviável, OU (2) o cliente claramente NÃO é o público-alvo (ex: confundiu com outra pessoa, ligação engano, homem em campanha de maternidade, pessoa sem nenhuma relação com o serviço oferecido), OU (3) o cliente demonstra total desinteresse/irrelevância com o assunto. Em caso de QUALQUER dúvida, use null. Conversas em andamento, triagem, identificação = null (NÃO é refused).",
  "lead_status_reason": "motivo resumido em 1-2 frases para o status identificado. OBRIGATÓRIO se lead_status não for null. Use null se status for null.",
  "referrals": [
    {
      "name": "nome da pessoa indicada",
      "phone": "telefone da indicação",
      "product_type": "auxilio_maternidade | auxilio_acidente | bpc_loas_autista | indenizacao_acidente_trabalho",
      "context": "contexto breve (ex: gestante de 7 meses, filho autista de 3 anos, acidentou há 2 anos)"
    }
  ]
}

REGRAS:
- Extraia APENAS informações explícitas na conversa
- Use null para campos não encontrados
- IMPORTANTE: lead_status deve ser null na grande maioria dos casos. Só marque como 'refused' se o cliente EXPLICITAMENTE recusou. Marque como 'unviable' se a pessoa claramente não tem relação com o serviço (engano, confusão, perfil incompatível). Conversas sem resposta, em triagem, ou em fase inicial NÃO são 'refused' nem 'unviable'. Na dúvida, use null.
- lead_status_reason é OBRIGATÓRIO quando lead_status não for null
- INDICAÇÕES: Se o cliente mencionou alguém que pode ter direito a algum benefício (gestante, mãe de autista, acidentado nos últimos 5 anos com carteira assinada), extraia na lista "referrals". Use [] se não houver indicações.
- product_type DEVE ser um dos valores: auxilio_maternidade, auxilio_acidente, bpc_loas_autista, indenizacao_acidente_trabalho${groupEnrichRules}
- Retorne APENAS o JSON`

    const result = await geminiChat({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: conversationText },
      ],
      temperature: 0.1,
    })

    const content = result.choices?.[0]?.message?.content || '{}'
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    let extracted: Record<string, any>
    try {
      extracted = JSON.parse(jsonStr)
    } catch {
      console.error('[auto-enrich] Failed to parse AI response')
      return new Response(JSON.stringify({ ok: false, error: 'parse_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Clean nulls
    const cleaned: Record<string, any> = {}
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = value
      }
    }

    console.log('[auto-enrich] Extracted:', JSON.stringify(cleaned).substring(0, 500))

    // Update lead if we have one
    if (lead_id) {
      const leadUpdate: Record<string, any> = {}
      const leadFields: Record<string, string> = {
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
        case_type: 'case_type',
        sector: 'sector',
        liability_type: 'liability_type',
        visit_city: 'visit_city',
        visit_state: 'visit_state',
        visit_region: 'visit_region',
        visit_address: 'visit_address',
        notes: 'notes',
      }

      // Map email
      if (cleaned.email) leadUpdate.lead_email = cleaned.email

      for (const [extractKey, dbKey] of Object.entries(leadFields)) {
        if (cleaned[extractKey]) {
          leadUpdate[dbKey] = cleaned[extractKey]
        }
      }

      // Update lead name if we got a better name
      if (cleaned.full_name || cleaned.victim_name) {
        const { data: currentLead } = await supabase
          .from('leads')
          .select('lead_name')
          .eq('id', lead_id)
          .single()

        // Only update name if current name looks like a phone number
        if (currentLead?.lead_name && /^\d+$/.test(currentLead.lead_name.replace(/\D/g, ''))) {
          leadUpdate.lead_name = cleaned.full_name || cleaned.victim_name
        }
      }

      if (Object.keys(leadUpdate).length > 0) {
        const { error } = await supabase
          .from('leads')
          .update(leadUpdate)
          .eq('id', lead_id)
        
        if (error) console.error('[auto-enrich] Lead update error:', error)
        else console.log(`[auto-enrich] Lead ${lead_id} updated with ${Object.keys(leadUpdate).length} fields`)
      }

      // Auto-update lead status if AI detected a terminal state
      // IMPORTANT: Only proceed if reason is provided (prevents false positives)
      if (cleaned.lead_status && ['closed', 'refused', 'unviable'].includes(cleaned.lead_status) && cleaned.lead_status_reason) {
        const { data: currentLead, error: leadCheckErr } = await supabase
          .from('leads')
          .select('lead_status')
          .eq('id', lead_id)
          .single()

        if (leadCheckErr) {
          console.error('[auto-enrich] Lead status check error:', leadCheckErr)
        }

        const currentStatus = currentLead?.lead_status || 'active'
        console.log(`[auto-enrich] Lead ${lead_id} current status: ${currentStatus}, AI detected: ${cleaned.lead_status}`)

        // Only update if currently active
        if (currentStatus === 'active') {
          const statusMap: Record<string, string> = {
            'closed': 'became_client_date',
            'refused': 'classification_date',
            'unviable': 'inviavel_date',
          }
          const dateField = statusMap[cleaned.lead_status]
          const today = new Date().toISOString().slice(0, 10)
          const statusUpdate: Record<string, any> = {
            lead_status: cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status,
            lead_status_reason: cleaned.lead_status_reason || null,
            lead_status_changed_at: new Date().toISOString(),
            [dateField]: today,
          }

          const { error: statusError } = await supabase
            .from('leads')
            .update(statusUpdate)
            .eq('id', lead_id)

          if (statusError) {
            console.error('[auto-enrich] Status update error:', statusError)
          } else {
            console.log(`[auto-enrich] Lead ${lead_id} status changed to ${cleaned.lead_status}: ${cleaned.lead_status_reason}`)
            
            // Swap or deactivate AI agent for terminal statuses
            if (['unviable', 'refused', 'closed'].includes(cleaned.lead_status)) {
              const finalStatus = cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status
              // Check if campaign has a specific agent for this status
              const { data: leadCampaign } = await supabase.from('leads').select('campaign_id').eq('id', lead_id).maybeSingle()
              let swapAgentId: string | null = null
              if (leadCampaign?.campaign_id) {
                const { data: campLink } = await supabase
                  .from('whatsapp_agent_campaign_links')
                  .select('closed_agent_id, refused_agent_id, inviavel_agent_id')
                  .eq('campaign_id', leadCampaign.campaign_id)
                  .eq('is_active', true)
                  .maybeSingle()
                if (campLink) {
                  const agentMap: Record<string, string | null> = {
                    closed: campLink.closed_agent_id,
                    refused: campLink.refused_agent_id,
                    inviavel: campLink.inviavel_agent_id,
                  }
                  swapAgentId = agentMap[finalStatus] || null
                }
              }
              
              if (swapAgentId) {
                const { error: swapErr } = await supabase
                  .from('whatsapp_conversation_agents')
                  .update({ agent_id: swapAgentId, is_active: true, activated_by: 'status_auto' })
                  .eq('phone', phone)
                  .eq('instance_name', instance_name)
                if (swapErr) console.error('[auto-enrich] Agent swap error:', swapErr)
                else console.log(`[auto-enrich] Agent swapped to ${swapAgentId} for status ${finalStatus}`)
              } else {
                // No specific agent configured, deactivate
                const { error: deactErr } = await supabase
                  .from('whatsapp_conversation_agents')
                  .update({ is_active: false })
                  .eq('phone', phone)
                  .eq('instance_name', instance_name)
                if (deactErr) console.error('[auto-enrich] Agent deactivation error:', deactErr)
                else console.log(`[auto-enrich] Agent deactivated for ${phone}/${instance_name} (no ${finalStatus} agent configured)`)
              }

              // Cancel all pending followups for terminal statuses
              const { error: followupCancelErr } = await supabase
                .from('whatsapp_agent_followups')
                .update({ status: 'cancelled' })
                .eq('phone', phone)
                .eq('instance_name', instance_name)
                .eq('status', 'pending')
              if (followupCancelErr) console.error('[auto-enrich] Followup cancel error:', followupCancelErr)
              else console.log(`[auto-enrich] Cancelled pending followups for ${phone} (status: ${finalStatus})`)
            }
            
            // Log status history
            await supabase.from('lead_status_history').insert({
              lead_id,
              from_status: 'active',
              to_status: cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status,
              reason: cleaned.lead_status_reason || 'Detectado automaticamente pela IA',
              changed_by: null,
              changed_by_type: 'ai',
            })

            // Send conversion event to Meta CAPI for CTWA leads
            try {
              const { data: leadForCapi } = await supabase
                .from('leads')
                .select('lead_name, lead_phone, ctwa_context, campaign_id, contract_value')
                .eq('id', lead_id)
                .single()

              // Only send CAPI events for CTWA leads with ctwa_clid (official Business Messaging API)
              const ctwaClid = (leadForCapi?.ctwa_context as any)?.ctwa_clid
              if (leadForCapi && ctwaClid) {
                const finalStatus = cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status
                const eventMap: Record<string, { event_name: string; content_category: string }> = {
                  closed: { event_name: 'Purchase', content_category: 'lead_converted' },
                  refused: { event_name: 'Lead', content_category: 'lead_refused' },
                  inviavel: { event_name: 'Lead', content_category: 'lead_unqualified' },
                }
                const mapping = eventMap[finalStatus]
                if (mapping) {
                  // Get WABA ID from meta_ad_accounts
                  const { data: adAccounts } = await supabase
                    .from('meta_ad_accounts')
                    .select('*')
                    .limit(1)
                  const wabaId = (adAccounts as any)?.[0]?.waba_id

                  if (wabaId) {
                    const capiEvent = {
                      event_name: mapping.event_name,
                      event_time: Math.floor(Date.now() / 1000),
                      action_source: 'business_messaging',
                      messaging_channel: 'whatsapp',
                      user_data: {
                        whatsapp_business_account_id: wabaId,
                        ctwa_clid: ctwaClid,
                      },
                      custom_data: {
                        content_category: mapping.content_category,
                        lead_id,
                        status: finalStatus,
                        ...(finalStatus === 'closed' && leadForCapi.contract_value && {
                          value: leadForCapi.contract_value,
                          currency: 'BRL',
                        }),
                      },
                    }
                    const capiUrl = `${RESOLVED_SUPABASE_URL}/functions/v1/facebook-capi`
                    await fetch(capiUrl, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${RESOLVED_ANON_KEY}`,
                      },
                      body: JSON.stringify({ events: [capiEvent], mode: 'business_messaging' }),
                    })
                    console.log(`[auto-enrich] Sent Meta CAPI BM event: ${mapping.event_name} (${mapping.content_category})`)
                  } else {
                    console.log('[auto-enrich] No WABA ID configured, skipping CAPI event')
                  }
                }
              }
            } catch (capiErr) {
              console.error('[auto-enrich] Meta CAPI error (non-blocking):', capiErr)
            }
          }
        }
      }
    }

    // Update contact if we have one
    if (contact_id) {
      const contactUpdate: Record<string, any> = {}
      const contactFields: Record<string, string> = {
        full_name: 'full_name',
        email: 'email',
        city: 'city',
        state: 'state',
        neighborhood: 'neighborhood',
        street: 'street',
        cep: 'cep',
        profession: 'profession',
        instagram_url: 'instagram_url',
        notes: 'notes',
      }

      for (const [extractKey, dbKey] of Object.entries(contactFields)) {
        if (cleaned[extractKey]) {
          contactUpdate[dbKey] = cleaned[extractKey]
        }
      }

      // Only update name if current looks like phone
      if (cleaned.full_name) {
        const { data: currentContact } = await supabase
          .from('contacts')
          .select('full_name')
          .eq('id', contact_id)
          .single()

        if (currentContact?.full_name && /^\d+$/.test(currentContact.full_name.replace(/\D/g, ''))) {
          contactUpdate.full_name = cleaned.full_name
        }
      }

      if (Object.keys(contactUpdate).length > 0) {
        const { error } = await supabase
          .from('contacts')
          .update(contactUpdate)
          .eq('id', contact_id)

        if (error) console.error('[auto-enrich] Contact update error:', error)
        else console.log(`[auto-enrich] Contact ${contact_id} updated with ${Object.keys(contactUpdate).length} fields`)
      }
    }

    // Enrich case and process if group enrichment
    if (isGroupEnrich && lead_id) {
      try {
        // Find cases linked to this lead
        const { data: cases } = await supabase
          .from('legal_cases')
          .select('id, notes, description')
          .eq('lead_id', lead_id)
          .limit(5)

        if (cases && cases.length > 0) {
          for (const legalCase of cases) {
            const caseUpdate: Record<string, any> = {}
            
            if (cleaned.case_notes) {
              const existingNotes = legalCase.notes || ''
              const newNote = `[IA ${new Date().toLocaleDateString('pt-BR')}] ${cleaned.case_notes}`
              caseUpdate.notes = existingNotes ? `${existingNotes}\n\n${newNote}` : newNote
            }
            if (cleaned.case_outcome) {
              caseUpdate.outcome = cleaned.case_outcome
            }
            if (cleaned.damage_description && !legalCase.description) {
              caseUpdate.description = cleaned.damage_description
            }

            if (Object.keys(caseUpdate).length > 0) {
              const { error } = await supabase
                .from('legal_cases')
                .update(caseUpdate)
                .eq('id', legalCase.id)
              if (error) console.error('[auto-enrich] Case update error:', error)
              else console.log(`[auto-enrich] Case ${legalCase.id} updated with ${Object.keys(caseUpdate).length} fields`)
            }

            // Find processes linked to this case
            const { data: tracking } = await supabase
              .from('case_process_tracking')
              .select('id, observacao')
              .eq('case_id', legalCase.id)
              .limit(10)

            if (tracking && tracking.length > 0) {
              const processNotes = cleaned.process_notes || cleaned.next_steps
              if (processNotes) {
                for (const proc of tracking) {
                  const existingObs = proc.observacao || ''
                  const newObs = `[IA ${new Date().toLocaleDateString('pt-BR')}] ${processNotes}`
                  await supabase
                    .from('case_process_tracking')
                    .update({ observacao: existingObs ? `${existingObs}\n\n${newObs}` : newObs })
                    .eq('id', proc.id)
                }
                console.log(`[auto-enrich] Updated ${tracking.length} process(es) with notes`)
              }
            }
          }
        }
      } catch (caseErr: any) {
        console.error('[auto-enrich] Case/process enrichment error:', caseErr)
      }
    }


    await supabase.from('lead_enrichment_log').insert({
      phone: phone || group_jid || 'group_enrich',
      instance_name: instance_name || 'group',
      lead_id: lead_id || null,
      contact_id: contact_id || null,
      fields_updated: cleaned,
    })

    console.log(`[auto-enrich] Enrichment complete for ${isGroupEnrich ? 'group=' + group_jid : 'phone=' + phone}`)

    // Process referrals if any
    const referrals = Array.isArray(cleaned.referrals) ? cleaned.referrals : []
    const productBoardMap: Record<string, string> = {
      'auxilio_maternidade': '48d6581d-b138-45f9-bb63-84d90ba86ec2',
      'auxilio_acidente': 'b922f490-3600-4652-a629-5d63110501ca',
      'bpc_loas_autista': 'c8e8c466-c441-43a9-88d2-8197324c47a4',
      'indenizacao_acidente_trabalho': '2dcd54b5-502b-413b-b795-5e24a20797d2',
    }
    const productIdMap: Record<string, string> = {
      'auxilio_maternidade': 'a1000001-0000-0000-0000-000000000001',
      'auxilio_acidente': 'a1000002-0000-0000-0000-000000000002',
      'bpc_loas_autista': 'a1000003-0000-0000-0000-000000000003',
      'indenizacao_acidente_trabalho': 'a1000004-0000-0000-0000-000000000004',
    }

    const createdReferrals: any[] = []
    for (const ref of referrals) {
      if (!ref.name || !ref.phone) continue
      const targetBoardId = productBoardMap[ref.product_type] || 'ccd46376-5a8c-42ea-a0f4-3360ed2b1e7a' // fallback: Leads Inbound
      const targetProductId = productIdMap[ref.product_type] || null

      // Get first stage of target board
      const { data: stages } = await supabase
        .from('kanban_stages')
        .select('id')
        .eq('board_id', targetBoardId)
        .order('position', { ascending: true })
        .limit(1)

      const firstStageId = stages?.[0]?.id || null

      // Create new lead from referral
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          lead_name: ref.name,
          lead_phone: ref.phone,
          board_id: targetBoardId,
          status: firstStageId,
          product_service_id: targetProductId,
          lead_source: 'indicacao',
          notes: `Indicado por ${cleaned.full_name || phone}. ${ref.context || ''}`,
          lead_status: 'active',
        })
        .select('id')
        .single()

      if (leadErr) {
        console.error('[auto-enrich] Referral lead creation error:', leadErr)
        continue
      }

      console.log(`[auto-enrich] Created referral lead ${newLead.id} for ${ref.name} → ${ref.product_type}`)

      // Register as ambassador referral if we have a contact_id
      if (contact_id && newLead) {
        await supabase.from('ambassador_referrals').insert({
          ambassador_id: contact_id,
          lead_id: newLead.id,
          member_user_id: '00000000-0000-0000-0000-000000000000', // system
          status: 'pending',
          notes: ref.context || `Indicação via WhatsApp - ${ref.product_type}`,
        })
      }

      createdReferrals.push({ lead_id: newLead.id, name: ref.name, product: ref.product_type })
    }

    if (createdReferrals.length > 0) {
      console.log(`[auto-enrich] Created ${createdReferrals.length} referral leads`)
    }

    return new Response(JSON.stringify({ ok: true, enriched: cleaned, referrals_created: createdReferrals }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[auto-enrich] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
