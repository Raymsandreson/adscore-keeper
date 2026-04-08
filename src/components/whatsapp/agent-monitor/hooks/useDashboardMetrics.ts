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
  closedByAgentDetailed: { agent: string; ai: number; human: number; total: number }[];
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

// Helper to fetch all rows with pagination
async function fetchAllPaginated<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;
  while (true) {
    const { data } = await queryFn(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    newConversations: 0, responseRate: 0, avgResponseTimeMin: 0,
    respondedCount: 0, totalInbound: 0,
    closedByAgent: [], closedByAgentDetailed: [], closedByCampaign: [], closedByAI: 0, closedWithHuman: 0, closedTotal: 0,
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

      // ===== PHASE 1: Parallel fetch of all independent data =====
      const [
        inboundData,
        outboundData,
        closedLeads,
        signedDocsRes,
        pendingDocsRes,
        groupsRes,
        casesRes,
        processesRes,
        contactsRes,
      ] = await Promise.all([
        // Inbound messages (paginated)
        fetchAllPaginated<any>((from, to) =>
          supabase
            .from('whatsapp_messages')
            .select('phone, contact_name, created_at, instance_name')
            .eq('direction', 'inbound')
            .not('phone', 'like', '%@g.us')
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd)
            .order('created_at', { ascending: true })
            .range(from, to) as any
        ),
        // Outbound messages (paginated) - fetch ALL at once instead of per-phone
        fetchAllPaginated<any>((from, to) =>
          supabase
            .from('whatsapp_messages')
            .select('phone, created_at')
            .eq('direction', 'outbound')
            .not('phone', 'like', '%@g.us')
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd)
            .order('created_at', { ascending: true })
            .range(from, to) as any
        ),
        // Closed leads
        supabase
          .from('leads')
          .select('id, acolhedor, campaign_name, lead_status, lead_phone')
          .eq('lead_status', 'closed')
          .gte('updated_at', todayStart)
          .lte('updated_at', todayEnd)
          .then(r => r.data || []),
        // Operational metrics - all in parallel
        supabase.from('zapsign_documents').select('id, document_name, instance_name, lead_id, created_at, signed_at').eq('signer_status', 'signed').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('zapsign_documents').select('id, document_name, instance_name, lead_id, created_at').eq('signer_status', 'new').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('leads').select('id, lead_name, acolhedor, board_id, campaign_name, created_at').not('whatsapp_group_id', 'is', null).gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('legal_cases').select('id, case_number, title, acolhedor, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('case_process_tracking').select('id, cliente, acolhedor, lead_id, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
        supabase.from('contacts').select('id, full_name, city, state, created_by, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }),
      ]);

      setMetricsProgress(50);

      // ===== PHASE 2: Process inbound/outbound data in memory =====
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null }>();
      for (const msg of inboundData) {
        if (!msg.phone || msg.phone.includes('@g.us')) continue;
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, first_message_at: msg.created_at, instance_name: msg.instance_name });
        }
      }
      const uniquePhones = Array.from(phoneMap.keys());
      const totalInbound = uniquePhones.length;

      // Build outbound map from bulk data (no per-phone queries!)
      const outboundMap = new Map<string, { count: number; first_at: string | null }>();
      for (const m of outboundData) {
        if (!m.phone) continue;
        const ex = outboundMap.get(m.phone);
        if (!ex) outboundMap.set(m.phone, { count: 1, first_at: m.created_at });
        else ex.count++;
      }

      const respondedCount = uniquePhones.filter(p => outboundMap.has(p)).length;
      const responseRate = totalInbound > 0 ? Math.round((respondedCount / totalInbound) * 100) : 0;

      // Avg response time (in-memory)
      const responseTimes: number[] = [];
      for (const [phone, outData] of outboundMap.entries()) {
        const inData = phoneMap.get(phone);
        if (inData && outData.first_at) {
          const diff = differenceInMinutes(parseISO(outData.first_at), parseISO(inData.first_message_at));
          if (diff >= 0) responseTimes.push(diff);
        }
      }
      const avgResponseTimeMin = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;

      setMetricsProgress(65);

      // ===== PHASE 3: New conversations - optimized with single count query =====
      // Instead of checking each phone individually, use a single query to count
      // phones that had messages BEFORE the period. Much faster approach:
      // Sample up to 500 unique phones and check in a single batch.
      const phonesToCheck = uniquePhones.slice(0, 2000);
      const oldPhones = new Set<string>();

      // Check in larger batches of 200 with a single page each
      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < phonesToCheck.length; i += 200) {
        const batch = phonesToCheck.slice(i, i + 200);
        batchPromises.push(
          (supabase
            .from('whatsapp_messages')
            .select('phone')
            .lt('created_at', todayStart)
            .in('phone', batch)
            .limit(200) as any)
            .then(({ data }: any) => {
              (data || []).forEach((m: any) => oldPhones.add(m.phone));
            })
        );
      }
      // Run all batch checks in parallel (not sequential!)
      await Promise.all(batchPromises);

      const trulyNewPhones = uniquePhones.filter(p => !oldPhones.has(p));

      setMetricsProgress(75);

      // ===== PHASE 4: Lead lookup + closed leads analysis in parallel =====
      const leadPhoneMapPromise = trulyNewPhones.length > 0
        ? supabase.from('leads').select('lead_phone, lead_name').not('lead_phone', 'is', null).then(r => {
            const map = new Map<string, { name: string }>();
            for (const l of (r.data || [])) {
              const norm = (l.lead_phone || '').replace(/\D/g, '');
              if (norm) map.set(norm.slice(-8), { name: l.lead_name });
            }
            return map;
          })
        : Promise.resolve(new Map<string, { name: string }>());

      // Human phone check for closed leads
      const closedTotal = closedLeads.length;
      const humanPhonesPromise = (async () => {
        if (closedTotal === 0) return new Set<string>();
        const closedSuffixes = [...new Set(
          closedLeads
            .map((l: any) => (l.lead_phone || '').replace(/\D/g, ''))
            .filter((p: string) => p.length >= 8)
            .map((p: string) => p.slice(-8))
        )];
        
        const humanPhones = new Set<string>();
        const humanBatches: Promise<void>[] = [];
        for (let i = 0; i < closedSuffixes.length; i += 50) {
          const batch = closedSuffixes.slice(i, i + 50);
          const orFilter = batch.map(s => `phone.ilike.%${s}%`).join(',');
          humanBatches.push(
            (supabase
              .from('whatsapp_messages')
              .select('phone')
              .eq('direction', 'outbound')
              .eq('action_source', 'manual')
              .or(orFilter)
              .limit(500) as any)
              .then(({ data }: any) => {
                for (const msg of (data || [])) {
                  humanPhones.add((msg.phone || '').replace(/\D/g, '').slice(-8));
                }
              })
          );
        }
        await Promise.all(humanBatches);
        return humanPhones;
      })();

      // Fetch doc lead acolhedors
      const allDocs = [...(signedDocsRes.data || []), ...(pendingDocsRes.data || [])];
      const docLeadIds = allDocs.map((d: any) => d.lead_id).filter(Boolean);
      const docLeadMapPromise = docLeadIds.length > 0
        ? supabase.from('leads').select('id, acolhedor').in('id', docLeadIds).then(r => new Map((r.data || []).map((l: any) => [l.id, l.acolhedor])))
        : Promise.resolve(new Map<string, string>());

      // Contact creator names
      const contactCreatorIds = [...new Set((contactsRes.data || []).map((c: any) => c.created_by).filter(Boolean))];
      const creatorMapPromise = contactCreatorIds.length > 0
        ? supabase.from('profiles').select('user_id, full_name').in('user_id', contactCreatorIds).then(r => new Map((r.data || []).map((p: any) => [p.user_id, p.full_name])))
        : Promise.resolve(new Map<string, string>());

      // Wait for all parallel phase 4 tasks
      const [leadPhoneMap, humanPhones, docLeadAcolhedorMap, contactCreatorMap] = await Promise.all([
        leadPhoneMapPromise, humanPhonesPromise, docLeadMapPromise, creatorMapPromise
      ]);

      setMetricsProgress(90);

      // ===== PHASE 5: Build results in memory =====
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

      // Closed leads breakdown
      const agentMap = new Map<string, number>();
      const agentDetailMap = new Map<string, { ai: number; human: number }>();
      const campaignMap = new Map<string, number>();
      let closedByAI = 0;
      let closedWithHuman = 0;

      for (const l of closedLeads) {
        const agentName = l.acolhedor || 'Sem acolhedor';
        agentMap.set(agentName, (agentMap.get(agentName) || 0) + 1);
        if (l.campaign_name) campaignMap.set(l.campaign_name, (campaignMap.get(l.campaign_name) || 0) + 1);
        
        const phone = (l.lead_phone || '').replace(/\D/g, '');
        const suffix = phone.slice(-8);
        const isHuman = humanPhones.has(suffix);
        
        if (isHuman) closedWithHuman++;
        else closedByAI++;

        if (!agentDetailMap.has(agentName)) agentDetailMap.set(agentName, { ai: 0, human: 0 });
        const detail = agentDetailMap.get(agentName)!;
        if (isHuman) detail.human++; else detail.ai++;
      }

      // Operational details
      const mapDoc = (d: any): OperationalDetail => ({
        id: d.id, name: d.document_name || 'Documento',
        acolhedor: (d.lead_id && docLeadAcolhedorMap.get(d.lead_id)) || null,
        instance_name: d.instance_name || null, lead_id: d.lead_id || null, created_at: d.created_at,
      });

      const signedDocsDetails = (signedDocsRes.data || []).map(mapDoc);
      const pendingDocsDetails = (pendingDocsRes.data || []).map(mapDoc);
      const groupsDetails = (groupsRes.data || []).map((d: any) => ({
        id: d.id, name: d.lead_name || 'Lead', acolhedor: d.acolhedor || null,
        instance_name: null, lead_id: d.id, created_at: d.created_at,
      }));
      const casesDetails = (casesRes.data || []).map((d: any) => ({
        id: d.id, name: d.title || d.case_number || 'Caso', acolhedor: d.acolhedor || null,
        instance_name: null, lead_id: null, created_at: d.created_at,
      }));
      const processesDetails = (processesRes.data || []).map((d: any) => ({
        id: d.id, name: d.cliente || 'Processo', acolhedor: d.acolhedor || null,
        instance_name: null, lead_id: d.lead_id || null, created_at: d.created_at,
      }));
      const contactsDetails = (contactsRes.data || []).map((d: any) => ({
        id: d.id, name: d.full_name || 'Contato',
        acolhedor: (d.created_by && contactCreatorMap.get(d.created_by)) || null,
        instance_name: null, lead_id: null, created_at: d.created_at,
      }));

      setMetrics({
        newConversations: trulyNewPhones.length,
        responseRate, avgResponseTimeMin, respondedCount, totalInbound,
        closedByAgent: Array.from(agentMap.entries()).map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count),
        closedByAgentDetailed: Array.from(agentDetailMap.entries()).map(([agent, d]) => ({ agent, ai: d.ai, human: d.human, total: d.ai + d.human })).sort((a, b) => b.total - a.total),
        closedByCampaign: Array.from(campaignMap.entries()).map(([campaign, count]) => ({ campaign, count })).sort((a, b) => b.count - a.count),
        closedByAI, closedWithHuman, closedTotal,
        newConvDetails,
        signedDocuments: signedDocsDetails.length, pendingDocuments: pendingDocsDetails.length,
        groupsCreated: groupsDetails.length, casesCreated: casesDetails.length,
        processesCreated: processesDetails.length, contactsCreated: contactsDetails.length,
        signedDocsDetails, pendingDocsDetails, groupsDetails, casesDetails, processesDetails, contactsDetails,
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
