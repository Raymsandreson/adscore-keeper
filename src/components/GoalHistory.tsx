import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  History, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  CheckCircle, 
  XCircle,
  Lightbulb,
  Loader2,
  Calendar,
  BarChart3,
  Sparkles,
  LineChart
} from "lucide-react";
import { Goal } from "./GoalsManager";
import GoalSuccessChart from "./GoalSuccessChart";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface GoalHistoryEntry {
  id: string;
  goal_title: string;
  goal_type: string;
  target_value: number;
  achieved_value: number;
  unit: string | null;
  deadline: string;
  status: string;
  achievement_percentage: number | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  created_at: string;
}

interface GoalHistoryProps {
  currentGoals: Goal[];
  onArchiveGoal?: (goal: Goal, status: 'completed' | 'overdue' | 'cancelled') => void;
}

const GoalHistory = ({ currentGoals, onArchiveGoal }: GoalHistoryProps) => {
  const [history, setHistory] = useState<GoalHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string>("");
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, [selectedPeriod]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('goal_history')
        .select('*')
        .order('created_at', { ascending: false });

      if (selectedPeriod !== "all") {
        const months = parseInt(selectedPeriod);
        const startDate = startOfMonth(subMonths(new Date(), months - 1));
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Erro ao buscar histórico:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getAISuggestions = async (goal: Goal) => {
    setSelectedGoal(goal);
    setShowAIDialog(true);
    setIsLoadingAI(true);
    setAiSuggestion("");

    try {
      const progress = Math.min(100, (goal.currentValue / goal.targetValue) * 100);
      const daysLeft = Math.ceil((goal.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      
      const { data, error } = await cloudFunctions.invoke('goal-ai-suggestions', {
        body: {
          goal: {
            title: goal.title,
            type: goal.type,
            currentValue: goal.currentValue,
            targetValue: goal.targetValue,
            unit: goal.unit,
            progress: progress.toFixed(1),
            daysLeft,
            status: daysLeft < 0 ? 'atrasado' : progress >= 100 ? 'concluído' : progress >= 70 ? 'no caminho' : 'em progresso'
          },
          history: history.slice(0, 10)
        }
      });

      if (error) throw error;
      setAiSuggestion(data.suggestion);
    } catch (error) {
      console.error('Erro ao buscar sugestões:', error);
      setAiSuggestion("Não foi possível gerar sugestões no momento. Tente novamente mais tarde.");
    } finally {
      setIsLoadingAI(false);
    }
  };

  const calculateStats = () => {
    if (history.length === 0) return { completed: 0, overdue: 0, avgAchievement: 0, successRate: 0 };
    
    const completed = history.filter(h => h.status === 'completed').length;
    const overdue = history.filter(h => h.status === 'overdue').length;
    const avgAchievement = history.reduce((acc, h) => acc + (h.achievement_percentage || 0), 0) / history.length;
    const successRate = (completed / history.length) * 100;

    return { completed, overdue, avgAchievement, successRate };
  };

  const stats = calculateStats();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Atingida</Badge>;
      case 'overdue':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Não Atingida</Badge>;
      case 'cancelled':
        return <Badge variant="secondary">Cancelada</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const groupByPeriod = () => {
    const grouped: Record<string, GoalHistoryEntry[]> = {};
    
    history.forEach(entry => {
      const monthKey = format(new Date(entry.created_at), "MMMM 'de' yyyy", { locale: ptBR });
      if (!grouped[monthKey]) grouped[monthKey] = [];
      grouped[monthKey].push(entry);
    });

    return grouped;
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="evolution" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="evolution" className="gap-2">
            <LineChart className="h-4 w-4" />
            Evolução
          </TabsTrigger>
          <TabsTrigger value="current" className="gap-2">
            <Sparkles className="h-4 w-4" />
            Sugestões IA
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evolution" className="space-y-4 mt-4">
          <GoalSuccessChart history={history} />
        </TabsContent>

        <TabsContent value="current" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                Sugestões de IA para suas Metas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentGoals.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Crie metas para receber sugestões personalizadas de IA
                </p>
              ) : (
                <div className="grid gap-3">
                  {currentGoals.map((goal) => {
                    const progress = Math.min(100, (goal.currentValue / goal.targetValue) * 100);
                    return (
                      <Card key={goal.id} className="border-border/50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium">{goal.title}</h4>
                              <div className="flex items-center gap-4 mt-2">
                                <Progress value={progress} className="flex-1 h-2" />
                                <span className="text-sm text-muted-foreground w-12">
                                  {progress.toFixed(0)}%
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {goal.currentValue} / {goal.targetValue} {goal.unit}
                              </p>
                            </div>
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="ml-4 gap-2"
                              onClick={() => getAISuggestions(goal)}
                            >
                              <Sparkles className="h-4 w-4" />
                              Sugestões
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-border/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Total</span>
                </div>
                <p className="text-2xl font-bold">{history.length}</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">Taxa Sucesso</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{stats.successRate.toFixed(0)}%</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">Atingidas</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">Média Atingimento</span>
                </div>
                <p className="text-2xl font-bold text-blue-600">{stats.avgAchievement.toFixed(0)}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[200px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="1">Último mês</SelectItem>
                <SelectItem value="3">Últimos 3 meses</SelectItem>
                <SelectItem value="6">Últimos 6 meses</SelectItem>
                <SelectItem value="12">Último ano</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* History List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : history.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Nenhum histórico encontrado</h3>
                <p className="text-muted-foreground">
                  Complete ou arquive metas para ver seu histórico aqui
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-6">
                {Object.entries(groupByPeriod()).map(([period, entries]) => (
                  <div key={period}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-3 capitalize">
                      {period}
                    </h3>
                    <div className="space-y-3">
                      {entries.map((entry) => (
                        <Card key={entry.id} className="border-border/50">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="font-medium">{entry.goal_title}</h4>
                                  {getStatusBadge(entry.status)}
                                </div>
                                <div className="flex items-center gap-4">
                                  <Progress 
                                    value={entry.achievement_percentage || 0} 
                                    className="flex-1 h-2"
                                  />
                                  <span className="text-sm font-medium w-12">
                                    {(entry.achievement_percentage || 0).toFixed(0)}%
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                  <span>
                                    Resultado: {entry.achieved_value} / {entry.target_value} {entry.unit}
                                  </span>
                                  <span>•</span>
                                  <span>
                                    Prazo: {format(new Date(entry.deadline), "dd/MM/yyyy")}
                                  </span>
                                </div>
                                {entry.notes && (
                                  <p className="text-sm text-muted-foreground mt-2 italic">
                                    📝 {entry.notes}
                                  </p>
                                )}
                              </div>
                              {entry.status === 'completed' ? (
                                <TrendingUp className="h-5 w-5 text-green-500" />
                              ) : (
                                <TrendingDown className="h-5 w-5 text-red-500" />
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>

      {/* AI Suggestions Dialog */}
      <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-500" />
              Sugestões de IA para: {selectedGoal?.title}
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="h-[500px] pr-4">
            {isLoadingAI ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Analisando sua meta e gerando sugestões...</p>
              </div>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div 
                  className="whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ 
                    __html: aiSuggestion
                      .replace(/## /g, '<h3 class="text-lg font-semibold mt-4 mb-2">')
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n/g, '<br/>') 
                  }} 
                />
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GoalHistory;
