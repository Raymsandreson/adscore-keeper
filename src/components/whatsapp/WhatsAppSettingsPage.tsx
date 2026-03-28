import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  Webhook, BarChart3, Megaphone, ArrowLeft, 
  ChevronRight, Shield, Zap, ScrollText, Sparkles, Smartphone, Bell, Volume2, Users, Network, Brain
} from 'lucide-react';

import { WhatsAppSetupGuide } from './WhatsAppSetupGuide';
import { WhatsAppReportSettings } from './WhatsAppReportSettings';
import { WhatsAppAdLinkSettings } from './WhatsAppAdLinkSettings';

import { WebhookLogsViewer } from './WebhookLogsViewer';
import { WhatsAppCommandConfig } from './WhatsAppCommandConfig';
import { WhatsAppInstanceManager } from './WhatsAppInstanceManager';
import { WhatsAppNotificationSettings } from './WhatsAppNotificationSettings';
import { VoiceSettings } from '@/components/voice/VoiceSettings';
import { BoardGroupInstancesConfig } from './BoardGroupInstancesConfig';
import { NucleiSettings } from './NucleiSettings';
import { AgentAutomationsTab } from './AgentAutomationsTab';
import { EnrichmentSettings } from '@/components/settings/EnrichmentSettings';

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  accentColor: string;
}

const tabs: Tab[] = [
  {
    id: 'instances',
    label: 'Instâncias',
    icon: <Smartphone className="h-5 w-5" />,
    description: 'Criar e gerenciar números',
    badge: '🆕 Novo',
    badgeVariant: 'default',
    accentColor: 'text-green-500',
  },
  {
    id: 'commands',
    label: 'Agentes IA',
    icon: <Sparkles className="h-5 w-5" />,
    description: 'Agentes IA e IA Interna',
    badge: '✨ IA',
    badgeVariant: 'default',
    accentColor: 'text-pink-500',
  },
  {
    id: 'voice',
    label: 'Voz (TTS)',
    icon: <Volume2 className="h-5 w-5" />,
    description: 'Escolha ou clone sua voz',
    badge: '🆕 Novo',
    badgeVariant: 'default',
    accentColor: 'text-cyan-500',
  },
  {
    id: 'notifications',
    label: 'Notificações',
    icon: <Bell className="h-5 w-5" />,
    description: 'Metas, rotinas e acompanhamento',
    badge: '🆕 Novo',
    badgeVariant: 'default',
    accentColor: 'text-yellow-500',
  },
  {
    id: 'reports',
    label: 'Relatórios',
    icon: <BarChart3 className="h-5 w-5" />,
    description: 'Automatize envios periódicos',
    accentColor: 'text-blue-500',
  },
  {
    id: 'ads',
    label: 'Anúncios',
    icon: <Megaphone className="h-5 w-5" />,
    description: 'Vincule instâncias a contas de anúncios',
    accentColor: 'text-orange-500',
  },
  {
    id: 'groups',
    label: 'Grupos',
    icon: <Users className="h-5 w-5" />,
    description: 'Instâncias para criação automática de grupos',
    badge: '🆕 Novo',
    badgeVariant: 'default',
    accentColor: 'text-violet-500',
  },
  {
    id: 'automations',
    label: 'Automações',
    icon: <Zap className="h-5 w-5" />,
    description: 'Automações por agente IA',
    badge: '⚡ Novo',
    badgeVariant: 'default',
    accentColor: 'text-amber-500',
  },
  {
    id: 'enrichment',
    label: 'Enriquecimento IA',
    icon: <Brain className="h-5 w-5" />,
    description: 'Extração automática de dados',
    badge: '🧠 IA',
    badgeVariant: 'default',
    accentColor: 'text-indigo-500',
  },
  {
    id: 'nuclei',
    label: 'Núcleos',
    icon: <Network className="h-5 w-5" />,
    description: 'Criar e gerenciar núcleos especializados',
    badge: '🆕 Novo',
    badgeVariant: 'default',
    accentColor: 'text-rose-500',
  },
  {
    id: 'integration',
    label: 'Integração',
    icon: <Webhook className="h-5 w-5" />,
    description: 'Webhooks, payload e n8n',
    accentColor: 'text-emerald-500',
  },
  {
    id: 'logs',
    label: 'Logs do Sistema',
    icon: <ScrollText className="h-5 w-5" />,
    description: 'Payloads recebidos e erros',
    badge: '🔍 Debug',
    badgeVariant: 'outline',
    accentColor: 'text-amber-500',
  },
];

interface Props {
  onBack: () => void;
  initialTab?: string;
}

export function WhatsAppSettingsPage({ onBack, initialTab = 'instances' }: Props) {
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Configurações</h1>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Sidebar - lateral tabs (desktop) */}
        <aside className="w-64 border-r bg-muted/30 overflow-y-auto shrink-0 hidden md:flex md:flex-col">
          <nav className="p-3 space-y-1 flex-1">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider px-3 mb-3">
              WhatsApp
            </p>
            {tabs.map((tab) => (
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
          </nav>

          {/* Social proof / Bandwagon Effect */}
          <div className="mx-3 mb-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold text-primary">Dica Pro</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Configure Agentes IA para responder leads automaticamente e aumente em até 3x sua taxa de conversão.
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
          <div className="p-4 md:p-6 max-w-3xl mx-auto w-full pt-4 md:pt-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {tabs.find(t => t.id === activeTab)?.icon}
                {tabs.find(t => t.id === activeTab)?.label}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {tabs.find(t => t.id === activeTab)?.description}
              </p>
            </div>

            {activeTab === 'instances' && <WhatsAppInstanceManager />}
            
            {activeTab === 'commands' && <WhatsAppCommandConfig />}
            {activeTab === 'notifications' && (
              <div className="space-y-6">
                <WhatsAppNotificationSettings />
              </div>
            )}
            {activeTab === 'voice' && <VoiceSettings />}
            {activeTab === 'reports' && <WhatsAppReportSettings />}
            {activeTab === 'ads' && <WhatsAppAdLinkSettings />}
            {activeTab === 'groups' && <BoardGroupInstancesConfig />}
            {activeTab === 'automations' && <AgentAutomationsTab />}
            {activeTab === 'nuclei' && <NucleiSettings />}
            {activeTab === 'enrichment' && <EnrichmentSettings />}
            {activeTab === 'integration' && <WhatsAppSetupGuide />}
            {activeTab === 'logs' && <WebhookLogsViewer />}
          </div>
        </main>
      </div>
    </div>
  );
}
