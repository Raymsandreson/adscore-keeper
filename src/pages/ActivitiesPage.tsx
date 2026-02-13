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
// Sheet removed - using split screen layout
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { UserMenu } from '@/components/auth/UserMenu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import {
  Plus, Calendar, CheckCircle2, Clock, AlertTriangle,
  FileText, Loader2, Trash2, Search, X, ChevronLeft, ChevronRight, MessageCircle, Copy, ChevronsUpDown, Check,
  Play, ArrowRight, Trophy, SkipForward, Timer, Share2, User, ExternalLink,
} from 'lucide-react';
import { WorkflowTimer } from '@/components/instagram/WorkflowTimer';
import { ActivityChatSheet } from '@/components/activities/ActivityChatSheet';
import { ActivityDetailPanel } from '@/components/activities/ActivityDetailPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  const [filterAssignee, setFilterAssignee] = useState<string[]>(() => user?.id ? [user.id] : []);
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

  // Workflow mode state
  const [workflowMode, setWorkflowMode] = useState(false);
  const [workflowQueue, setWorkflowQueue] = useState<LeadActivity[]>([]);
  const [workflowIndex, setWorkflowIndex] = useState(0);
  const [workflowCompleted, setWorkflowCompleted] = useState<{ activity: LeadActivity; action: 'completed' | 'completed_next' | 'skipped'; timeSpent: number }[]>([]);
  const [workflowFinished, setWorkflowFinished] = useState(false);
  const [workflowStartTime, setWorkflowStartTime] = useState<Date | null>(null);
  const [activityStartTime, setActivityStartTime] = useState<Date | null>(null);
  const [selectedCalDay, setSelectedCalDay] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'form' | 'context'>('form');
  const [leadPreview, setLeadPreview] = useState<{
    case_type?: string | null;
    damage_description?: string | null;
    accident_date?: string | null;
    updated_at?: string | null;
  } | null>(null);

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
    // Load contacts and lead preview for this lead
    if (activity.lead_id) {
      try {
        const [linkedData, leadPreviewRes] = await Promise.all([
          supabase.from('contact_leads').select('contact_id').eq('lead_id', activity.lead_id),
          supabase.from('leads').select('case_type, damage_description, accident_date, updated_at').eq('id', activity.lead_id).maybeSingle(),
        ]);
        setLeadPreview(leadPreviewRes.data || null);
        if (linkedData.data && linkedData.data.length > 0) {
          const contactIds = linkedData.data.map(cl => cl.contact_id);
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
    } else {
      setLeadPreview(null);
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
    setRightPanelTab('form');
    setLeadPreview(null);
    resetForm();
  };

  // === WORKFLOW MODE FUNCTIONS ===
  const startWorkflow = () => {
    const pending = activities.filter(a => a.status !== 'concluida');
    if (pending.length === 0) {
      toast.error('Não há atividades pendentes para processar');
      return;
    }
    setWorkflowQueue(pending);
    setWorkflowIndex(0);
    setWorkflowCompleted([]);
    setWorkflowFinished(false);
    setWorkflowMode(true);
    setWorkflowStartTime(new Date());
    setActivityStartTime(new Date());
    // Load first activity into form
    loadActivityIntoForm(pending[0]);
  };

  const loadActivityIntoForm = async (activity: LeadActivity) => {
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
    if (activity.lead_id) {
      try {
        const [linkedData, leadPreviewRes] = await Promise.all([
          supabase.from('contact_leads').select('contact_id').eq('lead_id', activity.lead_id),
          supabase.from('leads').select('case_type, damage_description, accident_date, updated_at').eq('id', activity.lead_id).maybeSingle(),
        ]);
        setLeadPreview(leadPreviewRes.data || null);
        if (linkedData.data && linkedData.data.length > 0) {
          const contactIds = linkedData.data.map(cl => cl.contact_id);
          const { data: contactsData } = await supabase
            .from('contacts')
            .select('id, full_name')
            .in('id', contactIds)
            .order('full_name');
          setAvailableContacts(contactsData || []);
        }
      } catch { /* keep existing */ }
    } else {
      setLeadPreview(null);
    }
  };

  const getActivityTimeSpent = () => {
    if (!activityStartTime) return 0;
    return Math.floor((Date.now() - activityStartTime.getTime()) / 1000);
  };

  const workflowAdvance = () => {
    const nextIdx = workflowIndex + 1;
    if (nextIdx >= workflowQueue.length) {
      setWorkflowFinished(true);
      setActivityStartTime(null);
      fetchActivities(getFilterParams());
    } else {
      setWorkflowIndex(nextIdx);
      setActivityStartTime(new Date());
      loadActivityIntoForm(workflowQueue[nextIdx]);
    }
  };

  const handleWorkflowComplete = async () => {
    if (!selectedActivity) return;
    await updateActivity(selectedActivity.id, {
      title: formTitle, what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null, next_steps: formNextSteps || null,
      activity_type: formType, priority: formPriority, lead_id: formLeadId || null,
      lead_name: formLeadName || null, assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null, deadline: formDeadline || null,
      notification_date: formNotificationDate || null, notes: formNotes || null,
      status: formStatus, contact_id: formContactId || null, contact_name: formContactName || null,
    } as any);
    await completeActivity(selectedActivity.id);
    const timeSpent = getActivityTimeSpent();
    setWorkflowCompleted(prev => [...prev, { activity: selectedActivity, action: 'completed', timeSpent }]);
    workflowAdvance();
  };

  const handleWorkflowCompleteAndNext = async () => {
    if (!selectedActivity) return;
    await updateActivity(selectedActivity.id, {
      title: formTitle, what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null, next_steps: formNextSteps || null,
      activity_type: formType, priority: formPriority, lead_id: formLeadId || null,
      lead_name: formLeadName || null, assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null, deadline: formDeadline || null,
      notification_date: formNotificationDate || null, notes: formNotes || null,
      status: formStatus, contact_id: formContactId || null, contact_name: formContactName || null,
    } as any);
    await completeActivity(selectedActivity.id);
    const today = format(new Date(), 'yyyy-MM-dd');
    await createActivity({
      title: formTitle, what_was_done: null, current_status_notes: null, next_steps: null,
      activity_type: formType, priority: formPriority, lead_id: formLeadId || null,
      lead_name: formLeadName || null, assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null, deadline: today, notification_date: today,
      notes: null, contact_id: formContactId || null, contact_name: formContactName || null,
    });
    const timeSpent = getActivityTimeSpent();
    setWorkflowCompleted(prev => [...prev, { activity: selectedActivity, action: 'completed_next', timeSpent }]);
    workflowAdvance();
  };

  const handleWorkflowSkip = () => {
    if (!selectedActivity) return;
    const timeSpent = getActivityTimeSpent();
    setWorkflowCompleted(prev => [...prev, { activity: selectedActivity, action: 'skipped', timeSpent }]);
    workflowAdvance();
  };

  const exitWorkflow = () => {
    setWorkflowMode(false);
    setWorkflowFinished(false);
    setWorkflowQueue([]);
    setWorkflowIndex(0);
    setWorkflowCompleted([]);
    setWorkflowStartTime(null);
    setActivityStartTime(null);
    resetForm();
    setSelectedActivity(null);
    fetchActivities(getFilterParams());
  };

  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
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

  const displayedActivities = useMemo(() => {
    if (!selectedCalDay) return activities;
    return activities.filter(a => a.deadline === selectedCalDay);
  }, [activities, selectedCalDay]);

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

  if (workflowMode) {
    if (workflowFinished) {
      const completedCount = workflowCompleted.filter(w => w.action === 'completed' || w.action === 'completed_next').length;
      const nextCreated = workflowCompleted.filter(w => w.action === 'completed_next').length;
      const skippedCount = workflowCompleted.filter(w => w.action === 'skipped').length;
      const totalTime = workflowCompleted.reduce((sum, w) => sum + w.timeSpent, 0);
      const totalWorkflowTime = workflowStartTime ? Math.floor((Date.now() - workflowStartTime.getTime()) / 1000) : totalTime;
      const avgTime = workflowCompleted.length > 0 ? Math.round(totalTime / workflowCompleted.length) : 0;
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardContent className="p-8 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mx-auto">
                <Trophy className="h-10 w-10 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Parabéns! 🎉</h2>
                <p className="text-muted-foreground mt-2">Você processou todas as atividades pendentes!</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-primary">{completedCount}</div>
                  <div className="text-xs text-muted-foreground">Concluídas</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-primary">{nextCreated}</div>
                  <div className="text-xs text-muted-foreground">Próximas criadas</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-muted-foreground">{skippedCount}</div>
                  <div className="text-xs text-muted-foreground">Puladas</div>
                </div>
              </div>
              {/* Time metrics */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-center gap-1">
                    <Timer className="h-4 w-4 text-primary" />
                    <div className="text-lg font-bold text-primary">{formatDuration(totalWorkflowTime)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Tempo total</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold text-primary">{formatDuration(avgTime)}</div>
                  <div className="text-xs text-muted-foreground">Média por atv</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold text-primary">{formatDuration(totalTime)}</div>
                  <div className="text-xs text-muted-foreground">Tempo em atvs</div>
                </div>
              </div>
              <Separator />
              <div className="text-left space-y-2 max-h-60 overflow-y-auto">
                <h3 className="text-sm font-semibold mb-2">Relatório detalhado:</h3>
                {workflowCompleted.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/30">
                    {w.action === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                    {w.action === 'completed_next' && <ArrowRight className="h-4 w-4 text-blue-500 shrink-0" />}
                    {w.action === 'skipped' && <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium truncate block">{w.activity.title}</span>
                      {w.activity.lead_name && (
                        <span className="text-xs text-muted-foreground">{w.activity.lead_name}</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 gap-1 font-mono tabular-nums">
                      <Clock className="h-3 w-3" />
                      {formatDuration(w.timeSpent)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {w.action === 'completed' ? 'Concluída' : w.action === 'completed_next' ? 'Concluída + Próxima' : 'Pulada'}
                    </Badge>
                  </div>
                ))}
              </div>
              <Button className="w-full" onClick={exitWorkflow}>
                Voltar para Atividades
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    const currentActivity = workflowQueue[workflowIndex];
    const progress = workflowQueue.length > 0 ? ((workflowIndex) / workflowQueue.length) * 100 : 0;

    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={exitWorkflow}>
                  <X className="h-4 w-4 mr-1" /> Sair
                </Button>
                <h1 className="text-lg font-bold">Workflow de Atividades</h1>
              </div>
              <div className="flex items-center gap-3">
                <WorkflowTimer isRunning={!workflowFinished} startTime={activityStartTime} />
                <span className="text-sm text-muted-foreground font-medium">
                  {workflowIndex + 1} de {workflowQueue.length}
                </span>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>

        <div className="max-w-2xl mx-auto p-4">
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{currentActivity?.title}</CardTitle>
                  {currentActivity?.lead_name && (
                    <p className="text-sm text-muted-foreground mt-1">{currentActivity.lead_name}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Badge className={statusColors[currentActivity?.status] || 'bg-muted'}>
                    {STATUS_OPTIONS.find(s => s.value === currentActivity?.status)?.label}
                  </Badge>
                  {currentActivity?.deadline && (
                    <Badge variant="outline" className="text-xs">
                      <Calendar className="h-3 w-3 mr-1" />
                      {format(parseISO(currentActivity.deadline), 'dd/MM')}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardContent className="p-4">
              {activityFormContent}

              <div className="flex flex-col gap-3 mt-6 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={handleWorkflowSkip}
                  >
                    <SkipForward className="h-4 w-4" /> Pular
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={handleWorkflowComplete}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Concluir
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleWorkflowCompleteAndNext}
                >
                  <ArrowRight className="h-4 w-4" /> Concluir e Criar Próxima Atv
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }


  if (loading && activities.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isEditing = sheetMode !== null;




  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* WhatsApp-style Header */}
      <div className="bg-primary text-primary-foreground px-4 py-2.5 flex items-center justify-between shrink-0 shadow-md z-20">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Atividades</h1>
          <div className="flex items-center gap-1.5 text-primary-foreground/80 text-xs">
            <span className="bg-primary-foreground/20 rounded-full px-2 py-0.5 font-medium">{stats.open} abertas</span>
            <span className="bg-primary-foreground/20 rounded-full px-2 py-0.5 font-medium">{stats.done} concluídas</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={startWorkflow} title="Workflow">
            <Play className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={() => { resetForm(); setSheetMode('create'); }} title="Nova atividade">
            <Plus className="h-4 w-4" />
          </Button>
          <UserMenu />
        </div>
      </div>

      {/* Filters strip - compact horizontal */}
      <div className="bg-muted/30 border-b px-3 py-1.5 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
        {/* Assessor */}
        <Popover open={openFilterKey === 'assignee'} onOpenChange={o => setOpenFilterKey(o ? 'assignee' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterAssignee.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <User className="h-3 w-3" />
              {filterAssignee.length === 0 ? 'Assessor' : filterAssignee.length === 1 ? (teamMembers.find(m => m.user_id === filterAssignee[0])?.full_name?.split(' ')[0] || '1') : `${filterAssignee.length}`}
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

        {/* Tipo */}
        <Popover open={openFilterKey === 'type'} onOpenChange={o => setOpenFilterKey(o ? 'type' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterType.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <FileText className="h-3 w-3" />
              {filterType.length === 0 ? 'Tipo' : filterType.length === 1 ? (ACTIVITY_TYPES.find(t => t.value === filterType[0])?.label || '1') : `${filterType.length}`}
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

        {/* Status */}
        <Popover open={openFilterKey === 'status'} onOpenChange={o => setOpenFilterKey(o ? 'status' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterStatus.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <Clock className="h-3 w-3" />
              {filterStatus.length === 0 ? 'Status' : filterStatus.length === 1 ? (STATUS_OPTIONS.find(s => s.value === filterStatus[0])?.label || '1') : `${filterStatus.length}`}
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

        {/* Lead */}
        <Popover open={openFilterKey === 'lead'} onOpenChange={o => setOpenFilterKey(o ? 'lead' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterLead.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              📁 {filterLead.length === 0 ? 'Lead' : filterLead.length === 1 ? (leads.find(l => l.id === filterLead[0])?.lead_name?.split(' ')[0] || '1') : `${filterLead.length}`}
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

        {/* Contato */}
        <Popover open={openFilterKey === 'contact'} onOpenChange={o => setOpenFilterKey(o ? 'contact' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterContact.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <User className="h-3 w-3" />
              {filterContact.length === 0 ? 'Contato' : `${filterContact.length}`}
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

        {(filterStatus.length > 0 || filterType.length > 0 || filterAssignee.length > 0 || filterLead.length > 0 || filterContact.length > 0 || selectedCalDay) && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive shrink-0" onClick={() => { setFilterStatus([]); setFilterType([]); setFilterAssignee([]); setFilterLead([]); setFilterContact([]); setSelectedCalDay(null); }}>
            <X className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Calendar + Activity list (chat-style) */}
        <div className={cn(
          "flex flex-col overflow-hidden transition-all",
          isEditing ? "w-[400px] min-w-[340px] border-r" : "flex-1"
        )}>
          {/* Calendar - always visible, compact */}
          <div className="shrink-0 border-b bg-card/50">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCalendarMonth(prev => subMonths(prev, 1))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm font-semibold capitalize">
                {format(calendarMonth, 'MMMM yyyy', { locale: ptBR })}
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCalendarMonth(prev => addMonths(prev, 1))}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="px-3 pb-2">
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {weekDays.map(d => (
                  <div key={d} className="text-[10px] font-medium text-muted-foreground py-0.5">{d}</div>
                ))}
                {Array.from({ length: (calendarDays[0]?.getDay() || 7) - 1 }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {calendarDays.map(day => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayActivities = activitiesByDate[dateKey] || [];
                  const openCount = dayActivities.filter(a => a.status !== 'concluida').length;
                  const doneCount = dayActivities.filter(a => a.status === 'concluida').length;
                  const isSelected = selectedCalDay === dateKey;

                  return (
                    <button
                      key={dateKey}
                      onClick={() => setSelectedCalDay(isSelected ? null : dateKey)}
                      className={cn(
                        "relative p-0.5 rounded-md text-xs transition-colors",
                        isToday(day) && "ring-1.5 ring-primary font-bold",
                        isSelected && "bg-primary text-primary-foreground",
                        !isSelected && dayActivities.length > 0 && "bg-muted/60 hover:bg-muted",
                        !isSelected && dayActivities.length === 0 && "hover:bg-muted/30"
                      )}
                    >
                      <div className="text-center leading-tight">{format(day, 'd')}</div>
                      {dayActivities.length > 0 && (
                        <div className="flex justify-center gap-0.5 leading-none">
                          {openCount > 0 && (
                            <span className={cn("text-[8px] font-bold leading-none", isSelected ? "text-primary-foreground/80" : "text-red-500")}>{openCount}</span>
                          )}
                          {doneCount > 0 && (
                            <span className={cn("text-[8px] font-bold leading-none", isSelected ? "text-primary-foreground/80" : "text-green-500")}>{doneCount}</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stats by type - horizontal compact */}
            <div className="px-3 pb-2 flex gap-2 overflow-x-auto scrollbar-none">
              {ACTIVITY_TYPES.map(t => {
                const typeActivities = activities.filter(a => a.activity_type === t.value);
                const openCount = typeActivities.filter(a => a.status !== 'concluida').length;
                const doneCount = typeActivities.filter(a => a.status === 'concluida').length;
                if (openCount === 0 && doneCount === 0) return null;
                return (
                  <div key={t.value} className="flex items-center gap-1.5 text-[10px] shrink-0 bg-muted/40 rounded-full px-2 py-0.5">
                    <span className="font-medium text-muted-foreground">{t.label}</span>
                    <span className="text-red-500 font-bold">{openCount}</span>
                    <span className="text-green-500 font-bold">{doneCount}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activity list - scrollable like WhatsApp chat */}
          <div className="flex-1 overflow-y-auto bg-muted/10">
            {selectedCalDay && (
              <div className="sticky top-0 z-10 flex justify-center py-1.5">
                <Badge variant="secondary" className="text-xs shadow-sm cursor-pointer" onClick={() => setSelectedCalDay(null)}>
                  {format(parseISO(selectedCalDay), "dd 'de' MMMM", { locale: ptBR })} <X className="h-3 w-3 ml-1" />
                </Badge>
              </div>
            )}

            <div className="p-3 space-y-2">
              {displayedActivities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <FileText className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">Nenhuma atividade encontrada</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => { resetForm(); setSheetMode('create'); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Criar Atividade
                  </Button>
                </div>
              ) : (
                displayedActivities.map(activity => (
                  <div
                    key={activity.id}
                    className={cn(
                      "bg-card rounded-lg shadow-sm border border-border/50 p-3 cursor-pointer transition-all hover:shadow-md active:scale-[0.99]",
                      selectedActivity?.id === activity.id && "ring-2 ring-primary border-primary/30"
                    )}
                    onClick={() => handleOpenEdit(activity)}
                  >
                    {/* Top row: badges + actions */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        <Badge className={cn("text-[10px] px-1.5 py-0", statusColors[activity.status] || 'bg-muted')}>
                          {STATUS_OPTIONS.find(s => s.value === activity.status)?.label || activity.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {ACTIVITY_TYPES.find(t => t.value === activity.activity_type)?.label}
                        </Badge>
                        {activity.priority && activity.priority !== 'normal' && (
                          <Badge className={cn("text-[10px] px-1.5 py-0", priorityColors[activity.priority] || '')}>
                            {PRIORITY_OPTIONS.find(p => p.value === activity.priority)?.label}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {activity.status !== 'concluida' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={e => { e.stopPropagation(); handleComplete(activity.id); }} title="Concluir">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}/atividades?id=${activity.id}`); toast.success('Link copiado!'); }} title="Compartilhar">
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={e => { e.stopPropagation(); handleDelete(activity.id); }} title="Excluir">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Title */}
                    <h3 className="font-medium text-sm mt-1.5 leading-snug">{activity.title}</h3>

                    {/* Context info */}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      {activity.lead_name && (
                        <span className="flex items-center gap-1">📁 {activity.lead_name}</span>
                      )}
                      {activity.contact_name && (
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> {activity.contact_name}</span>
                      )}
                    </div>

                    {/* Bottom: deadline + timestamp */}
                    <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-2">
                        {activity.deadline && (
                          <span className="flex items-center gap-0.5">
                            <Calendar className="h-3 w-3" />
                            {format(parseISO(activity.deadline), 'dd/MM/yyyy')}
                          </span>
                        )}
                        {activity.assigned_to_name && <span>• {activity.assigned_to_name}</span>}
                      </div>
                      <span>{format(parseISO(activity.created_at), "dd/MM 'às' HH:mm")}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Form panel (WhatsApp chat-detail style) */}
        {isEditing && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Form header with lead preview */}
            <div className="bg-primary/5 border-b px-4 py-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold">
                    {sheetMode === 'create' ? 'Nova Atividade' : 'Editar Atividade'}
                  </h2>
                  {formLeadName && (
                    <p className="text-xs text-muted-foreground truncate">📁 {formLeadName}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {formLeadId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("h-7 text-xs gap-1", rightPanelTab === 'context' && "bg-primary/10")}
                      onClick={() => setRightPanelTab(rightPanelTab === 'context' ? 'form' : 'context')}
                      title="Ver detalhes do lead"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {rightPanelTab === 'context' ? 'Formulário' : 'Lead'}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeSheet}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {/* Lead preview info */}
              {formLeadId && leadPreview && (
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                  {leadPreview.case_type && (
                    <span className="flex items-center gap-0.5">
                      <FileText className="h-3 w-3" /> {leadPreview.case_type}
                    </span>
                  )}
                  {leadPreview.damage_description && (
                    <span className="flex items-center gap-0.5 truncate max-w-[150px]" title={leadPreview.damage_description}>
                      🩹 {leadPreview.damage_description}
                    </span>
                  )}
                  {leadPreview.accident_date && (
                    <span className="flex items-center gap-0.5">
                      <Calendar className="h-3 w-3" /> {format(parseISO(leadPreview.accident_date), 'dd/MM/yyyy')}
                    </span>
                  )}
                  {leadPreview.updated_at && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" /> Últ: {format(parseISO(leadPreview.updated_at), 'dd/MM HH:mm')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Switchable content: Form or Lead Context */}
            {rightPanelTab === 'form' ? (
              <>
                {/* Form body - scrollable */}
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="max-w-2xl">
                    {activityFormContent}

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
                  </div>
                </div>
              </>
            ) : (
              <ActivityDetailPanel
                leadId={formLeadId}
                leadName={formLeadName}
                currentActivityId={selectedActivity?.id || null}
                onNavigateToLead={(id) => navigate(`/leads?id=${id}`)}
              />
            )}

            {/* Action bar - sticky at bottom */}
            <div className="shrink-0 border-t border-border bg-muted/60 px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
              {sheetMode === 'edit' ? (
                <div className="flex items-center justify-between gap-2 max-w-2xl flex-wrap">
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => selectedActivity && handleDelete(selectedActivity.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1"
                        onClick={() => setChatOpen(true)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> Chat
                      </Button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {selectedActivity?.status !== 'concluida' && (
                        <Button size="sm" className="h-8 text-xs bg-success hover:bg-success/90 text-success-foreground" onClick={() => selectedActivity && handleComplete(selectedActivity.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Concluir
                        </Button>
                      )}
                      {selectedActivity?.status !== 'concluida' && (
                        <Button size="sm" className="h-8 text-xs gap-1 bg-warning hover:bg-warning/90 text-warning-foreground" onClick={handleCompleteAndCreateNext}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Concluir e Criar Próxima Atv
                        </Button>
                      )}
                      <Button size="sm" className="h-8 text-xs" onClick={handleUpdate}>Salvar</Button>
                    </div>
                  </div>
              ) : (
                <div className="flex items-center justify-between max-w-2xl">
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={closeSheet}>Cancelar</Button>
                  <Button size="sm" className="h-8 text-xs" onClick={handleCreate}>Criar</Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ActivityChatSheet
        open={chatOpen}
        onOpenChange={setChatOpen}
        activityId={selectedActivity?.id || null}
        leadId={selectedActivity?.lead_id || null}
        activityTitle={selectedActivity?.title || formTitle}
        onApplySuggestion={(suggestion) => {
          if (suggestion.what_was_done) setFormWhatWasDone(suggestion.what_was_done);
          if (suggestion.current_status_notes) setFormCurrentStatus(suggestion.current_status_notes);
          if (suggestion.next_steps) setFormNextSteps(suggestion.next_steps);
          if (suggestion.notes) setFormNotes(suggestion.notes);
        }}
      />
    </div>
  );
};

export default ActivitiesPage;
