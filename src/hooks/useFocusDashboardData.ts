import { useState, useEffect, useCallback, useMemo } from 'react';
import { db, authClient } from '@/integrations/supabase';
import { useAuthContext } from '@/contexts/AuthContext';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays } from 'date-fns';

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
}

export interface FocusData {
  kpis: FocusKpis;
  actions: FocusActions;
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
  unviable: 0, unviableTopReason: null,
};

const EMPTY_ACTIONS: FocusActions = {
  missingDocs: 0, missingDocsHint: '',
  zapsignPending: 0, zapsignPendingHint: '',
  unanswered: 0, unansweredOwedByMe: 0, unansweredClientGhosted: 0,
  unansweredBuckets: { plus30: 0, plus4h: 0, plus24h: 0 },
};

export function useFocusDashboardData(): FocusData {
  const { user } = useAuthContext();
  const [period, setPeriod] = useState<FocusPeriod>('today');
  const [scope, setScope] = useState<FocusScope>('personal');
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | undefined>();
  const [kpis, setKpis] = useState<FocusKpis>(EMPTY_KPIS);
  const [actions, setActions] = useState<FocusActions>(EMPTY_ACTIONS);
  const [loading, setLoading] = useState(false);
  const [scopeUserIds, setScopeUserIds] = useState<string[]>([]);

  const range = useMemo(() => rangeFromPeriod(period, customRange), [period, customRange]);
  const setRange = useCallback((r: { from: Date; to: Date }) => {
    setCustomRange(r);
    setPeriod('custom');
  }, []);

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

      // === KPIs ===
      const leadsQuery = db.from('leads')
        .select('id, lead_status, lead_status_reason, created_at, lead_name, created_by, details', { count: 'exact' })
        .gte('created_at', fromISO).lte('created_at', toISO)
        .in('created_by', scopeUserIds);

      const yest = { from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) };
      const yestLeadsQ = db.from('leads')
        .select('id, lead_status', { count: 'exact', head: false })
        .gte('created_at', yest.from.toISOString()).lte('created_at', yest.to.toISOString())
        .in('created_by', scopeUserIds);

      // ZapSign pendentes (não no período - é estado atual)
      const zapsignQ = db.from('zapsign_documents')
        .select('id, signer_name, status, signer_status, lead_id, created_at')
        .in('status', ['sent', 'pending'])
        .lt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .limit(500);

      // Leads "faltam docs" — heurística: leads no scope, status ativo, sem zapsign assinado
      const activeLeadsQ = db.from('leads')
        .select('id, lead_name, lead_phone, updated_at, lead_status')
        .in('created_by', scopeUserIds)
        .not('lead_status', 'in', '("closed","unviable","refused")')
        .order('updated_at', { ascending: false })
        .limit(200);

      const [leadsRes, yestRes, zapRes, activeRes] = await Promise.all([leadsQuery, yestLeadsQ, zapsignQ, activeLeadsQ]);

      const leads = (leadsRes.data || []) as any[];
      const yestLeads = (yestRes.data || []) as any[];

      const received = leads.length;
      const closedCount = leads.filter(l => l.lead_status === 'closed').length;
      const unviableLeads = leads.filter(l => l.lead_status === 'unviable' || l.lead_status === 'refused');
      const conversion = received > 0 ? Math.round((closedCount / received) * 100) : 0;

      // Yesterday conv for delta
      const yReceived = yestLeads.length;
      const yClosed = yestLeads.filter(l => l.lead_status === 'closed').length;
      const yConv = yReceived > 0 ? (yClosed / yReceived) * 100 : 0;
      const convDelta = received > 0 ? Math.round(conversion - yConv) : 0;

      // Top reason for unviable
      const reasonCount = new Map<string, number>();
      unviableLeads.forEach(l => {
        const r = l.lead_status_reason || (l.details?.discard_reason) || 'sem motivo';
        reasonCount.set(r, (reasonCount.get(r) || 0) + 1);
      });
      const topReason = Array.from(reasonCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // Goal: heurística simples por enquanto — meta padrão 5/dia por pessoa no scope.
      // Quando period != today, escala pelo nº de dias.
      const dayCount = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)));
      const goal = 5 * scopeUserIds.length * dayCount;
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
        unviableTopReason: topReason,
      });

      // === ACTIONS ===
      const zapDocs = (zapRes.data || []) as any[];
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
      const { data: msgs } = await db.from('whatsapp_messages')
        .select('phone, instance_name, direction, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);

      // Group by phone+instance, find last inbound/outbound
      const last = new Map<string, { inbound?: string; outbound?: string }>();
      (msgs || []).forEach((m: any) => {
        const key = `${m.phone}__${(m.instance_name || '').toLowerCase()}`;
        const cur = last.get(key) || {};
        if (m.direction === 'inbound' && !cur.inbound) cur.inbound = m.created_at;
        if (m.direction === 'outbound' && !cur.outbound) cur.outbound = m.created_at;
        last.set(key, cur);
      });

      let owedByMe = 0; let ghosted = 0;
      const buckets = { plus30: 0, plus4h: 0, plus24h: 0 };
      const now = Date.now();
      last.forEach((v) => {
        const inMs = v.inbound ? new Date(v.inbound).getTime() : 0;
        const outMs = v.outbound ? new Date(v.outbound).getTime() : 0;
        if (inMs > outMs && inMs > 0) {
          // inbound is the latest → eu devo responder
          const ageMin = (now - inMs) / 60000;
          if (ageMin >= 30) {
            owedByMe++;
            if (ageMin >= 24 * 60) buckets.plus24h++;
            else if (ageMin >= 4 * 60) buckets.plus4h++;
            else buckets.plus30++;
          }
        } else if (outMs > inMs && outMs > 0) {
          // last was outbound, no reply → cliente sumiu
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
      });
    } catch (err) {
      console.error('[useFocusDashboardData] error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, scopeUserIds, range]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh a cada 2 minutos
  useEffect(() => {
    const t = setInterval(fetchAll, 120_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  return {
    kpis, actions, loading, refetch: fetchAll,
    scope, setScope, period, setPeriod,
    range, setRange, scopeUserIds,
  };
}
