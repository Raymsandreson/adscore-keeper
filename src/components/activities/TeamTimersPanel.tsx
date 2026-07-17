import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, authClient } from '@/integrations/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { formatHMS } from '@/contexts/ActivityTimerContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';

const dbAny = db as unknown as SupabaseClient;

/** Sem batimento (flush 30s) por 2 min = cronômetro não está mais rodando. */
const HEARTBEAT_MS = 2 * 60 * 1000;

interface MemberStatus {
  extUserId: string;
  name: string;
  state: 'working' | 'idle' | 'off';
  activityTitle: string | null;
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
export function TeamTimersPanel() {
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // 1) Estrutura (Cloud): times, membros e nomes
      const [{ data: teams }, { data: teamMembers }, { data: profiles }] = await Promise.all([
        authClient.from('teams').select('id, name, color').order('name'),
        authClient.from('team_members').select('team_id, user_id'),
        authClient.from('profiles').select('user_id, full_name'),
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
        .select('user_id, activity_id, activity_title, active_seconds, idle_seconds, status, ended_at, started_at')
        .or(`ended_at.gte.${iso},started_at.gte.${iso}`);

      type Entry = {
        user_id: string; activity_id: string | null; activity_title: string | null;
        active_seconds: number; idle_seconds: number; status: string;
        ended_at: string | null; started_at: string;
      };
      const byUser = new Map<string, { latest: Entry | null; dayActive: number; dayIdle: number }>();
      for (const r of ((entries as Entry[]) || [])) {
        let u = byUser.get(r.user_id);
        if (!u) { u = { latest: null, dayActive: 0, dayIdle: 0 }; byUser.set(r.user_id, u); }
        u.dayActive += r.active_seconds || 0;
        u.dayIdle += r.idle_seconds || 0;
        const ts = r.ended_at || r.started_at;
        const prevTs = u.latest ? (u.latest.ended_at || u.latest.started_at) : '';
        if (!u.latest || ts > prevTs) u.latest = r;
      }

      const now = Date.now();
      const statusOf = (extId: string, name: string): MemberStatus => {
        const u = byUser.get(extId);
        const base: MemberStatus = {
          extUserId: extId, name, state: 'off', activityTitle: null,
          currentSecs: 0, dayActive: u?.dayActive || 0, dayIdle: u?.dayIdle || 0,
        };
        const latest = u?.latest;
        if (!latest || latest.status !== 'running') return base;
        const beat = latest.ended_at ? new Date(latest.ended_at).getTime() : 0;
        if (now - beat > HEARTBEAT_MS) return base;
        if (latest.activity_id) {
          return { ...base, state: 'working', activityTitle: latest.activity_title || 'Atividade', currentSecs: latest.active_seconds || 0 };
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

      const inSomeTeam = new Set<string>((teamMembers || []).map(tm => tm.user_id));
      const rank = { working: 0, idle: 1, off: 2 } as const;
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

      const result: TeamGroup[] = (teams || []).map(t => ({
        id: t.id, name: t.name, color: t.color || null,
        members: buildMembers(memberCloudIdsByTeam.get(t.id) || []),
      })).filter(g => g.members.length > 0);

      const noTeam = buildMembers(cloudIds.filter(cid => !inSomeTeam.has(cid)));
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

  return (
    <div className="w-80">
      <div className="flex items-baseline justify-between px-3 pt-3 pb-2 border-b">
        <span className="text-sm font-semibold">Time agora</span>
        <span className="text-[11px] text-muted-foreground">{workingCount} em atividade</span>
      </div>
      <ScrollArea className="max-h-96">
        <div className="px-3 py-2 space-y-3">
          {loading && groups.length === 0 && (
            <div className="py-6 text-center text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…
            </div>
          )}
          {!loading && groups.length === 0 && (
            <div className="py-6 text-center text-muted-foreground text-sm">Nenhum membro encontrado.</div>
          )}
          {groups.map(g => (
            <div key={g.id}>
              <div className="flex items-center gap-1.5 mb-1">
                {g.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.name}</span>
              </div>
              <div className="space-y-0.5">
                {g.members.map(m => (
                  <div key={m.extUserId} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/50">
                    {m.state === 'working' ? (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                    ) : (
                      <span className={`h-2 w-2 rounded-full shrink-0 ${m.state === 'idle' ? 'bg-amber-400' : 'bg-muted-foreground/30'}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{m.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {m.state === 'working' && (m.activityTitle || 'Atividade')}
                        {m.state === 'idle' && 'Ocioso (entre atividades)'}
                        {m.state === 'off' && (m.dayActive > 0 ? `Hoje: ${formatHMS(m.dayActive)} produtivo` : 'Sem cronômetro hoje')}
                      </div>
                    </div>
                    {m.state !== 'off' && (
                      <span className={`text-[11px] font-mono tabular-nums shrink-0 ${m.state === 'working' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {formatHMS(m.currentSecs)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
