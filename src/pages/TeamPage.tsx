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
import { TrafficActivityPanel } from '@/components/traffic/TrafficActivityPanel';
import { MetricsManager } from '@/components/team/MetricsManager';
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
  TrendingUp,
  Activity,
} from 'lucide-react';

export default function TeamPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = useUserRole();
  const [activeTab, setActiveTab] = usePageState<string>('team_activeTab', 'productivity');
  
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

  // All authenticated users can access - admin-only tabs are filtered below
  const availableTabs = isAdmin
    ? ['productivity', 'metrics', 'commission', 'evaluations', 'traffic', 'members', 'teams', 'career', 'routines', 'whatsapp', 'permissions', 'accounts', 'modules']
    : ['productivity', 'members', 'teams'];

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

        {/* Tabs */}
        <Tabs value={availableTabs.includes(activeTab) ? activeTab : 'productivity'} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex w-full max-w-7xl overflow-x-auto">
            <TabsTrigger value="productivity" className="gap-2 shrink-0">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Produtividade</span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="metrics" className="gap-2 shrink-0">
                <Activity className="h-4 w-4" />
                <span className="hidden sm:inline">Métricas</span>
              </TabsTrigger>
            )}
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
            {isAdmin && (
              <TabsTrigger value="traffic" className="gap-2 shrink-0">
                <TrendingUp className="h-4 w-4" />
                <span className="hidden sm:inline">Tráfego</span>
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

          <TabsContent value="metrics">
            <MetricsManager />
          </TabsContent>

          <TabsContent value="commission">
            <CommissionGoals />
          </TabsContent>

          <TabsContent value="evaluations">
            <WeeklyEvaluations />
          </TabsContent>

          <TabsContent value="traffic">
            <TrafficActivityPanel />
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
      </div>
    </div>
  );
}
