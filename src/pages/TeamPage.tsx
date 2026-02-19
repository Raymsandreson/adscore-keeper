import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';

export default function TeamPage() {
  const navigate = useNavigate();
  const { isAdmin, loading } = useUserRole();
  const [activeTab, setActiveTab] = useState('productivity');
  
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

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">Acesso Restrito</h1>
          <p className="text-muted-foreground mb-4">
            Apenas administradores podem acessar esta página
          </p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar ao Dashboard
          </Button>
        </div>
      </div>
    );
  }

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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-6xl grid-cols-9">
            <TabsTrigger value="productivity" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Produtividade</span>
            </TabsTrigger>
            <TabsTrigger value="commission" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Metas</span>
            </TabsTrigger>
            <TabsTrigger value="evaluations" className="gap-2">
              <Star className="h-4 w-4" />
              <span className="hidden sm:inline">Avaliações</span>
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Membros</span>
            </TabsTrigger>
            <TabsTrigger value="teams" className="gap-2">
              <UsersRound className="h-4 w-4" />
              <span className="hidden sm:inline">Times</span>
            </TabsTrigger>
            <TabsTrigger value="routines" className="gap-2">
              <CalendarClock className="h-4 w-4" />
              <span className="hidden sm:inline">Rotinas</span>
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-2">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Cartões</span>
            </TabsTrigger>
            <TabsTrigger value="accounts" className="gap-2">
              <Landmark className="h-4 w-4" />
              <span className="hidden sm:inline">Contas</span>
            </TabsTrigger>
            <TabsTrigger value="modules" className="gap-2">
              <Lock className="h-4 w-4" />
              <span className="hidden sm:inline">Acessos</span>
            </TabsTrigger>
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

          <TabsContent value="routines">
            <MemberRoutineManager />
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
