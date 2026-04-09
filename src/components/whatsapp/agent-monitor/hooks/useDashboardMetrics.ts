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
      const snapshotDate = format(dateRange.from, 'yyyy-MM-dd');
      
      const { data: snapshot, error } = await supabase
        .from('monitor_kpi_snapshots')
        .select('*')
        .eq('snapshot_date', snapshotDate)
        .maybeSingle();

      if (error) {
        console.error('Error fetching snapshot:', error);
        setMetrics(EMPTY_METRICS);
        return;
      }

      setMetricsProgress(80);

      if (!snapshot) {
        console.warn(`No snapshot found for ${snapshotDate}`);
        setMetrics(EMPTY_METRICS);
        return;
      }

      // Parse JSONB columns
      const closedAgg = (snapshot.closed_aggregates || {}) as any;
      const convMetrics = (snapshot.conversation_metrics || {}) as any;
      const opMetrics = (snapshot.operational_metrics || {}) as any;
      const opDetails = (snapshot.operational_details || {}) as any;
      const closedLeadDetails = (snapshot.closed_lead_details || []) as DashboardMetrics['closedLeadDetails'];
      const newConvDetails = (snapshot.new_conv_details || []) as NewConvDetail[];

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
