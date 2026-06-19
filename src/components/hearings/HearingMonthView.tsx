import { useMemo } from 'react';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Hearing } from '@/hooks/useHearings';
import { categoryClasses, fmtTime } from './hearingStyles';
import { cn } from '@/lib/utils';

interface Props {
  hearings: Hearing[];
  referenceDate: Date;
  onSelect: (h: Hearing) => void;
  onAdd: (dateISO: string) => void;
}

export function HearingMonthView({ hearings, referenceDate, onSelect, onAdd }: Props) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(referenceDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(referenceDate), { weekStartsOn: 0 });
    const arr: Date[] = [];
    let cur = start;
    while (cur <= end) { arr.push(cur); cur = addDays(cur, 1); }
    return arr;
  }, [referenceDate]);

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
    <div className="border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/50">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
          <div key={d} className="p-2 text-xs font-semibold text-center text-muted-foreground border-r last:border-r-0">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = format(day, 'yyyy-MM-dd');
          const items = byDate.get(iso) || [];
          const isToday = isSameDay(day, new Date());
          const isCurrentMonth = day.getMonth() === referenceDate.getMonth();
          return (
            <div
              key={iso}
              className={cn(
                'min-h-[110px] border-r border-b p-1 last:border-r-0 cursor-pointer hover:bg-muted/30 transition-colors',
                !isCurrentMonth && 'bg-muted/20',
                isToday && 'bg-primary/5',
              )}
              onClick={() => onAdd(iso)}
            >
              <div className={cn('text-xs font-medium mb-1', isToday && 'text-primary font-bold', !isCurrentMonth && 'text-muted-foreground')}>
                {format(day, 'd', { locale: ptBR })}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((h) => {
                  const c = categoryClasses(h.category);
                  return (
                    <button
                      key={h.id}
                      onClick={(e) => { e.stopPropagation(); onSelect(h); }}
                      className={cn(
                        'w-full text-left text-[10px] rounded px-1 py-0.5 truncate border-l-2',
                        c.bg, c.border,
                        (h.status === 'cancelada' || h.status === 'adiada') && 'opacity-60',
                        h.status === 'cancelada' && 'line-through',
                      )}
                    >
                      {fmtTime(h.hearing_time)} {h.case_ref || h.hearing_type}
                    </button>
                  );
                })}
                {items.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">+{items.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
