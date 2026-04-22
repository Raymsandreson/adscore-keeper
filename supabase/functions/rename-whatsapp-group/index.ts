import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ContactToAdd {
  contact_id?: string;
  phone: string;
  mark_as_client?: boolean;
}

const normalizePhone = (raw: string | null | undefined): string => {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(resolveSupabaseUrl(), resolveServiceRoleKey())
    const body = await req.json().catch(() => ({}))
    const { lead_id, contacts_to_add } = body as { lead_id?: string; contacts_to_add?: ContactToAdd[] }

    if (!lead_id) {
      return new Response(JSON.stringify({ success: false, error: 'lead_id required' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get lead data
    const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle()
    if (!lead) {
      return new Response(JSON.stringify({ success: false, error: 'Lead not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const groupJid = lead.whatsapp_group_id
    if (!groupJid) {
      return new Response(JSON.stringify({ success: false, error: 'Lead has no WhatsApp group' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!lead.board_id) {
      return new Response(JSON.stringify({ success: false, error: 'Lead has no board' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get board group settings
    const { data: settings } = await supabase
      .from('board_group_settings')
      .select('closed_group_name_prefix, group_name_prefix, lead_fields, closed_sequence_start, closed_current_sequence')
      .eq('board_id', lead.board_id)
      .maybeSingle()

    if (!settings?.closed_group_name_prefix) {
      return new Response(JSON.stringify({ success: false, error: 'No closed prefix configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const closedSeq = Math.max(
      (settings.closed_current_sequence || 0) + 1,
      settings.closed_sequence_start || 1
    )

    // Find a connected instance to operate on the group
    const { data: boardInstances } = await supabase
      .from('board_group_instances')
      .select('instance_id, applies_to')
      .eq('board_id', lead.board_id)

    let instance: any = null
    if (boardInstances?.length) {
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .in('id', boardInstances.map((b: any) => b.instance_id))
        .eq('is_active', true)
        .eq('connection_status', 'connected')
        .limit(1)
      instance = instances?.[0]
    }

    if (!instance) {
      const { data: anyInstance } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .eq('connection_status', 'connected')
        .limit(1)
      instance = anyInstance?.[0]
    }

    if (!instance?.instance_token) {
      return new Response(JSON.stringify({ success: false, error: 'No connected instance available' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const fullJid = groupJid.includes('@g.us') ? groupJid : `${groupJid}@g.us`
    const executorPhone = normalizePhone(instance.owner_phone || instance.phone || '')

    // Fetch current group info (name + participants)
    let currentName = ''
    let currentParticipants: string[] = []
    try {
      const infoRes = await fetch(`${baseUrl}/group/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token: instance.instance_token },
        body: JSON.stringify({ groupjid: fullJid }),
      })
      if (infoRes.ok) {
        const info = await infoRes.json()
        currentName = info?.subject || info?.name || info?.data?.subject || ''
        const partsRaw = info?.participants || info?.data?.participants || []
        currentParticipants = partsRaw
          .map((p: any) => normalizePhone(typeof p === 'string' ? p : (p?.id || p?.jid || p?.phone || '')))
          .filter(Boolean)
      }
    } catch (e) {
      console.warn('Could not fetch group info:', e)
    }

    // Build new name
    const closedPrefix = settings.closed_group_name_prefix
    const leadFields = settings.lead_fields || ['lead_name']
    const parts: string[] = []
    if (closedPrefix) parts.push(closedPrefix)
    parts.push(String(closedSeq).padStart(4, '0'))
    for (const field of leadFields) {
      if (lead[field]) parts.push(String(lead[field]))
    }
    let newName = parts.join(' ')
    if (newName.length > 100) newName = newName.slice(0, 100).trim()

    console.log(`Renaming group from "${currentName}" to "${newName}"`)

    // Rename group
    let renamed = false
    try {
      const renameRes = await fetch(`${baseUrl}/group/updateSubject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token: instance.instance_token },
        body: JSON.stringify({ groupjid: fullJid, subject: newName }),
      })
      if (renameRes.ok) renamed = true
      else {
        const renameRes2 = await fetch(`${baseUrl}/group/subject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: instance.instance_token },
          body: JSON.stringify({ groupjid: fullJid, subject: newName }),
        })
        if (renameRes2.ok) renamed = true
      }
    } catch (e) {
      console.error('Rename error:', e)
    }

    // ---- Sync instance participants based on applies_to ----
    const sync = { added: [] as string[], removed: [] as string[], skipped: [] as string[] }

    if (boardInstances?.length) {
      // Resolve all instance phones
      const { data: allInstances } = await supabase
        .from('whatsapp_instances')
        .select('id, owner_phone, phone, instance_name')
        .in('id', boardInstances.map((b: any) => b.instance_id))

      const phoneByInstance = new Map<string, string>()
      ;(allInstances || []).forEach((i: any) => {
        const p = normalizePhone(i.owner_phone || i.phone || '')
        if (p) phoneByInstance.set(i.id, p)
      })

      const shouldStay = new Set<string>()
      const shouldLeave = new Set<string>()
      for (const bi of boardInstances as any[]) {
        const p = phoneByInstance.get(bi.instance_id)
        if (!p) continue
        const applies = bi.applies_to || 'both'
        if (applies === 'both' || applies === 'closed') shouldStay.add(p)
        else if (applies === 'open') shouldLeave.add(p)
      }

      // Add missing closed-instances
      for (const phone of shouldStay) {
        const isPresent = currentParticipants.some(cp => cp.endsWith(phone) || phone.endsWith(cp))
        if (!isPresent) {
          try {
            const r = await fetch(`${baseUrl}/group/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token: instance.instance_token },
              body: JSON.stringify({ groupjid: fullJid, action: 'add', participants: [`${phone}@s.whatsapp.net`] }),
            })
            if (r.ok) sync.added.push(phone)
            else sync.skipped.push(`add:${phone}`)
          } catch (e) {
            console.warn('Add instance failed', phone, e)
            sync.skipped.push(`add:${phone}`)
          }
        }
      }

      // Remove open-only instances (executor last)
      const removeList = [...shouldLeave].sort((a, b) => {
        if (a === executorPhone) return 1
        if (b === executorPhone) return -1
        return 0
      })
      for (const phone of removeList) {
        const isPresent = currentParticipants.some(cp => cp.endsWith(phone) || phone.endsWith(cp))
        if (isPresent) {
          try {
            const r = await fetch(`${baseUrl}/group/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token: instance.instance_token },
              body: JSON.stringify({ groupjid: fullJid, action: 'remove', participants: [`${phone}@s.whatsapp.net`] }),
            })
            if (r.ok) sync.removed.push(phone)
            else sync.skipped.push(`remove:${phone}`)
          } catch (e) {
            console.warn('Remove instance failed', phone, e)
            sync.skipped.push(`remove:${phone}`)
          }
        }
      }
    }

    // ---- Add lead contacts and mark as client ----
    const contactsResult = { added: [] as string[], marked_as_client: [] as string[], skipped: [] as string[] }
    if (Array.isArray(contacts_to_add) && contacts_to_add.length > 0) {
      for (const c of contacts_to_add) {
        const phone = normalizePhone(c.phone)
        if (!phone) {
          contactsResult.skipped.push(`empty:${c.contact_id || ''}`)
          continue
        }
        const isPresent = currentParticipants.some(cp => cp.endsWith(phone) || phone.endsWith(cp))
        if (!isPresent) {
          try {
            const r = await fetch(`${baseUrl}/group/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token: instance.instance_token },
              body: JSON.stringify({ groupjid: fullJid, action: 'add', participants: [`${phone}@s.whatsapp.net`] }),
            })
            if (r.ok) contactsResult.added.push(phone)
            else contactsResult.skipped.push(`add:${phone}`)
          } catch (e) {
            console.warn('Add contact failed', phone, e)
            contactsResult.skipped.push(`add:${phone}`)
          }
        }
        if (c.mark_as_client && c.contact_id) {
          try {
            await supabase
              .from('contacts')
              .update({ classification: 'client', updated_at: new Date().toISOString() })
              .eq('id', c.contact_id)
            contactsResult.marked_as_client.push(c.contact_id)
          } catch (e) {
            console.warn('Mark as client failed', c.contact_id, e)
          }
        }
      }
    }

    // Persist sequence + group name
    if (renamed) {
      await supabase
        .from('board_group_settings')
        .update({ closed_current_sequence: closedSeq })
        .eq('board_id', lead.board_id)

      await supabase
        .from('whatsapp_group_links')
        .update({ group_name: newName })
        .eq('group_jid', fullJid)
        .catch(() => {})
    }

    return new Response(JSON.stringify({
      success: renamed,
      old_name: currentName,
      new_name: newName,
      sync,
      contacts: contactsResult,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('rename-whatsapp-group error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
