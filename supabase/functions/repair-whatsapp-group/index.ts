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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const internalClient = createClient(INTERNAL_SUPABASE_URL, INTERNAL_SERVICE_ROLE_KEY)
    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY)
    const { lead_id, group_jid, participants, instance_id, forward_docs } = await req.json()

    if (!group_jid || !participants?.length) {
      return new Response(JSON.stringify({ error: 'group_jid and participants required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get instance
    let instance: any = null
    if (instance_id) {
      const { data } = await supabase.from('whatsapp_instances').select('*').eq('id', instance_id).eq('is_active', true).single()
      instance = data
    }
    if (!instance) {
      const { data } = await supabase.from('whatsapp_instances').select('*').eq('is_active', true).order('created_at').limit(1).single()
      instance = data
    }
    if (!instance) throw new Error('No active instance found')

    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const token = instance.instance_token
    const fullJid = group_jid.includes('@g.us') ? group_jid : `${group_jid}@g.us`

    console.log(`[repair] Adding ${participants.length} participants to group ${fullJid}`)

    // Add participants - try bulk first
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
          if (r.ok) {
            console.log(`[repair] Added ${p}`)
          } else {
            console.warn(`[repair] Failed to add ${p}:`, await r.text())
          }
        } catch (e) {
          console.warn(`[repair] Error adding ${p}:`, e)
        }
      }
    }

    // Promote all as admin
    await sleep(2000)
    console.log(`[repair] Promoting participants as admin`)
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
      console.log('[repair] Forwarding documents to group')
      
      // Get lead data
      const { data: lead } = await supabase.from('leads').select('lead_phone, lead_name').eq('id', lead_id).single()
      const phone = lead?.lead_phone?.replace(/\D/g, '') || ''
      
      // Find signed documents and media from WhatsApp messages
      const { data: mediaMessages } = await supabase
        .from('whatsapp_messages')
        .select('message_text, media_url, media_type, file_name, direction')
        .or(`phone.eq.${phone},phone.ilike.%${phone.slice(-8)}%`)
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50)
      
      if (mediaMessages?.length) {
        console.log(`[repair] Found ${mediaMessages.length} media messages to forward`)
        
        // Forward documents (signed docs, images, etc)
        const docsToForward = mediaMessages.filter(m => 
          m.media_url && (
            m.file_name?.toLowerCase().includes('assinado') ||
            m.file_name?.toLowerCase().includes('documento') ||
            m.media_type?.includes('pdf') ||
            m.media_type?.includes('image')
          )
        ).slice(0, 10) // limit to 10 most recent

        for (const doc of docsToForward) {
          await sleep(1500)
          try {
            const payload: any = {
              phone: fullJid,
              isGroup: true,
            }
            
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

            const sendRes = await fetch(`${baseUrl}/message/sendMedia`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token },
              body: JSON.stringify(payload),
            })
            
            if (sendRes.ok) {
              console.log(`[repair] Forwarded: ${doc.file_name || doc.media_type}`)
            } else {
              console.warn(`[repair] Failed to forward doc:`, await sendRes.text())
            }
          } catch (e) {
            console.warn(`[repair] Error forwarding doc:`, e)
          }
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
