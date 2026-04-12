import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(resolveSupabaseUrl(), resolveServiceRoleKey())
    const { lead_id } = await req.json()

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

    // Get board group settings
    if (!lead.board_id) {
      return new Response(JSON.stringify({ success: false, error: 'Lead has no board' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    // Calculate next closed sequence number
    const closedSeq = Math.max(
      (settings.closed_current_sequence || 0) + 1,
      settings.closed_sequence_start || 1
    )

    // Find a connected instance to rename the group
    const { data: boardInstances } = await supabase
      .from('board_group_instances')
      .select('instance_id')
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
      // Fallback: try any connected instance
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

    // Get current group name to extract sequence number
    const baseUrl = instance.base_url || 'https://abraci.uazapi.com'
    const fullJid = groupJid.includes('@g.us') ? groupJid : `${groupJid}@g.us`

    // Fetch current group info to get the current name
    let currentName = ''
    try {
      const infoRes = await fetch(`${baseUrl}/group/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token: instance.instance_token },
        body: JSON.stringify({ groupjid: fullJid }),
      })
      if (infoRes.ok) {
        const info = await infoRes.json()
        currentName = info?.subject || info?.name || info?.data?.subject || ''
      }
    } catch (e) {
      console.warn('Could not fetch group info:', e)
    }

    // Build new name using closed prefix + closed sequence + lead fields
    const closedPrefix = settings.closed_group_name_prefix
    const leadFields = settings.lead_fields || ['lead_name']
    
    const parts: string[] = []
    if (closedPrefix) parts.push(closedPrefix)
    parts.push(String(closedSeq).padStart(4, '0'))
    
    for (const field of leadFields) {
      if (lead[field]) {
        parts.push(String(lead[field]))
      }
    }
    
    let newName = parts.join(' ')

    // Truncate to WhatsApp limit
    if (newName.length > 100) {
      newName = newName.slice(0, 100).trim()
    }

    console.log(`Renaming group from "${currentName}" to "${newName}"`)

    // Try updateSubject first, then fallback to subject
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

    // Update sequence and group name in DB
    if (renamed) {
      // Increment closed sequence
      await supabase
        .from('board_group_settings')
        .update({ closed_current_sequence: closedSeq })
        .eq('board_id', lead.board_id)

      // Update group_links table
      await supabase
        .from('whatsapp_group_links')
        .update({ group_name: newName })
        .eq('group_jid', fullJid)
        .catch(() => {})
    }

    return new Response(JSON.stringify({ 
      success: renamed, 
      old_name: currentName, 
      new_name: newName 
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
