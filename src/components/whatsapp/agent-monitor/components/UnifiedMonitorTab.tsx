import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Zap, PhoneCall, Sparkles, Radio } from 'lucide-react';
import type { AgentStats, AgentData, BoardData, ConversationDetail, CaseStatus } from '../types';
import { PipelineCards } from './PipelineCards';
import { MonitorFilterBar } from './MonitorFilterBar';
import { CallQueuePanel } from '../../CallQueuePanel';
import { FollowupActivityPanel } from '../../FollowupActivityPanel';
import { AIEnrichmentMonitorPanel } from '../../AIEnrichmentMonitorPanel';
import { AIRealtimeFeed } from '../../AIRealtimeFeed';

interface UnifiedMonitorTabProps {
  conversations: ConversationDetail[];
  agentStats: AgentStats[];
  loading: boolean;
  pipelineCounts: Record<CaseStatus, number>;
  onPipelineClick: (status: CaseStatus) => void;
  activeStatus: CaseStatus | null;
  onOpenChat: (c: ConversationDetail) => void;
  onEventClick: (event: any) => void;
  filterBarProps: {
    agents: AgentData[];
    uniqueInstances: string[];
    uniqueBoards: BoardData[];
    uniqueCampaigns: string[];
    agentFilter: string;
    setAgentFilter: (v: string) => void;
    instanceFilter: string;
    setInstanceFilter: (v: string) => void;
    boardFilter: string;
    setBoardFilter: (v: string) => void;
    campaignFilter: string;
    setCampaignFilter: (v: string) => void;
    agentActiveFilter: 'all' | 'ativo' | 'pausado';
    setAgentActiveFilter: (v: 'all' | 'ativo' | 'pausado') => void;
    followupConfigFilter: 'all' | 'com_followup' | 'sem_followup';
    setFollowupConfigFilter: (v: 'all' | 'com_followup' | 'sem_followup') => void;
  };
}

export function UnifiedMonitorTab({
  conversations, agentStats, loading,
  pipelineCounts, onPipelineClick, activeStatus,
  onOpenChat, onEventClick,
}: UnifiedMonitorTabProps) {
  return (
    <div className="space-y-4">
      {/* Pipeline Cards */}
      <PipelineCards counts={pipelineCounts} activeStatus={activeStatus} onToggle={onPipelineClick} />

      {/* Sub-tabs */}
      <Tabs defaultValue="feed" className="space-y-3">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 max-w-2xl">
          <TabsTrigger value="feed" className="text-xs"><Radio className="h-3 w-3 mr-1" />Tempo Real</TabsTrigger>
          <TabsTrigger value="overview" className="text-xs"><Bot className="h-3 w-3 mr-1" />Por Agente</TabsTrigger>
          <TabsTrigger value="followups" className="text-xs"><Zap className="h-3 w-3 mr-1" />Follow-ups</TabsTrigger>
          <TabsTrigger value="call-queue" className="text-xs"><PhoneCall className="h-3 w-3 mr-1" />Ligações</TabsTrigger>
          <TabsTrigger value="ai-data" className="text-xs"><Sparkles className="h-3 w-3 mr-1" />IA Dados</TabsTrigger>
        </TabsList>

        <TabsContent value="feed">
          <AIRealtimeFeed onEventClick={onEventClick} />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agentStats.filter(s => s.total_conversations > 0).map(stat => (
              <Card key={stat.agent_id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{stat.agent_name}</span>
                    <Badge variant="secondary" className="text-[10px]">{stat.total_conversations} conversas</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-green-50 dark:bg-green-950 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-green-600">{stat.active_conversations}</p>
                      <p className="text-[9px] text-green-600/70">Ativas</p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-amber-600">{stat.paused_conversations}</p>
                      <p className="text-[9px] text-amber-600/70">Pausadas</p>
                    </div>
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-muted-foreground">{stat.inactive_conversations}</p>
                      <p className="text-[9px] text-muted-foreground">Inativas</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Msgs enviadas</span><span className="font-medium">{stat.total_messages_sent}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Msgs recebidas</span><span className="font-medium">{stat.total_messages_received}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Follow-ups</span><span className="font-medium">{stat.followups_sent}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Taxa resposta</span><span className="font-medium">{stat.response_rate}%</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">↗ Fechados</span><span className="font-medium text-green-600">{stat.leads_closed}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">↘ Recusados</span><span className="font-medium text-red-600">{stat.leads_refused}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Sem resposta (&gt;1h)</span><span className="font-medium text-amber-600">{stat.without_response_count}</span></div>
                  </div>
                  {Object.keys(stat.conversations_by_stage).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase">Por Etapa</p>
                      {Object.entries(stat.conversations_by_stage).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([stage, count]) => (
                        <div key={stage} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground truncate flex-1">{stage}</span>
                          <Progress value={(count / stat.total_conversations) * 100} className="w-16 h-1.5" />
                          <span className="text-[10px] font-medium w-6 text-right">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {agentStats.filter(s => s.total_conversations > 0).length === 0 && !loading && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhuma conversa de agente encontrada no período</p>
              </div>
            )}
          </div>
        </TabsContent>


        <TabsContent value="followups"><FollowupActivityPanel /></TabsContent>
        <TabsContent value="call-queue">
          <CallQueuePanel onSelectConversation={(phone, instanceName, contactName) => {
            onOpenChat({ phone, instance_name: instanceName, contact_name: contactName || '' } as any);
          }} />
        </TabsContent>
        <TabsContent value="ai-data"><AIEnrichmentMonitorPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
