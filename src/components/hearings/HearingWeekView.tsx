import { useMemo } from 'react';
import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card } from '@/components/ui/card';
import { Plus } from 'lucide-react';
import type { Hearing } from '@/hooks/useHearings';
import { HearingCard } from './HearingCard';
import { cn } from '@/lib/utils';

interface Props {
  hearings: Hearing[];
  referenceDate: Date;
  onSelect: (h: Hearing) => void;
  onAdd: (dateISO: string) => void;
}

interface Week { label: string; days: Date[] }

function buildWeeks(reference: Date): Week[] {
  const start = startOfWeek(startOfMonth(reference), { weekStartsOn: 1 });
  const end = endOfMonth(reference);
  const weeks: Week[] = [];
  let cursor = start;
  let n = 1;
  while (cursor <= end) {
    const days = Array.from({ length: 5 }, (_, i) => addDays(cursor, i)); // Mon-Fri
    weeks.push({ label: `Semana ${n}`, days });
    cursor = addDays(cursor, 7);
    n++;
  }
  return weeks;
}

export function HearingWeekView({ hearings, referenceDate, onSelect, onAdd }: Props) {
  const weeks = useMemo(() => buildWeeks(referenceDate), [referenceDate]);
  const byDate = useMemo(() => {
    const m = new Map<string, Hearing[]>();
    for (const h of hearings) {
      const arr = m.get(h.hearing_date) || [];
      arr.push(h);
      m.set(h.hearing_date, arr);
    }
    return m;
  }, [hearings]);

  return (
    <div className="space-y-6">
      {weeks.map((w) => (
        <div key={w.label} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{w.label}</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {w.days.map((day) => {
              const iso = format(day, 'yyyy-MM-dd');
              const items = byDate.get(iso) || [];
              const isToday = isSameDay(day, new Date());
              const isCurrentMonth = day.getMonth() === referenceDate.getMonth();
              return (
                <Card
                  key={iso}
                  className={cn(
                    'p-2 min-h-[140px] flex flex-col gap-1.5 transition-colors',
                    !isCurrentMonth && 'opacity-50',
                    isToday && 'ring-2 ring-primary',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        {format(day, 'EEE', { locale: ptBR })}
                      </div>
                      <div className="text-lg font-bold leading-none">{format(day, 'dd')}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAdd(iso)}
                      className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-1"
                      title="Nova audiência"
                    >
                      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5 overflow-y-auto">
                    {items.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => onAdd(iso)}
                        className="text-xs text-muted-foreground/50 hover:text-primary text-center py-3"
                      >
                        + adicionar
                      </button>
                    ) : (
                      items.map((h) => (
                        <HearingCard key={h.id} hearing={h} onClick={() => onSelect(h)} compact />
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
