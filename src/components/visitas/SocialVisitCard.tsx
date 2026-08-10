/**
 * Card de uma visita. Mostra sempre os três dados que a agenda existe para
 * responder: quando (data/hora), quem é visitado (lead) e quem visita
 * (assistente social). A faixa colorida à esquerda é da assistente social, para
 * a semana ser lida por pessoa de relance.
 */
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock, MapPin, StickyNote, UserRound, PanelRightOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SocialVisit } from '@/hooks/useSocialVisits';
import {
  VISIT_STATUS_LABELS,
  fmtVisitTime,
  shortWorkerName,
  visitStatusBadgeClass,
  workerColor,
} from './visitStyles';
import { cn } from '@/lib/utils';

interface Props {
  visit: SocialVisit;
  /** Abre a edição do agendamento. */
  onSelect: () => void;
  /** Abre o lead em painel lateral, por cima da agenda. */
  onOpenLead?: () => void;
  /** Fora do calendário (lista, aba do lead) a data precisa aparecer no card. */
  showDate?: boolean;
  compact?: boolean;
}

export function SocialVisitCard({ visit, onSelect, onOpenLead, showDate, compact }: Props) {
  const color = workerColor(visit.social_worker_name);
  const canceled = visit.status === 'cancelada';
  const dimmed = canceled || visit.status === 'remarcada';
  const place = [visit.city, visit.state].filter(Boolean).join('/');
  const time = fmtVisitTime(visit.visit_time);

  return (
    <div
      className={cn(
        'group relative rounded-md border border-l-4 bg-card transition-all hover:shadow-md',
        color.bg,
        color.border,
        dimmed && 'opacity-70',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        title="Editar agendamento"
        className="w-full text-left p-2"
      >
        <div className="flex items-start justify-between gap-1.5">
          <div className={cn('min-w-0 flex-1', canceled && 'line-through')}>
            <div className="flex items-center gap-1.5 flex-wrap">
              {showDate && (
                <span className="text-xs font-bold text-foreground">
                  {format(parseISO(visit.visit_date), "dd/MM 'de' EEE", { locale: ptBR })}
                </span>
              )}
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-foreground">
                <Clock className="h-3 w-3" /> {time || 'sem hora'}
              </span>
            </div>

            <div className="text-xs font-medium text-foreground mt-1 truncate">
              {visit.lead_name || 'Lead sem nome'}
            </div>

            <div className={cn('text-[11px] mt-0.5 inline-flex items-center gap-1 truncate', color.text)}>
              <UserRound className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {compact ? shortWorkerName(visit.social_worker_name) : visit.social_worker_name}
              </span>
            </div>

            {place && (
              <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-0.5 truncate">
                <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{place}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            {visit.status !== 'agendada' && (
              <Badge
                variant="outline"
                className={cn('text-[9px] px-1 py-0 h-4', visitStatusBadgeClass(visit.status))}
              >
                {VISIT_STATUS_LABELS[visit.status]}
              </Badge>
            )}
            {visit.notes?.trim() && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs whitespace-pre-wrap">
                    {visit.notes}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </button>

      {onOpenLead && (
        <div className="flex justify-end border-t border-border/50 px-2 py-1">
          <button
            type="button"
            onClick={onOpenLead}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
          >
            <PanelRightOpen className="h-3 w-3" /> abrir lead
          </button>
        </div>
      )}
    </div>
  );
}
