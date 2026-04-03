import { useState, useMemo } from 'react';
import type { ConversationDetail, CaseStatus, BoardData } from '../types';
import { getCaseStatus } from '../utils';

export function useMonitorFilters(conversations: ConversationDetail[], boards: BoardData[]) {
  const [agentFilter, setAgentFilter] = useState('all');
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [boardFilter, setBoardFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [caseStatusFilter, setCaseStatusFilter] = useState<CaseStatus | 'all'>('all');
  const [agentActiveFilter, setAgentActiveFilter] = useState<'all' | 'ativo' | 'pausado'>('all');
  const [followupConfigFilter, setFollowupConfigFilter] = useState<'all' | 'com_followup' | 'sem_followup'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const uniqueInstances = useMemo(() => [...new Set(conversations.map(c => c.instance_name).filter(Boolean))].sort() as string[], [conversations]);
  const uniqueBoards = useMemo(() => {
    const boardIds = new Set(conversations.map(c => c.board_id).filter(Boolean));
    return boards.filter(b => boardIds.has(b.id));
  }, [conversations, boards]);
  const uniqueCampaigns = useMemo(() => [...new Set(conversations.map(c => c.campaign_name).filter(Boolean))].sort() as string[], [conversations]);

  const applyBaseFilters = (c: ConversationDetail) => {
    if (agentFilter !== 'all' && c.agent_id !== agentFilter) return false;
    if (instanceFilter !== 'all' && c.instance_name !== instanceFilter) return false;
    if (boardFilter !== 'all' && c.board_id !== boardFilter) return false;
    if (campaignFilter !== 'all') {
      if (campaignFilter === '__none__' && c.campaign_name) return false;
      if (campaignFilter !== '__none__' && c.campaign_name !== campaignFilter) return false;
    }
    return true;
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (!applyBaseFilters(c)) return false;
      if (caseStatusFilter !== 'all' && getCaseStatus(c) !== caseStatusFilter) return false;
      if (agentActiveFilter === 'ativo' && !c.is_active) return false;
      if (agentActiveFilter === 'pausado' && (c.is_active || c.is_blocked)) return false;
      if (followupConfigFilter === 'com_followup' && !c.has_followup_config) return false;
      if (followupConfigFilter === 'sem_followup' && c.has_followup_config) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return c.phone.includes(q) || c.contact_name?.toLowerCase().includes(q) || c.lead_name?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [conversations, agentFilter, instanceFilter, boardFilter, campaignFilter, caseStatusFilter, agentActiveFilter, followupConfigFilter, searchQuery]);

  const pipelineCounts = useMemo(() => {
    const base = conversations.filter(applyBaseFilters);
    return {
      sem_resposta: base.filter(c => getCaseStatus(c) === 'sem_resposta').length,
      em_andamento: base.filter(c => getCaseStatus(c) === 'em_andamento').length,
      fechado: base.filter(c => getCaseStatus(c) === 'fechado').length,
      recusado: base.filter(c => getCaseStatus(c) === 'recusado').length,
      inviavel: base.filter(c => getCaseStatus(c) === 'inviavel').length,
    };
  }, [conversations, agentFilter, instanceFilter, boardFilter, campaignFilter]);

  const referralStats = (referrals: { status: string }[]) => ({
    total: referrals.length,
    pending: referrals.filter(r => r.status === 'pending').length,
    contacted: referrals.filter(r => r.status === 'contacted').length,
    converted: referrals.filter(r => r.status === 'converted').length,
    lost: referrals.filter(r => r.status === 'lost').length,
  });

  return {
    filters: {
      agentFilter, setAgentFilter,
      instanceFilter, setInstanceFilter,
      boardFilter, setBoardFilter,
      campaignFilter, setCampaignFilter,
      caseStatusFilter, setCaseStatusFilter,
      agentActiveFilter, setAgentActiveFilter,
      followupConfigFilter, setFollowupConfigFilter,
      searchQuery, setSearchQuery,
    },
    filteredConversations,
    pipelineCounts,
    uniqueInstances,
    uniqueBoards,
    uniqueCampaigns,
    referralStats,
    applyBaseFilters,
  };
}
