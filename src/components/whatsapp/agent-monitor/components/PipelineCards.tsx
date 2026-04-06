import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, MessageCircle, CheckCircle, XCircle, Eye, StopCircle, Sparkles, Clock, TrendingUp, FileSignature, Users, Briefcase, Scale } from 'lucide-react';
import type { CaseStatus } from '../types';
import { statusLabel } from '../utils';
import type { DashboardMetrics } from '../hooks/useDashboardMetrics';

import type { OperationalMetricType } from './OperationalDetailSheet';

interface PipelineCardsProps {
  counts: Record<CaseStatus, number> & { novas?: number };
  activeStatus: CaseStatus | null;
  onToggle: (status: CaseStatus) => void;
  dashboardMetrics?: DashboardMetrics;
  onNewConvsClick?: () => void;
  onOperationalClick?: (type: OperationalMetricType) => void;
}

const statusConfig: { key: CaseStatus; icon: typeof AlertCircle; color: string }[] = [
  { key: 'sem_resposta', icon: AlertCircle, color: 'text-amber-500' },
  { key: 'em_andamento', icon: MessageCircle, color: 'text-blue-500' },
  { key: 'fechado', icon: CheckCircle, color: 'text-green-500' },
  { key: 'recusado', icon: XCircle, color: 'text-red-500' },
  { key: 'inviavel', icon: Eye, color: 'text-muted-foreground' },
  { key: 'bloqueado', icon: StopCircle, color: 'text-orange-500' },
];

function formatTime(minutes: number): string {
  if (minutes < 0) return '0min';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function PipelineCards({ counts, activeStatus, onToggle, dashboardMetrics, onNewConvsClick, onOperationalClick }: PipelineCardsProps) {
  const newConvs = dashboardMetrics?.newConversations ?? counts.novas ?? 0;
  const responseRate = dashboardMetrics?.responseRate ?? 0;
  const avgTime = dashboardMetrics?.avgResponseTimeMin ?? 0;

  return (
    <div className="space-y-2">
      {/* Dashboard metrics row - 3 KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <Card
          className="border-dashed border-primary/30 bg-primary/5 cursor-pointer hover:shadow-md transition-all"
          onClick={onNewConvsClick}
        >
          <CardContent className="p-3 text-center">
            <Sparkles className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-xl font-bold">{newConvs}</p>
            <p className="text-[10px] text-muted-foreground">Conversas Novas</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto mb-1 text-green-500" />
            <p className="text-xl font-bold">{responseRate}%</p>
            <p className="text-[10px] text-muted-foreground">Taxa Resposta</p>
            {dashboardMetrics && (
              <p className="text-[9px] text-muted-foreground">{dashboardMetrics.respondedCount}/{dashboardMetrics.totalInbound}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-4 w-4 mx-auto mb-1 text-blue-500" />
            <p className="text-xl font-bold">{formatTime(avgTime)}</p>
            <p className="text-[10px] text-muted-foreground">Tempo Médio</p>
            <p className="text-[9px] text-muted-foreground">1ª resposta</p>
          </CardContent>
        </Card>
      </div>

      {/* Operational metrics row */}
      {dashboardMetrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('signed_docs')}>
            <CardContent className="p-3 text-center">
              <FileSignature className="h-4 w-4 mx-auto mb-1 text-violet-500" />
              <p className="text-xl font-bold">{dashboardMetrics.signedDocuments}</p>
              <p className="text-[10px] text-muted-foreground">Docs Assinados</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('groups')}>
            <CardContent className="p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-cyan-500" />
              <p className="text-xl font-bold">{dashboardMetrics.groupsCreated}</p>
              <p className="text-[10px] text-muted-foreground">Grupos Criados</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('cases')}>
            <CardContent className="p-3 text-center">
              <Briefcase className="h-4 w-4 mx-auto mb-1 text-amber-600" />
              <p className="text-xl font-bold">{dashboardMetrics.casesCreated}</p>
              <p className="text-[10px] text-muted-foreground">Casos Criados</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('processes')}>
            <CardContent className="p-3 text-center">
              <Scale className="h-4 w-4 mx-auto mb-1 text-indigo-500" />
              <p className="text-xl font-bold">{dashboardMetrics.processesCreated}</p>
              <p className="text-[10px] text-muted-foreground">Processos Criados</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pipeline status row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
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

      {/* Closing analysis - derived from filtered conversations */}
      {dashboardMetrics && dashboardMetrics.closedByAgent.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Fechamentos por Acolhedor</p>
              <div className="space-y-1">
                {dashboardMetrics.closedByAgent.slice(0, 5).map(({ agent, count }) => (
                  <div key={agent} className="flex items-center justify-between text-xs">
                    <span className="truncate flex-1 mr-2">{agent}</span>
                    <span className="font-bold text-green-600">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          {dashboardMetrics.closedByCampaign && dashboardMetrics.closedByCampaign.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Fechamentos por Campanha</p>
                <div className="space-y-1">
                  {dashboardMetrics.closedByCampaign.slice(0, 5).map(({ campaign, count }) => (
                    <div key={campaign} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1 mr-2">{campaign}</span>
                      <span className="font-bold text-green-600">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
