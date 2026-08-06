import { useEffect, useState } from 'react';
import { Loader2, Star, Sparkles, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cn } from '@/lib/utils';

// Aba lateral do painel "Top de Avaliação": clicar num número (elogio,
// satisfeito, incompleto, insatisfeito) abre as avaliações que compõem aquele
// número — nota, quem avaliou, por quê e a atividade de origem.
//
// Lê lead_activities direto, com os MESMOS filtros do painel (mesma janela de
// 30 dias, mesma pessoa), pra soma bater com o que está na tela. Não usa a RPC
// tv_ranking_detalhe porque ela trabalha com o período do telão e não separa
// por desfecho.

export type OutcomeTipo = 'elogio' | 'satisfeito' | 'incompleto' | 'insatisfeito';

export const OUTCOME_CFG: Record<OutcomeTipo, { titulo: string; cor: string; chip: string; emoji: string }> = {
  elogio:       { titulo: 'Elogios',      cor: 'text-yellow-300',  chip: 'bg-yellow-400/15 text-yellow-300',   emoji: '⭐' },
  satisfeito:   { titulo: 'Satisfeito',   cor: 'text-emerald-400', chip: 'bg-emerald-400/15 text-emerald-300', emoji: '✅' },
  incompleto:   { titulo: 'Incompleto',   cor: 'text-amber-400',   chip: 'bg-amber-400/15 text-amber-300',     emoji: '⚠️' },
  insatisfeito: { titulo: 'Insatisfeito', cor: 'text-rose-400',    chip: 'bg-rose-400/15 text-rose-300',       emoji: '❌' },
};

interface Item {
  id: string;
  title: string | null;
  lead_id: string | null;
  feedback: string | null;
  feedback_praise: string | null;
  feedback_rating: number | null;
  feedback_outcome: string | null;
  feedback_rating_justification: string | null;
  feedback_rated_by_name: string | null;
  feedback_rated_at: string | null;
}

export default function AvaliacaoDetailSheet({
  assignedTo, nome, tipo, count, desde, onClose,
}: {
  assignedTo: string;
  nome: string;
  tipo: OutcomeTipo;
  count: number;
  /** ISO do início da janela — o mesmo usado pelo painel. */
  desde: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [leads, setLeads] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const cfg = OUTCOME_CFG[tipo];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        let q = (externalSupabase as any)
          .from('lead_activities')
          .select('id, title, lead_id, feedback, feedback_praise, feedback_rating, feedback_outcome, feedback_rating_justification, feedback_rated_by_name, feedback_rated_at')
          .is('deleted_at', null)
          .eq('assigned_to', assignedTo)
          .gte('feedback_rated_at', desde)
          .order('feedback_rated_at', { ascending: false });
        // Elogio é nota 5 (derivado), o resto é o desfecho gravado no funil.
        q = tipo === 'elogio' ? q.eq('feedback_rating', 5) : q.eq('feedback_outcome', tipo);
        const { data, error: qErr } = await q;
        if (cancelled) return;
        if (qErr) throw qErr;
        const rows = (data || []) as Item[];
        setItems(rows);

        const ids = [...new Set(rows.map(r => r.lead_id).filter(Boolean))] as string[];
        if (ids.length) {
          const { data: ls } = await (externalSupabase as any)
            .from('leads')
            .select('id, lead_name')
            .in('id', ids);
          if (cancelled) return;
          const map: Record<string, string> = {};
          for (const l of ls || []) if (l.lead_name) map[l.id] = l.lead_name;
          setLeads(map);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar as avaliações.');
      }
    })();
    return () => { cancelled = true; };
  }, [assignedTo, tipo, desde]);

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto border-white/10 bg-slate-950 text-white sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-baseline gap-2 text-white">
            <span className="self-center text-xl leading-none">{cfg.emoji}</span>
            <span className={cn('text-2xl font-black tabular-nums', cfg.cor)}>{count}</span>
            <span className="text-lg font-bold">{cfg.titulo}</span>
          </SheetTitle>
          <div className="text-left text-sm text-white/60">{nome} · últimos 30 dias</div>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {error && <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
          {!items && !error && (
            <div className="flex items-center gap-2 py-8 text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          )}
          {items?.length === 0 && (
            <div className="py-8 text-center text-sm text-white/40">
              Nenhuma avaliação deste tipo nos últimos 30 dias.
            </div>
          )}

          {items?.map(it => (
            <div key={it.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <button
                onClick={() => window.open(`/atv/${it.id.slice(0, 8)}`, '_blank', 'noopener')}
                className="flex w-full items-start gap-1.5 text-left"
                title="Abrir a atividade"
              >
                <span className="min-w-0 flex-1 text-sm font-bold leading-tight hover:underline">
                  {it.title || 'Atividade sem título'}
                </span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" />
              </button>

              {it.lead_id && leads[it.lead_id] && (
                <div className="mt-0.5 truncate text-xs text-white/45">{leads[it.lead_id]}</div>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star
                      key={n}
                      className={cn('h-3.5 w-3.5', (it.feedback_rating || 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-white/20')}
                    />
                  ))}
                </span>
                {it.feedback_rating === 5 && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-yellow-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-300">
                    <Sparkles className="h-2.5 w-2.5" /> elogio
                  </span>
                )}
                {it.feedback_outcome && (
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    OUTCOME_CFG[(it.feedback_outcome as OutcomeTipo)]?.chip || 'bg-white/10 text-white/60',
                  )}>
                    {it.feedback_outcome}
                  </span>
                )}
              </div>

              {/* O que o avaliador escreveu: elogio do sanduíche, justificativa
                  da nota e o retorno original que foi avaliado. */}
              {it.feedback_praise && (
                <p className="mt-1.5 rounded bg-emerald-400/[0.07] p-1.5 text-xs leading-snug text-emerald-200/80">
                  👏 {it.feedback_praise}
                </p>
              )}
              {it.feedback_rating_justification && (
                <p className="mt-1.5 rounded bg-white/[0.04] p-1.5 text-xs leading-snug text-white/60">
                  {it.feedback_rating_justification}
                </p>
              )}
              {it.feedback && (
                <p className="mt-1.5 rounded bg-white/[0.04] p-1.5 text-xs leading-snug text-white/45 line-clamp-4">
                  retorno: {it.feedback}
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-white/40">
                {it.feedback_rated_by_name && <span>avaliado por {it.feedback_rated_by_name}</span>}
                {it.feedback_rated_at && (
                  <span>{format(new Date(it.feedback_rated_at), "dd/MM · HH'h'mm", { locale: ptBR })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
