import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { monitorData } from '@/utils/monitorData';
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

  const fetchData = useCallback(async (dateRange: { from: Date; to: Date }, selectedPeriod?: string) => {
    setLoading(true);
    try {
      const startDate = dateRange.from.toISOString();
      const endDate = endOfDay(dateRange.to).toISOString();
      const period = selectedPeriod || 'today';

      // Fetch conversations and agents from edge function
      const [convRes, agentsEdgeRes, agentsRes, boardsRes, referralsRes, redirectionsRes] = await Promise.all([
        monitorData('conversations', { period, limit: 2000, offset: 0 }),
        monitorData('agents', { period }),
        supabase.from('wjia_command_shortcuts').select('id, shortcut_name, description, is_active, followup_steps, followup_repeat_forever').order('shortcut_name'),
        supabase.from('kanban_boards').select('id, name, stages'),
        supabase.from('ambassador_referrals')
          .select('id, ambassador_id, contact_id, lead_id, status, created_at, campaign_id, notes, member_user_id')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
        supabase.from('agent_group_redirections')
          .select('id, agent_name, phone, instance_name, group_jid, notify_instance_name, group_message, private_notification, created_at')
          .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
      ]);

      const agentsData = agentsRes.data || [];
      const boardsData = boardsRes.data || [];

      setAgents(agentsData as AgentData[]);
      setBoards(boardsData.map((b: any) => ({ id: b.id, name: b.name, stages: b.stages || [] })));

      // Process conversations from edge function response
      const edgeConversations = convRes?.data || [];
      const edgeMeta = convRes?.meta || { total: 0, com_agente: 0, sem_agente: 0 };

      const agentMap = new Map(agentsData.map((a: any) => [a.id, a.shortcut_name]));
      const agentFollowupMap = new Map(agentsData.map((a: any) => [a.id, !!(a.followup_steps && Array.isArray(a.followup_steps) && a.followup_steps.length > 0)]));
      const boardMap = new Map(boardsData.map((b: any) => [b.id, b]));

      // Map edge function conversation data to ConversationDetail
      const convDetails: ConversationDetail[] = edgeConversations.map((ec: any) => {
        let boardName = null;
        let stageName = null;
        if (ec.board_id) {
          const board = boardMap.get(ec.board_id);
          if (board) {
            boardName = board.name;
            const stages = board.stages as any[];
            if (stages && ec.status) {
              const stage = stages.find((s: any) => s.id === ec.status);
              stageName = stage?.name || ec.status;
            }
          }
        }

        return {
          phone: ec.phone,
          instance_name: ec.instance_name,
          agent_name: ec.agent_id ? (agentMap.get(ec.agent_id) || 'Desconhecido') : 'Sem agente',
          agent_id: ec.agent_id || '',
          is_active: ec.is_active ?? false,
          is_blocked: ec.is_blocked ?? false,
          contact_name: ec.contact_name || null,
          lead_name: ec.lead_name || null,
          lead_id: ec.lead_id || null,
          lead_status: ec.lead_status || null,
          lead_city: ec.lead_city || null,
          lead_state: ec.lead_state || null,
          lead_acolhedor: ec.lead_acolhedor || null,
          board_id: ec.board_id || null,
          board_name: boardName,
          stage_name: stageName,
          last_inbound_at: ec.last_inbound_at || null,
          last_outbound_at: ec.last_outbound_at || null,
          total_messages: ec.total_messages || 0,
          inbound_count: ec.inbound_count || 0,
          outbound_count: ec.outbound_count || 0,
          followup_count: ec.followup_count || 0,
          has_followup_config: ec.agent_id ? (agentFollowupMap.get(ec.agent_id) || false) : false,
          time_without_response: ec.time_without_response ?? null,
          campaign_name: ec.campaign_name || null,
          activated_by: ec.activated_by || null,
          activated_at: ec.activated_at || null,
          whatsapp_group_id: ec.whatsapp_group_id || null,
          created_at: ec.created_at || null,
        };
      });

      setConversations(convDetails);

      // Agent stats from edge function
      const edgeAgents = agentsEdgeRes?.data || [];
      const edgeAgentMap = new Map(edgeAgents.map((ea: any) => [ea.id, ea]));

      const statsMap = new Map<string, AgentStats>();
      agentsData.forEach((a: any) => {
        const edgeAgent = edgeAgentMap.get(a.id) as any;
        statsMap.set(a.id, {
          agent_id: a.id, agent_name: a.shortcut_name,
          total_conversations: edgeAgent?.conversas_ativas || 0,
          active_conversations: edgeAgent?.conversas_ativas || 0,
          paused_conversations: 0, inactive_conversations: 0,
          total_messages_sent: 0, total_messages_received: 0, response_rate: 0,
          conversations_by_stage: {}, followups_sent: 0, leads_closed: 0, leads_refused: 0, without_response_count: 0,
        });
      });

      // Enrich agent stats from conversation details
      convDetails.forEach(c => {
        const stat = statsMap.get(c.agent_id);
        if (!stat) return;
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
        .select('id, full_name, default_instance_id');

      if (profilesData && profilesData.length > 0) {
        const instanceIds = [...new Set(profilesData.map((p: any) => p.default_instance_id).filter(Boolean))];
        let instMap = new Map<string, string>();
        if (instanceIds.length > 0) {
          const { data: instancesData } = await supabase
            .from('whatsapp_instances')
            .select('id, instance_name')
            .in('id', instanceIds);
          instMap = new Map((instancesData || []).map((i: any) => [i.id, i.instance_name]));
        }
        setUsers(profilesData
          .filter((p: any) => p.full_name)
          .map((p: any) => ({
            id: p.id,
            full_name: p.full_name,
            instance_name: p.default_instance_id ? instMap.get(p.default_instance_id) || null : null,
          }))
        );
      }

    } catch (error) {
      console.error('Error fetching agent monitor data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return { agents, conversations, agentStats, referrals, redirections, boards, users, loading, fetchData };
}
