import { useEffect, useState } from 'react';
import { Loader2, ListChecks, CheckCircle2, AlarmClock, ExternalLink, Target, Flag, Goal } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cn } from '@/lib/utils';

// Painel lateral do telão /tv/atividades: ao clicar num chip de critério
// (status / fases / objetivos / passos / concluídas / atrasadas) de uma pessoa,
// lista o que compôs aquele número. Fonte: RPC tv_ranking_detalhe no Externo,
// que replica exatamente os filtros do tv_atividades_ranking — a soma aqui bate
// com o número do telão.

export type DetailCriterio = 'status' | 'fases' | 'objetivos' | 'passos' | 'concluidas' | 'atrasadas';

interface DetailItem {
  tipo: 'status' | 'fase' | 'objetivo' | 'passo' | 'concluida' | 'atrasada';
  quando?: string;
  titulo: string | null;
  lead_nome?: string | null;
  lead_id?: string | null;
  /** Onde o item mora — o RPC devolve o que consegue afirmar de cada um. */
  objetivo?: string | null;
  fase?: string | null;
  pop?: string | null;
  processo?: string | null;
  /** Passo: atividade de onde a marcação saiu (metadata.activity_id). */
  atividade?: string | null;
  activity_id?: string;
  deadline?: string;
  dias_atraso?: number;
}

// Rótulo + valor num chip só, pra não virar sopa de texto solto.
function Chip({ label, valor }: { label: string; valor: string }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px]">
      <span className="shrink-0 uppercase tracking-wider text-white/30">{label}</span>
      <span className="min-w-0 truncate text-white/70">{valor}</span>
    </span>
  );
}

const CRITERIO_CFG: Record<DetailCriterio, { titulo: string; cor: string; Icon: typeof ListChecks }> = {
  status: { titulo: 'Status esperado', cor: 'text-yellow-300', Icon: Target },
  fases: { titulo: 'Fases', cor: 'text-amber-300', Icon: Flag },
  objetivos: { titulo: 'Objetivos', cor: 'text-lime-400', Icon: Goal },
  passos: { titulo: 'Passos', cor: 'text-sky-400', Icon: ListChecks },
  concluidas: { titulo: 'Concluídas', cor: 'text-emerald-400', Icon: CheckCircle2 },
  atrasadas: { titulo: 'Atrasadas', cor: 'text-rose-400', Icon: AlarmClock },
};

// Alguns critérios do ranking não usam o período aberto no telão — deixar
// explícito no cabeçalho pra ninguém achar que o número está errado.
function escopoLabel(criterio: DetailCriterio, periodLabel: string) {
  if (criterio === 'atrasadas') return 'backlog total (não filtra por período)';
  if (criterio === 'status') return 'mês corrente (o ranking conta o mês, não o período)';
  return periodLabel;
}

interface Props {
  nome: string;
  criterio: DetailCriterio;
  count: number;
  since: string; // ISO — mesmo p_since passado ao ranking
  periodLabel: string; // "hoje" | "semana" | "mês"
  onClose: () => void;
}

export default function RankDetailSheet({ nome, criterio, count, since, periodLabel, onClose }: Props) {
  const [items, setItems] = useState<DetailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cfg = CRITERIO_CFG[criterio];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data, error: qErr } = await (externalSupabase as any).rpc('tv_ranking_detalhe', {
          p_nome: nome,
          p_criterio: criterio,
          p_since: since,
        });
        if (cancelled) return;
        if (qErr) throw qErr;
        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar o detalhe.');
      }
    })();
    return () => { cancelled = true; };
  }, [nome, criterio, since]);

  const openActivity = (id?: string) => {
    if (id) window.open(`/atv/${id.slice(0, 8)}`, '_blank', 'noopener');
  };

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto border-white/10 bg-slate-950 text-white">
        <SheetHeader>
          <SheetTitle className="flex items-baseline gap-2 text-white">
            <cfg.Icon className={cn('h-5 w-5 shrink-0 self-center', cfg.cor)} />
            <span className={cn('text-2xl font-black tabular-nums', cfg.cor)}>{count}</span>
            <span className="text-lg font-bold">{cfg.titulo}</span>
          </SheetTitle>
          <div className="text-left text-sm text-white/60">
            {nome} · {escopoLabel(criterio, periodLabel)}
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>
          ) : items === null ? (
            <div className="flex items-center gap-2 py-10 justify-center text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-white/50">Nada no período.</div>
          ) : (
            items.map((it, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border border-white/10 bg-white/[0.04] p-3',
                  it.activity_id && 'cursor-pointer transition hover:bg-white/[0.1]'
                )}
                onClick={() => openActivity(it.activity_id)}
                title={it.activity_id ? 'Abrir atividade em nova aba' : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 text-sm font-semibold leading-snug">
                    {it.titulo || '(sem título)'}
                  </div>
                  {it.activity_id && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/40 mt-0.5" />}
                </div>
                {/* Onde esse item mora: cliente · processo · objetivo · fase · POP */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {it.lead_nome && <Chip label="cliente" valor={it.lead_nome} />}
                  {it.processo && <Chip label="processo" valor={it.processo} />}
                  {it.objetivo && <Chip label="objetivo" valor={it.objetivo} />}
                  {it.fase && <Chip label="fase" valor={it.fase} />}
                  {it.pop && <Chip label="POP" valor={it.pop} />}
                </div>

                {/* Atividade de onde a marcação saiu — no passo, e no objetivo/
                    fase é a atividade do último passo, que fechou o conjunto.
                    Só existe a partir de 04/08 (antes o log não guardava). */}
                {(it.tipo === 'passo' || it.tipo === 'objetivo' || it.tipo === 'fase') && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                    <span className="shrink-0 text-white/35">
                      {it.tipo === 'passo' ? 'marcado na atividade:' : 'fechou na atividade:'}
                    </span>
                    {it.atividade && it.activity_id ? (
                      <button
                        className="group/atv inline-flex min-w-0 flex-1 items-start gap-1 text-left font-semibold text-sky-300 hover:text-sky-200"
                        onClick={e => { e.stopPropagation(); openActivity(it.activity_id); }}
                        title="Abrir a atividade em nova aba"
                      >
                        <span className="min-w-0 underline decoration-sky-300/40 underline-offset-2 group-hover/atv:decoration-sky-200">
                          {it.atividade}
                        </span>
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    ) : (
                      <span className="text-white/30 italic">fora de uma atividade (ou antes de 04/08)</span>
                    )}
                  </div>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/50">
                  {it.tipo === 'atrasada' ? (
                    <>
                      {it.deadline && <span>prazo {format(new Date(`${it.deadline}T00:00:00`), 'dd/MM/yyyy', { locale: ptBR })}</span>}
                      {typeof it.dias_atraso === 'number' && (
                        <span className="font-bold text-rose-400">{it.dias_atraso} {it.dias_atraso === 1 ? 'dia' : 'dias'} de atraso</span>
                      )}
                    </>
                  ) : (
                    it.quando && <span>{format(new Date(it.quando), "dd/MM · HH'h'mm", { locale: ptBR })}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
