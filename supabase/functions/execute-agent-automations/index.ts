import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";
import { getLocationFromDDD } from "../_shared/ddd-mapping.ts";

const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const cloudFunctionsUrl = Deno.env.get('SUPABASE_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co'
const cloudAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ========== HELPERS ==========

async function extractCityFromConversation(supabase: any, phone: string, instanceName: string): Promise<string | null> {
  if (!phone || !instanceName) return null;
  try {
    const { data: messages } = await supabase
      .from('whatsapp_messages')
      .select('message_text')
      .eq('phone', phone)
      .eq('instance_name', instanceName)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!messages || messages.length === 0) return null;

    const allText = messages.map((m: any) => m.message_text || '').join(' ');

    // Try to find city mentions with common patterns
    const cityPatterns = [
      /(?:moro|mora|resido|resid[eê]ncia|cidade|sou de|estou em|minha cidade|aqui em|localizada? em|endere[çc]o)\s*(?:[:\-])?\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[eao]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+)*)/gi,
      /(?:visita|visit[aá]|atendimento)\s+(?:em|na|no)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[eao]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+)*)/gi,
    ];

    for (const pattern of cityPatterns) {
      const match = pattern.exec(allText);
      if (match && match[1]) {
        const city = match[1].trim();
        if (city.length >= 3 && city.length <= 50) {
          return city;
        }
      }
    }
  } catch (err) {
    console.warn('[agent-automations] Error extracting city from conversation:', err);
  }
  return null;
}

async function getInstancePhones(supabase: any): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('whatsapp_instances')
      .select('phone_number')
      .eq('is_active', true);
    return (data || []).map((i: any) => (i.phone_number || '').replace(/\D/g, '')).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchGroupParticipants(instanceName: string, groupId: string, supabase: any): Promise<string[]> {
  try {
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();

    if (!inst?.instance_token) return [];

    const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
    const groupJid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;

    const res = await fetch(`${baseUrl}/group/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
      body: JSON.stringify({ id: groupJid }),
    });

    if (!res.ok) return [];

    const groupData = await res.json();
    const participants = groupData?.participants || groupData?.data?.participants || [];
    return participants.map((p: any) => {
      const id = p.id || p.jid || '';
      return id.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
    }).filter(Boolean);
  } catch (err) {
    console.warn('[agent-automations] Error fetching group participants:', err);
    return [];
  }
}

async function registerGroupParticipants(
  supabase: any,
  instanceName: string,
  groupId: string,
  agentLabel: string,
  conversationCity: string | null,
  responsibleUserId: string | null = null,
): Promise<any[]> {
  const results: any[] = [];

  const participants = await fetchGroupParticipants(instanceName, groupId, supabase);
  if (participants.length === 0) {
    results.push({ type: 'register_group_participants', skipped: 'no participants found' });
    return results;
  }

  const instancePhones = await getInstancePhones(supabase);
  const filteredParticipants = participants.filter(p => !instancePhones.some(ip => p.endsWith(ip) || ip.endsWith(p)));

  console.log(`[agent-automations] Group has ${participants.length} participants, ${filteredParticipants.length} after filtering instances`);

  for (const participantPhone of filteredParticipants) {
    try {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('phone', participantPhone)
        .maybeSingle();

      if (existing) {
        results.push({ type: 'register_group_participant', skipped: 'exists', phone: participantPhone });
        continue;
      }

      const location = getLocationFromDDD(participantPhone);
      const city = conversationCity || location?.city || null;
      const state = location?.state || null;

      const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
          full_name: participantPhone,
          phone: participantPhone,
          city,
          state,
          created_by: responsibleUserId,
          action_source: 'system',
          action_source_detail: agentLabel,
        })
        .select('id')
        .single();

      if (error) {
        console.warn(`[agent-automations] Error creating participant contact ${participantPhone}:`, error.message);
        results.push({ type: 'register_group_participant', error: error.message, phone: participantPhone });
      } else {
        results.push({ type: 'register_group_participant', id: newContact.id, phone: participantPhone });
      }
    } catch (err: any) {
      results.push({ type: 'register_group_participant', error: err.message, phone: participantPhone });
    }
  }

  return results;
}

// ========== MAIN HANDLER ==========

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
    const body = await req.json();
    const {
      agent_id, trigger_type, phone, instance_name, contact_name,
      lead_id, campaign_id, campaign_name,
      is_group, group_id,
    } = body;
    const agentLabel = `Agente IA (automação: ${trigger_type})`;

    console.log(`[agent-automations] trigger=${trigger_type} agent=${agent_id} phone=${phone} is_group=${is_group}`);

    if (!agent_id || !trigger_type) {
      return new Response(JSON.stringify({ error: 'agent_id and trigger_type required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Pre-compute location from DDD and conversation city
    const normalizedMainPhone = phone?.replace(/\D/g, '') || '';
    const dddLocation = normalizedMainPhone ? getLocationFromDDD(normalizedMainPhone) : null;
    const conversationCity = await extractCityFromConversation(supabase, phone, instance_name);

    const actions = rule.actions.filter((a: any) => a.enabled !== false);
    const results: any[] = [];
    let createdLeadId = lead_id || null;
    let createdContactId: string | null = null;

    // If it's a group, register participants as contacts first
    // Resolve acolhedor (responsible member) for created_by
    let responsibleUserId: string | null = null;
    if (lead_id) {
      const { data: leadData } = await supabase.from('leads').select('acolhedor').eq('id', lead_id).maybeSingle();
      if (leadData?.acolhedor) {
        const { data: profile } = await supabase.from('profiles').select('user_id').ilike('full_name', leadData.acolhedor).limit(1).maybeSingle();
        responsibleUserId = profile?.user_id || null;
      }
    }

    if (is_group && group_id && instance_name) {
      const groupResults = await registerGroupParticipants(supabase, instance_name, group_id, agentLabel, conversationCity, responsibleUserId);
      results.push(...groupResults);
    }

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'create_contact': {
            if (!normalizedMainPhone) { results.push({ type: 'create_contact', skipped: 'no phone' }); break; }

            const { data: existing } = await supabase
              .from('contacts')
              .select('id')
              .eq('phone', normalizedMainPhone)
              .maybeSingle();

            if (existing) {
              createdContactId = existing.id;
              // Update location if missing
              if (dddLocation) {
                const city = conversationCity || dddLocation.city;
                await supabase.from('contacts').update({
                  state: dddLocation.state,
                  city,
                }).eq('id', existing.id).is('state', null);
              }
              results.push({ type: 'create_contact', skipped: 'already exists', id: existing.id });
              break;
            }

            const city = conversationCity || dddLocation?.city || null;
            const state = dddLocation?.state || null;

            const { data: newContact, error } = await supabase
              .from('contacts')
              .insert({
                full_name: contact_name || normalizedMainPhone,
                phone: normalizedMainPhone,
                city,
                state,
                created_by: responsibleUserId,
                action_source: 'system',
                action_source_detail: agentLabel,
              })
              .select('id')
              .single();

            if (error) throw error;
            createdContactId = newContact.id;
            results.push({ type: 'create_contact', id: newContact.id, city, state });
            break;
          }

          case 'create_lead': {
            const boardId = action.config?.board_id;
            if (!boardId) { results.push({ type: 'create_lead', skipped: 'no board_id' }); break; }

            const { data: existingLead } = await supabase
              .from('leads')
              .select('id')
              .eq('lead_phone', normalizedMainPhone)
              .eq('board_id', boardId)
              .maybeSingle();

            if (existingLead) {
              createdLeadId = existingLead.id;
              // Update location if missing
              if (dddLocation) {
                const city = conversationCity || dddLocation.city;
                await supabase.from('leads').update({
                  state: dddLocation.state,
                  city,
                }).eq('id', existingLead.id).is('state', null);
              }
              results.push({ type: 'create_lead', skipped: 'already exists', id: existingLead.id });
              break;
            }

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

            const city = conversationCity || dddLocation?.city || null;
            const state = dddLocation?.state || null;

            const { data: newLead, error } = await supabase
              .from('leads')
              .insert({
                lead_name: contact_name || normalizedMainPhone,
                lead_phone: normalizedMainPhone,
                board_id: boardId,
                stage: stageId,
                status: 'new',
                source: 'whatsapp_automation',
                campaign_id: campaign_id || null,
                city,
                state,
                action_source: 'system',
                action_source_detail: agentLabel,
              })
              .select('id')
              .single();

            if (error) throw error;
            createdLeadId = newLead.id;

            if (createdContactId) {
              await supabase.from('contact_leads').insert({
                contact_id: createdContactId,
                lead_id: newLead.id,
              });
            }

            results.push({ type: 'create_lead', id: newLead.id, city, state });
            break;
          }

          case 'create_activity': {
            if (!createdLeadId) { results.push({ type: 'create_activity', skipped: 'no lead' }); break; }

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
              action_source: 'system',
              action_source_detail: agentLabel,
            });

            if (error) throw error;
            results.push({ type: 'create_activity', ok: true });
            break;
          }

          case 'create_case': {
            if (!createdLeadId) { results.push({ type: 'create_case', skipped: 'no lead' }); break; }

            const nucleusId = action.config?.nucleus_id || null;

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
              action_source: 'system',
              action_source_detail: agentLabel,
            });

            if (error) throw error;

            if (caseNumber && caseNumber.startsWith('CASO')) {
              try {
                await supabase.from('lead_activities').insert({
                  lead_id: createdLeadId,
                  lead_name: leadData?.lead_name || 'Novo',
                  title: 'ONBOARDING CLIENTE',
                  description: `Atividade de onboarding criada automaticamente para o caso ${caseNumber}`,
                  activity_type: 'tarefa',
                  status: 'pendente',
                  priority: 'alta',
                  assigned_to: '1f788b8d-e30e-484a-9460-39a881d25128',
                  assigned_to_name: 'Wanessa Vitória Rodrigues de Sousa',
                  deadline: new Date().toISOString().split('T')[0],
                });
              } catch (onbErr) {
                console.warn('[agent-automations] Onboarding activity error:', onbErr);
              }
            }

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

            const boardId = action.config?.board_id;

            const { data: leadForGroup } = await supabase
              .from('leads')
              .select('lead_name, board_id, whatsapp_group_id')
              .eq('id', createdLeadId)
              .single();

            const groupBoardId = boardId || leadForGroup?.board_id;
            const groupName = leadForGroup?.lead_name || contact_name || normalizedMainPhone;

            if (leadForGroup?.whatsapp_group_id) {
              results.push({
                type: 'create_group',
                ok: true,
                skipped: 'already_has_group',
                group_id: leadForGroup.whatsapp_group_id,
              });
              break;
            }

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

            const groupRes = await fetch(`${cloudFunctionsUrl}/functions/v1/create-whatsapp-group`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cloudAnonKey}`,
              },
              body: JSON.stringify({
                phone: normalizedMainPhone,
                lead_name: groupName,
                board_id: groupBoardId,
                contact_phone: normalizedMainPhone,
                creator_instance_id: creatorInstanceId,
                lead_id: createdLeadId,
              }),
            });

            const groupData = await groupRes.json();
            if (!groupData.success) throw new Error(groupData.error || 'Failed to create group');

            if (groupData.group_id) {
              await supabase
                .from('leads')
                .update({ whatsapp_group_id: groupData.group_id } as any)
                .eq('id', createdLeadId);
            }

            if (groupData.group_id && createdContactId) {
              await supabase
                .from('contacts')
                .update({ whatsapp_group_id: groupData.group_id } as any)
                .eq('id', createdContactId);
            } else if (groupData.group_id && normalizedMainPhone) {
              const { data: contactForGroup } = await supabase
                .from('contacts')
                .select('id')
                .eq('phone', normalizedMainPhone)
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

          case 'send_group_message': {
            // Find the group linked to the lead
            let targetGroupId: string | null = null;
            if (createdLeadId) {
              const { data: leadG } = await supabase.from('leads').select('whatsapp_group_id').eq('id', createdLeadId).maybeSingle();
              targetGroupId = leadG?.whatsapp_group_id || null;
            }
            if (!targetGroupId && normalizedMainPhone) {
              const { data: contactG } = await supabase.from('contacts').select('whatsapp_group_id').eq('phone', normalizedMainPhone).maybeSingle();
              targetGroupId = contactG?.whatsapp_group_id || null;
            }

            if (!targetGroupId) { results.push({ type: 'send_group_message', skipped: 'no group found' }); break; }
            if (!instance_name) { results.push({ type: 'send_group_message', skipped: 'no instance' }); break; }

            const msgTemplate = action.config?.message_template || '';
            const resolvedMsg = msgTemplate
              .replace(/\{nome_cliente\}/g, contact_name || '')
              .replace(/\{telefone\}/g, normalizedMainPhone)
              .replace(/\{numero_processo\}/g, '');

            const { data: inst } = await supabase
              .from('whatsapp_instances')
              .select('instance_token, base_url')
              .eq('instance_name', instance_name)
              .eq('is_active', true)
              .maybeSingle();

            if (!inst?.instance_token) { results.push({ type: 'send_group_message', skipped: 'no instance token' }); break; }

            const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
            const groupJid = targetGroupId.includes('@g.us') ? targetGroupId : `${targetGroupId}@g.us`;

            const sendRes = await fetch(`${baseUrl}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
              body: JSON.stringify({ id: groupJid, message: resolvedMsg }),
            });

            results.push({ type: 'send_group_message', ok: sendRes.ok, group_id: targetGroupId });
            break;
          }

          case 'send_private_redirect': {
            if (!normalizedMainPhone || !instance_name) {
              results.push({ type: 'send_private_redirect', skipped: 'no phone or instance' });
              break;
            }

            const redirectTemplate = action.config?.message_template || '';
            const redirectMsg = redirectTemplate
              .replace(/\{nome_cliente\}/g, contact_name || '')
              .replace(/\{telefone\}/g, normalizedMainPhone)
              .replace(/\{numero_processo\}/g, '');

            const { data: instPriv } = await supabase
              .from('whatsapp_instances')
              .select('instance_token, base_url')
              .eq('instance_name', instance_name)
              .eq('is_active', true)
              .maybeSingle();

            if (!instPriv?.instance_token) { results.push({ type: 'send_private_redirect', skipped: 'no instance token' }); break; }

            const baseUrlPriv = instPriv.base_url || 'https://abraci.uazapi.com';
            const phoneJid = normalizedMainPhone.includes('@') ? normalizedMainPhone : `${normalizedMainPhone}@s.whatsapp.net`;

            const sendPrivRes = await fetch(`${baseUrlPriv}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instPriv.instance_token },
              body: JSON.stringify({ id: phoneJid, message: redirectMsg }),
            });

            // Optionally deactivate agent in private
            if (action.config?.deactivate_private_agent !== false) {
              await supabase
                .from('whatsapp_conversation_agents')
                .update({ is_active: false })
                .eq('phone', phone)
                .eq('instance_name', instance_name);
              console.log(`[agent-automations] Deactivated private agent for ${phone}/${instance_name}`);
            }

            results.push({ type: 'send_private_redirect', ok: sendPrivRes.ok });
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
