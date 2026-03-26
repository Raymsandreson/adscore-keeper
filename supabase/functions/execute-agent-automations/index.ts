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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { agent_id, trigger_type, phone, instance_name, contact_name, lead_id } = body;

    console.log(`[agent-automations] trigger=${trigger_type} agent=${agent_id} phone=${phone}`);

    if (!agent_id || !trigger_type) {
      return new Response(JSON.stringify({ error: 'agent_id and trigger_type required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch automation rules for this agent and trigger
    const { data: rule } = await supabase
      .from('agent_automation_rules')
      .select('*')
      .eq('agent_id', agent_id)
      .eq('trigger_type', trigger_type)
      .eq('is_active', true)
      .maybeSingle();

    if (!rule || !rule.actions || rule.actions.length === 0) {
      console.log('[agent-automations] No active rules found');
      return new Response(JSON.stringify({ ok: true, executed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actions = rule.actions.filter((a: any) => a.enabled !== false);
    const results: any[] = [];
    let createdLeadId = lead_id || null;
    let createdContactId: string | null = null;

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'create_contact': {
            // Check if contact already exists with this phone
            const normalizedPhone = phone?.replace(/\D/g, '') || '';
            if (!normalizedPhone) { results.push({ type: 'create_contact', skipped: 'no phone' }); break; }

            const { data: existing } = await supabase
              .from('contacts')
              .select('id')
              .eq('phone', normalizedPhone)
              .maybeSingle();

            if (existing) {
              createdContactId = existing.id;
              results.push({ type: 'create_contact', skipped: 'already exists', id: existing.id });
              break;
            }

            const { data: newContact, error } = await supabase
              .from('contacts')
              .insert({
                full_name: contact_name || normalizedPhone,
                phone: normalizedPhone,
              })
              .select('id')
              .single();

            if (error) throw error;
            createdContactId = newContact.id;
            results.push({ type: 'create_contact', id: newContact.id });
            break;
          }

          case 'create_lead': {
            const normalizedPhone = phone?.replace(/\D/g, '') || '';
            const boardId = action.config?.board_id;
            if (!boardId) { results.push({ type: 'create_lead', skipped: 'no board_id' }); break; }

            // Check if lead already exists with this phone in this board
            const { data: existingLead } = await supabase
              .from('leads')
              .select('id')
              .eq('lead_phone', normalizedPhone)
              .eq('board_id', boardId)
              .maybeSingle();

            if (existingLead) {
              createdLeadId = existingLead.id;
              results.push({ type: 'create_lead', skipped: 'already exists', id: existingLead.id });
              break;
            }

            // Get stage - use configured or first stage of board
            let stageId = action.config?.stage_id;
            if (!stageId) {
              const { data: firstStage } = await supabase
                .from('kanban_stages')
                .select('id')
                .eq('board_id', boardId)
                .order('display_order', { ascending: true })
                .limit(1)
                .single();
              stageId = firstStage?.id;
            }

            const { data: newLead, error } = await supabase
              .from('leads')
              .insert({
                lead_name: contact_name || normalizedPhone,
                lead_phone: normalizedPhone,
                board_id: boardId,
                stage: stageId,
                status: 'new',
                source: 'whatsapp_automation',
              })
              .select('id')
              .single();

            if (error) throw error;
            createdLeadId = newLead.id;

            // Link contact to lead if we have one
            if (createdContactId) {
              await supabase.from('contact_leads').insert({
                contact_id: createdContactId,
                lead_id: newLead.id,
              });
            }

            results.push({ type: 'create_lead', id: newLead.id });
            break;
          }

          case 'create_activity': {
            if (!createdLeadId) { results.push({ type: 'create_activity', skipped: 'no lead' }); break; }

            // Get lead name
            const { data: leadData } = await supabase
              .from('leads')
              .select('lead_name')
              .eq('id', createdLeadId)
              .single();

            const { error } = await supabase.from('lead_activities').insert({
              lead_id: createdLeadId,
              lead_name: leadData?.lead_name || '',
              title: action.config?.title || 'Dar andamento',
              activity_type: action.config?.activity_type || 'tarefa',
              priority: action.config?.priority || 'normal',
              status: 'pendente',
              deadline: new Date().toISOString().split('T')[0],
            });

            if (error) throw error;
            results.push({ type: 'create_activity', ok: true });
            break;
          }

          case 'create_case': {
            if (!createdLeadId) { results.push({ type: 'create_case', skipped: 'no lead' }); break; }

            const nucleusId = action.config?.nucleus_id || null;

            // Generate case number
            const { data: caseNumber } = await supabase.rpc('generate_case_number', {
              p_nucleus_id: nucleusId,
            });

            const { data: leadData } = await supabase
              .from('leads')
              .select('lead_name')
              .eq('id', createdLeadId)
              .single();

            const { error } = await supabase.from('legal_cases').insert({
              case_number: caseNumber,
              title: `Caso - ${leadData?.lead_name || 'Novo'}`,
              lead_id: createdLeadId,
              nucleus_id: nucleusId,
              status: 'em_andamento',
            });

            if (error) throw error;
            results.push({ type: 'create_case', ok: true, case_number: caseNumber });
            break;
          }

          case 'move_lead_stage': {
            if (!createdLeadId) { results.push({ type: 'move_lead_stage', skipped: 'no lead' }); break; }

            const boardId = action.config?.board_id;
            let stageId = action.config?.stage_id;

            if (!stageId && boardId) {
              const { data: firstStage } = await supabase
                .from('kanban_stages')
                .select('id')
                .eq('board_id', boardId)
                .order('display_order', { ascending: true })
                .limit(1)
                .single();
              stageId = firstStage?.id;
            }

            const updatePayload: any = {};
            if (boardId) updatePayload.board_id = boardId;
            if (stageId) updatePayload.stage = stageId;

            if (Object.keys(updatePayload).length > 0) {
              const { error } = await supabase
                .from('leads')
                .update(updatePayload)
                .eq('id', createdLeadId);
              if (error) throw error;
            }

            results.push({ type: 'move_lead_stage', ok: true });
            break;
          }

          case 'create_group': {
            if (!createdLeadId) { results.push({ type: 'create_group', skipped: 'no lead' }); break; }

            const normalizedPhone = phone?.replace(/\D/g, '') || '';
            const boardId = action.config?.board_id;

            // Get lead name
            const { data: leadForGroup } = await supabase
              .from('leads')
              .select('lead_name, board_id, whatsapp_group_id')
              .eq('id', createdLeadId)
              .single();

            const groupBoardId = boardId || leadForGroup?.board_id;
            const groupName = leadForGroup?.lead_name || contact_name || normalizedPhone;

            if (leadForGroup?.whatsapp_group_id) {
              results.push({
                type: 'create_group',
                ok: true,
                skipped: 'already_has_group',
                group_id: leadForGroup.whatsapp_group_id,
              });
              break;
            }

            // Get creator instance
            let creatorInstanceId: string | null = null;
            if (instance_name) {
              const { data: inst } = await supabase
                .from('whatsapp_instances')
                .select('id')
                .eq('instance_name', instance_name)
                .eq('is_active', true)
                .maybeSingle();
              if (inst) creatorInstanceId = inst.id;
            }

            // Call create-whatsapp-group edge function
            const groupRes = await fetch(`${supabaseUrl}/functions/v1/create-whatsapp-group`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                phone: normalizedPhone,
                lead_name: groupName,
                board_id: groupBoardId,
                contact_phone: normalizedPhone,
                creator_instance_id: creatorInstanceId,
                lead_id: createdLeadId,
              }),
            });

            const groupData = await groupRes.json();
            if (!groupData.success) throw new Error(groupData.error || 'Failed to create group');

            // Save group_id to lead
            if (groupData.group_id) {
              await supabase
                .from('leads')
                .update({ whatsapp_group_id: groupData.group_id } as any)
                .eq('id', createdLeadId);
            }

            // Save group_id to contact too
            if (groupData.group_id && createdContactId) {
              await supabase
                .from('contacts')
                .update({ whatsapp_group_id: groupData.group_id } as any)
                .eq('id', createdContactId);
            } else if (groupData.group_id && normalizedPhone) {
              const { data: contactForGroup } = await supabase
                .from('contacts')
                .select('id')
                .eq('phone', normalizedPhone)
                .maybeSingle();
              if (contactForGroup) {
                await supabase
                  .from('contacts')
                  .update({ whatsapp_group_id: groupData.group_id } as any)
                  .eq('id', contactForGroup.id);
              }
            }

            results.push({ type: 'create_group', ok: true, group_id: groupData.group_id });
            break;
          }
      }
      } catch (actionError: any) {
        console.error(`[agent-automations] Action ${action.type} failed:`, actionError.message);
        results.push({ type: action.type, error: actionError.message });
      }
    }

    console.log(`[agent-automations] Executed ${results.length} actions:`, JSON.stringify(results));
    return new Response(JSON.stringify({ ok: true, executed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[agent-automations] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
