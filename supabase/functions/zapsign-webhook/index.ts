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
    console.log('ZapSign doc status:', docData.status, 'signed_file:', docData.signed_file ? 'yes' : 'no')

    const signer = docData.signers?.[0]
    const signedFileUrl = docData.signed_file || null

    // Determine if document is signed BEFORE using it
    const isDocSigned = docData.status === 'signed' || signer?.status === 'signed'

    // Update local database
    const { data: localDoc } = await supabase
      .from('zapsign_documents')
      .update({
        status: docData.status,
        signed_file_url: signedFileUrl,
        signer_status: signer?.status || null,
        signed_at: signer?.signed_at || new Date().toISOString(),
      })
      .eq('doc_token', docToken)
      .select('*')
      .single()

    console.log('Updated local doc:', localDoc?.id, 'status:', docData.status)

    // Save signed document as an activity attachment linked to the lead
    if (isDocSigned && signedFileUrl && localDoc?.lead_id) {
      try {
        const { data: activity } = await supabase
          .from('lead_activities')
          .insert({
            lead_id: localDoc.lead_id,
            lead_name: localDoc.signer_name || 'Documento',
            title: `Procuração assinada: ${localDoc.document_name || 'Documento'}`,
            description: `Documento "${localDoc.document_name}" assinado por ${localDoc.signer_name} em ${new Date().toLocaleDateString('pt-BR')}.`,
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

    // If document is signed and we have a signed PDF, send it via WhatsApp
    if (isDocSigned && signedFileUrl && localDoc?.whatsapp_phone) {
      console.log('Document signed! Sending signed PDF via WhatsApp to:', localDoc.whatsapp_phone)

      // Get active WhatsApp instance
      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single()

      if (instance) {
        const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
        const signerName = localDoc.signer_name || 'Cliente'
        const docName = localDoc.document_name || 'Documento'

        // First send a text confirmation message
        const confirmUrl = `${baseUrl}/send/text`
        await fetch(confirmUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
          body: JSON.stringify({
            number: localDoc.whatsapp_phone,
            text: `✅ *Assinatura confirmada!*\n\n📄 *${docName}*\nAssinado por: ${signerName}\nData: ${new Date().toLocaleDateString('pt-BR')}\n\nSua assinatura foi registrada com sucesso. Segue abaixo o PDF do documento assinado para seus registros. 👇`,
          }),
        })

        // Then send the signed PDF as a document
        const sendDocUrl = `${baseUrl}/send/link`
        const uazResponse = await fetch(sendDocUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instance.instance_token },
          body: JSON.stringify({
            number: localDoc.whatsapp_phone,
            link: signedFileUrl,
            caption: `📎 ${docName} - Assinado`,
          }),
        })

        if (uazResponse.ok) {
          console.log('Signed PDF sent via WhatsApp successfully')

          // Save both messages to DB
          await supabase.from('whatsapp_messages').insert([
            {
              phone: localDoc.whatsapp_phone,
              message_text: `✅ Assinatura confirmada! Documento: ${docName} - Assinado por ${signerName}`,
              message_type: 'text',
              direction: 'outbound',
              status: 'sent',
              contact_id: localDoc.contact_id || null,
              lead_id: localDoc.lead_id || null,
              instance_name: instance.instance_name,
              instance_token: instance.instance_token,
            },
            {
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
            },
          ])
        } else {
          const errText = await uazResponse.text()
          console.error('Failed to send signed PDF via WhatsApp:', errText)
        }
      } else {
        console.error('No active WhatsApp instance found to send signed PDF')
      }
    }

    return new Response(
      JSON.stringify({ ok: true, status: docData.status }),
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
