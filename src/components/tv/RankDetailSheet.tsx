import { useEffect, useState } from 'react';
import { Loader2, ListChecks, CheckCircle2, AlarmClock, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cn } from '@/lib/utils';

// Painel lateral do telão /tv/atividades: ao clicar num chip de critério
// (passos / concluídas / atrasadas) de uma pessoa, lista o que compôs aquele
// número. Fonte: RPC tv_ranking_detalhe no Externo, que replica exatamente os
// filtros do tv_atividades_ranking — a soma aqui bate com o número do telão.

export type DetailCriterio = 'passos' | 'concluidas' | 'atrasadas';

interface DetailItem {
  tipo: 'passo' | 'concluida' | 'atrasada';
  quando?: string;
  titulo: string | null;
  lead_nome?: string | null;
  lead_id?: string | null;
  activity_id?: string;
  deadline?: string;
  dias_atraso?: number;
}

const CRITERIO_CFG: Record<DetailCriterio, { titulo: string; cor: string; Icon: typeof ListChecks }> = {
  passos: { titulo: 'Passos', cor: 'text-sky-400', Icon: ListChecks },
  concluidas: { titulo: 'Concluídas', cor: 'text-emerald-400', Icon: CheckCircle2 },
  atrasadas: { titulo: 'Atrasadas', cor: 'text-rose-400', Icon: AlarmClock },
};

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
            {nome}
            {criterio === 'atrasadas'
              ? ' · backlog total (não filtra por período)'
              : ` · ${periodLabel}`}
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
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/50">
                  {it.lead_nome && <span className="truncate max-w-[14rem]">{it.lead_nome}</span>}
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
