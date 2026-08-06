import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Star, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// Painel "Top de Avaliação" do telão — mesma leitura do mural /destaques (média
// das estrelas dos feedbacks já avaliados), só que filtrada pelo time que o
// telão está mostrando, pra ficar lado a lado com o ranking de atividades.
//
// Janela FIXA de 30 dias, e não o período do telão (hoje/semana/mês): avaliação
// é evento raro — no dia 06/08/2026 havia 1 nota no dia contra 10 em 30 dias —,
// então seguir o seletor deixaria o painel vazio quase o tempo todo.
//
// Fonte: lead_activities no Externo, filtrada por feedback_outcome not null
// (bate no índice idx_lead_activities_feedback_outcome). Membros do time saem de
// team_members (espelho do Cloud, já gravado com o UUID do Externo pelo
// sync_teams_snapshot); a vista Gerencial sai de team_managers + org_directors,
// mapeados por auth_uuid_mapping como a RPC do ranking faz.

const JANELA_DIAS = 30;
const REFRESH_MS = 5 * 60_000;
const TOP_N = 5;
const MEDALS = ['🥇', '🥈', '🥉', '🏅', '🏅'];

const AVATAR_COLORS = [
  'bg-sky-500', 'bg-emerald-500', 'bg-fuchsia-500', 'bg-cyan-500', 'bg-rose-500',
  'bg-amber-500', 'bg-violet-500', 'bg-teal-500', 'bg-indigo-500', 'bg-pink-500',
  'bg-lime-500', 'bg-orange-500',
];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '—';
}

interface EvalRow {
  assigned_to: string | null;
  assigned_to_name: string | null;
  feedback_rating: number | null;
  feedback_outcome: string | null;
  feedback_rated_at: string | null;
}
interface Ranked {
  key: string;
  nome: string;
  media: number;
  notas: number;
  /** Nota 5 — o "elogio" do mural. */
  elogios: number;
  satisfeitos: number;
  incompletos: number;
  insatisfeitos: number;
}

/** Membros do time (ou do grupo gerencial) em UUID do Externo. null = sem filtro. */
async function carregarEscopo(teamId: string | null, grupo: string | null): Promise<Set<string> | null> {
  if (grupo === 'gerencial') {
    const [{ data: mgr }, { data: dir }, { data: map }] = await Promise.all([
      (externalSupabase as any).from('team_managers').select('manager_user_id'),
      (externalSupabase as any).from('org_directors').select('user_id'),
      (externalSupabase as any).from('auth_uuid_mapping').select('cloud_uuid, ext_uuid'),
    ]);
    const byCloud = new Map<string, string>();
    for (const m of map || []) if (m.cloud_uuid && m.ext_uuid) byCloud.set(m.cloud_uuid, m.ext_uuid);
    const set = new Set<string>();
    const add = (id: string | null) => {
      if (!id) return;
      set.add(id); // pode já ser o UUID do Externo
      const ext = byCloud.get(id);
      if (ext) set.add(ext);
    };
    for (const m of mgr || []) add(m.manager_user_id);
    for (const d of dir || []) add(d.user_id);
    return set;
  }
  if (!teamId) return null; // Ranking Geral: todo mundo
  const { data } = await (externalSupabase as any)
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId);
  return new Set<string>((data || []).map((r: { user_id: string }) => r.user_id).filter(Boolean));
}

/** Contador de um desfecho: número grande + rótulo curto, legível de longe. */
function OutcomeStat({
  n, label, icon, color, on,
}: {
  n: number;
  label: string;
  icon: ReactNode;
  color: string;
  on: boolean;
}) {
  return (
    <div className={cn(
      'rounded-lg border px-1 py-1 text-center',
      on ? 'border-white/15 bg-white/[0.06]' : 'border-white/5 bg-transparent',
    )}>
      <div className={cn('text-2xl font-black leading-none tabular-nums', on ? color : 'text-white/20')}>
        {n}
      </div>
      <div className={cn(
        'mt-0.5 flex items-center justify-center gap-0.5 whitespace-nowrap text-[9px] font-black uppercase',
        on ? 'text-white/60' : 'text-white/25',
      )}>
        <span className="flex items-center leading-none">{icon}</span>
        {label}
      </div>
    </div>
  );
}

export default function TvAvaliacaoPanel({
  teamId,
  grupo,
  teamName,
}: {
  teamId: string | null;
  grupo: string | null;
  teamName: string;
}) {
  const [rows, setRows] = useState<EvalRow[]>([]);
  const [escopo, setEscopo] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const desde = new Date(Date.now() - JANELA_DIAS * 24 * 3600 * 1000).toISOString();
      const [{ data, error }, membros] = await Promise.all([
        (externalSupabase as any)
          .from('lead_activities')
          .select('assigned_to, assigned_to_name, feedback_rating, feedback_outcome, feedback_rated_at')
          .not('feedback_outcome', 'is', null)
          .is('deleted_at', null)
          .gte('feedback_rated_at', desde)
          .limit(2000),
        carregarEscopo(teamId, grupo),
      ]);
      if (error) throw error;
      setRows((data || []) as EvalRow[]);
      setEscopo(membros);
    } catch (e) {
      console.warn('[TvAvaliacao] load:', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, grupo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const ranked = useMemo<Ranked[]>(() => {
    const map = new Map<string, Ranked & { soma: number }>();
    for (const r of rows) {
      if (!r.assigned_to || !r.feedback_rating) continue;
      if (escopo && !escopo.has(r.assigned_to)) continue;
      const cur = map.get(r.assigned_to) || {
        key: r.assigned_to, nome: r.assigned_to_name || 'Sem nome',
        media: 0, soma: 0, notas: 0, elogios: 0, satisfeitos: 0, incompletos: 0, insatisfeitos: 0,
      };
      cur.notas += 1;
      cur.soma += r.feedback_rating;
      if (r.feedback_rating >= 5) cur.elogios += 1;
      if (r.feedback_outcome === 'satisfeito') cur.satisfeitos += 1;
      else if (r.feedback_outcome === 'incompleto') cur.incompletos += 1;
      else if (r.feedback_outcome === 'insatisfeito') cur.insatisfeitos += 1;
      if (r.assigned_to_name) cur.nome = r.assigned_to_name;
      map.set(r.assigned_to, cur);
    }
    return [...map.values()]
      .map(m => ({ ...m, media: m.soma / m.notas }))
      // Mesma regra do mural: média → mais avaliações → mais elogios.
      .sort((a, b) => b.media - a.media || b.notas - a.notas || b.elogios - a.elogios)
      .slice(0, TOP_N);
  }, [rows, escopo]);

  return (
    <aside className="h-fit rounded-2xl border border-amber-400/25 bg-white/[0.04] p-4 xl:sticky xl:top-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-black uppercase tracking-wide text-amber-300">
          <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
          Top de Avaliação
        </h2>
        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300/90">
          30 dias
        </span>
      </div>
      <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {teamName}
      </p>

      {ranked.length === 0 ? (
        <p className="py-8 text-center text-xs leading-relaxed text-white/40">
          {loading
            ? 'Carregando…'
            : 'Ninguém avaliado por aqui nos últimos 30 dias. Assim que os feedbacks forem avaliados, os destaques aparecem.'}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {ranked.map((r, i) => (
            <div
              key={r.key}
              className={cn(
                'rounded-xl border p-2.5',
                i === 0 ? 'border-amber-400/50 bg-amber-400/10' : 'border-white/10 bg-white/[0.03]',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-6 shrink-0 text-center text-xl leading-none">{MEDALS[i]}</span>
                <span className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black',
                  colorFor(r.nome),
                )}>
                  {initials(r.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-bold leading-tight">{r.nome}</p>
                  <div className="mt-0.5 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(n => (
                      <Star
                        key={n}
                        className={cn(
                          'h-3 w-3 shrink-0',
                          r.media >= n - 0.25 ? 'fill-amber-400 text-amber-400' : 'text-white/20',
                        )}
                      />
                    ))}
                    <span className="ml-0.5 text-sm font-black tabular-nums text-amber-300">{r.media.toFixed(1)}</span>
                    <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/40">
                      {r.notas} avaliaç{r.notas === 1 ? 'ão' : 'ões'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Todos os desfechos recebidos, no mesmo tamanho de número da
                  corrida: dá pra ler de longe quem levou elogio e quem levou ❌. */}
              <div className="mt-2 grid grid-cols-4 gap-1">
                <OutcomeStat n={r.elogios} label="Elogio" icon={<Sparkles className="h-3 w-3" />} color="text-yellow-300" on={r.elogios > 0} />
                <OutcomeStat n={r.satisfeitos} label="Satisf" icon="✅" color="text-emerald-400" on={r.satisfeitos > 0} />
                <OutcomeStat n={r.incompletos} label="Incompl" icon="⚠️" color="text-amber-400" on={r.incompletos > 0} />
                <OutcomeStat n={r.insatisfeitos} label="Insat" icon="❌" color="text-rose-400" on={r.insatisfeitos > 0} />
              </div>
            </div>
          ))}
          <p className="pt-1 text-center text-[10px] text-white/30">Gente boa chama gente boa. 💚</p>
        </div>
      )}
    </aside>
  );
}
