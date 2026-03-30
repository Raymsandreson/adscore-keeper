import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Plus, CheckCircle2, Clock, AlertCircle, Loader2, ListTodo, Save, Trash2, Play, MessageCircle, Sparkles } from 'lucide-react';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityNotesField } from '@/components/activities/ActivityNotesField';
import { ActivityChatSheet } from '@/components/activities/ActivityChatSheet';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface LeadActivity {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string | null;
  deadline: string | null;
  assigned_to_name: string | null;
  created_at: string;
  completed_at: string | null;
  what_was_done: string | null;
  current_status_notes: string | null;
  next_steps: string | null;
  notes: string | null;
  matrix_quadrant: string | null;
}

interface LeadActivitiesTabProps {
  leadId: string;
  leadName: string;
}

export function LeadActivitiesTab({ leadId, leadName }: LeadActivitiesTabProps) {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChatSheet, setShowChatSheet] = useState(false);

  // Edit state
  const [editActivity, setEditActivity] = useState<LeadActivity | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState('');
  const [editPriority, setEditPriority] = useState('normal');
  const [editDeadline, setEditDeadline] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('pendente');
  const [editWhatWasDone, setEditWhatWasDone] = useState('');
  const [editCurrentStatusNotes, setEditCurrentStatusNotes] = useState('');
  const [editNextSteps, setEditNextSteps] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [aiSuggestingType, setAiSuggestingType] = useState(false);

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

  const suggestActivityType = useCallback(async (title: string) => {
    if (!title || title.trim().length < 5) return;
    setAiSuggestingType(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-activity-type', { body: { title } });
      if (!error && data?.suggested_type) {
        const match = activityTypes.find(t => t.key === data.suggested_type);
        if (match) {
          const allowed = allowedTypes.length > 0 ? allowedTypes : activityTypes;
          if (allowed.some(t => t.key === match.key)) {
            setEditType(match.key);
            toast.info(`Tipo sugerido pela IA: ${match.label}`, { duration: 2000 });
          }
        }
      }
    } catch { /* silent */ }
    setAiSuggestingType(false);
  }, [activityTypes, allowedTypes]);

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
      const { error } = await supabase.from('lead_activities').insert({
        title: newTitle,
        lead_id: leadId,
        lead_name: leadName,
        activity_type: newType,
        status: 'pendente',
        priority: newPriority,
        deadline: newDeadline || null,
        description: newDescription || null,
        assigned_to: newAssignedTo || user?.id || null,
        assigned_to_name: newAssignedToName || null,
        created_by: user?.id || null,
      } as any);
      if (error) throw error;
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
    setLoading(true);
    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, title, description, activity_type, status, priority, deadline, assigned_to_name, created_at, completed_at, what_was_done, current_status_notes, next_steps, notes, matrix_quadrant')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (!error && data) setActivities(data as LeadActivity[]);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const openEdit = (a: LeadActivity) => {
    setEditActivity(a);
    setEditTitle(a.title);
    setEditType(a.activity_type);
    setEditPriority(a.priority || 'normal');
    setEditDeadline(a.deadline ? a.deadline.slice(0, 16) : '');
    setEditDescription(a.description || '');
    setEditStatus(a.status);
    setEditWhatWasDone(a.what_was_done || '');
    setEditCurrentStatusNotes(a.current_status_notes || '');
    setEditNextSteps(a.next_steps || '');
  };

  const handleSaveEdit = async () => {
    if (!editActivity) return;
    if (!editTitle.trim()) { toast.error('Informe o título'); return; }
    setEditSaving(true);
    try {
      const { error } = await supabase.from('lead_activities').update({
        title: editTitle,
        activity_type: editType,
        priority: editPriority,
        deadline: editDeadline || null,
        description: editDescription || null,
        status: editStatus,
        what_was_done: editWhatWasDone || null,
        current_status_notes: editCurrentStatusNotes || null,
        next_steps: editNextSteps || null,
      }).eq('id', editActivity.id);
      if (error) throw error;
      toast.success('Atividade atualizada!');
      setEditActivity(null);
      await fetchActivities();
    } catch {
      toast.error('Erro ao atualizar');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCompleteEdit = async () => {
    if (!editActivity) return;
    setEditSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('lead_activities').update({
        status: 'concluida',
        completed_at: new Date().toISOString(),
        completed_by: user?.id || null,
        what_was_done: editWhatWasDone || null,
        current_status_notes: editCurrentStatusNotes || null,
        next_steps: editNextSteps || null,
      }).eq('id', editActivity.id);
      if (error) throw error;
      toast.success('Atividade concluída!');
      setEditActivity(null);
      await fetchActivities();
    } catch {
      toast.error('Erro ao concluir');
    } finally {
      setEditSaving(false);
    }
  };

  const handleStartEdit = async () => {
    if (!editActivity) return;
    setEditSaving(true);
    try {
      const { error } = await supabase.from('lead_activities').update({
        status: 'em_andamento',
      }).eq('id', editActivity.id);
      if (error) throw error;
      toast.success('Atividade em andamento!');
      setEditStatus('em_andamento');
      await fetchActivities();
    } catch {
      toast.error('Erro ao atualizar');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteEdit = async () => {
    if (!editActivity) return;
    setEditSaving(true);
    try {
      const { error } = await supabase.from('lead_activities').delete().eq('id', editActivity.id);
      if (error) throw error;
      toast.success('Atividade excluída!');
      setEditActivity(null);
      await fetchActivities();
    } catch {
      toast.error('Erro ao excluir');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateFromChat = async (activityData: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('lead_activities').insert({
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
        created_by: user?.id || null,
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
    const { error } = await supabase.from('lead_activities').update({
      status: 'concluida',
      completed_at: new Date().toISOString(),
      completed_by: user?.id || null,
    }).eq('id', id);

    if (!error) {
      toast.success('Atividade concluída!');
      await fetchActivities();
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'concluida') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === 'em_andamento') return <Clock className="h-4 w-4 text-yellow-500" />;
    return <AlertCircle className="h-4 w-4 text-red-500" />;
  };

  const getTypeLabel = (key: string) => {
    const found = activityTypes.find(t => t.key === key);
    return found?.label || key;
  };

  const getTypeColor = (key: string) => {
    const found = activityTypes.find(t => t.key === key);
    return found?.color || '#888';
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
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          <ListTodo className="h-4 w-4" />
          Atividades ({activities.length})
        </h4>
        <div className="flex items-center gap-1.5">
          <TeamChatButton entityType="lead" entityId={leadId} entityName={leadName} variant="icon" />
          <Button size="sm" variant="outline" onClick={() => setShowChatSheet(true)} className="gap-1">
            <Sparkles className="h-3 w-3" />
            IA
          </Button>
          <Button size="sm" onClick={() => setShowNewSheet(true)} className="gap-1">
            <Plus className="h-3 w-3" />
            Nova
          </Button>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Nenhuma atividade vinculada a este lead.
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map(a => (
            <div
              key={a.id}
              className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => openEdit(a)}
            >
              <button
                onClick={e => { e.stopPropagation(); if (a.status !== 'concluida') handleComplete(a.id); }}
                className="shrink-0"
              >
                {statusIcon(a.status)}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${a.status === 'concluida' ? 'line-through text-muted-foreground' : ''}`}>
                  {a.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1" style={{ borderColor: getTypeColor(a.activity_type) }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getTypeColor(a.activity_type) }} />
                    {getTypeLabel(a.activity_type)}
                  </Badge>
                  {a.matrix_quadrant && quadrantLabels[a.matrix_quadrant] && (
                    <span className="text-[10px] text-muted-foreground">
                      {quadrantLabels[a.matrix_quadrant]}
                    </span>
                  )}
                  {a.deadline && (
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(a.deadline), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  )}
                  {a.assigned_to_name && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                      {a.assigned_to_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Activity Sheet */}
      <Sheet open={!!editActivity} onOpenChange={open => !open && setEditActivity(null)}>
        <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
            <SheetTitle className="text-base">Editar Atividade</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-3 pb-4">
              <div>
                <Label className="text-xs">Título *</Label>
                <Input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={() => suggestActivityType(editTitle)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="em_andamento">Em Andamento</SelectItem>
                    <SelectItem value="concluida">Concluída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Tipo
                    {aiSuggestingType && <Sparkles className="h-3 w-3 animate-pulse text-amber-500" />}
                  </Label>
                  <Select value={editType} onValueChange={setEditType}>
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
                  <Select value={editPriority} onValueChange={setEditPriority}>
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
                <Label className="text-xs">Prazo</Label>
                <Input type="datetime-local" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <ActivityNotesField
                  value={editDescription}
                  onChange={setEditDescription}
                  activityId={editActivity?.id}
                  placeholder="Descrição..."
                  label=""
                />
              </div>
              <div>
                <ActivityNotesField
                  value={editWhatWasDone}
                  onChange={setEditWhatWasDone}
                  activityId={editActivity?.id}
                  placeholder="Descreva o que já foi realizado..."
                  label="O que foi feito"
                />
              </div>
              <div>
                <ActivityNotesField
                  value={editCurrentStatusNotes}
                  onChange={setEditCurrentStatusNotes}
                  activityId={editActivity?.id}
                  placeholder="Situação atual..."
                  label="Status atual / Observações"
                />
              </div>
              <div>
                <ActivityNotesField
                  value={editNextSteps}
                  onChange={setEditNextSteps}
                  activityId={editActivity?.id}
                  placeholder="O que precisa ser feito a seguir..."
                  label="Próximos passos"
                />
              </div>
            </div>
          </ScrollArea>
          <div className="shrink-0 border-t p-3 flex flex-wrap gap-2">
            {editStatus === 'pendente' && (
              <Button size="sm" variant="outline" className="gap-1 text-amber-600 border-amber-300" onClick={handleStartEdit} disabled={editSaving}>
                <Play className="h-3 w-3" /> Iniciar
              </Button>
            )}
            {editStatus !== 'concluida' && (
              <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleCompleteEdit} disabled={editSaving}>
                <CheckCircle2 className="h-3 w-3" /> Concluir
              </Button>
            )}
            <Button size="sm" className="gap-1" onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar
            </Button>
            <Button size="sm" variant="destructive" className="gap-1 ml-auto" onClick={handleDeleteEdit} disabled={editSaving}>
              <Trash2 className="h-3 w-3" /> Excluir
            </Button>
          </div>
        </SheetContent>
      </Sheet>

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
    </div>
  );
}
