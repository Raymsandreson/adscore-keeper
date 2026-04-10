import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface DashboardMetrics {
  newConversations: number;
  responseRate: number;
  avgResponseTimeMin: number;
  respondedCount: number;
  totalInbound: number;
  closedByAgent: { agent: string; count: number }[];
  closedByAgentDetailed: { agent: string; ai: number; assisted: number; human: number; noInteraction: number; total: number }[];
  closedByCampaign: { campaign: string; count: number }[];
  closedByAI: number;
  closedAssisted: number;
  closedWithHuman: number;
  closedNoInteraction: number;
  closedTotal: number;
  closedLeadDetails: {
    leadId: string;
    acolhedor: string;
    campaign: string | null;
    classification: 'ai' | 'assisted' | 'human' | 'noInteraction';
  }[];
  newConvDetails: NewConvDetail[];
  signedDocuments: number;
  pendingDocuments: number;
  groupsCreated: number;
  casesCreated: number;
  processesCreated: number;
  contactsCreated: number;
  signedDocsDetails: OperationalDetail[];
  pendingDocsDetails: OperationalDetail[];
  groupsDetails: OperationalDetail[];
  casesDetails: OperationalDetail[];
  processesDetails: OperationalDetail[];
  contactsDetails: OperationalDetail[];
}

export interface OperationalDetail {
  id: string;
  name: string;
  acolhedor: string | null;
  instance_name: string | null;
  lead_id: string | null;
  created_at: string;
}

export interface NewConvDetail {
  phone: string;
  contact_name: string | null;
  instance_name: string | null;
  first_message_at: string;
  was_responded: boolean;
  response_time_minutes: number | null;
  lead_name: string | null;
  has_lead: boolean;
}

const EMPTY_METRICS: DashboardMetrics = {
  newConversations: 0, responseRate: 0, avgResponseTimeMin: 0,
  respondedCount: 0, totalInbound: 0,
  closedByAgent: [], closedByAgentDetailed: [], closedByCampaign: [], closedByAI: 0, closedAssisted: 0, closedWithHuman: 0, closedNoInteraction: 0, closedTotal: 0,
  closedLeadDetails: [],
  newConvDetails: [],
  signedDocuments: 0, pendingDocuments: 0, groupsCreated: 0, casesCreated: 0, processesCreated: 0, contactsCreated: 0,
  signedDocsDetails: [], pendingDocsDetails: [], groupsDetails: [], casesDetails: [], processesDetails: [], contactsDetails: [],
};

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsProgress, setMetricsProgress] = useState(0);

  const fetchMetrics = useCallback(async (dateRange: { from: Date; to: Date }) => {
    setMetricsLoading(true);
    setMetricsProgress(30);
    try {
      const startDate = format(dateRange.from, 'yyyy-MM-dd');
      const endDate = format(dateRange.to, 'yyyy-MM-dd');
      const isSingleDay = startDate === endDate;

      let snapshots: any[] = [];

      if (isSingleDay) {
        const { data, error } = await supabase
          .from('monitor_kpi_snapshots')
          .select('*')
          .eq('snapshot_date', startDate)
          .maybeSingle();
        if (error) { console.error('Error fetching snapshot:', error); setMetrics(EMPTY_METRICS); return; }
        if (data) snapshots = [data];
      } else {
        const { data, error } = await supabase
          .from('monitor_kpi_snapshots')
          .select('*')
          .gte('snapshot_date', startDate)
          .lte('snapshot_date', endDate)
          .order('snapshot_date', { ascending: false });
        if (error) { console.error('Error fetching snapshots:', error); setMetrics(EMPTY_METRICS); return; }
        snapshots = data || [];
      }

      setMetricsProgress(80);

      if (snapshots.length === 0) {
        console.warn(`No snapshots found for ${startDate} - ${endDate}`);
        setMetrics(EMPTY_METRICS);
        return;
      }

      // For single day, use the snapshot directly. For multi-day, aggregate.
      if (isSingleDay || snapshots.length === 1) {
        const snapshot = snapshots[0];
        const closedAgg = (snapshot.closed_aggregates || {}) as Record<string, any>;
        const convMetrics = (snapshot.conversation_metrics || {}) as Record<string, any>;
        const opMetrics = (snapshot.operational_metrics || {}) as Record<string, any>;
        const opDetails = (snapshot.operational_details || {}) as Record<string, any>;
        const closedLeadDetails = (snapshot.closed_lead_details || []) as unknown as DashboardMetrics['closedLeadDetails'];
        const newConvDetails = (snapshot.new_conv_details || []) as unknown as NewConvDetail[];

        setMetrics({
          newConversations: convMetrics.newConversations || 0,
          responseRate: convMetrics.responseRate || 0,
          avgResponseTimeMin: convMetrics.avgResponseTimeMin || 0,
          respondedCount: convMetrics.respondedCount || 0,
          totalInbound: convMetrics.totalInbound || 0,
          closedByAgent: (closedAgg.closedByAgentDetailed || []).map((d: any) => ({ agent: d.agent, count: d.total })),
          closedByAgentDetailed: closedAgg.closedByAgentDetailed || [],
          closedByCampaign: closedAgg.closedByCampaign || [],
          closedByAI: closedAgg.closedByAI || 0,
          closedAssisted: closedAgg.closedAssisted || 0,
          closedWithHuman: closedAgg.closedWithHuman || 0,
          closedNoInteraction: closedAgg.closedNoInteraction || 0,
          closedTotal: closedAgg.closedTotal || 0,
          closedLeadDetails,
          newConvDetails,
          signedDocuments: opMetrics.signedDocuments || 0,
          pendingDocuments: opMetrics.pendingDocuments || 0,
          groupsCreated: opMetrics.groupsCreated || 0,
          casesCreated: opMetrics.casesCreated || 0,
          processesCreated: opMetrics.processesCreated || 0,
          contactsCreated: opMetrics.contactsCreated || 0,
          signedDocsDetails: opDetails.signedDocsDetails || [],
          pendingDocsDetails: opDetails.pendingDocsDetails || [],
          groupsDetails: opDetails.groupsDetails || [],
          casesDetails: opDetails.casesDetails || [],
          processesDetails: opDetails.processesDetails || [],
          contactsDetails: opDetails.contactsDetails || [],
        });
      } else {
        // Aggregate across multiple snapshots
        let totalNewConvs = 0, totalRespondedCount = 0, totalInbound = 0;
        let totalResponseTimeSum = 0, responseTimeEntries = 0;
        let totalClosedByAI = 0, totalClosedAssisted = 0, totalClosedWithHuman = 0, totalClosedNoInteraction = 0, totalClosed = 0;
        let totalSignedDocs = 0, totalPendingDocs = 0, totalGroups = 0, totalCases = 0, totalProcesses = 0, totalContacts = 0;
        const allClosedLeadDetails: DashboardMetrics['closedLeadDetails'] = [];
        const allNewConvDetails: NewConvDetail[] = [];
        const allSignedDocsDetails: OperationalDetail[] = [];
        const allPendingDocsDetails: OperationalDetail[] = [];
        const allGroupsDetails: OperationalDetail[] = [];
        const allCasesDetails: OperationalDetail[] = [];
        const allProcessesDetails: OperationalDetail[] = [];
        const allContactsDetails: OperationalDetail[] = [];
        const agentDetailAgg = new Map<string, { ai: number; assisted: number; human: number; noInteraction: number; total: number }>();
        const campaignAgg = new Map<string, number>();

        for (const snapshot of snapshots) {
          const closedAgg = (snapshot.closed_aggregates || {}) as Record<string, any>;
          const convMetrics = (snapshot.conversation_metrics || {}) as Record<string, any>;
          const opMetrics = (snapshot.operational_metrics || {}) as Record<string, any>;
          const opDetails = (snapshot.operational_details || {}) as Record<string, any>;

          totalNewConvs += convMetrics.newConversations || 0;
          totalRespondedCount += convMetrics.respondedCount || 0;
          totalInbound += convMetrics.totalInbound || 0;
          if (convMetrics.avgResponseTimeMin && convMetrics.respondedCount) {
            totalResponseTimeSum += (convMetrics.avgResponseTimeMin || 0) * (convMetrics.respondedCount || 0);
            responseTimeEntries += convMetrics.respondedCount || 0;
          }

          totalClosedByAI += closedAgg.closedByAI || 0;
          totalClosedAssisted += closedAgg.closedAssisted || 0;
          totalClosedWithHuman += closedAgg.closedWithHuman || 0;
          totalClosedNoInteraction += closedAgg.closedNoInteraction || 0;
          totalClosed += closedAgg.closedTotal || 0;

          (closedAgg.closedByAgentDetailed || []).forEach((d: any) => {
            const existing = agentDetailAgg.get(d.agent);
            if (existing) {
              existing.ai += d.ai || 0;
              existing.assisted += d.assisted || 0;
              existing.human += d.human || 0;
              existing.noInteraction += d.noInteraction || 0;
              existing.total += d.total || 0;
            } else {
              agentDetailAgg.set(d.agent, { ai: d.ai || 0, assisted: d.assisted || 0, human: d.human || 0, noInteraction: d.noInteraction || 0, total: d.total || 0 });
            }
          });

          (closedAgg.closedByCampaign || []).forEach((c: any) => {
            campaignAgg.set(c.campaign, (campaignAgg.get(c.campaign) || 0) + c.count);
          });

          totalSignedDocs += opMetrics.signedDocuments || 0;
          totalPendingDocs += opMetrics.pendingDocuments || 0;
          totalGroups += opMetrics.groupsCreated || 0;
          totalCases += opMetrics.casesCreated || 0;
          totalProcesses += opMetrics.processesCreated || 0;
          totalContacts += opMetrics.contactsCreated || 0;

          allSignedDocsDetails.push(...(opDetails.signedDocsDetails || []));
          allPendingDocsDetails.push(...(opDetails.pendingDocsDetails || []));
          allGroupsDetails.push(...(opDetails.groupsDetails || []));
          allCasesDetails.push(...(opDetails.casesDetails || []));
          allProcessesDetails.push(...(opDetails.processesDetails || []));
          allContactsDetails.push(...(opDetails.contactsDetails || []));
          allClosedLeadDetails.push(...((snapshot.closed_lead_details || []) as DashboardMetrics['closedLeadDetails']));
          allNewConvDetails.push(...((snapshot.new_conv_details || []) as NewConvDetail[]));
        }

        const avgResponseTime = responseTimeEntries > 0 ? Math.round(totalResponseTimeSum / responseTimeEntries) : 0;
        const responseRate = totalInbound > 0 ? Math.round((totalRespondedCount / totalInbound) * 100) : 0;

        setMetrics({
          newConversations: totalNewConvs,
          responseRate,
          avgResponseTimeMin: avgResponseTime,
          respondedCount: totalRespondedCount,
          totalInbound,
          closedByAgent: Array.from(agentDetailAgg.entries()).map(([agent, d]) => ({ agent, count: d.total })).sort((a, b) => b.count - a.count),
          closedByAgentDetailed: Array.from(agentDetailAgg.entries()).map(([agent, d]) => ({ agent, ...d })).sort((a, b) => b.total - a.total),
          closedByCampaign: Array.from(campaignAgg.entries()).map(([campaign, count]) => ({ campaign, count })).sort((a, b) => b.count - a.count),
          closedByAI: totalClosedByAI,
          closedAssisted: totalClosedAssisted,
          closedWithHuman: totalClosedWithHuman,
          closedNoInteraction: totalClosedNoInteraction,
          closedTotal: totalClosed,
          closedLeadDetails: allClosedLeadDetails,
          newConvDetails: allNewConvDetails,
          signedDocuments: totalSignedDocs,
          pendingDocuments: totalPendingDocs,
          groupsCreated: totalGroups,
          casesCreated: totalCases,
          processesCreated: totalProcesses,
          contactsCreated: totalContacts,
          signedDocsDetails: allSignedDocsDetails,
          pendingDocsDetails: allPendingDocsDetails,
          groupsDetails: allGroupsDetails,
          casesDetails: allCasesDetails,
          processesDetails: allProcessesDetails,
          contactsDetails: allContactsDetails,
        });
      }
    } catch (err) {
      console.error('Error fetching dashboard metrics:', err);
      setMetrics(EMPTY_METRICS);
    } finally {
      setMetricsLoading(false);
      setMetricsProgress(100);
    }
  }, []);

  return { metrics, metricsLoading, metricsProgress, fetchMetrics };
}
