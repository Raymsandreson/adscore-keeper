import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { differenceInMinutes, endOfDay } from 'date-fns';
import type { AgentData, ConversationDetail, AgentStats, ReferralData, BoardData, RedirectionData, UserData } from '../types';

export function useMonitorData() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [conversations, setConversations] = useState<ConversationDetail[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [referrals, setReferrals] = useState<ReferralData[]>([]);
  const [redirections, setRedirections] = useState<RedirectionData[]>([]);
  const [boards, setBoards] = useState<BoardData[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (dateRange: { from: Date; to: Date }) => {
    setLoading(true);
    try {
      const startDate = dateRange.from.toISOString();
      const endDate = endOfDay(dateRange.to).toISOString();

      const [agentsRes, convAgentsRes, messagesRes, leadsRes, boardsRes, followupsRes, referralsRes, redirectionsRes] = await Promise.all([
        supabase.from('wjia_command_shortcuts').select('id, shortcut_name, description, is_active, followup_steps, followup_repeat_forever').order('shortcut_name'),
        supabase.from('whatsapp_conversation_agents').select('*').or('is_active.eq.true,is_blocked.eq.true'),
        supabase.from('whatsapp_messages')
          .select('phone, instance_name, direction, created_at, contact_name, lead_id, campaign_name')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
        supabase.from('leads')
          .select('id, lead_name, lead_phone, status, lead_status, board_id, city, state, followup_count, campaign_name, acolhedor, whatsapp_group_id, created_at')
          .not('lead_phone', 'is', null),
        supabase.from('kanban_boards').select('id, name, stages'),
        supabase.from('lead_followups').select('lead_id, followup_type').gte('followup_date', startDate).lte('followup_date', endDate),
        supabase.from('ambassador_referrals')
          .select('id, ambassador_id, contact_id, lead_id, status, created_at, campaign_id, notes, member_user_id')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
        supabase.from('agent_group_redirections')
          .select('id, agent_name, phone, instance_name, group_jid, notify_instance_name, group_message, private_notification, created_at')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
      ]);

      const agentPhones = (convAgentsRes.data || []).map((ca: any) => ca.phone);
      const { data: campaignMsgs } = await supabase
        .from('whatsapp_messages')
        .select('phone, instance_name, campaign_name')
        .in('phone', agentPhones)
        .not('campaign_name', 'is', null)
        .limit(2000);

      const campaignByPhone = new Map<string, string>();
      (campaignMsgs || []).forEach((m: any) => {
        const key = `${m.phone}|${m.instance_name}`;
        if (!campaignByPhone.has(key)) campaignByPhone.set(key, m.campaign_name);
      });

      const agentsData = agentsRes.data || [];
      const convAgents = convAgentsRes.data || [];
      const messages = messagesRes.data || [];
      const leads = leadsRes.data || [];
      const boardsData = boardsRes.data || [];
      const followups = followupsRes.data || [];

      setAgents(agentsData as AgentData[]);
      setBoards(boardsData.map((b: any) => ({ id: b.id, name: b.name, stages: b.stages || [] })));

      const agentMap = new Map(agentsData.map((a: any) => [a.id, a.shortcut_name]));
      const agentFollowupMap = new Map(agentsData.map((a: any) => [a.id, !!(a.followup_steps && Array.isArray(a.followup_steps) && a.followup_steps.length > 0)]));
      const leadPhoneMap = new Map<string, any>();
      leads.forEach((l: any) => {
        if (l.lead_phone) {
          const normalized = l.lead_phone.replace(/\D/g, '');
          leadPhoneMap.set(normalized, l);
          if (normalized.length > 8) leadPhoneMap.set(normalized.slice(-8), l);
        }
      });
      const boardMap = new Map(boardsData.map((b: any) => [b.id, b]));

      const msgByConv = new Map<string, any[]>();
      messages.forEach((m: any) => {
        const key = `${m.phone}|${m.instance_name}`;
        if (!msgByConv.has(key)) msgByConv.set(key, []);
        msgByConv.get(key)!.push(m);
      });

      const followupsByLead = new Map<string, number>();
      followups.forEach((f: any) => {
        followupsByLead.set(f.lead_id, (followupsByLead.get(f.lead_id) || 0) + 1);
      });

      const convDetails: ConversationDetail[] = [];
      convAgents.forEach((ca: any) => {
        const phoneClean = ca.phone?.replace(/\D/g, '') || '';
        if (ca.phone?.includes('@g.us') || phoneClean.startsWith('120363')) return;

        const agentName = agentMap.get(ca.agent_id) || 'Desconhecido';
        const key = `${ca.phone}|${ca.instance_name}`;
        const msgs = msgByConv.get(key) || [];
        const phoneNorm = ca.phone.replace(/\D/g, '');
        const lead = leadPhoneMap.get(phoneNorm) || leadPhoneMap.get(phoneNorm.slice(-8));

        const inboundMsgs = msgs.filter((m: any) => m.direction === 'inbound');
        const outboundMsgs = msgs.filter((m: any) => m.direction === 'outbound');
        const lastInbound = inboundMsgs[0]?.created_at || null;
        const lastOutbound = outboundMsgs[0]?.created_at || null;

        let boardName = null;
        let stageName = null;
        if (lead?.board_id) {
          const board = boardMap.get(lead.board_id);
          if (board) {
            boardName = board.name;
            const stages = board.stages as any[];
            if (stages && lead.status) {
              const stage = stages.find((s: any) => s.id === lead.status);
              stageName = stage?.name || lead.status;
            }
          }
        }

        const timeWithoutResponse = lastOutbound && !lastInbound
          ? differenceInMinutes(new Date(), new Date(lastOutbound))
          : lastOutbound && lastInbound && new Date(lastOutbound) > new Date(lastInbound)
            ? differenceInMinutes(new Date(), new Date(lastOutbound))
            : null;

        convDetails.push({
          phone: ca.phone,
          instance_name: ca.instance_name,
          agent_name: agentName,
          agent_id: ca.agent_id,
          is_active: ca.is_active,
          is_blocked: ca.is_blocked ?? false,
          contact_name: (() => {
            const raw = msgs[0]?.contact_name || null;
            if (!raw) return null;
            // Filter out phone-number-like names and "WhatsApp XXXXX" patterns
            if (/^WhatsApp\s+\d/i.test(raw)) return null;
            if (/^\+?\d[\d\s\-()]{6,}$/.test(raw.trim())) return null;
            return raw;
          })(),
          lead_name: lead?.lead_name || null,
          lead_id: lead?.id || null,
          lead_status: lead?.lead_status || null,
          lead_city: lead?.city || null,
          lead_state: lead?.state || null,
          lead_acolhedor: lead?.acolhedor || null,
          board_id: lead?.board_id || null,
          board_name: boardName,
          stage_name: stageName,
          last_inbound_at: lastInbound,
          last_outbound_at: lastOutbound,
          total_messages: msgs.length,
          inbound_count: inboundMsgs.length,
          outbound_count: outboundMsgs.length,
          followup_count: lead ? (followupsByLead.get(lead.id) || 0) : 0,
          has_followup_config: agentFollowupMap.get(ca.agent_id) || false,
          time_without_response: timeWithoutResponse,
          campaign_name: campaignByPhone.get(key) || msgs.find((m: any) => m.campaign_name)?.campaign_name || lead?.campaign_name || null,
          activated_by: ca.activated_by || null,
          activated_at: ca.created_at || null,
          whatsapp_group_id: lead?.whatsapp_group_id || null,
          created_at: lead?.created_at || ca.created_at || null,
        });
      });

      setConversations(convDetails);

      // Agent stats
      const statsMap = new Map<string, AgentStats>();
      agentsData.forEach((a: any) => {
        statsMap.set(a.id, {
          agent_id: a.id, agent_name: a.shortcut_name,
          total_conversations: 0, active_conversations: 0, paused_conversations: 0, inactive_conversations: 0,
          total_messages_sent: 0, total_messages_received: 0, response_rate: 0,
          conversations_by_stage: {}, followups_sent: 0, leads_closed: 0, leads_refused: 0, without_response_count: 0,
        });
      });

      convDetails.forEach(c => {
        const stat = statsMap.get(c.agent_id);
        if (!stat) return;
        stat.total_conversations++;
        stat.active_conversations++;
        stat.total_messages_sent += c.outbound_count;
        stat.total_messages_received += c.inbound_count;
        stat.followups_sent += c.followup_count;
        if (c.stage_name) {
          stat.conversations_by_stage[c.stage_name] = (stat.conversations_by_stage[c.stage_name] || 0) + 1;
        }
        if (c.lead_status === 'closed') stat.leads_closed++;
        if (c.lead_status === 'refused') stat.leads_refused++;
        if (c.time_without_response && c.time_without_response > 60) stat.without_response_count++;
      });

      statsMap.forEach(stat => {
        if (stat.total_messages_received > 0) {
          stat.response_rate = Math.round((stat.total_messages_sent / stat.total_messages_received) * 100);
        }
      });

      setAgentStats(Array.from(statsMap.values()));

      // Referrals
      const ambassadorIds = [...new Set((referralsRes.data || []).map((r: any) => r.ambassador_id))];
      let ambassadorNames = new Map<string, string>();
      if (ambassadorIds.length > 0) {
        const { data: contacts } = await supabase.from('contacts').select('id, full_name').in('id', ambassadorIds);
        (contacts || []).forEach((c: any) => ambassadorNames.set(c.id, c.full_name));
      }

      const contactIds = [...new Set((referralsRes.data || []).map((r: any) => r.contact_id).filter(Boolean))];
      let contactNames = new Map<string, string>();
      if (contactIds.length > 0) {
        const { data: contacts } = await supabase.from('contacts').select('id, full_name').in('id', contactIds);
        (contacts || []).forEach((c: any) => contactNames.set(c.id, c.full_name));
      }

      const leadIds = [...new Set((referralsRes.data || []).map((r: any) => r.lead_id).filter(Boolean))];
      let leadNames = new Map<string, string>();
      if (leadIds.length > 0) {
        const { data: lds } = await supabase.from('leads').select('id, lead_name').in('id', leadIds);
        (lds || []).forEach((l: any) => leadNames.set(l.id, l.lead_name));
      }

      const campaignIds = [...new Set((referralsRes.data || []).map((r: any) => r.campaign_id).filter(Boolean))];
      let campaignNames = new Map<string, string>();
      if (campaignIds.length > 0) {
        const { data: camps } = await supabase.from('ambassador_campaigns').select('id, name').in('id', campaignIds);
        (camps || []).forEach((c: any) => campaignNames.set(c.id, c.name));
      }

      setReferrals((referralsRes.data || []).map((r: any) => ({
        id: r.id,
        ambassador_name: ambassadorNames.get(r.ambassador_id) || 'Desconhecido',
        contact_name: r.contact_id ? contactNames.get(r.contact_id) || null : null,
        lead_name: r.lead_id ? leadNames.get(r.lead_id) || null : null,
        status: r.status,
        created_at: r.created_at,
        campaign_name: r.campaign_id ? campaignNames.get(r.campaign_id) || null : null,
      })));

      setRedirections((redirectionsRes.data || []) as RedirectionData[]);

      // Fetch users with their default instances
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, default_instance_id')
        .not('default_instance_id', 'is', null);

      if (profilesData && profilesData.length > 0) {
        const instanceIds = [...new Set(profilesData.map((p: any) => p.default_instance_id).filter(Boolean))];
        const { data: instancesData } = await supabase
          .from('whatsapp_instances')
          .select('id, instance_name')
          .in('id', instanceIds);
        const instMap = new Map((instancesData || []).map((i: any) => [i.id, i.instance_name]));
        setUsers(profilesData.map((p: any) => ({
          id: p.id,
          full_name: p.full_name,
          instance_name: instMap.get(p.default_instance_id) || null,
        })).filter((u: UserData) => u.instance_name));
      }

    } catch (error) {
      console.error('Error fetching agent monitor data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return { agents, conversations, agentStats, referrals, redirections, boards, users, loading, fetchData };
}
