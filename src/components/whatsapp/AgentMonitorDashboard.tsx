import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClipboardList, Heart, LayoutDashboard } from 'lucide-react';
import { subDays } from 'date-fns';

import { useMonitorData } from './agent-monitor/hooks/useMonitorData';
import { useMonitorFilters } from './agent-monitor/hooks/useMonitorFilters';
import { useBatchActions } from './agent-monitor/hooks/useBatchActions';
import type { ConversationDetail, CaseStatus } from './agent-monitor/types';
import { convKey } from './agent-monitor/utils';

import { MonitorHeader } from './agent-monitor/components/MonitorHeader';
import { UnifiedMonitorTab } from './agent-monitor/components/UnifiedMonitorTab';
import { CaseListSheet } from './agent-monitor/components/CaseListSheet';
import { ReferralsTab } from './agent-monitor/components/ReferralsTab';
import { AIActivitiesPanel } from './AIActivitiesPanel';
import { AIActivityPromptDialog } from './AIActivityPromptDialog';
import { DashboardChatPreview } from './DashboardChatPreview';

export function AgentMonitorDashboard() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({ from: subDays(new Date(), 7), to: new Date() });
  const [sheetStatusFilter, setSheetStatusFilter] = useState<CaseStatus | null>(null);
  const [chatPreview, setChatPreview] = useState<ConversationDetail | null>(null);
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDialogLead, setPromptDialogLead] = useState<{ id: string; name: string } | null>(null);

  const { agents, conversations, agentStats, referrals, boards, loading, fetchData: fetchDataRaw } = useMonitorData();

  const fetchData = useCallback(() => fetchDataRaw(dateRange), [fetchDataRaw, dateRange]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const {
    filters, filteredConversations, pipelineCounts,
    uniqueInstances, uniqueBoards, uniqueCampaigns, applyBaseFilters,
  } = useMonitorFilters(conversations, boards);

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
          is_active: false,
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

  const filterBarProps = {
    agents, uniqueInstances, uniqueBoards, uniqueCampaigns,
    agentFilter: filters.agentFilter, setAgentFilter: filters.setAgentFilter,
    instanceFilter: filters.instanceFilter, setInstanceFilter: filters.setInstanceFilter,
    boardFilter: filters.boardFilter, setBoardFilter: filters.setBoardFilter,
    campaignFilter: filters.campaignFilter, setCampaignFilter: filters.setCampaignFilter,
    agentActiveFilter: filters.agentActiveFilter, setAgentActiveFilter: filters.setAgentActiveFilter,
    followupConfigFilter: filters.followupConfigFilter, setFollowupConfigFilter: filters.setFollowupConfigFilter,
  };

  const batchProps = {
    selectedKeys: batch.selectedKeys,
    selectedCount: batch.selectedKeys.size,
    batchAgentId: batch.batchAgentId,
    setBatchAgentId: batch.setBatchAgentId,
    batchProcessing: batch.batchProcessing,
    onSelectAll: batch.selectAll,
    onClearSelection: batch.clearSelection,
    onPause: () => batch.batchAction('pause'),
    onAssign: (id: string) => batch.batchAction('assign', id),
    onSwap: (id: string) => batch.batchAction('swap', id),
    onAnticipate: () => batch.batchFollowupAction('anticipate'),
    onResume: () => batch.batchFollowupAction('resume'),
  };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <MonitorHeader dateRange={dateRange} setDateRange={setDateRange} loading={loading} onRefresh={fetchData} />

      <Tabs defaultValue="monitor" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="monitor" className="text-xs flex items-center gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" /> Monitor</TabsTrigger>
          <TabsTrigger value="ai-activities" className="text-xs flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Atividades IA</TabsTrigger>
          <TabsTrigger value="referrals" className="text-xs flex items-center gap-1.5"><Heart className="h-3.5 w-3.5" /> Indicações</TabsTrigger>
        </TabsList>

        <TabsContent value="monitor" className="space-y-4">
          <UnifiedMonitorTab
            conversations={conversations} agentStats={agentStats} loading={loading}
            pipelineCounts={pipelineCounts}
            onPipelineClick={(s) => setSheetStatusFilter(prev => prev === s ? null : s)}
            activeStatus={sheetStatusFilter}
            onOpenChat={handleOpenChat} onEventClick={handleEventClick}
            filterBarProps={filterBarProps}
          />
        </TabsContent>

        <TabsContent value="ai-activities" className="space-y-4"><AIActivitiesPanel /></TabsContent>
        <TabsContent value="referrals" className="space-y-4"><ReferralsTab referrals={referrals} loading={loading} /></TabsContent>
      </Tabs>

      <CaseListSheet
        statusFilter={sheetStatusFilter} conversations={conversations}
        applyBaseFilters={applyBaseFilters} onClose={() => setSheetStatusFilter(null)}
        onOpenChat={handleOpenChat} generatingLeadId={generatingLeadId} onGenerateActivity={handleGenerateActivity}
      />

      <DashboardChatPreview
        open={!!chatPreview} onOpenChange={(open) => { if (!open) setChatPreview(null); }}
        phone={chatPreview?.phone || null} contactName={chatPreview?.contact_name || chatPreview?.lead_name || null}
        instanceName={chatPreview?.instance_name || null} hasLead={!!chatPreview?.lead_name}
        hasContact={!!chatPreview?.contact_name} wasResponded={chatPreview ? chatPreview.inbound_count > 0 : false}
        responseTimeMinutes={null}
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
