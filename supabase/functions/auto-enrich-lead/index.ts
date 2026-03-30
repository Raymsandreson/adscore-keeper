import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from '../_shared/gemini.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_INBOUND_THRESHOLD = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { phone, instance_name, lead_id, contact_id } = await req.json()

    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: 'phone and instance_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[auto-enrich] phone=${phone} instance=${instance_name} lead=${lead_id} contact=${contact_id}`)

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

    // Check if we already enriched recently (within 2 hours)
    const phoneSuffix = phone.replace(/\D/g, '').slice(-8)
    
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

    // Fetch conversation messages
    const { data: messages } = await supabase
      .from('whatsapp_messages')
      .select('direction, message_text, created_at')
      .eq('instance_name', instance_name)
      .ilike('phone', `%${phoneSuffix}`)
      .order('created_at', { ascending: true })
      .limit(100)

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no_messages' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build conversation text
    const conversationText = messages
      .map((m: any) => {
        const dir = m.direction === 'outbound' ? 'Atendente' : 'Cliente'
        return `[${dir}]: ${m.message_text || ''}`
      })
      .join('\n')

    // Extract data using AI
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
  "lead_status": "status do lead baseado na conversa: 'active' (em andamento/interessado), 'closed' (fechou contrato/assinou), 'refused' (cliente recusou/desistiu), 'unviable' (caso inviável juridicamente). Use null se não for possível determinar.",
  "lead_status_reason": "motivo resumido em 1-2 frases para o status identificado. Ex: 'Prazo prescricional expirado', 'Cliente não quis prosseguir por questões financeiras', 'Contrato assinado com sucesso'. Use null se status for null ou active."
}

REGRAS:
- Extraia APENAS informações explícitas na conversa
- Use null para campos não encontrados
- Para lead_status: analise se o cliente demonstrou desinteresse (refused), se o caso foi considerado inviável pelo atendente (unviable), se houve fechamento/assinatura (closed), ou se ainda está em negociação (active)
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
      if (cleaned.lead_status && ['closed', 'refused', 'unviable'].includes(cleaned.lead_status)) {
        const { data: currentLead } = await supabase
          .from('leads')
          .select('lead_status, became_client_date, classification_date, inviavel_date')
          .eq('id', lead_id)
          .single()

        const currentStatus = currentLead?.became_client_date ? 'closed' 
          : currentLead?.inviavel_date ? 'unviable' 
          : currentLead?.classification_date ? 'refused' 
          : 'active'

        // Only update if currently active (don't override manual decisions)
        if (currentStatus === 'active') {
          const statusMap: Record<string, string> = {
            'closed': 'became_client_date',
            'refused': 'classification_date',
            'unviable': 'inviavel_date',
          }
          const dateField = statusMap[cleaned.lead_status]
          const today = new Date().toISOString().slice(0, 10)
          const statusUpdate: Record<string, any> = {
            lead_status: cleaned.lead_status === 'unviable' ? 'unviable' : cleaned.lead_status,
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
            
            // Log status history
            await supabase.from('lead_status_history').insert({
              lead_id,
              from_status: 'active',
              to_status: cleaned.lead_status === 'unviable' ? 'inviavel' : cleaned.lead_status,
              reason: cleaned.lead_status_reason || 'Detectado automaticamente pela IA',
              changed_by: null,
              changed_by_type: 'ai',
            })
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

    // Log the enrichment
    await supabase.from('lead_enrichment_log').insert({
      phone,
      instance_name,
      lead_id: lead_id || null,
      contact_id: contact_id || null,
      fields_updated: cleaned,
    })

    console.log(`[auto-enrich] Enrichment complete for phone=${phone}`)

    return new Response(JSON.stringify({ ok: true, enriched: cleaned }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[auto-enrich] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
