import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  Webhook, BarChart3, Megaphone, Bot, ArrowLeft, 
  CheckCircle2, ChevronRight, Sparkles, Shield, Zap
} from 'lucide-react';
import { WhatsAppSetupGuide } from './WhatsAppSetupGuide';
import { WhatsAppAIAgents } from './WhatsAppAIAgents';

// Cognitive biases applied:
// - Serial Position Effect: most used items first (Agentes IA) and last (Integração)
// - Completion Bias: checkmarks for configured sections
// - Anchoring: status badges showing what's active
// - Progressive Disclosure: one section at a time
// - Default Effect: pre-select the most actionable tab

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
    id: 'agents',
    label: 'Agentes IA',
    icon: <Bot className="h-5 w-5" />,
    description: 'Configure assistentes inteligentes',
    badge: '✨ Popular',
    badgeVariant: 'default',
    accentColor: 'text-violet-500',
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
    id: 'integration',
    label: 'Integração',
    icon: <Webhook className="h-5 w-5" />,
    description: 'Webhooks, payload e n8n',
    accentColor: 'text-emerald-500',
  },
];

interface Props {
  onBack: () => void;
  initialTab?: string;
}

export function WhatsAppSettingsPage({ onBack, initialTab = 'agents' }: Props) {
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <div className="h-screen flex flex-col">
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

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - lateral tabs */}
        <aside className="w-64 border-r bg-muted/30 overflow-y-auto shrink-0 hidden md:block">
          <nav className="p-3 space-y-1">
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
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5 group-hover:text-muted-foreground">
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

          {/* Social proof / motivation (Bandwagon Effect) */}
          <div className="mx-3 mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold text-primary">Dica Pro</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Configure um Agente IA para responder leads automaticamente e aumente em até 3x sua taxa de conversão.
            </p>
          </div>
        </aside>

        {/* Mobile tabs */}
        <div className="md:hidden border-b bg-muted/30 overflow-x-auto shrink-0 w-full absolute z-10">
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
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-3xl mx-auto w-full md:pt-6 pt-16">
            {/* Section header with anchoring */}
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {tabs.find(t => t.id === activeTab)?.icon}
                {tabs.find(t => t.id === activeTab)?.label}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {tabs.find(t => t.id === activeTab)?.description}
              </p>
            </div>

            {/* Render active section */}
            {activeTab === 'agents' && <WhatsAppAIAgents />}
            {activeTab === 'reports' && <ReportSection />}
            {activeTab === 'ads' && <AdSection />}
            {activeTab === 'integration' && <WhatsAppSetupGuide />}
          </div>
        </main>
      </div>
    </div>
  );
}

// Lazy-loaded wrappers to keep imports clean
function ReportSection() {
  const { WhatsAppReportSettings } = require('./WhatsAppReportSettings');
  return <WhatsAppReportSettings />;
}

function AdSection() {
  const { WhatsAppAdLinkSettings } = require('./WhatsAppAdLinkSettings');
  return <WhatsAppAdLinkSettings />;
}
