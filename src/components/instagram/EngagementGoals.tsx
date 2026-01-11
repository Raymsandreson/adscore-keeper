import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { 
  Target, 
  Plus, 
  Edit2, 
  Trash2, 
  TrendingUp,
  MessageCircle,
  Heart,
  Users,
  Eye,
  Send,
  Reply,
  CheckCircle2,
  Clock,
  AlertTriangle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface EngagementGoal {
  id: string;
  platform: string;
  goal_type: string;
  target_value: number;
  current_value: number;
  period: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

const GOAL_TYPES = [
  { value: 'comments_sent', label: 'Comentários Enviados', icon: Send },
  { value: 'comments_received', label: 'Comentários Recebidos', icon: MessageCircle },
  { value: 'replies', label: 'Respostas', icon: Reply },
  { value: 'likes', label: 'Curtidas', icon: Heart },
  { value: 'followers', label: 'Novos Seguidores', icon: Users },
  { value: 'engagement_rate', label: 'Taxa de Engajamento (%)', icon: TrendingUp },
  { value: 'reach', label: 'Alcance', icon: Eye },
];

const PERIODS = [
  { value: 'daily', label: 'Diário' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
];

export const EngagementGoals = () => {
  const [goals, setGoals] = useState<EngagementGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<EngagementGoal | null>(null);
  
  // Form state
  const [goalType, setGoalType] = useState('comments_sent');
  const [platform, setPlatform] = useState('instagram');
  const [targetValue, setTargetValue] = useState('');
  const [period, setPeriod] = useState('daily');

  useEffect(() => {
    fetchGoals();
  }, []);

  const fetchGoals = async () => {
    try {
      const { data, error } = await supabase
        .from('engagement_goals')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGoals(data || []);
    } catch (error) {
      console.error('Error fetching goals:', error);
      toast.error('Erro ao carregar metas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveGoal = async () => {
    if (!targetValue || parseInt(targetValue) <= 0) {
      toast.error('Informe um valor válido para a meta');
      return;
    }

    try {
      if (editingGoal) {
        const { error } = await supabase
          .from('engagement_goals')
          .update({
            goal_type: goalType,
            platform,
            target_value: parseInt(targetValue),
            period,
          })
          .eq('id', editingGoal.id);

        if (error) throw error;
        toast.success('Meta atualizada!');
      } else {
        const { error } = await supabase
          .from('engagement_goals')
          .insert({
            goal_type: goalType,
            platform,
            target_value: parseInt(targetValue),
            period,
            current_value: 0,
            is_active: true,
          });

        if (error) throw error;
        toast.success('Meta criada!');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchGoals();
    } catch (error) {
      console.error('Error saving goal:', error);
      toast.error('Erro ao salvar meta');
    }
  };

  const handleDeleteGoal = async (id: string) => {
    try {
      const { error } = await supabase
        .from('engagement_goals')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;
      toast.success('Meta removida');
      fetchGoals();
    } catch (error) {
      console.error('Error deleting goal:', error);
      toast.error('Erro ao remover meta');
    }
  };

  const handleEditGoal = (goal: EngagementGoal) => {
    setEditingGoal(goal);
    setGoalType(goal.goal_type);
    setPlatform(goal.platform);
    setTargetValue(goal.target_value.toString());
    setPeriod(goal.period);
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setEditingGoal(null);
    setGoalType('comments_sent');
    setPlatform('instagram');
    setTargetValue('');
    setPeriod('daily');
  };

  const getProgress = (goal: EngagementGoal) => {
    return Math.min((goal.current_value / goal.target_value) * 100, 100);
  };

  const getStatus = (goal: EngagementGoal) => {
    const progress = getProgress(goal);
    if (progress >= 100) return 'completed';
    if (progress >= 75) return 'on-track';
    if (progress >= 50) return 'in-progress';
    return 'behind';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Concluída</Badge>;
      case 'on-track':
        return <Badge className="bg-blue-500"><TrendingUp className="h-3 w-3 mr-1" /> No caminho</Badge>;
      case 'in-progress':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Em progresso</Badge>;
      default:
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" /> Atrás</Badge>;
    }
  };

  const getGoalIcon = (type: string) => {
    const goal = GOAL_TYPES.find(g => g.value === type);
    return goal ? goal.icon : Target;
  };

  const getGoalLabel = (type: string) => {
    const goal = GOAL_TYPES.find(g => g.value === type);
    return goal ? goal.label : type;
  };

  const getPeriodLabel = (p: string) => {
    const period = PERIODS.find(per => per.value === p);
    return period ? period.label : p;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground mt-4">Carregando metas...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Metas de Engajamento
          </h3>
          <p className="text-sm text-muted-foreground">
            Defina metas para acompanhar seu progresso
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova Meta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingGoal ? 'Editar Meta' : 'Nova Meta de Engajamento'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Tipo de Meta</Label>
                <Select value={goalType} onValueChange={setGoalType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          <type.icon className="h-4 w-4" />
                          {type.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Plataforma</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="all">Ambas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Valor da Meta</Label>
                <Input
                  type="number"
                  placeholder="Ex: 50"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Período</Label>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveGoal}>
                {editingGoal ? 'Salvar' : 'Criar Meta'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Goals Grid */}
      {goals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhuma meta definida</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Crie metas de engajamento para acompanhar seu progresso
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeira Meta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((goal) => {
            const Icon = getGoalIcon(goal.goal_type);
            const status = getStatus(goal);
            const progress = getProgress(goal);

            return (
              <Card key={goal.id} className="border-border/50 hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${
                        status === 'completed' ? 'bg-green-100 text-green-600' :
                        status === 'on-track' ? 'bg-blue-100 text-blue-600' :
                        status === 'in-progress' ? 'bg-yellow-100 text-yellow-600' :
                        'bg-red-100 text-red-600'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{getGoalLabel(goal.goal_type)}</CardTitle>
                        <CardDescription className="text-xs">
                          {getPeriodLabel(goal.period)} • {goal.platform === 'all' ? 'Todas' : goal.platform}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditGoal(goal)}>
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteGoal(goal.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progresso</span>
                      {getStatusBadge(status)}
                    </div>
                    <Progress value={progress} className="h-2" />
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold">{goal.current_value}</span>
                      <span className="text-muted-foreground">/ {goal.target_value}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
