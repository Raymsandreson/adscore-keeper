import { useState, useEffect, useMemo } from 'react';
import { usePageState } from '@/hooks/usePageState';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { ProcessualTeamDashboard } from '@/components/team/ProcessualTeamDashboard';
import {
  Users,
  BarChart3,
  ArrowLeft,
  Shield,
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
  Briefcase,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type TeamSection = 'abraci' | 'processual';

export default function TeamPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = useUserRole();
  const [activeTab, setActiveTab] = usePageState<string>('team_activeTab', 'productivity');
  const [section, setSection] = usePageState<TeamSection>('team_section', 'abraci');

  // Fetch transactions to get available cards for permissions
  const { transactions, fetchTransactions, fetchConnections } = useCreditCardTransactions();

  useEffect(() => {
    fetchConnections();
    fetchTransactions();
  }, [fetchConnections, fetchTransactions]);

  const availableCards = useMemo(() => {
    const cards = new Set(transactions.map(t => t.card_last_digits).filter(Boolean) as string[]);
    return Array.from(cards);
  }, [transactions]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const availableTabs = isAdmin
    ? ['productivity', 'commission', 'evaluations', 'members', 'teams', 'career', 'routines', 'whatsapp', 'permissions', 'accounts', 'modules']
    : ['productivity', 'members', 'teams'];

  const sidebarItems: { id: TeamSection; label: string; icon: React.ReactNode }[] = [
    { id: 'abraci', label: 'Equipe Abraci', icon: <Building2 className="h-4 w-4" /> },
    { id: 'processual', label: 'Equipe Processual', icon: <Briefcase className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Gestão de Equipe</h1>
            <p className="text-muted-foreground">
              Gerencie membros e monitore a produtividade
            </p>
          </div>
        </div>

        {/* Section Selector (sidebar-like tabs) */}
        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-52 shrink-0 hidden md:block">
            <nav className="space-y-1 sticky top-6">
              {sidebarItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left",
                    section === item.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Mobile section selector */}
          <div className="md:hidden w-full mb-4">
            <div className="flex gap-2">
              {sidebarItems.map(item => (
                <Button
                  key={item.id}
                  variant={section === item.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSection(item.id)}
                  className="flex-1 gap-1.5"
                >
                  {item.icon}
                  <span className="text-xs">{item.label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {section === 'abraci' ? (
              <Tabs value={availableTabs.includes(activeTab) ? activeTab : 'productivity'} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="flex w-full max-w-7xl overflow-x-auto">
                  <TabsTrigger value="productivity" className="gap-2 shrink-0">
                    <BarChart3 className="h-4 w-4" />
                    <span className="hidden sm:inline">Produtividade</span>
                  </TabsTrigger>
                  {isAdmin && (
                    <TabsTrigger value="commission" className="gap-2 shrink-0">
                      <DollarSign className="h-4 w-4" />
                      <span className="hidden sm:inline">Metas</span>
                    </TabsTrigger>
                  )}
                  {isAdmin && (
                    <TabsTrigger value="evaluations" className="gap-2 shrink-0">
                      <Star className="h-4 w-4" />
                      <span className="hidden sm:inline">Avaliações</span>
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="members" className="gap-2 shrink-0">
                    <Users className="h-4 w-4" />
                    <span className="hidden sm:inline">Membros</span>
                  </TabsTrigger>
                  <TabsTrigger value="teams" className="gap-2 shrink-0">
                    <UsersRound className="h-4 w-4" />
                    <span className="hidden sm:inline">Times</span>
                  </TabsTrigger>
                  {isAdmin && (
                    <TabsTrigger value="career" className="gap-2 shrink-0">
                      <GraduationCap className="h-4 w-4" />
                      <span className="hidden sm:inline">Carreira</span>
                    </TabsTrigger>
                  )}
                  {isAdmin && (
                    <TabsTrigger value="routines" className="gap-2 shrink-0">
                      <CalendarClock className="h-4 w-4" />
                      <span className="hidden sm:inline">Rotinas</span>
                    </TabsTrigger>
                  )}
                  {isAdmin && (
                    <TabsTrigger value="whatsapp" className="gap-2 shrink-0">
                      <MessageSquare className="h-4 w-4" />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </TabsTrigger>
                  )}
                  {isAdmin && (
                    <TabsTrigger value="permissions" className="gap-2 shrink-0">
                      <CreditCard className="h-4 w-4" />
                      <span className="hidden sm:inline">Cartões</span>
                    </TabsTrigger>
                  )}
                  {isAdmin && (
                    <TabsTrigger value="accounts" className="gap-2 shrink-0">
                      <Landmark className="h-4 w-4" />
                      <span className="hidden sm:inline">Contas</span>
                    </TabsTrigger>
                  )}
                  {isAdmin && (
                    <TabsTrigger value="modules" className="gap-2 shrink-0">
                      <Lock className="h-4 w-4" />
                      <span className="hidden sm:inline">Acessos</span>
                    </TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="productivity">
                  <TeamProductivityDashboard />
                </TabsContent>
                <TabsContent value="commission">
                  <CommissionGoals />
                </TabsContent>
                <TabsContent value="evaluations">
                  <WeeklyEvaluations />
                </TabsContent>
                <TabsContent value="members">
                  <TeamManagement />
                </TabsContent>
                <TabsContent value="teams">
                  <TeamsManager />
                </TabsContent>
                <TabsContent value="career">
                  <CareerPlanManager />
                </TabsContent>
                <TabsContent value="routines">
                  <MemberRoutineManager />
                </TabsContent>
                <TabsContent value="whatsapp">
                  <WhatsAppInstancePermissions />
                </TabsContent>
                <TabsContent value="permissions">
                  <CardPermissionsManager availableCards={availableCards} />
                </TabsContent>
                <TabsContent value="accounts">
                  <AccountPermissionsManager />
                </TabsContent>
                <TabsContent value="modules">
                  <ModulePermissionsManager />
                </TabsContent>
              </Tabs>
            ) : (
              <ProcessualTeamDashboard />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
