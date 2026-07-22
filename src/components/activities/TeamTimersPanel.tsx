import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, authClient } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { formatHMS, BREAK_LABELS, type BreakType } from '@/contexts/ActivityTimerContext';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const ALERT_PRESETS = [
  'Por que você está ocioso? Retome uma atividade ou avise o que está fazendo.',
  'Precisa de ajuda com alguma coisa?',
  'Podemos falar rapidinho? Me chama.',
  'Retome as atividades, por favor.',
];
import { BellRing, ChevronDown, ChevronRight, ExternalLink, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';

const COLLAPSED_KEY = 'team-timers-collapsed';
type StatusFilter = 'all' | 'working' | 'idle';
type PanelView = 'now' | 'rank';

const dbAny = db as unknown as SupabaseClient;

/** Sem batimento (flush 30s) por 2 min = cronômetro não está mais rodando. */
const HEARTBEAT_MS = 2 * 60 * 1000;

interface MemberStatus {
  extUserId: string;
  name: string;
  /** Cargo (só na seção Gestão): "Diretor" ou "Gestor · <times>". */
  role?: string;
  state: 'working' | 'idle' | 'break' | 'off';
  breakType?: BreakType | null;
  breakNote?: string | null;
  activityTitle: string | null;
  activityType: string | null; // key do tipo (rotina) — rótulo resolvido na renderização
  activityId: string | null;   // permite o atalho "abrir a atividade"
  currentSecs: number;   // segundos da sessão atual (ativo se working, ocioso se idle)
  dayActive: number;     // total produtivo hoje
  dayIdle: number;       // total ocioso hoje
}

interface TeamGroup {
  id: string;
  name: string;
  color: string | null;
  members: MemberStatus[];
}

/**
 * Painel "quem está fazendo o quê agora" — expande do badge do cronômetro.
 * Agrupado por time (Cloud), status ao vivo vindo do activity_time_entries
 * (Externo). Design propositalmente sóbrio: uma bolinha de status, nome,
 * atividade e tempo — sem competir por atenção com o resto da tela.
 */
export function TeamTimersPanel({ onOpenActivity }: { onOpenActivity?: (activityId: string) => void }) {
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<PanelView>('now');
  const { types: activityTypes } = useActivityTypes();
  const typeLabel = useCallback((key: string | null) => {
    if (!key) return null;
    return activityTypes.find(t => t.key === key)?.label || key;
  }, [activityTypes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignora */ }
    return new Set();
  });

  // Alerta da gestão pro membro ocioso — mensagem escolhida/escrita pelo remetente
  const sendIdleAlert = useCallback(async (m: MemberStatus, message: string) => {
    try {
      const { data: { user } } = await authClient.auth.getUser();
      const fromExt = await remapToExternal(user?.id || null);
      let fromName: string | null = null;
      try {
        const { data: p } = await authClient.from('profiles').select('full_name').eq('user_id', user?.id || '').maybeSingle();
        fromName = p?.full_name || null;
      } catch { /* segue sem nome */ }
      const { error } = await dbAny.from('activity_timer_alerts').insert({
        to_user_id: m.extUserId,
        from_user_id: fromExt,
        from_name: fromName,
        message,
      });
      if (error) throw error;
      toast.success(`Alerta enviado para ${m.name.split(' ')[0]}`);
    } catch (e) {
      console.warn('[team-timers] alerta falhou', e);
      toast.error('Não foi possível enviar o alerta.');
    }
  }, []);

  const toggleCollapsed = useCallback((teamId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next))); } catch { /* quota */ }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      // 1) Estrutura: times/membros/nomes (Cloud) + gestão (Externo)
      const [{ data: teams }, { data: teamMembers }, { data: profiles }, { data: managers }, { data: directors }] = await Promise.all([
        authClient.from('teams').select('id, name, color').order('name'),
        authClient.from('team_members').select('team_id, user_id'),
        authClient.from('profiles').select('user_id, full_name'),
        dbAny.from('team_managers').select('manager_user_id, manager_name, team_name'),
        dbAny.from('org_directors').select('user_id, name'),
      ]);

      // 2) Cloud → Externo (o cronômetro grava ext uid)
      await ensureRemapCache().catch(() => {});
      const cloudIds = (profiles || []).map(p => p.user_id);
      const extIds = await Promise.all(cloudIds.map(id => remapToExternal(id)));
      const cloudToExt = new Map<string, string>();
      cloudIds.forEach((cid, i) => { if (extIds[i]) cloudToExt.set(cid, extIds[i] as string); });

      // 3) Sessões de hoje (Externo) — status ao vivo + totais do dia por membro
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const iso = startOfDay.toISOString();
      const { data: entries } = await dbAny.from('activity_time_entries')
        .select('user_id, activity_id, activity_title, activity_type, active_seconds, idle_seconds, status, ended_at, started_at, break_type, break_note')
        .or(`ended_at.gte.${iso},started_at.gte.${iso}`);

      type Entry = {
        user_id: string; activity_id: string | null; activity_title: string | null;
        activity_type: string | null;
        active_seconds: number; idle_seconds: number; status: string;
        ended_at: string | null; started_at: string;
        break_type: BreakType | null; break_note: string | null;
      };
      const byUser = new Map<string, { latest: Entry | null; dayActive: number; dayIdle: number }>();
      for (const r of ((entries as Entry[]) || [])) {
        let u = byUser.get(r.user_id);
        if (!u) { u = { latest: null, dayActive: 0, dayIdle: 0 }; byUser.set(r.user_id, u); }
        u.dayActive += r.active_seconds || 0;
        if (!r.break_type) u.dayIdle += r.idle_seconds || 0; // pausa justificada não é ocioso
        const ts = r.ended_at || r.started_at;
        const prevTs = u.latest ? (u.latest.ended_at || u.latest.started_at) : '';
        if (!u.latest || ts > prevTs) u.latest = r;
      }

      const now = Date.now();
      const statusOf = (extId: string, name: string): MemberStatus => {
        const u = byUser.get(extId);
        const base: MemberStatus = {
          extUserId: extId, name, state: 'off', activityTitle: null, activityType: null, activityId: null,
          currentSecs: 0, dayActive: u?.dayActive || 0, dayIdle: u?.dayIdle || 0,
        };
        const latest = u?.latest;
        if (!latest || latest.status !== 'running') return base;
        const beat = latest.ended_at ? new Date(latest.ended_at).getTime() : 0;
        if (now - beat > HEARTBEAT_MS) return base;
        if (latest.activity_id) {
          return {
            ...base, state: 'working',
            activityTitle: latest.activity_title || 'Atividade',
            activityType: latest.activity_type,
            activityId: latest.activity_id,
            currentSecs: latest.active_seconds || 0,
          };
        }
        if (latest.break_type) {
          return {
            ...base, state: 'break',
            breakType: latest.break_type, breakNote: latest.break_note,
            currentSecs: latest.idle_seconds || 0,
          };
        }
        return { ...base, state: 'idle', currentSecs: latest.idle_seconds || 0 };
      };

      // 4) Monta os grupos por time; quem não está em nenhum vai pra "Sem time"
      const nameByCloud = new Map<string, string>();
      (profiles || []).forEach(p => nameByCloud.set(p.user_id, p.full_name || 'Membro'));
      const memberCloudIdsByTeam = new Map<string, string[]>();
      (teamMembers || []).forEach(tm => {
        const arr = memberCloudIdsByTeam.get(tm.team_id) || [];
        arr.push(tm.user_id);
        memberCloudIdsByTeam.set(tm.team_id, arr);
      });

      // Gestão: diretores + gestores de time (cloud ids) — seção própria no topo
      type Mgr = { manager_user_id: string | null; manager_name: string | null; team_name: string | null };
      type Dir = { user_id: string; name: string | null };
      const directorIds = new Set(((directors as Dir[]) || []).map(d => d.user_id));
      const managerTeams = new Map<string, string[]>();
      for (const m of ((managers as Mgr[]) || [])) {
        if (!m.manager_user_id) continue;
        const arr = managerTeams.get(m.manager_user_id) || [];
        if (m.team_name) arr.push(m.team_name);
        managerTeams.set(m.manager_user_id, arr);
      }
      const leadershipCloudIds = new Set<string>([...directorIds, ...managerTeams.keys()]);

      const inSomeTeam = new Set<string>((teamMembers || []).map(tm => tm.user_id));
      const rank = { working: 0, idle: 1, break: 2, off: 3 } as const;
      const buildMembers = (cloudIds2: string[]): MemberStatus[] =>
        cloudIds2
          .map(cid => {
            const ext = cloudToExt.get(cid);
            if (!ext) return null;
            return statusOf(ext, nameByCloud.get(cid) || 'Membro');
          })
          .filter(Boolean)
          .map(m => m as MemberStatus)
          .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));

      // Gestão em seção própria no topo — diretor/gestor não aparecem nos times
      const leadership = buildMembers(Array.from(leadershipCloudIds)).map(m => m);
      const roleByExt = new Map<string, string>();
      for (const cid of leadershipCloudIds) {
        const ext = cloudToExt.get(cid);
        if (!ext) continue;
        const isDir = directorIds.has(cid);
        const teamsOf = managerTeams.get(cid) || [];
        roleByExt.set(ext, isDir ? 'Diretor' : `Gestor · ${teamsOf.join(', ') || 'time'}`);
      }
      leadership.forEach(m => { m.role = roleByExt.get(m.extUserId); });

      const result: TeamGroup[] = [];
      if (leadership.length > 0) {
        result.push({ id: '__leadership__', name: 'Gestão', color: '#6366f1', members: leadership });
      }

      result.push(...(teams || []).map(t => ({
        id: t.id, name: t.name, color: t.color || null,
        members: buildMembers((memberCloudIdsByTeam.get(t.id) || []).filter(cid => !leadershipCloudIds.has(cid))),
      })).filter(g => g.members.length > 0));

      // "Sem time": só quem tem cronômetro hoje (esconde inativos — contas avulsas poluem)
      const noTeam = buildMembers(cloudIds.filter(cid => !inSomeTeam.has(cid) && !leadershipCloudIds.has(cid)))
        .filter(m => m.state !== 'off' || m.dayActive > 0 || m.dayIdle > 0);
      if (noTeam.length > 0) result.push({ id: '__none__', name: 'Sem time', color: null, members: noTeam });

      setGroups(result);
    } catch (e) {
      console.warn('[team-timers] load falhou', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  const workingCount = useMemo(
    () => groups.reduce((s, g) => s + g.members.filter(m => m.state === 'working').length, 0),
    [groups],
  );
  const idleCount = useMemo(
    () => groups.reduce((s, g) => s + g.members.filter(m => m.state === 'idle').length, 0),
    [groups],
  );

  // Filtros do "Time agora": status (chips) + busca por texto (nome do membro
  // ou nome do time). Se a busca casar o nome do time, mostra o time inteiro;
  // senão, filtra pelos membros que casam. Times vazios somem.
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let gs = groups;
    if (statusFilter !== 'all') {
      gs = gs
        .map(g => ({ ...g, members: g.members.filter(m => m.state === statusFilter) }))
        .filter(g => g.members.length > 0);
    }
    if (q) {
      gs = gs
        .map(g => (
          g.name.toLowerCase().includes(q)
            ? g
            : { ...g, members: g.members.filter(m => m.name.toLowerCase().includes(q)) }
        ))
        .filter(g => g.members.length > 0);
    }
    return gs;
  }, [groups, statusFilter, query]);

  // Ranking do dia: membros únicos (podem estar em mais de um time)
  const allMembers = useMemo(() => {
    const seen = new Map<string, MemberStatus>();
    groups.forEach(g => g.members.forEach(m => { if (!seen.has(m.extUserId)) seen.set(m.extUserId, m); }));
    return Array.from(seen.values());
  }, [groups]);
  const topActive = useMemo(
    () => allMembers.filter(m => m.dayActive > 0).sort((a, b) => b.dayActive - a.dayActive).slice(0, 3),
    [allMembers],
  );
  const topIdle = useMemo(
    () => allMembers.filter(m => m.dayIdle > 0).sort((a, b) => b.dayIdle - a.dayIdle).slice(0, 3),
    [allMembers],
  );
  const rankedAll = useMemo(
    () => [...allMembers].sort((a, b) => b.dayActive - a.dayActive || a.dayIdle - b.dayIdle || a.name.localeCompare(b.name)),
    [allMembers],
  );

  return (
    // Altura limitada ao espaço que o Popover tem na tela (var do Radix);
    // fallback 60vh. O miolo é flex + min-h-0 pra rolagem funcionar sempre.
    <div
      className="w-80 flex flex-col"
      style={{ maxHeight: 'min(60vh, var(--radix-popover-content-available-height, 60vh))' }}
    >
      <div className="px-3 pt-3 pb-2 border-b shrink-0 space-y-1.5">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setView('now')}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${view === 'now' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Time agora
            </button>
            <button
              type="button"
              onClick={() => setView('rank')}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${view === 'rank' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Ranking do dia
            </button>
          </div>
          {view === 'now' && <span className="text-[11px] text-muted-foreground">{workingCount} em atividade</span>}
        </div>
        {view === 'now' && (
        <div className="flex items-center gap-1">
          {([
            { key: 'all' as const, label: 'Todos' },
            { key: 'working' as const, label: `Fazendo${workingCount ? ` ${workingCount}` : ''}` },
            { key: 'idle' as const, label: `Ocioso${idleCount ? ` ${idleCount}` : ''}` },
          ]).map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                statusFilter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        )}
        {view === 'now' && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar membro ou time…"
              className="h-7 pl-7 pr-7 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="px-3 py-2 space-y-3">
          {loading && groups.length === 0 && (
            <div className="py-6 text-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…
            </div>
          )}
          {view === 'rank' && !loading && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">Top 3 · mais tempo em atividade</div>
                {topActive.length === 0 && <div className="text-[11px] text-muted-foreground py-1">Sem tempo produtivo hoje.</div>}
                {topActive.map((m, i) => (
                  <div key={m.extUserId} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/50">
                    <span className="text-[11px] font-bold w-5 text-muted-foreground shrink-0">{i + 1}º</span>
                    <span className="text-xs font-medium truncate flex-1">{m.name}</span>
                    <span className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">{formatHMS(m.dayActive)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">Top 3 · mais tempo ocioso</div>
                {topIdle.length === 0 && <div className="text-[11px] text-muted-foreground py-1">Sem ociosidade registrada hoje.</div>}
                {topIdle.map((m, i) => (
                  <div key={m.extUserId} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/50">
                    <span className="text-[11px] font-bold w-5 text-muted-foreground shrink-0">{i + 1}º</span>
                    <span className="text-xs font-medium truncate flex-1">{m.name}</span>
                    <span className="text-[11px] font-mono tabular-nums text-amber-600 dark:text-amber-400 shrink-0">{formatHMS(m.dayIdle)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Todos (hoje)</span>
                  <span className="text-[10px] text-muted-foreground">ativo · ocioso</span>
                </div>
                {rankedAll.map(m => (
                  <div key={m.extUserId} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/50">
                    <span className="text-xs truncate flex-1">{m.name}</span>
                    <span className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">{formatHMS(m.dayActive)}</span>
                    <span className="text-[11px] font-mono tabular-nums text-amber-600 dark:text-amber-400 shrink-0">{formatHMS(m.dayIdle)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {view === 'now' && !loading && visibleGroups.length === 0 && (
            <div className="py-6 text-center text-muted-foreground text-sm">
              {query.trim() ? `Nada encontrado para "${query.trim()}".`
                : statusFilter === 'all' ? 'Nenhum membro encontrado.'
                : statusFilter === 'working' ? 'Ninguém em atividade agora.' : 'Ninguém ocioso agora.'}
            </div>
          )}
          {view === 'now' && visibleGroups.map(g => {
            const isCollapsed = collapsed.has(g.id);
            const gWorking = g.members.filter(m => m.state === 'working').length;
            const gIdle = g.members.filter(m => m.state === 'idle').length;
            return (
            <div key={g.id}>
              <button
                type="button"
                onClick={() => toggleCollapsed(g.id)}
                className="w-full flex items-center gap-1.5 mb-1 rounded px-0.5 py-0.5 hover:bg-accent/50 text-left"
                title={isCollapsed ? 'Expandir time' : 'Recolher time'}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
                {g.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 truncate">{g.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {gWorking > 0 && <span className="text-emerald-600 dark:text-emerald-400">{gWorking} fazendo</span>}
                  {gWorking > 0 && gIdle > 0 && ' · '}
                  {gIdle > 0 && <span className="text-amber-600 dark:text-amber-400">{gIdle} ocioso</span>}
                  {gWorking === 0 && gIdle === 0 && `${g.members.length}`}
                </span>
              </button>
              {!isCollapsed && (
              <div className="space-y-0.5">
                {g.members.map(m => (
                  <div
                    key={m.extUserId}
                    className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/50"
                    title={m.state === 'working' && m.activityTitle
                      ? `${m.name}\n${typeLabel(m.activityType) ? `[${typeLabel(m.activityType)}] ` : ''}${m.activityTitle}`
                      : undefined}
                  >
                    {m.state === 'working' ? (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                    ) : (
                      <span className={`h-2 w-2 rounded-full shrink-0 ${m.state === 'idle' ? 'bg-amber-400' : m.state === 'break' ? 'bg-sky-400' : 'bg-muted-foreground/30'}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">
                        {m.name}
                        {m.role && <span className="ml-1 text-[10px] font-normal text-indigo-600 dark:text-indigo-400">{m.role}</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {m.state === 'working' && (
                          <>
                            {typeLabel(m.activityType) && (
                              <span className="text-emerald-700 dark:text-emerald-300 font-medium">{typeLabel(m.activityType)} · </span>
                            )}
                            {m.activityTitle || 'Atividade'}
                          </>
                        )}
                        {m.state === 'idle' && 'Ocioso (entre atividades)'}
                        {m.state === 'break' && (
                          <span className="text-sky-700 dark:text-sky-300">
                            {BREAK_LABELS[m.breakType || 'intervalo']}{m.breakNote ? ` · ${m.breakNote}` : ''}
                          </span>
                        )}
                        {m.state === 'off' && (m.dayActive > 0 ? `Hoje: ${formatHMS(m.dayActive)} produtivo` : 'Sem cronômetro hoje')}
                      </div>
                    </div>
                    {m.activityId && (
                      <button
                        type="button"
                        onClick={() => {
                          if (onOpenActivity) onOpenActivity(m.activityId!);
                          else window.open(`${window.location.origin}/?openActivity=${m.activityId}`, '_blank');
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
                        title="Abrir esta atividade (aba lateral)"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    {m.state === 'idle' && (
                      <IdleAlertButton member={m} onSend={sendIdleAlert} />
                    )}
                    {m.state !== 'off' && (
                      <span className={`text-[11px] font-mono tabular-nums shrink-0 ${m.state === 'working' ? 'text-emerald-600 dark:text-emerald-400' : m.state === 'break' ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {formatHMS(m.currentSecs)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Sino de alerta pro ocioso: mensagens prontas ou texto livre. */
function IdleAlertButton({
  member, onSend,
}: {
  member: MemberStatus;
  onSend: (m: MemberStatus, message: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const firstName = member.name.split(' ')[0];
  const send = (msg: string) => { onSend(member, msg); setOpen(false); setCustom(''); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setCustom(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded p-1 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 text-amber-600 dark:text-amber-400 shrink-0"
          title={`Enviar alerta para ${firstName} (com som)`}
        >
          <BellRing className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-72 p-2">
        <div className="text-xs font-medium mb-1.5">Alertar {firstName}</div>
        <div className="space-y-1 mb-2">
          {ALERT_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => send(p)}
              className="w-full text-left text-xs px-2 py-1.5 rounded border hover:bg-accent leading-snug"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) send(custom.trim()); }}
            placeholder="Ou escreva sua mensagem…"
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8 shrink-0" disabled={!custom.trim()} onClick={() => send(custom.trim())}>
            Enviar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
