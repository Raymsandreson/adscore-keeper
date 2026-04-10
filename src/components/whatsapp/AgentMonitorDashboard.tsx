import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ArrowRightLeft, ClipboardList, Heart, LayoutDashboard, Loader2 } from 'lucide-react';

import { useMonitorData } from './agent-monitor/hooks/useMonitorData';
import { useMonitorFilters } from './agent-monitor/hooks/useMonitorFilters';
import { useBatchActions } from './agent-monitor/hooks/useBatchActions';
import { useDashboardMetrics } from './agent-monitor/hooks/useDashboardMetrics';
import { useOperationalGaps, type GapType } from './agent-monitor/hooks/useOperationalGaps';
import type { ConversationDetail, CaseStatus } from './agent-monitor/types';
import { convKey } from './agent-monitor/utils';

import { MonitorHeader } from './agent-monitor/components/MonitorHeader';
import { UnifiedMonitorTab } from './agent-monitor/components/UnifiedMonitorTab';
import { CaseListSheet } from './agent-monitor/components/CaseListSheet';
import { OperationalDetailSheet, type OperationalMetricType, type OperationalFilters } from './agent-monitor/components/OperationalDetailSheet';
import { NewConversationsSheet } from './agent-monitor/components/NewConversationsSheet';
import { GapDetailSheet } from './agent-monitor/components/GapDetailSheet';
import { ReferralsTab } from './agent-monitor/components/ReferralsTab';
import { RedirectionsTab } from './agent-monitor/components/RedirectionsTab';
import { AIActivitiesPanel } from './AIActivitiesPanel';
import { AIActivityPromptDialog } from './AIActivityPromptDialog';
import { DashboardChatPreview } from './DashboardChatPreview';
import { GroupQueuePanel, useGroupQueueCount } from './agent-monitor/components/GroupQueuePanel';

export function AgentMonitorDashboard() {
  const { toast } = useToast();
  const queueCount = useGroupQueueCount();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({ from: new Date(), to: new Date() });
  const [sheetStatusFilter, setSheetStatusFilter] = useState<CaseStatus | null>(null);
  const [newConvsSheetOpen, setNewConvsSheetOpen] = useState(false);
  const [chatPreview, setChatPreview] = useState<ConversationDetail | null>(null);
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDialogLead, setPromptDialogLead] = useState<{ id: string; name: string } | null>(null);
  const [operationalSheet, setOperationalSheet] = useState<OperationalMetricType | null>(null);
  const [gapSheet, setGapSheet] = useState<GapType | null>(null);
  const [closingAcolhedorFilter, setClosingAcolhedorFilter] = useState<string | null>(null);

  const { agents, conversations, agentStats, referrals, redirections, boards, users, loading: monitorLoading, fetchData: fetchDataRaw } = useMonitorData();
  const { metrics, metricsLoading, fetchMetrics } = useDashboardMetrics();
  const { gaps, gapsLoading, fetchGaps } = useOperationalGaps();

  const isLoading = monitorLoading || metricsLoading;
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (isLoading) {
      setAnimatedProgress(5);
      progressRef.current = setInterval(() => {
        setAnimatedProgress(prev => {
          const target = !monitorLoading && metricsLoading ? 70 : !metricsLoading && monitorLoading ? 60 : 45;
          if (prev >= target) return prev;
          return prev + Math.max(1, Math.floor((target - prev) * 0.1));
        });
      }, 300);
    } else {
      setAnimatedProgress(100);
      setTimeout(() => setAnimatedProgress(0), 600);
      if (progressRef.current) clearInterval(progressRef.current);
    }
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [isLoading, monitorLoading, metricsLoading]);

  const fetchData = useCallback(() => {
    fetchDataRaw(dateRange);
    fetchMetrics(dateRange);
    fetchGaps(dateRange);
  }, [fetchDataRaw, fetchMetrics, fetchGaps, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const {
    filters, filteredConversations, pipelineCounts, effectiveInstanceFilter, effectiveAcolhedorFromUser,
    uniqueInstances, uniqueBoards, uniqueCampaigns, uniqueAcolhedores, uniqueUsers, applyBaseFilters,
  } = useMonitorFilters(conversations, boards, users);

  // Build a set of phones managed by the selected agent for cross-referencing
  const agentPhoneSet = useMemo(() => {
    if (filters.agentFilter === 'all') return null;
    if (filters.agentFilter === '__none__') {
      return new Set(conversations.filter(c => !c.agent_id).map(c => c.phone));
    }
    return new Set(conversations.filter(c => c.agent_id === filters.agentFilter).map(c => c.phone));
  }, [conversations, filters.agentFilter]);

  // Use applyBaseFilters from the hook (already handles user filter, instance, acolhedor, etc.)
  const baseFilteredConversations = useMemo(() => conversations.filter(applyBaseFilters), 
    [conversations, applyBaseFilters, filters.agentFilter, effectiveInstanceFilter, filters.boardFilter, filters.campaignFilter, filters.acolhedorFilter, filters.userFilter]);

  // Build phone set from base-filtered conversations for cross-referencing newConvDetails
  const baseFilteredPhoneSet = useMemo(() => {
    const hasActiveFilter = filters.agentFilter !== 'all' || effectiveInstanceFilter !== 'all' || 
      filters.boardFilter !== 'all' || filters.campaignFilter !== 'all' || filters.acolhedorFilter !== 'all' || filters.userFilter !== 'all';
    if (!hasActiveFilter) return null;
    return new Set(baseFilteredConversations.map(c => c.phone));
  }, [baseFilteredConversations, filters.agentFilter, effectiveInstanceFilter, filters.boardFilter, filters.campaignFilter, filters.acolhedorFilter, filters.userFilter]);

  // Filter metrics newConvDetails based on active filters
  const filteredNewConvDetails = useMemo(() => {
    return metrics.newConvDetails.filter(c => {
      if (effectiveInstanceFilter !== 'all' && c.instance_name !== effectiveInstanceFilter) return false;
      if (agentPhoneSet && !agentPhoneSet.has(c.phone)) return false;
      if (baseFilteredPhoneSet && !baseFilteredPhoneSet.has(c.phone)) return false;
      return true;
    });
  }, [metrics.newConvDetails, effectiveInstanceFilter, agentPhoneSet, baseFilteredPhoneSet]);

  // Build a set of lead_ids from filtered conversations for cross-referencing operational metrics
  const operationalFilteredLeadIds = useMemo(() => new Set(
    baseFilteredConversations.map(c => c.lead_id).filter(Boolean) as string[]
  ), [baseFilteredConversations]);

  const filteredClosedLeadDetails = useMemo(() => {
    const hasActiveFilter = filters.agentFilter !== 'all' || effectiveInstanceFilter !== 'all' || 
      filters.boardFilter !== 'all' || filters.campaignFilter !== 'all' || filters.acolhedorFilter !== 'all' || filters.userFilter !== 'all';

    if (!hasActiveFilter) return metrics.closedLeadDetails;

    // Filters that can be applied directly from closedLeadDetails fields
    const needsConversationCrossRef = filters.agentFilter !== 'all' || effectiveInstanceFilter !== 'all' || filters.boardFilter !== 'all';

    return metrics.closedLeadDetails.filter(detail => {
      // Direct field filters (don't depend on conversations)
      if (effectiveAcolhedorFromUser) {
        if (detail.acolhedor.toLowerCase() !== effectiveAcolhedorFromUser.toLowerCase() && detail.acolhedor !== effectiveAcolhedorFromUser) return false;
      } else if (filters.acolhedorFilter !== 'all') {
        if (filters.acolhedorFilter === '__none__' && detail.acolhedor !== 'Sem acolhedor') return false;
        if (filters.acolhedorFilter !== '__none__' && detail.acolhedor !== filters.acolhedorFilter) return false;
      }

      if (filters.campaignFilter !== 'all') {
        if (filters.campaignFilter === '__none__' && detail.campaign) return false;
        if (filters.campaignFilter !== '__none__' && detail.campaign !== filters.campaignFilter) return false;
      }

      // Cross-reference with conversations only for agent/instance/board filters
      if (needsConversationCrossRef && operationalFilteredLeadIds.size > 0) {
        if (!operationalFilteredLeadIds.has(detail.leadId)) return false;
      } else if (needsConversationCrossRef && operationalFilteredLeadIds.size === 0) {
        return false;
      }

      return true;
    });
  }, [metrics.closedLeadDetails, operationalFilteredLeadIds, effectiveAcolhedorFromUser, filters.agentFilter, effectiveInstanceFilter, filters.boardFilter, filters.campaignFilter, filters.acolhedorFilter, filters.userFilter]);

  const filteredClosedByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const detail of filteredClosedLeadDetails) {
      map.set(detail.acolhedor, (map.get(detail.acolhedor) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredClosedLeadDetails]);

  const operationalFiltersObj: OperationalFilters = useMemo(() => ({
    instanceFilter: effectiveInstanceFilter,
    acolhedorFilter: filters.acolhedorFilter,
    agentFilter: filters.agentFilter,
    boardFilter: filters.boardFilter,
    campaignFilter: filters.campaignFilter,
  }), [effectiveInstanceFilter, filters.acolhedorFilter, filters.agentFilter, filters.boardFilter, filters.campaignFilter]);

  // Filter dashboard metrics counts based on active filters
  const filteredMetrics = useMemo(() => {
    const filtered = filteredNewConvDetails;
    const respondedCount = filtered.filter(c => c.was_responded).length;
    const responseTimes = filtered.filter(c => c.response_time_minutes !== null).map(c => c.response_time_minutes!);
    const avgResponseTimeMin = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;

    const hasActiveFilter = filters.agentFilter !== 'all' || effectiveInstanceFilter !== 'all' || 
      filters.boardFilter !== 'all' || filters.campaignFilter !== 'all' || filters.acolhedorFilter !== 'all' || filters.userFilter !== 'all';
    const needsConversationCrossRef = filters.agentFilter !== 'all' || effectiveInstanceFilter !== 'all' || filters.boardFilter !== 'all';

    const filterOp = (detail: { acolhedor: string | null; instance_name: string | null; lead_id: string | null }) => {
      if (!hasActiveFilter) return true;
      
      // Direct field filters first (independent of conversations)
      if (effectiveInstanceFilter !== 'all' && detail.instance_name && detail.instance_name !== effectiveInstanceFilter) return false;
      if (effectiveAcolhedorFromUser) {
        if (detail.acolhedor && detail.acolhedor !== effectiveAcolhedorFromUser) return false;
      } else if (filters.acolhedorFilter !== 'all') {
        if (filters.acolhedorFilter === '__none__' && detail.acolhedor) return false;
        if (filters.acolhedorFilter !== '__none__' && detail.acolhedor && detail.acolhedor !== filters.acolhedorFilter) return false;
      }
      
      // Only cross-reference with conversations for agent/board filters that need it
      if (needsConversationCrossRef && detail.lead_id) {
        if (operationalFilteredLeadIds.size === 0) return false;
        if (!operationalFilteredLeadIds.has(detail.lead_id)) return false;
      }
      
      return true;
    };

    const filteredSignedDocs = metrics.signedDocsDetails.filter(filterOp);
    const filteredPendingDocs = metrics.pendingDocsDetails.filter(filterOp);
    const filteredGroups = metrics.groupsDetails.filter(filterOp);
    const filteredCases = metrics.casesDetails.filter(filterOp);
    const filteredProcesses = metrics.processesDetails.filter(filterOp);

    const closedByAgentDetailMap = new Map<string, { ai: number; assisted: number; human: number; noInteraction: number }>();
    const closedByCampaignMap = new Map<string, number>();
    let closedByAI = 0;
    let closedAssisted = 0;
    let closedWithHuman = 0;
    let closedNoInteraction = 0;

    for (const detail of filteredClosedLeadDetails) {
      if (!closedByAgentDetailMap.has(detail.acolhedor)) {
        closedByAgentDetailMap.set(detail.acolhedor, { ai: 0, assisted: 0, human: 0, noInteraction: 0 });
      }
      closedByAgentDetailMap.get(detail.acolhedor)![detail.classification]++;
      if (detail.campaign) {
        closedByCampaignMap.set(detail.campaign, (closedByCampaignMap.get(detail.campaign) || 0) + 1);
      }

      if (detail.classification === 'ai') closedByAI++;
      else if (detail.classification === 'assisted') closedAssisted++;
      else if (detail.classification === 'human') closedWithHuman++;
      else closedNoInteraction++;
    }

    const filteredClosedByAgentDetailed = Array.from(closedByAgentDetailMap.entries())
      .map(([agent, d]) => ({ agent, ai: d.ai, assisted: d.assisted, human: d.human, noInteraction: d.noInteraction, total: d.ai + d.assisted + d.human + d.noInteraction }))
      .sort((a, b) => b.total - a.total);

    const filteredClosedByCampaign = Array.from(closedByCampaignMap.entries())
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count);

    const closedTotal = closedByAI + closedAssisted + closedWithHuman + closedNoInteraction;

    return {
      ...metrics,
      newConversations: filtered.length,
      responseRate: filtered.length > 0 ? Math.round((respondedCount / filtered.length) * 100) : 0,
      avgResponseTimeMin,
      respondedCount,
      totalInbound: filtered.length,
      newConvDetails: filtered,
      closedByAgent: filteredClosedByAgent,
      closedByAgentDetailed: filteredClosedByAgentDetailed,
      closedByCampaign: filteredClosedByCampaign,
      closedByAI, closedAssisted, closedWithHuman, closedNoInteraction, closedTotal,
      signedDocuments: filteredSignedDocs.length,
      pendingDocuments: filteredPendingDocs.length,
      groupsCreated: filteredGroups.length,
      casesCreated: filteredCases.length,
      processesCreated: filteredProcesses.length,
      signedDocsDetails: filteredSignedDocs,
      pendingDocsDetails: filteredPendingDocs,
      groupsDetails: filteredGroups,
      casesDetails: filteredCases,
      processesDetails: filteredProcesses,
    };
  }, [metrics, filteredNewConvDetails, filteredClosedLeadDetails, filteredClosedByAgent, operationalFilteredLeadIds, effectiveAcolhedorFromUser, filters.agentFilter, effectiveInstanceFilter, filters.boardFilter, filters.campaignFilter, filters.acolhedorFilter, filters.userFilter]);

  // Filter gaps by acolhedor
  const filteredGaps = useMemo(() => {
    const filterByAcolhedor = (items: typeof gaps.closedWithoutGroup) => {
      // User filter takes priority (maps user to acolhedor name)
      if (effectiveAcolhedorFromUser) {
        return items.filter(i => i.acolhedor === effectiveAcolhedorFromUser);
      }
      if (filters.acolhedorFilter === 'all') return items;
      if (filters.acolhedorFilter === '__none__') return items.filter(i => !i.acolhedor);
      return items.filter(i => i.acolhedor === filters.acolhedorFilter);
    };
    return {
      closedWithoutGroup: filterByAcolhedor(gaps.closedWithoutGroup),
      withGroupWithoutCase: filterByAcolhedor(gaps.withGroupWithoutCase),
      casesWithoutProcess: filterByAcolhedor(gaps.casesWithoutProcess),
      processesWithoutActivity: filterByAcolhedor(gaps.processesWithoutActivity),
    };
  }, [gaps, filters.acolhedorFilter, effectiveAcolhedorFromUser]);

  const batch = useBatchActions(conversations, fetchData);

  const handleOpenChat = (c: ConversationDetail) => setChatPreview(c);

  const handleGenerateActivity = (c: ConversationDetail) => {
    if (c.lead_id) {
      setPromptDialogLead({ id: c.lead_id, name: c.contact_name || c.phone });
      setPromptDialogOpen(true);
    }
  };

  const handleEventClick = (event: any) => {
    if (event.phone && event.instance_name) {
      const match = conversations.find(c => c.phone === event.phone && c.instance_name === event.instance_name);
      if (match) {
        setChatPreview(match);
      } else {
        setChatPreview({
          phone: event.phone, instance_name: event.instance_name,
          agent_name: event.agent_name || '', agent_id: '',
          is_active: false, is_blocked: false,
          contact_name: event.contact_name || null, lead_name: null,
          lead_id: event.lead_id || null, lead_status: null,
          lead_city: null, lead_state: null, lead_acolhedor: null,
          board_id: null, board_name: null, stage_name: null,
          last_inbound_at: null, last_outbound_at: null,
          total_messages: 0, inbound_count: 0, outbound_count: 0,
          followup_count: 0, has_followup_config: false,
          time_without_response: null, campaign_name: null,
          activated_by: null, activated_at: null, whatsapp_group_id: null, created_at: null,
        });
      }
    }
  };

  const handleNewConvChatOpen = (phone: string, instanceName: string | null) => {
    setNewConvsSheetOpen(false);
    const match = conversations.find(c => c.phone === phone && (!instanceName || c.instance_name === instanceName));
    if (match) {
      setChatPreview(match);
    } else {
      setChatPreview({
        phone, instance_name: instanceName || '',
        agent_name: '', agent_id: '',
        is_active: false, is_blocked: false,
        contact_name: null, lead_name: null,
        lead_id: null, lead_status: null,
        lead_city: null, lead_state: null, lead_acolhedor: null,
        board_id: null, board_name: null, stage_name: null,
        last_inbound_at: null, last_outbound_at: null,
        total_messages: 0, inbound_count: 0, outbound_count: 0,
        followup_count: 0, has_followup_config: false,
        time_without_response: null, campaign_name: null,
        activated_by: null, activated_at: null, whatsapp_group_id: null, created_at: null,
      });
    }
  };

  const filterBarProps = {
    agents, uniqueInstances, uniqueBoards, uniqueCampaigns, uniqueAcolhedores, uniqueUsers,
    agentFilter: filters.agentFilter, setAgentFilter: filters.setAgentFilter,
    instanceFilter: filters.instanceFilter, setInstanceFilter: filters.setInstanceFilter,
    boardFilter: filters.boardFilter, setBoardFilter: filters.setBoardFilter,
    campaignFilter: filters.campaignFilter, setCampaignFilter: filters.setCampaignFilter,
    acolhedorFilter: filters.acolhedorFilter, setAcolhedorFilter: filters.setAcolhedorFilter,
    agentActiveFilter: filters.agentActiveFilter, setAgentActiveFilter: filters.setAgentActiveFilter,
    followupConfigFilter: filters.followupConfigFilter, setFollowupConfigFilter: filters.setFollowupConfigFilter,
    userFilter: filters.userFilter, setUserFilter: filters.setUserFilter,
  };

  const batchProps = {
    selectedKeys: batch.selectedKeys,
    selectedCount: batch.selectedKeys.size,
    batchProcessing: batch.batchProcessing,
    onSelectAll: batch.selectAll,
    onClearSelection: batch.clearSelection,
    onDeactivate: () => batch.batchAction('deactivate'),
    onAnticipate: () => batch.batchFollowupAction('anticipate'),
    onResume: () => batch.batchFollowupAction('resume'),
  };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <MonitorHeader dateRange={dateRange} setDateRange={setDateRange} loading={isLoading} onRefresh={fetchData} />

      {isLoading && (
        <div className="flex items-center gap-3 px-1">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <Progress value={animatedProgress} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground font-medium shrink-0">{animatedProgress}%</span>
        </div>
      )}

      <Tabs defaultValue="monitor" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 max-w-lg">
          <TabsTrigger value="monitor" className="text-xs flex items-center gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" /> Monitor</TabsTrigger>
          <TabsTrigger value="ai-activities" className="text-xs flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Atividades IA</TabsTrigger>
          <TabsTrigger value="referrals" className="text-xs flex items-center gap-1.5"><Heart className="h-3.5 w-3.5" /> Indicações</TabsTrigger>
          <TabsTrigger value="redirections" className="text-xs flex items-center gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5" /> Redirecionamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="monitor" className="space-y-4">
          <UnifiedMonitorTab
            conversations={conversations} agentStats={agentStats} loading={isLoading}
            pipelineCounts={pipelineCounts}
            onPipelineClick={(s) => { setClosingAcolhedorFilter(null); setSheetStatusFilter(prev => prev === s ? null : s); }}
            activeStatus={sheetStatusFilter}
            onOpenChat={handleOpenChat} onEventClick={handleEventClick}
            dashboardMetrics={filteredMetrics}
            onNewConvsClick={() => setNewConvsSheetOpen(true)}
            onOperationalClick={(type) => setOperationalSheet(type)}
            filterBarProps={filterBarProps}
            gaps={filteredGaps}
            onGapClick={(type) => setGapSheet(type)}
            onClosingDetailClick={(filter) => {
              setClosingAcolhedorFilter(filter.agent || null);
              setSheetStatusFilter('fechado');
            }}
          />
        </TabsContent>

        <TabsContent value="ai-activities" className="space-y-4">
          <GroupQueuePanel />
          <AIActivitiesPanel />
        </TabsContent>
        <TabsContent value="referrals" className="space-y-4"><ReferralsTab referrals={referrals} loading={isLoading} /></TabsContent>
        <TabsContent value="redirections" className="space-y-4"><RedirectionsTab redirections={redirections} loading={isLoading} /></TabsContent>
      </Tabs>

      <CaseListSheet
        statusFilter={sheetStatusFilter} conversations={conversations}
        applyBaseFilters={applyBaseFilters} onClose={() => { setSheetStatusFilter(null); setClosingAcolhedorFilter(null); }}
        onOpenChat={handleOpenChat} generatingLeadId={generatingLeadId} onGenerateActivity={handleGenerateActivity}
        acolhedorPreFilter={closingAcolhedorFilter}
      />

      <OperationalDetailSheet
        open={!!operationalSheet}
        onClose={() => setOperationalSheet(null)}
        metricType={operationalSheet || 'signed_docs'}
        dateRange={dateRange}
        filters={operationalFiltersObj}
        filteredLeadIds={operationalFilteredLeadIds}
        onOpenChat={(phone, instanceName, contactName) => {
          setOperationalSheet(null);
          const match = conversations.find(c => c.phone === phone && (!instanceName || c.instance_name === instanceName));
          if (match) {
            setChatPreview(match);
          } else {
            setChatPreview({
              phone, instance_name: instanceName || '',
              agent_name: '', agent_id: '',
              is_active: false, is_blocked: false,
              contact_name: contactName || null, lead_name: contactName || null,
              lead_id: null, lead_status: null,
              lead_city: null, lead_state: null, lead_acolhedor: null,
              board_id: null, board_name: null, stage_name: null,
              last_inbound_at: null, last_outbound_at: null,
              total_messages: 0, inbound_count: 0, outbound_count: 0,
              followup_count: 0, has_followup_config: false,
              time_without_response: null, campaign_name: null,
              activated_by: null, activated_at: null, whatsapp_group_id: null, created_at: null,
            });
          }
        }}
      />

      {gapSheet && (
        <GapDetailSheet
          open={!!gapSheet}
          onClose={() => setGapSheet(null)}
          gapType={gapSheet}
          items={filteredGaps[gapSheet]}
          onOpenChat={(phone, instanceName, contactName) => {
            setGapSheet(null);
            const match = conversations.find(c => c.phone === phone && (!instanceName || c.instance_name === instanceName));
            if (match) {
              setChatPreview(match);
            }
          }}
        />
      )}

      <NewConversationsSheet
        open={newConvsSheetOpen}
        onClose={() => setNewConvsSheetOpen(false)}
        conversations={filteredNewConvDetails}
        onOpenChat={handleNewConvChatOpen}
      />

      <DashboardChatPreview
        open={!!chatPreview} onOpenChange={(open) => { if (!open) setChatPreview(null); }}
        phone={chatPreview?.phone || null} contactName={chatPreview?.contact_name || chatPreview?.lead_name || null}
        instanceName={chatPreview?.instance_name || null} hasLead={!!chatPreview?.lead_name}
        hasContact={!!chatPreview?.contact_name} wasResponded={chatPreview ? chatPreview.inbound_count > 0 : false}
        responseTimeMinutes={null}
        onConversationUpdated={fetchData}
      />

      <AIActivityPromptDialog
        open={promptDialogOpen} onOpenChange={setPromptDialogOpen}
        leadName={promptDialogLead?.name || ''} loading={!!generatingLeadId}
        onConfirm={async (customPrompt) => {
          if (!promptDialogLead) return;
          setGeneratingLeadId(promptDialogLead.id);
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await cloudFunctions.invoke('generate-case-activities', {
              body: { lead_id: promptDialogLead.id, custom_prompt: customPrompt },
              authToken: session?.access_token,
            });
            if (error) throw error;
            toast({ title: 'Atividades geradas', description: data?.message || 'Sucesso' });
            setPromptDialogOpen(false);
          } catch (err: any) {
            toast({ title: 'Erro', description: err.message, variant: 'destructive' });
          } finally {
            setGeneratingLeadId(null);
          }
        }}
      />
    </div>
  );
}
