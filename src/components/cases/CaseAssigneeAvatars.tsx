// Avatares dos responsáveis do caso no cabeçalho do card da lista.
//
// Um caso PREV pode ter dois donos (administrativo e judicial), então aparecem
// até dois avatares sobrepostos. Caso sem responsável não renderiza nada — não
// vale poluir a linha dos funis que não usam esse campo.
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AssigneeInfo } from '@/hooks/useCaseAssignees';

interface Props {
  administrativo?: AssigneeInfo | null;
  judicial?: AssigneeInfo | null;
  className?: string;
}

function Bolinha({ info, papel }: { info: AssigneeInfo; papel: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar className="h-6 w-6 ring-2 ring-background">
          <AvatarFallback className="text-[9px] text-white" style={{ backgroundColor: info.color }}>
            {info.initials}
          </AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs">{info.name}</span>
        <span className="text-[10px] text-muted-foreground block">{papel}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function CaseAssigneeAvatars({ administrativo, judicial, className }: Props) {
  if (!administrativo && !judicial) return null;
  return (
    <div className={`flex items-center -space-x-1.5 shrink-0 ${className || ''}`}>
      {administrativo && <Bolinha info={administrativo} papel="Responsável administrativo" />}
      {judicial && <Bolinha info={judicial} papel="Responsável judicial" />}
    </div>
  );
}
