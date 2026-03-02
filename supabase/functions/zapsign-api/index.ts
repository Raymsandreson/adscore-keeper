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

      // Add template data (de/para pairs)
      if (templateData && Array.isArray(templateData) && templateData.length > 0) {
        createBody.data = templateData
      }

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
      const { messages, template_fields, lead_data, contact_data } = body

      // Use Gemini to extract data from conversation
      const prompt = `Você é um assistente jurídico. Analise a conversa de WhatsApp abaixo e extraia os dados necessários para preencher uma procuração.

CAMPOS DO TEMPLATE A PREENCHER:
${JSON.stringify(template_fields || [], null, 2)}

DADOS JÁ DISPONÍVEIS NO CRM:
Lead: ${JSON.stringify(lead_data || {}, null, 2)}
Contato: ${JSON.stringify(contact_data || {}, null, 2)}

CONVERSA DO WHATSAPP (últimas mensagens):
${(messages || []).slice(-50).map((m: any) => `[${m.direction}] ${m.message_text || ''}`).join('\n')}

Retorne um JSON com os campos preenchidos no formato:
[{"de": "{{CAMPO}}", "para": "valor extraído"}]

Use os dados do CRM como prioridade, complementando com dados da conversa. Formate datas no padrão DD/MM/AAAA. Se não encontrar um dado, deixe vazio.
Responda APENAS o JSON, sem markdown.`

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': Deno.env.get('GEMINI_API_KEY') || '',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      )

      if (!geminiResponse.ok) {
        // Fallback: just use CRM data
        console.error('Gemini API error, falling back to CRM data')
        return new Response(
          JSON.stringify({ success: true, extracted_data: [], source: 'crm_only' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const geminiData = await geminiResponse.json()
      const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
      
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
