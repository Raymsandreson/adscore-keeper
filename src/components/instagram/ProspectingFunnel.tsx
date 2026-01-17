import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  MessageSquare, 
  Send, 
  Phone, 
  MapPin, 
  CheckCircle2, 
  RefreshCw,
  Users,
  TrendingUp,
  ArrowRight,
  ChevronRight,
  Clock,
  Calendar,
  User,
  StickyNote,
  Edit,
  AlertTriangle,
  Settings,
  Bell,
  Tag,
  Filter,
  UserCheck,
  Building
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, FunnelChart, Funnel, LabelList } from 'recharts';

type FunnelStage = 'comment' | 'dm' | 'whatsapp' | 'visit_scheduled' | 'visit_done' | 'closed' | 'post_sale';

type ProspectClassification = 'prospect' | 'client' | 'closer' | 'sdr' | 'team' | 'other' | null;

interface Prospect {
  id: string;
  author_username: string | null;
  comment_text: string | null;
  created_at: string;
  funnel_stage: FunnelStage;
  conversation_thread_id: string | null;
  prospect_name: string | null;
  notes: string | null;
  post_url: string | null;
  prospect_classification: ProspectClassification;
}

const CLASSIFICATIONS: { key: ProspectClassification; label: string; color: string; bgColor: string }[] = [
  { key: null, label: 'Sem classificação', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  { key: 'prospect', label: 'Prospecto', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  { key: 'client', label: 'Cliente', color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  { key: 'closer', label: 'Acolhedor', color: 'text-purple-600', bgColor: 'bg-purple-100' },
  { key: 'sdr', label: 'SDR', color: 'text-orange-600', bgColor: 'bg-orange-100' },
  { key: 'team', label: 'Equipe', color: 'text-amber-600', bgColor: 'bg-amber-100' },
  { key: 'other', label: 'Outro', color: 'text-slate-600', bgColor: 'bg-slate-100' },
];

const getClassificationConfig = (classification: ProspectClassification) => {
  return CLASSIFICATIONS.find(c => c.key === classification) || CLASSIFICATIONS[0];
};

const FUNNEL_STAGES: { key: FunnelStage; label: string; icon: React.ReactNode; color: string; bgColor: string; defaultAlertDays: number }[] = [
  { key: 'comment', label: 'Comentário', icon: <MessageSquare className="h-4 w-4" />, color: 'text-blue-600', bgColor: 'bg-blue-100', defaultAlertDays: 2 },
  { key: 'dm', label: 'DM', icon: <Send className="h-4 w-4" />, color: 'text-purple-600', bgColor: 'bg-purple-100', defaultAlertDays: 3 },
  { key: 'whatsapp', label: 'WhatsApp', icon: <Phone className="h-4 w-4" />, color: 'text-green-600', bgColor: 'bg-green-100', defaultAlertDays: 5 },
  { key: 'visit_scheduled', label: 'Visita Agendada', icon: <Calendar className="h-4 w-4" />, color: 'text-orange-600', bgColor: 'bg-orange-100', defaultAlertDays: 7 },
  { key: 'visit_done', label: 'Visita Realizada', icon: <MapPin className="h-4 w-4" />, color: 'text-amber-600', bgColor: 'bg-amber-100', defaultAlertDays: 7 },
  { key: 'closed', label: 'Fechado', icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-emerald-600', bgColor: 'bg-emerald-100', defaultAlertDays: 30 },
  { key: 'post_sale', label: 'Pós-venda', icon: <RefreshCw className="h-4 w-4" />, color: 'text-teal-600', bgColor: 'bg-teal-100', defaultAlertDays: 0 },
];

type StageAlertConfig = Record<FunnelStage, { enabled: boolean; days: number }>;

type VisibleClassifications = Record<string, boolean>;

const getDefaultAlertConfig = (): StageAlertConfig => {
  return FUNNEL_STAGES.reduce((acc, stage) => {
    acc[stage.key] = { enabled: stage.defaultAlertDays > 0, days: stage.defaultAlertDays };
    return acc;
  }, {} as StageAlertConfig);
};

const getDefaultVisibleClassifications = (): VisibleClassifications => {
  return {
    'null': true, // Sem classificação
    'prospect': true,
    'client': true,
    'closer': false,
    'sdr': false,
    'team': false,
    'other': true,
  };
};

const getStageConfig = (stage: FunnelStage) => {
  return FUNNEL_STAGES.find(s => s.key === stage) || FUNNEL_STAGES[0];
};

export function ProspectingFunnel() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30');
  const [activeTab, setActiveTab] = useState('overview');
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [editForm, setEditForm] = useState({ prospect_name: '', notes: '', funnel_stage: '' as FunnelStage, prospect_classification: null as ProspectClassification });
  const [draggedProspect, setDraggedProspect] = useState<Prospect | null>(null);
  const [dragOverStage, setDragOverStage] = useState<FunnelStage | null>(null);
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [classificationFilter, setClassificationFilter] = useState<ProspectClassification | 'all'>('all');
  const [alertConfig, setAlertConfig] = useState<StageAlertConfig>(() => {
    const saved = localStorage.getItem('prospecting-alert-config');
    return saved ? JSON.parse(saved) : getDefaultAlertConfig();
  });
  const [visibleClassifications, setVisibleClassifications] = useState<VisibleClassifications>(() => {
    const saved = localStorage.getItem('prospecting-visible-classifications');
    return saved ? JSON.parse(saved) : getDefaultVisibleClassifications();
  });

  // Save configs to localStorage
  useEffect(() => {
    localStorage.setItem('prospecting-alert-config', JSON.stringify(alertConfig));
  }, [alertConfig]);

  useEffect(() => {
    localStorage.setItem('prospecting-visible-classifications', JSON.stringify(visibleClassifications));
  }, [visibleClassifications]);

  // Filter prospects based on visible classifications
  const filteredProspects = useMemo(() => {
    let filtered = prospects;
    
    // Filter by visible classifications
    filtered = filtered.filter(p => {
      const classKey = p.prospect_classification || 'null';
      return visibleClassifications[classKey] !== false;
    });
    
    // Apply classification filter (dropdown)
    if (classificationFilter !== 'all') {
      filtered = filtered.filter(p => p.prospect_classification === classificationFilter);
    }
    
    return filtered;
  }, [prospects, classificationFilter, visibleClassifications]);

  // Calculate stagnant prospects
  const stagnantProspects = useMemo(() => {
    const now = new Date();
    return prospects.filter(prospect => {
      const config = alertConfig[prospect.funnel_stage];
      if (!config?.enabled || config.days === 0) return false;
      const daysSinceCreated = differenceInDays(now, new Date(prospect.created_at));
      return daysSinceCreated >= config.days;
    }).map(prospect => ({
      ...prospect,
      daysSinceCreated: differenceInDays(now, new Date(prospect.created_at))
    }));
  }, [prospects, alertConfig]);

  const isProspectStagnant = (prospect: Prospect): boolean => {
    const config = alertConfig[prospect.funnel_stage];
    if (!config?.enabled || config.days === 0) return false;
    const daysSinceCreated = differenceInDays(new Date(), new Date(prospect.created_at));
    return daysSinceCreated >= config.days;
  };

  const getDaysSinceCreated = (prospect: Prospect): number => {
    return differenceInDays(new Date(), new Date(prospect.created_at));
  };

  const fetchProspects = async () => {
    setLoading(true);
    try {
      const startDate = subDays(new Date(), parseInt(period));
      
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('id, author_username, comment_text, created_at, funnel_stage, conversation_thread_id, prospect_name, notes, post_url, prospect_classification')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setProspects((data || []).map(p => ({
        ...p,
        funnel_stage: (p.funnel_stage as FunnelStage) || 'comment',
        prospect_classification: (p.prospect_classification as ProspectClassification) || null
      })));
    } catch (error) {
      console.error('Erro ao buscar prospectos:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProspects();
  }, [period]);

  const stats = useMemo(() => {
    const byStage = FUNNEL_STAGES.reduce((acc, stage) => {
      acc[stage.key] = filteredProspects.filter(p => p.funnel_stage === stage.key).length;
      return acc;
    }, {} as Record<FunnelStage, number>);

    const totalProspects = filteredProspects.length;
    const closedCount = byStage.closed + byStage.post_sale;
    const conversionRate = totalProspects > 0 ? ((closedCount / totalProspects) * 100).toFixed(1) : '0';
    
    // Calcular taxas de conversão entre estágios
    const stageConversions = FUNNEL_STAGES.slice(0, -1).map((stage, index) => {
      const currentCount = byStage[stage.key];
      const nextStages = FUNNEL_STAGES.slice(index + 1);
      const advancedCount = nextStages.reduce((sum, s) => sum + byStage[s.key], 0);
      const rate = currentCount > 0 ? ((advancedCount / currentCount) * 100).toFixed(0) : '0';
      return { from: stage.key, rate: parseFloat(rate) };
    });

    // Classification breakdown
    const byClassification = CLASSIFICATIONS.reduce((acc, c) => {
      acc[c.key || 'null'] = filteredProspects.filter(p => p.prospect_classification === c.key).length;
      return acc;
    }, {} as Record<string, number>);

    return { byStage, totalProspects, closedCount, conversionRate, stageConversions, byClassification };
  }, [filteredProspects]);

  const funnelData = useMemo(() => {
    return FUNNEL_STAGES.map(stage => ({
      name: stage.label,
      value: stats.byStage[stage.key],
      fill: stage.key === 'comment' ? '#3b82f6' :
            stage.key === 'dm' ? '#8b5cf6' :
            stage.key === 'whatsapp' ? '#22c55e' :
            stage.key === 'visit_scheduled' ? '#f97316' :
            stage.key === 'visit_done' ? '#f59e0b' :
            stage.key === 'closed' ? '#10b981' : '#14b8a6'
    }));
  }, [stats]);

  const dailyData = useMemo(() => {
    const days = parseInt(period);
    const data: { date: string; novos: number; avancaram: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);

      const dayProspects = prospects.filter(p => {
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && createdAt <= dayEnd;
      });

      const novos = dayProspects.filter(p => p.funnel_stage === 'comment').length;
      const avancaram = dayProspects.filter(p => p.funnel_stage !== 'comment').length;

      data.push({
        date: format(date, 'dd/MM', { locale: ptBR }),
        novos,
        avancaram
      });
    }

    return data.slice(-14); // Últimos 14 dias
  }, [prospects, period]);

  const handleUpdateProspect = async () => {
    if (!editingProspect) return;

    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({
          prospect_name: editForm.prospect_name || null,
          notes: editForm.notes || null,
          funnel_stage: editForm.funnel_stage,
          prospect_classification: editForm.prospect_classification
        })
        .eq('id', editingProspect.id);

      if (error) throw error;

      toast.success('Prospecto atualizado!');
      setEditingProspect(null);
      fetchProspects();
    } catch (error) {
      console.error('Erro ao atualizar:', error);
      toast.error('Erro ao atualizar prospecto');
    }
  };

  const handleAdvanceStage = async (prospect: Prospect) => {
    const currentIndex = FUNNEL_STAGES.findIndex(s => s.key === prospect.funnel_stage);
    if (currentIndex >= FUNNEL_STAGES.length - 1) return;

    const nextStage = FUNNEL_STAGES[currentIndex + 1].key;

    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({ funnel_stage: nextStage })
        .eq('id', prospect.id);

      if (error) throw error;

      toast.success(`Avançado para ${FUNNEL_STAGES[currentIndex + 1].label}`);
      fetchProspects();
    } catch (error) {
      console.error('Erro ao avançar estágio:', error);
      toast.error('Erro ao avançar estágio');
    }
  };

  const handleQuickClassify = async (prospect: Prospect, classification: ProspectClassification) => {
    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({ prospect_classification: classification })
        .eq('id', prospect.id);

      if (error) throw error;

      const config = getClassificationConfig(classification);
      toast.success(`Classificado como ${config.label}`);
      
      // Update local state immediately for better UX
      setProspects(prev => prev.map(p => 
        p.id === prospect.id ? { ...p, prospect_classification: classification } : p
      ));
    } catch (error) {
      console.error('Erro ao classificar:', error);
      toast.error('Erro ao classificar prospecto');
    }
  };

  const openEditDialog = (prospect: Prospect) => {
    setEditingProspect(prospect);
    setEditForm({
      prospect_name: prospect.prospect_name || '',
      notes: prospect.notes || '',
      funnel_stage: prospect.funnel_stage,
      prospect_classification: prospect.prospect_classification
    });
  };

  // Drag and drop handlers
  const handleDragStart = (prospect: Prospect) => {
    setDraggedProspect(prospect);
  };

  const handleDragEnd = () => {
    setDraggedProspect(null);
    setDragOverStage(null);
  };

  const handleDragOver = (e: React.DragEvent, stage: FunnelStage) => {
    e.preventDefault();
    setDragOverStage(stage);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStage: FunnelStage) => {
    e.preventDefault();
    setDragOverStage(null);

    if (!draggedProspect || draggedProspect.funnel_stage === targetStage) {
      setDraggedProspect(null);
      return;
    }

    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({ funnel_stage: targetStage })
        .eq('id', draggedProspect.id);

      if (error) throw error;

      const stageConfig = FUNNEL_STAGES.find(s => s.key === targetStage);
      toast.success(`Movido para ${stageConfig?.label}`);
      
      // Update local state immediately for better UX
      setProspects(prev => prev.map(p => 
        p.id === draggedProspect.id ? { ...p, funnel_stage: targetStage } : p
      ));
    } catch (error) {
      console.error('Erro ao mover prospecto:', error);
      toast.error('Erro ao mover prospecto');
    } finally {
      setDraggedProspect(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Funil de Prospecção</h2>
          <p className="text-muted-foreground">Acompanhe a jornada dos prospectos</p>
        </div>
        <div className="flex items-center gap-2">
          {stagnantProspects.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {stagnantProspects.length} parado{stagnantProspects.length > 1 ? 's' : ''}
            </Badge>
          )}
          <Button variant="outline" size="icon" onClick={() => setShowAlertSettings(true)} title="Configurações">
            <Settings className="h-4 w-4" />
          </Button>
          <Select value={classificationFilter} onValueChange={(v) => setClassificationFilter(v as ProspectClassification | 'all')}>
            <SelectTrigger className="w-[160px]">
              <Tag className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Classificação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas visíveis</SelectItem>
              {CLASSIFICATIONS.filter(c => visibleClassifications[c.key || 'null'] !== false).map(c => (
                <SelectItem key={c.key || 'null'} value={c.key || 'null'}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="365">1 ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchProspects}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              <span className="text-sm text-muted-foreground">Total Prospectos</span>
            </div>
            <p className="text-3xl font-bold mt-2">{stats.totalProspects}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="text-sm text-muted-foreground">Fechados</span>
            </div>
            <p className="text-3xl font-bold mt-2">{stats.closedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              <span className="text-sm text-muted-foreground">Taxa de Conversão</span>
            </div>
            <p className="text-3xl font-bold mt-2">{stats.conversionRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-600" />
              <span className="text-sm text-muted-foreground">Em Andamento</span>
            </div>
            <p className="text-3xl font-bold mt-2">
              {stats.totalProspects - stats.byStage.comment - stats.closedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stagnant Prospects Alert Panel */}
      {stagnantProspects.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Prospectos Parados ({stagnantProspects.length})
            </CardTitle>
            <CardDescription>
              Estes prospectos estão parados há mais tempo que o configurado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-2">
                {stagnantProspects.slice(0, 10).map(prospect => {
                  const stageConfig = getStageConfig(prospect.funnel_stage);
                  return (
                    <div key={prospect.id} className="flex items-center justify-between p-2 bg-background rounded-lg border">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={`${stageConfig.bgColor} ${stageConfig.color} border-0`}>
                          {stageConfig.icon}
                          <span className="ml-1">{stageConfig.label}</span>
                        </Badge>
                        <div>
                          <p className="font-medium text-sm">
                            {prospect.prospect_name || `@${prospect.author_username}` || 'Sem nome'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {prospect.daysSinceCreated} dias parado
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(prospect)}
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleAdvanceStage(prospect)}
                        >
                          <ArrowRight className="h-3 w-3 mr-1" />
                          Avançar
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {stagnantProspects.length > 10 && (
                  <p className="text-xs text-center text-muted-foreground pt-2">
                    +{stagnantProspects.length - 10} mais prospectos parados
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="chart">Gráficos</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Funil Visual */}
          <Card>
            <CardHeader>
              <CardTitle>Funil de Conversão</CardTitle>
              <CardDescription>Visualização do funil de prospecção</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {FUNNEL_STAGES.map((stage, index) => (
                  <div key={stage.key} className="flex items-center">
                    <div className={`flex flex-col items-center p-4 rounded-lg ${stage.bgColor} min-w-[100px]`}>
                      <div className={stage.color}>{stage.icon}</div>
                      <span className="text-xs font-medium mt-1">{stage.label}</span>
                      <span className="text-2xl font-bold mt-1">{stats.byStage[stage.key]}</span>
                      {stats.stageConversions[index] && (
                        <span className="text-xs text-muted-foreground">
                          {stats.stageConversions[index].rate}% avançam
                        </span>
                      )}
                    </div>
                    {index < FUNNEL_STAGES.length - 1 && (
                      <ChevronRight className="h-6 w-6 text-muted-foreground mx-1" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Gráfico de Barras */}
          <Card>
            <CardHeader>
              <CardTitle>Distribuição por Estágio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {funnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4">
          {/* Pipeline Kanban */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            {FUNNEL_STAGES.map(stage => {
              const stageProspects = filteredProspects.filter(p => p.funnel_stage === stage.key);
              const isDropTarget = dragOverStage === stage.key;
              return (
                <Card 
                  key={stage.key} 
                  className={`min-h-[400px] transition-all duration-200 ${
                    isDropTarget ? 'ring-2 ring-primary ring-offset-2 scale-[1.02]' : ''
                  }`}
                  onDragOver={(e) => handleDragOver(e, stage.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, stage.key)}
                >
                  <CardHeader className={`${stage.bgColor} rounded-t-lg`}>
                    <CardTitle className={`text-sm flex items-center gap-2 ${stage.color}`}>
                      {stage.icon}
                      {stage.label}
                      <Badge variant="secondary" className="ml-auto">{stageProspects.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-2">
                    <ScrollArea className="h-[350px]">
                      <div className="space-y-2">
                        {stageProspects.slice(0, 10).map(prospect => {
                          const isStagnant = isProspectStagnant(prospect);
                          const daysStagnant = getDaysSinceCreated(prospect);
                          return (
                            <Card 
                              key={prospect.id} 
                              draggable
                              onDragStart={() => handleDragStart(prospect)}
                              onDragEnd={handleDragEnd}
                              className={`p-3 cursor-grab hover:shadow-md transition-all active:cursor-grabbing ${
                                draggedProspect?.id === prospect.id ? 'opacity-50 scale-95' : ''
                              } ${isStagnant ? 'border-destructive/50 bg-destructive/5' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <p className="font-medium text-sm truncate">
                                      {prospect.prospect_name || `@${prospect.author_username}` || 'Sem nome'}
                                    </p>
                                    {isStagnant && (
                                      <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />
                                    )}
                                  </div>
                                  {/* Quick classification dropdown */}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button 
                                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 h-5 mt-1 rounded-md border-0 cursor-pointer hover:opacity-80 transition-opacity ${
                                          prospect.prospect_classification 
                                            ? `${getClassificationConfig(prospect.prospect_classification).bgColor} ${getClassificationConfig(prospect.prospect_classification).color}` 
                                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                        }`}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Tag className="h-2.5 w-2.5" />
                                        {prospect.prospect_classification 
                                          ? getClassificationConfig(prospect.prospect_classification).label 
                                          : 'Classificar'}
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-36" onClick={(e) => e.stopPropagation()}>
                                      <DropdownMenuLabel className="text-xs">Classificação</DropdownMenuLabel>
                                      <DropdownMenuSeparator />
                                      {CLASSIFICATIONS.map((c) => (
                                        <DropdownMenuItem
                                          key={c.key || 'none'}
                                          onClick={() => handleQuickClassify(prospect, c.key)}
                                          className={`text-xs cursor-pointer ${
                                            prospect.prospect_classification === c.key ? 'bg-accent' : ''
                                          }`}
                                        >
                                          <span className={`w-2 h-2 rounded-full mr-2 ${c.bgColor}`} />
                                          {c.label}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                  {prospect.comment_text && (
                                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                      {prospect.comment_text}
                                    </p>
                                  )}
                                  <p className={`text-xs mt-1 ${isStagnant ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                    {format(new Date(prospect.created_at), 'dd/MM', { locale: ptBR })}
                                    {isStagnant && ` • ${daysStagnant}d parado`}
                                  </p>
                                </div>
                              <div className="flex flex-col gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => { e.stopPropagation(); openEditDialog(prospect); }}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                {stage.key !== 'post_sale' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={(e) => { e.stopPropagation(); handleAdvanceStage(prospect); }}
                                  >
                                    <ArrowRight className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {prospect.notes && (
                              <div className="mt-2 pt-2 border-t">
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <StickyNote className="h-3 w-3" />
                                  {prospect.notes.slice(0, 50)}...
                                </p>
                              </div>
                            )}
                          </Card>
                          );
                        })}
                        {stageProspects.length > 10 && (
                          <p className="text-xs text-center text-muted-foreground">
                            +{stageProspects.length - 10} mais
                          </p>
                        )}
                        {stageProspects.length === 0 && (
                          <p className="text-xs text-center text-muted-foreground py-4">
                            Nenhum prospecto
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="chart" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Evolução Diária</CardTitle>
              <CardDescription>Novos prospectos vs prospectos que avançaram</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="novos" name="Novos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="avancaram" name="Avançaram" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={!!editingProspect} onOpenChange={() => setEditingProspect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Prospecto</DialogTitle>
            <DialogDescription>
              Atualize as informações do prospecto
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome do Prospecto</Label>
              <Input
                value={editForm.prospect_name}
                onChange={(e) => setEditForm({ ...editForm, prospect_name: e.target.value })}
                placeholder="Nome completo"
              />
            </div>
            <div>
              <Label>Estágio do Funil</Label>
              <Select
                value={editForm.funnel_stage}
                onValueChange={(value) => setEditForm({ ...editForm, funnel_stage: value as FunnelStage })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUNNEL_STAGES.map(stage => (
                    <SelectItem key={stage.key} value={stage.key}>
                      <span className="flex items-center gap-2">
                        {stage.icon}
                        {stage.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Classificação</Label>
              <Select
                value={editForm.prospect_classification || 'null'}
                onValueChange={(value) => setEditForm({ 
                  ...editForm, 
                  prospect_classification: value === 'null' ? null : value as ProspectClassification 
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma classificação" />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICATIONS.map(c => (
                    <SelectItem key={c.key || 'null'} value={c.key || 'null'}>
                      <span className={`flex items-center gap-2 ${c.color}`}>
                        <Tag className="h-3 w-3" />
                        {c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Use "Acolhedor", "SDR" ou "Equipe" para marcar comentários da sua equipe
              </p>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="Observações sobre o prospecto..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProspect(null)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateProspect}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alert Settings Dialog */}
      <Dialog open={showAlertSettings} onOpenChange={setShowAlertSettings}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configurações do Funil
            </DialogTitle>
            <DialogDescription>
              Configure quais classificações aparecem no Kanban e alertas de prospectos parados
            </DialogDescription>
          </DialogHeader>
          
          {/* Visible Classifications Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Classificações Visíveis no Kanban
            </div>
            <p className="text-xs text-muted-foreground">
              Escolha quais classificações de prospectos aparecem no pipeline para conversão
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CLASSIFICATIONS.map(c => {
                const key = c.key || 'null';
                return (
                  <div 
                    key={key} 
                    className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                      visibleClassifications[key] !== false 
                        ? `${c.bgColor} border-transparent` 
                        : 'bg-muted/30 border-dashed'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.bgColor} ${visibleClassifications[key] === false ? 'opacity-40' : ''}`} />
                      <span className={`text-xs font-medium ${visibleClassifications[key] === false ? 'text-muted-foreground' : c.color}`}>
                        {c.label}
                      </span>
                    </div>
                    <Switch
                      checked={visibleClassifications[key] !== false}
                      onCheckedChange={(checked) => setVisibleClassifications(prev => ({
                        ...prev,
                        [key]: checked
                      }))}
                      className="scale-75"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4" />
              Alertas de Prospectos Parados
            </div>
            <p className="text-xs text-muted-foreground">
              Defina quantos dias um prospecto pode ficar parado em cada estágio
            </p>
            <div className="space-y-2">
              {FUNNEL_STAGES.filter(s => s.key !== 'post_sale').map(stage => {
                const config = alertConfig[stage.key];
                return (
                  <div key={stage.key} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${stage.bgColor}`}>
                        <div className={stage.color}>{stage.icon}</div>
                      </div>
                      <span className="font-medium text-xs">{stage.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min="1"
                          max="365"
                          value={config?.days || 3}
                          onChange={(e) => setAlertConfig(prev => ({
                            ...prev,
                            [stage.key]: { ...prev[stage.key], days: parseInt(e.target.value) || 3 }
                          }))}
                          className="w-14 h-7 text-center text-xs"
                          disabled={!config?.enabled}
                        />
                        <span className="text-xs text-muted-foreground">d</span>
                      </div>
                      <Switch
                        checked={config?.enabled || false}
                        onCheckedChange={(checked) => setAlertConfig(prev => ({
                          ...prev,
                          [stage.key]: { ...prev[stage.key], enabled: checked }
                        }))}
                        className="scale-75"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                setAlertConfig(getDefaultAlertConfig());
                setVisibleClassifications(getDefaultVisibleClassifications());
              }}
            >
              Restaurar Padrões
            </Button>
            <Button size="sm" onClick={() => setShowAlertSettings(false)}>
              Feito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
