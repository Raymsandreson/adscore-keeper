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

    const { phone, lead_name, board_id, contact_phone, creator_instance_id } = await req.json()

    if (!lead_name) {
      return new Response(JSON.stringify({ success: false, error: 'lead_name is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get the creator instance (the one that will create the group)
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

    // Build participant list: contact phone + configured board instances' owner phones
    const participants: string[] = []

    // Add contact phone
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
        const instanceIds = bgi.map(b => b.instance_id)
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
        const phone = inst.owner_phone.replace(/\D/g, '')
        if (phone && !participants.includes(phone)) {
          participants.push(phone)
        }
      }
    }

    console.log(`Creating group "${lead_name}" via instance ${creatorInstance.instance_name} with ${participants.length} participants`)

    // Create group via UazAPI
    const createRes = await fetch(`${baseUrl}/group/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
      body: JSON.stringify({
        name: lead_name,
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

    // Now add the other board instances to the group (their owner phones)
    // The creator is already in the group, so we add remaining instances
    for (const inst of boardInstances) {
      if (inst.id === creatorInstance.id) continue
      if (!inst.owner_phone) continue

      const instPhone = inst.owner_phone.replace(/\D/g, '')
      if (!instPhone) continue

      // The phone was already added as participant during creation,
      // but if the API didn't add them, try explicitly
      try {
        // Get this instance's connection to add it as admin if needed
        const { data: instData } = await supabase
          .from('whatsapp_instances')
          .select('*')
          .eq('id', inst.id)
          .single()

        if (instData && groupId) {
          // Use the creator instance to promote them as admin
          await fetch(`${baseUrl}/group/promote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': creatorInstance.instance_token },
            body: JSON.stringify({ id: groupId, participants: [instPhone] }),
          })
        }
      } catch (e) {
        console.error(`Error adding instance ${inst.instance_name} to group:`, e)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      group_id: groupId,
      group_name: lead_name,
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
