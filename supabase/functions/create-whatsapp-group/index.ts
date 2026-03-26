import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { phone, lead_name, board_id, contact_phone, creator_instance_id, lead_id } = await req.json()

    if (!lead_name) {
      return new Response(JSON.stringify({ success: false, error: 'lead_name is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get the creator instance
    let creatorInstance: any = null
    if (creator_instance_id) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('id', creator_instance_id)
        .eq('is_active', true)
        .single()
      creatorInstance = data
    }
    if (!creatorInstance) {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single()
      creatorInstance = data
    }

    if (!creatorInstance) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma instância WhatsApp ativa encontrada' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const baseUrl = creatorInstance.base_url || 'https://abraci.uazapi.com'

    // Build group name from settings
    let groupName = lead_name
    if (board_id) {
      const { data: settings } = await supabase
        .from('board_group_settings')
        .select('*')
        .eq('board_id', board_id)
        .maybeSingle()

      if (settings) {
        // Get lead data for field substitution
        let leadData: any = null
        
        // Try to find lead by id or phone
        const normalizedPhone = (contact_phone || phone || '').replace(/\D/g, '')
        if (lead_id) {
          const { data } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle()
          leadData = data
        }
        if (!leadData && normalizedPhone) {
          const { data } = await supabase
            .from('leads')
            .select('*')
            .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${normalizedPhone.slice(-8)}%`)
            .limit(1)
            .maybeSingle()
          leadData = data
        }

        // Increment sequence
        const nextSeq = Math.max(
          (settings.current_sequence || 0) + 1,
          settings.sequence_start || 1
        )
        
        // Update current_sequence atomically
        await supabase
          .from('board_group_settings')
          .update({ current_sequence: nextSeq, updated_at: new Date().toISOString() })
          .eq('board_id', board_id)

        // Build name parts
        const parts: string[] = []
        
        // Prefix
        if (settings.group_name_prefix) {
          parts.push(settings.group_name_prefix)
        }
        
        // Sequence number
        parts.push(String(nextSeq).padStart(4, '0'))

        // Lead fields
        const leadFields = settings.lead_fields || ['lead_name']
        for (const field of leadFields) {
          if (leadData && leadData[field]) {
            parts.push(String(leadData[field]))
          } else if (field === 'lead_name') {
            parts.push(lead_name)
          }
        }

        groupName = parts.join(' ')
      }
    }

    // Build participant list
    const participants: string[] = []
    const normalizedContact = (contact_phone || phone || '').replace(/\D/g, '')
    if (normalizedContact) {
      participants.push(normalizedContact)
    }

    // Get configured instances for this board
    let boardInstances: any[] = []
    if (board_id) {
      const { data: bgi } = await supabase
        .from('board_group_instances')
        .select('instance_id')
        .eq('board_id', board_id)

      if (bgi && bgi.length > 0) {
        const instanceIds = bgi.map((b: any) => b.instance_id)
        const { data: instances } = await supabase
          .from('whatsapp_instances')
          .select('id, owner_phone, instance_name')
          .in('id', instanceIds)
          .eq('is_active', true)

        boardInstances = instances || []
      }
    }

    // Add board instances' owner phones (except creator's own phone)
    for (const inst of boardInstances) {
      if (inst.owner_phone && inst.id !== creatorInstance.id) {
        const p = inst.owner_phone.replace(/\D/g, '')
        if (p && !participants.includes(p)) {
          participants.push(p)
        }
      }
    }

    console.log(`Creating group "${groupName}" via instance ${creatorInstance.instance_name} with ${participants.length} participants`)

    // Create group via UazAPI
    const createRes = await fetch(`${baseUrl}/group/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
      body: JSON.stringify({
        name: groupName,
        participants: participants,
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error('Group create error:', createRes.status, errText)
      throw new Error(`Erro ao criar grupo: ${createRes.status} - ${errText}`)
    }

    const groupData = await createRes.json()
    console.log('Group created:', JSON.stringify(groupData).substring(0, 500))

    const groupId = groupData?.id || groupData?.jid || groupData?.data?.id || groupData?.gid || null

    // Promote board instances as admins
    for (const inst of boardInstances) {
      if (inst.id === creatorInstance.id) continue
      if (!inst.owner_phone) continue

      const instPhone = inst.owner_phone.replace(/\D/g, '')
      if (!instPhone) continue

      try {
        if (groupId) {
          await fetch(`${baseUrl}/group/promote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
            body: JSON.stringify({ id: groupId, participants: [instPhone] }),
          })
        }
      } catch (e) {
        console.error(`Error promoting instance ${inst.instance_name}:`, e)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      group_id: groupId,
      group_name: groupName,
      participants_count: participants.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Create group error:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
