/** Lista corrida — serve para conferência e para achar visita fora da semana aberta. */
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { PanelRightOpen, StickyNote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SocialVisit } from '@/hooks/useSocialVisits';
import { VISIT_STATUS_LABELS, fmtVisitTime, visitStatusBadgeClass, workerColor } from './visitStyles';
import { cn } from '@/lib/utils';

interface Props {
  visits: SocialVisit[];
  onSelect: (visit: SocialVisit) => void;
  onOpenLead: (leadId: string) => void;
}

export function SocialVisitListView({ visits, onSelect, onOpenLead }: Props) {
  if (visits.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground border rounded-lg">
        Nenhuma visita no período.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Hora</TableHead>
            <TableHead>Lead</TableHead>
            <TableHead>Assistente social</TableHead>
            <TableHead>Local</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[90px]">Obs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visits.map((visit) => {
            const color = workerColor(visit.social_worker_name);
            const canceled = visit.status === 'cancelada';
            return (
              <TableRow
                key={visit.id}
                onClick={() => onSelect(visit)}
                className={cn('cursor-pointer', canceled && 'opacity-60 line-through')}
              >
                <TableCell className="whitespace-nowrap">
                  {format(parseISO(visit.visit_date), "dd/MM/yyyy", { locale: ptBR })}
                  <div className="text-[10px] text-muted-foreground capitalize">
                    {format(parseISO(visit.visit_date), 'EEEE', { locale: ptBR })}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{fmtVisitTime(visit.visit_time) || '—'}</TableCell>
                <TableCell className="font-medium max-w-[280px] truncate">
                  {visit.lead_name || 'Lead sem nome'}
                </TableCell>
                <TableCell>
                  <span className={cn('inline-flex items-center gap-1.5 text-xs', color.text)}>
                    <span className={cn('w-2 h-2 rounded-full shrink-0', color.dot)} />
                    {visit.social_worker_name}
                  </span>
                  {visit.social_worker_phone && (
                    <div className="text-[10px] text-muted-foreground">{visit.social_worker_phone}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs max-w-[220px] truncate">
                  {[visit.city, visit.state].filter(Boolean).join('/') || '—'}
                  {visit.address && (
                    <div className="text-[10px] text-muted-foreground truncate">{visit.address}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-xs', visitStatusBadgeClass(visit.status))}>
                    {VISIT_STATUS_LABELS[visit.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {visit.notes?.trim() ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <StickyNote className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs whitespace-pre-wrap">
                            {visit.notes}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : null}
                    <button
                      type="button"
                      title="Abrir lead"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenLead(visit.lead_id);
                      }}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
