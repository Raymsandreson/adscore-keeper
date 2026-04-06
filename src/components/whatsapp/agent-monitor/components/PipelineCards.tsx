import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, MessageCircle, CheckCircle, XCircle, Eye, StopCircle, Sparkles } from 'lucide-react';
import type { CaseStatus } from '../types';
import { statusLabel } from '../utils';

interface PipelineCardsProps {
  counts: Record<CaseStatus, number> & { novas?: number };
  activeStatus: CaseStatus | null;
  onToggle: (status: CaseStatus) => void;
}

const statusConfig: { key: CaseStatus; icon: typeof AlertCircle; color: string }[] = [
  { key: 'sem_resposta', icon: AlertCircle, color: 'text-amber-500' },
  { key: 'em_andamento', icon: MessageCircle, color: 'text-blue-500' },
  { key: 'fechado', icon: CheckCircle, color: 'text-green-500' },
  { key: 'recusado', icon: XCircle, color: 'text-red-500' },
  { key: 'inviavel', icon: Eye, color: 'text-muted-foreground' },
  { key: 'bloqueado', icon: StopCircle, color: 'text-orange-500' },
];

export function PipelineCards({ counts, activeStatus, onToggle }: PipelineCardsProps) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
      {/* Conversas Novas card */}
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="p-3 text-center">
          <Sparkles className="h-4 w-4 mx-auto mb-1 text-primary" />
          <p className="text-xl font-bold">{counts.novas ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">Novas Hoje</p>
        </CardContent>
      </Card>

      {statusConfig.map(({ key, icon: Icon, color }) => (
        <Card
          key={key}
          className={`cursor-pointer hover:shadow-md transition-all ${activeStatus === key ? 'ring-2 ring-primary' : ''}`}
          onClick={() => onToggle(key)}
        >
          <CardContent className="p-3 text-center">
            <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
            <p className="text-xl font-bold">{counts[key]}</p>
            <p className="text-[10px] text-muted-foreground">{statusLabel(key)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
