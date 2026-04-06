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
  newConvDetails: NewConvDetail[];
  signedDocuments: number;
  groupsCreated: number;
  casesCreated: number;
  processesCreated: number;
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
    closedByAgent: [], closedByCampaign: [], newConvDetails: [],
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

      // Unique phones from inbound
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null }>();
      for (const msg of inboundData) {
        if (msg.phone.length > 13 || msg.phone.includes('@g.us')) continue;
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, first_message_at: msg.created_at, instance_name: msg.instance_name });
        }
      }
      const uniquePhones = Array.from(phoneMap.keys());
      const totalInbound = uniquePhones.length;

      // Check which had messages before (not truly new)
      const oldPhones = new Set<string>();
      for (let i = 0; i < uniquePhones.length; i += 200) {
        const batch = uniquePhones.slice(i, i + 200);
        const { data: oldMsgs } = await supabase
          .from('whatsapp_messages')
          .select('phone')
          .eq('direction', 'inbound')
          .lt('created_at', todayStart)
          .in('phone', batch);
        (oldMsgs || []).forEach(m => oldPhones.add(m.phone));
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

      // Closed leads by agent (acolhedor) and campaign
      const { data: closedLeads } = await supabase
        .from('leads')
        .select('acolhedor, campaign_name, lead_status')
        .eq('lead_status', 'closed')
        .gte('updated_at', todayStart)
        .lte('updated_at', todayEnd);

      const agentMap = new Map<string, number>();
      const campaignMap = new Map<string, number>();
      for (const l of (closedLeads || [])) {
        if (l.acolhedor) agentMap.set(l.acolhedor, (agentMap.get(l.acolhedor) || 0) + 1);
        if (l.campaign_name) campaignMap.set(l.campaign_name, (campaignMap.get(l.campaign_name) || 0) + 1);
      }

      setMetrics({
        newConversations: trulyNewPhones.length,
        responseRate,
        avgResponseTimeMin,
        respondedCount,
        totalInbound,
        closedByAgent: Array.from(agentMap.entries()).map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count),
        closedByCampaign: Array.from(campaignMap.entries()).map(([campaign, count]) => ({ campaign, count })).sort((a, b) => b.count - a.count),
        newConvDetails,
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
