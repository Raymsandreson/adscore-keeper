import { useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Hearing } from '@/hooks/useHearings';
import { HearingCard } from './HearingCard';
import { Button } from '@/components/ui/button';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  hearings: Hearing[];
  date: Date;
  onChangeDate: (d: Date) => void;
  onSelect: (h: Hearing) => void;
  onAdd: (dateISO: string) => void;
}

export function HearingDayView({ hearings, date, onChangeDate, onSelect, onAdd }: Props) {
  const iso = format(date, 'yyyy-MM-dd');
  const items = useMemo(
    () => hearings.filter((h) => h.hearing_date === iso),
    [hearings, iso],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => onChangeDate(new Date(date.getTime() - 86400000))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-lg font-semibold capitalize">
            {format(date, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </div>
          <Button variant="outline" size="icon" onClick={() => onChangeDate(new Date(date.getTime() + 86400000))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={() => onAdd(iso)} size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          Nenhuma audiência neste dia.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((h) => <HearingCard key={h.id} hearing={h} onClick={() => onSelect(h)} />)}
        </div>
      )}
    </div>
  );
}
