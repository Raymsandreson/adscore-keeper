import { useState, useCallback } from 'react';
import { monitorData } from '@/utils/monitorData';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
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

  const fetchMetrics = useCallback(async (dateRange: { from: Date; to: Date }, selectedPeriod?: string) => {
    setMetricsLoading(true);
    setMetricsProgress(30);
    try {
      await ensureExternalSession().catch((e) => console.warn('[Monitor IA metrics] external session:', e?.message));
      const startISO = new Date(dateRange.from.getFullYear(), dateRange.from.getMonth(), dateRange.from.getDate()).toISOString();
      const endISO = new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate(), 23, 59, 59, 999).toISOString();

      // Fetch KPIs from edge function (header rápido) + dados detalhados direto do EXTERNO
      // (memory: hybrid-routing-persistence-policy — dados de negócio vivem no Externo)
      const period = selectedPeriod || 'today';
      const isToday = period === 'today' || (!selectedPeriod);
      // Janela de um único dia (hoje, ontem, ou qualquer data específica) →
      // a RPC canônica entrega "Conversas Novas" usando o filtro global de
      // primeira mensagem. Range com mais de um dia ainda usa snapshot do edge.
      const sameDay = dateRange.from.toDateString() === dateRange.to.toDateString();
      const rpcDate = sameDay
        ? `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth()+1).padStart(2,'0')}-${String(dateRange.from.getDate()).padStart(2,'0')}`
        : null;
      const ext: any = externalSupabase;
      const [kpiRes, docsResult, groupsResult, casesResult, processesResult, contactsResult, contactsCountResult, newConvRpc] = await Promise.all([
        monitorData('kpis', { period }),
        externalSupabase
          .from('zapsign_documents')
          .select('id, document_name, signer_name, status, signer_status, lead_id, instance_name, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
        externalSupabase
          .from('leads')
          .select('id, lead_name, acolhedor, lead_phone, created_at')
          .not('whatsapp_group_id', 'is', null)
          .gte('created_at', startISO).lte('created_at', endISO),
        externalSupabase
          .from('legal_cases')
          .select('id, title, acolhedor, lead_id, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
        externalSupabase
          .from('case_process_tracking')
          .select('id, cliente, acolhedor, created_at')
          .gte('created_at', startISO).lte('created_at', endISO),
        externalSupabase
          .from('contacts')
          .select('id, full_name, created_by, created_at')
          .gte('created_at', startISO).lte('created_at', endISO)
          .limit(5000),
        externalSupabase
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startISO).lte('created_at', endISO),
        // Conversas NOVAS hoje + enriquecimento (RPC encapsula o SQL canônico).
        // Substitui o scan de 20k mensagens — só roda quando period = today.
        rpcDate
          ? ext.rpc('get_new_conversations_for_date', { p_date: rpcDate })
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);

      setMetricsProgress(50);

      // Parse KPI response
      const kpiData = kpiRes?.data || {};

      // === Conversas novas + tempo de resposta vêm prontos da RPC ===
      const newConvRows = (newConvRpc?.data || []) as Array<{
        phone: string;
        instance_name: string | null;
        first_message_at: string;
        contact_name: string | null;
        lead_name: string | null;
        has_lead: boolean;
        was_responded: boolean;
        response_time_minutes: number | null;
      }>;
      const totalNewConvs = newConvRows.length;
      const respondedCount = newConvRows.filter(r => r.was_responded).length;
      const responseTimes = newConvRows
        .map(r => r.response_time_minutes)
        .filter((v): v is number => typeof v === 'number');
      const avgResponseTimeMin = responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0;
      const responseRate = totalNewConvs > 0 ? Math.round((respondedCount / totalNewConvs) * 100) : 0;
      const newConvDetails: NewConvDetail[] = newConvRows.map(r => ({
        phone: r.phone,
        contact_name: r.contact_name,
        instance_name: r.instance_name,
        first_message_at: r.first_message_at,
        was_responded: !!r.was_responded,
        response_time_minutes: r.response_time_minutes,
        lead_name: r.lead_name,
        has_lead: !!r.has_lead,
      }));

      // Build conversation/closed metrics. Para qualquer dia único (hoje, ontem, etc)
      // a RPC é fonte de verdade (newConvDetails + responseRate + avgResponseTimeMin).
      // Para ranges com múltiplos dias, mantém snapshot do edge function de KPIs.
      const useRpc = !!rpcDate;
      const convAndClosedMetrics: Partial<DashboardMetrics> = {
        newConversations: useRpc ? totalNewConvs : (kpiData.conversas_ativas || 0),
        responseRate,
        avgResponseTimeMin,
        respondedCount,
        totalInbound: useRpc ? totalNewConvs : (kpiData.msgs_inbound || 0),
        closedByAgent: [],
        closedByAgentDetailed: [],
        closedByCampaign: [],
        closedByAI: 0,
        closedAssisted: 0,
        closedWithHuman: 0,
        closedNoInteraction: kpiData.leads_fechados || 0,
        closedTotal: kpiData.leads_fechados || 0,
        closedLeadDetails: [],
        newConvDetails,
      };

      // Snapshot só sobrepõe quando o range tem mais de um dia (sem RPC disponível).
      if (!useRpc && kpiRes?.conversation_metrics) {
        const cm = kpiRes.conversation_metrics;
        convAndClosedMetrics.newConversations = cm.newConversations || convAndClosedMetrics.newConversations;
        convAndClosedMetrics.responseRate = cm.responseRate ?? convAndClosedMetrics.responseRate;
        convAndClosedMetrics.avgResponseTimeMin = cm.avgResponseTimeMin ?? convAndClosedMetrics.avgResponseTimeMin;
        convAndClosedMetrics.respondedCount = cm.respondedCount ?? convAndClosedMetrics.respondedCount;
        convAndClosedMetrics.totalInbound = cm.totalInbound || convAndClosedMetrics.totalInbound;
      }
      if (kpiRes?.closed_aggregates) {
        const ca = kpiRes.closed_aggregates;
        convAndClosedMetrics.closedByAI = ca.closedByAI || 0;
        convAndClosedMetrics.closedAssisted = ca.closedAssisted || 0;
        convAndClosedMetrics.closedWithHuman = ca.closedWithHuman || 0;
        convAndClosedMetrics.closedNoInteraction = ca.closedNoInteraction || 0;
        convAndClosedMetrics.closedTotal = ca.closedTotal || 0;
        convAndClosedMetrics.closedByAgentDetailed = ca.closedByAgentDetailed || [];
        convAndClosedMetrics.closedByAgent = (ca.closedByAgentDetailed || []).map((d: any) => ({ agent: d.agent, count: d.total }));
        convAndClosedMetrics.closedByCampaign = ca.closedByCampaign || [];
      }
      if (kpiRes?.closed_lead_details) {
        convAndClosedMetrics.closedLeadDetails = kpiRes.closed_lead_details;
      }
      if (!useRpc && kpiRes?.new_conv_details) {
        convAndClosedMetrics.newConvDetails = kpiRes.new_conv_details;
      }

      // Operational metrics from direct queries
      const docs = docsResult.data || [];
      // Fonte única de verdade: tabela zapsign_documents filtrada pelo período do header.
      // Card e sheet devem mostrar números IDÊNTICOS (memory: kpi-snapshot-architecture).
      // Usamos `status` (estado do documento) e NÃO `signer_status` (estado do signatário individual).
      const signedDocsDetails: OperationalDetail[] = docs
        .filter(d => d.status === 'signed')
        .map(d => ({ id: d.id, name: d.signer_name || d.document_name || '', acolhedor: null, instance_name: d.instance_name, lead_id: d.lead_id, created_at: d.created_at }));
      const pendingDocsDetails: OperationalDetail[] = docs
        .filter(d => d.status !== 'signed')
        .map(d => ({ id: d.id, name: d.signer_name || d.document_name || '', acolhedor: null, instance_name: d.instance_name, lead_id: d.lead_id, created_at: d.created_at }));

      // Enrich docs with lead acolhedor
      const docLeadIds = docs.map(d => d.lead_id).filter(Boolean) as string[];
      if (docLeadIds.length > 0) {
        const { data: leads } = await externalSupabase.from('leads').select('id, acolhedor').in('id', [...new Set(docLeadIds)]);
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
      const contactsTotalCount = contactsCountResult.count ?? contactsData.length;
      const contactsDetails: OperationalDetail[] = contactsData.map(c => ({ id: c.id, name: c.full_name || '', acolhedor: null, instance_name: null, lead_id: null, created_at: c.created_at }));

      setMetricsProgress(80);

      // Use KPI data for operational counts when available
      setMetrics({
        ...(convAndClosedMetrics as DashboardMetrics),
        signedDocuments: signedDocsDetails.length,
        pendingDocuments: pendingDocsDetails.length,
        groupsCreated: groupsDetails.length,
        casesCreated: kpiData.casos_criados ?? casesDetails.length,
        processesCreated: kpiData.processos_criados ?? processesDetails.length,
        contactsCreated: kpiData.contatos_criados ?? 0,
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
