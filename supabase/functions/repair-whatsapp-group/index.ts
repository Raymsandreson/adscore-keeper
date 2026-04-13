import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const INTERNAL_SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const INTERNAL_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) return digits
  if (digits.length >= 10 && digits.length <= 11) return '55' + digits
  return digits
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const internalClient = createClient(INTERNAL_SUPABASE_URL, INTERNAL_SERVICE_ROLE_KEY)
    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY)
    const body = await req.json()
    const { lead_id, group_jid, participants, instance_id, forward_docs, action } = body

    if (!group_jid) {
      return new Response(JSON.stringify({ error: 'group_jid is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get instance
    let instance: any = null
    if (instance_id) {
      const { data } = await internalClient.from('whatsapp_instances').select('*').eq('id', instance_id).eq('is_active', true).single()
      instance = data
    }
    if (!instance) {
      const { data } = await internalClient.from('whatsapp_instances').select('*').eq('is_active', true).order('created_at').limit(1).single()
      instance = data
    }
    if (!instance) throw new Error('No active instance found')

    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const token = instance.instance_token
    const fullJid = group_jid.includes('@g.us') ? group_jid : `${group_jid}@g.us`

    const results: string[] = []

    // ACTION: add_instances - add board-linked instances to the group
    if (action === 'add_instances') {
      const { board_id } = body
      if (!board_id) throw new Error('board_id required for add_instances')

      // Get board-linked instances
      const { data: bgi } = await supabase
        .from('board_group_instances')
        .select('instance_id, role_title')
        .eq('board_id', board_id)

      if (!bgi?.length) {
        return new Response(JSON.stringify({ success: true, message: 'Nenhuma instância vinculada ao funil.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const instanceIds = bgi.map((b: any) => b.instance_id)
      const { data: instances } = await internalClient
        .from('whatsapp_instances')
        .select('id, owner_phone, instance_name')
        .in('id', instanceIds)
        .eq('is_active', true)

      if (!instances?.length) {
        return new Response(JSON.stringify({ success: true, message: 'Nenhuma instância ativa encontrada.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const phonesToAdd: string[] = []
      for (const inst of instances) {
        if (inst.id === instance_id) continue // skip current user's instance
        if (!inst.owner_phone) continue
        const p = normalizePhone(inst.owner_phone)
        if (p && p.length >= 10) phonesToAdd.push(p)
      }

      console.log(`[add_instances] Adding ${phonesToAdd.length} instance phones to group ${fullJid}`)

      for (const phone of phonesToAdd) {
        await sleep(1500)
        try {
          const jid = `${phone}@s.whatsapp.net`
          const r = await fetch(`${baseUrl}/group/updateParticipants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify({ groupjid: fullJid, action: 'add', participants: [jid] }),
          })
          if (r.ok) {
            results.push(`✅ Adicionado: ${phone}`)
            // Promote as admin
            await sleep(500)
            await fetch(`${baseUrl}/group/updateParticipants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token },
              body: JSON.stringify({ groupjid: fullJid, action: 'promote', participants: [jid] }),
            })
          } else {
            results.push(`⚠️ Falha ao adicionar: ${phone}`)
          }
        } catch (e) {
          results.push(`❌ Erro: ${phone}`)
        }
      }

      return new Response(JSON.stringify({ success: true, added: phonesToAdd.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ACTION: resend_signed_docs - resend signed procuração/documents
    if (action === 'resend_signed_docs') {
      if (!lead_id) throw new Error('lead_id required for resend_signed_docs')
      console.log('[resend_signed_docs] Searching for signed documents for lead:', lead_id)

      const { data: lead } = await supabase.from('leads').select('lead_phone, lead_name').eq('id', lead_id).single()
      const phone = lead?.lead_phone?.replace(/\D/g, '') || ''

      // Search for signed documents in ZapSign
      const { data: zapsignDocs } = await supabase
        .from('lead_documents')
        .select('*')
        .eq('lead_id', lead_id)
        .or('status.eq.signed,status.ilike.%assinado%')
        .order('created_at', { ascending: false })
        .limit(10)

      let docsForwarded = 0

      // Forward ZapSign docs
      if (zapsignDocs?.length) {
        for (const doc of zapsignDocs) {
          if (!doc.signed_file_url && !doc.file_url) continue
          await sleep(1500)
          try {
            const payload: any = {
              phone: fullJid,
              isGroup: true,
              document: { url: doc.signed_file_url || doc.file_url },
              fileName: doc.document_name || 'Procuração Assinada.pdf',
            }
            const sendRes = await fetch(`${baseUrl}/message/sendMedia`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token },
              body: JSON.stringify(payload),
            })
            if (sendRes.ok) {
              docsForwarded++
              results.push(`✅ Enviado: ${doc.document_name || 'Documento'}`)
            } else {
              results.push(`⚠️ Falha: ${doc.document_name || 'Documento'}`)
            }
          } catch (e) {
            results.push(`❌ Erro ao enviar documento`)
          }
        }
      }

      // Also search in WhatsApp messages for signed docs
      if (phone) {
        const { data: mediaMessages } = await supabase
          .from('whatsapp_messages')
          .select('message_text, media_url, media_type, file_name')
          .or(`phone.eq.${phone},phone.ilike.%${phone.slice(-8)}%`)
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50)

        const signedDocs = (mediaMessages || []).filter(m =>
          m.media_url && (
            m.file_name?.toLowerCase().includes('assinado') ||
            m.file_name?.toLowerCase().includes('procura') ||
            m.file_name?.toLowerCase().includes('signed')
          )
        ).slice(0, 5)

        for (const doc of signedDocs) {
          await sleep(1500)
          try {
            const payload: any = {
              phone: fullJid,
              isGroup: true,
              document: { url: doc.media_url },
              fileName: doc.file_name || 'documento_assinado.pdf',
            }
            const sendRes = await fetch(`${baseUrl}/message/sendMedia`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token },
              body: JSON.stringify(payload),
            })
            if (sendRes.ok) {
              docsForwarded++
              results.push(`✅ Enviado: ${doc.file_name || 'Documento WhatsApp'}`)
            }
          } catch (e) {
            console.warn('[resend_signed_docs] Error:', e)
          }
        }
      }

      return new Response(JSON.stringify({ success: true, docs_forwarded: docsForwarded, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ACTION: resend_initial_message - resend the board's initial message template
    if (action === 'resend_initial_message') {
      const { board_id } = body
      if (!board_id || !lead_id) throw new Error('board_id and lead_id required')

      // Get board settings
      const { data: settings } = await supabase
        .from('board_group_settings')
        .select('initial_message_template, use_ai_message, ai_generated_message, lead_fields')
        .eq('board_id', board_id)
        .single()

      if (!settings) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhum modelo de mensagem configurado para este funil.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Get lead data
      const { data: leadData } = await supabase.from('leads').select('*').eq('id', lead_id).single()
      if (!leadData) throw new Error('Lead not found')

      let messageText = ''

      if (settings.use_ai_message && settings.ai_generated_message) {
        // Use AI-generated template with real data substitution
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
        if (LOVABLE_API_KEY) {
          const leadInfo = Object.entries(leadData)
            .filter(([k, v]) => v && !['id', 'created_at', 'updated_at', 'created_by', 'assigned_to'].includes(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')

          const aiPrompt = `Você receberá um MODELO de mensagem e dados reais de um lead. Substitua os dados genéricos pelos dados reais.

MODELO:
${settings.ai_generated_message}

DADOS REAIS:
${leadInfo}

REGRAS:
1. Mantenha a MESMA estrutura e formatação do modelo original.
2. Substitua TODOS os dados fictícios pelos dados reais correspondentes.
3. Se um dado real não estiver disponível, OMITA a linha inteira.
4. Retorne APENAS a mensagem final.`

          try {
            const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LOVABLE_API_KEY}` },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [{ role: 'user', content: aiPrompt }],
                max_tokens: 4096,
              }),
            })
            const aiData = await aiRes.json()
            messageText = aiData?.choices?.[0]?.message?.content || ''
          } catch (e) {
            console.error('[resend_initial_message] AI error:', e)
          }
        }
      } else if (settings.initial_message_template) {
        messageText = settings.initial_message_template
        const replacements: Record<string, string> = {
          '{lead_name}': leadData.lead_name || '',
          '{victim_name}': leadData.victim_name || '',
          '{case_type}': leadData.case_type || '',
          '{city}': leadData.city || '',
          '{state}': leadData.state || '',
          '{case_number}': leadData.case_number || '',
          '{source}': leadData.source || '',
          '{main_company}': leadData.main_company || '',
          '{neighborhood}': leadData.neighborhood || '',
        }
        for (const [key, value] of Object.entries(replacements)) {
          messageText = messageText.replaceAll(key, value)
        }
      }

      if (!messageText) {
        return new Response(JSON.stringify({ success: false, error: 'Nenhum modelo de mensagem configurado ou erro ao gerar.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Send to group
      const sendRes = await fetch(`${baseUrl}/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ number: fullJid, text: messageText }),
      })

      if (sendRes.ok) {
        return new Response(JSON.stringify({ success: true, message: 'Mensagem inicial reenviada com sucesso!' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } else {
        const errText = await sendRes.text()
        throw new Error(`Falha ao enviar: ${errText}`)
      }
    }

    // DEFAULT ACTION: repair (add participants)
    if (!participants?.length) {
      return new Response(JSON.stringify({ error: 'participants required for repair' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[repair] Adding ${participants.length} participants to group ${fullJid}`)

    const bulkRes = await fetch(`${baseUrl}/group/updateParticipants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ groupjid: fullJid, action: 'add', participants }),
    })

    if (bulkRes.ok) {
      console.log('[repair] Bulk add succeeded')
    } else {
      const err = await bulkRes.text()
      console.warn('[repair] Bulk add failed:', err, '- trying one by one')
      for (const p of participants) {
        await sleep(2000)
        try {
          const r = await fetch(`${baseUrl}/group/updateParticipants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify({ groupjid: fullJid, action: 'add', participants: [p] }),
          })
          if (r.ok) console.log(`[repair] Added ${p}`)
          else console.warn(`[repair] Failed to add ${p}:`, await r.text())
        } catch (e) {
          console.warn(`[repair] Error adding ${p}:`, e)
        }
      }
    }

    // Promote all as admin
    await sleep(2000)
    try {
      await fetch(`${baseUrl}/group/updateParticipants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ groupjid: fullJid, action: 'promote', participants }),
      })
    } catch (e) {
      console.warn('[repair] Promote error:', e)
    }

    // Forward documents if requested
    if (forward_docs && lead_id) {
      const { data: lead } = await supabase.from('leads').select('lead_phone, lead_name').eq('id', lead_id).single()
      const phone = lead?.lead_phone?.replace(/\D/g, '') || ''
      const { data: mediaMessages } = await supabase
        .from('whatsapp_messages')
        .select('message_text, media_url, media_type, file_name, direction')
        .or(`phone.eq.${phone},phone.ilike.%${phone.slice(-8)}%`)
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50)

      const docsToForward = (mediaMessages || []).filter(m =>
        m.media_url && (
          m.file_name?.toLowerCase().includes('assinado') ||
          m.file_name?.toLowerCase().includes('documento') ||
          m.media_type?.includes('pdf') ||
          m.media_type?.includes('image')
        )
      ).slice(0, 10)

      for (const doc of docsToForward) {
        await sleep(1500)
        try {
          const payload: any = { phone: fullJid, isGroup: true }
          if (doc.media_type?.includes('pdf') || doc.media_type?.includes('document')) {
            payload.document = { url: doc.media_url }
            payload.fileName = doc.file_name || 'documento.pdf'
          } else if (doc.media_type?.includes('image')) {
            payload.image = { url: doc.media_url }
            if (doc.message_text) payload.caption = doc.message_text
          } else {
            payload.document = { url: doc.media_url }
            payload.fileName = doc.file_name || 'arquivo'
          }
          await fetch(`${baseUrl}/message/sendMedia`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify(payload),
          })
        } catch (e) {
          console.warn(`[repair] Error forwarding doc:`, e)
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('[repair] Error:', error)
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
