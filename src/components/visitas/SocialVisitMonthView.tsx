/** Grade do mês — panorama de carga por semana, com as visitas resumidas no dia. */
import { useMemo } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { SocialVisit } from '@/hooks/useSocialVisits';
import { fmtVisitTime, shortWorkerName, workerColor } from './visitStyles';
import { cn } from '@/lib/utils';

interface Props {
  visits: SocialVisit[];
  referenceDate: Date;
  onSelect: (visit: SocialVisit) => void;
  onAdd: (dateISO: string) => void;
}

export function SocialVisitMonthView({ visits, referenceDate, onSelect, onAdd }: Props) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(referenceDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(referenceDate), { weekStartsOn: 1 });
    const all: Date[] = [];
    let cursor = start;
    while (cursor <= end) {
      all.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return all;
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
    <div className="border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/50">
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label) => (
          <div
            key={label}
            className="p-2 text-xs font-semibold text-center text-muted-foreground border-r last:border-r-0"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = format(day, 'yyyy-MM-dd');
          const items = byDate.get(iso) || [];
          const today = isSameDay(day, new Date());
          const currentMonth = day.getMonth() === referenceDate.getMonth();

          return (
            <div
              key={iso}
              onClick={() => onAdd(iso)}
              className={cn(
                'min-h-[110px] border-r border-b p-1 last:border-r-0 cursor-pointer hover:bg-muted/30 transition-colors',
                !currentMonth && 'bg-muted/20',
                today && 'bg-primary/5',
              )}
            >
              <div
                className={cn(
                  'text-xs font-medium mb-1',
                  today && 'text-primary font-bold',
                  !currentMonth && 'text-muted-foreground',
                )}
              >
                {format(day, 'd', { locale: ptBR })}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((visit) => {
                  const color = workerColor(visit.social_worker_name);
                  return (
                    <button
                      key={visit.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(visit);
                      }}
                      className={cn(
                        'w-full text-left text-[10px] rounded px-1 py-0.5 truncate border-l-2',
                        color.bg,
                        color.border,
                        visit.status === 'cancelada' && 'line-through opacity-60',
                        visit.status === 'remarcada' && 'opacity-60',
                      )}
                      title={`${visit.lead_name || 'Lead'} — ${visit.social_worker_name}`}
                    >
                      {fmtVisitTime(visit.visit_time)} {visit.lead_name || 'Lead'} ·{' '}
                      {shortWorkerName(visit.social_worker_name)}
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
