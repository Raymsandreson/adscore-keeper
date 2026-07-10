import { useEffect, useMemo, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Star, Loader2, MessageSquare, Link2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface RatingRow {
  id: string;
  assessor_id: string | null;
  assessor_name: string | null;
  lead_name: string | null;
  rating: number | null;
  reason: string | null;
  status: string;
  created_at: string;
  submitted_at: string | null;
}

const Stars = ({ n, size = 'h-4 w-4' }: { n: number; size?: string }) => (
  <span className="inline-flex items-center">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className={`${size} ${i <= Math.round(n) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
    ))}
  </span>
);

export default function ServiceRatingsPage() {
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await externalSupabase
          .from('service_ratings')
          .select('id, assessor_id, assessor_name, lead_name, rating, reason, status, created_at, submitted_at')
          .order('created_at', { ascending: false })
          .limit(1000);
        setRows(((data as any[]) || []) as RatingRow[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const submitted = useMemo(() => rows.filter((r) => r.status === 'submitted' && r.rating != null), [rows]);

  const overall = useMemo(() => {
    if (submitted.length === 0) return { avg: 0, count: 0, pending: rows.length - submitted.length };
    const sum = submitted.reduce((s, r) => s + (r.rating || 0), 0);
    return { avg: sum / submitted.length, count: submitted.length, pending: rows.length - submitted.length };
  }, [submitted, rows]);

  const byAssessor = useMemo(() => {
    const map = new Map<string, { name: string; sum: number; count: number }>();
    for (const r of submitted) {
      const key = r.assessor_id || r.assessor_name || '—';
      const cur = map.get(key) || { name: r.assessor_name || 'Sem nome', sum: 0, count: 0 };
      cur.sum += r.rating || 0;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ name: v.name, avg: v.sum / v.count, count: v.count }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count);
  }, [submitted]);

  const comments = useMemo(
    () => submitted.filter((r) => (r.reason || '').trim()).slice(0, 100),
    [submitted],
  );

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Star className="h-6 w-6 text-yellow-400 fill-yellow-400" /> Avaliações de atendimento</h1>
        <p className="text-sm text-muted-foreground mt-1">Notas de 0 a 5 enviadas pelos clientes pelo link de avaliação.</p>
      </div>

      {/* Resumo geral */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Média geral</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-3xl font-bold">{overall.count ? overall.avg.toFixed(1) : '—'}</span>
            {overall.count > 0 && <Stars n={overall.avg} />}
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Respondidas</p>
          <span className="text-3xl font-bold">{overall.count}</span>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Link2 className="h-3 w-3" /> Pendentes</p>
          <span className="text-3xl font-bold">{overall.pending}</span>
        </div>
      </div>

      {/* Por assessor */}
      <div className="rounded-xl border">
        <div className="px-4 py-3 border-b font-semibold text-sm">Média por assessor</div>
        {byAssessor.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nenhuma avaliação respondida ainda.</p>
        ) : (
          <ul className="divide-y">
            {byAssessor.map((a) => (
              <li key={a.name} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm font-medium truncate">{a.name}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <Stars n={a.avg} />
                  <span className="text-sm font-semibold w-8 text-right">{a.avg.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground w-14 text-right">{a.count} nota{a.count > 1 ? 's' : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Comentários */}
      <div className="rounded-xl border">
        <div className="px-4 py-3 border-b font-semibold text-sm flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> Comentários recentes</div>
        {comments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nenhum comentário ainda.</p>
        ) : (
          <ul className="divide-y">
            {comments.map((c) => (
              <li key={c.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Stars n={c.rating || 0} size="h-3.5 w-3.5" />
                  <span className="text-xs text-muted-foreground">
                    {c.submitted_at ? format(parseISO(c.submitted_at), 'dd/MM/yyyy') : ''}
                  </span>
                </div>
                <p className="text-sm">{c.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {c.assessor_name ? `Assessor: ${c.assessor_name}` : ''}{c.assessor_name && c.lead_name ? ' · ' : ''}{c.lead_name ? `Cliente: ${c.lead_name}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
