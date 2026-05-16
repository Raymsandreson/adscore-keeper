import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { endOfDay } from 'date-fns';
import type { AgentData, ConversationDetail, AgentStats, ReferralData, BoardData, RedirectionData, UserData } from '../types';

/**
 * Estratégia híbrida (memory: hybrid-routing-persistence-policy):
 *  - EXTERNO (externalSupabase): dados de negócio reais
 *      whatsapp_messages, leads, contacts, kanban_boards, wjia_command_shortcuts,
 *      agent_group_redirections
 *  - CLOUD (supabase): identidade de conversa/agente + auth/perfis
 *      whatsapp_conversation_agents, profiles, whatsapp_instances,
 *      ambassador_referrals, ambassador_campaigns
 *
 * A edge `monitor-data` retorna apenas a "casca" (phone + agent_id), não os
 * enriquecimentos (lead_name, board, contagens). Por isso enriquecemos aqui.
 */
export function useMonitorData() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [conversations, setConversations] = useState<ConversationDetail[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [referrals, setReferrals] = useState<ReferralData[]>([]);
  const [redirections, setRedirections] = useState<RedirectionData[]>([]);
  const [boards, setBoards] = useState<BoardData[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (dateRange: { from: Date; to: Date }, _selectedPeriod?: string) => {
    setLoading(true);
    try {
      await ensureExternalSession().catch((e) => console.warn('[Monitor IA] external session:', e?.message));
      const startISO = dateRange.from.toISOString();
      const endISO = endOfDay(dateRange.to).toISOString();

      // === FETCH PARALELO (Externo + Cloud) ===
      const [
        agentsRes,            // EXTERNO: catálogo de agentes IA
        boardsRes,            // EXTERNO: kanban
        redirectionsRes,      // EXTERNO: redirecionamentos
        convAgentsRes,        // CLOUD:  estado da conversa (vinculo phone↔agent)
        referralsRes,         // CLOUD:  indicações
      ] = await Promise.all([
        externalSupabase.from('wjia_command_shortcuts')
          .select('id, shortcut_name, description, is_active, followup_steps, followup_repeat_forever')
          .order('shortcut_name'),
        externalSupabase.from('kanban_boards').select('id, name, stages'),
        externalSupabase.from('agent_group_redirections')
          .select('id, agent_name, phone, instance_name, group_jid, notify_instance_name, group_message, private_notification, created_at')
          .gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }),
        externalSupabase.from('whatsapp_conversation_agents')
          .select('id, phone, instance_name, agent_id, is_active, is_blocked, activated_by, created_at, human_paused_until')
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase.from('ambassador_referrals')
          .select('id, ambassador_id, contact_id, lead_id, status, created_at, campaign_id, notes, member_user_id')
          .gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: false }),
      ]);

      const agentsData = agentsRes.data || [];
      const boardsData = boardsRes.data || [];
      const convAgentsData = convAgentsRes.data || [];

      setAgents(agentsData as AgentData[]);
      setBoards(boardsData.map((b: any) => ({ id: b.id, name: b.name, stages: b.stages || [] })));

      const agentMap = new Map(agentsData.map((a: any) => [a.id, a.shortcut_name]));
      const agentFollowupMap = new Map(
        agentsData.map((a: any) => [a.id, !!(a.followup_steps && Array.isArray(a.followup_steps) && a.followup_steps.length > 0)])
      );
      const boardMap = new Map(boardsData.map((b: any) => [b.id, b]));

      // === ENRICHMENT: phones únicos para buscar mensagens + leads ===
      const phones = [...new Set(convAgentsData.map((c: any) => c.phone).filter(Boolean))];

      // Mensagens recentes (Externo) — últimas N para calcular last_in/out e counts
      // Limite alto pra não estourar 1000 default mas evitar puxar histórico antigo
      const msgsSince = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(); // últimos 30d
      let messagesData: any[] = [];
      if (phones.length > 0) {
        // chunks de 100 phones (limite IN)
        for (let i = 0; i < phones.length; i += 100) {
          const chunk = phones.slice(i, i + 100);
          const { data } = await externalSupabase
            .from('whatsapp_messages')
            .select('phone, instance_name, direction, created_at, lead_id, contact_id, contact_name, campaign_name')
            .in('phone', chunk)
            .gte('created_at', msgsSince)
            .order('created_at', { ascending: false })
            .limit(5000);
          if (data) messagesData.push(...data);
        }
      }

      // Aggregar mensagens por (phone+instance)
      const msgKey = (p: string, i: string) => `${p}::${(i || '').toLowerCase()}`;
      const msgAgg = new Map<string, {
        last_inbound_at: string | null;
        last_outbound_at: string | null;
        inbound_count: number;
        outbound_count: number;
        total_messages: number;
        contact_name: string | null;
        lead_id: string | null;
        contact_id: string | null;
        campaign_name: string | null;
      }>();
      for (const m of messagesData) {
        const k = msgKey(m.phone, m.instance_name);
        let a = msgAgg.get(k);
        if (!a) {
          a = { last_inbound_at: null, last_outbound_at: null, inbound_count: 0, outbound_count: 0, total_messages: 0, contact_name: null, lead_id: null, contact_id: null, campaign_name: null };
          msgAgg.set(k, a);
        }
        a.total_messages++;
        if (m.direction === 'inbound') {
          a.inbound_count++;
          if (!a.last_inbound_at || m.created_at > a.last_inbound_at) a.last_inbound_at = m.created_at;
        } else if (m.direction === 'outbound') {
          a.outbound_count++;
          if (!a.last_outbound_at || m.created_at > a.last_outbound_at) a.last_outbound_at = m.created_at;
        }
        if (!a.contact_name && m.contact_name) a.contact_name = m.contact_name;
        if (!a.lead_id && m.lead_id) a.lead_id = m.lead_id;
        if (!a.contact_id && m.contact_id) a.contact_id = m.contact_id;
        if (!a.campaign_name && m.campaign_name) a.campaign_name = m.campaign_name;
      }

      // Leads (Externo) — buscar pelos lead_ids encontrados nas mensagens
      const leadIdsFromMsgs = [...new Set(Array.from(msgAgg.values()).map(v => v.lead_id).filter(Boolean) as string[])];
      const leadMap = new Map<string, any>();
      if (leadIdsFromMsgs.length > 0) {
        for (let i = 0; i < leadIdsFromMsgs.length; i += 200) {
          const chunk = leadIdsFromMsgs.slice(i, i + 200);
          const { data } = await externalSupabase
            .from('leads')
            .select('id, lead_name, lead_status, status, city, state, acolhedor, board_id, whatsapp_group_id, followup_count')
            .in('id', chunk);
          (data || []).forEach((l: any) => leadMap.set(l.id, l));
        }
      }

      // === MONTAR ConversationDetail ===
      const convDetails: ConversationDetail[] = convAgentsData.map((ca: any) => {
        const agg = msgAgg.get(msgKey(ca.phone, ca.instance_name));
        const lead = agg?.lead_id ? leadMap.get(agg.lead_id) : null;

        let boardName: string | null = null;
        let stageName: string | null = null;
        if (lead?.board_id) {
          const board = boardMap.get(lead.board_id);
          if (board) {
            boardName = (board as any).name;
            const stages = (board as any).stages as any[];
            if (stages && lead.status) {
              const stage = stages.find((s: any) => s.id === lead.status);
              stageName = stage?.name || lead.status;
            }
          }
        }

        const lastInbound = agg?.last_inbound_at || null;
        const lastOutbound = agg?.last_outbound_at || null;
        let timeWithoutResponse: number | null = null;
        if (lastInbound) {
          const lastIn = new Date(lastInbound).getTime();
          const lastOut = lastOutbound ? new Date(lastOutbound).getTime() : 0;
          if (lastIn > lastOut) {
            timeWithoutResponse = Math.floor((Date.now() - lastIn) / 60000);
          }
        }

        return {
          phone: ca.phone,
          instance_name: ca.instance_name,
          agent_name: ca.agent_id ? (agentMap.get(ca.agent_id) || 'Desconhecido') : 'Sem agente',
          agent_id: ca.agent_id || '',
          is_active: ca.is_active ?? false,
          is_blocked: ca.is_blocked ?? false,
          contact_name: agg?.contact_name || null,
          lead_name: lead?.lead_name || null,
          lead_id: agg?.lead_id || null,
          lead_status: lead?.lead_status || null,
          lead_city: lead?.city || null,
          lead_state: lead?.state || null,
          lead_acolhedor: lead?.acolhedor || null,
          board_id: lead?.board_id || null,
          board_name: boardName,
          stage_name: stageName,
          last_inbound_at: lastInbound,
          last_outbound_at: lastOutbound,
          total_messages: agg?.total_messages || 0,
          inbound_count: agg?.inbound_count || 0,
          outbound_count: agg?.outbound_count || 0,
          followup_count: lead?.followup_count || 0,
          has_followup_config: ca.agent_id ? (agentFollowupMap.get(ca.agent_id) || false) : false,
          time_without_response: timeWithoutResponse,
          campaign_name: agg?.campaign_name || null,
          activated_by: ca.activated_by || null,
          activated_at: ca.created_at || null,
          whatsapp_group_id: lead?.whatsapp_group_id || null,
          created_at: ca.created_at || null,
        };
      });

      setConversations(convDetails);

      // === AGENT STATS ===
      const statsMap = new Map<string, AgentStats>();
      agentsData.forEach((a: any) => {
        statsMap.set(a.id, {
          agent_id: a.id, agent_name: a.shortcut_name,
          total_conversations: 0, active_conversations: 0,
          paused_conversations: 0, inactive_conversations: 0,
          total_messages_sent: 0, total_messages_received: 0, response_rate: 0,
          conversations_by_stage: {}, followups_sent: 0, leads_closed: 0, leads_refused: 0, without_response_count: 0,
        });
      });

      convDetails.forEach(c => {
        const stat = statsMap.get(c.agent_id);
        if (!stat) return;
        stat.total_conversations++;
        if (c.is_active) stat.active_conversations++;
        else stat.inactive_conversations++;
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

      // === REFERRALS (Cloud) ===
      const ambassadorIds = [...new Set((referralsRes.data || []).map((r: any) => r.ambassador_id))];
      let ambassadorNames = new Map<string, string>();
      if (ambassadorIds.length > 0) {
        const { data: contacts } = await externalSupabase.from('contacts').select('id, full_name').in('id', ambassadorIds);
        (contacts || []).forEach((c: any) => ambassadorNames.set(c.id, c.full_name));
      }

      const contactIds = [...new Set((referralsRes.data || []).map((r: any) => r.contact_id).filter(Boolean))];
      let contactNames = new Map<string, string>();
      if (contactIds.length > 0) {
        const { data: contacts } = await externalSupabase.from('contacts').select('id, full_name').in('id', contactIds);
        (contacts || []).forEach((c: any) => contactNames.set(c.id, c.full_name));
      }

      const refLeadIds = [...new Set((referralsRes.data || []).map((r: any) => r.lead_id).filter(Boolean))];
      let leadNames = new Map<string, string>();
      if (refLeadIds.length > 0) {
        const { data: lds } = await externalSupabase.from('leads').select('id, lead_name').in('id', refLeadIds);
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

      // === USERS (Cloud: profiles + instances) ===
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
      console.error('[Monitor IA] Erro ao buscar dados híbridos:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return { agents, conversations, agentStats, referrals, redirections, boards, users, loading, fetchData };
}
