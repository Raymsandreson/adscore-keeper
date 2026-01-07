import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { format, differenceInDays, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Target, 
  Plus, 
  Calendar as CalendarIcon, 
  Trash2, 
  Edit2, 
  TrendingUp, 
  Users, 
  DollarSign, 
  MousePointer,
  Eye,
  CheckCircle,
  Clock,
  AlertTriangle
} from "lucide-react";

export interface Goal {
  id: string;
  title: string;
  type: 'leads' | 'conversions' | 'revenue' | 'followers' | 'engagement' | 'cpc' | 'ctr' | 'custom';
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline: Date;
  createdAt: Date;
  notes?: string;
}

interface GoalsManagerProps {
  currentMetrics?: {
    leads?: number;
    conversions?: number;
    revenue?: number;
    followers?: number;
    engagement?: number;
    cpc?: number;
    ctr?: number;
  };
}

const GOAL_TYPES = [
  { value: 'leads', label: 'Leads', icon: Users, unit: 'leads' },
  { value: 'conversions', label: 'Conversões', icon: CheckCircle, unit: 'conversões' },
  { value: 'revenue', label: 'Receita', icon: DollarSign, unit: 'R$' },
  { value: 'followers', label: 'Seguidores', icon: Users, unit: 'seguidores' },
  { value: 'engagement', label: 'Engajamento', icon: TrendingUp, unit: '%' },
  { value: 'cpc', label: 'CPC (reduzir)', icon: MousePointer, unit: 'R$' },
  { value: 'ctr', label: 'CTR', icon: Eye, unit: '%' },
  { value: 'custom', label: 'Personalizado', icon: Target, unit: '' },
];

const GoalsManager = ({ currentMetrics }: GoalsManagerProps) => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  
  // Form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Goal['type']>('leads');
  const [targetValue, setTargetValue] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [unit, setUnit] = useState('');
  const [deadline, setDeadline] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState('');

  // Load goals from localStorage
  useEffect(() => {
    const savedGoals = localStorage.getItem('marketing_goals');
    if (savedGoals) {
      const parsed = JSON.parse(savedGoals);
      setGoals(parsed.map((g: any) => ({
        ...g,
        deadline: new Date(g.deadline),
        createdAt: new Date(g.createdAt)
      })));
    }
  }, []);

  // Save goals to localStorage
  useEffect(() => {
    if (goals.length > 0) {
      localStorage.setItem('marketing_goals', JSON.stringify(goals));
    }
  }, [goals]);

  const resetForm = () => {
    setTitle('');
    setType('leads');
    setTargetValue('');
    setCurrentValue('');
    setUnit('');
    setDeadline(undefined);
    setNotes('');
    setEditingGoal(null);
  };

  const handleSaveGoal = () => {
    if (!title || !targetValue || !deadline) return;

    const goalType = GOAL_TYPES.find(t => t.value === type);
    
    const newGoal: Goal = {
      id: editingGoal?.id || crypto.randomUUID(),
      title,
      type,
      targetValue: parseFloat(targetValue),
      currentValue: parseFloat(currentValue) || 0,
      unit: unit || goalType?.unit || '',
      deadline,
      createdAt: editingGoal?.createdAt || new Date(),
      notes
    };

    if (editingGoal) {
      setGoals(prev => prev.map(g => g.id === editingGoal.id ? newGoal : g));
    } else {
      setGoals(prev => [...prev, newGoal]);
    }

    setIsDialogOpen(false);
    resetForm();
  };

  const handleEditGoal = (goal: Goal) => {
    setEditingGoal(goal);
    setTitle(goal.title);
    setType(goal.type);
    setTargetValue(goal.targetValue.toString());
    setCurrentValue(goal.currentValue.toString());
    setUnit(goal.unit);
    setDeadline(goal.deadline);
    setNotes(goal.notes || '');
    setIsDialogOpen(true);
  };

  const handleDeleteGoal = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  };

  const handleUpdateProgress = (id: string, newValue: number) => {
    setGoals(prev => prev.map(g => 
      g.id === id ? { ...g, currentValue: newValue } : g
    ));
  };

  const getProgress = (goal: Goal) => {
    if (goal.type === 'cpc') {
      // For CPC, lower is better
      if (goal.currentValue <= goal.targetValue) return 100;
      return Math.max(0, (1 - (goal.currentValue - goal.targetValue) / goal.currentValue) * 100);
    }
    return Math.min(100, (goal.currentValue / goal.targetValue) * 100);
  };

  const getStatus = (goal: Goal) => {
    const progress = getProgress(goal);
    const daysLeft = differenceInDays(goal.deadline, new Date());
    
    if (progress >= 100) return 'completed';
    if (isPast(goal.deadline) && !isToday(goal.deadline)) return 'overdue';
    if (daysLeft <= 3) return 'urgent';
    if (progress >= 70) return 'on-track';
    return 'in-progress';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Concluído</Badge>;
      case 'overdue':
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Atrasado</Badge>;
      case 'urgent':
        return <Badge className="bg-orange-500"><Clock className="h-3 w-3 mr-1" />Urgente</Badge>;
      case 'on-track':
        return <Badge className="bg-blue-500"><TrendingUp className="h-3 w-3 mr-1" />No caminho</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Em progresso</Badge>;
    }
  };

  const sortedGoals = [...goals].sort((a, b) => {
    const statusOrder = { overdue: 0, urgent: 1, 'in-progress': 2, 'on-track': 3, completed: 4 };
    return statusOrder[getStatus(a)] - statusOrder[getStatus(b)];
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Metas e Prazos</h2>
          <p className="text-muted-foreground">Defina e acompanhe suas metas de marketing</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Meta
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingGoal ? 'Editar Meta' : 'Criar Nova Meta'}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Título da Meta</Label>
                <Input 
                  placeholder="Ex: Alcançar 100 leads em janeiro"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={type} onValueChange={(v) => setType(v as Goal['type'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GOAL_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <div className="flex items-center gap-2">
                            <t.icon className="h-4 w-4" />
                            {t.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Input 
                    placeholder="Ex: leads, R$, %"
                    value={unit || GOAL_TYPES.find(t => t.value === type)?.unit || ''}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Valor Atual</Label>
                  <Input 
                    type="number"
                    placeholder="0"
                    value={currentValue}
                    onChange={(e) => setCurrentValue(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Meta (Objetivo)</Label>
                  <Input 
                    type="number"
                    placeholder="100"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Prazo</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !deadline && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {deadline ? format(deadline, "PPP", { locale: ptBR }) : "Selecione uma data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={deadline}
                      onSelect={setDeadline}
                      initialFocus
                      className="p-3 pointer-events-auto"
                      disabled={(date) => date < new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Observações (opcional)</Label>
                <Input 
                  placeholder="Notas sobre esta meta..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <Button 
                className="w-full" 
                onClick={handleSaveGoal}
                disabled={!title || !targetValue || !deadline}
              >
                {editingGoal ? 'Salvar Alterações' : 'Criar Meta'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">Total de Metas</span>
            </div>
            <p className="text-3xl font-bold">{goals.length}</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-sm text-muted-foreground">Concluídas</span>
            </div>
            <p className="text-3xl font-bold text-green-600">
              {goals.filter(g => getStatus(g) === 'completed').length}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <span className="text-sm text-muted-foreground">Em Progresso</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">
              {goals.filter(g => ['in-progress', 'on-track'].includes(getStatus(g))).length}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <span className="text-sm text-muted-foreground">Atrasadas</span>
            </div>
            <p className="text-3xl font-bold text-red-600">
              {goals.filter(g => getStatus(g) === 'overdue').length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Goals List */}
      {goals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhuma meta definida</h3>
            <p className="text-muted-foreground mb-4">
              Crie sua primeira meta para começar a acompanhar seu progresso
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Meta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sortedGoals.map((goal) => {
            const progress = getProgress(goal);
            const status = getStatus(goal);
            const daysLeft = differenceInDays(goal.deadline, new Date());
            const GoalIcon = GOAL_TYPES.find(t => t.value === goal.type)?.icon || Target;

            return (
              <Card key={goal.id} className={cn(
                "border-border/50 transition-all",
                status === 'completed' && "bg-green-50/50 dark:bg-green-950/20",
                status === 'overdue' && "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
              )}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        status === 'completed' ? "bg-green-100 dark:bg-green-900" :
                        status === 'overdue' ? "bg-red-100 dark:bg-red-900" :
                        "bg-muted"
                      )}>
                        <GoalIcon className={cn(
                          "h-5 w-5",
                          status === 'completed' ? "text-green-600" :
                          status === 'overdue' ? "text-red-600" :
                          "text-primary"
                        )} />
                      </div>
                      <div>
                        <h3 className="font-semibold">{goal.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusBadge(status)}
                          <span className="text-sm text-muted-foreground">
                            {status === 'overdue' 
                              ? `Atrasado há ${Math.abs(daysLeft)} dias`
                              : daysLeft === 0 
                                ? 'Prazo: Hoje'
                                : `${daysLeft} dias restantes`
                            }
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEditGoal(goal)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteGoal(goal.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progresso</span>
                      <span className="font-medium">
                        {goal.currentValue.toLocaleString('pt-BR')} / {goal.targetValue.toLocaleString('pt-BR')} {goal.unit}
                      </span>
                    </div>
                    
                    <Progress value={progress} className="h-2" />
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Prazo: {format(goal.deadline, "dd 'de' MMMM, yyyy", { locale: ptBR })}
                      </span>
                      <span className={cn(
                        "font-medium",
                        progress >= 100 ? "text-green-600" :
                        progress >= 70 ? "text-blue-600" :
                        progress >= 30 ? "text-yellow-600" :
                        "text-muted-foreground"
                      )}>
                        {progress.toFixed(0)}%
                      </span>
                    </div>

                    {/* Quick update */}
                    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">Atualizar progresso:</Label>
                      <Input 
                        type="number"
                        className="h-8 w-24"
                        value={goal.currentValue}
                        onChange={(e) => handleUpdateProgress(goal.id, parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-sm text-muted-foreground">{goal.unit}</span>
                    </div>

                    {goal.notes && (
                      <p className="text-sm text-muted-foreground italic pt-2">
                        📝 {goal.notes}
                      </p>
                    )}
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

export default GoalsManager;
