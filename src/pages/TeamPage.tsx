import { useEffect, useMemo } from 'react';
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
  { key: 'metrics', label: 'Métricas', icon: Activity },
  { key: 'commission', label: 'Metas', icon: DollarSign },
  { key: 'evaluations', label: 'Avaliações', icon: Star },
  { key: 'traffic', label: 'Tráfego', icon: TrendingUp },
  { key: 'members', label: 'Membros', icon: Users },
  { key: 'teams', label: 'Times', icon: UsersRound },
  { key: 'ambassadors', label: 'Embaixadores', icon: Handshake },
  { key: 'career', label: 'Carreira', icon: GraduationCap },
  { key: 'routines', label: 'Rotinas', icon: CalendarClock },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { key: 'permissions', label: 'Cartões', icon: CreditCard },
  { key: 'accounts', label: 'Contas', icon: Landmark },
  { key: 'modules', label: 'Acessos', icon: Lock },
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
    case 'ambassadors': return <AmbassadorCentral />;
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

      {/* Pill tab navigation - all tabs visible */}
      <div className="sticky top-16 z-20 bg-card/80 backdrop-blur-md border-b">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
              <div className="flex items-center gap-1.5 py-2.5 flex-wrap">
                {visibleTabs.map(tab => {
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
              </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <TeamTabContent tab={safeTab} availableCards={availableCards} />
      </div>
    </div>
  );
}
