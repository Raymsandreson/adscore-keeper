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
    const zapsignToken = Deno.env.get('ZAPSIGN_API_TOKEN')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const body = await req.json()
    console.log('ZapSign webhook received:', JSON.stringify(body))

    const eventType = body.event_type || body.type
    const docToken = body.doc?.token || body.token || body.doc_token
    const signerToken = body.signer?.token || body.signer_token

    if (!docToken) {
      console.log('No doc token in webhook, ignoring')
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Fetch latest document info from ZapSign API
    const zapsignHeaders = {
      'Authorization': `Bearer ${zapsignToken}`,
      'Content-Type': 'application/json',
    }

    const docResponse = await fetch(`https://api.zapsign.com.br/api/v1/docs/${docToken}/`, {
      headers: zapsignHeaders,
    })

    if (!docResponse.ok) {
      console.error('Failed to fetch doc from ZapSign:', docResponse.status)
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const docData = await docResponse.json()
    const allSigners = docData.signers || []
    const totalSigners = allSigners.length
    const signedSigners = allSigners.filter((s: any) => s.status === 'signed')
    const signedCount = signedSigners.length
    const signedFileUrl = docData.signed_file || null
    const isDocFullySigned = docData.status === 'signed'

    console.log(`ZapSign doc status: ${docData.status}, signers: ${signedCount}/${totalSigners}, signed_file: ${signedFileUrl ? 'yes' : 'no'}`)

    // Find the signer that triggered this webhook (the one who just signed)
    const triggeringSigner = signerToken 
      ? allSigners.find((s: any) => s.token === signerToken) 
      : null

    // Update local database with first signer info (legacy compat)
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

    console.log('Updated local doc:', localDoc?.id, 'status:', docData.status)

    if (!localDoc) {
      console.log('No local doc found for token:', docToken)
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ====================================================
    // NOTIFY on each individual signature (partial or full)
    // ====================================================
    const justSignedSigner = triggeringSigner?.status === 'signed' ? triggeringSigner : null

    if (justSignedSigner && localDoc.whatsapp_phone && localDoc.notify_on_signature !== false) {
      try {
        const { data: instance } = await supabase
          .from('whatsapp_instances')
          .select('*')
          .eq('is_active', true)
          .limit(1)
          .single()

        if (instance) {
          const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
          const signerName = justSignedSigner.name || 'Signatário'
          const docName = localDoc.document_name || 'Documento'

          // Build progress message
          let statusEmoji = '✍️'
          let statusText = `*${signerName}* assinou o documento.`
          let progressText = `📊 Progresso: ${signedCount}/${totalSigners} assinaturas`

          if (isDocFullySigned) {
            statusEmoji = '✅'
            statusText = `*${signerName}* assinou o documento.`
            progressText = `🎉 *Todas as ${totalSigners} assinaturas foram coletadas!*\n\n📎 O PDF assinado será enviado em seguida.`
          }

          const notificationMessage = `${statusEmoji} *Assinatura recebida!*\n\n📄 *${docName}*\n${statusText}\n${progressText}`

          // Send notification
          await fetch(`${baseUrl}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
            body: JSON.stringify({
              number: localDoc.whatsapp_phone,
              text: notificationMessage,
            }),
          })

          // Save notification message to DB
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
        }
      } catch (notifyErr) {
        console.error('Error sending signer notification:', notifyErr)
      }
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
    if (isDocFullySigned && signedFileUrl) {
      // Save signed document as activity attachment (only if lead exists)
      if (localDoc.lead_id) {
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

      // Send signed PDF via WhatsApp
      if (localDoc.whatsapp_phone && localDoc.send_signed_pdf !== false) {
        console.log('All signatures collected! Sending signed PDF via WhatsApp to:', localDoc.whatsapp_phone)

        try {
          const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('*')
            .eq('is_active', true)
            .limit(1)
            .single()

          if (instance) {
            const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
            const docName = localDoc.document_name || 'Documento'

            // Send the signed PDF as a document via /send/media
            const sendDocUrl = `${baseUrl}/send/media`
            const uazResponse = await fetch(sendDocUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
              body: JSON.stringify({
                number: localDoc.whatsapp_phone,
                file: signedFileUrl,
                type: 'document',
                caption: `📎 ${docName} - Assinado por todos os signatários`,
              }),
            })

            if (uazResponse.ok) {
              console.log('Signed PDF sent via WhatsApp successfully')

              await supabase.from('whatsapp_messages').insert({
                phone: localDoc.whatsapp_phone,
                message_text: `📎 ${docName} - PDF assinado enviado`,
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
              const errText = await uazResponse.text()
              console.error('Failed to send signed PDF via WhatsApp:', errText)
            }
          } else {
            console.error('No active WhatsApp instance found to send signed PDF')
          }
        } catch (whatsappErr) {
          console.error('Error sending PDF via WhatsApp:', whatsappErr)
        }

        // ====================================================
        // SEND MEETING SCHEDULING SLOTS via WhatsApp
        // ====================================================
        try {
          // Get available slots from Google Calendar
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!
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

            // Group slots by date
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
