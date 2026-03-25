import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, LabelList } from 'recharts';
import { Users, Clock, TrendingUp, MessageSquare, Zap, Target, Timer, BarChart3, PhoneForwarded, FileSignature, ExternalLink, GitBranch, AlertTriangle, Send, Loader2, ChevronRight, Phone, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { format, subDays, startOfDay, endOfDay, differenceInMinutes, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { ptBR } from 'date-fns/locale';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DashboardChatPreview } from './DashboardChatPreview';

interface LeadWithMessages {
  id: string;
  lead_name: string;
  lead_phone: string | null;
  source: string;
  status: string;
  created_at: string;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  board_id: string | null;
  first_response_at?: string | null;
}

interface ConversationSummary {
  phone: string;
  contactName: string | null;
  firstMessageAt: string;
  inboundCount: number;
  outboundCount: number;
  hasOutboundReply: boolean;
  firstInboundAt: string | null;
  firstOutboundAt: string | null;
  instanceName: string | null;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
}

interface LeadFollowupDetail {
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  outboundCount: number;
  inboundCount: number;
  lastOutboundAt: string | null;
  instanceName: string | null;
  stageName: string | null;
  stageColor: string | null;
}

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'this_week', label: 'Esta semana' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'this_year', label: 'Este ano' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '14', label: 'Últimos 14 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '60', label: 'Últimos 60 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

function getTimePeriod(hour: number): string {
  if (hour >= 6 && hour < 12) return 'Manhã (6h-12h)';
  if (hour >= 12 && hour < 18) return 'Tarde (12h-18h)';
  if (hour >= 18 && hour < 24) return 'Noite (18h-00h)';
  return 'Madrugada (00h-6h)';
}

function formatResponseTime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

type SheetType = 'new_convs' | 'followups' | 'documents' | 'funnel' | 'slow_responses' | 'conversations' | 'qualified' | 'converted' | 'lead_followups' | null;

interface WhatsAppLeadsDashboardProps {
  onOpenChat?: (phone: string) => void;
}

export function WhatsAppLeadsDashboard({ onOpenChat }: WhatsAppLeadsDashboardProps = {}) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LeadWithMessages[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('today');
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState('all');

  // New metrics state
  const [todayNewConvs, setTodayNewConvs] = useState<{ phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null; has_lead: boolean; has_contact: boolean; was_responded: boolean; response_time_minutes: number | null; last_inbound_at: string | null; outbound_count: number }[]>([]);
  const [todayFollowups, setTodayFollowups] = useState<{ phone: string; contact_name: string | null; outbound_count: number; last_outbound_at: string; instance_name: string | null }[]>([]);
  const [todayDocs, setTodayDocs] = useState<{ id: string; document_name: string; template_name: string | null; signer_name: string | null; status: string; created_at: string }[]>([]);
  const [funnelStages, setFunnelStages] = useState<{ stageName: string; stageColor: string; count: number; msgCount: number; followupCount: number; leads: { id: string; name: string; phone: string | null; outboundMsgs: number; inboundMsgs: number; lastActivity: string | null }[] }[]>([]);
  const [sheetOpen, setSheetOpen] = useState<SheetType>(null);
  const [selectedFunnelStage, setSelectedFunnelStage] = useState<string | null>(null);
  const [selectedSlowBucket, setSelectedSlowBucket] = useState<string | null>(null);
  const [convResponseFilter, setConvResponseFilter] = useState<'all' | 'responded' | 'waiting' | 'fast' | 'slow'>('all');
  const [sendingReport, setSendingReport] = useState(false);
  const [leadFollowupDetails, setLeadFollowupDetails] = useState<LeadFollowupDetail[]>([]);
  const [chatPreview, setChatPreview] = useState<{ phone: string; contactName: string | null; instanceName: string | null; hasLead: boolean; hasContact: boolean; wasResponded: boolean; responseTimeMinutes: number | null } | null>(null);

  // Stage info map for reuse
  const [stageInfoMap, setStageInfoMap] = useState<Map<string, { name: string; color: string }>>(new Map());
  const [leadStageMap, setLeadStageMap] = useState<Map<string, { stageId: string; boardId: string }>>(new Map());

  const getPeriodRange = useCallback(() => {
    const now = new Date();
    let sinceDate: Date;
    let untilDate: Date | null = null;
    switch (period) {
      case 'today':
        sinceDate = startOfDay(now);
        break;
      case 'yesterday':
        sinceDate = startOfDay(subDays(now, 1));
        untilDate = endOfDay(subDays(now, 1));
        break;
      case 'this_week': {
        const day = now.getDay();
        const diff = day === 0 ? 6 : day - 1;
        sinceDate = startOfDay(subDays(now, diff));
        break;
      }
      case 'this_month':
        sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        sinceDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        sinceDate = subDays(now, parseInt(period));
    }
    return { since: sinceDate.toISOString(), until: untilDate ? untilDate.toISOString() : null };
  }, [period]);

  const periodLabel = useMemo(() => {
    const opt = PERIOD_OPTIONS.find(o => o.value === period);
    return opt?.label || 'Período';
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [period]);

  // Re-fetch today metrics when instance filter changes
  useEffect(() => {
    fetchTodayMetrics();
  }, [selectedInstance]);

  const fetchData = async () => {
    setLoading(true);
    const { since, until: untilIso } = getPeriodRange();

    // Paginated fetch for messages to avoid 1000-row default limit
    const fetchAllMessages = async () => {
      const allRows: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        let q = supabase
          .from('whatsapp_messages')
          .select('id, phone, direction, created_at, lead_id, instance_name, contact_name')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1);
        if (untilIso) q = q.lte('created_at', untilIso);
        const { data } = await q;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allRows;
    };

    let leadsQuery = supabase
      .from('leads')
      .select('id, lead_name, lead_phone, source, status, created_at, campaign_name, adset_name, ad_name, board_id')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (untilIso) leadsQuery = leadsQuery.lte('created_at', untilIso);

    const [allMsgs, leadsRes, instRes] = await Promise.all([
      fetchAllMessages(),
      leadsQuery,
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, receive_leads, ad_account_name, owner_phone')
        .eq('is_active', true),
    ]);

    if (leadsRes.data) setLeads(leadsRes.data as LeadWithMessages[]);
    setMessages(allMsgs);
    if (instRes.data) setInstances(instRes.data);
    setLoading(false);

    // Fetch today's metrics for new cards
    fetchTodayMetrics();
    fetchFunnelStages(allMsgs);
  };

  const fetchTodayMetrics = async () => {
    const { since: todayStart, until: todayEnd } = getPeriodRange();

    // Helper to fetch all rows paginated (avoid 1000-row default limit)
    const fetchAllInbound = async () => {
      const allRows: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        let q = supabase
          .from('whatsapp_messages')
          .select('phone, contact_name, created_at, instance_name')
          .eq('direction', 'inbound')
          .not('phone', 'like', '%@g.us')
          .gte('created_at', todayStart)
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1);
        if (todayEnd) q = q.lte('created_at', todayEnd);
        if (selectedInstance !== 'all') q = q.eq('instance_name', selectedInstance);
        const { data } = await q;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allRows;
    };

    let outboundQuery = supabase
      .from('whatsapp_messages')
      .select('phone, contact_name, created_at, instance_name')
      .eq('direction', 'outbound')
      .gte('created_at', todayStart)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (todayEnd) outboundQuery = outboundQuery.lte('created_at', todayEnd);

    // Apply instance filter to today metrics too
    if (selectedInstance !== 'all') {
      outboundQuery = outboundQuery.eq('instance_name', selectedInstance);
    }

    let docsQuery = supabase
      .from('zapsign_documents')
      .select('id, document_name, template_name, signer_name, status, created_at')
      .gte('created_at', todayStart)
      .order('created_at', { ascending: false });
    if (todayEnd) docsQuery = docsQuery.lte('created_at', todayEnd);

    const [inboundData, followupsRes, docsRes] = await Promise.all([
      fetchAllInbound(),
      outboundQuery,
      docsQuery,
    ]);

    if (inboundData.length > 0) {
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; first_message_at: string; instance_name: string | null }>();
      for (const msg of inboundData) {
        // Skip group conversations (phones > 13 digits or containing @g.us)
        if (msg.phone.length > 13 || msg.phone.includes('@g.us')) continue;
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, first_message_at: msg.created_at, instance_name: msg.instance_name });
        }
      }
      const uniquePhones = Array.from(phoneMap.keys());

      if (uniquePhones.length > 0) {
        // Check which phones had messages BEFORE today (not truly new) - paginate in batches of 200
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

        // Check which phones have leads or contacts
        const phoneSuffixes = uniquePhones.filter(p => !oldPhones.has(p)).map(p => p.slice(-8));
        
        let leadPhones = new Set<string>();
        let contactPhones = new Set<string>();

        if (phoneSuffixes.length > 0) {
          const [leadsRes, contactsRes] = await Promise.all([
            supabase.from('leads').select('lead_phone').not('lead_phone', 'is', null),
            supabase.from('contacts').select('phone').not('phone', 'is', null),
          ]);
          
          const leadPhoneList = (leadsRes.data || []).map(l => (l.lead_phone || '').replace(/\D/g, ''));
          const contactPhoneList = (contactsRes.data || []).map(c => (c.phone || '').replace(/\D/g, ''));
          
          for (const phone of uniquePhones) {
            const suffix = phone.slice(-8);
            if (leadPhoneList.some(lp => lp.endsWith(suffix))) leadPhones.add(phone);
            if (contactPhoneList.some(cp => cp.endsWith(suffix))) contactPhones.add(phone);
          }
        }

        // Only keep truly new conversations (no prior messages)
        const trulyNewPhones = uniquePhones.filter(p => !oldPhones.has(p));

        // Fetch outbound messages for these phones to check response status
        const outboundMap = new Map<string, { count: number; first_at: string | null }>();
        for (let i = 0; i < trulyNewPhones.length; i += 200) {
          const batch = trulyNewPhones.slice(i, i + 200);
          let outQ = supabase
            .from('whatsapp_messages')
            .select('phone, created_at')
            .eq('direction', 'outbound')
            .gte('created_at', todayStart)
            .in('phone', batch)
            .order('created_at', { ascending: true });
          if (todayEnd) outQ = outQ.lte('created_at', todayEnd);
          const { data: outMsgs } = await outQ;
          for (const m of (outMsgs || [])) {
            const existing = outboundMap.get(m.phone);
            if (!existing) {
              outboundMap.set(m.phone, { count: 1, first_at: m.created_at });
            } else {
              existing.count++;
            }
          }
        }

        // Also get last inbound message time for each phone
        const lastInboundMap = new Map<string, string>();
        for (const msg of inboundData) {
          if (trulyNewPhones.includes(msg.phone)) {
            const existing = lastInboundMap.get(msg.phone);
            if (!existing || msg.created_at > existing) {
              lastInboundMap.set(msg.phone, msg.created_at);
            }
          }
        }

        const trulyNew = trulyNewPhones.map(p => {
          const convData = phoneMap.get(p)!;
          const outbound = outboundMap.get(p);
          const lastInbound = lastInboundMap.get(p) || null;
          const wasResponded = !!outbound;
          let responseTimeMinutes: number | null = null;
          if (outbound?.first_at) {
            responseTimeMinutes = differenceInMinutes(parseISO(outbound.first_at), parseISO(convData.first_message_at));
          }
          return {
            ...convData,
            has_lead: leadPhones.has(p),
            has_contact: contactPhones.has(p),
            was_responded: wasResponded,
            response_time_minutes: responseTimeMinutes,
            last_inbound_at: lastInbound,
            outbound_count: outbound?.count || 0,
          };
        });

        setTodayNewConvs(trulyNew);
      } else {
        setTodayNewConvs([]);
      }
    }

    if (followupsRes.data) {
      const phoneMap = new Map<string, { phone: string; contact_name: string | null; outbound_count: number; last_outbound_at: string; instance_name: string | null }>();
      for (const msg of followupsRes.data) {
        const existing = phoneMap.get(msg.phone);
        if (!existing) {
          phoneMap.set(msg.phone, { phone: msg.phone, contact_name: msg.contact_name, outbound_count: 1, last_outbound_at: msg.created_at, instance_name: msg.instance_name });
        } else {
          existing.outbound_count++;
        }
      }
      setTodayFollowups(Array.from(phoneMap.values()));
    }

    if (docsRes.data) {
      setTodayDocs(docsRes.data as any[]);
    }
  };

  const fetchFunnelStages = async (periodMessages: any[]) => {
    try {
      const { data: boardsData } = await supabase
        .from('kanban_boards')
        .select('id, name, stages');

      if (!boardsData || boardsData.length === 0) return;

      const { since: funnelStart, until: funnelEnd } = getPeriodRange();
      
      let funnelQuery = supabase
        .from('whatsapp_messages')
        .select('lead_id, phone, direction, instance_name')
        .not('lead_id', 'is', null)
        .gte('created_at', funnelStart)
        .limit(1000);
      if (funnelEnd) funnelQuery = funnelQuery.lte('created_at', funnelEnd);

      const { data: whatsappLeads } = await funnelQuery;

      if (!whatsappLeads || whatsappLeads.length === 0) {
        setFunnelStages([]);
        return;
      }

      const uniqueLeadIds = [...new Set(whatsappLeads.map(m => m.lead_id).filter(Boolean))];

      // Build per-lead message counts
      const leadMsgCounts = new Map<string, { outbound: number; inbound: number; lastAt: string | null }>();
      for (const m of whatsappLeads) {
        if (!m.lead_id) continue;
        const existing = leadMsgCounts.get(m.lead_id);
        if (!existing) {
          leadMsgCounts.set(m.lead_id, {
            outbound: m.direction === 'outbound' ? 1 : 0,
            inbound: m.direction === 'inbound' ? 1 : 0,
            lastAt: null,
          });
        } else {
          if (m.direction === 'outbound') existing.outbound++;
          else existing.inbound++;
        }
      }

      const { data: leadsData } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, board_id')
        .in('id', uniqueLeadIds);

      if (!leadsData) return;

      const { data: stageHistory } = await supabase
        .from('lead_stage_history')
        .select('lead_id, to_stage, to_board_id, changed_at')
        .in('lead_id', uniqueLeadIds)
        .order('changed_at', { ascending: false });

      const localLeadStageMap = new Map<string, { stageId: string; boardId: string }>();
      if (stageHistory) {
        for (const h of stageHistory) {
          if (!localLeadStageMap.has(h.lead_id)) {
            localLeadStageMap.set(h.lead_id, { stageId: h.to_stage, boardId: h.to_board_id || '' });
          }
        }
      }
      setLeadStageMap(localLeadStageMap);

      const localStageInfoMap = new Map<string, { name: string; color: string }>();
      for (const board of boardsData) {
        const stages = board.stages as any[];
        if (stages) {
          for (const stage of stages) {
            localStageInfoMap.set(stage.id, { name: stage.name, color: stage.color || '#6b7280' });
          }
        }
      }
      setStageInfoMap(localStageInfoMap);

      const stageGroups = new Map<string, { stageName: string; stageColor: string; msgCount: number; followupCount: number; leads: { id: string; name: string; phone: string | null; outboundMsgs: number; inboundMsgs: number; lastActivity: string | null }[] }>();

      for (const lead of leadsData) {
        const stageInfo = localLeadStageMap.get(lead.id);
        let stageKey = '__no_stage__';
        let stageName = 'Sem etapa';
        let stageColor = '#6b7280';

        if (stageInfo) {
          const info = localStageInfoMap.get(stageInfo.stageId);
          if (info) {
            stageKey = stageInfo.stageId;
            stageName = info.name;
            stageColor = info.color;
          }
        }

        const counts = leadMsgCounts.get(lead.id) || { outbound: 0, inbound: 0, lastAt: null };

        if (!stageGroups.has(stageKey)) {
          stageGroups.set(stageKey, { stageName, stageColor, msgCount: 0, followupCount: 0, leads: [] });
        }
        const group = stageGroups.get(stageKey)!;
        group.msgCount += counts.outbound + counts.inbound;
        group.followupCount += counts.outbound;
        group.leads.push({
          id: lead.id,
          name: lead.lead_name || 'Sem nome',
          phone: lead.lead_phone,
          outboundMsgs: counts.outbound,
          inboundMsgs: counts.inbound,
          lastActivity: counts.lastAt,
        });
      }

      const result = Array.from(stageGroups.values())
        .map(g => ({ ...g, count: g.leads.length }))
        .sort((a, b) => b.count - a.count);

      setFunnelStages(result);
    } catch (err) {
      console.error('Error fetching funnel stages:', err);
    }
  };

  // Build lead follow-up details from messages
  const buildLeadFollowupDetails = useCallback(() => {
    const leadMap = new Map<string, LeadFollowupDetail>();
    
    for (const msg of messages) {
      if (!msg.lead_id) continue;
      const existing = leadMap.get(msg.lead_id);
      if (!existing) {
        const lead = leads.find(l => l.id === msg.lead_id);
        const stageData = leadStageMap.get(msg.lead_id);
        const stageInfo = stageData ? stageInfoMap.get(stageData.stageId) : null;
        leadMap.set(msg.lead_id, {
          leadId: msg.lead_id,
          leadName: lead?.lead_name || msg.contact_name || msg.phone,
          leadPhone: lead?.lead_phone || msg.phone,
          outboundCount: msg.direction === 'outbound' ? 1 : 0,
          inboundCount: msg.direction === 'inbound' ? 1 : 0,
          lastOutboundAt: msg.direction === 'outbound' ? msg.created_at : null,
          instanceName: msg.instance_name,
          stageName: stageInfo?.name || null,
          stageColor: stageInfo?.color || null,
        });
      } else {
        if (msg.direction === 'outbound') {
          existing.outboundCount++;
          existing.lastOutboundAt = msg.created_at;
        } else {
          existing.inboundCount++;
        }
      }
    }

    const details = Array.from(leadMap.values()).sort((a, b) => b.outboundCount - a.outboundCount);
    setLeadFollowupDetails(details);
  }, [messages, leads, leadStageMap, stageInfoMap]);

  useEffect(() => {
    if (messages.length > 0) {
      buildLeadFollowupDetails();
    }
  }, [messages, leads, leadStageMap, stageInfoMap, buildLeadFollowupDetails]);

  // Filter messages by selected instance
  const filteredMessages = useMemo(() => {
    if (selectedInstance === 'all') return messages;
    return messages.filter(m => m.instance_name === selectedInstance);
  }, [messages, selectedInstance]);

  // Build conversations from messages (grouped by phone)
  const conversations = useMemo<ConversationSummary[]>(() => {
    const phoneMap = new Map<string, ConversationSummary>();
    filteredMessages.forEach(msg => {
      const existing = phoneMap.get(msg.phone);
      if (!existing) {
        phoneMap.set(msg.phone, {
          phone: msg.phone,
          contactName: msg.contact_name || null,
          firstMessageAt: msg.created_at,
          inboundCount: msg.direction === 'inbound' ? 1 : 0,
          outboundCount: msg.direction === 'outbound' ? 1 : 0,
          hasOutboundReply: msg.direction === 'outbound',
          firstInboundAt: msg.direction === 'inbound' ? msg.created_at : null,
          firstOutboundAt: msg.direction === 'outbound' ? msg.created_at : null,
          instanceName: msg.instance_name,
          leadId: msg.lead_id,
          leadName: msg.contact_name || null,
          leadPhone: msg.phone,
        });
      } else {
        if (msg.direction === 'inbound') {
          existing.inboundCount++;
          if (!existing.firstInboundAt) existing.firstInboundAt = msg.created_at;
        } else {
          existing.outboundCount++;
          existing.hasOutboundReply = true;
          if (!existing.firstOutboundAt) existing.firstOutboundAt = msg.created_at;
        }
        if (!existing.leadId && msg.lead_id) existing.leadId = msg.lead_id;
        if (!existing.contactName && msg.contact_name) existing.contactName = msg.contact_name;
      }
    });
    return Array.from(phoneMap.values());
  }, [filteredMessages]);

  const inboundConversations = useMemo(() => {
    return conversations.filter(c => c.inboundCount > 0);
  }, [conversations]);

  const filteredLeadIds = useMemo(() => {
    if (selectedInstance === 'all') return null;
    const ids = new Set<string>();
    filteredMessages.forEach(m => { if (m.lead_id) ids.add(m.lead_id); });
    return ids;
  }, [filteredMessages, selectedInstance]);

  const filteredLeads = useMemo(() => {
    if (!filteredLeadIds) return leads;
    return leads.filter(l => filteredLeadIds.has(l.id));
  }, [leads, filteredLeadIds]);

  const responseMetrics = useMemo(() => {
    const responseTimes: number[] = [];
    
    inboundConversations.forEach(conv => {
      if (conv.firstInboundAt && conv.firstOutboundAt) {
        const diff = differenceInMinutes(parseISO(conv.firstOutboundAt), parseISO(conv.firstInboundAt));
        if (diff >= 0 && diff < 1440) responseTimes.push(diff);
      }
    });

    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    const conversationsWithReply = inboundConversations.filter(c => c.hasOutboundReply).length;
    const totalInbound = inboundConversations.length;
    const responseRate = totalInbound > 0 ? Math.round((conversationsWithReply / totalInbound) * 100) : 0;

    return { avgResponseTime, responseRate, responseTimes, leadsWithResponse: conversationsWithReply, leadsWithInbound: totalInbound };
  }, [inboundConversations]);

  const leadsByDay = useMemo(() => {
    const dayMap = new Map<string, number>();
    inboundConversations.forEach(c => {
      const day = format(parseISO(c.firstInboundAt!), 'dd/MM', { locale: ptBR });
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });
    return Array.from(dayMap.entries())
      .map(([day, count]) => ({ day, count }))
      .reverse();
  }, [inboundConversations]);

  const leadsByTimePeriod = useMemo(() => {
    const periodMap = new Map<string, number>();
    ['Madrugada (00h-6h)', 'Manhã (6h-12h)', 'Tarde (12h-18h)', 'Noite (18h-00h)'].forEach(p => periodMap.set(p, 0));
    
    inboundConversations.forEach(c => {
      const hour = parseISO(c.firstInboundAt!).getHours();
      const p = getTimePeriod(hour);
      periodMap.set(p, (periodMap.get(p) || 0) + 1);
    });
    return Array.from(periodMap.entries()).map(([name, value]) => ({ name, value }));
  }, [inboundConversations]);

  const leadsByHour = useMemo(() => {
    const hourMap = new Map<number, number>();
    for (let i = 0; i < 24; i++) hourMap.set(i, 0);
    inboundConversations.forEach(c => {
      const hour = parseISO(c.firstInboundAt!).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    });
    return Array.from(hourMap.entries()).map(([hour, count]) => ({
      hour: `${hour}h`,
      count,
    }));
  }, [inboundConversations]);

  const conversionMetrics = useMemo(() => {
    const total = filteredLeads.length;
    const qualified = filteredLeads.filter(l => l.status === 'qualified' || l.status === 'converted').length;
    const converted = filteredLeads.filter(l => l.status === 'converted').length;
    
    return {
      total,
      qualified,
      converted,
      qualifiedLeads: filteredLeads.filter(l => l.status === 'qualified' || l.status === 'converted'),
      convertedLeads: filteredLeads.filter(l => l.status === 'converted'),
      qualificationRate: total > 0 ? Math.round((qualified / total) * 100) : 0,
      conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
    };
  }, [filteredLeads]);

  const topCampaigns = useMemo(() => {
    const campaignMap = new Map<string, { count: number; converted: number }>();
    filteredLeads.forEach(l => {
      const name = l.campaign_name || 'Sem Campanha';
      const existing = campaignMap.get(name) || { count: 0, converted: 0 };
      existing.count++;
      if (l.status === 'converted' || l.status === 'qualified') existing.converted++;
      campaignMap.set(name, existing);
    });
    return Array.from(campaignMap.entries())
      .map(([name, data]) => ({
        name: name.length > 30 ? name.slice(0, 30) + '...' : name,
        fullName: name,
        leads: data.count,
        converted: data.converted,
        rate: data.count > 0 ? Math.round((data.converted / data.count) * 100) : 0,
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 10);
  }, [filteredLeads]);

  const slowResponseBuckets = useMemo(() => {
    const buckets = [
      { label: '> 10min', min: 10, conversations: [] as (ConversationSummary & { responseTime: number })[] },
      { label: '> 20min', min: 20, conversations: [] as (ConversationSummary & { responseTime: number })[] },
      { label: '> 30min', min: 30, conversations: [] as (ConversationSummary & { responseTime: number })[] },
      { label: '> 1h', min: 60, conversations: [] as (ConversationSummary & { responseTime: number })[] },
    ];

    inboundConversations.forEach(conv => {
      if (conv.firstInboundAt && conv.firstOutboundAt) {
        const diff = differenceInMinutes(parseISO(conv.firstOutboundAt), parseISO(conv.firstInboundAt));
        if (diff >= 0 && diff < 1440) {
          buckets.forEach(b => {
            if (diff >= b.min) {
              b.conversations.push({ ...conv, responseTime: diff });
            }
          });
        }
      } else if (conv.firstInboundAt && !conv.firstOutboundAt) {
        const diff = differenceInMinutes(new Date(), parseISO(conv.firstInboundAt));
        buckets.forEach(b => {
          if (diff >= b.min) {
            b.conversations.push({ ...conv, responseTime: diff });
          }
        });
      }
    });

    return buckets;
  }, [inboundConversations]);

  // Navigate to lead
  const openLead = (leadId: string, boardId?: string | null) => {
    if (boardId) {
      navigate(`/kanban?board=${boardId}&openLead=${leadId}`);
    } else {
      navigate(`/kanban?openLead=${leadId}`);
    }
  };

  // Total follow-ups count
  const totalFollowups = useMemo(() => {
    return leadFollowupDetails.reduce((acc, l) => acc + l.outboundCount, 0);
  }, [leadFollowupDetails]);

  // Send enhanced report via WhatsApp
  const sendReport = async () => {
    setSendingReport(true);
    try {
      const rayInstance = instances.find(i => i.instance_name?.toLowerCase() === 'raymsandreson');
      if (!rayInstance) {
        toast.error('Instância "raymsandreson" não encontrada');
        setSendingReport(false);
        return;
      }

      // Determine which instance the report is about
      const reportInstanceName = selectedInstance === 'all' ? 'Todas' : selectedInstance;
      const reportInstance = selectedInstance !== 'all' ? instances.find(i => i.instance_name === selectedInstance) : null;

      // Get all active instances with owner_phone
      const { data: allInstances } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, owner_phone')
        .eq('is_active', true);

      if (!allInstances) {
        toast.error('Erro ao carregar instâncias');
        setSendingReport(false);
        return;
      }

      const now = format(new Date(), 'dd/MM/yyyy HH:mm');
      const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label || period;
      
      const reportLines = [
        `📊 *RELATÓRIO DE ATENDIMENTO*`,
        `📅 ${periodLabel} — ${now}`,
        `📱 Instância: *${reportInstanceName}*`,
        '',
        `━━━━━━━━━━━━━━━━━━`,
        `📈 *RESUMO GERAL*`,
        `━━━━━━━━━━━━━━━━━━`,
        `👥 Conversas: *${inboundConversations.length}*`,
        `💬 Msgs totais: *${filteredMessages.length}*`,
        `📤 Follow-ups enviados: *${totalFollowups}*`,
        `✅ Taxa de Resposta: *${responseMetrics.responseRate}%* (${responseMetrics.leadsWithResponse}/${responseMetrics.leadsWithInbound})`,
        `⏱ Tempo Médio 1ª Resp: *${formatResponseTime(responseMetrics.avgResponseTime)}*`,
        `⚡ Resp. < 5min: *${responseMetrics.responseTimes.length > 0 ? Math.round((responseMetrics.responseTimes.filter(t => t < 5).length / responseMetrics.responseTimes.length) * 100) : 0}%*`,
        '',
        `━━━━━━━━━━━━━━━━━━`,
        `🎯 *QUALIFICAÇÃO*`,
        `━━━━━━━━━━━━━━━━━━`,
        `✅ Qualificados: *${conversionMetrics.qualified}* (${conversionMetrics.qualificationRate}%)`,
        `📈 Convertidos: *${conversionMetrics.converted}* (${conversionMetrics.conversionRate}%)`,
      ];

      // Slow responses
      const slowWithData = slowResponseBuckets.filter(b => b.conversations.length > 0);
      if (slowWithData.length > 0) {
        reportLines.push(
          '',
          `━━━━━━━━━━━━━━━━━━`,
          `🔴 *RESPOSTAS LENTAS*`,
          `━━━━━━━━━━━━━━━━━━`,
        );
        slowResponseBuckets.forEach(b => {
          reportLines.push(`  ${b.label}: *${b.conversations.length}* conversas`);
        });

        // List leads without response
        const noResponseConvs = slowResponseBuckets[3]?.conversations.filter(c => !c.firstOutboundAt) || [];
        if (noResponseConvs.length > 0) {
          reportLines.push('', '⚠️ *Sem resposta:*');
          noResponseConvs.slice(0, 10).forEach(c => {
            reportLines.push(`  • ${c.contactName || c.phone}`);
          });
        }
      }

      // Funnel stages with messages
      if (funnelStages.length > 0) {
        reportLines.push(
          '',
          `━━━━━━━━━━━━━━━━━━`,
          `📊 *FUNIL - POR ETAPA*`,
          `━━━━━━━━━━━━━━━━━━`,
        );
        funnelStages.forEach(s => {
          reportLines.push(`📍 *${s.stageName}:* ${s.count} leads | ${s.msgCount} msgs | ${s.followupCount} follow-ups`);
          // List leads in each stage
          s.leads.slice(0, 5).forEach(l => {
            reportLines.push(`   └ ${l.name}${l.outboundMsgs > 0 ? ` (${l.outboundMsgs} enviadas, ${l.inboundMsgs} recebidas)` : ''}`);
          });
          if (s.leads.length > 5) {
            reportLines.push(`   └ ... e mais ${s.leads.length - 5}`);
          }
        });
      }

      // Lead follow-up details (top 15)
      if (leadFollowupDetails.length > 0) {
        reportLines.push(
          '',
          `━━━━━━━━━━━━━━━━━━`,
          `📞 *FOLLOW-UPS POR LEAD*`,
          `━━━━━━━━━━━━━━━━━━`,
        );
        leadFollowupDetails.slice(0, 15).forEach((l, i) => {
          const stageLabel = l.stageName ? ` [${l.stageName}]` : '';
          reportLines.push(`${i + 1}. ${l.leadName}${stageLabel}: ${l.outboundCount} enviadas, ${l.inboundCount} recebidas`);
        });
        if (leadFollowupDetails.length > 15) {
          reportLines.push(`... e mais ${leadFollowupDetails.length - 15} leads`);
        }
      }

      // Today metrics
      reportLines.push(
        '',
        `━━━━━━━━━━━━━━━━━━`,
        `📅 *HOJE*`,
        `━━━━━━━━━━━━━━━━━━`,
        `🆕 Conversas Novas: *${todayNewConvs.length}*`,
        `📤 Follow-ups: *${todayFollowups.length}* contatos`,
        `📄 Documentos: *${todayDocs.length}*`,
      );

      const reportText = reportLines.join('\n');

      // Send logic: if a specific instance is selected, send to its owner; otherwise send to all
      let sentCount = 0;
      const sentPhones = new Set<string>();

      if (reportInstance && reportInstance.owner_phone) {
        // Send to the selected instance's owner
        try {
          await supabase.functions.invoke('send-whatsapp', {
            body: {
              phone: reportInstance.owner_phone,
              message: reportText,
              instance_id: rayInstance.id,
            },
          });
          sentCount++;
        } catch (e) {
          console.error(`Error sending report to ${reportInstance.owner_phone}:`, e);
        }
      } else {
        // Send to all instance owners
        for (const inst of allInstances) {
          if (!inst.owner_phone || sentPhones.has(inst.owner_phone)) continue;
          if (inst.id === rayInstance.id) continue;
          sentPhones.add(inst.owner_phone);

          try {
            await supabase.functions.invoke('send-whatsapp', {
              body: {
                phone: inst.owner_phone,
                message: reportText,
                instance_id: rayInstance.id,
              },
            });
            sentCount++;
          } catch (e) {
            console.error(`Error sending report to ${inst.owner_phone}:`, e);
          }
        }
      }

      toast.success(`Relatório enviado para ${sentCount} usuário(s)`);
    } catch (error) {
      console.error('Error sending report:', error);
      toast.error('Erro ao enviar relatório');
    } finally {
      setSendingReport(false);
    }
  };

  const leadsByInstance = useMemo(() => {
    const receiveInstances = instances.filter(i => i.receive_leads);
    if (receiveInstances.length === 0) return [];

    const instMap = new Map<string, number>();
    messages.forEach(msg => {
      if (msg.direction === 'inbound' && msg.instance_name) {
        instMap.set(msg.instance_name, (instMap.get(msg.instance_name) || 0) + 1);
      }
    });
    return receiveInstances.map(inst => ({
      name: inst.instance_name,
      adAccount: inst.ad_account_name || 'N/A',
      messages: instMap.get(inst.instance_name) || 0,
    }));
  }, [instances, messages]);

  const responseTimeDistribution = useMemo(() => {
    const buckets = [
      { label: '< 5min', max: 5, count: 0 },
      { label: '5-15min', max: 15, count: 0 },
      { label: '15-30min', max: 30, count: 0 },
      { label: '30-60min', max: 60, count: 0 },
      { label: '1-2h', max: 120, count: 0 },
      { label: '> 2h', max: Infinity, count: 0 },
    ];
    responseMetrics.responseTimes.forEach(t => {
      const bucket = buckets.find(b => t < b.max);
      if (bucket) bucket.count++;
    });
    return buckets.map(b => ({ name: b.label, value: b.count }));
  }, [responseMetrics]);

  // Clickable lead row component
  const LeadRow = ({ lead, extra }: { lead: { id: string; name?: string; lead_name?: string; phone?: string | null; lead_phone?: string | null }; extra?: React.ReactNode }) => (
    <div
      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group"
      onClick={() => openLead(lead.id)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{lead.name || lead.lead_name || 'Sem nome'}</p>
        {(lead.phone || lead.lead_phone) && <p className="text-xs text-muted-foreground">{lead.phone || lead.lead_phone}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {extra}
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Dashboard de Leads
          </h2>
          <p className="text-xs text-muted-foreground">Análise de performance de captação via WhatsApp e Anúncios</p>
        </div>
        <div className="flex items-center gap-2">
          {instances.length > 0 && (
            <Select value={selectedInstance} onValueChange={setSelectedInstance}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Instância" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas instâncias</SelectItem>
                {instances.map(i => (
                  <SelectItem key={i.id} value={i.instance_name}>{i.instance_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards - all clickable */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all" onClick={() => setSheetOpen('conversations')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Conversas</span>
            </div>
            <p className="text-2xl font-bold">{inboundConversations.length}</p>
            <p className="text-xs text-muted-foreground">{filteredMessages.length} msgs | {conversionMetrics.total} leads</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:ring-2 hover:ring-green-500/30 transition-all" onClick={() => setSheetOpen('qualified')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Qualificados</span>
            </div>
            <p className="text-2xl font-bold">{conversionMetrics.qualified}</p>
            <Badge variant="outline" className="text-xs">{conversionMetrics.qualificationRate}%</Badge>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:ring-2 hover:ring-blue-500/30 transition-all" onClick={() => setSheetOpen('converted')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Convertidos</span>
            </div>
            <p className="text-2xl font-bold">{conversionMetrics.converted}</p>
            <Badge variant="outline" className="text-xs">{conversionMetrics.conversionRate}%</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Taxa Resposta</span>
            </div>
            <p className="text-2xl font-bold">{responseMetrics.responseRate}%</p>
            <p className="text-xs text-muted-foreground">{responseMetrics.leadsWithResponse}/{responseMetrics.leadsWithInbound}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Tempo Médio</span>
            </div>
            <p className="text-2xl font-bold">{formatResponseTime(responseMetrics.avgResponseTime)}</p>
            <p className="text-xs text-muted-foreground">1ª resposta</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span className="text-xs text-muted-foreground">Resp. &lt; 5min</span>
            </div>
            <p className="text-2xl font-bold">
              {responseMetrics.responseTimes.length > 0
                ? Math.round((responseMetrics.responseTimes.filter(t => t < 5).length / responseMetrics.responseTimes.length) * 100)
                : 0}%
            </p>
            <p className="text-xs text-muted-foreground">velocidade ideal</p>
          </CardContent>
        </Card>
      </div>

      {/* Today's Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setSheetOpen('new_convs')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Conversas Novas {periodLabel}</span>
            </div>
            <p className="text-2xl font-bold">{todayNewConvs.length}</p>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-emerald-600 font-medium">{todayNewConvs.filter(c => c.has_lead).length} leads</span>
              <span className="text-primary font-medium">{todayNewConvs.filter(c => c.has_contact).length} contatos</span>
              <span className="text-muted-foreground">{todayNewConvs.filter(c => !c.has_lead && !c.has_contact).length} sem vínculo</span>
            </div>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-emerald-500/30 transition-all"
          onClick={() => setSheetOpen('lead_followups')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <PhoneForwarded className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Follow-ups</span>
            </div>
            <p className="text-2xl font-bold">{totalFollowups}</p>
            <p className="text-xs text-muted-foreground">{leadFollowupDetails.length} leads contactados</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setSheetOpen('followups')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Contatos {periodLabel}</span>
            </div>
            <p className="text-2xl font-bold">{todayFollowups.length}</p>
            <p className="text-xs text-muted-foreground">telefones contatados</p>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:ring-2 hover:ring-amber-500/30 transition-all"
          onClick={() => setSheetOpen('documents')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileSignature className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Documentos {periodLabel}</span>
            </div>
            <p className="text-2xl font-bold">{todayDocs.length}</p>
            <p className="text-xs text-muted-foreground">Clique para ver</p>
          </CardContent>
        </Card>
      </div>

      {/* Slow Response Cards + Report Button */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Respostas Lentas
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={sendReport}
              disabled={sendingReport}
            >
              {sendingReport ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Enviar Relatório {selectedInstance !== 'all' ? `(${selectedInstance})` : ''}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Conversas com tempo de resposta acima do ideal</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {slowResponseBuckets.map((bucket) => (
              <div
                key={bucket.label}
                className="p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors text-center"
                onClick={() => {
                  setSelectedSlowBucket(bucket.label);
                  setSheetOpen('slow_responses');
                }}
              >
                <p className="text-xs text-muted-foreground">{bucket.label}</p>
                <p className={`text-2xl font-bold ${bucket.conversations.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {bucket.conversations.length}
                </p>
                <p className="text-[10px] text-muted-foreground">conversas</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Funnel Stages with messages per stage */}
      {funnelStages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Conversas por Etapa do Funil ({periodLabel})
            </CardTitle>
            <p className="text-xs text-muted-foreground">Leads com conversas ativas · msgs enviadas · follow-ups</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {funnelStages.map((stage, i) => {
                const totalFunnel = funnelStages.reduce((a, s) => a + s.count, 0);
                const percent = totalFunnel > 0 ? Math.round((stage.count / totalFunnel) * 100) : 0;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedFunnelStage(stage.stageName);
                      setSheetOpen('funnel');
                    }}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stage.stageColor }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{stage.stageName}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>💬 {stage.msgCount}</span>
                          <span>📤 {stage.followupCount}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${percent}%`, backgroundColor: stage.stageColor }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{percent}%</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs font-bold">
                      {stage.count}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads por Dia</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={leadsByDay}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads por Período do Dia</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={leadsByTimePeriod}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => `${name.split(' ')[0]}: ${value}`}
                >
                  {leadsByTimePeriod.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição por Hora</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={leadsByHour}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Leads">
                  <LabelList dataKey="count" position="top" style={{ fontSize: 9, fill: 'hsl(var(--foreground))', fontWeight: 600 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribuição do Tempo de Resposta</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={responseTimeDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* 80/20 - Top Campaigns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Análise 80/20 - Top Campanhas
          </CardTitle>
          <p className="text-xs text-muted-foreground">Quais campanhas trazem mais resultados</p>
        </CardHeader>
        <CardContent>
          {topCampaigns.length > 0 ? (
            <div className="space-y-2">
              {topCampaigns.map((campaign, i) => {
                const percent = conversionMetrics.total > 0
                  ? Math.round((campaign.leads / conversionMetrics.total) * 100)
                  : 0;
                return (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                    <Badge variant={i < 3 ? 'default' : 'outline'} className="text-xs w-6 h-6 flex items-center justify-center p-0">
                      {i + 1}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" title={campaign.fullName}>{campaign.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{percent}%</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{campaign.leads}</p>
                      <p className="text-xs text-muted-foreground">{campaign.converted} conv.</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {campaign.rate}%
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma campanha encontrada no período</p>
          )}
        </CardContent>
      </Card>

      {/* Leads by Instance */}
      {leadsByInstance.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Mensagens por Instância (Recebe Leads)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {leadsByInstance.map((inst, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{inst.name}</p>
                    <p className="text-xs text-muted-foreground">Conta: {inst.adAccount}</p>
                  </div>
                  <Badge>{inst.messages} msgs</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== SHEETS ===== */}

      {/* Conversations Sheet */}
      <Sheet open={sheetOpen === 'conversations'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[500px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Conversas ({inboundConversations.length})
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {inboundConversations.map((conv, i) => (
                <div
                  key={`${conv.phone}-${i}`}
                  className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${conv.leadId ? 'cursor-pointer' : ''}`}
                  onClick={() => conv.leadId && openLead(conv.leadId)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{conv.contactName || conv.phone}</p>
                    <p className="text-xs text-muted-foreground">{conv.phone}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">📥 {conv.inboundCount}</span>
                      <span className="text-[10px] text-muted-foreground">📤 {conv.outboundCount}</span>
                      {conv.instanceName && <span className="text-[10px] text-muted-foreground">📱 {conv.instanceName}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {conv.hasOutboundReply ? (
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">Respondida</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">Pendente</Badge>
                    )}
                    {conv.leadId && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
              ))}
              {inboundConversations.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Qualified Leads Sheet */}
      <Sheet open={sheetOpen === 'qualified'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[500px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-green-500" />
              Qualificados ({conversionMetrics.qualified})
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {conversionMetrics.qualifiedLeads.map((lead) => (
                <LeadRow key={lead.id} lead={lead} extra={
                  <Badge variant="outline" className="text-[10px]">{lead.status}</Badge>
                } />
              ))}
              {conversionMetrics.qualifiedLeads.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead qualificado no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Converted Leads Sheet */}
      <Sheet open={sheetOpen === 'converted'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[500px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              Convertidos ({conversionMetrics.converted})
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {conversionMetrics.convertedLeads.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
              {conversionMetrics.convertedLeads.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead convertido no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Lead Follow-ups Detail Sheet */}
      <Sheet open={sheetOpen === 'lead_followups'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[500px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PhoneForwarded className="h-5 w-5 text-emerald-500" />
              Follow-ups por Lead ({totalFollowups} msgs)
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {leadFollowupDetails.map((detail) => (
                <div
                  key={detail.leadId}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => openLead(detail.leadId)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{detail.leadName}</p>
                      {detail.stageName && (
                        <Badge variant="outline" className="text-[10px] shrink-0" style={{ borderColor: detail.stageColor || undefined }}>
                          {detail.stageName}
                        </Badge>
                      )}
                    </div>
                    {detail.leadPhone && <p className="text-xs text-muted-foreground">{detail.leadPhone}</p>}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-emerald-600 font-medium">📤 {detail.outboundCount} enviadas</span>
                      <span className="text-[10px] text-blue-600">📥 {detail.inboundCount} recebidas</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              ))}
              {leadFollowupDetails.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum follow-up no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* New Conversations Today Sheet */}
      <Sheet open={sheetOpen === 'new_convs'} onOpenChange={(open) => { if (!open) { setSheetOpen(null); setConvResponseFilter('all'); } }}>
        <SheetContent className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Conversas Novas {periodLabel} ({todayNewConvs.length})
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {[
              { key: 'all' as const, label: 'Todas' },
              { key: 'responded' as const, label: '✓ Respondidas' },
              { key: 'waiting' as const, label: '⏳ Aguardando' },
              { key: 'fast' as const, label: '⚡ < 10min' },
              { key: 'slow' as const, label: '🐢 > 30min' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setConvResponseFilter(f.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  convResponseFilter === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-accent'
                }`}
              >
                {f.label}
                {f.key !== 'all' && (() => {
                  const count = todayNewConvs.filter(c => {
                    const mins = c.was_responded ? c.response_time_minutes : differenceInMinutes(new Date(), parseISO(c.last_inbound_at || c.first_message_at));
                    if (f.key === 'responded') return c.was_responded;
                    if (f.key === 'waiting') return !c.was_responded;
                    if (f.key === 'fast') return c.was_responded && (c.response_time_minutes ?? 999) <= 10;
                    if (f.key === 'slow') return (mins ?? 0) > 30;
                    return true;
                  }).length;
                  return ` (${count})`;
                })()}
              </button>
            ))}
          </div>
          <ScrollArea className="h-[calc(100vh-145px)] mt-3">
            <div className="space-y-2 pr-4">
              {todayNewConvs.filter(conv => {
                const mins = conv.was_responded ? conv.response_time_minutes : differenceInMinutes(new Date(), parseISO(conv.last_inbound_at || conv.first_message_at));
                if (convResponseFilter === 'responded') return conv.was_responded;
                if (convResponseFilter === 'waiting') return !conv.was_responded;
                if (convResponseFilter === 'fast') return conv.was_responded && (conv.response_time_minutes ?? 999) <= 10;
                if (convResponseFilter === 'slow') return (mins ?? 0) > 30;
                return true;
              }).map((conv, i) => {
                const waitingMinutes = conv.was_responded 
                  ? conv.response_time_minutes 
                  : differenceInMinutes(new Date(), parseISO(conv.last_inbound_at || conv.first_message_at));
                const formatWait = (mins: number | null) => {
                  if (mins === null) return '';
                  if (mins < 60) return `${mins}min`;
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  return m > 0 ? `${h}h${m}min` : `${h}h`;
                };
                return (
                <div 
                  key={`${conv.phone}-${i}`} 
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setChatPreview({
                      phone: conv.phone,
                      contactName: conv.contact_name,
                      instanceName: conv.instance_name,
                      hasLead: conv.has_lead,
                      hasContact: conv.has_contact,
                      wasResponded: conv.was_responded,
                      responseTimeMinutes: conv.response_time_minutes,
                    });
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium truncate">{conv.contact_name || conv.phone}</p>
                      {conv.has_lead && <Badge variant="default" className="text-[8px] px-1 py-0 h-3.5 shrink-0">Lead</Badge>}
                      {conv.has_contact && <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 shrink-0">Contato</Badge>}
                      {!conv.has_lead && !conv.has_contact && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 shrink-0 text-muted-foreground">Sem vínculo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{conv.phone}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {conv.instance_name && <span className="text-[10px] text-muted-foreground">{conv.instance_name}</span>}
                      {conv.was_responded ? (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 bg-emerald-50 text-emerald-700 border-emerald-200">
                          ✓ Respondido {conv.outbound_count > 1 ? `(${conv.outbound_count}x)` : ''} em {formatWait(conv.response_time_minutes)}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 bg-amber-50 text-amber-700 border-amber-200">
                          ⏳ Aguardando há {formatWait(waitingMinutes)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2 flex flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(conv.first_message_at), 'HH:mm')}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
                );
              })}
              {todayNewConvs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa nova no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Follow-ups Today Sheet (by phone) */}
      <Sheet open={sheetOpen === 'followups'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-blue-500" />
              Contatos {periodLabel} ({todayFollowups.length})
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {todayFollowups.map((fu, i) => (
                <div key={`${fu.phone}-${i}`} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{fu.contact_name || fu.phone}</p>
                    <p className="text-xs text-muted-foreground">{fu.phone}</p>
                    {fu.instance_name && <p className="text-[10px] text-muted-foreground">{fu.instance_name}</p>}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <Badge variant="outline" className="text-xs">{fu.outbound_count} msgs</Badge>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {format(parseISO(fu.last_outbound_at), 'HH:mm')}
                    </p>
                  </div>
                </div>
              ))}
              {todayFollowups.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum follow-up no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Documents Sheet */}
      <Sheet open={sheetOpen === 'documents'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-amber-500" />
              Documentos Gerados {periodLabel} ({todayDocs.length})
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {(() => {
                const grouped = new Map<string, typeof todayDocs>();
                for (const doc of todayDocs) {
                  const key = doc.template_name || 'Sem modelo';
                  if (!grouped.has(key)) grouped.set(key, []);
                  grouped.get(key)!.push(doc);
                }
                return Array.from(grouped.entries()).map(([templateName, docs]) => (
                  <div key={templateName} className="space-y-1.5">
                    <div className="flex items-center gap-2 pt-2">
                      <Badge variant="secondary" className="text-xs">{templateName}</Badge>
                      <span className="text-xs text-muted-foreground">({docs.length})</span>
                    </div>
                    {docs.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.document_name}</p>
                          {doc.signer_name && <p className="text-xs text-muted-foreground">Signatário: {doc.signer_name}</p>}
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <Badge variant={doc.status === 'signed' ? 'default' : 'outline'} className="text-xs">
                            {doc.status === 'signed' ? 'Assinado' : doc.status === 'pending' ? 'Pendente' : doc.status}
                          </Badge>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {format(parseISO(doc.created_at), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ));
              })()}
              {todayDocs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum documento gerado no período</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Funnel Stage Sheet - with lead details */}
      <Sheet open={sheetOpen === 'funnel'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[500px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              {selectedFunnelStage || 'Etapa do Funil'}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {(() => {
                const stageData = funnelStages.find(s => s.stageName === selectedFunnelStage);
                if (!stageData) return null;
                return (
                  <>
                    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 mb-3">
                      <div className="text-center">
                        <p className="text-lg font-bold">{stageData.count}</p>
                        <p className="text-[10px] text-muted-foreground">leads</p>
                      </div>
                      <Separator orientation="vertical" className="h-8" />
                      <div className="text-center">
                        <p className="text-lg font-bold">{stageData.msgCount}</p>
                        <p className="text-[10px] text-muted-foreground">msgs totais</p>
                      </div>
                      <Separator orientation="vertical" className="h-8" />
                      <div className="text-center">
                        <p className="text-lg font-bold">{stageData.followupCount}</p>
                        <p className="text-[10px] text-muted-foreground">follow-ups</p>
                      </div>
                    </div>
                    {stageData.leads.map((lead, i) => (
                      <div
                        key={`${lead.id}-${i}`}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group"
                        onClick={() => openLead(lead.id)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{lead.name}</p>
                          {lead.phone && <p className="text-xs text-muted-foreground">{lead.phone}</p>}
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] text-emerald-600">📤 {lead.outboundMsgs}</span>
                            <span className="text-[10px] text-blue-600">📥 {lead.inboundMsgs}</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                    ))}
                  </>
                );
              })()}
              {funnelStages.filter(s => s.stageName === selectedFunnelStage).flatMap(s => s.leads).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead nesta etapa</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Slow Responses Sheet */}
      <Sheet open={sheetOpen === 'slow_responses'} onOpenChange={(open) => !open && setSheetOpen(null)}>
        <SheetContent className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Respostas Lentas {selectedSlowBucket}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {slowResponseBuckets
                .find(b => b.label === selectedSlowBucket)
                ?.conversations
                .sort((a, b) => b.responseTime - a.responseTime)
                .map((conv, i) => (
                  <div
                    key={`${conv.phone}-${i}`}
                    className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${conv.leadId ? 'cursor-pointer' : ''}`}
                    onClick={() => conv.leadId && openLead(conv.leadId)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{conv.contactName || conv.leadName || conv.phone}</p>
                      <p className="text-xs text-muted-foreground">{conv.phone}</p>
                      {conv.instanceName && <p className="text-[10px] text-muted-foreground">{conv.instanceName}</p>}
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <Badge variant={conv.responseTime >= 60 ? 'destructive' : 'outline'} className="text-xs">
                        {formatResponseTime(conv.responseTime)}
                      </Badge>
                      {!conv.firstOutboundAt && (
                        <p className="text-[10px] text-destructive mt-0.5">Sem resposta</p>
                      )}
                    </div>
                  </div>
                )) || null}
              {(slowResponseBuckets.find(b => b.label === selectedSlowBucket)?.conversations.length || 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma conversa nesta faixa</p>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Chat Preview Bottom Sheet */}
      <DashboardChatPreview
        open={!!chatPreview}
        onOpenChange={(open) => !open && setChatPreview(null)}
        phone={chatPreview?.phone ?? null}
        contactName={chatPreview?.contactName ?? null}
        instanceName={chatPreview?.instanceName ?? null}
        hasLead={chatPreview?.hasLead ?? false}
        hasContact={chatPreview?.hasContact ?? false}
        wasResponded={chatPreview?.wasResponded ?? false}
        responseTimeMinutes={chatPreview?.responseTimeMinutes ?? null}
        onOpenChat={onOpenChat}
      />
    </div>
  );
}
