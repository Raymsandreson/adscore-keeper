import { useState, useEffect, useMemo } from 'react';
import { usePageState } from '@/hooks/usePageState';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { TeamManagement } from '@/components/team/TeamManagement';
import { TeamProductivityDashboard } from '@/components/team/TeamProductivityDashboard';
import { CardPermissionsManager } from '@/components/finance/CardPermissionsManager';
import { TeamsManager } from '@/components/team/TeamsManager';
import { AccountPermissionsManager } from '@/components/finance/AccountPermissionsManager';
import { ModulePermissionsManager } from '@/components/team/ModulePermissionsManager';
import { useUserRole } from '@/hooks/useUserRole';
import { useCreditCardTransactions } from '@/hooks/useCreditCardTransactions';
import { WeeklyEvaluations } from '@/components/team/WeeklyEvaluations';
import { CommissionGoals } from '@/components/team/CommissionGoals';
import { MemberRoutineManager } from '@/components/team/MemberRoutineManager';
import { WhatsAppInstancePermissions } from '@/components/team/WhatsAppInstancePermissions';
import { CareerPlanManager } from '@/components/team/CareerPlanManager';
import { TrafficActivityPanel } from '@/components/traffic/TrafficActivityPanel';
import { MetricsManager } from '@/components/team/MetricsManager';
import { AmbassadorCentral } from '@/components/ambassadors/AmbassadorCentral';
import { cn } from '@/lib/utils';
import {
  Users,
  BarChart3,
  ArrowLeft,
  Loader2,
  CreditCard,
  Star,
  UsersRound,
  DollarSign,
  Lock,
  Landmark,
  CalendarClock,
  MessageSquare,
  GraduationCap,
  TrendingUp,
  Activity,
  Handshake,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface TabDef {
  key: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const ALL_TABS: TabDef[] = [
  { key: 'productivity', label: 'Produtividade', icon: BarChart3 },
  { key: 'metrics', label: 'Métricas', icon: Activity, adminOnly: true },
  { key: 'commission', label: 'Metas', icon: DollarSign, adminOnly: true },
  { key: 'evaluations', label: 'Avaliações', icon: Star, adminOnly: true },
  { key: 'traffic', label: 'Tráfego', icon: TrendingUp, adminOnly: true },
  { key: 'members', label: 'Membros', icon: Users },
  { key: 'teams', label: 'Times', icon: UsersRound },
  { key: 'career', label: 'Carreira', icon: GraduationCap, adminOnly: true },
  { key: 'routines', label: 'Rotinas', icon: CalendarClock, adminOnly: true },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, adminOnly: true },
  { key: 'permissions', label: 'Cartões', icon: CreditCard, adminOnly: true },
  { key: 'accounts', label: 'Contas', icon: Landmark, adminOnly: true },
  { key: 'modules', label: 'Acessos', icon: Lock, adminOnly: true },
];

function TeamTabContent({ tab, availableCards }: { tab: string; availableCards: string[] }) {
  switch (tab) {
    case 'productivity': return <TeamProductivityDashboard />;
    case 'metrics': return <MetricsManager />;
    case 'commission': return <CommissionGoals />;
    case 'evaluations': return <WeeklyEvaluations />;
    case 'traffic': return <TrafficActivityPanel />;
    case 'members': return <TeamManagement />;
    case 'teams': return <TeamsManager />;
    case 'career': return <CareerPlanManager />;
    case 'routines': return <MemberRoutineManager />;
    case 'whatsapp': return <WhatsAppInstancePermissions />;
    case 'permissions': return <CardPermissionsManager availableCards={availableCards} />;
    case 'accounts': return <AccountPermissionsManager />;
    case 'modules': return <ModulePermissionsManager />;
    default: return null;
  }
}

export default function TeamPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = useUserRole();
  const [activeTab, setActiveTab] = usePageState<string>('team_activeTab', 'productivity');
  const [tabsExpanded, setTabsExpanded] = useState(false);
  const VISIBLE_COUNT = 4; // Show first N tabs when collapsed

  const { transactions, fetchTransactions, fetchConnections } = useCreditCardTransactions();

  useEffect(() => {
    fetchConnections();
    fetchTransactions();
  }, [fetchConnections, fetchTransactions]);

  const availableCards = useMemo(() => {
    const cards = new Set(transactions.map(t => t.card_last_digits).filter(Boolean) as string[]);
    return Array.from(cards);
  }, [transactions]);

  const visibleTabs = useMemo(
    () => ALL_TABS.filter(t => !t.adminOnly || isAdmin),
    [isAdmin]
  );

  const safeTab = visibleTabs.some(t => t.key === activeTab) ? activeTab : 'productivity';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Inter-style sticky header */}
      <div className="sticky top-0 z-30 bg-card border-b shadow-sm">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center gap-3 h-16">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="rounded-full hover:bg-primary/10 shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3 min-w-0">
              <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">
                  Gestão de Equipe
                </h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Membros, produtividade e permissões
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible pill tab navigation */}
      <div className="sticky top-16 z-20 bg-card/80 backdrop-blur-md border-b">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          {(() => {
            // Always show the active tab + first N tabs (deduplicated)
            const activeTabDef = visibleTabs.find(t => t.key === safeTab);
            const collapsed = !tabsExpanded;
            
            // When collapsed: show first VISIBLE_COUNT, but ensure active is always visible
            let displayTabs = visibleTabs;
            let hiddenCount = 0;
            if (collapsed && visibleTabs.length > VISIBLE_COUNT) {
              const firstN = visibleTabs.slice(0, VISIBLE_COUNT);
              const activeInFirstN = firstN.some(t => t.key === safeTab);
              if (activeInFirstN) {
                displayTabs = firstN;
              } else {
                // Replace last visible with active tab
                displayTabs = [...firstN.slice(0, VISIBLE_COUNT - 1), activeTabDef!];
              }
              hiddenCount = visibleTabs.length - displayTabs.length;
            }

            return (
              <div className="flex items-center gap-1.5 py-2.5 flex-wrap">
                {displayTabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = safeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}

                {/* Expand/collapse toggle */}
                {visibleTabs.length > VISIBLE_COUNT && (
                  <button
                    onClick={() => setTabsExpanded(prev => !prev)}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
                      'text-primary bg-primary/10 hover:bg-primary/20'
                    )}
                  >
                    {collapsed ? (
                      <>
                        <span>+{hiddenCount}</span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </>
                    ) : (
                      <>
                        <span>Menos</span>
                        <ChevronUp className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <TeamTabContent tab={safeTab} availableCards={availableCards} />
      </div>
    </div>
  );
}
