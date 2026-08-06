import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, authClient } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { formatHMS, brasiliaToday, BREAK_LABELS, type BreakType, type TimerCommand } from '@/contexts/ActivityTimerContext';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useTeamLeadership } from '@/hooks/useTeamLeadership';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cloudFunctions } from '@/lib/functionRouter';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { getTimeOffForDate, TIME_OFF_TYPE_LABELS, type TimeOffEntry } from '@/lib/timeOff';

/** Contexto do alerta — muda as frases prontas e o rótulo do botão. */
type AlertContext = 'idle' | 'break' | 'not_started';

const ALERT_PRESETS: Record<AlertContext, string[]> = {
  idle: [
    'Por que você está ocioso? Retome uma atividade ou avise o que está fazendo.',
    'Precisa de ajuda com alguma coisa?',
    'Podemos falar rapidinho? Me chama.',
    'Retome as atividades, por favor.',
  ],
  break: [
    'Seu intervalo passou do previsto. Está tudo bem?',
    'Quanto tempo você ainda precisa? Me avisa aqui.',
    'Pode voltar ao trabalho e registrar a volta, por favor?',
    'Se precisou de mais tempo, justifique o intervalo no cronômetro.',
  ],
  not_started: [
    'Você ainda não iniciou o expediente hoje. Está tudo bem?',
    'Bate o ponto, por favor — e avisa se tiver algum problema.',
    'Está com dificuldade para acessar o sistema?',
    'Vai atrasar hoje? Me dá um retorno, por favor.',
  ],
};
import { BellRing, ChevronDown, ChevronRight, ExternalLink, Loader2, LogOut, MoreVertical, PauseCircle, Search, X } from 'lucide-react';
import { toast } from 'sonner';

const COLLAPSED_KEY = 'team-timers-collapsed';
type StatusFilter = 'all' | 'working' | 'idle' | 'break' | 'not_started';
type PanelView = 'now' | 'rank';

const dbAny = db as unknown as SupabaseClient;

/**
 * "Não iniciou" ≠ "off": quem bateu o ponto e já encerrou também fica 'off',
 * mas apareceu no sistema hoje. Aqui o alvo é só quem não começou o expediente
 * (nenhum segundo produtivo nem ocioso registrado no dia).
 */
const notStarted = (m: MemberStatus) => m.state === 'off' && m.dayActive === 0 && m.dayIdle === 0;
const matchesFilter = (m: MemberStatus, f: StatusFilter) =>
  f === 'all' ? true : f === 'not_started' ? notStarted(m) : m.state === f;

/**
 * Teto por tipo de pausa, em minutos, para quando a pessoa não informa previsão
 * — que é o caso comum: em 31/07/2026, as 10 pausas do dia tinham
 * `estimated_minutes` nulo. `compensacao` fica de fora de propósito: banco de
 * horas é longo por definição, alertar ali seria só ruído.
 */
const BREAK_LIMIT_MIN: Record<BreakType, number | null> = {
  almoco: 90,
  intervalo: 30,
  cafe: 20,
  lanche: 20,
  descanso: 20,
  reuniao: 120,
  compensacao: null,
};

/** Pausa estourada: passou da previsão que a pessoa deu; sem previsão, do teto do tipo. */
const breakOverdue = (m: MemberStatus) => {
  if (m.state !== 'break') return false;
  const limitMin = m.breakEtaMin && m.breakEtaMin > 0
    ? m.breakEtaMin
    : BREAK_LIMIT_MIN[m.breakType || 'intervalo'];
  return limitMin !== null && m.currentSecs > limitMin * 60;
};

/** Sem batimento (flush 30s) por 2 min = cronômetro não está mais rodando. */
const HEARTBEAT_MS = 2 * 60 * 1000;

interface MemberStatus {
  extUserId: string;
  /** UUID do Cloud — é por ele que `push_subscriptions` indexa o aparelho. */
  cloudUserId: string | null;
  name: string;
  /** Cargo (só na seção Gestão): "Diretor" ou "Gestor · <times>". */
  role?: string;
  state: 'working' | 'idle' | 'break' | 'off';
  breakType?: BreakType | null;
  breakNote?: string | null;
  /** Previsão que a pessoa deu ao registrar a pausa (min), quando deu. */
  breakEtaMin?: number | null;
  /** "Férias"/"Folga"/… — só sobra quem está de folga e mesmo assim trabalhando. */
  awayLabel?: string | null;
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

  // Só gestor de time e diretoria comandam o cronômetro de terceiros.
  const { isManager, isDirector } = useTeamLeadership();
  const canManage = isManager || isDirector;

  // Identidade de quem está mandando o alerta/comando (ext uid + nome).
  const resolveSender = useCallback(async (): Promise<{ id: string | null; name: string | null }> => {
    const { data: { user } } = await authClient.auth.getUser();
    const id = await remapToExternal(user?.id || null);
    let name: string | null = null;
    try {
      const { data: p } = await authClient.from('profiles').select('full_name').eq('user_id', user?.id || '').maybeSingle();
      name = p?.full_name || null;
    } catch { /* segue sem nome */ }
    return { id, name };
  }, []);

  /**
   * Alerta da gestão pro membro (ocioso, em intervalo esticado ou que não bateu
   * o ponto) — mensagem escolhida/escrita pelo remetente.
   *
   * Dois canais, porque o alvo pode nem estar com o sistema aberto:
   * - `activity_timer_alerts` → chega na hora via Realtime SE a aba estiver
   *   aberta (toca som + prompt 🚨). Quem está fora vê ao entrar.
   * - Web Push (`send-team-push` com `user_ids`) → notificação nativa no
   *   celular/notebook mesmo com tudo fechado. Único canal que alcança quem
   *   não iniciou o expediente — daí ele ser obrigatório aqui.
   */
  const sendIdleAlert = useCallback(async (m: MemberStatus, message: string) => {
    const firstName = m.name.split(' ')[0];
    try {
      const sender = await resolveSender();
      const { error } = await dbAny.from('activity_timer_alerts').insert({
        to_user_id: m.extUserId,
        from_user_id: sender.id,
        from_name: sender.name,
        message,
      });
      if (error) throw error;

      let pushed = 0;
      if (m.cloudUserId) {
        try {
          const { data } = await cloudFunctions.invoke('send-team-push', {
            body: {
              user_ids: [m.cloudUserId],
              sender_id: null,
              title: `🚨 ${sender.name || 'Gestão'}`,
              content: message,
              tag: `timer-alert-${m.extUserId}`,
              url: '/',
            },
          });
          pushed = (data as { sent?: number } | null)?.sent || 0;
        } catch { /* push é complemento; o alerta já está gravado */ }
      }

      if (pushed > 0) toast.success(`Alerta enviado para ${firstName} (notificação no aparelho).`);
      else toast.success(`Alerta enviado para ${firstName} — aparece quando ele abrir o sistema (sem notificação ativada no aparelho).`);
    } catch (e) {
      console.warn('[team-timers] alerta falhou', e);
      toast.error('Não foi possível enviar o alerta.');
    }
  }, [resolveSender]);

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
      await ensureExternalSession().catch(() => {}); // RLS do Externo (org_user_status, member_time_off)
      const [{ data: teams }, { data: teamMembers }, { data: profiles }, { data: managers }, { data: directors }, { data: inactiveRows }, timeOff] = await Promise.all([
        authClient.from('teams').select('id, name, color').order('name'),
        authClient.from('team_members').select('team_id, user_id'),
        authClient.from('profiles').select('user_id, full_name'),
        dbAny.from('team_managers').select('manager_user_id, manager_name, team_name'),
        dbAny.from('org_directors').select('user_id, name'),
        // Desativados e ausências de hoje — ambos chaveados pelo Cloud user_id.
        ((externalSupabase as unknown as SupabaseClient).from('org_user_status') as ReturnType<SupabaseClient['from']>)
          .select('user_id').eq('active', false),
        getTimeOffForDate(brasiliaToday()),
      ]);

      // Quem não deve ser cobrado hoje: desligado do escritório, ou de
      // férias/folga/compensação cobrindo a data. Some do painel inteiro — dos
      // filtros, das contagens e do ranking do dia (ver filtro em buildMembers).
      const inactiveCloudIds = new Set<string>(
        ((inactiveRows as { user_id: string }[]) || []).map(r => r.user_id).filter(Boolean),
      );
      const awayByCloudId = new Map<string, TimeOffEntry>();
      (timeOff || []).forEach(t => { if (t.user_id) awayByCloudId.set(t.user_id, t); });

      // 2) Cloud → Externo (o cronômetro grava ext uid)
      await ensureRemapCache().catch(() => {});
      const cloudIds = (profiles || []).map(p => p.user_id);
      const extIds = await Promise.all(cloudIds.map(id => remapToExternal(id)));
      const cloudToExt = new Map<string, string>();
      cloudIds.forEach((cid, i) => { if (extIds[i]) cloudToExt.set(cid, extIds[i] as string); });

      // 3) Sessões de HOJE (Externo) — status ao vivo + totais do dia por membro.
      // Filtra por work_date (partição por dia): antes somava active_seconds
      // vitalício de qualquer linha "tocada hoje", inflando o total (ex.: 12h50).
      const { data: entries } = await dbAny.from('activity_time_entries')
        .select('user_id, activity_id, activity_title, activity_type, active_seconds, idle_seconds, status, ended_at, started_at, break_type, break_note, estimated_minutes')
        .eq('work_date', brasiliaToday());

      type Entry = {
        user_id: string; activity_id: string | null; activity_title: string | null;
        activity_type: string | null;
        active_seconds: number; idle_seconds: number; status: string;
        ended_at: string | null; started_at: string;
        break_type: BreakType | null; break_note: string | null;
        estimated_minutes: number | null;
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
      const statusOf = (extId: string, cloudId: string, name: string): MemberStatus => {
        const u = byUser.get(extId);
        const base: MemberStatus = {
          extUserId: extId, cloudUserId: cloudId, name, state: 'off', activityTitle: null, activityType: null, activityId: null,
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
            breakEtaMin: latest.estimated_minutes,
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
            if (inactiveCloudIds.has(cid)) return null; // desligado: nunca aparece
            const m = statusOf(ext, cid, nameByCloud.get(cid) || 'Membro');
            const away = awayByCloudId.get(cid);
            if (away) {
              // De férias/folga hoje: sai do painel. A exceção é quem está de
              // folga e mesmo assim tocando uma atividade — aí é informação,
              // não cobrança, e o selo diz por que ele está aí.
              if (m.state !== 'working') return null;
              m.awayLabel = TIME_OFF_TYPE_LABELS[away.type] || 'Ausente';
            }
            return m;
          })
          .filter(Boolean)
          .map(m => m as MemberStatus)
          // Dentro do "em intervalo", quem estourou a previsão vem primeiro.
          .sort((a, b) => rank[a.state] - rank[b.state]
            || (Number(breakOverdue(b)) - Number(breakOverdue(a)))
            || a.name.localeCompare(b.name));

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

  /**
   * Comando remoto da gestão sobre o cronômetro do membro (gravado em
   * activity_timer_alerts — serve também de log de quem mandou o quê):
   * - 'pause'     → o cliente dele salva a sessão atual e cai no ocioso;
   * - 'end_shift' → o cliente encerra o expediente. Aqui o banco também é
   *   fechado, rede de segurança para quem largou a aba e foi embora.
   * Quem executa é sempre o cliente do membro (é ele que "possui" o cronômetro,
   * ver assertOwnership) — daí o comando em vez de escrever a sessão por fora.
   */
  const sendCommand = useCallback(async (m: MemberStatus, command: TimerCommand) => {
    const firstName = m.name.split(' ')[0];
    try {
      const sender = await resolveSender();
      const who = sender.name || 'A gestão';
      const message = command === 'pause'
        ? `${who} pausou seu cronômetro — você está ocioso. Retome uma atividade ou registre uma pausa.`
        : `${who} encerrou seu expediente. O cronômetro parou de contar.`;
      const { error } = await dbAny.from('activity_timer_alerts').insert({
        to_user_id: m.extUserId, from_user_id: sender.id, from_name: sender.name, message, command,
      });
      if (error) throw error;
      if (command === 'end_shift') {
        // Depois do comando: se a aba dele responder, o flush dela grava os
        // segundos exatos antes destes updates encontrarem algo 'running'.
        const now = new Date().toISOString();
        await dbAny.from('activity_time_entries')
          .update({ status: 'paused', ended_at: now })
          .eq('user_id', m.extUserId).eq('status', 'running');
        await dbAny.from('work_shifts')
          .update({ ended_at: now })
          .eq('user_id', m.extUserId).is('ended_at', null);
      }
      toast.success(command === 'pause'
        ? `Cronômetro de ${firstName} pausado — ele fica ocioso.`
        : `Expediente de ${firstName} encerrado.`);
      setTimeout(load, 2000); // dá tempo do cliente dele aplicar antes do refresh
    } catch (e) {
      console.warn('[team-timers] comando falhou', e);
      toast.error('Não foi possível comandar o cronômetro.');
    }
  }, [resolveSender, load]);

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
  // Contagens de membro único: quem está em dois times contaria duas vezes.
  const breakCount = useMemo(() => {
    const seen = new Set<string>();
    groups.forEach(g => g.members.forEach(m => { if (m.state === 'break') seen.add(m.extUserId); }));
    return seen.size;
  }, [groups]);
  const breakOverdueCount = useMemo(() => {
    const seen = new Set<string>();
    groups.forEach(g => g.members.forEach(m => { if (breakOverdue(m)) seen.add(m.extUserId); }));
    return seen.size;
  }, [groups]);
  const notStartedCount = useMemo(() => {
    const seen = new Set<string>();
    groups.forEach(g => g.members.forEach(m => { if (notStarted(m)) seen.add(m.extUserId); }));
    return seen.size;
  }, [groups]);

  // Filtros do "Time agora": status (chips) + busca por texto (nome do membro
  // ou nome do time). Se a busca casar o nome do time, mostra o time inteiro;
  // senão, filtra pelos membros que casam. Times vazios somem.
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let gs = groups;
    if (statusFilter !== 'all') {
      gs = gs
        .map(g => ({ ...g, members: g.members.filter(m => matchesFilter(m, statusFilter)) }))
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
        <div className="flex flex-wrap items-center gap-1">
          {([
            { key: 'all' as const, label: 'Todos', title: 'Todo mundo', alert: 0 },
            { key: 'working' as const, label: `Fazendo${workingCount ? ` ${workingCount}` : ''}`, title: 'Com atividade em andamento', alert: 0 },
            { key: 'idle' as const, label: `Ocioso${idleCount ? ` ${idleCount}` : ''}`, title: 'Sem atividade, cronômetro rodando', alert: 0 },
            { key: 'break' as const, label: `Intervalo${breakCount ? ` ${breakCount}` : ''}`, title: breakOverdueCount ? `${breakOverdueCount} passou do tempo previsto` : 'Em pausa justificada (reunião, almoço, café, banheiro…)', alert: breakOverdueCount },
            { key: 'not_started' as const, label: `Não iniciou${notStartedCount ? ` ${notStartedCount}` : ''}`, title: 'Não entrou no sistema / não bateu o ponto hoje', alert: 0 },
          ]).map(f => (
            <button
              key={f.key}
              type="button"
              title={f.title}
              onClick={() => setStatusFilter(f.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                statusFilter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {f.label}
              {f.alert > 0 && (
                <span className={`ml-1 ${statusFilter === f.key ? 'text-red-200' : 'text-red-500'}`}>⚠{f.alert}</span>
              )}
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
                : statusFilter === 'working' ? 'Ninguém em atividade agora.'
                : statusFilter === 'idle' ? 'Ninguém ocioso agora.'
                : statusFilter === 'break' ? 'Ninguém em intervalo agora.'
                : 'Todo mundo já iniciou o expediente.'}
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
                      <span className={`h-2 w-2 rounded-full shrink-0 ${
                        m.state === 'idle' ? 'bg-amber-400'
                        : m.state === 'break' ? (breakOverdue(m) ? 'bg-red-500' : 'bg-sky-400')
                        : 'bg-muted-foreground/30'}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">
                        {m.name}
                        {m.role && <span className="ml-1 text-[10px] font-normal text-indigo-600 dark:text-indigo-400">{m.role}</span>}
                        {m.awayLabel && (
                          <span
                            className="ml-1 text-[10px] font-normal rounded px-1 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            title={`Está de ${m.awayLabel.toLowerCase()} hoje, mas com atividade em andamento`}
                          >
                            {m.awayLabel}
                          </span>
                        )}
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
                          <span className={breakOverdue(m) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-sky-700 dark:text-sky-300'}>
                            {BREAK_LABELS[m.breakType || 'intervalo']}{m.breakNote ? ` · ${m.breakNote}` : ''}
                            {breakOverdue(m) && ` · passou dos ${
                              m.breakEtaMin && m.breakEtaMin > 0 ? m.breakEtaMin : BREAK_LIMIT_MIN[m.breakType || 'intervalo']
                            } min`}
                          </span>
                        )}
                        {m.state === 'off' && (notStarted(m)
                          ? 'Não iniciou o expediente hoje'
                          : `Hoje: ${formatHMS(m.dayActive)} produtivo · fora do ar`)}
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
                      <MemberAlertButton member={m} context="idle" onSend={sendIdleAlert} />
                    )}
                    {m.state === 'break' && (
                      <MemberAlertButton member={m} context="break" onSend={sendIdleAlert} />
                    )}
                    {notStarted(m) && (
                      <MemberAlertButton member={m} context="not_started" onSend={sendIdleAlert} />
                    )}
                    {canManage && m.state !== 'off' && (
                      <MemberActionsButton member={m} onCommand={sendCommand} />
                    )}
                    {m.state !== 'off' && (
                      <span className={`text-[11px] font-mono tabular-nums shrink-0 ${
                        m.state === 'working' ? 'text-emerald-600 dark:text-emerald-400'
                        : m.state === 'break' ? (breakOverdue(m) ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-sky-600 dark:text-sky-400')
                        : 'text-amber-600 dark:text-amber-400'}`}>
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

/**
 * Ações da gestão (gestor de time / diretoria) sobre o cronômetro do membro:
 * pausar (deixa ocioso) e encerrar o expediente. Encerrar pede confirmação —
 * mexe no ponto do outro e não dá pra desfazer com um clique.
 */
function MemberActionsButton({
  member, onCommand,
}: {
  member: MemberStatus;
  onCommand: (m: MemberStatus, command: TimerCommand) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const firstName = member.name.split(' ')[0];
  const canPause = member.state === 'working' || member.state === 'break';
  const close = () => { setOpen(false); setConfirmEnd(false); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmEnd(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
          title={`Pausar ou encerrar o cronômetro de ${firstName}`}
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-64 p-2">
        <div className="text-xs font-medium mb-1.5">Cronômetro de {firstName}</div>
        <div className="space-y-1">
          <button
            type="button"
            disabled={!canPause}
            onClick={() => { onCommand(member, 'pause'); close(); }}
            className="w-full text-left px-2 py-1.5 rounded border hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <PauseCircle className="h-3.5 w-3.5 text-amber-500" /> Pausar — deixar ocioso
            </span>
            <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
              {canPause
                ? 'Salva o tempo da sessão atual; daí em diante conta como ocioso.'
                : 'Já está ocioso — nada em andamento para pausar.'}
            </span>
          </button>
          {!confirmEnd ? (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="w-full text-left px-2 py-1.5 rounded border hover:bg-accent"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <LogOut className="h-3.5 w-3.5 text-red-500" /> Encerrar expediente
              </span>
              <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                Bate o ponto de saída e para o cronômetro do dia.
              </span>
            </button>
          ) : (
            <div className="px-2 py-1.5 rounded border border-red-300 dark:border-red-800">
              <div className="text-[11px] leading-snug mb-1.5">
                Encerrar o expediente de <b>{firstName}</b> agora? Ele precisa bater o ponto de novo para voltar a contar.
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { onCommand(member, 'end_shift'); close(); }}>
                  Encerrar
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmEnd(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ALERT_STYLE: Record<AlertContext, { button: string; hint: string }> = {
  idle: {
    button: 'bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 text-amber-600 dark:text-amber-400',
    hint: 'está ocioso',
  },
  break: {
    button: 'bg-sky-100 dark:bg-sky-900/40 hover:bg-sky-200 dark:hover:bg-sky-800/60 text-sky-600 dark:text-sky-400',
    hint: 'está em intervalo',
  },
  not_started: {
    button: 'bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/60 text-red-600 dark:text-red-400',
    hint: 'não iniciou o expediente hoje',
  },
};

/**
 * Sino de alerta: mensagens prontas (por contexto) ou texto livre.
 * Usado no ocioso, no intervalo esticado e em quem não bateu o ponto.
 */
function MemberAlertButton({
  member, context, onSend,
}: {
  member: MemberStatus;
  context: AlertContext;
  onSend: (m: MemberStatus, message: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const firstName = member.name.split(' ')[0];
  const style = ALERT_STYLE[context];
  const send = (msg: string) => { onSend(member, msg); setOpen(false); setCustom(''); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setCustom(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`rounded p-1 shrink-0 ${style.button}`}
          title={`${firstName} ${style.hint} — enviar alerta (som no sistema + notificação no aparelho)`}
        >
          <BellRing className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-72 p-2">
        <div className="text-xs font-medium mb-0.5">Alertar {firstName}</div>
        <div className="text-[10px] text-muted-foreground mb-1.5 leading-snug">
          {context === 'not_started'
            ? 'Ele está fora do sistema — o alerta vai como notificação no aparelho e reaparece quando ele entrar.'
            : 'Toca um alerta na tela dele e manda notificação no aparelho.'}
        </div>
        <div className="space-y-1 mb-2">
          {ALERT_PRESETS[context].map((p) => (
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
