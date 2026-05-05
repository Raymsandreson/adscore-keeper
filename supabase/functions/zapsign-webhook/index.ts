import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";
import { getExternalClient } from "../_shared/external-client.ts";
import { remapToExternal } from "../_shared/uuid-remap.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
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

async function resolveOwnerByInstance(supabase: any, instanceName?: string | null): Promise<string | null> {
  if (!instanceName) return null
  const { data: instRow } = await supabase
    .from('whatsapp_instances')
    .select('id')
    .ilike('instance_name', instanceName)
    .eq('is_active', true)
    .maybeSingle()

  if (!instRow?.id) return null

  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('default_instance_id', instRow.id)
    .maybeSingle()

  return ownerProfile?.user_id || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY
    const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
    const cloudAnonKey = RESOLVED_ANON_KEY
    const zapsignToken = Deno.env.get('ZAPSIGN_API_TOKEN')!
    const extClient = getExternalClient()
    // Business data must always use the External DB. Keep `supabase` as the
    // existing variable name to avoid a risky full-file rewrite.
    const supabase = extClient

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

    // ====================================================
    // DEDUP GUARD: Prevent duplicate processing of the same webhook event
    // ZapSign may fire the same event multiple times
    // ====================================================
    if (eventType === 'doc_signed' || eventType === 'signer_signed') {
      const { data: existingDoc } = await supabase
        .from('zapsign_documents')
        .select('id, status, signed_at')
        .eq('doc_token', docToken)
        .single()

      if (existingDoc) {
        const alreadyProcessed = existingDoc.status === 'signed' && existingDoc.signed_at
        if (alreadyProcessed) {
          console.log(`[zapsign-webhook] DEDUP: doc ${docToken} already processed as signed (signed_at: ${existingDoc.signed_at}), skipping`)
          return new Response(JSON.stringify({ ok: true, dedup: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
      }
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
    let { data: localDoc } = await supabase
      .from('zapsign_documents')
      .update({
        status: docData.status,
        signed_file_url: signedFileUrl,
        signer_status: firstSigner?.status || null,
        signed_at: firstSigner?.signed_at || (isDocFullySigned ? new Date().toISOString() : null),
      })
      .eq('doc_token', docToken)
      .select('*')
      .maybeSingle()

    console.log('Updated local doc:', localDoc?.id, 'status:', docData.status, 'whatsapp_phone:', localDoc?.whatsapp_phone || 'NONE', 'lead_id:', localDoc?.lead_id || 'NONE')

    if (!localDoc) {
      const signerForCreate = triggeringSigner || firstSigner || body.signer_who_signed || body.signer || {}
      const signerPhoneForCreate = `${signerForCreate?.phone_country || ''}${signerForCreate?.phone_number || signerForCreate?.phone || ''}`.replace(/\D/g, '')
      const last8 = signerPhoneForCreate.slice(-8)

      let contactIdForCreate: string | null = null
      let leadIdForCreate: string | null = null
      if (signerPhoneForCreate) {
        const { data: matchedContact } = await supabase
          .from('contacts')
          .select('id, lead_id')
          .or(`phone.eq.${signerPhoneForCreate},phone.ilike.%${last8}%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        contactIdForCreate = matchedContact?.id || null
        leadIdForCreate = matchedContact?.lead_id || null
      }

      const { data: createdDoc, error: createDocErr } = await supabase
        .from('zapsign_documents')
        .insert({
          doc_token: docToken,
          document_name: docData.name || body.name || 'Documento ZapSign',
          status: docData.status || body.status || 'signed',
          original_file_url: docData.original_file || body.original_file || null,
          signed_file_url: signedFileUrl,
          sign_url: signerForCreate?.sign_url || signerForCreate?.signing_link || null,
          lead_id: leadIdForCreate,
          contact_id: contactIdForCreate,
          signer_name: signerForCreate?.name || null,
          signer_token: signerForCreate?.token || signerToken || null,
          signer_email: signerForCreate?.email || null,
          signer_phone: signerPhoneForCreate || null,
          signer_status: signerForCreate?.status || null,
          signed_at: signerForCreate?.signed_at || (isDocFullySigned ? new Date().toISOString() : null),
          template_data: {
            source: 'zapsign_webhook_auto_upsert',
            open_id: body.open_id || null,
            created_by_email: body.created_by?.email || null,
          },
          whatsapp_phone: signerPhoneForCreate || null,
          notify_on_signature: true,
          send_signed_pdf: true,
        })
        .select('*')
        .single()

      if (createDocErr || !createdDoc) {
        console.error('[zapsign-webhook] Could not auto-create local doc:', createDocErr)
        return new Response(JSON.stringify({ ok: true, error: 'local_doc_missing' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      localDoc = createdDoc
      console.log('[zapsign-webhook] Local doc auto-created from webhook:', localDoc.id)
    }

    // ====================================================
    // AUTO-RESOLVE lead_id if missing (match by whatsapp_phone)
    // ====================================================
    if (!localDoc.lead_id && localDoc.whatsapp_phone) {
      const cleanPhone = localDoc.whatsapp_phone.replace(/\D/g, '')
      console.log(`[zapsign-webhook] lead_id is NULL, trying to resolve by phone: ${cleanPhone}`)
      
      const { data: matchedLead } = await supabase
        .from('leads')
        .select('id')
        .eq('lead_phone', cleanPhone)
        .maybeSingle()

      if (matchedLead) {
        localDoc.lead_id = matchedLead.id
        await supabase
          .from('zapsign_documents')
          .update({ lead_id: matchedLead.id })
          .eq('id', localDoc.id)
        console.log(`[zapsign-webhook] Resolved lead_id: ${matchedLead.id} from phone ${cleanPhone}`)
      } else {
        console.log(`[zapsign-webhook] No lead found for phone ${cleanPhone}`)
      }
    }

    let resolvedOwnerId: string | null = localDoc.created_by || null
    if (!resolvedOwnerId && localDoc.contact_id) {
      const { data: ownerContact } = await supabase
        .from('contacts')
        .select('created_by')
        .eq('id', localDoc.contact_id)
        .maybeSingle()
      resolvedOwnerId = ownerContact?.created_by || null
    }
    if (!resolvedOwnerId && localDoc.lead_id) {
      const { data: ownerLead } = await supabase
        .from('leads')
        .select('created_by')
        .eq('id', localDoc.lead_id)
        .maybeSingle()
      resolvedOwnerId = ownerLead?.created_by || null
    }
    if (!resolvedOwnerId) {
      resolvedOwnerId = await resolveOwnerByInstance(supabase, localDoc.instance_name)
    }
    if (resolvedOwnerId && localDoc.created_by !== resolvedOwnerId) {
      localDoc.created_by = resolvedOwnerId
      await supabase
        .from('zapsign_documents')
        .update({ created_by: resolvedOwnerId })
        .eq('id', localDoc.id)
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

        const createdByExtId = localDoc.created_by ? await remapToExternal(extClient, localDoc.created_by) : null
        await extClient.from('lead_activities').insert({
          lead_id: localDoc.lead_id,
          lead_name: localDoc.signer_name || 'Documento',
          title: `Assinatura: ${signerName} assinou "${docName}"`,
          description: `${signerName} assinou o documento "${docName}" em ${new Date().toLocaleDateString('pt-BR')}. Progresso: ${signedCount}/${totalSigners} assinaturas.`,
          activity_type: 'documento',
          status: isDocFullySigned ? 'concluida' : 'pendente',
          priority: 'normal',
          created_by: createdByExtId,
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

      // Enrich lead via Gemini Vision on the signed PDF + upload to Drive folder (fire-and-forget)
      if (localDoc.lead_id && signedFileUrl) {
        try {
          fetch(`${cloudFunctionsUrl}/functions/v1/zapsign-enrich-lead`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cloudAnonKey}` },
            body: JSON.stringify({
              lead_id: localDoc.lead_id,
              signed_file_url: signedFileUrl,
              instance_name: localDoc.instance_name || null,
              doc_token: docToken,
              document_name: localDoc.document_name || null,
            }),
          }).catch((e) => console.error('[zapsign-webhook] enrich invoke error:', e))
          console.log('[zapsign-webhook] enrich-lead invoked')
        } catch (enrichErr) {
          console.error('[zapsign-webhook] enrich error:', enrichErr)
        }
      }

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
        // SEND ONBOARDING MEETING BOOKING LINK
        // ====================================================
        try {
          // Find meeting config for the board this document belongs to
          let meetingBoardId: string | null = null
          if (localDoc.lead_id) {
            const { data: leadData } = await supabase
              .from('leads')
              .select('board_id')
              .eq('id', localDoc.lead_id)
              .maybeSingle()
            meetingBoardId = leadData?.board_id || null
          }

          if (meetingBoardId) {
            const { data: meetingConfig } = await supabase
              .from('onboarding_meeting_configs')
              .select('*')
              .eq('board_id', meetingBoardId)
              .eq('is_active', true)
              .eq('auto_send_after_signature', true)
              .maybeSingle()

            if (meetingConfig) {
              // Create a booking record with token for the client
              const { data: bookingRecord } = await supabase
                .from('onboarding_meeting_bookings')
                .insert({
                  config_id: meetingConfig.id,
                  lead_id: localDoc.lead_id,
                  contact_phone: localDoc.whatsapp_phone,
                  contact_name: localDoc.signer_name || 'Cliente',
                  status: 'pending',
                })
                .select('booking_token')
                .single()

              if (bookingRecord?.booking_token) {
                const appUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '') || ''
                // Use the published app URL
                const bookingLink = `https://adscore-keeper.lovable.app/booking/${meetingConfig.id}/${bookingRecord.booking_token}`

                const docName = localDoc.document_name || 'documento'
                const contactName = localDoc.signer_name || 'Cliente'
                let meetingMessage = (meetingConfig.message_template || '')
                  .replace(/\{\{booking_link\}\}/g, bookingLink)
                  .replace(/\{\{duration\}\}/g, String(meetingConfig.meeting_duration_minutes))
                  .replace(/\{\{contact_name\}\}/g, contactName)

                // Use the same instance that sent the document
                const instanceName = localDoc.instance_name
                const { data: instForMeeting } = await supabase
                  .from('whatsapp_instances')
                  .select('*')
                  .eq('instance_name', instanceName)
                  .eq('is_active', true)
                  .maybeSingle()

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

                  console.log('Onboarding booking link sent to:', localDoc.whatsapp_phone, 'link:', bookingLink)
                } else {
                  console.log('No matching WhatsApp instance found for meeting message, instance:', instanceName)
                }
              }
            } else {
              console.log('No active meeting config for board:', meetingBoardId)
            }
          } else {
            console.log('No board_id found for lead, skipping meeting scheduling')
          }
        } catch (meetingErr) {
          console.error('Error sending onboarding booking link:', meetingErr)
        }
      } else {
        console.log(`PDF sending skipped - phone: ${localDoc.whatsapp_phone || 'NONE'}, send_signed_pdf: ${localDoc.send_signed_pdf}`)
      }
    }

    // ====================================================
    // AUTO-CREATE CONTACT + LEAD WITH AI CONTEXT ON SIGN
    // ====================================================
    if (isDocFullySigned && localDoc.whatsapp_phone) {
      const cleanPhone = (localDoc.whatsapp_phone || '').replace(/\D/g, '')
      
      // Only proceed if no lead is linked yet
      if (!localDoc.lead_id && cleanPhone) {
        try {
          console.log(`[zapsign-webhook] No lead linked, auto-creating contact+lead for phone: ${cleanPhone}`)

          // 1. Fetch conversation messages for AI extraction (also grab campaign_id)
          const { data: convMessages } = await supabase
            .from('whatsapp_messages')
            .select('message_text, direction, created_at, campaign_id')
            .eq('phone', cleanPhone)
            .order('created_at', { ascending: true })
            .limit(100)

          // 2. Extract structured data via AI
          let extractedData: Record<string, any> = {}
          if (convMessages && convMessages.length > 0) {
            try {
              const extractRes = await fetch(`${cloudFunctionsUrl}/functions/v1/extract-conversation-data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${cloudAnonKey}`,
                },
                body: JSON.stringify({
                  messages: convMessages.map(m => ({
                    message_text: m.message_text,
                    direction: m.direction,
                  })),
                  targetType: 'lead',
                }),
              })
              const extractResult = await extractRes.json()
              extractedData = extractResult?.data || {}
              console.log(`[zapsign-webhook] AI extracted data:`, JSON.stringify(extractedData))
            } catch (extractErr) {
              console.error('[zapsign-webhook] AI extraction error:', extractErr)
            }
          }

          // 3. Create contact if not exists
          let contactId: string | null = null
          const { data: existingContact } = await supabase
            .from('contacts')
            .select('id')
            .eq('phone', cleanPhone)
            .maybeSingle()

          if (existingContact) {
            contactId = existingContact.id
            console.log(`[zapsign-webhook] Contact already exists: ${contactId}`)
          } else {
            const contactName = extractedData.lead_name || extractedData.victim_name || localDoc.signer_name || cleanPhone
            const { data: newContact, error: contactErr } = await supabase
              .from('contacts')
              .insert({
                full_name: contactName,
                phone: cleanPhone,
                email: extractedData.lead_email || null,
                city: extractedData.city || null,
                state: extractedData.state || null,
                neighborhood: extractedData.neighborhood || null,
                profession: extractedData.sector || null,
                notes: extractedData.notes || null,
                action_source: 'system',
                action_source_detail: 'Criado automaticamente ao assinar documento (ZapSign)',
                created_by: resolvedOwnerId,
              })
              .select('id')
              .single()

            if (contactErr) {
              console.error('[zapsign-webhook] Error creating contact:', contactErr)
            } else {
              contactId = newContact.id
              console.log(`[zapsign-webhook] Contact created: ${contactId}`)
            }
          }

          // 4. Determine board - PRIORITY: campaign CTWA > shortcut config > fallback
          let boardId: string | null = null
          let stageId: string | null = null
          let campaignId: string | null = null
          let campaignName: string | null = null

          // 4a. Try to resolve from CTWA campaign (highest priority)
          if (convMessages && convMessages.length > 0) {
            const msgWithCampaign = convMessages.find(m => m.campaign_id)
            if (msgWithCampaign) {
              campaignId = msgWithCampaign.campaign_id
              console.log(`[zapsign-webhook] Found campaign_id from messages: ${campaignId}`)

              const { data: campaignLink } = await supabase
                .from('whatsapp_agent_campaign_links')
                .select('board_id, stage_id, campaign_name')
                .eq('campaign_id', campaignId)
                .maybeSingle()

              if (campaignLink?.board_id) {
                boardId = campaignLink.board_id
                stageId = campaignLink.stage_id || null
                campaignName = campaignLink.campaign_name || null
                console.log(`[zapsign-webhook] Board resolved from CTWA campaign: ${boardId}, stage: ${stageId}`)
              }
            }
          }

          // 4b. Fallback: try from shortcut automation rules
          if (!boardId && localDoc.shortcut_name) {
            const { data: shortcut } = await supabase
              .from('wjia_command_shortcuts')
              .select('id')
              .eq('shortcut_name', localDoc.shortcut_name)
              .maybeSingle()

            if (shortcut) {
              const { data: rule } = await supabase
                .from('agent_automation_rules')
                .select('actions')
                .eq('agent_id', shortcut.id)
                .eq('trigger_type', 'on_document_signed')
                .eq('is_active', true)
                .maybeSingle()

              if (rule?.actions) {
                const createLeadAction = (rule.actions as any[]).find((a: any) => a.type === 'create_lead')
                if (createLeadAction?.config?.board_id) {
                  boardId = createLeadAction.config.board_id
                  stageId = createLeadAction.config?.stage_id || null
                }
              }
            }
          }

          // 4c. Final fallback: first kanban board
          if (!boardId) {
            const { data: firstBoard } = await supabase
              .from('kanban_boards')
              .select('id')
              .limit(1)
              .single()
            boardId = firstBoard?.id || null
          }

          // Get first stage if not set
          if (boardId && !stageId) {
            const { data: firstStage } = await supabase
              .from('kanban_stages')
              .select('id')
              .eq('board_id', boardId)
              .order('display_order', { ascending: true })
              .limit(1)
              .single()
            stageId = firstStage?.id || null
          }

          // 5. Create lead
          if (boardId) {
            const leadName = extractedData.lead_name || extractedData.victim_name || localDoc.signer_name || cleanPhone
            const { data: newLead, error: leadErr } = await supabase
              .from('leads')
              .insert({
                lead_name: leadName,
                lead_phone: cleanPhone,
                lead_email: extractedData.lead_email || null,
                board_id: boardId,
                stage: stageId,
                status: 'new',
                source: 'zapsign',
                city: extractedData.city || null,
                state: extractedData.state || null,
                neighborhood: extractedData.neighborhood || null,
                main_company: extractedData.main_company || null,
                contractor_company: extractedData.contractor_company || null,
                accident_address: extractedData.accident_address || null,
                accident_date: extractedData.accident_date || null,
                damage_description: extractedData.damage_description || null,
                case_number: extractedData.case_number || null,
                case_type: extractedData.case_type || null,
                notes: extractedData.notes || null,
                sector: extractedData.sector || null,
                liability_type: extractedData.liability_type || null,
                news_link: extractedData.news_link || null,
                campaign_id: campaignId || null,
                campaign_name: campaignName || null,
                created_by: resolvedOwnerId,
                action_source: 'system',
                action_source_detail: campaignId 
                  ? `Lead criado automaticamente ao assinar documento (ZapSign) - Campanha: ${campaignName || campaignId}`
                  : 'Lead criado automaticamente ao assinar documento (ZapSign)',
              })
              .select('id')
              .single()

            if (leadErr) {
              console.error('[zapsign-webhook] Error creating lead:', leadErr)
            } else {
              localDoc.lead_id = newLead.id
              console.log(`[zapsign-webhook] Lead created: ${newLead.id}`)

              // Update zapsign_documents with the new lead_id
              await supabase
                .from('zapsign_documents')
                .update({ lead_id: newLead.id })
                .eq('id', localDoc.id)

              // 6. Link contact to lead
              if (contactId) {
                await extClient.from('contact_leads').insert({
                  contact_id: contactId,
                  lead_id: newLead.id,
                })
                console.log(`[zapsign-webhook] Contact-Lead linked: ${contactId} -> ${newLead.id}`)
              }
            }
          }
        } catch (autoCreateErr) {
          console.error('[zapsign-webhook] Auto-create contact+lead error:', autoCreateErr)
        }
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
            .select('auto_close_lead_on_sign, auto_create_group_on_sign, post_sign_mode, auto_archive_on_sign, processual_acolhedor_id, initial_message_template, use_ai_message, ai_generated_message, send_audio_message, audio_voice_id, lead_fields')
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

              const updatePayload: any = { status: 'closed', lead_status: 'closed' }
              if (lastStage?.id) updatePayload.stage = lastStage.id
              // Set closing date = signature date (fonte de verdade ZapSign)
              const signedAtIso = firstSigner?.signed_at || (isDocFullySigned ? new Date().toISOString() : null)
              if (signedAtIso) updatePayload.became_client_date = signedAtIso.slice(0, 10)

              await supabase
                .from('leads')
                .update(updatePayload)
                .eq('id', localDoc.lead_id)

              // Create legal case if none exists
              const { data: existingCase } = await extClient
                .from('legal_cases')
                .select('id')
                .eq('lead_id', localDoc.lead_id)
                .maybeSingle()

              if (!existingCase) {
                const { data: caseNumber } = await supabase.rpc('generate_case_number', {
                  p_nucleus_id: null,
                })

                const { data: createdCase } = await extClient.from('legal_cases').insert({
                  case_number: caseNumber,
                  title: `Caso - ${leadForBoard.lead_name || 'Novo'}`,
                  lead_id: localDoc.lead_id,
                  status: 'em_andamento',
                  created_by: localDoc.created_by || null,
                  assigned_to: localDoc.created_by || null,
                }).select('id').single()

                console.log(`[zapsign-webhook] Legal case created: ${caseNumber}`)

                // Auto-create process tracking record
                if (createdCase?.id) {
                  try {
                    await extClient.from('case_process_tracking').insert({
                      case_id: createdCase.id,
                      lead_id: localDoc.lead_id,
                      cliente: leadForBoard.lead_name || '',
                      caso: `Caso - ${leadForBoard.lead_name || 'Novo'}`,
                      tipo: (leadForBoard as any).case_type || null,
                      acolhedor: (leadForBoard as any).acolhedor || null,
                      data_criacao: new Date().toISOString().split('T')[0],
                      import_source: 'auto_zapsign',
                    })
                  } catch (trackErr) {
                    console.warn('[zapsign-webhook] Could not auto-create tracking:', trackErr)
                  }
                }

                // Auto-create ONBOARDING activity for CASO-prefixed cases
                if (caseNumber && caseNumber.startsWith('CASO')) {
                  try {
                    const wanessaCloudUuid = '1f788b8d-e30e-484a-9460-39a881d25128'
                    const wanessaExtUuid = await remapToExternal(extClient, wanessaCloudUuid)
                    await extClient.from('lead_activities').insert({
                      lead_id: localDoc.lead_id,
                      lead_name: leadForBoard.lead_name || 'Novo',
                      title: 'ONBOARDING CLIENTE',
                      description: `Atividade de onboarding criada automaticamente para o caso ${caseNumber}`,
                      activity_type: 'tarefa',
                      status: 'pendente',
                      priority: 'alta',
                      assigned_to: wanessaExtUuid,
                      assigned_to_name: 'Wanessa Vitória Rodrigues de Sousa',
                      deadline: new Date().toISOString().split('T')[0],
                    })
                    console.log(`[zapsign-webhook] Onboarding activity created for ${caseNumber}`)
                  } catch (onbErr) {
                    console.warn('[zapsign-webhook] Onboarding activity error:', onbErr)
                  }
                }
              }
            }

            // Determine post-signature mode (group | private)
            // Backward-compat: if post_sign_mode is null, fall back to auto_create_group_on_sign
            const postSignMode = boardSettings.post_sign_mode
              || (boardSettings.auto_create_group_on_sign ? 'group' : null)

            const leadPhone = (leadForBoard.lead_phone || localDoc.whatsapp_phone || '').replace(/\D/g, '')

            // Resolve the creator instance (used in both modes)
            let creatorInstanceId: string | null = null
            let creatorInstanceName: string | null = localDoc.instance_name || null

            if (localDoc.instance_name) {
              const { data: docInst } = await supabase
                .from('whatsapp_instances')
                .select('id, instance_name')
                .eq('instance_name', localDoc.instance_name)
                .eq('is_active', true)
                .maybeSingle()
              if (docInst) {
                creatorInstanceId = docInst.id
                creatorInstanceName = docInst.instance_name
              }
            }

            if (!creatorInstanceId && localDoc.created_by) {
              const { data: creatorProfile } = await supabase
                .from('profiles')
                .select('default_instance_id')
                .eq('user_id', localDoc.created_by)
                .maybeSingle()
              if (creatorProfile?.default_instance_id) {
                creatorInstanceId = creatorProfile.default_instance_id
              }
            }

            if (!creatorInstanceId) {
              const { data: boardInst } = await supabase
                .from('board_group_instances')
                .select('instance_id, whatsapp_instances:instance_id(instance_name)')
                .eq('board_id', leadForBoard.board_id)
                .limit(1)
                .maybeSingle()
              if (boardInst) {
                creatorInstanceId = boardInst.instance_id || null
                creatorInstanceName = (boardInst as any).whatsapp_instances?.instance_name || creatorInstanceName
              }
            }

            console.log(`[zapsign-webhook] post_sign_mode=${postSignMode} creator_instance=${creatorInstanceId} (${creatorInstanceName})`)

            // ====================================================
            // MODE: GROUP — original behavior
            // ====================================================
            if (postSignMode === 'group' && !leadForBoard.whatsapp_group_id) {
              console.log(`[zapsign-webhook] Auto-creating group for lead ${localDoc.lead_id}`)

              const groupRes = await fetch(`${cloudFunctionsUrl}/functions/v1/create-whatsapp-group`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${cloudAnonKey}`,
                },
                body: JSON.stringify({
                  phone: leadPhone,
                  lead_name: leadForBoard.lead_name || 'Lead',
                  board_id: leadForBoard.board_id,
                  contact_phone: leadPhone,
                  creator_instance_id: creatorInstanceId,
                  lead_id: localDoc.lead_id,
                  creation_origin: 'auto_sign',
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

            // ====================================================
            // MODE: PRIVATE — send initial message in 1:1 chat,
            // reassign to processual acolhedor, optionally archive
            // ====================================================
            if (postSignMode === 'private' && leadPhone && creatorInstanceName) {
              console.log(`[zapsign-webhook] Private mode: sending initial message in 1:1 to ${leadPhone}`)

              // 1. Render initial message (use AI-generated if available, else template)
              let messageText: string | null = null
              if (boardSettings.use_ai_message && boardSettings.ai_generated_message) {
                messageText = boardSettings.ai_generated_message
              } else if (boardSettings.initial_message_template) {
                messageText = boardSettings.initial_message_template
              }

              if (messageText) {
                // Replace variables
                const replacements: Record<string, string> = {
                  '{lead_name}': leadForBoard.lead_name || '',
                  '{victim_name}': (leadForBoard as any).victim_name || leadForBoard.lead_name || '',
                  '{case_type}': (leadForBoard as any).case_type || '',
                  '{city}': (leadForBoard as any).city || '',
                  '{state}': (leadForBoard as any).state || '',
                  '{case_number}': (leadForBoard as any).case_number || '',
                  '{board_name}': '',
                }
                Object.entries(replacements).forEach(([key, val]) => {
                  messageText = messageText!.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val)
                })

                try {
                  const sendRes = await fetch(`${cloudFunctionsUrl}/functions/v1/send-whatsapp`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${cloudAnonKey}`,
                    },
                    body: JSON.stringify({
                      phone: leadPhone,
                      message: messageText,
                      instance_name: creatorInstanceName,
                      lead_id: localDoc.lead_id,
                    }),
                  })
                  const sendData = await sendRes.json().catch(() => ({}))
                  console.log(`[zapsign-webhook] Private initial message sent:`, sendData?.success ?? sendRes.status)
                } catch (sendErr) {
                  console.error('[zapsign-webhook] Private message send error:', sendErr)
                }
              } else {
                console.log('[zapsign-webhook] Private mode: no initial message template configured, skipping message')
              }

              // 2. Reassign lead to processual acolhedor
              if (boardSettings.processual_acolhedor_id) {
                try {
                  const { data: acolhedorProfile } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('user_id', boardSettings.processual_acolhedor_id)
                    .maybeSingle()

                  await supabase
                    .from('leads')
                    .update({
                      assigned_to: boardSettings.processual_acolhedor_id,
                      acolhedor: acolhedorProfile?.full_name || null,
                    } as any)
                    .eq('id', localDoc.lead_id)

                  console.log(`[zapsign-webhook] Lead reassigned to processual acolhedor: ${acolhedorProfile?.full_name}`)
                } catch (reassignErr) {
                  console.error('[zapsign-webhook] Reassign error:', reassignErr)
                }
              }

              // 3. Archive conversation in internal inbox
              // (WhatsApp-side archive via UazAPI not implemented yet — endpoint not confirmed)
              if (boardSettings.auto_archive_on_sign) {
                try {
                  await supabase
                    .from('archived_conversations')
                    .upsert({
                      phone: leadPhone,
                      instance_name: creatorInstanceName,
                      reason: 'auto_zapsign_signed',
                    }, { onConflict: 'phone,instance_name' })
                  console.log(`[zapsign-webhook] Conversation archived in inbox: ${leadPhone}@${creatorInstanceName}`)
                } catch (archErr) {
                  console.error('[zapsign-webhook] Archive error:', archErr)
                }
              }
            }
          }
        }
      } catch (boardAutoErr) {
        console.error('[zapsign-webhook] Board automation error:', boardAutoErr)
      }
    }

    // ====================================================
    // FALLBACK UNIVERSAL: garantir GRUPO de WhatsApp para qualquer
    // procuração assinada com telefone + lead. Roda mesmo quando o board
    // não tem `board_group_settings` (post_sign_mode null).
    // O bloco anterior já cobriu o caso `post_sign_mode = 'group'`; aqui
    // tratamos somente leads que ficaram sem grupo após aquele bloco.
    // ====================================================
    if (isDocFullySigned && localDoc.lead_id && localDoc.whatsapp_phone) {
      try {
        const { data: leadForGroup } = await supabase
          .from('leads')
          .select('id, board_id, lead_phone, lead_name, whatsapp_group_id')
          .eq('id', localDoc.lead_id)
          .maybeSingle()

        if (leadForGroup && !leadForGroup.whatsapp_group_id) {
          const fallbackPhone = (leadForGroup.lead_phone || localDoc.whatsapp_phone || '').replace(/\D/g, '')

          // Resolve uma instância: doc → criador → primeira ativa
          let fbInstanceId: string | null = null
          let fbInstanceName: string | null = localDoc.instance_name || null
          if (fbInstanceName) {
            const { data: i } = await supabase
              .from('whatsapp_instances')
              .select('id, instance_name')
              .ilike('instance_name', fbInstanceName)
              .eq('is_active', true)
              .maybeSingle()
            if (i) { fbInstanceId = i.id; fbInstanceName = i.instance_name }
          }
          if (!fbInstanceId && localDoc.created_by) {
            const { data: prof } = await supabase
              .from('profiles')
              .select('default_instance_id')
              .eq('user_id', localDoc.created_by)
              .maybeSingle()
            if (prof?.default_instance_id) fbInstanceId = prof.default_instance_id
          }
          if (!fbInstanceId) {
            const { data: anyInst } = await supabase
              .from('whatsapp_instances')
              .select('id, instance_name')
              .eq('is_active', true)
              .limit(1)
              .maybeSingle()
            if (anyInst) { fbInstanceId = anyInst.id; fbInstanceName = anyInst.instance_name }
          }

          if (fallbackPhone && fbInstanceId) {
            console.log(`[zapsign-webhook] FALLBACK: criando grupo para lead ${localDoc.lead_id} (sem board settings)`)
            const groupRes = await fetch(`${cloudFunctionsUrl}/functions/v1/create-whatsapp-group`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cloudAnonKey}`,
              },
              body: JSON.stringify({
                phone: fallbackPhone,
                lead_name: leadForGroup.lead_name || 'Lead',
                board_id: leadForGroup.board_id || null,
                contact_phone: fallbackPhone,
                creator_instance_id: fbInstanceId,
                lead_id: localDoc.lead_id,
                creation_origin: 'auto_sign_fallback',
              }),
            })
            const groupData = await groupRes.json().catch(() => ({}))
            if (groupData?.success && groupData?.group_id) {
              await supabase
                .from('leads')
                .update({ whatsapp_group_id: groupData.group_id } as any)
                .eq('id', localDoc.lead_id)
              console.log(`[zapsign-webhook] FALLBACK group created: ${groupData.group_id}`)
            } else {
              console.error(`[zapsign-webhook] FALLBACK group creation failed:`, groupData?.error || groupRes.status)
            }
          } else {
            console.log(`[zapsign-webhook] FALLBACK skipped — phone=${fallbackPhone || 'NONE'} instance=${fbInstanceId || 'NONE'}`)
          }
        }
      } catch (fbErr) {
        console.error('[zapsign-webhook] FALLBACK group creation error:', fbErr)
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
          await fetch(`${cloudFunctionsUrl}/functions/v1/execute-agent-automations`, {
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
