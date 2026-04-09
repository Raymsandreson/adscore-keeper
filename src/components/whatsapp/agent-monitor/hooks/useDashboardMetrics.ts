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
    closedByAgent: [], closedByAgentDetailed: [], closedByCampaign: [], closedByAI: 0, closedAssisted: 0, closedWithHuman: 0, closedNoInteraction: 0, closedTotal: 0,
    closedLeadDetails: [],
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
        // Closed leads (paginated)
        fetchAllPaginated<any>((from, to) =>
          supabase
            .from('leads')
            .select('id, acolhedor, campaign_name, lead_status, lead_phone, created_at, updated_at')
            .eq('lead_status', 'closed')
            .gte('updated_at', todayStart)
            .lte('updated_at', todayEnd)
            .range(from, to) as any
        ),
        // Operational metrics - all in parallel
        // Operational metrics - paginated to avoid 1000 row limit
        fetchAllPaginated<any>((from, to) =>
          supabase.from('zapsign_documents').select('id, document_name, instance_name, lead_id, created_at, signed_at').eq('signer_status', 'signed').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }).range(from, to) as any
        ).then(data => ({ data })),
        fetchAllPaginated<any>((from, to) =>
          supabase.from('zapsign_documents').select('id, document_name, instance_name, lead_id, created_at').eq('signer_status', 'new').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }).range(from, to) as any
        ).then(data => ({ data })),
        fetchAllPaginated<any>((from, to) =>
          supabase.from('leads').select('id, lead_name, acolhedor, board_id, campaign_name, created_at').not('whatsapp_group_id', 'is', null).gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }).range(from, to) as any
        ).then(data => ({ data })),
        fetchAllPaginated<any>((from, to) =>
          supabase.from('legal_cases').select('id, case_number, title, acolhedor, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }).range(from, to) as any
        ).then(data => ({ data })),
        fetchAllPaginated<any>((from, to) =>
          supabase.from('case_process_tracking').select('id, cliente, acolhedor, lead_id, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }).range(from, to) as any
        ).then(data => ({ data })),
        fetchAllPaginated<any>((from, to) =>
          supabase.from('contacts').select('id, full_name, city, state, created_by, created_at').gte('created_at', todayStart).lte('created_at', todayEnd).order('created_at', { ascending: false }).range(from, to) as any
        ).then(data => ({ data })),
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

      // Check in batches with high enough limit to capture all distinct phones
      // Bug fix: old code used .limit(200) which returned MESSAGE rows, not distinct phones.
      // If one phone had 150+ old messages, it consumed the limit and other phones were missed.
      // Fix: use smaller batches (50 phones) with limit = 5000 to ensure all phones are found.
      const batchPromises: Promise<void>[] = [];
      for (let i = 0; i < phonesToCheck.length; i += 50) {
        const batch = phonesToCheck.slice(i, i + 50);
        batchPromises.push(
          (supabase
            .from('whatsapp_messages')
            .select('phone')
            .lt('created_at', todayStart)
            .in('phone', batch)
            .limit(5000) as any)
            .then(({ data }: any) => {
              (data || []).forEach((m: any) => oldPhones.add(m.phone));
            })
        );
      }
      // Run all batch checks in parallel
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

      // Human intervention analysis for closed leads - STRUCTURAL: dual matching (lead_id primary + phone fallback)
      const closedTotal = closedLeads.length;
      // Returns map: lead_id -> { manual_count, total_outbound }
      const humanAnalysisPromise = (async () => {
        if (closedTotal === 0) return new Map<string, { manual: number; total: number }>();
        
        const leadStats = new Map<string, { manual: number; total: number }>();
        
        // STRATEGY 1: Query by lead_id (most accurate - no false positives)
        const leadIds = closedLeads.map(l => l.id).filter(Boolean);
        const leadWindowMap = new Map<string, { created: string; closed: string }>();
        for (const l of closedLeads) {
          leadWindowMap.set(l.id, { 
            created: l.created_at || todayStart, 
            closed: l.updated_at || todayEnd 
          });
        }
        
        const leadIdBatches: Promise<void>[] = [];
        for (let i = 0; i < leadIds.length; i += 50) {
          const batch = leadIds.slice(i, i + 50);
          leadIdBatches.push(
            fetchAllPaginated<any>((from, to) =>
              supabase
                .from('whatsapp_messages')
                .select('lead_id, action_source, created_at')
                .eq('direction', 'outbound')
                .in('lead_id', batch)
                .range(from, to) as any
            ).then((data) => {
              for (const msg of data) {
                if (!msg.lead_id) continue;
                const window = leadWindowMap.get(msg.lead_id);
                if (!window) continue;
                if (msg.created_at > window.closed || msg.created_at < window.created) continue;
                
                if (!leadStats.has(msg.lead_id)) leadStats.set(msg.lead_id, { manual: 0, total: 0 });
                const stats = leadStats.get(msg.lead_id)!;
                stats.total++;
                if (msg.action_source === 'manual') stats.manual++;
              }
            })
          );
        }
        await Promise.all(leadIdBatches);
        
        // STRATEGY 2: Fallback to phone suffix for leads that got 0 results from lead_id
        const leadsNeedingPhoneFallback = closedLeads.filter(l => {
          const phone = (l.lead_phone || '').replace(/\D/g, '');
          return !leadStats.has(l.id) && phone.length >= 8;
        });
        
        if (leadsNeedingPhoneFallback.length > 0) {
          const phoneSuffixMap = new Map<string, { leadId: string; created: string; closed: string }>();
          for (const l of leadsNeedingPhoneFallback) {
            const phone = (l.lead_phone || '').replace(/\D/g, '');
            const suffix = phone.slice(-8);
            phoneSuffixMap.set(suffix, { leadId: l.id, created: l.created_at || todayStart, closed: l.updated_at || todayEnd });
          }
          
          const suffixes = [...phoneSuffixMap.keys()];
          const phoneBatches: Promise<void>[] = [];
          for (let i = 0; i < suffixes.length; i += 50) {
            const batch = suffixes.slice(i, i + 50);
            const orFilter = batch.map(s => `phone.ilike.%${s}%`).join(',');
            phoneBatches.push(
              fetchAllPaginated<any>((from, to) =>
                supabase
                  .from('whatsapp_messages')
                  .select('phone, action_source, created_at')
                  .eq('direction', 'outbound')
                  .or(orFilter)
                  .range(from, to) as any
              ).then((data) => {
                for (const msg of data) {
                  const msgSuffix = (msg.phone || '').replace(/\D/g, '').slice(-8);
                  const entry = phoneSuffixMap.get(msgSuffix);
                  if (!entry) continue;
                  if (msg.created_at > entry.closed || msg.created_at < entry.created) continue;
                  
                  if (!leadStats.has(entry.leadId)) leadStats.set(entry.leadId, { manual: 0, total: 0 });
                  const stats = leadStats.get(entry.leadId)!;
                  stats.total++;
                  if (msg.action_source === 'manual') stats.manual++;
                }
              })
            );
          }
          await Promise.all(phoneBatches);
        }
        
        return leadStats;
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
      const [leadPhoneMap, leadStats, docLeadAcolhedorMap, contactCreatorMap] = await Promise.all([
        leadPhoneMapPromise, humanAnalysisPromise, docLeadMapPromise, creatorMapPromise
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

      // Closed leads breakdown - 4 levels using lead_id-based stats
      // 🤖 100% IA: zero manual messages during lead lifecycle
      // 🤝 Assistido: mixed (manual < 70% of outbound)
      // 👤 100% Humano: manual >= 70% of outbound
      // ⚪ Sem interação: no WhatsApp messages at all (judicial/external cases)
      const agentMap = new Map<string, number>();
      const agentDetailMap = new Map<string, { ai: number; assisted: number; human: number; noInteraction: number }>();
      const campaignMap = new Map<string, number>();
      const closedLeadDetails: DashboardMetrics['closedLeadDetails'] = [];
      let closedByAI = 0;
      let closedAssisted = 0;
      let closedWithHuman = 0;
      let closedNoInteraction = 0;
 
      for (const l of closedLeads) {
        const agentName = l.acolhedor || 'Sem acolhedor';
        agentMap.set(agentName, (agentMap.get(agentName) || 0) + 1);
        if (l.campaign_name) campaignMap.set(l.campaign_name, (campaignMap.get(l.campaign_name) || 0) + 1);
        
        const stats = leadStats.get(l.id);
        const phone = (l.lead_phone || '').replace(/\D/g, '');
        const hasValidPhone = phone.length >= 8;
        
        let classification: 'ai' | 'assisted' | 'human' | 'noInteraction';
        
        if (!stats || stats.total === 0) {
          if (!hasValidPhone) {
            classification = 'noInteraction';
          } else {
            classification = 'ai';
          }
        } else if (stats.manual === 0) {
          classification = 'ai';
        } else if ((stats.manual / stats.total) >= 0.7) {
          classification = 'human';
        } else {
          classification = 'assisted';
        }

        closedLeadDetails.push({
          leadId: l.id,
          acolhedor: agentName,
          campaign: l.campaign_name || null,
          classification,
        });
        
        if (classification === 'ai') closedByAI++;
        else if (classification === 'assisted') closedAssisted++;
        else if (classification === 'noInteraction') closedNoInteraction++;
        else closedWithHuman++;
 
        if (!agentDetailMap.has(agentName)) agentDetailMap.set(agentName, { ai: 0, assisted: 0, human: 0, noInteraction: 0 });
        const detail = agentDetailMap.get(agentName)!;
        detail[classification]++;
      }
 
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
        closedByAgentDetailed: Array.from(agentDetailMap.entries()).map(([agent, d]) => ({ agent, ai: d.ai, assisted: d.assisted, human: d.human, noInteraction: d.noInteraction, total: d.ai + d.assisted + d.human + d.noInteraction })).sort((a, b) => b.total - a.total),
        closedByCampaign: Array.from(campaignMap.entries()).map(([campaign, count]) => ({ campaign, count })).sort((a, b) => b.count - a.count),
        closedByAI, closedAssisted, closedWithHuman, closedNoInteraction, closedTotal,
        closedLeadDetails,
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
