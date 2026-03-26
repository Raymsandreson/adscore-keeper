import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchDocWithRetry(docToken: string, zapsignToken: string, retries = 3, delayMs = 3000): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.zapsign.com.br/api/v1/docs/${docToken}/`, {
      headers: {
        'Authorization': `Bearer ${zapsignToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      console.error(`ZapSign API attempt ${attempt} failed: ${res.status}`)
      if (attempt === retries) return null
      await new Promise(r => setTimeout(r, delayMs))
      continue
    }

    const data = await res.json()
    
    // If doc is signed but signed_file not ready yet, retry
    if (data.status === 'signed' && !data.signed_file && attempt < retries) {
      console.log(`Doc signed but signed_file not ready, retrying in ${delayMs}ms (attempt ${attempt}/${retries})`)
      await new Promise(r => setTimeout(r, delayMs))
      continue
    }

    return data
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const zapsignToken = Deno.env.get('ZAPSIGN_API_TOKEN')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    console.log('ZapSign webhook received:', JSON.stringify(body))

    const eventType = body.event_type || body.type
    const docToken = body.doc?.token || body.token || body.doc_token
    const signerToken = body.signer?.token || body.signer_token

    console.log(`Webhook details - event: ${eventType}, docToken: ${docToken}, signerToken: ${signerToken || 'NONE'}`)

    if (!docToken) {
      console.log('No doc token in webhook, ignoring')
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Fetch latest document info from ZapSign API (with retry for signed_file)
    const docData = await fetchDocWithRetry(docToken, zapsignToken)

    if (!docData) {
      console.error('Failed to fetch doc from ZapSign after retries')
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const allSigners = docData.signers || []
    const totalSigners = allSigners.length
    const signedSigners = allSigners.filter((s: any) => s.status === 'signed')
    const signedCount = signedSigners.length
    const signedFileUrl = docData.signed_file || null
    const isDocFullySigned = docData.status === 'signed'

    console.log(`ZapSign doc status: ${docData.status}, signers: ${signedCount}/${totalSigners}, signed_file: ${signedFileUrl || 'NOT AVAILABLE'}`)

    // Find the signer that triggered this webhook
    // Try by token first, then find the most recently signed signer
    let triggeringSigner = signerToken 
      ? allSigners.find((s: any) => s.token === signerToken) 
      : null

    // Fallback: if no signerToken in webhook, pick the last signer who signed
    if (!triggeringSigner && signedSigners.length > 0) {
      triggeringSigner = signedSigners.sort((a: any, b: any) => 
        new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime()
      )[0]
      console.log(`No signerToken in webhook, using most recent signer: ${triggeringSigner?.name}`)
    }

    // Update local database
    const firstSigner = allSigners[0]
    const { data: localDoc } = await supabase
      .from('zapsign_documents')
      .update({
        status: docData.status,
        signed_file_url: signedFileUrl,
        signer_status: firstSigner?.status || null,
        signed_at: firstSigner?.signed_at || (isDocFullySigned ? new Date().toISOString() : null),
      })
      .eq('doc_token', docToken)
      .select('*')
      .single()

    console.log('Updated local doc:', localDoc?.id, 'status:', docData.status, 'whatsapp_phone:', localDoc?.whatsapp_phone || 'NONE')

    if (!localDoc) {
      console.log('No local doc found for token:', docToken)
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ====================================================
    // Fetch the creator's profile for sender identification
    // ====================================================
    let creatorDisplayName: string | null = null
    if (localDoc.created_by) {
      const { data: creatorProfile } = await supabase
        .from('profiles')
        .select('full_name, treatment_title')
        .eq('user_id', localDoc.created_by)
        .single()
      if (creatorProfile?.full_name) {
        const parts = creatorProfile.full_name.split(' ')
        const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0]
        const title = creatorProfile.treatment_title || ''
        creatorDisplayName = title ? `${title} ${shortName}` : shortName
      }
    }

    // Helper: resolve the correct WhatsApp instance (prefer doc's instance_name)
    const resolveInstance = async () => {
      let instance = null
      if (localDoc.instance_name) {
        const { data: namedInst } = await supabase
          .from('whatsapp_instances')
          .select('*')
          .eq('instance_name', localDoc.instance_name)
          .eq('is_active', true)
          .single()
        instance = namedInst
      }
      if (!instance) {
        const { data: fallbackInst } = await supabase
          .from('whatsapp_instances')
          .select('*')
          .eq('is_active', true)
          .limit(1)
          .single()
        instance = fallbackInst
      }
      return instance
    }

    // Helper: prefix message with creator's name for sender identification
    const prefixWithSender = (msg: string) => {
      if (creatorDisplayName) return `*${creatorDisplayName}:*\n${msg}`
      return msg
    }

    // ====================================================
    // NOTIFY on each individual signature (partial or full)
    // ====================================================
    const justSignedSigner = triggeringSigner?.status === 'signed' ? triggeringSigner : null

    if (justSignedSigner && localDoc.whatsapp_phone && localDoc.notify_on_signature !== false) {
      try {
        const instance = await resolveInstance()

        if (instance) {
          const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
          const signerName = justSignedSigner.name || 'Signatário'
          const docName = localDoc.document_name || 'Documento'

          let statusEmoji = '✍️'
          let statusText = `*${signerName}* assinou o documento.`
          let progressText = `📊 Progresso: ${signedCount}/${totalSigners} assinaturas`

          if (isDocFullySigned) {
            statusEmoji = '✅'
            statusText = `*${signerName}* assinou o documento.`
            progressText = `🎉 *Todas as ${totalSigners} assinaturas foram coletadas!*\n\n📎 O PDF assinado será enviado em seguida.`
          }

          const notificationMessage = prefixWithSender(`${statusEmoji} *Assinatura recebida!*\n\n📄 *${docName}*\n${statusText}\n${progressText}`)

          const notifyRes = await fetch(`${baseUrl}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
            body: JSON.stringify({
              number: localDoc.whatsapp_phone,
              text: notificationMessage,
            }),
          })

          console.log(`Notification send result: ${notifyRes.status} ${notifyRes.ok ? 'OK' : await notifyRes.text()}`)

          await supabase.from('whatsapp_messages').insert({
            phone: localDoc.whatsapp_phone,
            message_text: notificationMessage,
            message_type: 'text',
            direction: 'outbound',
            status: 'sent',
            contact_id: localDoc.contact_id || null,
            lead_id: localDoc.lead_id || null,
            instance_name: instance.instance_name,
            instance_token: instance.instance_token,
          })

          console.log(`Notification sent for signer: ${signerName} (${signedCount}/${totalSigners})`)
        } else {
          console.error('No active WhatsApp instance found for notification')
        }
      } catch (notifyErr) {
        console.error('Error sending signer notification:', notifyErr)
      }
    } else {
      console.log(`Notification skipped - justSignedSigner: ${!!justSignedSigner}, phone: ${localDoc.whatsapp_phone || 'NONE'}, notify_on_signature: ${localDoc.notify_on_signature}`)
    }

    // ====================================================
    // Create activity for each signature event
    // ====================================================
    if (justSignedSigner && localDoc.lead_id) {
      try {
        const signerName = justSignedSigner.name || 'Signatário'
        const docName = localDoc.document_name || 'Documento'

        await supabase.from('lead_activities').insert({
          lead_id: localDoc.lead_id,
          lead_name: localDoc.signer_name || 'Documento',
          title: `Assinatura: ${signerName} assinou "${docName}"`,
          description: `${signerName} assinou o documento "${docName}" em ${new Date().toLocaleDateString('pt-BR')}. Progresso: ${signedCount}/${totalSigners} assinaturas.`,
          activity_type: 'documento',
          status: isDocFullySigned ? 'concluida' : 'pendente',
          priority: 'normal',
          created_by: localDoc.created_by || null,
          deadline: new Date().toISOString().slice(0, 10),
          completed_at: isDocFullySigned ? new Date().toISOString() : null,
        })
        console.log('Activity created for signer:', signerName)
      } catch (actErr) {
        console.error('Error creating signer activity:', actErr)
      }
    }

    // ====================================================
    // FULLY SIGNED: Save attachment + send PDF via WhatsApp
    // ====================================================
    if (isDocFullySigned) {
      console.log(`=== FULLY SIGNED BLOCK === signedFileUrl: ${signedFileUrl || 'NONE'}, whatsapp_phone: ${localDoc.whatsapp_phone || 'NONE'}, send_signed_pdf: ${localDoc.send_signed_pdf}`)

      // Save signed document as activity attachment (only if lead exists)
      if (localDoc.lead_id && signedFileUrl) {
        try {
          const { data: activity } = await supabase
            .from('lead_activities')
            .insert({
              lead_id: localDoc.lead_id,
              lead_name: localDoc.signer_name || 'Documento',
              title: `✅ Procuração assinada: ${localDoc.document_name || 'Documento'}`,
              description: `Documento "${localDoc.document_name}" totalmente assinado por ${totalSigners} signatário(s) em ${new Date().toLocaleDateString('pt-BR')}.`,
              activity_type: 'documento',
              status: 'concluida',
              priority: 'normal',
              created_by: localDoc.created_by || null,
              deadline: new Date().toISOString().slice(0, 10),
              completed_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (activity?.id) {
            await supabase.from('activity_attachments').insert({
              activity_id: activity.id,
              file_name: `${localDoc.document_name || 'Documento'}_assinado.pdf`,
              file_type: 'application/pdf',
              file_url: signedFileUrl,
              attachment_type: 'file',
              created_by: localDoc.created_by || null,
            })
            console.log('Signed document saved as activity attachment for lead:', localDoc.lead_id)
          }
        } catch (attachErr) {
          console.error('Error saving signed doc as attachment:', attachErr)
        }
      }

      // Send signed PDF via WhatsApp to client
      if (localDoc.whatsapp_phone && localDoc.send_signed_pdf !== false) {
        if (signedFileUrl) {
          console.log('Sending signed PDF via WhatsApp to:', localDoc.whatsapp_phone, 'URL:', signedFileUrl)

          try {
            const instance = await resolveInstance()

            if (instance) {
              const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
              const docName = localDoc.document_name || 'Documento'

              const pdfCaption = prefixWithSender(`📎 ${docName} - Assinado por todos os signatários`)
              const sendDocUrl = `${baseUrl}/send/media`
              console.log(`Sending PDF to ${sendDocUrl} with file: ${signedFileUrl}`)
              
              const uazResponse = await fetch(sendDocUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
                body: JSON.stringify({
                  number: localDoc.whatsapp_phone,
                  file: signedFileUrl,
                  type: 'document',
                  caption: pdfCaption,
                }),
              })

              const uazResponseText = await uazResponse.text()
              console.log(`WhatsApp PDF send response: status=${uazResponse.status}, body=${uazResponseText}`)

              if (uazResponse.ok) {
                console.log('Signed PDF sent via WhatsApp successfully')

                await supabase.from('whatsapp_messages').insert({
                  phone: localDoc.whatsapp_phone,
                  message_text: prefixWithSender(`📎 ${docName} - PDF assinado enviado`),
                  message_type: 'document',
                  direction: 'outbound',
                  status: 'sent',
                  contact_id: localDoc.contact_id || null,
                  lead_id: localDoc.lead_id || null,
                  instance_name: instance.instance_name,
                  instance_token: instance.instance_token,
                  media_url: signedFileUrl,
                  media_type: 'application/pdf',
                })
              } else {
                console.error('Failed to send signed PDF via WhatsApp:', uazResponseText)
              }

              // ====================================================
              // SEND SIGNED PDF TO WHATSAPP GROUP
              // ====================================================
              try {
                let groupId: string | null = null
                if (localDoc.lead_id) {
                  const { data: leadG } = await supabase.from('leads').select('whatsapp_group_id').eq('id', localDoc.lead_id).maybeSingle()
                  groupId = leadG?.whatsapp_group_id || null
                }
                if (!groupId && localDoc.contact_id) {
                  const { data: contactG } = await supabase.from('contacts').select('whatsapp_group_id').eq('id', localDoc.contact_id).maybeSingle()
                  groupId = contactG?.whatsapp_group_id || null
                }

                if (groupId) {
                  console.log(`Sending signed PDF to group: ${groupId}`)
                  
                  // Send signed PDF to group
                  await fetch(`${baseUrl}/send/media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
                    body: JSON.stringify({
                      number: groupId,
                      file: signedFileUrl,
                      type: 'document',
                      caption: `✅ ${docName} - Assinado por todos os signatários`,
                    }),
                  })

                  // Send summary message to group
                  const signerName = localDoc.signer_name || 'Cliente'
                  const summaryMsg = `✅ *Documento Assinado!*\n\n📄 *${docName}*\n👤 *Signatário:* ${signerName}\n📊 *Assinaturas:* ${signedCount}/${totalSigners} ✅\n📅 *Data:* ${new Date().toLocaleDateString('pt-BR')}\n\n🎉 Todas as assinaturas foram coletadas com sucesso!`
                  
                  await fetch(`${baseUrl}/send/text`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
                    body: JSON.stringify({ number: groupId, text: summaryMsg }),
                  })
                  
                  console.log(`Signed PDF and summary sent to group ${groupId}`)
                }
              } catch (groupErr) {
                console.error('Error sending signed PDF to group:', groupErr)
              }
            } else {
              console.error('No active WhatsApp instance found to send signed PDF')
            }
          } catch (whatsappErr) {
            console.error('Error sending PDF via WhatsApp:', whatsappErr)
          }
        } else {
          console.error('SIGNED FILE URL IS NULL - ZapSign has not generated the PDF yet despite doc being signed')
        }

        // ====================================================
        // SEND MEETING SCHEDULING SLOTS via WhatsApp
        // ====================================================
        try {
          const slotsRes = await fetch(`${supabaseUrl}/functions/v1/get-available-slots`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
            },
            body: JSON.stringify({
              user_id: localDoc.created_by,
              days_ahead: 5,
              slot_duration_minutes: 30,
            }),
          })

          const slotsData = await slotsRes.json()

          if (slotsData?.slots?.length > 0) {
            const docName = localDoc.document_name || 'Procuração'
            const signerName = localDoc.signer_name || 'Cliente'

            const slotsByDate: Record<string, string[]> = {}
            for (const slot of slotsData.slots) {
              if (!slotsByDate[slot.date]) slotsByDate[slot.date] = []
              slotsByDate[slot.date].push(slot.time)
            }

            let slotsText = ''
            for (const [date, times] of Object.entries(slotsByDate)) {
              slotsText += `\n📅 *${date}*: ${(times as string[]).join(' | ')}`
            }

            const meetingMessage = `🤝 *Reunião de Boas-Vindas*\n\nOlá! Agora que a *${docName}* foi assinada, gostaríamos de agendar sua reunião de boas-vindas.\n\n⏰ *Horários disponíveis:*${slotsText}\n\n✅ Responda com o *dia e horário* de sua preferência e confirmaremos o agendamento!\n\n_Prudência Advocacia_`

            const { data: instForMeeting } = await supabase
              .from('whatsapp_instances')
              .select('*')
              .eq('is_active', true)
              .limit(1)
              .single()

            if (instForMeeting) {
              const meetBaseUrl = instForMeeting.base_url || 'https://abraci.uazapi.com'
              await fetch(`${meetBaseUrl}/send/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': instForMeeting.instance_token },
                body: JSON.stringify({
                  number: localDoc.whatsapp_phone,
                  text: meetingMessage,
                }),
              })

              await supabase.from('whatsapp_messages').insert({
                phone: localDoc.whatsapp_phone,
                message_text: meetingMessage,
                message_type: 'text',
                direction: 'outbound',
                status: 'sent',
                contact_id: localDoc.contact_id || null,
                lead_id: localDoc.lead_id || null,
                instance_name: instForMeeting.instance_name,
                instance_token: instForMeeting.instance_token,
              })

              console.log('Meeting scheduling message sent to:', localDoc.whatsapp_phone)
            }
          } else {
            console.log('No available slots found or Google not connected, skipping meeting message')
          }
        } catch (meetingErr) {
          console.error('Error sending meeting scheduling message:', meetingErr)
        }
      } else {
        console.log(`PDF sending skipped - phone: ${localDoc.whatsapp_phone || 'NONE'}, send_signed_pdf: ${localDoc.send_signed_pdf}`)
      }
    }

    // ====================================================
    // BOARD-LEVEL POST-SIGNATURE AUTOMATIONS
    // ====================================================
    if (isDocFullySigned && localDoc.lead_id) {
      try {
        // Get lead's board_id
        const { data: leadForBoard } = await supabase
          .from('leads')
          .select('board_id, lead_phone, lead_name, whatsapp_group_id')
          .eq('id', localDoc.lead_id)
          .single()

        if (leadForBoard?.board_id) {
          // Check board_group_settings for post-signature automations
          const { data: boardSettings } = await supabase
            .from('board_group_settings')
            .select('auto_close_lead_on_sign, auto_create_group_on_sign')
            .eq('board_id', leadForBoard.board_id)
            .maybeSingle()

          if (boardSettings) {
            // Auto-close lead
            if (boardSettings.auto_close_lead_on_sign) {
              console.log(`[zapsign-webhook] Auto-closing lead ${localDoc.lead_id} (board setting)`)
              
              // Get the last stage of the board to move lead there
              const { data: boardData } = await supabase
                .from('kanban_boards')
                .select('stages')
                .eq('id', leadForBoard.board_id)
                .single()

              const stages = (boardData?.stages as any[]) || []
              const lastStage = stages.length > 0 ? stages[stages.length - 1] : null

              const updatePayload: any = { status: 'closed' }
              if (lastStage?.id) updatePayload.stage = lastStage.id

              await supabase
                .from('leads')
                .update(updatePayload)
                .eq('id', localDoc.lead_id)

              // Create legal case if none exists
              const { data: existingCase } = await supabase
                .from('legal_cases')
                .select('id')
                .eq('lead_id', localDoc.lead_id)
                .maybeSingle()

              if (!existingCase) {
                const { data: caseNumber } = await supabase.rpc('generate_case_number', {
                  p_nucleus_id: null,
                })

                await supabase.from('legal_cases').insert({
                  case_number: caseNumber,
                  title: `Caso - ${leadForBoard.lead_name || 'Novo'}`,
                  lead_id: localDoc.lead_id,
                  status: 'em_andamento',
                })

                console.log(`[zapsign-webhook] Legal case created: ${caseNumber}`)
              }
            }

            // Auto-create WhatsApp group
            if (boardSettings.auto_create_group_on_sign && !leadForBoard.whatsapp_group_id) {
              console.log(`[zapsign-webhook] Auto-creating group for lead ${localDoc.lead_id} (board setting)`)
              
              const leadPhone = (leadForBoard.lead_phone || localDoc.whatsapp_phone || '').replace(/\D/g, '')
              
              // Find the first linked instance for this board
              const { data: boardInst } = await supabase
                .from('board_group_instances')
                .select('instance_id')
                .eq('board_id', leadForBoard.board_id)
                .limit(1)
                .maybeSingle()

              const groupRes = await fetch(`${supabaseUrl}/functions/v1/create-whatsapp-group`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify({
                  phone: leadPhone,
                  lead_name: leadForBoard.lead_name || 'Lead',
                  board_id: leadForBoard.board_id,
                  contact_phone: leadPhone,
                  creator_instance_id: boardInst?.instance_id || null,
                }),
              })

              const groupData = await groupRes.json()
              if (groupData.success && groupData.group_id) {
                await supabase
                  .from('leads')
                  .update({ whatsapp_group_id: groupData.group_id } as any)
                  .eq('id', localDoc.lead_id)
                console.log(`[zapsign-webhook] Group created: ${groupData.group_id}`)
              } else {
                console.error(`[zapsign-webhook] Group creation failed:`, groupData.error)
              }
            }
          }
        }
      } catch (boardAutoErr) {
        console.error('[zapsign-webhook] Board automation error:', boardAutoErr)
      }
    }

    // ====================================================
    // TRIGGER AGENT AUTOMATIONS (on_document_signed)
    // ====================================================
    if (isDocFullySigned && localDoc.whatsapp_phone) {
      try {
        // Find the agent assigned to this conversation
        const { data: assignment } = await supabase
          .from('whatsapp_conversation_agents')
          .select('agent_id, is_active')
          .eq('phone', localDoc.whatsapp_phone)
          .eq('is_active', true)
          .maybeSingle()

        if (assignment?.agent_id) {
          console.log(`[zapsign-webhook] Triggering on_document_signed automations for agent ${assignment.agent_id}`)
          await fetch(`${supabaseUrl}/functions/v1/execute-agent-automations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
            },
            body: JSON.stringify({
              agent_id: assignment.agent_id,
              trigger_type: 'on_document_signed',
              phone: localDoc.whatsapp_phone,
              contact_name: localDoc.signer_name || null,
              lead_id: localDoc.lead_id || null,
            }),
          })
        }
      } catch (automationErr) {
        console.error('Error triggering agent automations:', automationErr)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, status: docData.status, signed: `${signedCount}/${totalSigners}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('ZapSign webhook error:', error)
    return new Response(
      JSON.stringify({ ok: true, error: String(error) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
