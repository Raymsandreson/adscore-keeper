/**
 * A visão principal: uma semana inteira, segunda a domingo.
 *
 * Sábado e domingo entram na grade porque visita de assistente social acontece
 * em fim de semana ("vai realizar a visita no sábado" é recado corriqueiro da
 * operação) — esconder esses dois dias esconderia agendamento real.
 */
import { useMemo } from 'react';
import { addDays, format, isSameDay, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { SocialVisit } from '@/hooks/useSocialVisits';
import { SocialVisitCard } from './SocialVisitCard';
import { cn } from '@/lib/utils';

interface Props {
  visits: SocialVisit[];
  referenceDate: Date;
  onSelect: (visit: SocialVisit) => void;
  onAdd: (dateISO: string) => void;
  onOpenLead: (leadId: string) => void;
}

export function SocialVisitWeekView({ visits, referenceDate, onSelect, onAdd, onOpenLead }: Props) {
  const days = useMemo(() => {
    const start = startOfWeek(referenceDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [referenceDate]);

  const byDate = useMemo(() => {
    const map = new Map<string, SocialVisit[]>();
    for (const visit of visits) {
      const list = map.get(visit.visit_date) || [];
      list.push(visit);
      map.set(visit.visit_date, list);
    }
    return map;
  }, [visits]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
      {days.map((day) => {
        const iso = format(day, 'yyyy-MM-dd');
        const items = byDate.get(iso) || [];
        const today = isSameDay(day, new Date());
        const weekend = day.getDay() === 0 || day.getDay() === 6;

        return (
          <Card
            key={iso}
            className={cn(
              'p-2 min-h-[180px] flex flex-col gap-1.5',
              weekend && 'bg-muted/30',
              today && 'ring-2 ring-primary',
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">
                  {format(day, 'EEEE', { locale: ptBR })}
                </div>
                <div className="text-lg font-bold leading-none">
                  {format(day, 'dd/MM')}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {items.length > 0 && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">{items.length}</span>
                )}
                <button
                  type="button"
                  onClick={() => onAdd(iso)}
                  className="hover:bg-muted rounded p-1"
                  title="Agendar visita neste dia"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onAdd(iso)}
                  className="text-xs text-muted-foreground/60 hover:text-primary text-center py-4"
                >
                  + agendar
                </button>
              ) : (
                items.map((visit) => (
                  <SocialVisitCard
                    key={visit.id}
                    visit={visit}
                    compact
                    onSelect={() => onSelect(visit)}
                    onOpenLead={() => onOpenLead(visit.lead_id)}
                  />
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
