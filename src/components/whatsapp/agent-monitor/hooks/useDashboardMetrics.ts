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
      const startISO = new Date(dateRange.from.getFullYear(), dateRange.from.getMonth(), dateRange.from.getDate()).toISOString();
      const endISO = new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate(), 23, 59, 59, 999).toISOString();

      // Fetch snapshots for conversation/closed metrics
      let snapshots: any[] = [];
      if (isSingleDay) {
        const { data, error } = await supabase
          .from('monitor_kpi_snapshots')
          .select('*')
          .eq('snapshot_date', startDate)
          .maybeSingle();
        if (error) { console.error('Error fetching snapshot:', error); }
        if (data) snapshots = [data];
      } else {
        const { data, error } = await supabase
          .from('monitor_kpi_snapshots')
          .select('*')
          .gte('snapshot_date', startDate)
          .lte('snapshot_date', endDate)
          .order('snapshot_date', { ascending: false });
        if (error) { console.error('Error fetching snapshots:', error); }
        snapshots = data || [];
      }

      setMetricsProgress(50);

      // Fetch operational metrics DIRECTLY from source tables (not snapshots)
      const [docsResult, groupsResult, casesResult, processesResult, contactsResult] = await Promise.all([
        supabase
          .from('zapsign_documents')
          .select('id, document_name, signer_name, signer_status, lead_id, instance_name, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
        supabase
          .from('leads')
          .select('id, lead_name, acolhedor, lead_phone, created_at')
          .not('whatsapp_group_id', 'is', null)
          .gte('created_at', startISO).lte('created_at', endISO),
        supabase
          .from('legal_cases')
          .select('id, title, acolhedor, lead_id, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
        supabase
          .from('case_process_tracking')
          .select('id, cliente, acolhedor, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
        supabase
          .from('contacts')
          .select('id, full_name, created_by, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
      ]);

      const docs = docsResult.data || [];
      const signedDocsDetails: OperationalDetail[] = docs
        .filter(d => d.signer_status === 'signed')
        .map(d => ({ id: d.id, name: d.signer_name || d.document_name || '', acolhedor: null, instance_name: d.instance_name, lead_id: d.lead_id, created_at: d.created_at }));
      const pendingDocsDetails: OperationalDetail[] = docs
        .filter(d => d.signer_status !== 'signed')
        .map(d => ({ id: d.id, name: d.signer_name || d.document_name || '', acolhedor: null, instance_name: d.instance_name, lead_id: d.lead_id, created_at: d.created_at }));

      // Enrich docs with lead acolhedor
      const docLeadIds = docs.map(d => d.lead_id).filter(Boolean) as string[];
      if (docLeadIds.length > 0) {
        const { data: leads } = await supabase.from('leads').select('id, acolhedor').in('id', [...new Set(docLeadIds)]);
        const acolhedorMap = Object.fromEntries((leads || []).map(l => [l.id, l.acolhedor]));
        for (const d of [...signedDocsDetails, ...pendingDocsDetails]) {
          if (d.lead_id) d.acolhedor = acolhedorMap[d.lead_id] || null;
        }
      }

      const groupsData = groupsResult.data || [];
      const groupsDetails: OperationalDetail[] = groupsData.map(g => ({ id: g.id, name: g.lead_name || '', acolhedor: g.acolhedor, instance_name: null, lead_id: g.id, created_at: g.created_at }));

      const casesData = casesResult.data || [];
      const casesDetails: OperationalDetail[] = casesData.map(c => ({ id: c.id, name: c.title || '', acolhedor: c.acolhedor, instance_name: null, lead_id: c.lead_id, created_at: c.created_at }));

      const processesData = processesResult.data || [];
      const processesDetails: OperationalDetail[] = processesData.map(p => ({ id: p.id, name: p.cliente || '', acolhedor: p.acolhedor, instance_name: null, lead_id: null, created_at: p.created_at }));

      const contactsData = contactsResult.data || [];
      const contactsDetails: OperationalDetail[] = contactsData.map(c => ({ id: c.id, name: c.full_name || '', acolhedor: null, instance_name: null, lead_id: null, created_at: c.created_at }));

      setMetricsProgress(80);

      // Build conversation/closed metrics from snapshots
      let convAndClosedMetrics: Partial<DashboardMetrics> = {
        newConversations: 0, responseRate: 0, avgResponseTimeMin: 0,
        respondedCount: 0, totalInbound: 0,
        closedByAgent: [], closedByAgentDetailed: [], closedByCampaign: [],
        closedByAI: 0, closedAssisted: 0, closedWithHuman: 0, closedNoInteraction: 0, closedTotal: 0,
        closedLeadDetails: [], newConvDetails: [],
      };

      if (snapshots.length === 1) {
        const snapshot = snapshots[0];
        const closedAgg = (snapshot.closed_aggregates || {}) as Record<string, any>;
        const convMetrics = (snapshot.conversation_metrics || {}) as Record<string, any>;
        const closedLeadDetails = (snapshot.closed_lead_details || []) as unknown as DashboardMetrics['closedLeadDetails'];
        const newConvDetails = (snapshot.new_conv_details || []) as unknown as NewConvDetail[];

        convAndClosedMetrics = {
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
        };
      } else if (snapshots.length > 1) {
        let totalNewConvs = 0, totalRespondedCount = 0, totalInbound = 0;
        let totalResponseTimeSum = 0, responseTimeEntries = 0;
        let totalClosedByAI = 0, totalClosedAssisted = 0, totalClosedWithHuman = 0, totalClosedNoInteraction = 0, totalClosed = 0;
        const allClosedLeadDetails: DashboardMetrics['closedLeadDetails'] = [];
        const allNewConvDetails: NewConvDetail[] = [];
        const agentDetailAgg = new Map<string, { ai: number; assisted: number; human: number; noInteraction: number; total: number }>();
        const campaignAgg = new Map<string, number>();

        for (const snapshot of snapshots) {
          const closedAgg = (snapshot.closed_aggregates || {}) as Record<string, any>;
          const convMetrics = (snapshot.conversation_metrics || {}) as Record<string, any>;

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
              existing.ai += d.ai || 0; existing.assisted += d.assisted || 0;
              existing.human += d.human || 0; existing.noInteraction += d.noInteraction || 0;
              existing.total += d.total || 0;
            } else {
              agentDetailAgg.set(d.agent, { ai: d.ai || 0, assisted: d.assisted || 0, human: d.human || 0, noInteraction: d.noInteraction || 0, total: d.total || 0 });
            }
          });

          (closedAgg.closedByCampaign || []).forEach((c: any) => {
            campaignAgg.set(c.campaign, (campaignAgg.get(c.campaign) || 0) + c.count);
          });

          allClosedLeadDetails.push(...((snapshot.closed_lead_details || []) as DashboardMetrics['closedLeadDetails']));
          allNewConvDetails.push(...((snapshot.new_conv_details || []) as NewConvDetail[]));
        }

        const avgResponseTime = responseTimeEntries > 0 ? Math.round(totalResponseTimeSum / responseTimeEntries) : 0;
        const responseRate = totalInbound > 0 ? Math.round((totalRespondedCount / totalInbound) * 100) : 0;

        convAndClosedMetrics = {
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
        };
      }

      setMetrics({
        ...(convAndClosedMetrics as DashboardMetrics),
        signedDocuments: signedDocsDetails.length,
        pendingDocuments: pendingDocsDetails.length,
        groupsCreated: groupsDetails.length,
        casesCreated: casesDetails.length,
        processesCreated: processesDetails.length,
        contactsCreated: contactsDetails.length,
        signedDocsDetails,
        pendingDocsDetails,
        groupsDetails,
        casesDetails,
        processesDetails,
        contactsDetails,
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
