import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Plus, CheckCircle2, Clock, AlertCircle, Loader2, ListTodo } from 'lucide-react';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';

interface LeadActivity {
  id: string;
  title: string;
  activity_type: string;
  status: string;
  priority: string | null;
  deadline: string | null;
  assigned_to_name: string | null;
  created_at: string;
  completed_at: string | null;
}

interface LeadActivitiesTabProps {
  leadId: string;
  leadName: string;
}

export function LeadActivitiesTab({ leadId, leadName }: LeadActivitiesTabProps) {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('normal');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');

  const { types: activityTypes } = useActivityTypes();
  const { configs: timeBlockSettings } = useTimeBlockSettings();

  // Filter types by user's routine
  const allowedTypes = timeBlockSettings.length > 0
    ? activityTypes.filter(t => timeBlockSettings.some(c => c.activityType === t.key))
    : activityTypes;

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, title, activity_type, status, priority, deadline, assigned_to_name, created_at, completed_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (!error && data) setActivities(data as LeadActivity[]);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('Informe o título'); return; }
    if (!type) { toast.error('Selecione o tipo de atividade'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('lead_activities').insert({
        title,
        lead_id: leadId,
        lead_name: leadName,
        activity_type: type,
        status: 'pendente',
        priority,
        deadline: deadline || null,
        description: description || null,
        created_by: user?.id || null,
      } as any);

      if (error) throw error;
      toast.success('Atividade criada!');
      setTitle('');
      setType('');
      setPriority('normal');
      setDeadline('');
      setDescription('');
      setShowForm(false);
      await fetchActivities();
    } catch {
      toast.error('Erro ao criar atividade');
    } finally {
      setSaving(false);
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
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)} className="gap-1">
          <Plus className="h-3 w-3" />
          Nova
        </Button>
      </div>

      {showForm && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div>
            <Label className="text-xs">Título *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título da atividade" className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
              <Select value={priority} onValueChange={setPriority}>
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
            <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição..." rows={2} className="text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Criar
            </Button>
          </div>
        </div>
      )}

      {activities.length === 0 && !showForm ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Nenhuma atividade vinculada a este lead.
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map(a => (
            <div key={a.id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors">
              <button onClick={() => a.status !== 'concluida' && handleComplete(a.id)} className="shrink-0">
                {statusIcon(a.status)}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${a.status === 'concluida' ? 'line-through text-muted-foreground' : ''}`}>
                  {a.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1" style={{ borderColor: getTypeColor(a.activity_type) }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getTypeColor(a.activity_type) }} />
                    {getTypeLabel(a.activity_type)}
                  </Badge>
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
    </div>
  );
}
