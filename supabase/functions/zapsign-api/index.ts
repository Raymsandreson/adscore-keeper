import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ZAPSIGN_API_URL = 'https://api.zapsign.com.br/api/v1'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const zapsignToken = Deno.env.get('ZAPSIGN_API_TOKEN')

    if (!zapsignToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'ZAPSIGN_API_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const body = await req.json()
    const { action } = body

    const zapsignHeaders = {
      'Authorization': `Bearer ${zapsignToken}`,
      'Content-Type': 'application/json',
    }

    // ========================
    // LIST TEMPLATES
    // ========================
    if (action === 'list_templates') {
      const response = await fetch(`${ZAPSIGN_API_URL}/templates/`, {
        headers: zapsignHeaders,
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ZapSign API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      return new Response(
        JSON.stringify({ success: true, templates: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // GET TEMPLATE DETAILS (fields/inputs)
    // ========================
    if (action === 'get_template') {
      const { template_token } = body

      if (!template_token) {
        return new Response(
          JSON.stringify({ success: false, error: 'template_token is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const response = await fetch(`${ZAPSIGN_API_URL}/templates/${template_token}/`, {
        headers: zapsignHeaders,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ZapSign get template error: ${response.status} - ${errorText}`)
      }

      const templateData = await response.json()
      console.log('ZapSign template details:', JSON.stringify(templateData))

      // Extract input fields (variables) from template
      const fields = (templateData.inputs || []).map((input: any) => ({
        variable: input.variable || '',
        label: input.label || '',
        required: input.required || false,
        input_type: input.input_type || 'input',
        order: input.order || 0,
      }))

      // Extract signer info
      const signerTemplate = templateData.signers?.[0]

      return new Response(
        JSON.stringify({ 
          success: true, 
          template: templateData,
          fields,
          signer_template: signerTemplate || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // CREATE DOCUMENT FROM TEMPLATE
    // ========================
    if (action === 'create_doc') {
      const { template_id, signer_name, signer_email, signer_phone, data: templateData, document_name, lead_id, contact_id, legal_case_id, created_by, send_via_whatsapp, whatsapp_phone } = body

      if (!template_id || !signer_name) {
        return new Response(
          JSON.stringify({ success: false, error: 'template_id and signer_name are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Build the request body for ZapSign
      const createBody: any = {
        template_id,
        signer_name,
        ...(signer_email && { signer_email }),
        ...(signer_phone && { signer_phone }),
      }

      // Add template data (de/para pairs) - ZapSign requires this field
      createBody.data = (templateData && Array.isArray(templateData) && templateData.length > 0) 
        ? templateData 
        : [{ de: '{{_}}', para: ' ' }]

      console.log('Creating ZapSign document:', JSON.stringify(createBody))

      const response = await fetch(`${ZAPSIGN_API_URL}/models/create-doc/`, {
        method: 'POST',
        headers: zapsignHeaders,
        body: JSON.stringify(createBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ZapSign create doc error: ${response.status} - ${errorText}`)
      }

      const docData = await response.json()
      console.log('ZapSign document created:', JSON.stringify(docData))

      // Extract signer info
      const signer = docData.signers?.[0]
      const signUrl = signer ? `https://app.zapsign.co/verificar/${signer.token}` : null

      // Save to database
      const { data: savedDoc, error: saveError } = await supabase
        .from('zapsign_documents')
        .insert({
          doc_token: docData.token,
          template_id,
          document_name: document_name || docData.name || 'Procuração',
          status: docData.status || 'pending',
          original_file_url: docData.original_file || null,
          sign_url: signUrl,
          signer_name,
          signer_token: signer?.token || null,
          signer_email: signer_email || signer?.email || null,
          signer_phone: signer_phone || signer?.phone_number || null,
          signer_status: signer?.status || 'new',
          template_data: templateData || [],
          lead_id: lead_id || null,
          contact_id: contact_id || null,
          legal_case_id: legal_case_id || null,
          created_by: created_by || null,
          sent_via_whatsapp: send_via_whatsapp || false,
          whatsapp_phone: whatsapp_phone || null,
        })
        .select()
        .single()

      if (saveError) {
        console.error('Error saving ZapSign document:', saveError)
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          document: docData, 
          sign_url: signUrl,
          saved_doc: savedDoc,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // GET DOCUMENT STATUS
    // ========================
    if (action === 'get_doc_status') {
      const { doc_token } = body

      if (!doc_token) {
        return new Response(
          JSON.stringify({ success: false, error: 'doc_token is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const response = await fetch(`${ZAPSIGN_API_URL}/docs/${doc_token}/`, {
        headers: zapsignHeaders,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ZapSign get doc error: ${response.status} - ${errorText}`)
      }

      const docData = await response.json()

      // Update local DB with latest status
      const signer = docData.signers?.[0]
      await supabase
        .from('zapsign_documents')
        .update({
          status: docData.status,
          signed_file_url: docData.signed_file || null,
          signer_status: signer?.status || null,
          signed_at: signer?.signed_at || null,
        })
        .eq('doc_token', doc_token)

      return new Response(
        JSON.stringify({ success: true, document: docData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================
    // EXTRACT DATA FROM CONVERSATION (AI)
    // ========================
    if (action === 'extract_data') {
      const { messages, template_fields, lead_data, contact_data, uploaded_documents } = body

      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
      if (!LOVABLE_API_KEY) {
        console.error('LOVABLE_API_KEY not configured')
        return new Response(
          JSON.stringify({ success: true, extracted_data: [], source: 'no_api_key' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Build multimodal content - include images from conversation and uploaded docs
      const imageUrls: string[] = []
      const textMessages: string[] = []
      
      for (const m of (messages || []).slice(-50)) {
        if (m.message_text) {
          textMessages.push(`[${m.direction}] ${m.message_text}`)
        }
        if (m.media_url && (m.media_type?.startsWith('image') || m.message_type === 'image')) {
          imageUrls.push(m.media_url)
        }
      }

      // Add uploaded documents (base64 data URLs)
      const uploadedImageUrls: string[] = []
      if (Array.isArray(uploaded_documents)) {
        for (const doc of uploaded_documents) {
          if (doc.dataUrl && (doc.type?.startsWith('image') || doc.type === 'application/pdf')) {
            uploadedImageUrls.push(doc.dataUrl)
          }
        }
      }

      // Build address from CRM data
      const contactAddr = contact_data || {}
      const leadAddr = lead_data || {}
      const fullAddress = [contactAddr.street, contactAddr.neighborhood, contactAddr.city, contactAddr.state].filter(Boolean).join(', ')
      const crmMappingHints = `
MAPEAMENTO DE DADOS DO CRM PARA CAMPOS COMUNS:
- Nome completo: "${contactAddr.full_name || leadAddr.lead_name || ''}"
- Telefone/WhatsApp: "${contactAddr.phone || leadAddr.phone || ''}"
- Email: "${contactAddr.email || leadAddr.email || ''}"
- Endereço completo: "${fullAddress}"
- Rua: "${contactAddr.street || ''}"
- Bairro: "${contactAddr.neighborhood || ''}"
- Cidade: "${contactAddr.city || ''}"
- Estado/UF: "${contactAddr.state || ''}"
- CEP: "${contactAddr.cep || ''}"
- Profissão: "${contactAddr.profession || ''}"
- CPF: "${leadAddr.cpf || contactAddr.cpf || ''}"
`

      const prompt = `Você é um assistente jurídico especializado em extrair dados para preencher documentos. Analise TODAS as fontes disponíveis: dados do CRM, conversa do WhatsApp e IMAGENS de documentos.

CAMPOS DO TEMPLATE A PREENCHER:
${JSON.stringify(template_fields || [], null, 2)}

${crmMappingHints}

DADOS COMPLETOS DO CRM:
Lead: ${JSON.stringify(lead_data || {}, null, 2)}
Contato: ${JSON.stringify(contact_data || {}, null, 2)}

CONVERSA DO WHATSAPP (últimas mensagens):
${textMessages.join('\n')}

INSTRUÇÕES CRÍTICAS:
1. Analise TODAS as imagens anexadas minuciosamente. Elas podem conter RG, CPF, comprovante de endereço, procurações, certidões, etc.
2. Para campos como NACIONALIDADE: se a pessoa tem CPF brasileiro ou o documento é brasileiro, use "brasileiro(a)".
3. Para ESTADO_CIVIL: procure essa informação nas imagens de documentos (RG, certidões) ou na conversa. Valores comuns: solteiro(a), casado(a), divorciado(a), viúvo(a), união estável.
4. Para ENDERECO_COMPLETO: combine rua + número + bairro + cidade + estado dos dados do CRM ou documentos.
5. Para WHATSAPP: use o telefone do contato/lead.
6. Use os dados do CRM como base, complementando com dados da conversa e das imagens.
7. Formate datas no padrão DD/MM/AAAA.
8. Se não encontrar um dado, deixe "para" como string vazia "".
9. Retorne TODOS os campos do template, mesmo os vazios.

Retorne um JSON no formato:
[{"de": "{{CAMPO}}", "para": "valor extraído"}]

Responda APENAS o JSON, sem markdown.`

      // Build multimodal user content
      const userContent: any[] = [{ type: 'text', text: prompt }]
      
      // Add uploaded documents first (higher priority)
      for (const docUrl of uploadedImageUrls.slice(0, 5)) {
        userContent.push({
          type: 'image_url',
          image_url: { url: docUrl }
        })
      }

      // Add conversation images (remaining slots)
      const remainingSlots = Math.max(0, 5 - uploadedImageUrls.length)
      for (const imgUrl of imageUrls.slice(-remainingSlots)) {
        userContent.push({
          type: 'image_url',
          image_url: { url: imgUrl }
        })
      }

      const totalImages = Math.min(uploadedImageUrls.length, 5) + Math.min(imageUrls.length, remainingSlots)
      console.log(`Extracting data with ${totalImages} images (${uploadedImageUrls.length} uploaded, ${imageUrls.length} from chat) and ${textMessages.length} text messages`)

      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-pro',
            messages: [
              { role: 'system', content: 'Você é um assistente especializado em extrair dados de conversas, imagens e documentos para preencher documentos jurídicos. Analise cuidadosamente TODAS as imagens enviadas, incluindo documentos de identidade, comprovantes e certidões. Extraia nacionalidade, estado civil, endereço e todos os dados visíveis. Responda apenas JSON válido.' },
              { role: 'user', content: userContent }
            ],
          }),
        })

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text()
          console.error('Lovable AI error:', aiResponse.status, errorText)
          return new Response(
            JSON.stringify({ success: true, extracted_data: [], source: 'ai_error' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const aiData = await aiResponse.json()
        const responseText = aiData.choices?.[0]?.message?.content || '[]'
        
        let extractedData = []
        try {
          extractedData = JSON.parse(responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
        } catch {
          console.error('Failed to parse AI response:', responseText)
        }

        return new Response(
          JSON.stringify({ success: true, extracted_data: extractedData }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (aiErr) {
        console.error('AI extraction error:', aiErr)
        return new Response(
          JSON.stringify({ success: true, extracted_data: [], source: 'ai_exception' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('ZapSign API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
