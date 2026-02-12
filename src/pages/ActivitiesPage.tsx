import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLeadActivities, LeadActivity } from '@/hooks/useLeadActivities';
import { useAuthContext } from '@/contexts/AuthContext';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { ActivityFieldSettingsDialog } from '@/components/activities/ActivityFieldSettingsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { UserMenu } from '@/components/auth/UserMenu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import {
  Plus, Calendar, CheckCircle2, Clock, AlertTriangle,
  FileText, Loader2, Trash2, Search, X, ChevronLeft, ChevronRight, MessageCircle, Copy, ChevronsUpDown, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
const ACTIVITY_TYPES = [
  { value: 'tarefa', label: 'Tarefa' },
  { value: 'audiencia', label: 'Audiência' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'acompanhamento', label: 'Acompanhamento' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'diligencia', label: 'Diligência' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'em_andamento', label: 'Em Andamento' },
  { value: 'concluida', label: 'Concluída' },
];

const PRIORITY_OPTIONS = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

const statusColors: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  concluida: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

const priorityColors: Record<string, string> = {
  baixa: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  alta: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  urgente: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

interface LeadOption {
  id: string;
  lead_name: string | null;
}

interface TeamMember {
  user_id: string;
  full_name: string | null;
}

const ActivitiesPage = () => {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { activities, loading, fetchActivities, createActivity, updateActivity, completeActivity, deleteActivity } = useLeadActivities();
  const { fields: fieldSettings, updateField: updateFieldSetting, reorderFields } = useActivityFieldSettings();

  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterAssignee, setFilterAssignee] = useState<string[]>([]);
  const [filterLead, setFilterLead] = useState<string[]>([]);
  const [filterContact, setFilterContact] = useState<string[]>([]);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [leadSearch, setLeadSearch] = useState('');

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formWhatWasDone, setFormWhatWasDone] = useState('');
  const [formCurrentStatus, setFormCurrentStatus] = useState('');
  const [formNextSteps, setFormNextSteps] = useState('');
  const [formType, setFormType] = useState('tarefa');
  const [formPriority, setFormPriority] = useState('normal');
  const [formLeadId, setFormLeadId] = useState<string>('');
  const [formLeadName, setFormLeadName] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToName, setFormAssignedToName] = useState('');
  const [formDeadline, setFormDeadline] = useState('');
  const [formNotificationDate, setFormNotificationDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formStatus, setFormStatus] = useState('pendente');
  const [formContactId, setFormContactId] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [availableContacts, setAvailableContacts] = useState<{id: string; full_name: string}[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  // Activity counts for filter badges
  const [allActivitiesRaw, setAllActivitiesRaw] = useState<{ lead_id: string | null; contact_id: string | null; assigned_to: string | null; activity_type: string; status: string }[]>([]);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);

  const getFilterParams = () => ({
    status: filterStatus.length > 0 ? filterStatus : 'all',
    activity_type: filterType.length > 0 ? filterType : 'all',
    assigned_to: filterAssignee.length > 0 ? filterAssignee : 'all',
    lead_id: filterLead.length > 0 ? filterLead : 'all',
    contact_id: filterContact.length > 0 ? filterContact : 'all',
  });

  useEffect(() => {
    fetchActivities(getFilterParams());
  }, [fetchActivities, filterStatus, filterType, filterAssignee, filterLead, filterContact]);

  const toggleFilter = (setter: React.Dispatch<React.SetStateAction<string[]>>, current: string[], value: string) => {
    setter(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
  };

  // Fetch raw counts (lightweight)
  useEffect(() => {
    const loadCounts = async () => {
      const { data } = await supabase.from('lead_activities').select('lead_id, contact_id, assigned_to, activity_type, status');
      setAllActivitiesRaw(data || []);
    };
    loadCounts();
  }, [activities]); // refresh when activities change

  useEffect(() => {
    const loadSupport = async () => {
      const [leadsRes, membersRes, contactsRes] = await Promise.all([
        supabase.from('leads').select('id, lead_name').order('lead_name').limit(500),
        supabase.from('profiles').select('user_id, full_name'),
        supabase.from('contacts').select('id, full_name').order('full_name').limit(500),
      ]);
      setLeads(leadsRes.data || []);
      setTeamMembers(membersRes.data || []);
      setAvailableContacts(contactsRes.data || []);
    };
    loadSupport();
  }, []);

  // Pre-filter raw activities based on OTHER active filters (excluding the field being counted)
  const getFilteredRaw = useMemo(() => {
    return (excludeField: string) => {
      let filtered = allActivitiesRaw;
      if (excludeField !== 'assigned_to' && filterAssignee.length > 0)
        filtered = filtered.filter(a => a.assigned_to && filterAssignee.includes(a.assigned_to));
      if (excludeField !== 'activity_type' && filterType.length > 0)
        filtered = filtered.filter(a => filterType.includes(a.activity_type));
      if (excludeField !== 'status' && filterStatus.length > 0)
        filtered = filtered.filter(a => filterStatus.includes(a.status));
      if (excludeField !== 'lead_id' && filterLead.length > 0)
        filtered = filtered.filter(a => a.lead_id && filterLead.includes(a.lead_id));
      if (excludeField !== 'contact_id' && filterContact.length > 0)
        filtered = filtered.filter(a => a.contact_id && filterContact.includes(a.contact_id));
      return filtered;
    };
  }, [allActivitiesRaw, filterAssignee, filterType, filterStatus, filterLead, filterContact]);

  // Count helpers - contextual to other active filters
  const countByField = useMemo(() => {
    const countFor = (fieldKey: 'lead_id' | 'contact_id' | 'assigned_to' | 'activity_type' | 'status', value: string) => {
      const filtered = getFilteredRaw(fieldKey);
      const matching = filtered.filter(a => a[fieldKey] === value);
      return {
        open: matching.filter(a => a.status !== 'concluida').length,
        done: matching.filter(a => a.status === 'concluida').length,
      };
    };
    return countFor;
  }, [getFilteredRaw]);

  const resetForm = () => {
    setFormTitle('');
    setFormWhatWasDone('');
    setFormCurrentStatus('');
    setFormNextSteps('');
    setFormType('tarefa');
    setFormPriority('normal');
    setFormLeadId('');
    setFormLeadName('');
    setFormAssignedTo('');
    setFormAssignedToName('');
    setFormDeadline('');
    setFormNotificationDate('');
    setFormNotes('');
    setFormStatus('pendente');
    setLeadSearch('');
    setFormContactId('');
    setFormContactName('');
    setContactSearch('');
  };

  const handleCreate = async () => {
    if (!formTitle.trim()) {
      toast.error('Informe o assunto da atividade');
      return;
    }
    await createActivity({
      title: formTitle,
      description: null,
      what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null,
      next_steps: formNextSteps || null,
      activity_type: formType,
      priority: formPriority,
      lead_id: formLeadId || null,
      lead_name: formLeadName || null,
      assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null,
      deadline: formDeadline || null,
      notification_date: formNotificationDate || null,
      notes: formNotes || null,
      contact_id: formContactId || null,
      contact_name: formContactName || null,
    });
    closeSheet();
    fetchActivities(getFilterParams());
  };

  const handleOpenEdit = async (activity: LeadActivity) => {
    setSelectedActivity(activity);
    setFormTitle(activity.title);
    setFormWhatWasDone(activity.what_was_done || '');
    setFormCurrentStatus(activity.current_status_notes || '');
    setFormNextSteps(activity.next_steps || '');
    setFormType(activity.activity_type);
    setFormPriority(activity.priority || 'normal');
    setFormLeadId(activity.lead_id || '');
    setFormLeadName(activity.lead_name || '');
    setFormAssignedTo(activity.assigned_to || '');
    setFormAssignedToName(activity.assigned_to_name || '');
    setFormDeadline(activity.deadline || '');
    setFormNotificationDate(activity.notification_date || '');
    setFormNotes(activity.notes || '');
    setFormStatus(activity.status || 'pendente');
    setFormContactId(activity.contact_id || '');
    setFormContactName(activity.contact_name || '');
    // Load contacts for this lead
    if (activity.lead_id) {
      try {
        const { data: linkedData } = await supabase
          .from('contact_leads')
          .select('contact_id')
          .eq('lead_id', activity.lead_id);
        if (linkedData && linkedData.length > 0) {
          const contactIds = linkedData.map(cl => cl.contact_id);
          const { data: contactsData } = await supabase
            .from('contacts')
            .select('id, full_name')
            .in('id', contactIds)
            .order('full_name');
          setAvailableContacts(contactsData || []);
        } else {
          const { data: allContacts } = await supabase.from('contacts').select('id, full_name').order('full_name').limit(500);
          setAvailableContacts(allContacts || []);
        }
      } catch { /* keep existing */ }
    }
    setSheetMode('edit');
  };

  const handleUpdate = async () => {
    if (!selectedActivity) return;
    await updateActivity(selectedActivity.id, {
      title: formTitle,
      description: null,
      what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null,
      next_steps: formNextSteps || null,
      activity_type: formType,
      priority: formPriority,
      lead_id: formLeadId || null,
      lead_name: formLeadName || null,
      assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null,
      deadline: formDeadline || null,
      notification_date: formNotificationDate || null,
      notes: formNotes || null,
      status: formStatus,
      contact_id: formContactId || null,
      contact_name: formContactName || null,
    } as any);
    closeSheet();
    fetchActivities(getFilterParams());
  };

  const handleComplete = async (id: string) => {
    await completeActivity(id);
    fetchActivities(getFilterParams());
  };

  const handleCompleteAndCreateNext = async () => {
    if (!selectedActivity) return;
    // Save current edits first
    await updateActivity(selectedActivity.id, {
      title: formTitle,
      description: null,
      what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null,
      next_steps: formNextSteps || null,
      activity_type: formType,
      priority: formPriority,
      lead_id: formLeadId || null,
      lead_name: formLeadName || null,
      assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null,
      deadline: formDeadline || null,
      notification_date: formNotificationDate || null,
      notes: formNotes || null,
      status: formStatus,
      contact_id: formContactId || null,
      contact_name: formContactName || null,
    } as any);
    // Complete it
    await completeActivity(selectedActivity.id);
    // Create next activity keeping context
    const today = format(new Date(), 'yyyy-MM-dd');
    await createActivity({
      title: formTitle,
      description: null,
      what_was_done: null,
      current_status_notes: null,
      next_steps: null,
      activity_type: formType,
      priority: formPriority,
      lead_id: formLeadId || null,
      lead_name: formLeadName || null,
      assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null,
      deadline: today,
      notification_date: today,
      notes: null,
      contact_id: formContactId || null,
      contact_name: formContactName || null,
    });
    toast.success('Atividade concluída e próxima criada!');
    closeSheet();
    fetchActivities(getFilterParams());
  };

  const handleDelete = async (id: string) => {
    await deleteActivity(id);
    closeSheet();
    fetchActivities(getFilterParams());
  };

  const closeSheet = () => {
    setSheetMode(null);
    setSelectedActivity(null);
    resetForm();
  };

  const handleSelectLead = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    setFormLeadId(leadId);
    setFormLeadName(lead?.lead_name || '');
    setFormContactId('');
    setFormContactName('');
    setContactSearch('');
    // Fetch contacts linked to this lead
    try {
      const { data: linkedData } = await supabase
        .from('contact_leads')
        .select('contact_id')
        .eq('lead_id', leadId);
      if (linkedData && linkedData.length > 0) {
        const contactIds = linkedData.map(cl => cl.contact_id);
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('id, full_name')
          .in('id', contactIds)
          .order('full_name');
        setAvailableContacts(contactsData || []);
      } else {
        // No linked contacts, load all
        const { data: allContacts } = await supabase
          .from('contacts')
          .select('id, full_name')
          .order('full_name')
          .limit(500);
        setAvailableContacts(allContacts || []);
      }
    } catch {
      // fallback: keep existing contacts
    }
  };

  const handleClearLead = async () => {
    setFormLeadId('');
    setFormLeadName('');
    setFormContactId('');
    setFormContactName('');
    // Load all contacts
    const { data } = await supabase.from('contacts').select('id, full_name').order('full_name').limit(500);
    setAvailableContacts(data || []);
  };

  const handleSelectAssignee = (userId: string) => {
    const member = teamMembers.find(m => m.user_id === userId);
    setFormAssignedTo(userId);
    setFormAssignedToName(member?.full_name || '');
  };

  const handleDeadlineChange = (value: string) => {
    setFormDeadline(value);
    if (!formNotificationDate) {
      setFormNotificationDate(value);
    }
  };

  // Calendar data
  const calendarDays = useMemo(() => {
    const start = startOfMonth(calendarMonth);
    const end = endOfMonth(calendarMonth);
    return eachDayOfInterval({ start, end });
  }, [calendarMonth]);

  const activitiesByDate = useMemo(() => {
    const map: Record<string, LeadActivity[]> = {};
    activities.forEach(a => {
      if (a.deadline) {
        const key = a.deadline;
        if (!map[key]) map[key] = [];
        map[key].push(a);
      }
    });
    return map;
  }, [activities]);

  // Stats
  const stats = useMemo(() => {
    const open = activities.filter(a => a.status !== 'concluida').length;
    const done = activities.filter(a => a.status === 'concluida').length;
    const deadlines = activities.filter(a => a.activity_type === 'prazo' && a.status !== 'concluida').length;
    const hearings = activities.filter(a => a.activity_type === 'audiencia' && a.status !== 'concluida').length;
    const tasks = activities.filter(a => a.activity_type === 'tarefa').length;
    return { open, done, deadlines, hearings, tasks };
  }, [activities]);

  const resolveUserName = (userId: string | null) => {
    if (!userId) return null;
    return teamMembers.find(m => m.user_id === userId)?.full_name || null;
  };

  const filteredLeads = leadSearch
    ? leads.filter(l => l.lead_name?.toLowerCase().includes(leadSearch.toLowerCase()))
    : leads.slice(0, 20);

  const weekDays = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

  const activityFormContent = (
    <div className="space-y-4">
      <div>
        <Label>Assunto da atividade *</Label>
        <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Ex: ACOMPANHAR PROTOCOLO" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Assessor</Label>
          <Select value={formAssignedTo} onValueChange={handleSelectAssignee}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {teamMembers.map(m => (
                <SelectItem key={m.user_id} value={m.user_id}>{m.full_name || 'Sem nome'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Tipo de atividade</Label>
          <Select value={formType} onValueChange={setFormType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Situação</Label>
          <Select value={formStatus} onValueChange={setFormStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="em_andamento">Em Andamento</SelectItem>
              <SelectItem value="concluida">Concluída</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Prioridade</Label>
          <Select value={formPriority} onValueChange={setFormPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Prazo da atividade</Label>
          <Input type="date" value={formDeadline} onChange={e => handleDeadlineChange(e.target.value)} />
        </div>

        <div>
          <Label>Prazo de notificação</Label>
          <Input type="date" value={formNotificationDate} onChange={e => setFormNotificationDate(e.target.value)} />
        </div>
      </div>

      <div>
        <Label>Nome do cliente (Lead)</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar lead..."
            value={leadSearch}
            onChange={e => setLeadSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {(leadSearch || !formLeadId) && (
          <ScrollArea className="max-h-[100px] mt-1 border rounded-md">
            {filteredLeads.map(l => (
              <button
                key={l.id}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${formLeadId === l.id ? 'bg-accent font-medium' : ''}`}
                onClick={() => { handleSelectLead(l.id); setLeadSearch(''); }}
              >
                {l.lead_name || 'Lead sem nome'}
              </button>
            ))}
          </ScrollArea>
        )}
        {formLeadName && (
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">{formLeadName}</Badge>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleClearLead()}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      <div>
        <Label>Contato vinculado</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar contato..."
            value={contactSearch}
            onChange={e => setContactSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {(contactSearch || !formContactId) && (
          <ScrollArea className="max-h-[100px] mt-1 border rounded-md">
            {(contactSearch
              ? availableContacts.filter(c => c.full_name?.toLowerCase().includes(contactSearch.toLowerCase()))
              : availableContacts.slice(0, 20)
            ).map(c => (
              <button
                key={c.id}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${formContactId === c.id ? 'bg-accent font-medium' : ''}`}
                onClick={() => { setFormContactId(c.id); setFormContactName(c.full_name); setContactSearch(''); }}
              >
                {c.full_name}
              </button>
            ))}
          </ScrollArea>
        )}
        {formContactName && (
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">{formContactName}</Badge>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setFormContactId(''); setFormContactName(''); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Dynamic fields based on settings */}
      {fieldSettings.map(field => {
        const valueMap: Record<string, [string, (v: string) => void]> = {
          what_was_done: [formWhatWasDone, setFormWhatWasDone],
          current_status: [formCurrentStatus, setFormCurrentStatus],
          next_steps: [formNextSteps, setFormNextSteps],
          notes: [formNotes, setFormNotes],
        };
        const entry = valueMap[field.field_key];
        if (!entry) return null;
        const [value, setter] = entry;
        return (
          <div key={field.field_key}>
            <Label>{field.label}</Label>
            <Textarea value={value} onChange={e => setter(e.target.value)} placeholder={field.placeholder || ''} rows={2} />
          </div>
        );
      })}

      <Separator />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 gap-2"
          onClick={() => {
            const notifDate = formNotificationDate ? (() => {
              const d = parseISO(formNotificationDate);
              const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
              return `${format(d, 'dd/MM/yyyy')} ${dias[d.getDay()]}`;
            })() : '';

            const valueMap: Record<string, string> = {
              what_was_done: formWhatWasDone,
              current_status: formCurrentStatus,
              next_steps: formNextSteps,
              notes: formNotes,
            };

            const fieldLines = fieldSettings
              .filter(f => f.include_in_message)
              .map(f => `${f.label}: ${valueMap[f.field_key] || '—'}`)
              .join('\n\n');

            const createdByName = selectedActivity ? resolveUserName(selectedActivity.created_by) : resolveUserName(user?.id || null);
            const createdAtFmt = selectedActivity ? format(parseISO(selectedActivity.created_at), "dd/MM/yyyy 'às' HH:mm") : format(new Date(), "dd/MM/yyyy 'às' HH:mm");
            const updatedByName = selectedActivity ? resolveUserName((selectedActivity as any).updated_by) : null;
            const updatedAtFmt = selectedActivity?.updated_at && selectedActivity.updated_at !== selectedActivity.created_at ? format(parseISO(selectedActivity.updated_at), "dd/MM/yyyy 'às' HH:mm") : null;

            const msg = `*Boa tarde Sr(a). *

Assunto da atividade: ${formTitle.toUpperCase()}

${formLeadName ? `Referente ao caso de ${formLeadName}` : ''}

${fieldLines}

${formAssignedToName ? `${formAssignedToName} voltará com mais informações no dia ${notifDate || '—'}, até o final do dia.` : ''}

Criado por: ${createdByName || '—'} em ${createdAtFmt}${updatedByName && updatedAtFmt ? `\nÚltima atualização por: ${updatedByName} em ${updatedAtFmt}` : ''}

Com Carinho, ${formAssignedToName || 'Equipe'}

Estamos à disposição para quaisquer dúvidas.

🚀Avante!

Tem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;

            navigator.clipboard.writeText(msg);
            toast.success('Mensagem copiada para o WhatsApp!');
          }}
        >
          <Copy className="h-4 w-4" />
          Gerar mensagem WhatsApp
        </Button>
        <ActivityFieldSettingsDialog
          fields={fieldSettings}
          onUpdateField={updateFieldSetting}
          onReorder={reorderFields}
        />
      </div>
    </div>
  );

  if (loading && activities.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Atividades</h1>
          <UserMenu />
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Left: Calendar + Stats */}
          <div className="space-y-4">
            {/* Mini Calendar */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth(prev => subMonths(prev, 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="text-sm capitalize">
                    {format(calendarMonth, 'MMMM yyyy', { locale: ptBR })}
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth(prev => addMonths(prev, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="grid grid-cols-7 gap-1 text-center">
                  {weekDays.map(d => (
                    <div key={d} className="text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                  ))}
                  {Array.from({ length: (calendarDays[0]?.getDay() || 7) - 1 }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {calendarDays.map(day => {
                    const dateKey = format(day, 'yyyy-MM-dd');
                    const dayActivities = activitiesByDate[dateKey] || [];
                    const openCount = dayActivities.filter(a => a.status !== 'concluida').length;
                    const doneCount = dayActivities.filter(a => a.status === 'concluida').length;

                    return (
                      <div
                        key={dateKey}
                        className={`relative p-1 rounded-md text-xs ${
                          isToday(day) ? 'ring-2 ring-primary font-bold' : ''
                        } ${dayActivities.length > 0 ? 'bg-muted/50' : ''}`}
                      >
                        <div className="text-center">{format(day, 'd')}</div>
                        {dayActivities.length > 0 && (
                          <div className="flex justify-center gap-0.5 mt-0.5">
                            {openCount > 0 && (
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500" />
                            )}
                            {doneCount > 0 && (
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Em aberto:</span>
                  <span className="font-bold text-yellow-600">{stats.open}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span>Concluídas:</span>
                  <span className="font-bold text-green-600">{stats.done}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span>Prazos:</span>
                  <span className="font-bold">{stats.deadlines}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span>Audiências:</span>
                  <span className="font-bold">{stats.hearings}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span>Tarefas:</span>
                  <span className="font-bold">{stats.tasks}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Activities List */}
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Assessor */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Assessor</span>
                <Popover open={openFilterKey === 'assignee'} onOpenChange={o => setOpenFilterKey(o ? 'assignee' : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-[180px] h-9 justify-between text-sm font-normal">
                      {filterAssignee.length === 0 ? 'Todos' : filterAssignee.length === 1 ? (teamMembers.find(m => m.user_id === filterAssignee[0])?.full_name || 'Sem nome') : `${filterAssignee.length} selecionados`}
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[260px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar assessor..." />
                      <CommandList>
                        <CommandEmpty>Nenhum encontrado</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="__clear_all_assessor" onSelect={() => setFilterAssignee([])}>
                            <Check className={cn("mr-2 h-3.5 w-3.5", filterAssignee.length === 0 ? "opacity-100" : "opacity-0")} />
                            Todos
                          </CommandItem>
                          {teamMembers.map(m => {
                            const c = countByField('assigned_to', m.user_id);
                            const isSelected = filterAssignee.includes(m.user_id);
                            return (
                              <CommandItem key={m.user_id} value={m.full_name || m.user_id} onSelect={() => toggleFilter(setFilterAssignee, filterAssignee, m.user_id)}>
                                <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                                <span className="flex-1 truncate">{m.full_name || 'Sem nome'}</span>
                                <span className="ml-2 flex gap-1 text-[10px]">
                                  <Badge variant="outline" className="px-1 py-0 text-[10px]">{c.open}⏳</Badge>
                                  <Badge variant="secondary" className="px-1 py-0 text-[10px]">{c.done}✓</Badge>
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Tipo */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Tipo</span>
                <Popover open={openFilterKey === 'type'} onOpenChange={o => setOpenFilterKey(o ? 'type' : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-[160px] h-9 justify-between text-sm font-normal">
                      {filterType.length === 0 ? 'Todos' : filterType.length === 1 ? (ACTIVITY_TYPES.find(t => t.value === filterType[0])?.label || filterType[0]) : `${filterType.length} selecionados`}
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[240px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar tipo..." />
                      <CommandList>
                        <CommandEmpty>Nenhum encontrado</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="__clear_all_type" onSelect={() => setFilterType([])}>
                            <Check className={cn("mr-2 h-3.5 w-3.5", filterType.length === 0 ? "opacity-100" : "opacity-0")} />
                            Todos
                          </CommandItem>
                          {ACTIVITY_TYPES.map(t => {
                            const c = countByField('activity_type', t.value);
                            const isSelected = filterType.includes(t.value);
                            return (
                              <CommandItem key={t.value} value={t.label} onSelect={() => toggleFilter(setFilterType, filterType, t.value)}>
                                <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                                <span className="flex-1">{t.label}</span>
                                <span className="ml-2 flex gap-1 text-[10px]">
                                  <Badge variant="outline" className="px-1 py-0 text-[10px]">{c.open}⏳</Badge>
                                  <Badge variant="secondary" className="px-1 py-0 text-[10px]">{c.done}✓</Badge>
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Status</span>
                <Popover open={openFilterKey === 'status'} onOpenChange={o => setOpenFilterKey(o ? 'status' : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-[160px] h-9 justify-between text-sm font-normal">
                      {filterStatus.length === 0 ? 'Todos' : filterStatus.length === 1 ? (STATUS_OPTIONS.find(s => s.value === filterStatus[0])?.label || filterStatus[0]) : `${filterStatus.length} selecionados`}
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[220px] p-0" align="start">
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          <CommandItem value="__clear_all_status" onSelect={() => setFilterStatus([])}>
                            <Check className={cn("mr-2 h-3.5 w-3.5", filterStatus.length === 0 ? "opacity-100" : "opacity-0")} />
                            Todos
                          </CommandItem>
                          {STATUS_OPTIONS.filter(s => s.value !== 'all').map(s => {
                            const isSelected = filterStatus.includes(s.value);
                            const c = countByField('status', s.value);
                            return (
                              <CommandItem key={s.value} value={s.label} onSelect={() => toggleFilter(setFilterStatus, filterStatus, s.value)}>
                                <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                                <span className="flex-1">{s.label}</span>
                                <span className="ml-2 flex gap-1 text-[10px]">
                                  <Badge variant="outline" className="px-1 py-0 text-[10px]">{c.open}⏳</Badge>
                                  <Badge variant="secondary" className="px-1 py-0 text-[10px]">{c.done}✓</Badge>
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Lead */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Lead</span>
                <Popover open={openFilterKey === 'lead'} onOpenChange={o => setOpenFilterKey(o ? 'lead' : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-[200px] h-9 justify-between text-sm font-normal">
                      <span className="truncate">{filterLead.length === 0 ? 'Todos' : filterLead.length === 1 ? (leads.find(l => l.id === filterLead[0])?.lead_name || 'Sem nome') : `${filterLead.length} selecionados`}</span>
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar lead..." />
                      <CommandList>
                        <CommandEmpty>Nenhum encontrado</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="__clear_all_lead" onSelect={() => setFilterLead([])}>
                            <Check className={cn("mr-2 h-3.5 w-3.5", filterLead.length === 0 ? "opacity-100" : "opacity-0")} />
                            Todos
                          </CommandItem>
                          {leads.map(l => {
                            const c = countByField('lead_id', l.id);
                            const isSelected = filterLead.includes(l.id);
                            return (
                              <CommandItem key={l.id} value={l.lead_name || l.id} onSelect={() => toggleFilter(setFilterLead, filterLead, l.id)}>
                                <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                                <span className="flex-1 truncate">{l.lead_name || 'Sem nome'}</span>
                                {(c.open > 0 || c.done > 0) && (
                                  <span className="ml-2 flex gap-1 text-[10px]">
                                    <Badge variant="outline" className="px-1 py-0 text-[10px]">{c.open}⏳</Badge>
                                    <Badge variant="secondary" className="px-1 py-0 text-[10px]">{c.done}✓</Badge>
                                  </span>
                                )}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Contato */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Contato</span>
                <Popover open={openFilterKey === 'contact'} onOpenChange={o => setOpenFilterKey(o ? 'contact' : null)}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-[200px] h-9 justify-between text-sm font-normal">
                      <span className="truncate">{filterContact.length === 0 ? 'Todos' : filterContact.length === 1 ? (availableContacts.find(c => c.id === filterContact[0])?.full_name || 'Sem nome') : `${filterContact.length} selecionados`}</span>
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar contato..." />
                      <CommandList>
                        <CommandEmpty>Nenhum encontrado</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="__clear_all_contact" onSelect={() => setFilterContact([])}>
                            <Check className={cn("mr-2 h-3.5 w-3.5", filterContact.length === 0 ? "opacity-100" : "opacity-0")} />
                            Todos
                          </CommandItem>
                          {availableContacts.map(c => {
                            const ct = countByField('contact_id', c.id);
                            const isSelected = filterContact.includes(c.id);
                            return (
                              <CommandItem key={c.id} value={c.full_name} onSelect={() => toggleFilter(setFilterContact, filterContact, c.id)}>
                                <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                                <span className="flex-1 truncate">{c.full_name}</span>
                                {(ct.open > 0 || ct.done > 0) && (
                                  <span className="ml-2 flex gap-1 text-[10px]">
                                    <Badge variant="outline" className="px-1 py-0 text-[10px]">{ct.open}⏳</Badge>
                                    <Badge variant="secondary" className="px-1 py-0 text-[10px]">{ct.done}✓</Badge>
                                  </span>
                                )}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase">&nbsp;</span>
                <div className="flex gap-1">
                  {(filterStatus.length > 0 || filterType.length > 0 || filterAssignee.length > 0 || filterLead.length > 0 || filterContact.length > 0) && (
                    <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground hover:text-destructive" onClick={() => { setFilterStatus([]); setFilterType([]); setFilterAssignee([]); setFilterLead([]); setFilterContact([]); }}>
                      <X className="h-3.5 w-3.5 mr-1" />
                      Limpar
                    </Button>
                  )}
                  <Button size="icon" className="rounded-full h-9 w-9" onClick={() => { resetForm(); setSheetMode('create'); }}>
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Activity Cards */}
            <div className="space-y-3">
              {activities.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p>Nenhuma atividade encontrada</p>
                    <Button variant="outline" className="mt-4" onClick={() => { resetForm(); setSheetMode('create'); }}>
                      Criar Atividade
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                activities.map(activity => (
                  <Card
                    key={activity.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => handleOpenEdit(activity)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge className={statusColors[activity.status] || 'bg-muted'}>
                              {STATUS_OPTIONS.find(s => s.value === activity.status)?.label || activity.status}
                            </Badge>
                            {activity.priority && activity.priority !== 'normal' && (
                              <Badge className={priorityColors[activity.priority] || ''}>
                                {PRIORITY_OPTIONS.find(p => p.value === activity.priority)?.label}
                              </Badge>
                            )}
                          </div>

                          <h3 className="font-medium text-sm mt-1">{activity.title}</h3>

                          {activity.lead_name && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {activity.lead_name}
                            </p>
                          )}

                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                            {activity.deadline && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {format(parseISO(activity.deadline), 'dd/MM/yyyy')}
                              </span>
                            )}
                            {activity.assigned_to_name && (
                              <span>{activity.assigned_to_name}</span>
                            )}
                            <span>
                              {ACTIVITY_TYPES.find(t => t.value === activity.activity_type)?.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                            <span>Criado por: {resolveUserName(activity.created_by) || '—'} em {format(parseISO(activity.created_at), "dd/MM 'às' HH:mm")}</span>
                            {activity.updated_at && activity.updated_at !== activity.created_at && (
                              <span>• Atualizado por: {resolveUserName((activity as any).updated_by) || '—'} em {format(parseISO(activity.updated_at), "dd/MM 'às' HH:mm")}</span>
                            )}
                          </div>
                        </div>

                        {activity.status !== 'concluida' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={e => { e.stopPropagation(); handleComplete(activity.id); }}
                          >
                            <CheckCircle2 className="h-5 w-5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sheet for Create / Edit */}
      <Sheet open={sheetMode !== null} onOpenChange={open => { if (!open) closeSheet(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{sheetMode === 'create' ? 'Nova Atividade' : 'Editar Atividade'}</SheetTitle>
          </SheetHeader>

          <div className="mt-4">
            {activityFormContent}
          </div>

          {sheetMode === 'edit' && selectedActivity?.completed_at && (
            <p className="text-xs text-muted-foreground mt-3">
              Concluída por: {selectedActivity.completed_by_name || '—'} em{' '}
              {format(parseISO(selectedActivity.completed_at), "dd/MM/yyyy 'às' HH:mm")}
            </p>
          )}

          {sheetMode === 'edit' && selectedActivity && (
            <div className="text-xs text-muted-foreground mt-3 space-y-1">
              <p>Criado por: {resolveUserName(selectedActivity.created_by) || '—'} em {format(parseISO(selectedActivity.created_at), "dd/MM/yyyy 'às' HH:mm")}</p>
              {selectedActivity.updated_at && selectedActivity.updated_at !== selectedActivity.created_at && (
                <p>Última atualização por: {resolveUserName((selectedActivity as any).updated_by) || '—'} em {format(parseISO(selectedActivity.updated_at), "dd/MM/yyyy 'às' HH:mm")}</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-6 pt-4 border-t">
            {sheetMode === 'edit' ? (
              <>
                <div className="flex items-center justify-between">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => selectedActivity && handleDelete(selectedActivity.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Excluir
                  </Button>
                  <div className="flex gap-2">
                    {selectedActivity?.status !== 'concluida' && (
                      <Button variant="outline" size="sm" onClick={() => selectedActivity && handleComplete(selectedActivity.id)}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Concluir
                      </Button>
                    )}
                    <Button size="sm" onClick={handleUpdate}>Salvar</Button>
                  </div>
                </div>
                {selectedActivity?.status !== 'concluida' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={handleCompleteAndCreateNext}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Concluir e Criar Próxima Atv
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={closeSheet}>Cancelar</Button>
                  <Button size="sm" onClick={handleCreate}>Criar</Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ActivitiesPage;
