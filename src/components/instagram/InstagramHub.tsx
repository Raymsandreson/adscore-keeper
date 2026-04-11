import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, ChevronRight, Zap, Instagram,
  MessageCircle, MessagesSquare, Filter, Trophy,
  BarChart3, History, Target, Bot, Webhook,
  TrendingUp, ScrollText, Link2
} from 'lucide-react';
import { ImportFromSocialLinkDialog } from './ImportFromSocialLinkDialog';
import { useNavigate } from 'react-router-dom';

// Lazy-load tab content
import { ProspectingFunnel } from './ProspectingFunnel';
import { EngagementChampionship } from './EngagementChampionship';
import { CommentsDashboard } from './CommentsDashboard';
import { DmWorkflowHistory } from './DmWorkflowHistory';
import { EngagementGoals } from './EngagementGoals';
import { CommentsTracker } from './CommentsTracker';
import { AutoReplyRules } from './AutoReplyRules';
import { ManyChatSettings } from './ManyChatSettings';
import { N8nIntegrationSettings } from './N8nIntegrationSettings';
import { EngagementStats } from './EngagementStats';

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  accentColor: string;
  section: 'direct' | 'comments' | 'automation' | 'integrations';
}

const sections = [
  { id: 'direct', label: 'Direct & Funil' },
  { id: 'comments', label: 'Comentários' },
  { id: 'automation', label: 'Automação' },
  { id: 'integrations', label: 'Integrações' },
] as const;

const tabs: Tab[] = [
  {
    id: 'funnel',
    label: 'Funil de Prospecção',
    icon: <Filter className="h-5 w-5" />,
    description: 'Gerencie leads do Direct',
    badge: '🔥 Principal',
    badgeVariant: 'default',
    accentColor: 'text-violet-500',
    section: 'direct',
  },
  {
    id: 'dm-history',
    label: 'Histórico de DMs',
    icon: <History className="h-5 w-5" />,
    description: 'Conversas e workflows',
    accentColor: 'text-blue-500',
    section: 'direct',
  },
  {
    id: 'championship',
    label: 'Campeonato',
    icon: <Trophy className="h-5 w-5" />,
    description: 'Ranking de engajamento',
    badge: '🏆',
    badgeVariant: 'secondary',
    accentColor: 'text-amber-500',
    section: 'direct',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <BarChart3 className="h-5 w-5" />,
    description: 'Visão geral dos comentários',
    accentColor: 'text-emerald-500',
    section: 'comments',
  },
  {
    id: 'comments',
    label: 'Rastreador',
    icon: <MessageCircle className="h-5 w-5" />,
    description: 'Monitore e responda comentários',
    accentColor: 'text-pink-500',
    section: 'comments',
  },
  {
    id: 'goals',
    label: 'Metas',
    icon: <Target className="h-5 w-5" />,
    description: 'Metas de engajamento',
    accentColor: 'text-orange-500',
    section: 'comments',
  },
  {
    id: 'stats',
    label: 'Estatísticas',
    icon: <TrendingUp className="h-5 w-5" />,
    description: 'Métricas e tendências',
    accentColor: 'text-cyan-500',
    section: 'comments',
  },
  {
    id: 'automation',
    label: 'Respostas Auto',
    icon: <Bot className="h-5 w-5" />,
    description: 'Regras de resposta automática',
    badge: '✨ IA',
    badgeVariant: 'default',
    accentColor: 'text-violet-500',
    section: 'automation',
  },
  {
    id: 'manychat',
    label: 'ManyChat',
    icon: <MessagesSquare className="h-5 w-5" />,
    description: 'Integração com ManyChat',
    accentColor: 'text-blue-500',
    section: 'integrations',
  },
  {
    id: 'n8n',
    label: 'n8n',
    icon: <Webhook className="h-5 w-5" />,
    description: 'Webhooks e automações',
    accentColor: 'text-emerald-500',
    section: 'integrations',
  },
];

export function InstagramHub() {
  const [activeTab, setActiveTab] = useState('funnel');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const navigate = useNavigate();

  const activeTabData = tabs.find(t => t.id === activeTab);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Instagram className="h-5 w-5 text-pink-500" />
          <h1 className="text-lg font-semibold">Instagram</h1>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Sidebar - desktop */}
        <aside className="w-64 border-r bg-muted/30 overflow-y-auto shrink-0 hidden md:flex md:flex-col">
          <nav className="p-3 space-y-1 flex-1">
            {sections.map((section) => {
              const sectionTabs = tabs.filter(t => t.section === section.id);
              return (
                <div key={section.id}>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider px-3 mb-2 mt-3 first:mt-0">
                    {section.label}
                  </p>
                  {sectionTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group',
                        activeTab === tab.id
                          ? 'bg-primary/10 text-primary shadow-sm border border-primary/20'
                          : 'hover:bg-muted/80 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <div className={cn(
                        'shrink-0 transition-colors',
                        activeTab === tab.id ? 'text-primary' : tab.accentColor
                      )}>
                        {tab.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{tab.label}</span>
                          {tab.badge && (
                            <Badge variant={tab.badgeVariant || 'secondary'} className="text-[9px] h-4 px-1.5 shrink-0">
                              {tab.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {tab.description}
                        </p>
                      </div>
                      <ChevronRight className={cn(
                        'h-4 w-4 shrink-0 transition-transform',
                        activeTab === tab.id ? 'text-primary rotate-90' : 'text-muted-foreground/40'
                      )} />
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>

          {/* Tip */}
          <div className="mx-3 mb-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold text-primary">Dica Pro</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Use o Funil de Prospecção para organizar leads do Direct e acompanhe os comentários para engajar sua audiência.
            </p>
          </div>
        </aside>

        {/* Mobile horizontal tabs */}
        <div className="md:hidden border-b bg-muted/30 shrink-0 w-full z-10 overflow-x-auto">
          <div className="flex p-2 gap-1 min-w-max">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all',
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4 md:p-6 max-w-4xl mx-auto w-full pt-4 md:pt-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {activeTabData?.icon}
                {activeTabData?.label}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTabData?.description}
              </p>
            </div>

            {activeTab === 'funnel' && <ProspectingFunnel />}
            {activeTab === 'championship' && <EngagementChampionship />}
            {activeTab === 'dashboard' && <CommentsDashboard />}
            {activeTab === 'dm-history' && <DmWorkflowHistory />}
            {activeTab === 'goals' && <EngagementGoals />}
            {activeTab === 'comments' && <CommentsTracker isConnected={false} />}
            {activeTab === 'automation' && <AutoReplyRules />}
            {activeTab === 'manychat' && <ManyChatSettings />}
            {activeTab === 'n8n' && <N8nIntegrationSettings />}
            {activeTab === 'stats' && <EngagementStats />}
          </div>
        </main>
      </div>
    </div>
  );
}
