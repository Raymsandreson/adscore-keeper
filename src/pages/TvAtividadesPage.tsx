import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useSearchParams } from 'react-router-dom';
import { Crown, RefreshCw, Maximize2, Minimize2, Trophy } from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// /tv/atividades — Telão do "Ranking de Atividades" do time.
// Dados AO VIVO do Supabase Externo via RPC `tv_atividades_ranking`, que já
// aplica a regra de ordenação: 1º PASSOS → 2º CONCLUÍDAS → 3º menos ATRASADAS.
// Feito para rodar num telão em fullscreen; auto-atualiza sozinho.

type Period = 'hoje' | 'semana' | 'mes';

interface RankRow {
  nome: string;
  passos: number;
  concluidas: number;
  atrasadas: number;
  aprov_pct: number | null;
}
interface Resumo {
  trabalhando_h: number;
  ocioso_h: number;
  aproveitamento_pct: number | null;
}
interface Payload {
  ranking: RankRow[];
  resumo: Resumo | null;
  gerado_em: string;
}

const REFRESH_MS = 45_000;
const LIST_MAX = 7; // linhas abaixo do pódio (posições 4..10)

// Paleta estável por nome (cada assessor sempre com a mesma cor de avatar).
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
function periodSince(p: Period): Date {
  const now = new Date();
  if (p === 'hoje') return startOfDay(now);
  if (p === 'mes') return startOfMonth(now);
  return startOfWeek(now, { weekStartsOn: 1 }); // segunda-feira
}
function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function aprovLabel(v: number | null) {
  return v == null ? '—' : `${v}%`;
}

export default function TvAtividadesPage() {
  const [params] = useSearchParams();
  const titulo = params.get('titulo') || 'Time Processual';
  const teamId = params.get('team'); // opcional: filtra por um time específico

  const [period, setPeriod] = useState<Period>('semana');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [tv, setTv] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Relógio do cabeçalho.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data: res, error } = await (externalSupabase as any).rpc('tv_atividades_ranking', {
        p_since: periodSince(period).toISOString(),
        p_team_id: teamId || null,
      });
      if (error) throw error;
      setData((res || { ranking: [], resumo: null, gerado_em: '' }) as Payload);
    } catch (e) {
      console.error('[TvAtividades] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [period, teamId]);

  useEffect(() => { load(); }, [load]);

  // Auto-atualiza (telão sempre fresco).
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const ranking = data?.ranking ?? [];
  const podium = useMemo(() => ranking.slice(0, 3), [ranking]);
  const list = useMemo(() => ranking.slice(3, 3 + LIST_MAX), [ranking]);
  const resumo = data?.resumo ?? null;

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setTv(true)).catch(() => setTv(true));
    } else {
      document.exitFullscreen?.();
      setTv(false);
    }
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setTv(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const periodLabel: Record<Period, string> = { hoje: 'HOJE', semana: 'DA SEMANA', mes: 'DO MÊS' };

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 text-white overflow-x-hidden"
    >
      <div className="mx-auto max-w-6xl px-5 py-5 md:px-8 md:py-7">
        {/* ===== Cabeçalho ===== */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-2xl md:text-3xl font-black leading-none tracking-tight">
              R. <span className="text-amber-400">Prudêncio.</span>
            </div>
            <div className="mt-1 text-[10px] md:text-xs font-semibold uppercase tracking-widest text-white/50 truncate">
              Atividades · {titulo}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Ao Vivo</span>
          </div>

          <div className="text-right shrink-0">
            <div className="text-2xl md:text-3xl font-black leading-none tabular-nums">{format(now, 'HH:mm')}</div>
            <div className="text-[10px] md:text-xs text-white/50 mt-1">
              {cap(format(now, "EEEE, d 'De' MMMM", { locale: ptBR }))}
            </div>
          </div>
        </div>

        {/* ===== Faixa da regra ===== */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px] md:text-sm font-bold uppercase tracking-wider text-white/70">
          <span className="text-amber-400">🏆 Ranking {periodLabel[period]}</span>
          <span className="text-white/30">·</span>
          <span>1º <span className="text-sky-400">Passos Dados</span></span>
          <span className="text-white/30">·</span>
          <span>2º <span className="text-emerald-400">Concluídas</span></span>
          <span className="text-white/30">·</span>
          <span>3º <span className="text-rose-400">Menos Atrasadas</span></span>
        </div>

        {/* ===== Controles (escondem no telão) ===== */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <div className="flex items-center rounded-full bg-white/10 p-0.5 gap-0.5">
            {(['hoje', 'semana', 'mes'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold transition',
                  period === p ? 'bg-white text-slate-900' : 'text-white/60 hover:text-white'
                )}
              >
                {p === 'hoje' ? 'Hoje' : p === 'semana' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="rounded-full bg-white/10 p-2 text-white/70 hover:text-white transition"
            title="Atualizar"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="rounded-full bg-white/10 p-2 text-white/70 hover:text-white transition"
            title="Modo TV / tela cheia"
          >
            {tv ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>

        {ranking.length === 0 ? (
          <div className="py-24 text-center text-white/50 text-lg">
            {loading ? 'Carregando…' : 'Sem atividades no período.'}
          </div>
        ) : (
          <>
            {/* ===== Pódio ===== */}
            <Podium podium={podium} />

            {/* ===== Lista 4..10 ===== */}
            <div className="mt-5 space-y-2">
              {list.map((r, i) => (
                <ListRow key={r.nome} rank={i + 4} row={r} />
              ))}
            </div>

            {/* ===== Rodapé ===== */}
            <Footer resumo={resumo} participantes={ranking.length} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Pódio ---------- */
function Podium({ podium }: { podium: RankRow[] }) {
  // Ordem visual: 2º (esq) · 1º (centro) · 3º (dir).
  const first = podium[0];
  const second = podium[1];
  const third = podium[2];
  return (
    <div className="mt-6 grid grid-cols-3 items-end gap-2 md:gap-4">
      <PodiumSpot row={second} place={2} />
      <PodiumSpot row={first} place={1} />
      <PodiumSpot row={third} place={3} />
    </div>
  );
}

function PodiumSpot({ row, place }: { row: RankRow | undefined; place: 1 | 2 | 3 }) {
  if (!row) return <div />;
  const cfg = {
    1: { ring: 'ring-amber-400', glow: 'shadow-[0_0_45px_-5px] shadow-amber-400/60', bar: 'from-amber-400 to-amber-600', size: 'h-24 w-24 md:h-32 md:w-32 text-3xl md:text-4xl', barH: 'h-24 md:h-32', badge: 'bg-amber-400 text-slate-900', num: 'text-amber-300' },
    2: { ring: 'ring-slate-300', glow: 'shadow-[0_0_25px_-8px] shadow-slate-300/50', bar: 'from-slate-300 to-slate-500', size: 'h-20 w-20 md:h-24 md:w-24 text-2xl md:text-3xl', barH: 'h-16 md:h-20', badge: 'bg-slate-300 text-slate-900', num: 'text-slate-200' },
    3: { ring: 'ring-orange-400', glow: 'shadow-[0_0_25px_-8px] shadow-orange-400/50', bar: 'from-orange-400 to-orange-700', size: 'h-20 w-20 md:h-24 md:w-24 text-2xl md:text-3xl', barH: 'h-12 md:h-16', badge: 'bg-orange-400 text-slate-900', num: 'text-orange-300' },
  }[place];

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        {place === 1 && (
          <Crown className="absolute -top-6 left-1/2 -translate-x-1/2 h-7 w-7 md:h-9 md:w-9 text-amber-400 drop-shadow" />
        )}
        <div className={cn('rounded-full ring-4 flex items-center justify-center font-black', colorFor(row.nome), cfg.ring, cfg.glow, cfg.size)}>
          {initials(row.nome)}
        </div>
        <div className={cn('absolute -bottom-1 -right-1 h-7 w-7 rounded-full flex items-center justify-center text-sm font-black ring-2 ring-slate-900', cfg.badge)}>
          {place}
        </div>
      </div>

      <div className="mt-3 text-center px-1">
        <div className="font-bold leading-tight text-sm md:text-lg line-clamp-2">{row.nome}</div>
        <div className={cn('mt-1 font-black leading-none', place === 1 ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl', cfg.num)}>
          {row.concluidas}
          <span className="ml-1 text-[10px] md:text-xs font-bold uppercase tracking-widest text-white/50">concl</span>
        </div>
        <div className="mt-1 text-[10px] md:text-xs text-white/60">
          <span className="text-sky-400 font-bold">{row.passos}</span> passos ·{' '}
          <span className="text-rose-400 font-bold">{row.atrasadas}</span> atras. ·{' '}
          <span className="text-emerald-400 font-bold">{aprovLabel(row.aprov_pct)}</span> aprov.
        </div>
      </div>

      <div className={cn('mt-3 w-full max-w-[9rem] rounded-t-lg bg-gradient-to-b flex items-start justify-center pt-2', cfg.bar, cfg.barH)}>
        <span className="text-2xl md:text-3xl font-black text-slate-900/80">{place}</span>
      </div>
    </div>
  );
}

/* ---------- Linha da lista ---------- */
function ListRow({ rank, row }: { rank: number; row: RankRow }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/5 px-3 py-2.5 md:px-4 md:py-3">
      <div className="w-5 text-center text-sm md:text-base font-bold text-white/40 tabular-nums">{rank}</div>
      <div className={cn('h-9 w-9 md:h-11 md:w-11 shrink-0 rounded-full flex items-center justify-center text-xs md:text-sm font-black', colorFor(row.nome))}>
        {initials(row.nome)}
      </div>
      <div className="min-w-0 flex-1 font-semibold text-sm md:text-lg truncate">{row.nome}</div>
      <Stat value={row.passos} label="passos" color="text-sky-400" />
      <Stat value={row.concluidas} label="concl" color="text-emerald-400" />
      <Stat value={row.atrasadas} label="atr" color="text-rose-400" />
      <div className="w-12 md:w-16 text-right">
        <div className="text-base md:text-xl font-black text-amber-400 tabular-nums">{aprovLabel(row.aprov_pct)}</div>
      </div>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="w-12 md:w-20 text-right">
      <span className={cn('text-base md:text-xl font-black tabular-nums', color)}>{value}</span>
      <span className="ml-1 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
    </div>
  );
}

/* ---------- Rodapé ---------- */
function Footer({ resumo, participantes }: { resumo: Resumo | null; participantes: number }) {
  return (
    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-white/[0.04] border border-white/5 p-4">
        <FooterStat value={resumo ? `${resumo.trabalhando_h}h` : '—'} label="Trabalhando (7d)" color="text-emerald-400" />
        <FooterStat value={resumo ? `${resumo.ocioso_h}h` : '—'} label="Ocioso (7d)" color="text-amber-400" />
        <FooterStat value={resumo?.aproveitamento_pct != null ? `${resumo.aproveitamento_pct}%` : '—'} label="Aproveitamento" color="text-sky-400" />
      </div>
      <div className="rounded-xl bg-white/[0.04] border border-white/5 p-4 text-[11px] md:text-xs leading-relaxed text-white/60">
        <p className="flex gap-2">
          <Trophy className="h-4 w-4 shrink-0 text-amber-400" />
          <span><b className="text-white/80">Tempo</b> só de quem usa o cronômetro (7 dias).</span>
        </p>
        <p className="mt-1.5 flex gap-2">
          <span className="text-sky-400">◷</span>
          <span><b className="text-white/80">Passos</b>: contagem dos checklists marcados no período — com empate, a ordem cai pras concluídas, depois menos atrasadas. {participantes} no ranking.</span>
        </p>
      </div>
    </div>
  );
}

function FooterStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="text-center md:text-left">
      <div className={cn('text-2xl md:text-3xl font-black leading-none', color)}>{value}</div>
      <div className="mt-1 text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</div>
    </div>
  );
}
