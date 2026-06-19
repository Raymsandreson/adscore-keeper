import { format, parseISO } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Hearing } from '@/hooks/useHearings';
import { CATEGORY_LABELS, STATUS_LABELS, categoryClasses, fmtTime, statusBadgeClass } from './hearingStyles';
import { cn } from '@/lib/utils';

interface Props { hearings: Hearing[]; onSelect: (h: Hearing) => void }

export function HearingListView({ hearings, onSelect }: Props) {
  if (hearings.length === 0) {
    return <div className="text-center py-16 text-muted-foreground border rounded-lg">Nenhuma audiência.</div>;
  }
  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Hora</TableHead>
            <TableHead>Caso</TableHead>
            <TableHead>Processo</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Obs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hearings.map((h) => {
            const c = categoryClasses(h.category);
            const struck = h.status === 'cancelada';
            const dimmed = struck || h.status === 'adiada';
            return (
              <TableRow
                key={h.id}
                onClick={() => onSelect(h)}
                className={cn('cursor-pointer', dimmed && 'opacity-60', struck && 'line-through')}
              >
                <TableCell>{format(parseISO(h.hearing_date), 'dd/MM/yyyy')}</TableCell>
                <TableCell>
                  {fmtTime(h.hearing_time)}
                  {h.timezone_label && h.timezone_label !== 'Padrão Brasília' && (
                    <div className="text-[10px] italic text-muted-foreground">{h.timezone_label}</div>
                  )}
                </TableCell>
                <TableCell className="font-semibold">{h.case_ref || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{h.process_number || '—'}</TableCell>
                <TableCell>{h.hearing_type || '—'}</TableCell>
                <TableCell>
                  <span className={cn('inline-flex items-center gap-1.5 text-xs', c.text)}>
                    <span className={cn('w-2 h-2 rounded-full', c.dot)} />
                    {CATEGORY_LABELS[h.category]}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-xs', statusBadgeClass(h.status))}>
                    {STATUS_LABELS[h.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {h.notes && h.notes.trim() ? <AlertTriangle className="h-4 w-4 text-warning" /> : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
