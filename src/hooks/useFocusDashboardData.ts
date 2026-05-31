import { useState, useEffect, useCallback, useMemo } from 'react';
import { db, authClient } from '@/integrations/supabase';
import { useAuthContext } from '@/contexts/AuthContext';
import { usePageState } from '@/hooks/usePageState';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, format } from 'date-fns';

// Formata Date como YYYY-MM-DD no fuso local (evita o bug do toISOString
// que converte pra UTC e "vaza" o dia pro próximo quando o usuário está em -03).
const localDate = (d: Date) => format(d, 'yyyy-MM-dd');

export type FocusPeriod = 'yesterday' | 'today' | 'week' | 'month' | 'year' | 'custom';
export type FocusScope = 'personal' | 'team';

export interface FocusKpis {
  leadsReceived: number;
  leadsReceivedDelta: string; // ex: "+3 em 2h" or "—"
  closed: number;
  goal: number;
  goalProgress: number; // 0..1
  conversion: number; // 0..100
  conversionDelta: string;
  unviable: number;
  unviablePercentage: number; // 0..100
  unviableTopReason: string | null;
}

export interface FocusActions {
  missingDocs: number; // leads "prontos pra fechar" sem doc
  missingDocsHint: string; // ex: "Próx: Bianca · aguarda RG há 1d"
  zapsignPending: number;
  zapsignPendingHint: string; // ex: "2 enviados há +48h sem clique"
  unanswered: number;
  unansweredOwedByMe: number; // "Eu devo"
  unansweredClientGhosted: number; // "Cliente sumiu"
  unansweredBuckets: { plus30: number; plus4h: number; plus24h: number };
  avgResponseMinutes: number; // tempo médio (min) entre inbound do cliente e resposta nossa
}

export interface ClosedLeadActivity {
  id: string;
  title: string | null;
  status: string | null;
  deadline: string | null;
}

export interface ClosedLeadItem {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
  became_client_date: string | null;
  closed_at: string | null;
  acolhedor: string | null;
  has_overdue_activity?: boolean;
  whatsapp_group_jid?: string | null;
  activities?: ClosedLeadActivity[];
}


export interface OverdueActivityItem {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  title: string | null;
  deadline: string | null;
  acolhedor: string | null;
  whatsapp_group_jid?: string | null;
}

type ClosedLeadRow = Omit<ClosedLeadItem, 'has_overdue_activity' | 'whatsapp_group_jid' | 'activities'>;
type ActivityRow = { id: string; lead_id: string | null; title: string | null; status: string | null; deadline: string | null };
type GroupRow = { lead_id: string | null; group_jid: string | null };

export interface FocusData {
  kpis: FocusKpis;
  actions: FocusActions;
  closedLeads: ClosedLeadItem[];
  overdueActivities: OverdueActivityItem[];
  loading: boolean;
  refetch: () => void;
  scope: FocusScope;
  setScope: (s: FocusScope) => void;
  period: FocusPeriod;
  setPeriod: (p: FocusPeriod) => void;
  range: { from: Date; to: Date };
  setRange: (r: { from: Date; to: Date }) => void;
  scopeUserIds: string[];
}

function rangeFromPeriod(p: FocusPeriod, custom?: { from: Date; to: Date }): { from: Date; to: Date } {
  const now = new Date();
  switch (p) {
    case 'yesterday': {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'year': return { from: startOfYear(now), to: endOfYear(now) };
    case 'custom': return custom || { from: startOfDay(now), to: endOfDay(now) };
  }
}

const EMPTY_KPIS: FocusKpis = {
  leadsReceived: 0, leadsReceivedDelta: '—',
  closed: 0, goal: 5, goalProgress: 0,
  conversion: 0, conversionDelta: '—',
  unviable: 0, unviablePercentage: 0, unviableTopReason: null,
};

const EMPTY_ACTIONS: FocusActions = {
  missingDocs: 0, missingDocsHint: '',
  zapsignPending: 0, zapsignPendingHint: '',
  unanswered: 0, unansweredOwedByMe: 0, unansweredClientGhosted: 0,
  unansweredBuckets: { plus30: 0, plus4h: 0, plus24h: 0 },
  avgResponseMinutes: 0,
};

export function useFocusDashboardData(instanceName?: string | null): FocusData {
  const { user } = useAuthContext();
  const [period, setPeriod] = usePageState<FocusPeriod>('focus_dashboard_period', 'today');
  const [scope, setScope] = usePageState<FocusScope>('focus_dashboard_scope', 'personal');
  const [customRangeRaw, setCustomRangeRaw] = usePageState<{ from: string; to: string } | null>('focus_dashboard_custom_range', null);
  const customRange = useMemo(() => {
    if (!customRangeRaw) return undefined;
    return { from: new Date(customRangeRaw.from), to: new Date(customRangeRaw.to) };
  }, [customRangeRaw]);
  const [kpis, setKpis] = useState<FocusKpis>(EMPTY_KPIS);
  const [actions, setActions] = useState<FocusActions>(EMPTY_ACTIONS);
  const [closedLeads, setClosedLeads] = useState<ClosedLeadItem[]>([]);
  const [overdueActivities, setOverdueActivities] = useState<OverdueActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scopeUserIds, setScopeUserIds] = useState<string[]>([]);

  const range = useMemo(() => rangeFromPeriod(period, customRange), [period, customRange]);
  const setRange = useCallback((r: { from: Date; to: Date }) => {
    setCustomRangeRaw({ from: r.from.toISOString(), to: r.to.toISOString() });
    setPeriod('custom');
  }, [setCustomRangeRaw, setPeriod]);

  // Resolve scope user IDs (Cloud)
  useEffect(() => {
    if (!user) { setScopeUserIds([]); return; }
    if (scope === 'personal') { setScopeUserIds([user.id]); return; }
    (async () => {
      const { data: myTeams } = await authClient.from('team_members').select('team_id').eq('user_id', user.id);
      const teamIds = (myTeams || []).map((t: any) => t.team_id);
      if (!teamIds.length) { setScopeUserIds([user.id]); return; }
      const { data: members } = await authClient.from('team_members').select('user_id').in('team_id', teamIds);
      const ids = Array.from(new Set([(user.id), ...(members || []).map((m: any) => m.user_id)]));
      setScopeUserIds(ids);
    })();
  }, [user, scope]);

  const fetchAll = useCallback(async () => {
    if (!user || scopeUserIds.length === 0) return;
    setLoading(true);
    try {
      const fromISO = range.from.toISOString();
      const toISO = range.to.toISOString();

      // Quando uma instância específica está selecionada, descobrimos a lista de
      // telefones daquela instância via whatsapp_conversation_agents e filtramos
      // leads por lead_phone — desacopla o filtro do created_by do lead.
      const useInstanceFilter = !!instanceName && instanceName !== 'all';
      let phonesForInstance: string[] | null = null;
      if (useInstanceFilter) {
        const { data: convs } = await db.from('whatsapp_conversation_agents')
          .select('phone')
          .ilike('instance_name', instanceName as string)
          .limit(5000);
        const set = new Set<string>();
        (convs || []).forEach((c: any) => {
          if (c.phone) set.add(String(c.phone));
          if (c.phone) set.add(String(c.phone).replace(/\D/g, ''));
        });
        phonesForInstance = Array.from(set);
        if (phonesForInstance.length === 0) phonesForInstance = ['__none__'];
      }

      // === KPIs ===
      let leadsQuery: any = db.from('leads')
        .select('id, lead_status, lead_status_reason, created_at, lead_name, created_by, details, lead_phone', { count: 'exact' })
        .gte('created_at', fromISO).lte('created_at', toISO);
      leadsQuery = useInstanceFilter
        ? leadsQuery.in('lead_phone', phonesForInstance!)
        : leadsQuery.in('created_by', scopeUserIds);

      // Fechados: não depende de created_at do lead. Quando uma instância é
      // selecionada, restringe a leads cujo telefone pertence àquela instância.
      let closedQuery: any = db.from('leads')
        .select('id, lead_phone, lead_name, became_client_date, acolhedor', { count: 'exact', head: false })
        .eq('lead_status', 'closed')
        .gte('became_client_date', localDate(range.from))
        .lte('became_client_date', localDate(range.to))
        .is('deleted_at', null);
      if (useInstanceFilter) closedQuery = closedQuery.in('lead_phone', phonesForInstance!);

      const yest = { from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) };
      let yestLeadsQ: any = db.from('leads')
        .select('id, lead_status', { count: 'exact', head: false })
        .gte('created_at', yest.from.toISOString()).lte('created_at', yest.to.toISOString());
      yestLeadsQ = useInstanceFilter
        ? yestLeadsQ.in('lead_phone', phonesForInstance!)
        : yestLeadsQ.in('created_by', scopeUserIds);

      let yestClosedQ: any = db.from('leads')
        .select('id', { count: 'exact', head: false })
        .eq('lead_status', 'closed')
        .eq('became_client_date', localDate(yest.from))
        .is('deleted_at', null);
      if (useInstanceFilter) yestClosedQ = yestClosedQ.in('lead_phone', phonesForInstance!);

      // ZapSign pendentes (estado atual)
      const zapsignQ = db.from('zapsign_documents')
        .select('id, signer_name, status, signer_status, lead_id, created_at')
        .in('status', ['sent', 'pending'])
        .lt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .limit(500);

      // Leads ativos (heurística faltam docs)
      let activeLeadsQ: any = db.from('leads')
        .select('id, lead_name, lead_phone, updated_at, lead_status')
        .not('lead_status', 'in', '("closed","unviable","refused")')
        .order('updated_at', { ascending: false })
        .limit(200);
      activeLeadsQ = useInstanceFilter
        ? activeLeadsQ.in('lead_phone', phonesForInstance!)
        : activeLeadsQ.in('created_by', scopeUserIds);

      const [leadsRes, closedRes, yestRes, yestClosedRes, zapRes, activeRes] = await Promise.all([leadsQuery, closedQuery, yestLeadsQ, yestClosedQ, zapsignQ, activeLeadsQ]);

      const leads = (leadsRes.data || []) as any[];
      const yestLeads = (yestRes.data || []) as any[];

      const received = leads.length;
      const closedCount = closedRes.count ?? (closedRes.data || []).length;
      const closedRows = (closedRes.data || []) as ClosedLeadRow[];
      const closedIds = closedRows.map((l) => l.id).filter(Boolean);
      let overdueLeadIds = new Set<string>();
      const activitiesByLead = new Map<string, ClosedLeadActivity[]>();
      const groupByLead = new Map<string, string>();
      if (closedIds.length > 0) {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const [actsRes, groupsRes] = await Promise.all([
          db.from('lead_activities')
            .select('id, lead_id, title, status, deadline')
            .in('lead_id', closedIds)
            .order('deadline', { ascending: true })
            .limit(10000),
          db.from('lead_whatsapp_groups')
            .select('lead_id, group_jid')
            .in('lead_id', closedIds)
            .limit(5000),
        ]);
        const allActs = (actsRes.data || []) as ActivityRow[];
        allActs.forEach((a) => {
          if (!a.lead_id) return;
          const arr = activitiesByLead.get(a.lead_id) || [];
          arr.push({ id: a.id, title: a.title, status: a.status, deadline: a.deadline });
          activitiesByLead.set(a.lead_id, arr);
          if (a.status === 'pendente' && a.deadline && a.deadline < todayStr) {
            overdueLeadIds.add(a.lead_id);
          }
        });
        ((groupsRes.data || []) as GroupRow[]).forEach((g) => {
          if (g.lead_id && g.group_jid && !groupByLead.has(g.lead_id)) {
            groupByLead.set(g.lead_id, g.group_jid);
          }
        });
      }
      setClosedLeads(closedRows.map((l) => ({
        id: l.id,
        lead_name: l.lead_name ?? null,
        lead_phone: l.lead_phone ?? null,
        became_client_date: l.became_client_date ?? null,
        acolhedor: l.acolhedor ?? null,
        has_overdue_activity: overdueLeadIds.has(l.id),
        whatsapp_group_jid: groupByLead.get(l.id) ?? null,
        activities: activitiesByLead.get(l.id) ?? [],
      })));

      // === Atividades atrasadas (todas, do escopo) ===
      try {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        let overdueQ: any = db.from('lead_activities')
          .select('id, lead_id, title, deadline, assigned_to')
          .eq('status', 'pendente')
          .lt('deadline', todayStr)
          .not('deadline', 'is', null)
          .order('deadline', { ascending: true })
          .limit(2000);
        overdueQ = overdueQ.in('assigned_to', scopeUserIds);
        const { data: overdueRows } = await overdueQ;
        const overdue = (overdueRows || []) as Array<{ id: string; lead_id: string; title: string | null; deadline: string | null; assigned_to: string | null }>;
        const leadIds = Array.from(new Set(overdue.map(o => o.lead_id).filter(Boolean)));
        let leadMap = new Map<string, { name: string | null; phone: string | null; acolhedor: string | null }>();
        let groupMap = new Map<string, string>();
        if (leadIds.length > 0) {
          const [leadsRes2, groupsRes2] = await Promise.all([
            db.from('leads').select('id, lead_name, lead_phone, acolhedor').in('id', leadIds).limit(2000),
            db.from('lead_whatsapp_groups').select('lead_id, group_jid').in('lead_id', leadIds).limit(5000),
          ]);
          ((leadsRes2.data || []) as any[]).forEach((l) => leadMap.set(l.id, { name: l.lead_name ?? null, phone: l.lead_phone ?? null, acolhedor: l.acolhedor ?? null }));
          ((groupsRes2.data || []) as GroupRow[]).forEach((g) => { if (g.lead_id && g.group_jid && !groupMap.has(g.lead_id)) groupMap.set(g.lead_id, g.group_jid); });
        }
        setOverdueActivities(overdue.map(o => ({
          id: o.id,
          lead_id: o.lead_id,
          title: o.title,
          deadline: o.deadline,
          lead_name: leadMap.get(o.lead_id)?.name ?? null,
          lead_phone: leadMap.get(o.lead_id)?.phone ?? null,
          acolhedor: leadMap.get(o.lead_id)?.acolhedor ?? null,
          whatsapp_group_jid: groupMap.get(o.lead_id) ?? null,
        })));
      } catch (e) {
        console.warn('[useFocusDashboardData] overdue activities query failed:', e);
        setOverdueActivities([]);
      }

      const unviableLeads = leads.filter(l => l.lead_status === 'unviable' || l.lead_status === 'refused');
      // Viáveis = total recebido no período - inviáveis (esse é o denominador da conversão)
      const viableCount = Math.max(0, received - unviableLeads.length);
      const conversion = viableCount > 0 ? Math.round((closedCount / viableCount) * 100) : 0;

      // Yesterday conv for delta (usando viáveis)
      const yReceived = yestLeads.length;
      const yUnviable = yestLeads.filter((l: any) => l.lead_status === 'unviable' || l.lead_status === 'refused').length;
      const yViable = Math.max(0, yReceived - yUnviable);
      const yClosed = yestClosedRes.count ?? (yestClosedRes.data || []).length;
      const yConv = yViable > 0 ? (yClosed / yViable) * 100 : 0;
      const convDelta = viableCount > 0 ? Math.round(conversion - yConv) : 0;

      // Top reason for unviable
      const reasonCount = new Map<string, number>();
      unviableLeads.forEach(l => {
        const r = l.lead_status_reason || (l.details?.discard_reason) || 'sem motivo';
        reasonCount.set(r, (reasonCount.get(r) || 0) + 1);
      });
      const topReason = Array.from(reasonCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // "goal" aqui passa a representar VIÁVEIS (denominador real da conversão).
      // O card mostra fechados/viáveis = ex: 56/120 (47%)
      const goal = viableCount;
      const goalProgress = goal > 0 ? Math.min(1, closedCount / goal) : 0;

      // Leads created in last 2h (delta hint)
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const last2h = leads.filter(l => new Date(l.created_at).getTime() >= twoHoursAgo).length;

      setKpis({
        leadsReceived: received,
        leadsReceivedDelta: last2h > 0 ? `+${last2h} em 2h` : '—',
        closed: closedCount,
        goal,
        goalProgress,
        conversion,
        conversionDelta: convDelta !== 0 ? (convDelta > 0 ? `+${convDelta}pp vs ontem` : `${convDelta}pp vs ontem`) : '—',
        unviable: unviableLeads.length,
        unviablePercentage: received > 0 ? Math.round((unviableLeads.length / received) * 100) : 0,
        unviableTopReason: topReason,
      });

      // === ACTIONS ===
      // Conjunto de lead_ids no escopo (período + ativos) — usado pra restringir ZapSign quando filtrando por instância
      const scopedLeadIds = new Set<string>([
        ...leads.map(l => l.id),
        ...((activeRes.data || []) as any[]).map((l: any) => l.id),
      ]);
      let zapDocs = (zapRes.data || []) as any[];
      if (useInstanceFilter) {
        zapDocs = zapDocs.filter(z => z.lead_id && scopedLeadIds.has(z.lead_id));
      }
      const zapsignPending = zapDocs.length;
      const zapHint = zapsignPending > 0
        ? `${zapsignPending} enviados há +48h sem assinar`
        : '';

      const activeLeads = (activeRes.data || []) as any[];
      // "Faltam docs" heurística simples: leads ativos cujo último update foi >24h
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const stale = activeLeads.filter(l => new Date(l.updated_at).getTime() < oneDayAgo);
      const missingDocsHint = stale[0]
        ? `Próx: ${stale[0].lead_name || 'Lead'} · aguarda doc`
        : '';

      // === Sem resposta — usa whatsapp_messages last inbound vs last outbound ===
      // Busca apenas mensagens das últimas 48h pra calcular janelas.
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      let msgsQ: any = db.from('whatsapp_messages')
        .select('phone, instance_name, direction, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (useInstanceFilter) msgsQ = msgsQ.ilike('instance_name', instanceName as string);
      const { data: msgs } = await msgsQ;

      // Group by phone+instance, find last inbound/outbound + collect pairs for avg response
      const last = new Map<string, { inbound?: string; outbound?: string }>();
      // Para tempo médio: agrupa todas as msgs por conversa em ordem cronológica
      const byConv = new Map<string, { dir: string; t: number }[]>();
      (msgs || []).forEach((m: any) => {
        const key = `${m.phone}__${(m.instance_name || '').toLowerCase()}`;
        const cur = last.get(key) || {};
        if (m.direction === 'inbound' && !cur.inbound) cur.inbound = m.created_at;
        if (m.direction === 'outbound' && !cur.outbound) cur.outbound = m.created_at;
        last.set(key, cur);
        const arr = byConv.get(key) || [];
        arr.push({ dir: m.direction, t: new Date(m.created_at).getTime() });
        byConv.set(key, arr);
      });

      // Calcula tempo médio de resposta: para cada inbound seguida por outbound, mede o gap
      let totalGapMs = 0; let gapCount = 0;
      byConv.forEach((arr) => {
        // msgs vieram em ordem desc; reordena asc
        const asc = arr.slice().sort((a, b) => a.t - b.t);
        for (let i = 0; i < asc.length - 1; i++) {
          if (asc[i].dir === 'inbound') {
            // procura próximo outbound
            for (let j = i + 1; j < asc.length; j++) {
              if (asc[j].dir === 'outbound') {
                const gap = asc[j].t - asc[i].t;
                if (gap > 0 && gap < 24 * 60 * 60 * 1000) { // ignora >24h (provavelmente abandono)
                  totalGapMs += gap;
                  gapCount++;
                }
                break;
              }
              if (asc[j].dir === 'inbound') break; // outra inbound antes da resposta
            }
          }
        }
      });
      const avgResponseMinutes = gapCount > 0 ? Math.round(totalGapMs / gapCount / 60000) : 0;

      let owedByMe = 0; let ghosted = 0;
      const buckets = { plus30: 0, plus4h: 0, plus24h: 0 };
      const now = Date.now();
      last.forEach((v) => {
        const inMs = v.inbound ? new Date(v.inbound).getTime() : 0;
        const outMs = v.outbound ? new Date(v.outbound).getTime() : 0;
        if (inMs > outMs && inMs > 0) {
          const ageMin = (now - inMs) / 60000;
          if (ageMin >= 30) {
            owedByMe++;
            if (ageMin >= 24 * 60) buckets.plus24h++;
            else if (ageMin >= 4 * 60) buckets.plus4h++;
            else buckets.plus30++;
          }
        } else if (outMs > inMs && outMs > 0) {
          const ageMin = (now - outMs) / 60000;
          if (ageMin >= 30) ghosted++;
        }
      });

      setActions({
        missingDocs: stale.length,
        missingDocsHint,
        zapsignPending,
        zapsignPendingHint: zapHint,
        unanswered: owedByMe + ghosted,
        unansweredOwedByMe: owedByMe,
        unansweredClientGhosted: ghosted,
        unansweredBuckets: buckets,
        avgResponseMinutes,
      });
    } catch (err) {
      console.error('[useFocusDashboardData] error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, scopeUserIds, range, instanceName]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh a cada 2 minutos
  useEffect(() => {
    const t = setInterval(fetchAll, 120_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  return {
    kpis, actions, closedLeads, overdueActivities, loading, refetch: fetchAll,
    scope, setScope, period, setPeriod,
    range, setRange, scopeUserIds,
  };
}
