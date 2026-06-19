import { AlertTriangle, Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Hearing } from '@/hooks/useHearings';
import { categoryClasses, fmtTime, statusBadgeClass, STATUS_LABELS } from './hearingStyles';

interface Props {
  hearing: Hearing;
  onClick?: () => void;
  compact?: boolean;
}

export function HearingCard({ hearing, onClick, compact }: Props) {
  const c = categoryClasses(hearing.category);
  const dimmed = hearing.status === 'cancelada' || hearing.status === 'adiada';
  const struck = hearing.status === 'cancelada';
  const hasAlert = !!(hearing.notes && hearing.notes.trim().length > 0);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full text-left rounded-md border-l-4 p-2 transition-all hover:shadow-md hover:-translate-y-0.5',
        c.bg,
        c.border,
        dimmed && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className={cn('flex-1 min-w-0', struck && 'line-through')}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {hearing.case_ref && (
              <span className={cn('text-xs font-bold uppercase tracking-wide', c.text)}>
                {hearing.case_ref}
              </span>
            )}
            {hearing.hearing_time && (
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground">
                <Clock className="h-3 w-3" /> {fmtTime(hearing.hearing_time)}
              </span>
            )}
          </div>
          {hearing.hearing_type && (
            <div className={cn('text-xs mt-0.5', compact ? 'truncate' : '')}>{hearing.hearing_type}</div>
          )}
          {!compact && hearing.process_number && (
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
              {hearing.process_number}
            </div>
          )}
          {!compact && hearing.location && (
            <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-0.5">
              <MapPin className="h-3 w-3" /> {hearing.location}
            </div>
          )}
          {hearing.timezone_label && hearing.timezone_label !== 'Padrão Brasília' && (
            <div className="text-[10px] italic text-muted-foreground mt-0.5">{hearing.timezone_label}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {hasAlert && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs whitespace-pre-wrap">
                  {hearing.notes}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {hearing.status !== 'ativa' && (
            <Badge variant="outline" className={cn('text-[9px] px-1 py-0 h-4', statusBadgeClass(hearing.status))}>
              {STATUS_LABELS[hearing.status]}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
