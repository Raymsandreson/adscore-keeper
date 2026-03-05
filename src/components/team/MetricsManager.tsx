import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Pencil, Zap, TrendingUp, Trophy, Users, Settings2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  useCompanyAreas,
  useMetricDefinitions,
  useMemberAreaAssignments,
  CompanyArea,
  MetricDefinition,
} from '@/hooks/useMetricDefinitions';

const CATEGORY_CONFIG = {
  action: { label: 'Metas de Ação', icon: Zap, period: 'Diária', color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  progress: { label: 'Metas de Progresso', icon: TrendingUp, period: 'Semanal / Mensal', color: 'bg-blue-500/10 text-blue-700 border-blue-200' },
  result: { label: 'Metas de Resultado', icon: Trophy, period: 'Semanal / Mensal', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200' },
} as const;

const PERIODICITY_OPTIONS = [
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
];

const SCOPE_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'funnel', label: 'Funil de Vendas' },
  { value: 'workflow', label: 'Fluxo de Trabalho' },
];

interface MetricFormState {
  id?: string;
  name: string;
  description: string;
  area_id: string;
  category: string;
  periodicity: string;
  unit: string;
  scope_type: string;
  scope_id: string;
}

const emptyForm: MetricFormState = {
  name: '', description: '', area_id: '', category: 'action', periodicity: 'daily', unit: '', scope_type: 'global', scope_id: '',
};

export function MetricsManager() {
  const { areas, loading: areasLoading } = useCompanyAreas();
  const { metrics, loading: metricsLoading, saveMetric, deleteMetric, refetch } = useMetricDefinitions();
  const { assignments, loading: assignLoading, assignArea, removeArea, refetch: refetchAssignments } = useMemberAreaAssignments();
  const [activeCategory, setActiveCategory] = useState<string>('action');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MetricFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [profiles, setProfiles] = useState<{ user_id: string; full_name: string }[]>([]);
  const [selectedArea, setSelectedArea] = useState<CompanyArea | null>(null);

  useEffect(() => {
    supabase.from('kanban_boards').select('id, name').order('display_order').then(({ data }) => setBoards(data || []));
    supabase.from('profiles').select('user_id, full_name').then(({ data }) => setProfiles(data || []));
  }, []);

  const filteredMetrics = metrics.filter(m => m.category === activeCategory);
  const metricsByArea = areas.reduce((acc, area) => {
    acc[area.id] = filteredMetrics.filter(m => m.area_id === area.id);
    return acc;
  }, {} as Record<string, MetricDefinition[]>);

  const openNewMetric = (category: string, areaId: string) => {
    const defaultPeriodicity = category === 'action' ? 'daily' : 'monthly';
    setForm({ ...emptyForm, category, area_id: areaId, periodicity: defaultPeriodicity });
    setDialogOpen(true);
  };

  const openEditMetric = (metric: MetricDefinition) => {
    setForm({
      id: metric.id,
      name: metric.name,
      description: metric.description || '',
      area_id: metric.area_id,
      category: metric.category,
      periodicity: metric.periodicity,
      unit: metric.unit || '',
      scope_type: metric.scope_type || 'global',
      scope_id: metric.scope_id || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.area_id) {
      toast.error('Preencha o nome e a área');
      return;
    }
    setSaving(true);
    try {
      await saveMetric({
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        description: form.description || null,
        area_id: form.area_id,
        category: form.category,
        periodicity: form.periodicity,
        unit: form.unit,
        scope_type: form.scope_type || 'global',
        scope_id: form.scope_type !== 'global' && form.scope_id ? form.scope_id : null,
      } as any);
      toast.success(form.id ? 'Métrica atualizada' : 'Métrica criada');
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteMetric(id);
    toast.success('Métrica removida');
  };

  const openMembersForArea = (area: CompanyArea) => {
    setSelectedArea(area);
    setMembersDialogOpen(true);
  };

  const areaAssignments = selectedArea ? assignments.filter(a => a.area_id === selectedArea.id) : [];
  const assignedUserIds = new Set(areaAssignments.map(a => a.user_id));

  const toggleMemberArea = async (userId: string) => {
    if (!selectedArea) return;
    const existing = areaAssignments.find(a => a.user_id === userId);
    try {
      if (existing) {
        await removeArea(existing.id);
      } else {
        await assignArea(userId, selectedArea.id);
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro');
    }
  };

  if (areasLoading || metricsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Category tabs */}
      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{config.label.replace('Metas de ', '')}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {Object.entries(CATEGORY_CONFIG).map(([catKey, catConfig]) => {
          const Icon = catConfig.icon;
          return (
            <TabsContent key={catKey} value={catKey} className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5" />
                  <h2 className="text-lg font-semibold">{catConfig.label}</h2>
                  <Badge variant="outline" className="text-xs">{catConfig.period}</Badge>
                </div>
              </div>

              {areas.map(area => {
                const areaMetrics = (metricsByArea[area.id] || []);
                const memberCount = assignments.filter(a => a.area_id === area.id).length;
                return (
                  <Card key={area.id}>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{area.icon}</span>
                          <CardTitle className="text-sm font-medium">{area.name}</CardTitle>
                          <Badge variant="secondary" className="text-[10px] gap-1 cursor-pointer" onClick={() => openMembersForArea(area)}>
                            <Users className="h-3 w-3" />
                            {memberCount}
                          </Badge>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openNewMetric(catKey, area.id)}>
                          <Plus className="h-3 w-3" />
                          Métrica
                        </Button>
                      </div>
                    </CardHeader>
                    {areaMetrics.length > 0 && (
                      <CardContent className="px-4 pb-3 pt-0">
                        <div className="space-y-1.5">
                          {areaMetrics.map(metric => (
                            <div key={metric.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/40 hover:bg-muted/60 group">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-sm font-medium truncate">{metric.name}</span>
                                {metric.unit && <Badge variant="outline" className="text-[10px] shrink-0">{metric.unit}</Badge>}
                                {metric.scope_type && metric.scope_type !== 'global' && (
                                  <Badge variant="secondary" className="text-[10px] shrink-0">
                                    {metric.scope_type === 'funnel' ? 'Funil' : 'Fluxo'}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {PERIODICITY_OPTIONS.find(p => p.value === metric.periodicity)?.label}
                                </Badge>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEditMetric(metric)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDelete(metric.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Metric form dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar Métrica' : 'Nova Métrica'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Ligações realizadas" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrição opcional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Área</Label>
                <Select value={form.area_id} onValueChange={v => setForm(f => ({ ...f, area_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Área" /></SelectTrigger>
                  <SelectContent>
                    {areas.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.icon} {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Periodicidade</Label>
                <Select value={form.periodicity} onValueChange={v => setForm(f => ({ ...f, periodicity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERIODICITY_OPTIONS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unidade</Label>
                <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="Ex: unidades, min, %" />
              </div>
              <div>
                <Label>Escopo</Label>
                <Select value={form.scope_type} onValueChange={v => setForm(f => ({ ...f, scope_type: v, scope_id: '' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.scope_type !== 'global' && (
              <div>
                <Label>{form.scope_type === 'funnel' ? 'Funil de Vendas' : 'Fluxo de Trabalho'}</Label>
                <Select value={form.scope_id} onValueChange={v => setForm(f => ({ ...f, scope_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {boards.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members assignment dialog */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{selectedArea?.icon}</span> Membros — {selectedArea?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {profiles.map(p => (
                <label key={p.user_id} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer">
                  <Checkbox
                    checked={assignedUserIds.has(p.user_id)}
                    onCheckedChange={() => toggleMemberArea(p.user_id)}
                  />
                  <span className="text-sm">{p.full_name || p.user_id}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
