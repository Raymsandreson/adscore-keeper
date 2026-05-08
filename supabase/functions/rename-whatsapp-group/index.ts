import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
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
      .select('closed_group_name_prefix, group_name_prefix, lead_fields')
      .eq('board_id', lead.board_id)
      .maybeSingle()

    if (!settings) {
      return new Response(JSON.stringify({ success: false, error: 'No board_group_settings configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Posição determinística por board via SQL (RPC). Resolve em uma única query
    // no Postgres — sem o limite de 1000 linhas do PostgREST que falhava em boards grandes.
    let closedSeq = 1
    {
      const { data: posData, error: posErr } = await supabase
        .rpc('get_lead_closed_position', { p_lead_id: lead.id, p_board_id: lead.board_id })
      if (posErr) {
        console.error('[rename] get_lead_closed_position error:', posErr)
      } else if (typeof posData === 'number') {
        closedSeq = posData
      }
      console.log(`[rename] closedSeq=${closedSeq} for lead ${lead.id} board ${lead.board_id}`)
    }

    // Find a connected instance to operate on the group.
    // We collect all candidates marked as connected and probe each one with a real
    // /group/info call — UazAPI's /status endpoint can lie (returns "checked_instance"
    // from any instance the server health-checked last), so DB connection_status alone
    // isn't trustworthy. We pick the first instance that answers /group/info successfully.
    const fullJid = groupJid.includes('@g.us') ? groupJid : `${groupJid}@g.us`

    const { data: boardInstances } = await supabase
      .from('board_group_instances')
      .select('instance_id, applies_to')
      .eq('board_id', lead.board_id)

    const candidates: any[] = []
    if (boardInstances?.length) {
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .in('id', boardInstances.map((b: any) => b.instance_id))
        .eq('is_active', true)
        .eq('connection_status', 'connected')
      if (instances) candidates.push(...instances)
    }
    {
      const excludeIds = candidates.map((c: any) => c.id)
      let q = supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .eq('connection_status', 'connected')
      if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`)
      const { data: anyInstances } = await q
      if (anyInstances) candidates.push(...anyInstances)
    }

    if (!candidates.length) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma instância conectada disponível. Reconecte uma instância do WhatsApp.' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let instance: any = null
    let baseUrl = ''
    let currentName = ''
    let currentParticipants: string[] = []
    const probeFailures: string[] = []

    for (const cand of candidates) {
      const candBase = cand.base_url || 'https://abraci.uazapi.com'
      try {
        const infoRes = await fetch(`${candBase}/group/info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: cand.instance_token },
          body: JSON.stringify({ groupjid: fullJid }),
        })
        if (!infoRes.ok) {
          const txt = await infoRes.text().catch(() => '')
          probeFailures.push(`${cand.instance_name}: ${infoRes.status}`)
          console.warn(`[rename] probe failed on "${cand.instance_name}": ${infoRes.status} ${txt.slice(0, 160)}`)
          if (txt.includes('not reconnectable') || txt.includes('disconnected')) {
            await supabase
              .from('whatsapp_instances')
              .update({ connection_status: 'disconnected' })
              .eq('id', cand.id)
          }
          continue
        }
        const info = await infoRes.json()
        instance = cand
        baseUrl = candBase
        currentName = info?.subject || info?.name || info?.data?.subject || ''
        const partsRaw = info?.participants || info?.data?.participants || []
        currentParticipants = partsRaw
          .map((p: any) => normalizePhone(typeof p === 'string' ? p : (p?.id || p?.jid || p?.phone || '')))
          .filter(Boolean)
        console.log(`[rename] Using instance "${cand.instance_name}" (probed OK)`)
        break
      } catch (e: any) {
        probeFailures.push(`${cand.instance_name}: ${e?.message || 'fetch error'}`)
      }
    }

    if (!instance) {
      return new Response(JSON.stringify({
        success: false,
        error: `Nenhuma instância respondeu. Reconecte o WhatsApp. Detalhes: ${probeFailures.join(' | ')}`,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const executorPhone = normalizePhone(instance.owner_phone || instance.phone || '')

    // Build new name
    const closedPrefix = settings.group_name_prefix || ''
    const leadFields = settings.lead_fields || ['lead_name']
    const { data: board } = await supabase
      .from('kanban_boards')
      .select('name')
      .eq('id', lead.board_id)
      .maybeSingle()
    const parts: string[] = []
    if (closedPrefix) parts.push(closedPrefix)
    const seqStr = String(closedSeq)
    const hasSeqToken = leadFields.includes('closed_seq') || leadFields.includes('case_number')
    if (!hasSeqToken) parts.push(seqStr)

    // Pré-carrega valores de campos personalizados (tokens cf:<id>)
    const cfIds: string[] = (leadFields as string[])
      .filter((f) => typeof f === 'string' && f.startsWith('cf:'))
      .map((f) => f.slice(3))
    const cfValuesById: Record<string, string> = {}
    if (cfIds.length > 0) {
      const { data: cfVals } = await supabase
        .from('lead_custom_field_values')
        .select('field_id, value_text, value_number, value_date, value_boolean')
        .eq('lead_id', lead.id)
        .in('field_id', cfIds)
      for (const v of (cfVals || []) as any[]) {
        const raw =
          v.value_text ??
          (v.value_number !== null ? String(v.value_number) : null) ??
          v.value_date ??
          (v.value_boolean !== null ? (v.value_boolean ? 'Sim' : 'Não') : null)
        if (raw) cfValuesById[v.field_id] = String(raw)
      }
    }

    for (const field of leadFields) {
      if (field === 'closed_seq' || field === 'case_number') parts.push(seqStr)
      else if (typeof field === 'string' && field.startsWith('text:')) {
        try { parts.push(decodeURIComponent(field.slice(5))) } catch { parts.push(field.slice(5)) }
      }
      else if (field === 'board_name' && board?.name) parts.push(board.name)
      else if (typeof field === 'string' && field.startsWith('cf:')) {
        const v = cfValuesById[field.slice(3)]
        if (v) parts.push(v)
      }
      else if (lead[field]) parts.push(String(lead[field]))
    }
    let newName = parts.join(' ')
    if (newName.length > 100) newName = newName.slice(0, 100).trim()

    console.log(`Renaming group from "${currentName}" to "${newName}"`)

    // Rename group
    let renamed = false
    try {
      const renameRes = await fetch(`${baseUrl}/group/updateName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token: instance.instance_token },
        body: JSON.stringify({ groupjid: fullJid, name: newName }),
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
