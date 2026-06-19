import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { format, parseISO, startOfDay, differenceInCalendarDays } from 'date-fns';
import { Plus, CheckCircle2, Calendar, Loader2, ListTodo, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityChatSheet } from '@/components/activities/ActivityChatSheet';
import { ActivityEditSheet } from '@/components/activities/ActivityEditSheet';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { GroupExitAlert } from '@/components/whatsapp/GroupExitAlert';

interface LeadActivity {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string | null;
  deadline: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_at: string;
  completed_at: string | null;
  what_was_done: string | null;
  current_status_notes: string | null;
  next_steps: string | null;
  notes: string | null;
  matrix_quadrant: string | null;
}

// Module-level cache: instant render on re-open, background revalidation
const activitiesCache = new Map<string, LeadActivity[]>();
const activitiesRequests = new Map<string, Promise<LeadActivity[]>>();

const loadLeadActivities = async (leadId: string, force = false): Promise<LeadActivity[]> => {
  if (!force && activitiesCache.has(leadId)) {
    return activitiesCache.get(leadId) || [];
  }

  const inFlight = activitiesRequests.get(leadId);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const { data, error } = await externalSupabase
        .from('lead_activities')
        .select('id, title, description, activity_type, status, priority, deadline, assigned_to, assigned_to_name, created_at, completed_at, what_was_done, current_status_notes, next_steps, notes, matrix_quadrant')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const list = (data || []) as LeadActivity[];
      activitiesCache.set(leadId, list);
      return list;
    } finally {
      activitiesRequests.delete(leadId);
    }
  })();

  activitiesRequests.set(leadId, request);
  return request;
};

export const prefetchLeadActivities = async (leadId: string) => {
  await loadLeadActivities(leadId, true);
};

// Situação temporal derivada (mesma lógica da ActivitiesPage): a fita do topo
// codifica a situação (atrasada/vence hoje/concluída/pendente), não a prioridade.
type TemporalStatus = 'atrasada' | 'hoje' | 'pendente' | 'concluida';

const getTemporalStatus = (a: { status?: string | null; deadline?: string | null }): TemporalStatus => {
  if (a.status === 'concluida') return 'concluida';
  if (a.deadline) {
    try {
      const diff = differenceInCalendarDays(startOfDay(parseISO(a.deadline)), startOfDay(new Date()));
      if (diff < 0) return 'atrasada';
      if (diff === 0) return 'hoje';
    } catch { /* deadline inválido: trata como pendente */ }
  }
  return 'pendente';
};

const statusRibbonLabels: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em Andamento',
  concluida: 'Concluída',
};

const getTemporalRibbon = (
  a: { status?: string | null; deadline?: string | null },
): { className: string; label: string } => {
  const ts = getTemporalStatus(a);
  if (ts === 'atrasada') {
    const dias = a.deadline
      ? Math.abs(differenceInCalendarDays(startOfDay(parseISO(a.deadline)), startOfDay(new Date())))
      : 0;
    const sufixo = dias === 1 ? 'venceu há 1 dia' : dias > 1 ? `venceu há ${dias} dias` : 'venceu';
    return { className: 'bg-red-600 text-white', label: `Atrasada · ${sufixo}` };
  }
  if (ts === 'hoje') return { className: 'bg-amber-500 text-white', label: 'Vence hoje' };
  if (ts === 'concluida') return { className: 'bg-emerald-600 text-white', label: 'Concluída' };
  const rawLabel = statusRibbonLabels[a.status || ''] || 'Pendente';
  return { className: 'bg-muted text-muted-foreground border-b border-border/50', label: rawLabel };
};

interface LeadActivitiesTabProps {
  leadId: string;
  leadName: string;
}

export function LeadActivitiesTab({ leadId, leadName }: LeadActivitiesTabProps) {
  const [activities, setActivities] = useState<LeadActivity[]>(() => activitiesCache.get(leadId) || []);
  const [loading, setLoading] = useState(() => !activitiesCache.has(leadId));
  const [showChatSheet, setShowChatSheet] = useState(false);
  const [editActivityId, setEditActivityId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  // New activity creation state
  const [showNewSheet, setShowNewSheet] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('tarefa');
  const [newPriority, setNewPriority] = useState('normal');
  const [newDeadline, setNewDeadline] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSaving, setNewSaving] = useState(false);
  const [newAiSuggesting, setNewAiSuggesting] = useState(false);
  const [newAssignedTo, setNewAssignedTo] = useState('');
  const [newAssignedToName, setNewAssignedToName] = useState('');

  const { types: activityTypes } = useActivityTypes();
  const profiles = useProfilesList();
  const { configs: timeBlockSettings } = useTimeBlockSettings();

  const allowedTypes = timeBlockSettings.length > 0
    ? activityTypes.filter(t => timeBlockSettings.some(c => c.activityType === t.key))
    : activityTypes;

  const suggestNewActivityType = useCallback(async (title: string) => {
    if (!title || title.trim().length < 5) return;
    setNewAiSuggesting(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-activity-type', { body: { title } });
      if (!error && data?.suggested_type) {
        const match = activityTypes.find(t => t.key === data.suggested_type);
        if (match) {
          const allowed = allowedTypes.length > 0 ? allowedTypes : activityTypes;
          if (allowed.some(t => t.key === match.key)) {
            setNewType(match.key);
            toast.info(`Tipo sugerido pela IA: ${match.label}`, { duration: 2000 });
          }
        }
      }
    } catch { /* silent */ }
    setNewAiSuggesting(false);
  }, [activityTypes, allowedTypes]);

  const handleCreateActivity = async () => {
    if (!newTitle.trim()) { toast.error('Informe o título'); return; }
    setNewSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const extCreatedBy = await remapToExternal(user?.id);
      const extAssignedTo = await remapToExternal(newAssignedTo || user?.id || null);
      const { data, error } = await externalSupabase.from('lead_activities').insert({
        title: newTitle,
        lead_id: leadId,
        lead_name: leadName,
        activity_type: newType,
        status: 'pendente',
        priority: newPriority,
        deadline: newDeadline || null,
        description: newDescription || null,
        assigned_to: extAssignedTo,
        assigned_to_name: newAssignedToName || null,
        created_by: extCreatedBy,
      } as any).select().single();
      if (error) throw error;

      if (data) {
        cloudFunctions.invoke('notify-activity-created', {
          body: {
            activity_id: data.id,
            title: newTitle,
            description: newDescription,
            activity_type: newType,
            status: 'pendente',
            priority: newPriority,
            assigned_to: newAssignedTo || user?.id,
            assigned_to_name: newAssignedToName,
            created_by: user?.id,
            deadline: newDeadline || null,
            lead_name: leadName,
            lead_id: leadId,
          },
        }).catch(() => {});
      }
      toast.success('Atividade criada!');
      setShowNewSheet(false);
      setNewTitle('');
      setNewType('tarefa');
      setNewPriority('normal');
      setNewDeadline('');
      setNewDescription('');
      setNewAssignedTo('');
      setNewAssignedToName('');
      await fetchActivities();
    } catch {
      toast.error('Erro ao criar atividade');
    } finally {
      setNewSaving(false);
    }
  };

  const fetchActivities = useCallback(async () => {
    if (!activitiesCache.has(leadId)) setLoading(true);
    try {
      const list = await loadLeadActivities(leadId, true);
      setActivities(list);
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const openEdit = (a: LeadActivity) => {
    setEditActivityId(a.id);
  };

  const handleCreateFromChat = async (activityData: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const extCreatedBy = await remapToExternal(user?.id);
      const { error } = await externalSupabase.from('lead_activities').insert({
        title: activityData.title,
        lead_id: leadId,
        lead_name: leadName,
        activity_type: activityData.activity_type || 'tarefa',
        status: 'pendente',
        priority: activityData.priority || 'normal',
        deadline: activityData.deadline || null,
        notification_date: activityData.notification_date || null,
        description: activityData.notes || null,
        what_was_done: activityData.what_was_done || null,
        current_status_notes: activityData.current_status_notes || null,
        next_steps: activityData.next_steps || null,
        matrix_quadrant: activityData.matrix_quadrant || null,
        created_by: extCreatedBy,
      } as any);
      if (error) throw error;
      toast.success('Atividade criada pela IA!');
      await fetchActivities();
    } catch {
      toast.error('Erro ao criar atividade');
    }
  };

  const handleComplete = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const extCompletedBy = await remapToExternal(user?.id);
    const { error } = await externalSupabase.from('lead_activities').update({
      status: 'concluida',
      completed_at: new Date().toISOString(),
      completed_by: extCompletedBy,
    }).eq('id', id);

    if (!error) {
      toast.success('Atividade concluída!');
      await fetchActivities();
    }
  };

  const getTypeLabel = (key: string) => {
    const found = activityTypes.find(t => t.key === key);
    return found?.label || key;
  };

  const getTypeColor = (key: string) => {
    const found = activityTypes.find(t => t.key === key);
    return found?.color || '#888';
  };

  const priorityStyle = (priority: string | null): { bg: string; label: string } => {
    switch ((priority || 'normal').toLowerCase()) {
      case 'urgente': return { bg: 'hsl(0 84% 55%)', label: 'Urgente' };
      case 'alta':    return { bg: 'hsl(25 95% 55%)', label: 'Alta' };
      case 'baixa':   return { bg: 'hsl(215 16% 47%)', label: 'Baixa' };
      default:        return { bg: 'hsl(142 60% 45%)', label: 'Normal' };
    }
  };

  const quadrantLabels: Record<string, string> = {
    do_now: '🔥 Faça Agora',
    schedule: '📅 Agende',
    delegate: '🤝 Delegue',
    eliminate: '🗑️ Retire',
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <GroupExitAlert leadId={leadId} />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="flex items-center gap-2 font-medium hover:text-primary transition-colors flex-1 text-left"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <ListTodo className="h-4 w-4" />
          <span>Atividades</span>
          <Badge variant="secondary" className="text-xs ml-1">{activities.length}</Badge>
        </button>
        <div className="flex items-center gap-1.5">
          <TeamChatButton entityType="lead" entityId={leadId} entityName={leadName} variant="icon" />
          <Button size="sm" variant="outline" onClick={() => { setCollapsed(false); setShowChatSheet(true); }} className="gap-1">
            <Sparkles className="h-3 w-3" />
            IA
          </Button>
          <Button size="sm" onClick={() => { setCollapsed(false); setShowNewSheet(true); }} className="gap-1">
            <Plus className="h-3 w-3" />
            Nova
          </Button>
        </div>
      </div>

      {!collapsed && (
        activities.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhuma atividade vinculada a este lead.
          </div>
        ) : (
          <div className="space-y-2">
            {activities.map(a => {
              const ribbon = getTemporalRibbon(a);
              const prio = priorityStyle(a.priority);
              return (
              <div
                key={a.id}
                className={cn(
                  "bg-card rounded-lg shadow-sm border border-border/50 cursor-pointer transition-all hover:shadow-md active:scale-[0.99] overflow-hidden",
                  a.status === 'concluida' && "opacity-60"
                )}
                onClick={() => openEdit(a)}
              >
                {/* Fita de situação (topo) — codifica a situação temporal, não a prioridade */}
                <div className={cn("px-3 py-1 text-[10px] font-semibold tracking-wide", ribbon.className)}>
                  {ribbon.label}
                </div>
                <div className="p-3">
                  {/* Linha de cima: badges + ação concluir */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap flex-1">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1" style={{ borderColor: getTypeColor(a.activity_type) }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getTypeColor(a.activity_type) }} />
                        {getTypeLabel(a.activity_type)}
                      </Badge>
                      {a.priority && a.priority !== 'normal' && (
                        <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: prio.bg }}>
                          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: prio.bg }} />
                          {prio.label}
                        </span>
                      )}
                      {a.matrix_quadrant && quadrantLabels[a.matrix_quadrant] && (
                        <span className="text-[10px] text-muted-foreground">
                          {quadrantLabels[a.matrix_quadrant]}
                        </span>
                      )}
                    </div>
                    {a.status !== 'concluida' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50 shrink-0"
                        onClick={e => { e.stopPropagation(); handleComplete(a.id); }}
                        title="Concluir"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Título */}
                  <h3 className={cn("font-medium text-sm mt-1.5 leading-snug", a.status === 'concluida' && "line-through text-muted-foreground")}>
                    {a.title}
                  </h3>

                  {/* Rodapé: prazo + responsável + criação */}
                  <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.deadline && (
                        <span className={cn("flex items-center gap-0.5", getTemporalStatus(a) === 'atrasada' && "text-red-600 dark:text-red-400 font-semibold")}>
                          <Calendar className="h-3 w-3" />
                          {format(parseISO(a.deadline), 'dd/MM/yyyy')}
                        </span>
                      )}
                      {a.assigned_to_name && <span>• {a.assigned_to_name}</span>}
                    </div>
                    <span>{format(parseISO(a.created_at), "dd/MM 'às' HH:mm")}</span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )
      )}

      {/* New Activity Creation Sheet */}
      <Sheet open={showNewSheet} onOpenChange={setShowNewSheet}>
        <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
            <SheetTitle className="text-base">Nova Atividade</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-3 pb-4">
              <div>
                <Label className="text-xs">Título *</Label>
                <Input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onBlur={() => suggestNewActivityType(newTitle)}
                  placeholder="Ex: Ligar para cliente, Preparar documentação..."
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Tipo
                    {newAiSuggesting && <Sparkles className="h-3 w-3 animate-pulse text-amber-500" />}
                  </Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allowedTypes.map(t => (
                        <SelectItem key={t.key} value={t.key}>
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                            {t.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Prioridade</Label>
                  <Select value={newPriority} onValueChange={setNewPriority}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Responsável</Label>
                <Select value={newAssignedTo} onValueChange={(val) => {
                  setNewAssignedTo(val);
                  const p = profiles.find(p => p.user_id === val);
                  setNewAssignedToName(p?.full_name || '');
                }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {profiles.map(p => (
                      <SelectItem key={p.user_id} value={p.user_id}>
                        {p.full_name || p.email || 'Sem nome'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Prazo</Label>
                <Input type="datetime-local" value={newDeadline} onChange={e => setNewDeadline(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Detalhes da atividade..."
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
            </div>
          </ScrollArea>
          <div className="shrink-0 border-t p-3 flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowNewSheet(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleCreateActivity} disabled={newSaving} className="gap-1">
              {newSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Criar Atividade
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* AI Chat for creating activities */}
      <ActivityChatSheet
        open={showChatSheet}
        onOpenChange={setShowChatSheet}
        activityId={null}
        leadId={leadId}
        activityTitle={undefined}
        onApplySuggestion={() => {}}
        onCreateActivity={handleCreateFromChat}
      />

      {/* Activity Edit Sheet */}
      <ActivityEditSheet
        open={!!editActivityId}
        onOpenChange={(open) => { if (!open) setEditActivityId(null); }}
        activityId={editActivityId}
        onUpdated={fetchActivities}
      />
    </div>
  );
}
