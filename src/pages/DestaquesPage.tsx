import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Button } from '@/components/ui/button';
import { Star, Trophy, RefreshCw, Maximize2, Minimize2, ArrowLeft, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

// "Top 5 de Avaliação" — mural de destaques (endomarketing: celebra em público
// quem entrega os melhores retornos). Feito para rodar num telão (Modo TV).
// Ranqueia os RESPONSÁVEIS pela média de estrelas dos feedbacks avaliados.

interface EvalRow {
  assigned_to: string | null;
  assigned_to_name: string | null;
  feedback_rating: number | null;
  feedback_outcome: string | null;
  feedback_rated_at: string | null;
}

interface Ranked {
  key: string;
  name: string;
  count: number;
  avg: number;
  elogios: number;   // 5⭐
  satisfeitos: number;
}

const MEDALS = ['🥇', '🥈', '🥉', '🏅', '🏅'];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '—';
}

export default function DestaquesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EvalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<'30' | 'all'>('30');
  const [tv, setTv] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await externalSupabase
        .from('lead_activities')
        .select('assigned_to, assigned_to_name, feedback_rating, feedback_outcome, feedback_rated_at')
        .not('feedback_outcome', 'is', null)
        .is('deleted_at', null)
        .limit(2000);
      if (error) throw error;
      setRows((data || []) as EvalRow[]);
    } catch (e) {
      console.error('[Destaques] load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-atualiza a cada 90s quando em Modo TV (mural sempre fresco no telão).
  useEffect(() => {
    if (!tv) return;
    const id = setInterval(load, 90_000);
    return () => clearInterval(id);
  }, [tv, load]);

  const ranked = useMemo<Ranked[]>(() => {
    const cutoff = period === '30' ? Date.now() - 30 * 24 * 3600 * 1000 : 0;
    const map = new Map<string, Ranked & { sum: number }>();
    for (const r of rows) {
      if (!r.assigned_to || !r.feedback_rating) continue;
      if (cutoff && r.feedback_rated_at && new Date(r.feedback_rated_at).getTime() < cutoff) continue;
      const key = r.assigned_to;
      const cur = map.get(key) || { key, name: r.assigned_to_name || 'Sem nome', count: 0, avg: 0, sum: 0, elogios: 0, satisfeitos: 0 };
      cur.count += 1;
      cur.sum += r.feedback_rating;
      if (r.feedback_rating >= 5) cur.elogios += 1;
      if (r.feedback_outcome === 'satisfeito') cur.satisfeitos += 1;
      if (r.assigned_to_name) cur.name = r.assigned_to_name;
      map.set(key, cur);
    }
    return [...map.values()]
      .map(m => ({ key: m.key, name: m.name, count: m.count, avg: m.sum / m.count, elogios: m.elogios, satisfeitos: m.satisfeitos }))
      // Ordena por média; empate → mais avaliações; empate → mais elogios.
      .sort((a, b) => b.avg - a.avg || b.count - a.count || b.elogios - a.elogios)
      .slice(0, 5);
  }, [rows, period]);

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

  return (
    <div
      ref={containerRef}
      className={cn(
        'min-h-screen w-full',
        tv
          ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-8'
          : 'bg-background p-4 md:p-8'
      )}
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          {!tv && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} title="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h1 className={cn('font-bold flex items-center gap-2', tv ? 'text-4xl' : 'text-2xl')}>
            <Trophy className={cn(tv ? 'h-9 w-9 text-amber-400' : 'h-6 w-6 text-amber-500')} />
            Top 5 de Avaliação
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn('flex items-center rounded-full p-0.5 gap-0.5', tv ? 'bg-white/10' : 'bg-muted')}>
            {(['30', 'all'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition',
                  period === p ? (tv ? 'bg-white text-slate-900' : 'bg-background shadow-sm') : (tv ? 'text-white/70' : 'text-muted-foreground')
                )}
              >
                {p === '30' ? 'Últimos 30 dias' : 'Tudo'}
              </button>
            ))}
          </div>
          <Button variant={tv ? 'secondary' : 'outline'} size="icon" className="h-8 w-8" onClick={load} title="Atualizar">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button variant={tv ? 'secondary' : 'outline'} size="sm" className="h-8 gap-1" onClick={toggleFullscreen} title="Modo TV / tela cheia">
            {tv ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {tv ? 'Sair' : 'Modo TV'}
          </Button>
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className={cn('text-center py-24', tv ? 'text-white/60 text-xl' : 'text-muted-foreground')}>
          {loading ? 'Carregando…' : 'Ainda não há feedbacks avaliados no período. Assim que a equipe avaliar os retornos, os destaques aparecem aqui.'}
        </div>
      ) : (
        <div className={cn('mx-auto', tv ? 'max-w-5xl space-y-4' : 'max-w-3xl space-y-3')}>
          {ranked.map((r, i) => (
            <div
              key={r.key}
              className={cn(
                'flex items-center gap-4 rounded-2xl border transition',
                tv ? 'p-5 bg-white/5 border-white/10' : 'p-4 bg-card',
                i === 0 && (tv ? 'ring-2 ring-amber-400/60 bg-amber-400/10' : 'ring-2 ring-amber-400/50 bg-amber-50 dark:bg-amber-950/20')
              )}
            >
              <div className={cn('shrink-0 text-center', tv ? 'w-16' : 'w-12')}>
                <div className={cn(tv ? 'text-4xl' : 'text-3xl')}>{MEDALS[i]}</div>
              </div>
              <div className={cn(
                'shrink-0 rounded-full flex items-center justify-center font-bold',
                tv ? 'h-16 w-16 text-xl bg-white/10' : 'h-12 w-12 text-sm bg-muted'
              )}>
                {initials(r.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('font-semibold truncate', tv ? 'text-2xl' : 'text-base')}>{r.name}</p>
                <div className={cn('flex items-center gap-3 flex-wrap', tv ? 'text-base text-white/80 mt-1' : 'text-xs text-muted-foreground mt-0.5')}>
                  <span className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map(n => (
                      <Star key={n} className={cn(tv ? 'h-5 w-5' : 'h-3.5 w-3.5', r.avg >= n - 0.25 ? 'fill-amber-400 text-amber-400' : 'text-current opacity-30')} />
                    ))}
                    <span className={cn('ml-1 font-bold', tv ? 'text-amber-300' : 'text-amber-600 dark:text-amber-400')}>{r.avg.toFixed(1)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1"><Sparkles className={cn(tv ? 'h-4 w-4' : 'h-3 w-3')} /> {r.elogios} elogio{r.elogios === 1 ? '' : 's'}</span>
                  <span>· {r.satisfeitos} satisfeito{r.satisfeitos === 1 ? '' : 's'}</span>
                  <span className="opacity-70">· {r.count} avaliação{r.count === 1 ? '' : 'ões'}</span>
                </div>
              </div>
            </div>
          ))}
          <p className={cn('text-center pt-2', tv ? 'text-white/40 text-sm' : 'text-[11px] text-muted-foreground')}>
            Gente boa chama gente boa. 💚
          </p>
        </div>
      )}
    </div>
  );
}
