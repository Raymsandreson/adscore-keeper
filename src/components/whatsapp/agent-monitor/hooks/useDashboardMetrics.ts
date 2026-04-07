import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay, differenceInMinutes, parseISO } from 'date-fns';

export interface DashboardMetrics {
  newConversations: number;
  responseRate: number;
  avgResponseTimeMin: number;
  respondedCount: number;
  totalInbound: number;
  closedByAgent: { agent: string; count: number }[];
  closedByCampaign: { campaign: string; count: number }[];
  closedByAI: number;
  closedWithHuman: number;
  closedTotal: number;
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

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    newConversations: 0, responseRate: 0, avgResponseTimeMin: 0,
    respondedCount: 0, totalInbound: 0,
    closedByAgent: [], closedByCampaign: [], closedByAI: 0, closedWithHuman: 0, closedTotal: 0,
    newConvDetails: [],
    signedDocuments: 0, pendingDocuments: 0, groupsCreated: 0, casesCreated: 0, processesCreated: 0, contactsCreated: 0,
    signedDocsDetails: [], pendingDocsDetails: [], groupsDetails: [], casesDetails: [], processesDetails: [], contactsDetails: [],
  });
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsProgress, setMetricsProgress] = useState(0);

  const fetchMetrics = useCallback(async (dateRange: { from: Date; to: Date }) => {
    setMetricsLoading(true);
    setMetricsProgress(10);
    try {
      const todayStart = startOfDay(dateRange.from).toISOString();
      const todayEnd = endOfDay(dateRange.to).toISOString();

      // Fetch all inbound messages (paginated)
      const fetchAllInbound = async () => {
        const allRows: any[] = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data } = await supabase
            .from('whatsapp_messages')
            .select('phone, contact_name, created_at, instance_name')
            .eq('direction', 'inbound')
            .not('phone', 'like', '%@g.us')
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd)
            .order('created_at', { ascending: true })
            .range(from, from + pageSize - 1);
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }
        return allRows;
      };

      const inboundData = await fetchAllInbound();

      // Unique phones from inbound (use raw phone as stored in DB for exact matching)
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null }>();
      for (const msg of inboundData) {
        if (!msg.phone || msg.phone.includes('@g.us')) continue;
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, first_message_at: msg.created_at, instance_name: msg.instance_name });
        }
      }
      const uniquePhones = Array.from(phoneMap.keys());
      const totalInbound = uniquePhones.length;

      // Check which phones had ANY message before the period start
      // Use exact .in() match (phones are stored consistently in DB)
      // Batch of 50 with high limit to avoid missing phones due to row cap
      const oldPhones = new Set<string>();
      for (let i = 0; i < uniquePhones.length; i += 50) {
        const batch = uniquePhones.slice(i, i + 50);
        // Paginate to ensure we check all - we only need distinct phones
        let from = 0;
        const checked = new Set<string>(batch);
        while (checked.size > oldPhones.size) {
          const remaining = batch.filter(p => !oldPhones.has(p));
          if (remaining.length === 0) break;
          const { data: oldMsgs } = await supabase
            .from('whatsapp_messages')
            .select('phone')
            .lt('created_at', todayStart)
            .in('phone', remaining)
            .range(from, from + 999);
          if (!oldMsgs || oldMsgs.length === 0) break;
          oldMsgs.forEach(m => oldPhones.add(m.phone));
          if (oldMsgs.length < 1000) break;
          from += 1000;
        }
      }
      const trulyNewPhones = uniquePhones.filter(p => !oldPhones.has(p));

      // Fetch outbound for response rate & time
      const outboundMap = new Map<string, { count: number; first_at: string | null }>();
      for (let i = 0; i < uniquePhones.length; i += 200) {
        const batch = uniquePhones.slice(i, i + 200);
        const { data: outMsgs } = await supabase
          .from('whatsapp_messages')
          .select('phone, created_at')
          .eq('direction', 'outbound')
          .gte('created_at', todayStart)
          .lte('created_at', todayEnd)
          .in('phone', batch)
          .order('created_at', { ascending: true });
        for (const m of (outMsgs || [])) {
          const ex = outboundMap.get(m.phone);
          if (!ex) outboundMap.set(m.phone, { count: 1, first_at: m.created_at });
          else ex.count++;
        }
      }

      const respondedCount = uniquePhones.filter(p => outboundMap.has(p)).length;
      const responseRate = totalInbound > 0 ? Math.round((respondedCount / totalInbound) * 100) : 0;

      // Avg response time
      const responseTimes: number[] = [];
      for (const [phone, outData] of outboundMap.entries()) {
        const inData = phoneMap.get(phone);
        if (inData && outData.first_at) {
          const diff = differenceInMinutes(parseISO(outData.first_at), parseISO(inData.first_message_at));
          if (diff >= 0) responseTimes.push(diff);
        }
      }
      const avgResponseTimeMin = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;

      // Check leads for new conv details
      let leadPhoneMap = new Map<string, { name: string }>();
      if (trulyNewPhones.length > 0) {
        const { data: leads } = await supabase.from('leads').select('lead_phone, lead_name').not('lead_phone', 'is', null);
        for (const l of (leads || [])) {
          const norm = (l.lead_phone || '').replace(/\D/g, '');
          if (norm) leadPhoneMap.set(norm.slice(-8), { name: l.lead_name });
        }
      }

      const newConvDetails: NewConvDetail[] = trulyNewPhones.map(p => {
        const conv = phoneMap.get(p)!;
        const outData = outboundMap.get(p);
        const suffix = p.replace(/\D/g, '').slice(-8);
        const leadInfo = leadPhoneMap.get(suffix);
        return {
          phone: p,
          contact_name: conv.contact_name,
          instance_name: conv.instance_name,
          first_message_at: conv.first_message_at,
          was_responded: !!outData,
          response_time_minutes: outData?.first_at ? differenceInMinutes(parseISO(outData.first_at), parseISO(conv.first_message_at)) : null,
          lead_name: leadInfo?.name || null,
          has_lead: !!leadInfo,
        };
      });

      // Closed leads by agent (acolhedor) and campaign + AI vs human distinction
      const { data: closedLeads } = await supabase
        .from('leads')
        .select('id, acolhedor, campaign_name, lead_status, lead_phone')
        .eq('lead_status', 'closed')
        .gte('updated_at', todayStart)
        .lte('updated_at', todayEnd);

      const agentMap = new Map<string, number>();
      const campaignMap = new Map<string, number>();
      const closedTotal = (closedLeads || []).length;

      // Check which closed leads had human interaction (manual outbound messages)
      let closedByAI = 0;
      let closedWithHuman = 0;

      if (closedTotal > 0) {
        // Get all phones from closed leads
        const closedPhones = (closedLeads || [])
          .map((l: any) => (l.lead_phone || '').replace(/\D/g, ''))
          .filter((p: string) => p.length >= 8);

        // Batch check: find phones that had manual outbound messages
        const phoneSuffixes = closedPhones.map((p: string) => p.slice(-8));
        const uniqueSuffixes = [...new Set(phoneSuffixes)];

        // Query manual outbound messages for these phones
        const humanPhones = new Set<string>();
        // Process in batches of 50 to avoid query limits
        for (let i = 0; i < uniqueSuffixes.length; i += 50) {
          const batch = uniqueSuffixes.slice(i, i + 50);
          const orFilter = batch.map(s => `phone.ilike.%${s}%`).join(',');
          const { data: manualMsgs } = await supabase
            .from('whatsapp_messages')
            .select('phone')
            .eq('direction', 'outbound')
            .eq('action_source', 'manual')
            .or(orFilter)
            .limit(500);
          
          for (const msg of (manualMsgs || [])) {
            const msgSuffix = (msg.phone || '').replace(/\D/g, '').slice(-8);
            humanPhones.add(msgSuffix);
          }
        }

        for (const l of (closedLeads || [])) {
          if (l.acolhedor) agentMap.set(l.acolhedor, (agentMap.get(l.acolhedor) || 0) + 1);
          if (l.campaign_name) campaignMap.set(l.campaign_name, (campaignMap.get(l.campaign_name) || 0) + 1);
          
          const phone = (l.lead_phone || '').replace(/\D/g, '');
          const suffix = phone.slice(-8);
          if (humanPhones.has(suffix)) {
            closedWithHuman++;
          } else {
            closedByAI++;
          }
        }
      }

      // Operational metrics: signed docs, groups, cases, processes
      const [signedDocsRes, pendingDocsRes, groupsRes, casesRes, processesRes, contactsRes] = await Promise.all([
        supabase.from('zapsign_documents').select('id, document_name, instance_name, lead_id, created_at, signed_at').eq('signer_status', 'signed').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('zapsign_documents').select('id, document_name, instance_name, lead_id, created_at').eq('signer_status', 'new').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('leads').select('id, lead_name, acolhedor, board_id, campaign_name, created_at').not('whatsapp_group_id', 'is', null).gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('legal_cases').select('id, case_number, title, acolhedor, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('case_process_tracking').select('id, cliente, acolhedor, lead_id, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('contacts').select('id, full_name, city, state, created_by, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
      ]);

      // Fetch acolhedor for docs that have lead_id
      const allDocs = [...(signedDocsRes.data || []), ...(pendingDocsRes.data || [])];
      const docLeadIds = allDocs.map((d: any) => d.lead_id).filter(Boolean);
      let docLeadAcolhedorMap = new Map<string, string>();
      if (docLeadIds.length > 0) {
        const { data: docLeads } = await supabase.from('leads').select('id, acolhedor').in('id', docLeadIds);
        docLeadAcolhedorMap = new Map((docLeads || []).map((l: any) => [l.id, l.acolhedor]));
      }

      const mapDoc = (d: any): OperationalDetail => ({
        id: d.id, name: d.document_name || 'Documento',
        acolhedor: (d.lead_id && docLeadAcolhedorMap.get(d.lead_id)) || null,
        instance_name: d.instance_name || null, lead_id: d.lead_id || null, created_at: d.created_at,
      });

      const signedDocsDetails: OperationalDetail[] = (signedDocsRes.data || []).map(mapDoc);
      const pendingDocsDetails: OperationalDetail[] = (pendingDocsRes.data || []).map(mapDoc);

      const groupsDetails: OperationalDetail[] = (groupsRes.data || []).map((d: any) => ({
        id: d.id, name: d.lead_name || 'Lead', acolhedor: d.acolhedor || null,
        instance_name: null, lead_id: d.id, created_at: d.created_at,
      }));

      const casesDetails: OperationalDetail[] = (casesRes.data || []).map((d: any) => ({
        id: d.id, name: d.title || d.case_number || 'Caso', acolhedor: d.acolhedor || null,
        instance_name: null, lead_id: null, created_at: d.created_at,
      }));

      const processesDetails: OperationalDetail[] = (processesRes.data || []).map((d: any) => ({
        id: d.id, name: d.cliente || 'Processo', acolhedor: d.acolhedor || null,
        instance_name: null, lead_id: d.lead_id || null, created_at: d.created_at,
      }));

      // Resolve created_by user names for contacts
      const contactCreatorIds = (contactsRes.data || []).map((c: any) => c.created_by).filter(Boolean);
      let contactCreatorMap = new Map<string, string>();
      if (contactCreatorIds.length > 0) {
        const { data: creators } = await supabase.from('profiles').select('user_id, full_name').in('user_id', [...new Set(contactCreatorIds)]);
        contactCreatorMap = new Map((creators || []).map((p: any) => [p.user_id, p.full_name]));
      }

      const contactsDetails: OperationalDetail[] = (contactsRes.data || []).map((d: any) => ({
        id: d.id, name: d.full_name || 'Contato',
        acolhedor: (d.created_by && contactCreatorMap.get(d.created_by)) || null,
        instance_name: null, lead_id: null, created_at: d.created_at,
      }));

      setMetrics({
        newConversations: trulyNewPhones.length,
        responseRate,
        avgResponseTimeMin,
        respondedCount,
        totalInbound,
        closedByAgent: Array.from(agentMap.entries()).map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count),
        closedByCampaign: Array.from(campaignMap.entries()).map(([campaign, count]) => ({ campaign, count })).sort((a, b) => b.count - a.count),
        newConvDetails,
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
    } finally {
      setMetricsLoading(false);
      setMetricsProgress(100);
    }
  }, []);

  return { metrics, metricsLoading, metricsProgress, fetchMetrics };
}
