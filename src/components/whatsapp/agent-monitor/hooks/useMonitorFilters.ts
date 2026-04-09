import { useState, useMemo } from 'react';
import type { ConversationDetail, CaseStatus, BoardData, UserData } from '../types';
import { getCaseStatus } from '../utils';

export function useMonitorFilters(conversations: ConversationDetail[], boards: BoardData[], users: UserData[] = []) {
  const [agentFilter, setAgentFilter] = useState('all');
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [boardFilter, setBoardFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [acolhedorFilter, setAcolhedorFilter] = useState('all');
  const [caseStatusFilter, setCaseStatusFilter] = useState<CaseStatus | 'all'>('all');
  const [agentActiveFilter, setAgentActiveFilter] = useState<'all' | 'ativo'>('all');
  const [followupConfigFilter, setFollowupConfigFilter] = useState<'all' | 'com_followup' | 'sem_followup'>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const uniqueInstances = useMemo(() => [...new Set(conversations.map(c => c.instance_name).filter(Boolean))].sort() as string[], [conversations]);
  const uniqueBoards = useMemo(() => {
    const boardIds = new Set(conversations.map(c => c.board_id).filter(Boolean));
    return boards.filter(b => boardIds.has(b.id));
  }, [conversations, boards]);
  const uniqueCampaigns = useMemo(() => [...new Set(conversations.map(c => c.campaign_name).filter(Boolean))].sort() as string[], [conversations]);
  const uniqueAcolhedores = useMemo(() => [...new Set(conversations.map(c => c.lead_acolhedor).filter(Boolean))].sort() as string[], [conversations]);
  const uniqueUsers = useMemo(() => {
    // All users with profiles, regardless of instance
    return users;
  }, [users]);

  // When user filter is active, resolve to acolhedor name and optionally instance
  const effectiveInstanceFilter = useMemo(() => {
    if (userFilter !== 'all') {
      const user = users.find(u => u.id === userFilter);
      // If user has a unique instance, also filter by it
      if (user?.instance_name) {
        const usersOnSameInstance = users.filter(u => u.instance_name === user.instance_name);
        if (usersOnSameInstance.length === 1) return user.instance_name;
      }
    }
    return instanceFilter;
  }, [userFilter, instanceFilter, users]);

  const effectiveAcolhedorFromUser = useMemo(() => {
    if (userFilter !== 'all') {
      const user = users.find(u => u.id === userFilter);
      return user?.full_name || null;
    }
    return null;
  }, [userFilter, users]);

  const applyBaseFilters = (c: ConversationDetail) => {
    if (agentFilter !== 'all') {
      if (agentFilter === '__none__' && c.agent_id) return false;
      if (agentFilter !== '__none__' && c.agent_id !== agentFilter) return false;
    }
    if (effectiveInstanceFilter !== 'all' && c.instance_name !== effectiveInstanceFilter) return false;
    if (boardFilter !== 'all' && c.board_id !== boardFilter) return false;
    if (campaignFilter !== 'all') {
      if (campaignFilter === '__none__' && c.campaign_name) return false;
      if (campaignFilter !== '__none__' && c.campaign_name !== campaignFilter) return false;
    }
    // User filter: filter by acolhedor name
    if (effectiveAcolhedorFromUser) {
      if (c.lead_acolhedor !== effectiveAcolhedorFromUser) return false;
    } else if (acolhedorFilter !== 'all') {
      if (acolhedorFilter === '__none__' && c.lead_acolhedor) return false;
      if (acolhedorFilter !== '__none__' && c.lead_acolhedor !== acolhedorFilter) return false;
    }
    return true;
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (!applyBaseFilters(c)) return false;
      if (caseStatusFilter !== 'all' && getCaseStatus(c) !== caseStatusFilter) return false;
      if (agentActiveFilter === 'ativo' && !c.is_active) return false;
      if (followupConfigFilter === 'com_followup' && !c.has_followup_config) return false;
      if (followupConfigFilter === 'sem_followup' && c.has_followup_config) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return c.phone.includes(q) || c.contact_name?.toLowerCase().includes(q) || c.lead_name?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [conversations, agentFilter, effectiveInstanceFilter, boardFilter, campaignFilter, acolhedorFilter, effectiveAcolhedorFromUser, caseStatusFilter, agentActiveFilter, followupConfigFilter, searchQuery]);

  const pipelineCounts = useMemo(() => {
    const base = conversations.filter(applyBaseFilters);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      novas: base.filter(c => {
        if (!c.created_at) return false;
        const created = new Date(c.created_at);
        return created >= today;
      }).length,
      sem_resposta: base.filter(c => getCaseStatus(c) === 'sem_resposta').length,
      em_andamento: base.filter(c => getCaseStatus(c) === 'em_andamento').length,
      fechado: base.filter(c => getCaseStatus(c) === 'fechado').length,
      recusado: base.filter(c => getCaseStatus(c) === 'recusado').length,
      inviavel: base.filter(c => getCaseStatus(c) === 'inviavel').length,
      bloqueado: base.filter(c => getCaseStatus(c) === 'bloqueado').length,
    };
  }, [conversations, agentFilter, effectiveInstanceFilter, boardFilter, campaignFilter, acolhedorFilter, effectiveAcolhedorFromUser]);

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
      acolhedorFilter, setAcolhedorFilter,
      caseStatusFilter, setCaseStatusFilter,
      agentActiveFilter, setAgentActiveFilter,
      followupConfigFilter, setFollowupConfigFilter,
      userFilter, setUserFilter,
      searchQuery, setSearchQuery,
    },
    effectiveInstanceFilter,
    effectiveAcolhedorFromUser,
    filteredConversations,
    pipelineCounts,
    uniqueInstances,
    uniqueBoards,
    uniqueCampaigns,
    uniqueAcolhedores,
    uniqueUsers,
    referralStats,
    applyBaseFilters,
  };
}
