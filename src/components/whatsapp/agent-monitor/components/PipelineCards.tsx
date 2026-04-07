import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, MessageCircle, CheckCircle, XCircle, Eye, StopCircle, Sparkles, Clock, TrendingUp, FileSignature, Users, Briefcase, Scale, AlertTriangle, FileText, UserPlus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CaseStatus } from '../types';
import { statusLabel } from '../utils';
import type { DashboardMetrics, OperationalDetail } from '../hooks/useDashboardMetrics';
import type { OperationalMetricType } from './OperationalDetailSheet';
import type { OperationalGaps, GapType } from '../hooks/useOperationalGaps';

interface PipelineCardsProps {
  counts: Record<CaseStatus, number> & { novas?: number };
  activeStatus: CaseStatus | null;
  onToggle: (status: CaseStatus) => void;
  dashboardMetrics?: DashboardMetrics;
  onNewConvsClick?: () => void;
  onOperationalClick?: (type: OperationalMetricType) => void;
  gaps?: OperationalGaps;
  onGapClick?: (type: GapType) => void;
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

function groupByMember(details: OperationalDetail[]): { name: string; count: number }[] {
  const map = new Map<string, number>();
  details.forEach(d => {
    const key = d.acolhedor || d.instance_name || 'Sem atribuição';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

function MemberBreakdownPopover({ details, children }: { details: OperationalDetail[]; children: React.ReactNode }) {
  const members = groupByMember(details);
  if (members.length === 0) return <>{children}</>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="center">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Por Membro</p>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {members.map(m => (
            <div key={m.name} className="flex items-center justify-between text-xs">
              <span className="truncate flex-1 mr-2">{m.name}</span>
              <span className="font-bold">{m.count}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PipelineCards({ counts, activeStatus, onToggle, dashboardMetrics, onNewConvsClick, onOperationalClick, gaps, onGapClick }: PipelineCardsProps) {
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <MemberBreakdownPopover details={[...dashboardMetrics.signedDocsDetails, ...dashboardMetrics.pendingDocsDetails]}>
            <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('signed_docs')}>
              <CardContent className="p-3 text-center">
                <FileSignature className="h-4 w-4 mx-auto mb-1 text-violet-500" />
                <p className="text-xl font-bold">{dashboardMetrics.signedDocuments}</p>
                <p className="text-[10px] text-muted-foreground">Docs Assinados</p>
                {dashboardMetrics.pendingDocuments > 0 && (
                  <p className="text-[9px] text-amber-500 font-medium mt-0.5">{dashboardMetrics.pendingDocuments} pendente{dashboardMetrics.pendingDocuments > 1 ? 's' : ''}</p>
                )}
              </CardContent>
            </Card>
          </MemberBreakdownPopover>
          <MemberBreakdownPopover details={dashboardMetrics.groupsDetails}>
            <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('groups')}>
              <CardContent className="p-3 text-center">
                <Users className="h-4 w-4 mx-auto mb-1 text-cyan-500" />
                <p className="text-xl font-bold">{dashboardMetrics.groupsCreated}</p>
                <p className="text-[10px] text-muted-foreground">Grupos Criados</p>
              </CardContent>
            </Card>
          </MemberBreakdownPopover>
          <MemberBreakdownPopover details={dashboardMetrics.casesDetails}>
            <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('cases')}>
              <CardContent className="p-3 text-center">
                <Briefcase className="h-4 w-4 mx-auto mb-1 text-amber-600" />
                <p className="text-xl font-bold">{dashboardMetrics.casesCreated}</p>
                <p className="text-[10px] text-muted-foreground">Casos Criados</p>
              </CardContent>
            </Card>
          </MemberBreakdownPopover>
          <MemberBreakdownPopover details={dashboardMetrics.processesDetails}>
            <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('processes')}>
              <CardContent className="p-3 text-center">
                <Scale className="h-4 w-4 mx-auto mb-1 text-indigo-500" />
                <p className="text-xl font-bold">{dashboardMetrics.processesCreated}</p>
                <p className="text-[10px] text-muted-foreground">Processos Criados</p>
              </CardContent>
            </Card>
          </MemberBreakdownPopover>
          <MemberBreakdownPopover details={dashboardMetrics.contactsDetails}>
            <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => onOperationalClick?.('contacts')}>
              <CardContent className="p-3 text-center">
                <UserPlus className="h-4 w-4 mx-auto mb-1 text-emerald-500" />
                <p className="text-xl font-bold">{dashboardMetrics.contactsCreated}</p>
                <p className="text-[10px] text-muted-foreground">Contatos Criados</p>
              </CardContent>
            </Card>
          </MemberBreakdownPopover>
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

      {/* Operational Gaps row */}
      {gaps && (gaps.closedWithoutGroup.length > 0 || gaps.withGroupWithoutCase.length > 0 || gaps.casesWithoutProcess.length > 0 || gaps.processesWithoutActivity.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { key: 'closedWithoutGroup' as GapType, label: 'Fechados s/ Grupo', icon: Users, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-950/30' },
            { key: 'withGroupWithoutCase' as GapType, label: 'Grupo s/ Caso', icon: Briefcase, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/30' },
            { key: 'casesWithoutProcess' as GapType, label: 'Caso s/ Processo', icon: Scale, color: 'text-orange-500', bgColor: 'bg-orange-50 dark:bg-orange-950/30' },
            { key: 'processesWithoutActivity' as GapType, label: 'Processo s/ Atividade', icon: FileText, color: 'text-rose-500', bgColor: 'bg-rose-50 dark:bg-rose-950/30' },
          ]).map(({ key, label, icon: GapIcon, color, bgColor }) => {
            const count = gaps[key].length;
            if (count === 0) return null;
            return (
              <Card key={key} className={`cursor-pointer hover:shadow-md transition-all border-dashed ${bgColor}`} onClick={() => onGapClick?.(key)}>
                <CardContent className="p-3 text-center">
                  <AlertTriangle className={`h-3 w-3 mx-auto mb-0.5 ${color}`} />
                  <p className={`text-lg font-bold ${color}`}>{count}</p>
                  <p className="text-[9px] text-muted-foreground leading-tight">{label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Unified closing analysis card */}
      {dashboardMetrics && dashboardMetrics.closedTotal > 0 && (
        <Card>
          <CardContent className="p-3">
            {/* Header with totals */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold">{dashboardMetrics.closedTotal} Fechados</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-purple-500" />
                  <span className="font-bold text-purple-600">{dashboardMetrics.closedByAI}</span>
                  <span className="text-muted-foreground">IA ({dashboardMetrics.closedTotal > 0 ? Math.round((dashboardMetrics.closedByAI / dashboardMetrics.closedTotal) * 100) : 0}%)</span>
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3 text-blue-500" />
                  <span className="font-bold text-blue-600">{dashboardMetrics.closedWithHuman}</span>
                  <span className="text-muted-foreground">Humano ({dashboardMetrics.closedTotal > 0 ? Math.round((dashboardMetrics.closedWithHuman / dashboardMetrics.closedTotal) * 100) : 0}%)</span>
                </span>
              </div>
            </div>

            {/* Table with per-agent AI/Human breakdown */}
            {dashboardMetrics.closedByAgentDetailed.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Acolhedor</th>
                      <th className="text-center px-2 py-1.5 font-medium text-purple-500 whitespace-nowrap">🤖 IA</th>
                      <th className="text-center px-2 py-1.5 font-medium text-blue-500 whitespace-nowrap">👤 Humano</th>
                      <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardMetrics.closedByAgentDetailed.map(({ agent, ai, human, total }) => (
                      <tr key={agent} className="border-t border-border/50">
                        <td className="px-2 py-1.5 truncate max-w-[160px]">{agent}</td>
                        <td className="text-center px-2 py-1.5 font-bold text-purple-600">{ai}</td>
                        <td className="text-center px-2 py-1.5 font-bold text-blue-600">{human}</td>
                        <td className="text-center px-2 py-1.5 font-bold">{total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Campaigns sub-section */}
            {dashboardMetrics.closedByCampaign && dashboardMetrics.closedByCampaign.length > 0 && (
              <div className="mt-3 pt-2 border-t">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Por Campanha</p>
                <div className="space-y-1">
                  {dashboardMetrics.closedByCampaign.slice(0, 5).map(({ campaign, count }) => (
                    <div key={campaign} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1 mr-2">{campaign}</span>
                      <span className="font-bold text-green-600">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
