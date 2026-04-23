import { useState, useEffect, useMemo, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePageState } from '@/hooks/usePageState';
import { supabase } from '@/integrations/supabase/client';
import { useLeadActivities, LeadActivity } from '@/hooks/useLeadActivities';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import { useAuthContext } from '@/contexts/AuthContext';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityMessageTemplates } from '@/hooks/useActivityMessageTemplates';
import { ActivityFieldSettingsDialog } from '@/components/activities/ActivityFieldSettingsDialog';
import { ActivityTTSButton } from '@/components/voice/ActivityTTSButton';
import { ActivityFormCompact, SendToGroupSection } from '@/components/activities/ActivityFormCompact';
import { CompleteAndNotifyDialog } from '@/components/activities/CompleteAndNotifyDialog';
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
  Play, ArrowRight, Trophy, SkipForward, Timer, Share2, User, ExternalLink, RotateCcw, LayoutGrid, List, Layers, Settings2, Sparkles, TrendingUp,
} from 'lucide-react';
import { ShareMenu } from '@/components/ShareMenu';
import { WorkflowTimer } from '@/components/instagram/WorkflowTimer';
import { ActivityChatSheet } from '@/components/activities/ActivityChatSheet';
import { ActivityDetailPanel } from '@/components/activities/ActivityDetailPanel';
import { LeadFunnelProgressBar } from '@/components/activities/LeadFunnelProgressBar';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { ActivityNotesField } from '@/components/activities/ActivityNotesField';
import { TimeBlockSettingsDialog, TimeBlockConfig } from '@/components/activities/TimeBlockSettingsDialog';
import { TrafficActivityPanel } from '@/components/traffic/TrafficActivityPanel';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, isToday, parseISO, startOfWeek, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
const ACTIVITY_TYPES = [
  { value: 'tarefa', label: 'Tarefa', bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-300 dark:border-blue-700', header: 'bg-blue-500', dot: 'bg-blue-500' },
  { value: 'audiencia', label: 'Audiência', bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-300 dark:border-green-700', header: 'bg-green-500', dot: 'bg-green-500' },
  { value: 'prazo', label: 'Prazo', bg: 'bg-yellow-50 dark:bg-yellow-950/20', border: 'border-yellow-300 dark:border-yellow-700', header: 'bg-yellow-500', dot: 'bg-yellow-500' },
  { value: 'acompanhamento', label: 'Acompanhamento', bg: 'bg-purple-50 dark:bg-purple-950/20', border: 'border-purple-300 dark:border-purple-700', header: 'bg-purple-500', dot: 'bg-purple-500' },
  { value: 'reuniao', label: 'Reunião', bg: 'bg-pink-50 dark:bg-pink-950/20', border: 'border-pink-300 dark:border-pink-700', header: 'bg-pink-500', dot: 'bg-pink-500' },
  { value: 'diligencia', label: 'Diligência', bg: 'bg-orange-50 dark:bg-orange-950/20', border: 'border-orange-300 dark:border-orange-700', header: 'bg-orange-500', dot: 'bg-orange-500' },
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

const hasSelectValue = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthContext();
  const { activities, loading, fetchActivities: _fetchActivities, createActivity, updateActivity, completeActivity, deleteActivity } = useLeadActivities();
  const refreshCountsRef = useRef<(() => Promise<void>) | null>(null);
  const fetchActivities = useCallback(async (params?: Parameters<typeof _fetchActivities>[0]) => {
    await _fetchActivities(params);
    refreshCountsRef.current?.();
  }, [_fetchActivities]);
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
  const { fields: fieldSettings, updateField: updateFieldSetting, reorderFields } = useActivityFieldSettings();
  const { getTemplateForContext } = useActivityMessageTemplates();

  const [filterStatus, setFilterStatus] = usePageState<string[]>('activities_filterStatus', []);
  const [filterType, setFilterType] = usePageState<string[]>('activities_filterType', []);
  const assigneeStorageKey = useMemo(() => `page_state_activities_filterAssignee_${user?.id ?? 'pending'}`, [user?.id]);
  const [filterAssignee, setFilterAssigneeState] = useState<string[]>([]);
  const setFilterAssignee: Dispatch<SetStateAction<string[]>> = useCallback((value) => {
    setFilterAssigneeState(prev => {
      const next = typeof value === 'function' ? (value as (prev: string[]) => string[])(prev) : value;
      try {
        localStorage.setItem(assigneeStorageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [assigneeStorageKey]);
  const [filterLead, setFilterLead] = usePageState<string[]>('activities_filterLead', []);
  const [filterContact, setFilterContact] = usePageState<string[]>('activities_filterContact', []);
  const [sheetMode, setSheetMode] = usePageState<'create' | 'edit' | null>('activities_sheetMode', null);
  const [selectedActivityId, setSelectedActivityId] = usePageState<string | null>('activities_selectedId', null);
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [leadSearch, setLeadSearch] = useState('');
  const [searchedLeads, setSearchedLeads] = useState<LeadOption[]>([]);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formWhatWasDone, setFormWhatWasDone] = useState('');
  const [formCurrentStatus, setFormCurrentStatus] = useState('');
  const [formNextSteps, setFormNextSteps] = useState('');
  const [formType, setFormType] = useState('');
  const [formPriority, setFormPriority] = useState('normal');
  const [formLeadId, setFormLeadId] = useState<string>('');
  const [formLeadName, setFormLeadName] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToName, setFormAssignedToName] = useState('');
  const [formDeadline, setFormDeadline] = useState('');
  const [formNotificationDate, setFormNotificationDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formRepeatWeekDays, setFormRepeatWeekDays] = useState<number[]>([]);
  const [formStatus, setFormStatus] = useState('pendente');
  const [formContactId, setFormContactId] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formCaseId, setFormCaseId] = useState('');
  const [formCaseTitle, setFormCaseTitle] = useState('');
  const [formProcessId, setFormProcessId] = useState('');
  const [formProcessTitle, setFormProcessTitle] = useState('');
  const [availableCases, setAvailableCases] = useState<{id: string; case_number: string; title: string; lead_id: string | null}[]>([]);
  const [caseSearch, setCaseSearch] = useState('');
  const [leadCases, setLeadCases] = useState<{id: string; case_number: string; title: string}[]>([]);
  const [caseProcesses, setCaseProcesses] = useState<{id: string; title: string; process_number: string | null; polo_passivo: string | null; tribunal: string | null; area: string | null; assuntos: string[] | null; workflow_id: string | null; envolvidos: any[] | null}[]>([]);
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
  const [selectedCalDays, setSelectedCalDays] = useState<string[]>([]);
  const selectedCalDay: string | null = selectedCalDays.length > 0 ? selectedCalDays[0] : null;
  const [chatOpen, setChatOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'form' | 'context'>('form');
  const [completeNotifyOpen, setCompleteNotifyOpen] = useState(false);
  const [completeNotifySource, setCompleteNotifySource] = useState<'sheet' | 'workflow'>('sheet');
  const [showLeadSheet, setShowLeadSheet] = useState(false);
  const [viewMode, setViewMode] = usePageState<'list' | 'matrix' | 'blocks'>('activities_viewMode', 'list');
  const [formMatrixQuadrant, setFormMatrixQuadrant] = useState<string>('');
  const [dragOverQuadrant, setDragOverQuadrant] = useState<string | null>(null);
  const [aiSuggestingType, setAiSuggestingType] = useState(false);
  const aiSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [deadlineDateCount, setDeadlineDateCount] = useState<number | null>(null);
  const [notifDateCount, setNotifDateCount] = useState<number | null>(null);
  const { configs: timeBlockSettings, saveSettings: saveTimeBlockConfigs } = useTimeBlockSettings();
  // Assignee's routine: when creating/editing for another user, load their routine
  const { configs: assigneeTimeBlockSettings } = useTimeBlockSettings(formAssignedTo || user?.id || undefined);
  // Blocks view: load the routine of the single selected assignee
  const blocksViewUserId = viewMode === 'blocks' && filterAssignee.length === 1 ? filterAssignee[0] : undefined;
  const { configs: blocksViewSettings } = useTimeBlockSettings(blocksViewUserId || user?.id || undefined);
  const { types: dbActivityTypes } = useActivityTypes();
  const [timeBlockSettingsOpen, setTimeBlockSettingsOpen] = useState(false);
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null);
  const [blockSearchText, setBlockSearchText] = useState('');
  // Countdown timer state for time block click
  const [countdownBlock, setCountdownBlock] = useState<TimeBlockConfig | null>(null);
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  // Map: leadId -> activityType derived from workflow step (used in blocks view)
  const [leadWorkflowActivityTypes, setLeadWorkflowActivityTypes] = useState<Record<string, string>>({});
  const [leadPreview, setLeadPreview] = useState<{
    case_type?: string | null;
    damage_description?: string | null;
    accident_date?: string | null;
    updated_at?: string | null;
    board_id?: string | null;
    board_name?: string | null;
    lead_status?: string | null;
  } | null>(null);

  const getFilterParams = () => ({
    status: filterStatus.length > 0 ? filterStatus : 'all',
    activity_type: filterType.length > 0 ? filterType : 'all',
    assigned_to: filterAssignee.length > 0 ? filterAssignee : 'all',
    lead_id: filterLead.length > 0 ? filterLead : 'all',
    contact_id: filterContact.length > 0 ? filterContact : 'all',
  });

  useEffect(() => {
    if (!user?.id) {
      setFilterAssigneeState([]);
      return;
    }

    try {
      const stored = localStorage.getItem(assigneeStorageKey);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setFilterAssigneeState(parsed.filter((value): value is string => typeof value === 'string'));
          return;
        }
      }
    } catch {}

    // Default: show only current user's activities for better performance
    const defaultFilter = user?.id ? [user.id] : [];
    setFilterAssigneeState(defaultFilter);
    try {
      localStorage.setItem(assigneeStorageKey, JSON.stringify(defaultFilter));
    } catch {}
  }, [assigneeStorageKey, user?.id]);

  useEffect(() => {
    fetchActivities(getFilterParams());
  }, [fetchActivities, filterStatus, filterType, filterAssignee, filterLead, filterContact]);

  useEffect(() => {
    if (viewMode === 'blocks') setOpenFilterKey(null);
  }, [viewMode]);

  const toggleFilter = (setter: React.Dispatch<React.SetStateAction<string[]>>, current: string[], value: string) => {
    setter(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
  };

  // Fetch raw counts (lightweight) - only on mount, not on every activities change
  const countsLoadedRef = useRef(false);
  useEffect(() => {
    const loadCounts = async () => {
      const { data } = await supabase.from('lead_activities').select('lead_id, contact_id, assigned_to, activity_type, status').limit(2000);
      setAllActivitiesRaw(data || []);
      countsLoadedRef.current = true;
    };
    loadCounts();
  }, []); // Load once on mount
  
  // Refresh counts only after mutations (create/update/delete) - not on every fetch
  const refreshCounts = useCallback(async () => {
    const { data } = await supabase.from('lead_activities').select('lead_id, contact_id, assigned_to, activity_type, status').limit(2000);
    setAllActivitiesRaw(data || []);
  }, []);
  
  // Wire up the ref so fetchActivities wrapper can call refreshCounts
  useEffect(() => { refreshCountsRef.current = refreshCounts; }, [refreshCounts]);

  useEffect(() => {
    const loadSupport = async () => {
      const [leadsRes, membersRes, contactsRes, casesRes] = await Promise.all([
        supabase.from('leads').select('id, lead_name').order('lead_name').limit(500),
        supabase.from('profiles').select('user_id, full_name'),
        supabase.from('contacts').select('id, full_name').order('full_name').limit(500),
        supabase.from('legal_cases').select('id, case_number, title, lead_id').order('created_at', { ascending: false }).limit(500),
      ]);
      setLeads(leadsRes.data || []);
      setTeamMembers(membersRes.data || []);
      setAvailableContacts(contactsRes.data || []);
      setAvailableCases(casesRes.data || []);
    };
    loadSupport();
  }, []);

  // Load workflow step activity types: for each lead, find the activityType from workflow checklist items
  useEffect(() => {
    const loadWorkflowStepTypes = async () => {
      const { data: leadsData } = await supabase.from('leads').select('id, status, board_id');
      if (!leadsData || leadsData.length === 0) return;
      const { data: linksData } = await supabase.from('checklist_stage_links').select('stage_id, checklist_template_id');
      if (!linksData || linksData.length === 0) return;
      const templateIds = [...new Set(linksData.map(l => l.checklist_template_id))];
      const { data: templatesData } = await supabase.from('checklist_templates').select('id, items').in('id', templateIds);
      if (!templatesData) return;
      // Build map: stage_id -> first activityType found in any step
      const stageTypeMap: Record<string, string> = {};
      linksData.forEach(link => {
        if (stageTypeMap[link.stage_id]) return;
        const tmpl = templatesData.find(t => t.id === link.checklist_template_id);
        if (!tmpl) return;
        const items = (tmpl.items as any[]) || [];
        const stepWithType = items.find((item: any) => item.activityType);
        if (stepWithType?.activityType) stageTypeMap[link.stage_id] = stepWithType.activityType;
      });
      // Build map: lead_id -> activityType
      const leadTypeMap: Record<string, string> = {};
      leadsData.forEach(lead => {
        if (!lead.status) return;
        const type = stageTypeMap[lead.status];
        if (type) leadTypeMap[lead.id] = type;
      });
      setLeadWorkflowActivityTypes(leadTypeMap);
    };
    loadWorkflowStepTypes();
  }, [activities]);

  const handleCloneActivity = async (activity: LeadActivity) => {
    const { id, created_at, updated_at, completed_at, completed_by, completed_by_name, ...cloneData } = activity;
    await createActivity({
      ...cloneData,
      title: `${activity.title} (cópia)`,
      status: 'pendente',
    });
    fetchActivities(getFilterParams());
  };

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
    setFormType(timeBlockSettings.length > 0 ? timeBlockSettings[0].activityType : '');
    setFormPriority('normal');
    setFormLeadId('');
    setFormLeadName('');
    const currentUser = teamMembers.find(m => m.user_id === user?.id);
    setFormAssignedTo(user?.id || '');
    setFormAssignedToName(currentUser?.full_name || '');
    setFormDeadline('');
    setFormNotificationDate('');
    setFormNotes('');
    setFormRepeatWeekDays([]);
    setFormStatus('pendente');
    setLeadSearch('');
    setFormContactId('');
    setFormContactName('');
    setContactSearch('');
    setFormCaseId('');
    setFormCaseTitle('');
    setCaseSearch('');
    setFormProcessId('');
    setFormProcessTitle('');
    setLeadCases([]);
    setCaseProcesses([]);
    setFormMatrixQuadrant('');
  };

  // suggestActivityType moved below routineActivityTypes

  // handleTitleChange moved below routineActivityTypes

  const handleCreate = async () => {
    if (!formTitle.trim()) {
      toast.error('Informe o assunto da atividade');
      return;
    }
    if (!formType) {
      toast.error('Selecione o tipo de atividade');
      return;
    }

    const baseData = {
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
      notes: formNotes || null,
      contact_id: formContactId || null,
      contact_name: formContactName || null,
      case_id: formCaseId || null,
      case_title: formCaseTitle || null,
      process_id: formProcessId || null,
      process_title: formProcessTitle || null,
    };

    let createdActivityId: string | null = null;
    if (formRepeatWeekDays.length > 0 && formDeadline) {
      // Create one activity per selected day of the week, starting from the deadline week
      const baseDate = parseISO(formDeadline);
      const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 }); // Monday
      
      for (const dayIdx of formRepeatWeekDays) {
        const targetDate = addDays(weekStart, dayIdx);
        const dateStr = format(targetDate, 'yyyy-MM-dd');
        const result = await createActivity({
          ...baseData,
          deadline: dateStr,
          notification_date: dateStr,
        });
        if (!createdActivityId && result?.id) createdActivityId = result.id;
      }
      toast.success(`${formRepeatWeekDays.length} atividades criadas para a semana!`);
    } else {
      const result = await createActivity({
        ...baseData,
        deadline: formDeadline || null,
        notification_date: formNotificationDate || null,
      });
      if (result?.id) createdActivityId = result.id;
}

/**
 * Extrai apenas o primeiro nome do cliente a partir de uma string que pode ser
 * o nome de um grupo de WhatsApp. Exemplos:
 *  "✅PREV 291 | Allana / Irma socorro II" -> "Allana"
 *  "PREV 123 - João Silva"                 -> "João"
 *  "Maria Souza"                            -> "Maria"
 *  ""                                       -> ""
 */
function extractClientFirstName(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  // Remove emojis e símbolos comuns no início
  s = s.replace(/^[^\p{L}\p{N}]+/u, '');
  // Se houver "|", o nome do cliente costuma vir depois do primeiro "|"
  if (s.includes('|')) {
    s = s.split('|').slice(1).join('|').trim();
  }
  // Corta no primeiro "/" (separador entre cliente e familiar/grupo)
  if (s.includes('/')) {
    s = s.split('/')[0].trim();
  }
  // Corta separadores comuns entre prefixo de caso e nome
  for (const sep of [' - ', ' — ', ' – ', ':']) {
    if (s.includes(sep)) {
      s = s.split(sep).slice(-1)[0].trim();
    }
  }
  // Remove tokens iniciais que pareçam código de caso (ex.: "PREV 291", "BPC", números)
  const tokens = s.split(/\s+/);
  while (tokens.length > 1) {
    const t = tokens[0];
    const looksLikeCode = /^[A-Z]{2,}$/.test(t) || /^\d+$/.test(t) || /^[A-Z]{2,}\d+$/.test(t);
    if (looksLikeCode) tokens.shift(); else break;
  }
  // Pega só a primeira palavra "humana"
  const first = tokens[0] || '';
  // Capitaliza preservando acentos
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}


    // If created for another assignee, add them to the filter so the activities are visible
    if (formAssignedTo && formAssignedTo !== user?.id && !filterAssignee.includes(formAssignedTo)) {
      setFilterAssignee(prev => [...prev, formAssignedTo!]);
    }

    closeSheet();
    fetchActivities(getFilterParams());
  };

  const handleOpenEdit = async (activity: LeadActivity) => {
    // Set all form state synchronously first (instant UI)
    setSelectedActivity(activity);
    setSelectedActivityId(activity.id);
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
    setFormCaseId((activity as any).case_id || '');
    setFormCaseTitle((activity as any).case_title || '');
    setFormProcessId((activity as any).process_id || '');
    setFormProcessTitle((activity as any).process_title || '');
    setFormMatrixQuadrant((activity as any).matrix_quadrant || '');
    setSheetMode('edit');

    // Fire all DB queries in parallel (non-blocking)
    const promises: Promise<any>[] = [];

    if (activity.lead_id) {
      promises.push(
        Promise.all([
          supabase.from('legal_cases').select('id, case_number, title').eq('lead_id', activity.lead_id),
          supabase.from('contact_leads').select('contact_id').eq('lead_id', activity.lead_id),
          supabase.from('leads').select('case_type, damage_description, accident_date, updated_at, board_id, lead_status').eq('id', activity.lead_id).maybeSingle(),
        ]).then(async ([casesRes, linkedRes, leadPreviewRes]) => {
          setLeadCases(casesRes.data || []);

          // Board name
          let boardName: string | null = null;
          if (leadPreviewRes.data?.board_id) {
            const { data: boardData } = await supabase.from('kanban_boards').select('name').eq('id', leadPreviewRes.data.board_id).maybeSingle();
            boardName = boardData?.name || null;
          }
          setLeadPreview(leadPreviewRes.data ? { ...leadPreviewRes.data, board_name: boardName } : null);

          // Contacts
          if (linkedRes.data && linkedRes.data.length > 0) {
            const contactIds = linkedRes.data.map(cl => cl.contact_id);
            const { data: contactsData } = await supabase.from('contacts').select('id, full_name').in('id', contactIds).order('full_name');
            setAvailableContacts(contactsData || []);
          } else {
            const { data: allContacts } = await supabase.from('contacts').select('id, full_name').order('full_name').limit(500);
            setAvailableContacts(allContacts || []);
          }
        }).catch(() => {})
      );
    } else {
      setLeadPreview(null);
    }

    if ((activity as any).case_id) {
      promises.push(
        Promise.resolve(supabase.from('lead_processes').select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, envolvidos').eq('case_id', (activity as any).case_id)).then(({ data }) => {
          setCaseProcesses((data || []).map((p: any) => ({ id: p.id, title: p.title, process_number: p.process_number, polo_passivo: p.polo_passivo, tribunal: p.tribunal, area: p.area, assuntos: p.assuntos, workflow_id: p.workflow_id, envolvidos: p.envolvidos })));
        })
      );
    }

    await Promise.all(promises);
  };

  // Restore selected activity after activities load (persist across browser tab switches)
  useEffect(() => {
    if (selectedActivityId && activities.length > 0 && !selectedActivity) {
      const activity = activities.find(a => a.id === selectedActivityId);
      if (activity) {
        handleOpenEdit(activity);
      } else {
        setSelectedActivityId(null);
        setSheetMode(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, selectedActivityId]);

  // Handle URL param to auto-open an activity
  useEffect(() => {
    const openActivityId = searchParams.get('openActivity');
    if (openActivityId && activities.length > 0) {
      const clearOpenActivityParam = () => {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('openActivity');
        setSearchParams(newParams, { replace: true });
      };

      const activity = activities.find(a => a.id === openActivityId);
      if (activity) {
        handleOpenEdit(activity);
        clearOpenActivityParam();
        return;
      }

      supabase
        .from('lead_activities')
        .select('*')
        .eq('id', openActivityId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error || !data) {
            toast.error('Esta atividade não existe mais ou foi excluída.');
            clearOpenActivityParam();
            return;
          }

          handleOpenEdit(data as LeadActivity);
          clearOpenActivityParam();
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities.length, searchParams]);

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
      case_id: formCaseId || null,
      case_title: formCaseTitle || null,
      process_id: formProcessId || null,
      process_title: formProcessTitle || null,
      matrix_quadrant: formMatrixQuadrant || null,
    } as any);
    closeSheet();
    fetchActivities(getFilterParams());
  };

  const handleComplete = async (id: string) => {
    await completeActivity(id);
    fetchActivities(getFilterParams());
  };

  const openCompleteAndNotify = (source: 'sheet' | 'workflow') => {
    setCompleteNotifySource(source);
    setCompleteNotifyOpen(true);
  };

  const completeAndCreateLockRef = useRef(false);

  const handleCompleteAndCreateNextWithNotify = async (notifyOptions?: { groupJid: string; message: string; sendAudio: boolean; audioText?: string }) => {
    if (!selectedActivity) return;
    // Prevent double execution
    if (completeAndCreateLockRef.current) return;
    completeAndCreateLockRef.current = true;

    try {
      const currentActivity = selectedActivity;

      // Capture form values BEFORE any state changes
      const nextData = {
        title: formTitle,
        description: null as string | null,
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
        case_id: formCaseId || null,
        case_title: formCaseTitle || null,
        process_id: formProcessId || null,
        process_title: formProcessTitle || null,
        matrix_quadrant: formMatrixQuadrant || null,
      };

      // Conclude the current activity without overwriting its existing data
      await completeActivity(currentActivity.id);

      // Create the next activity with the captured form data
      await createActivity(nextData);

      if (notifyOptions) {
        await sendGroupNotification(notifyOptions);
      }

      toast.success('Atividade concluída e próxima criada!');

      if (completeNotifySource === 'workflow') {
        const timeSpent = getActivityTimeSpent();
        setWorkflowCompleted(prev => [...prev, { activity: currentActivity, action: 'completed_next', timeSpent }]);
        workflowAdvance();
      } else {
        closeSheet();
        fetchActivities(getFilterParams());
      }
    } finally {
      completeAndCreateLockRef.current = false;
    }
  };

  const sendGroupNotification = async (options: { groupJid: string; message: string; sendAudio: boolean; audioText?: string }) => {
    try {
      // Get user's instance
      const { data: { user: authUser } } = await supabase.auth.getUser();
      let instanceId: string | undefined;
      if (authUser) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', authUser.id)
          .maybeSingle();
        instanceId = (profile as any)?.default_instance_id || undefined;
      }

      // Send text message
      const sendBody: Record<string, any> = {
        phone: options.groupJid,
        chat_id: options.groupJid,
        message: options.message,
        lead_id: formLeadId || null,
      };
      if (instanceId) sendBody.instance_id = instanceId;

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: sendBody });
      if (error || !data?.success) {
        toast.error(data?.error || 'Erro ao enviar mensagem ao grupo');
      } else {
        toast.success('Mensagem enviada ao grupo!');
      }

      // Send audio if requested
      if (options.sendAudio && options.audioText) {
        const { data: ttsData } = await cloudFunctions.invoke('elevenlabs-tts', {
          body: { text: options.audioText },
        });
        if (ttsData?.audio_url) {
          await cloudFunctions.invoke('send-whatsapp', {
            body: {
              action: 'send_media',
              phone: options.groupJid,
              chat_id: options.groupJid,
              media_url: ttsData.audio_url,
              media_type: 'audio/mpeg',
              lead_id: formLeadId || null,
              ...(instanceId ? { instance_id: instanceId } : {}),
            },
          });
          toast.success('Áudio enviado ao grupo!');
        }
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao notificar grupo');
    }
  };

  const handleDelete = (id: string) => {
    confirmDelete(
      'Excluir Atividade',
      'Tem certeza que deseja excluir esta atividade? Esta ação não pode ser desfeita.',
      async () => {
        await deleteActivity(id);
        closeSheet();
        fetchActivities(getFilterParams());
      }
    );
  };

  const closeSheet = () => {
    setSheetMode(null);
    setSelectedActivity(null);
    setSelectedActivityId(null);
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
    setFormMatrixQuadrant((activity as any).matrix_quadrant || '');
    if (activity.lead_id) {
      try {
        const [linkedData, leadPreviewRes] = await Promise.all([
          supabase.from('contact_leads').select('contact_id').eq('lead_id', activity.lead_id),
          supabase.from('leads').select('case_type, damage_description, accident_date, updated_at, board_id, lead_status').eq('id', activity.lead_id).maybeSingle(),
        ]);
        let boardName: string | null = null;
        if (leadPreviewRes.data?.board_id) {
          const { data: boardData } = await supabase.from('kanban_boards').select('name').eq('id', leadPreviewRes.data.board_id).maybeSingle();
          boardName = boardData?.name || null;
        }
        setLeadPreview(leadPreviewRes.data ? { ...leadPreviewRes.data, board_name: boardName } : null);
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

  const handleWorkflowCompleteAndNext = () => {
    openCompleteAndNotify('workflow');
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
    // Check both arrays to find the lead name (searchedLeads may have it when leads doesn't)
    let lead = leads.find(l => l.id === leadId);
    if (!lead) {
      lead = searchedLeads.find(l => l.id === leadId);
    }
    
    setFormLeadId(leadId);
    setFormLeadName(lead?.lead_name || '');
    setFormContactId('');
    setFormContactName('');
    setContactSearch('');
    setFormCaseId('');
    setFormCaseTitle('');
    setFormProcessId('');
    setFormProcessTitle('');
    setCaseProcesses([]);
    // Load cases for this lead
    supabase.from('legal_cases').select('id, case_number, title').eq('lead_id', leadId).then(({ data }) => {
      setLeadCases(data || []);
    });
    // Auto-set activity type based on lead's workflow step
    const workflowType = leadWorkflowActivityTypes[leadId];
    if (workflowType) {
      const routineKeys = activeRoutine.length > 0
        ? new Set(activeRoutine.map(c => c.activityType))
        : null;
      if (!routineKeys || routineKeys.has(workflowType)) {
        setFormType(workflowType);
      }
    }
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
    setFormCaseId('');
    setFormCaseTitle('');
    setFormProcessId('');
    setFormProcessTitle('');
    setLeadCases([]);
    setCaseProcesses([]);
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

  // Fetch open activity counts for the assignee on the selected dates
  useEffect(() => {
    const fetchDateCount = async (date: string, setter: (v: number | null) => void) => {
      if (!date || !formAssignedTo) { setter(null); return; }
      const { count, error } = await supabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', formAssignedTo)
        .eq('deadline', date)
        .neq('status', 'concluida');
      if (!error) setter(count ?? 0);
    };
    fetchDateCount(formDeadline, setDeadlineDateCount);
    fetchDateCount(formNotificationDate, setNotifDateCount);
  }, [formDeadline, formNotificationDate, formAssignedTo]);

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
    if (selectedCalDays.length === 0) return activities;
    return activities.filter(a => {
      const dateKey = a.deadline || a.notification_date;
      return dateKey ? selectedCalDays.includes(dateKey) : false;
    });
  }, [activities, selectedCalDays]);

  const resolveUserName = (userId: string | null) => {
    if (!userId) return null;
    return teamMembers.find(m => m.user_id === userId)?.full_name || null;
  };

  useEffect(() => {
    if (!leadSearch.trim()) {
      setSearchedLeads(leads.slice(0, 20));
      return;
    }
    const timer = setTimeout(async () => {
      const term = leadSearch.trim();
      const { data } = await supabase
        .from('leads')
        .select('id, lead_name')
        .ilike('lead_name', `%${term}%`)
        .order('lead_name')
        .limit(20);
      setSearchedLeads(data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [leadSearch, leads]);

  const filteredLeads = searchedLeads;

  // Use the assignee's routine for filtering activity types in the form
  const activeRoutine = (formAssignedTo && formAssignedTo !== user?.id) ? assigneeTimeBlockSettings : timeBlockSettings;

  // Build a merged list of all known activity types (default + custom from DB + routine + existing activities)
  const allKnownActivityTypes = useMemo(() => {
    const allTypes = [...ACTIVITY_TYPES];

    for (const dbType of dbActivityTypes) {
      const activityTypeKey = dbType.key?.trim();
      if (!hasSelectValue(activityTypeKey)) continue;

      if (!allTypes.some(t => t.value === activityTypeKey)) {
        allTypes.push({
          value: activityTypeKey,
          label: dbType.label?.trim() || activityTypeKey,
          bg: 'bg-muted',
          border: 'border-border',
          header: dbType.color || 'bg-gray-500',
          dot: dbType.color || 'bg-gray-500',
        });
      }
    }

    const routineSources = [...timeBlockSettings, ...assigneeTimeBlockSettings, ...activeRoutine];
    for (const tb of routineSources) {
      const activityTypeKey = tb.activityType?.trim();
      if (!hasSelectValue(activityTypeKey)) continue;

      if (!allTypes.some(t => t.value === activityTypeKey)) {
        allTypes.push({
          value: activityTypeKey,
          label: tb.label?.trim() || activityTypeKey,
          bg: 'bg-muted',
          border: 'border-border',
          header: tb.color || 'bg-gray-500',
          dot: tb.color || 'bg-gray-500',
        });
      }
    }

    for (const activity of activities) {
      const activityTypeKey = activity.activity_type?.trim();
      if (!hasSelectValue(activityTypeKey)) continue;

      if (!allTypes.some(t => t.value === activityTypeKey)) {
        allTypes.push({
          value: activityTypeKey,
          label: activityTypeKey,
          bg: 'bg-muted',
          border: 'border-border',
          header: 'bg-gray-500',
          dot: 'bg-gray-500',
        });
      }
    }

    return allTypes.filter(type => hasSelectValue(type.value));
  }, [dbActivityTypes, timeBlockSettings, assigneeTimeBlockSettings, activeRoutine, activities]);

  // Only show activity types that are in the assignee's routine for form selection
  const routineActivityTypes = useMemo(() => {
    if (activeRoutine.length === 0) return allKnownActivityTypes;
    const routineKeys = new Set(activeRoutine.map(c => c.activityType));
    return allKnownActivityTypes.filter(t => routineKeys.has(t.value));
  }, [activeRoutine, allKnownActivityTypes]);

  const suggestActivityType = useCallback(async (title: string) => {
    if (!title || title.trim().length < 5) return;
    setAiSuggestingType(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-activity-type', { body: { title } });
      if (!error && data?.suggested_type) {
        // Check against all known types (hardcoded + DB custom)
        const allTypes = [...ACTIVITY_TYPES];
        for (const dbType of dbActivityTypes) {
          if (!allTypes.some(t => t.value === dbType.key)) {
            allTypes.push({ value: dbType.key, label: dbType.label, bg: '', border: '', header: '', dot: '' });
          }
        }
        const match = allTypes.find(t => t.value === data.suggested_type);
        if (match) {
          // Only set if it's in the routine (or no routine configured)
          const routineKeys = activeRoutine.length > 0 ? new Set(activeRoutine.map(c => c.activityType)) : null;
          if (!routineKeys || routineKeys.has(match.value)) {
            setFormType(match.value);
            toast.info(`Tipo sugerido pela IA: ${match.label}`, { duration: 2000 });
          }
        }
      }
    } catch { /* silent */ }
    setAiSuggestingType(false);
  }, [dbActivityTypes, activeRoutine]);

  const handleTitleChange = useCallback((value: string) => {
    setFormTitle(value);
    if (aiSuggestTimer.current) clearTimeout(aiSuggestTimer.current);
    if (value.trim().length >= 5 && sheetMode === 'create') {
      aiSuggestTimer.current = setTimeout(() => suggestActivityType(value), 800);
    }
  }, [sheetMode, suggestActivityType]);

  // Countdown timer effect
  useEffect(() => {
    if (!countdownBlock) return;
    const endMinutes = (countdownBlock.endHour * 60) + (countdownBlock.endMinute ?? 0);
    const calcRemaining = () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const nowSeconds = now.getSeconds();
      return Math.max(0, (endMinutes - nowMinutes) * 60 - nowSeconds);
    };
    setCountdownRemaining(calcRemaining());
    const interval = setInterval(() => {
      const r = calcRemaining();
      setCountdownRemaining(r);
      if (r <= 0) { clearInterval(interval); }
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownBlock]);

  const weekDays = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

  // Strip HTML tags from Lexical editor content, preserving line breaks
  const stripHtml = (html: string): string => {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const buildMsg = () => {
    const notifDate = formNotificationDate ? (() => {
      const d = parseISO(formNotificationDate);
      const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
      return `${format(d, 'dd/MM/yyyy')} ${dias[d.getDay()]}`;
    })() : '';
    const valueMap: Record<string, string> = { what_was_done: stripHtml(formWhatWasDone), current_status: stripHtml(formCurrentStatus), next_steps: stripHtml(formNextSteps), notes: stripHtml(formNotes) };
    const fieldLines = fieldSettings.filter(f => f.include_in_message).map(f => `*${f.label}:* ${valueMap[f.field_key] || '—'}`).join('\n\n');
    const createdByName = selectedActivity ? resolveUserName(selectedActivity.created_by) : resolveUserName(user?.id || null);
    const createdAtFmt = selectedActivity ? format(parseISO(selectedActivity.created_at), "dd/MM/yyyy 'às' HH:mm") : format(new Date(), "dd/MM/yyyy 'às' HH:mm");
    const updatedByName = selectedActivity ? resolveUserName((selectedActivity as any).updated_by) : null;
    const updatedAtFmt = selectedActivity?.updated_at && selectedActivity.updated_at !== selectedActivity.created_at ? format(parseISO(selectedActivity.updated_at), "dd/MM/yyyy 'às' HH:mm") : null;
    const timeSpent = workflowMode ? getActivityTimeSpent() : 0;
    const tempoStr = timeSpent > 0 ? `⏱️ Tempo dedicado à atividade: ${formatDuration(timeSpent)}` : '';
    const activityLink = selectedActivity ? `🔗 Ver atividade: ${window.location.origin}/?openActivity=${selectedActivity.id}` : '';
    const updatedInfo = updatedByName && updatedAtFmt ? `\n*Última atualização por:* ${updatedByName} em ${updatedAtFmt}` : '';

    // Try to use a saved template for this board/workflow
    const boardId = leadPreview?.board_id || undefined;
    const template = getTemplateForContext(boardId);

    // Check if template has mustache-style variables
    if (template && template.includes('{{')) {
      // Build a context object for evaluating conditional expressions
      const responsavelDr = formAssignedToName
        ? `Dr. ${formAssignedToName.split(' ').slice(0, 2).join(' ')}`
        : '';
      const tplVars: Record<string, string> = {
        titulo: formTitle.toUpperCase(),
        lead_name: extractClientFirstName(formLeadName || ''),
        campos_dinamicos: fieldLines,
        responsavel: formAssignedToName || '',
        responsavel_dr: responsavelDr,
        data_retorno: notifDate || '—',
        criado_por: createdByName || '—',
        criado_em: createdAtFmt,
        atualizado_info: updatedInfo,
        tempo_dedicado: tempoStr,
        link_atividade: activityLink,
        what_was_done: valueMap.what_was_done || '—',
        current_status: valueMap.current_status || '—',
        next_steps: valueMap.next_steps || '—',
        notes: valueMap.notes || '—',
        case_number: formCaseTitle || '—',
        process_number: formProcessTitle || '—',
      };

      // Replace simple {{var}} first
      let result = template;
      for (const [key, val] of Object.entries(tplVars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
      }

      // Evaluate conditional expressions like {{var ? 'text' + var : ''}}
      result = result.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
        try {
          // Create a function with template variables in scope
          const keys = Object.keys(tplVars);
          const values = Object.values(tplVars);
          const fn = new Function(...keys, `return (${expr});`);
          const evaluated = fn(...values);
          return evaluated != null ? String(evaluated) : '';
        } catch {
          return '';
        }
      });

      return result
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // Fallback: hardcoded default
    const responsavelDrFb = formAssignedToName ? `Dr. ${formAssignedToName.split(' ').slice(0, 2).join(' ')}` : '';
    const clientFirstName = extractClientFirstName(formLeadName || '');
    return `*Boa tarde Sr(a). ${clientFirstName}*\n\n*Assunto da atividade:* ${formTitle.toUpperCase()}\n\n${fieldLines}\n\n${responsavelDrFb ? `*${responsavelDrFb} voltará com mais informações no dia ${notifDate || '—'}, até o final do dia.*` : ''}\n${tempoStr}\n\nEstamos à disposição para quaisquer dúvidas.\n\n🚀Avante!\n\nTem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;
  };

  const activityFormContent = (
    <ActivityFormCompact
      formTitle={formTitle} setFormTitle={setFormTitle}
      formAssignedTo={formAssignedTo} handleSelectAssignee={handleSelectAssignee}
      formType={formType} setFormType={setFormType}
      formStatus={formStatus} setFormStatus={setFormStatus}
      formPriority={formPriority} setFormPriority={setFormPriority}
      formDeadline={formDeadline} handleDeadlineChange={handleDeadlineChange}
      formNotificationDate={formNotificationDate} setFormNotificationDate={setFormNotificationDate}
      formMatrixQuadrant={formMatrixQuadrant} setFormMatrixQuadrant={setFormMatrixQuadrant}
      formLeadId={formLeadId} formLeadName={formLeadName}
      formContactId={formContactId} formContactName={formContactName}
      formCaseId={formCaseId} formCaseTitle={formCaseTitle}
      formProcessId={formProcessId} formProcessTitle={formProcessTitle}
      formRepeatWeekDays={formRepeatWeekDays} setFormRepeatWeekDays={setFormRepeatWeekDays}
      formWhatWasDone={formWhatWasDone} setFormWhatWasDone={setFormWhatWasDone}
      formCurrentStatus={formCurrentStatus} setFormCurrentStatus={setFormCurrentStatus}
      formNextSteps={formNextSteps} setFormNextSteps={setFormNextSteps}
      formNotes={formNotes} setFormNotes={setFormNotes}
      teamMembers={teamMembers}
      routineActivityTypes={routineActivityTypes}
      filteredLeads={filteredLeads}
      availableContacts={availableContacts}
      availableCases={availableCases}
      leadCases={leadCases}
      caseProcesses={caseProcesses}
      deadlineDateCount={deadlineDateCount}
      notifDateCount={notifDateCount}
      handleTitleChange={handleTitleChange}
      handleSelectLead={handleSelectLead}
      handleClearLead={handleClearLead}
      setFormContactId={setFormContactId}
      setFormContactName={setFormContactName}
      setFormCaseId={setFormCaseId}
      setFormCaseTitle={setFormCaseTitle}
      setFormProcessId={setFormProcessId}
      setFormProcessTitle={setFormProcessTitle}
      setCaseProcesses={setCaseProcesses}
      setCaseSearch={setCaseSearch}
      caseSearch={caseSearch}
      leadSearch={leadSearch} setLeadSearch={setLeadSearch}
      contactSearch={contactSearch} setContactSearch={setContactSearch}
      fieldSettings={fieldSettings}
      updateFieldSetting={updateFieldSetting}
      reorderFields={reorderFields}
      selectedActivity={selectedActivity}
      aiSuggestingType={aiSuggestingType}
      activeRoutine={activeRoutine}
      buildMsg={buildMsg}
      formAssignedToName={formAssignedToName}
      formLeadIdForTTS={formLeadId || undefined}
      formContactIdForTTS={formContactId || undefined}
      supabase={supabase}
      leads={leads}
    />
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
    <div className="h-[calc(100dvh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-2.5 flex items-center justify-between shrink-0 shadow-md z-20">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Atividades</h1>
          <div className="flex items-center gap-1.5 text-primary-foreground/80 text-xs">
            <span className="bg-primary-foreground/20 rounded-full px-2 py-0.5 font-medium">{stats.open} abertas</span>
            <span className="bg-primary-foreground/20 rounded-full px-2 py-0.5 font-medium">{stats.done} concluídas</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle - prominent pill */}
          <div className="flex items-center bg-primary-foreground/15 rounded-full p-0.5 gap-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                viewMode === 'list'
                  ? "bg-primary-foreground text-primary shadow-sm"
                  : "text-primary-foreground/70 hover:text-primary-foreground"
              )}
            >
              <List className="h-3.5 w-3.5" />
              Lista
            </button>
            <button
              onClick={() => setViewMode('blocks')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                viewMode === 'blocks'
                  ? "bg-primary-foreground text-primary shadow-sm"
                  : "text-primary-foreground/70 hover:text-primary-foreground"
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              Blocos
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                viewMode === 'matrix'
                  ? "bg-primary-foreground text-primary shadow-sm"
                  : "text-primary-foreground/70 hover:text-primary-foreground"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Eisenhower
            </button>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={startWorkflow} title="Workflow">
            <Play className="h-4 w-4" />
          </Button>
          <Button size="sm" className="bg-white/20 text-primary-foreground font-semibold hover:bg-white/30 gap-1 shadow-sm border border-white/30" onClick={() => { resetForm(); setSheetMode('create'); setChatOpen(true); }}>
            <Sparkles className="h-4 w-4" /> Chat IA
          </Button>
          <Button size="sm" className="bg-white text-primary font-semibold hover:bg-white/90 gap-1 shadow-sm" onClick={() => { resetForm(); setSheetMode('create'); }}>
            <Plus className="h-4 w-4" /> Nova Atividade
          </Button>
          <UserMenu />
        </div>
      </div>

      {/* Filters strip - compact horizontal */}
      <div className={cn("bg-muted/30 border-b px-3 py-1.5 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none", isEditing && "hidden md:flex")}>
        {/* Assessor */}
        <Popover open={openFilterKey === 'assignee'} onOpenChange={o => setOpenFilterKey(o ? 'assignee' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterAssignee.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <User className="h-3 w-3" />
              {filterAssignee.length === 0 ? 'Assessor' : filterAssignee.length === 1 ? (filterAssignee[0] === '__unassigned__' ? 'Sem responsável' : (teamMembers.find(m => m.user_id === filterAssignee[0])?.full_name?.split(' ')[0] || '1')) : `${filterAssignee.length}`}
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
                      <CommandItem key={m.user_id} value={m.full_name || m.user_id} onSelect={() => viewMode === 'blocks' ? setFilterAssignee(isSelected ? [] : [m.user_id]) : toggleFilter(setFilterAssignee, filterAssignee, m.user_id)}>
                        <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 truncate">{m.full_name || 'Sem nome'}</span>
                        <span className="ml-2 flex gap-1 text-[10px]">
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">{c.open}⏳</Badge>
                          <Badge variant="secondary" className="px-1 py-0 text-[10px]">{c.done}✓</Badge>
                        </span>
                      </CommandItem>
                    );
                  })}
                  <CommandItem value="__unassigned__" onSelect={() => toggleFilter(setFilterAssignee, filterAssignee, '__unassigned__')}>
                    <Check className={cn("mr-2 h-3.5 w-3.5", filterAssignee.includes('__unassigned__') ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate text-muted-foreground italic">Sem responsável</span>
                    <span className="ml-2 flex gap-1 text-[10px]">
                      <Badge variant="outline" className="px-1 py-0 text-[10px]">
                        {allActivitiesRaw.filter(a => !a.assigned_to && a.status !== 'concluida').length}⏳
                      </Badge>
                      <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                        {allActivitiesRaw.filter(a => !a.assigned_to && a.status === 'concluida').length}✓
                      </Badge>
                    </span>
                  </CommandItem>
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

        {(filterStatus.length > 0 || filterType.length > 0 || filterAssignee.length > 0 || filterLead.length > 0 || filterContact.length > 0 || selectedCalDays.length > 0) && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive shrink-0" onClick={() => { setFilterStatus([]); setFilterType([]); setFilterAssignee([]); setFilterLead([]); setFilterContact([]); setSelectedCalDays([]); }}>
            <X className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">

        {/* === EISENHOWER MATRIX VIEW === */}
        {viewMode === 'matrix' && !isEditing && (
          <div className="flex-1 overflow-auto p-4">
            <div className="max-w-5xl mx-auto">
              {/* Axis labels */}
              <div className="flex items-center justify-center gap-8 mb-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">↑ Muito Importante</span>
                  <span>·</span>
                  <span className="text-muted-foreground">↓ Pouco Importante</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">← Muito Urgente</span>
                  <span>·</span>
                  <span className="text-muted-foreground">→ Pouco Urgente</span>
                </div>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-2 gap-3 mb-1 px-0">
                <div className="text-center text-xs font-medium text-muted-foreground">🚨 Muito Urgente</div>
                <div className="text-center text-xs font-medium text-muted-foreground">🕐 Pouco Urgente</div>
              </div>

              {/* 2x2 Matrix */}
              <div className="grid grid-cols-2 grid-rows-2 gap-3 h-[calc(100vh-280px)]">
                {[
                  {
                    id: 'do_now', label: 'Faça Agora', emoji: '🔥',
                    desc: 'Urgente + Importante',
                    bg: 'bg-red-50 dark:bg-red-950/20',
                    border: 'border-red-300 dark:border-red-800',
                    header: 'bg-red-500',
                    rowLabel: '⬆️ Muito Importante',
                  },
                  {
                    id: 'schedule', label: 'Agende para depois', emoji: '📅',
                    desc: 'Não urgente + Importante',
                    bg: 'bg-blue-50 dark:bg-blue-950/20',
                    border: 'border-blue-300 dark:border-blue-800',
                    header: 'bg-blue-600',
                    rowLabel: null,
                  },
                  {
                    id: 'delegate', label: 'Delegue para alguém', emoji: '🤝',
                    desc: 'Urgente + Pouco importante',
                    bg: 'bg-orange-50 dark:bg-orange-950/20',
                    border: 'border-orange-300 dark:border-orange-800',
                    header: 'bg-orange-500',
                    rowLabel: '⬇️ Pouco Importante',
                  },
                  {
                    id: 'eliminate', label: 'Retire da sua agenda', emoji: '🗑️',
                    desc: 'Não urgente + Pouco importante',
                    bg: 'bg-muted/30',
                    border: 'border-border',
                    header: 'bg-muted-foreground',
                    rowLabel: null,
                  },
                ].map((quadrant) => {
                  const quadrantActivities = displayedActivities.filter(
                    a => (a as any).matrix_quadrant === quadrant.id
                  );
                  const isOver = dragOverQuadrant === quadrant.id;

                  return (
                    <div
                      key={quadrant.id}
                      className={cn(
                        'flex flex-col rounded-xl border-2 overflow-hidden transition-all',
                        quadrant.bg, quadrant.border,
                        isOver && 'ring-2 ring-primary scale-[1.01]'
                      )}
                      onDragOver={(e) => { e.preventDefault(); setDragOverQuadrant(quadrant.id); }}
                      onDragLeave={() => setDragOverQuadrant(null)}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setDragOverQuadrant(null);
                        const actId = e.dataTransfer.getData('activityId');
                        if (!actId) return;
                        await updateActivity(actId, { matrix_quadrant: quadrant.id } as any);
                        fetchActivities(getFilterParams());
                      }}
                    >
                      {/* Quadrant Header */}
                      <div className={cn('px-3 py-2 text-white flex items-center justify-between', quadrant.header)}>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{quadrant.emoji}</span>
                          <div>
                            <div className="font-semibold text-sm leading-tight">{quadrant.label}</div>
                            <div className="text-[10px] opacity-80">{quadrant.desc}</div>
                          </div>
                        </div>
                        <div className="bg-white/20 rounded-full px-2 py-0.5 text-xs font-bold">
                          {quadrantActivities.length}
                        </div>
                      </div>

                      {/* Drop area + cards */}
                      <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {quadrantActivities.length === 0 && (
                          <div className="flex items-center justify-center h-full text-muted-foreground text-xs opacity-50 py-4">
                            Arraste atividades aqui
                          </div>
                        )}
                        {quadrantActivities.map(activity => (
                          <div
                            key={activity.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('activityId', activity.id);
                            }}
                            className={cn(
                              'bg-card rounded-lg border border-border/50 p-2.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-all',
                              selectedActivity?.id === activity.id && 'ring-2 ring-primary'
                            )}
                            onClick={() => handleOpenEdit(activity)}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <p className="text-xs font-medium leading-snug flex-1">{activity.title}</p>
                              <div className="flex items-center gap-0.5 shrink-0">
                                {activity.status !== 'concluida' && (
                                  <button
                                    className="text-green-600 hover:text-green-700 p-0.5 rounded"
                                    onClick={e => { e.stopPropagation(); handleComplete(activity.id); }}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  className="text-muted-foreground hover:text-primary p-0.5 rounded"
                                  onClick={e => { e.stopPropagation(); handleCloneActivity(activity); }}
                                  title="Duplicar"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                                  onClick={e => { e.stopPropagation(); handleDelete(activity.id); }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            {activity.lead_name && (
                              <p className="text-[10px] text-muted-foreground mt-1 truncate">📁 {activity.lead_name}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <Badge className={cn("text-[9px] px-1.5 py-0 h-4", statusColors[activity.status] || 'bg-muted')}>
                                {STATUS_OPTIONS.find(s => s.value === activity.status)?.label}
                              </Badge>
                              {activity.deadline && (
                                <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                  <Calendar className="h-2.5 w-2.5" />
                                  {format(parseISO(activity.deadline), 'dd/MM')}
                                </span>
                              )}
                              {activity.assigned_to_name && (
                                <span className="text-[9px] text-muted-foreground truncate">• {activity.assigned_to_name.split(' ')[0]}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Unclassified activities */}
              {(() => {
                const unclassified = displayedActivities.filter(a => !(a as any).matrix_quadrant);
                if (unclassified.length === 0) return null;
                return (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      📋 Sem classificação na Matriz ({unclassified.length}) — arraste-as para os quadrantes ou clique para editar
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {unclassified.map(activity => (
                        <div
                          key={activity.id}
                          draggable
                          onDragStart={(e) => { e.dataTransfer.setData('activityId', activity.id); }}
                          className="bg-card border border-border/60 rounded-lg px-3 py-2 text-xs cursor-grab hover:shadow-md transition-all max-w-[200px]"
                          onClick={() => handleOpenEdit(activity)}
                        >
                          <p className="font-medium truncate">{activity.title}</p>
                          {activity.lead_name && <p className="text-muted-foreground truncate">📁 {activity.lead_name}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}


        {/* === BLOCOS DE TEMPO (AGENDA SEMANAL) === */}
        {viewMode === 'blocks' && !isEditing && (() => {
          // Use the selected assignee's routine for blocks view
          const activeSettings = blocksViewSettings.length > 0 ? blocksViewSettings : timeBlockSettings;

          // If multiple assignees selected, show message to select just one
          if (filterAssignee.length > 1) {
            return (
              <div className="flex flex-1 items-center justify-center text-center p-8">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Selecione apenas um assessor para visualizar os blocos de tempo.</p>
                  <p className="text-xs text-muted-foreground/70">A visualização de blocos mostra a rotina individual de cada membro.</p>
                </div>
              </div>
            );
          }

          // Derive the hour range from settings
          const allStartHours = activeSettings.map(c => c.startHour);
          const allEndHours = activeSettings.map(c => c.endHour);
          const minHour = Math.min(...allStartHours, 8);
          const maxHour = Math.max(...allEndHours, 18);
          const WEEK_HOURS = Array.from({ length: maxHour - minHour }, (_, i) => i + minHour);
          const WEEK_DAYS = [
            { label: 'SEG', dayIdx: 0 },
            { label: 'TER', dayIdx: 1 },
            { label: 'QUA', dayIdx: 2 },
            { label: 'QUI', dayIdx: 3 },
            { label: 'SEX', dayIdx: 4 },
          ];

          const today = new Date();
          const weekStart = startOfWeek(today, { weekStartsOn: 1 });
          const weekDates = WEEK_DAYS.map(d => addDays(weekStart, d.dayIdx));
          const HOUR_HEIGHT = 64; // px per hour
          const totalHeight = (maxHour - minHour) * HOUR_HEIGHT;

          const getActivityDay = (a: LeadActivity) => {
            const dateStr = a.deadline || a.notification_date;
            if (!dateStr) return null;
            try { return parseISO(dateStr); } catch { return null; }
          };

          const getEffectiveType = (a: LeadActivity): string => {
            if (a.lead_id && leadWorkflowActivityTypes[a.lead_id]) {
              return leadWorkflowActivityTypes[a.lead_id];
            }
            return a.activity_type;
          };

          // Build blocks per day: each activeSettings generates a visual block per day
          const getBlocksForDay = (dayDate: Date, dayIdx: number) => {
            const dayActivities = displayedActivities.filter(a => {
              const d = getActivityDay(a);
              return d && isSameDay(d, dayDate);
            });
            const noDateActivities = displayedActivities.filter(a => {
              if (a.deadline || a.notification_date) return false;
              const effectiveType = getEffectiveType(a);
              const cfg = activeSettings.find(c => c.activityType === effectiveType);
              return cfg?.days.includes(dayIdx) ?? false;
            });

            return activeSettings
              .filter(cfg => cfg.days.includes(dayIdx))
              .map(cfg => {
                const startM = cfg.startMinute || 0;
                const endM = cfg.endMinute || 0;
                const startDecimal = cfg.startHour + startM / 60;
                const endDecimal = cfg.endHour + endM / 60;
                const topPx = (startDecimal - minHour) * HOUR_HEIGHT;
                const heightPx = (endDecimal - startDecimal) * HOUR_HEIGHT;

                const items = [
                  ...dayActivities.filter(a => getEffectiveType(a) === cfg.activityType),
                  ...noDateActivities.filter(a => getEffectiveType(a) === cfg.activityType),
                ];

                return { cfg, items, topPx, heightPx };
              });
          };

          const unscheduled = displayedActivities.filter(a => {
            if (a.deadline || a.notification_date) return false;
            const effectiveType = getEffectiveType(a);
            const cfg = activeSettings.find(c => c.activityType === effectiveType);
            return !cfg || cfg.days.length === 0;
          });

          // Build type summary for left sidebar
          const typeSummary = allKnownActivityTypes.map(t => {
            const typeActs = displayedActivities.filter(a => {
              const et = getEffectiveType(a);
              return et === t.value;
            });
            const openCount = typeActs.filter(a => a.status !== 'concluida').length;
            const totalCount = typeActs.length;
            // Find matching routine config for color
            const routineCfg = activeSettings.find(c => c.activityType === t.value);
            return { ...t, openCount, totalCount, routineCfg, items: typeActs };
          }).filter(t => t.totalCount > 0 || activeSettings.some(c => c.activityType === t.value));

          const totalOpen = displayedActivities.filter(a => a.status !== 'concluida').length;
          const totalAll = displayedActivities.length;

          // Find selected block data

          // Find selected block data
          const selectedBlockData = (() => {
            if (!selectedBlockKey) return null;
            const [dayIdxStr, cfgType] = selectedBlockKey.split('::');
            const dayIdx = parseInt(dayIdxStr);
            const dayDate = weekDates[dayIdx];
            if (!dayDate) return null;
            const blocks = getBlocksForDay(dayDate, dayIdx);
            const block = blocks.find(b => b.cfg.activityType === cfgType);
            if (!block) return null;
            return { ...block, dayDate, dayIdx };
          })();

          return (
            <div className="flex flex-1 overflow-hidden h-full relative">
              {/* Floating popup for selected block activities */}
              {selectedBlockData && (
                <div className="absolute left-3 top-3 z-30 w-[320px] max-h-[70vh] rounded-xl border bg-card shadow-xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-left-2 duration-200">
                  {/* Header */}
                  <div className={cn('px-3 py-2 text-white flex items-center justify-between rounded-t-xl', selectedBlockData.cfg.color || 'bg-muted-foreground')}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold truncate">{selectedBlockData.cfg.label}</p>
                      <p className="text-[10px] opacity-80">
                        {format(selectedBlockData.dayDate, 'EEEE, dd/MM', { locale: ptBR })} • {selectedBlockData.cfg.startHour}h–{selectedBlockData.cfg.endHour}h
                      </p>
                    </div>
                    <button
                      className="text-white/80 hover:text-white ml-2 shrink-0"
                      onClick={() => { setSelectedBlockKey(null); setBlockSearchText(''); }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {/* Search */}
                  <div className="px-2 py-1.5 border-b">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar atividade..."
                        value={blockSearchText}
                        onChange={e => setBlockSearchText(e.target.value)}
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                  </div>
                  {/* Items */}
                  <ScrollArea className="flex-1 max-h-[50vh]">
                    {(() => {
                      const searchLower = blockSearchText.toLowerCase();
                      const filtered = blockSearchText
                        ? selectedBlockData.items.filter(a =>
                            (a.title || '').toLowerCase().includes(searchLower) ||
                            (a.current_status_notes || '').toLowerCase().includes(searchLower) ||
                            (a.what_was_done || '').toLowerCase().includes(searchLower) ||
                            (a.next_steps || '').toLowerCase().includes(searchLower) ||
                            (a.notes || '').toLowerCase().includes(searchLower) ||
                            (a.lead_name || '').toLowerCase().includes(searchLower)
                          )
                        : selectedBlockData.items;
                      if (filtered.length === 0) {
                        return (
                          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                            {blockSearchText ? 'Nenhum resultado encontrado' : 'Nenhuma atividade neste bloco'}
                          </div>
                        );
                      }
                      return (
                        <div className="divide-y">
                          {filtered.map(a => (
                            <div
                              key={a.id}
                              className="px-3 py-2 transition-colors hover:bg-muted/50 cursor-pointer flex items-start gap-2"
                              onClick={() => handleOpenEdit(a)}
                            >
                              <span className={cn('mt-1 h-2 w-2 rounded-full shrink-0', selectedBlockData.cfg.color || 'bg-muted-foreground')} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{a.title}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {a.lead_name && <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">📁 {a.lead_name}</span>}
                                  <Badge variant={a.status === 'concluida' ? 'default' : 'outline'} className="text-[9px] px-1 py-0 h-4">
                                    {a.status === 'concluida' ? '✓' : a.status === 'em_andamento' ? '▶' : '○'}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                  <div className="px-3 py-1.5 border-t text-xs text-muted-foreground text-center">
                    {blockSearchText
                      ? `${selectedBlockData.items.filter(a => {
                          const s = blockSearchText.toLowerCase();
                          return (a.title||'').toLowerCase().includes(s)||(a.current_status_notes||'').toLowerCase().includes(s)||(a.what_was_done||'').toLowerCase().includes(s)||(a.next_steps||'').toLowerCase().includes(s)||(a.notes||'').toLowerCase().includes(s)||(a.lead_name||'').toLowerCase().includes(s);
                        }).length} de ${selectedBlockData.items.length}`
                      : `${selectedBlockData.items.length} atividade${selectedBlockData.items.length !== 1 ? 's' : ''}`
                    }
                  </div>
                </div>
              )}

              {/* Weekly grid */}
              <div className="flex-1 overflow-auto">
                {/* Day headers */}
                <div className="sticky top-0 z-10 bg-card border-b flex">
                  <div className="w-10 shrink-0" />
                  {weekDates.map((dayDate, i) => (
                    <div key={i} className={cn(
                      'flex-1 text-center py-2 border-l text-xs font-bold uppercase tracking-wider',
                      isSameDay(dayDate, today) ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                    )}>
                      {WEEK_DAYS[i].label}
                      <div className="text-[10px] font-normal opacity-70">{format(dayDate, 'dd/MM')}</div>
                    </div>
                  ))}
                </div>

                {/* Time grid with proportional blocks */}
                <div className="relative flex">
                  {/* Hour labels */}
                  <div className="w-10 shrink-0 relative" style={{ height: totalHeight }}>
                    {WEEK_HOURS.map((hour) => (
                      <div
                        key={hour}
                        className="absolute left-0 w-full text-[10px] text-muted-foreground font-medium pl-1"
                        style={{ top: (hour - minHour) * HOUR_HEIGHT }}
                      >
                        {hour}h
                      </div>
                    ))}
                  </div>

                  {/* Day columns with blocks */}
                  {weekDates.map((dayDate, dayIdx) => {
                    const blocks = getBlocksForDay(dayDate, dayIdx);
                    return (
                      <div
                        key={dayIdx}
                        className={cn(
                          'flex-1 border-l relative',
                          isSameDay(dayDate, today) && 'bg-primary/5',
                        )}
                        style={{ height: totalHeight }}
                      >
                        {/* Hour grid lines */}
                        {WEEK_HOURS.map(hour => (
                          <div
                            key={hour}
                            className="absolute left-0 right-0 border-b border-border/30"
                            style={{ top: (hour - minHour) * HOUR_HEIGHT }}
                          />
                        ))}

                        {/* Proportional blocks */}
                        {blocks.map((block, bi) => {
                          const bgColor = block.cfg.color || 'bg-muted-foreground';
                          const abbreviation = block.cfg.label.slice(0, 4).toUpperCase();
                          const count = block.items.length;
                          const openCount = block.items.filter(a => a.status !== 'concluida').length;
                          const doneCount = count - openCount;
                          const blockKey = `${dayIdx}::${block.cfg.activityType}`;
                          const isSelected = selectedBlockKey === blockKey;

                          return (
                            <div
                              key={bi}
                              className={cn(
                                'absolute left-1 right-1 rounded-lg cursor-pointer hover:opacity-90 transition-all shadow-sm flex flex-col items-center justify-center text-white overflow-hidden',
                                bgColor,
                                count === 0 && 'opacity-30',
                                isSelected && 'ring-2 ring-foreground ring-offset-1'
                              )}
                              style={{
                                top: block.topPx + 1,
                                height: Math.max(block.heightPx - 2, 24),
                              }}
                              onClick={() => {
                                setOpenFilterKey(null);
                                setBlockSearchText('');
                                setSelectedBlockKey(isSelected ? null : blockKey);
                              }}
                            >
                              <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">{abbreviation}</div>
                              <div className="text-lg font-bold leading-none">{count}</div>
                              {count > 0 && (
                                <div className="flex items-center gap-1 text-[9px] font-semibold mt-0.5">
                                  <span className="opacity-90">○{openCount}</span>
                                  <span className="opacity-60">✓{doneCount}</span>
                                </div>
                              )}
                              {block.heightPx > 50 && (
                                <div className="text-[8px] opacity-70 mt-0.5">
                                  {block.cfg.startHour}:{String(block.cfg.startMinute || 0).padStart(2, '0')}–{block.cfg.endHour}:{String(block.cfg.endMinute || 0).padStart(2, '0')}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Unscheduled activities */}
                {unscheduled.length > 0 && (
                  <div className="border-t p-3 bg-muted/20">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase mb-2">
                      Sem data ({unscheduled.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {unscheduled.map(a => {
                        const tc = ACTIVITY_TYPES.find(t => t.value === a.activity_type);
                        return (
                          <div
                            key={a.id}
                            className={cn(
                              'rounded-md px-2 py-1 text-white text-[10px] font-medium cursor-pointer hover:opacity-90 transition-opacity shadow-sm',
                              tc ? tc.header : 'bg-muted-foreground'
                            )}
                            onClick={() => handleOpenEdit(a)}
                          >
                            {a.title.length > 20 ? a.title.slice(0, 20) + '…' : a.title}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}


        {/* LEFT: Calendar + Activity list (chat-style) */}
        <div className={cn(
          "flex flex-col overflow-hidden transition-all",
          (viewMode === 'matrix' || viewMode === 'blocks') && !isEditing ? "hidden" : "",
          isEditing ? "hidden md:flex w-[400px] min-w-[340px] border-r" : "flex-1"
        )}>
          {/* Calendar - collapsible */}
          <div className="shrink-0 border-b bg-card/50">
            {/* Calendar header - always visible, clickable to expand/collapse */}
            <button
              className="w-full px-3 pt-2 pb-2 flex items-center justify-between hover:bg-muted/30 transition-colors"
              onClick={() => setCalendarExpanded(prev => !prev)}
            >
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-semibold capitalize">
                  {format(calendarMonth, 'MMMM yyyy', { locale: ptBR })}
                </span>
                {selectedCalDay && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {format(parseISO(selectedCalDay), "dd/MM")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* Stats mini preview when collapsed */}
                {!calendarExpanded && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mr-2">
                    <span className="text-destructive font-bold">{stats.open}⏳</span>
                    <span className="text-green-600 font-bold">{stats.done}✓</span>
                  </div>
                )}
                <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", calendarExpanded && "rotate-90")} />
              </div>
            </button>

            {calendarExpanded && (
              <>
                <div className="px-3 pb-1 flex items-center justify-between -mt-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setCalendarMonth(prev => subMonths(prev, 1)); }}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground capitalize">
                    {format(calendarMonth, 'MMMM yyyy', { locale: ptBR })}
                  </span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setCalendarMonth(prev => addMonths(prev, 1)); }}>
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
                      const isSelected = selectedCalDays.includes(dateKey);

                      return (
                        <button
                          key={dateKey}
                          onClick={() => setSelectedCalDays(prev => prev.includes(dateKey) ? prev.filter(d => d !== dateKey) : [...prev, dateKey].sort())}
                          className={cn(
                            "relative p-0.5 rounded-md text-xs transition-colors",
                            isToday(day) && "ring-1 ring-primary font-bold",
                            isSelected && "bg-primary text-primary-foreground",
                            !isSelected && dayActivities.length > 0 && "bg-muted/60 hover:bg-muted",
                            !isSelected && dayActivities.length === 0 && "hover:bg-muted/30"
                          )}
                        >
                          <div className="text-center leading-tight">{format(day, 'd')}</div>
                          {dayActivities.length > 0 && (
                            <div className="flex justify-center gap-0.5 leading-none">
                              {openCount > 0 && (
                                <span className={cn("text-[8px] font-bold leading-none", isSelected ? "text-primary-foreground/80" : "text-destructive")}>{openCount}</span>
                              )}
                              {doneCount > 0 && (
                                <span className={cn("text-[8px] font-bold leading-none", isSelected ? "text-primary-foreground/80" : "text-green-600")}>{doneCount}</span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Two summary buttons side by side */}
                <div className="px-3 pb-2 flex gap-2">
                  {/* By Activity Type */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 flex-1 justify-between text-xs">
                        <span>Por tipo de atv</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {(() => {
                            const base = selectedCalDays.length > 0 ? displayedActivities : activities;
                            const open = base.filter(a => a.status !== 'concluida').length;
                            const done = base.filter(a => a.status === 'concluida').length;
                            return `${open}⏳ ${done}✓`;
                          })()}
                        </Badge>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[400px] max-w-[calc(100vw-2rem)] p-3">
                      <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Resumo por tipo de atividade</p>
                      <div className="max-h-[300px] overflow-y-auto space-y-1">
                        {(() => {
                          const baseActivities = selectedCalDays.length > 0 ? displayedActivities : activities;
                          const typeSummary = allKnownActivityTypes.map(t => {
                            const typeActs = baseActivities.filter(a => a.activity_type === t.value);
                            const openCount = typeActs.filter(a => a.status !== 'concluida').length;
                            const doneCount = typeActs.filter(a => a.status === 'concluida').length;
                            return { ...t, openCount, doneCount, total: typeActs.length };
                          }).filter(t => t.total > 0);

                          if (typeSummary.length === 0) {
                            return <div className="text-xs text-muted-foreground">Nenhuma atividade.</div>;
                          }

                          const totalOpen = baseActivities.filter(a => a.status !== 'concluida').length;
                          const totalDone = baseActivities.filter(a => a.status === 'concluida').length;

                          return (
                            <>
                              {typeSummary.map(t => (
                                <div key={t.value} className="flex items-center gap-2 py-1">
                                  <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', t.dot || 'bg-muted-foreground')} />
                                  <span className="text-xs font-medium flex-1 truncate">{t.label}</span>
                                  <span className="text-xs tabular-nums">
                                    <span className="text-destructive font-bold">{t.openCount}</span>
                                    <span className="text-muted-foreground mx-0.5">/</span>
                                    <span className="text-green-600 font-bold">{t.doneCount}</span>
                                  </span>
                                </div>
                              ))}
                              <div className="flex items-center gap-2 py-1 border-t mt-1 pt-1.5">
                                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 shrink-0" />
                                <span className="text-xs font-bold flex-1">TOTAL</span>
                                <span className="text-xs font-bold tabular-nums">
                                  <span className="text-destructive">{totalOpen}</span>
                                  <span className="text-muted-foreground mx-0.5">/</span>
                                  <span className="text-green-600">{totalDone}</span>
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* By Assessor */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 flex-1 justify-between text-xs">
                        <span>Por assessor</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {selectedCalDays.length > 0 ? `${selectedCalDays.length} dia(s)` : 'Geral'}
                        </Badge>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[560px] max-w-[calc(100vw-2rem)] p-3">
                      <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Resumo por assessor</p>
                      <div className="max-h-[300px] overflow-y-auto space-y-1">
                        {(() => {
                          const baseActivities = selectedCalDays.length > 0 ? displayedActivities : activities;
                          const selectedMembers = filterAssignee.length > 0
                            ? teamMembers.filter(m => filterAssignee.includes(m.user_id))
                            : teamMembers.filter(m => baseActivities.some(a => a.assigned_to === m.user_id));

                          if (selectedMembers.length === 0) {
                            return <div className="text-xs text-muted-foreground">Nenhuma atividade para o filtro atual.</div>;
                          }

                          return selectedMembers.map(member => {
                            const memberActivities = baseActivities.filter(a => a.assigned_to === member.user_id);
                            if (memberActivities.length === 0) return null;
                            return (
                              <div key={member.user_id} className="flex items-center gap-2 flex-wrap py-0.5">
                                <span className="text-[10px] font-semibold text-foreground/80 min-w-[80px] truncate">
                                  {member.full_name?.split(' ')[0] || 'Sem nome'}
                                </span>
                                {allKnownActivityTypes.map(t => {
                                  const typeActs = memberActivities.filter(a => a.activity_type === t.value);
                                  const openCount = typeActs.filter(a => a.status !== 'concluida').length;
                                  const doneCount = typeActs.filter(a => a.status === 'concluida').length;
                                  if (openCount === 0 && doneCount === 0) return null;
                                  return (
                                    <div key={t.value} className="flex items-center gap-1 text-[10px] shrink-0 bg-muted/40 rounded-full px-2 py-0.5">
                                      <span className="font-medium text-muted-foreground">{t.label}</span>
                                      <span className="text-destructive font-bold">{openCount}</span>
                                      <span className="text-green-600 font-bold">{doneCount}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}
          </div>

          {/* Activity list - scrollable like WhatsApp chat */}
          <div className="flex-1 overflow-y-auto bg-muted/10">
            {selectedCalDays.length > 0 && (
              <div className="sticky top-0 z-10 flex justify-center py-1.5">
                <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-full px-2">
                  {[...selectedCalDays].sort().map(day => (
                    <Badge key={day} variant="secondary" className="text-xs shadow-sm cursor-pointer" onClick={() => setSelectedCalDays(prev => prev.filter(d => d !== day))}>
                      {format(parseISO(day), "dd 'de' MMM", { locale: ptBR })} <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-xs cursor-pointer" onClick={() => setSelectedCalDays([])}>
                    Limpar tudo
                  </Badge>
                </div>
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
                  <ContextMenu key={activity.id}>
                    <ContextMenuTrigger asChild>
                  <div
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
                        <span onClick={e => e.stopPropagation()}>
                          <ShareMenu entityType="activity" entityId={activity.id} entityName={activity.title} summary={[activity.lead_name && `Lead: ${activity.lead_name}`, (activity as any).case_title && `Caso: ${(activity as any).case_title}`, (activity as any).process_title && `Processo: ${(activity as any).process_title}`].filter(Boolean).join('\n') || undefined} size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" />
                        </span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={e => { e.stopPropagation(); handleCloneActivity(activity); }} title="Duplicar">
                          <Copy className="h-3.5 w-3.5" />
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
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => {
                          window.open(`${window.location.origin}/?openActivity=${activity.id}`, '_blank');
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-2" />
                        Abrir atividade em nova aba
                      </ContextMenuItem>
                      {activity.lead_id && (
                        <ContextMenuItem
                          onClick={() => {
                            window.open(`${window.location.origin}/leads?openLead=${activity.lead_id}`, '_blank');
                          }}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-2" />
                          Abrir lead em nova aba
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem
                        onClick={() => {
                          const url = `${window.location.origin}/?openActivity=${activity.id}`;
                          navigator.clipboard.writeText(url);
                          toast.success('Link copiado!');
                        }}
                      >
                        <Share2 className="h-3.5 w-3.5 mr-2" />
                        Copiar link
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          const url = `${window.location.origin}/?openActivity=${activity.id}`;
                          const text = `Atividade: *${activity.title}*\n${url}`;
                          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                        }}
                      >
                        <MessageCircle className="h-3.5 w-3.5 mr-2" />
                        Enviar via WhatsApp
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Form panel (WhatsApp chat-detail style) */}
        {isEditing && (
          <div className="flex-1 flex flex-col overflow-hidden md:relative fixed inset-0 z-50 bg-background md:inset-auto md:z-auto">
            {/* Form header with lead preview */}
            <div className="bg-primary/5 border-b px-4 py-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden shrink-0" onClick={closeSheet}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">
                      {sheetMode === 'create' ? 'Nova Atividade' : 'Editar Atividade'}
                    </h2>
                    {formLeadName && (
                      <p className="text-xs text-muted-foreground truncate">📁 {formLeadName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!formLeadId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                      onClick={() => {
                        const params = new URLSearchParams();
                        params.set('newLead', 'true');
                        if (selectedActivity?.id) params.set('activityId', selectedActivity.id);
                        navigate(`/leads?${params.toString()}`);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                      Criar Lead
                    </Button>
                  )}
                  {sheetMode === 'edit' && selectedActivity?.id && (
                    <TeamChatButton
                      entityType="activity"
                      entityId={selectedActivity.id}
                      entityName={selectedActivity.title}
                      variant="full"
                      className="h-7"
                    />
                  )}
                  {formLeadId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("h-7 text-xs gap-1")}
                      onClick={() => setShowLeadSheet(true)}
                      title="Abrir lead completo"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Lead
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
                  {leadPreview.board_name && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      🎯 {leadPreview.board_name}
                    </Badge>
                  )}
                </div>
              )}
              {/* No lead message */}
              {!formLeadId && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Nenhum lead vinculado. Vincule um lead existente no formulário ou crie um novo.
                </p>
              )}
              {sheetMode === 'edit' && selectedActivity?.id && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Para marcar pessoas com @, use o botão 👥 Chat da Equipe no topo desta atividade.
                </p>
              )}
              {/* Funnel or Process Workflow progress bar */}
              {formLeadId && (() => {
                const isLeadClosed = leadPreview?.lead_status === 'closed';
                const linkedProcess = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
                const processWorkflowId = linkedProcess?.workflow_id;
                
                if (isLeadClosed && processWorkflowId) {
                  // Show process workflow progress instead of sales funnel
                  return <LeadFunnelProgressBar leadId={formLeadId} boardId={processWorkflowId} />;
                }
                if (leadPreview?.board_id) {
                  return <LeadFunnelProgressBar leadId={formLeadId} boardId={leadPreview.board_id} />;
                }
                return null;
              })()}
            </div>

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

            {/* Action bar - always visible at bottom */}
            <div className="shrink-0 border-t border-border bg-muted/60 px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-10 space-y-2">
              {buildMsg && (
                <SendToGroupSection buildMsg={buildMsg} leadId={formLeadId} fieldSettings={fieldSettings} updateFieldSetting={updateFieldSetting} reorderFields={reorderFields} formLeadIdForTTS={formLeadId || undefined} formContactIdForTTS={formContactId || undefined} formAssignedTo={formAssignedTo || undefined} />
              )}
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
                        onClick={() => selectedActivity && handleCloneActivity(selectedActivity)}
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicar
                      </Button>
                      {selectedActivity?.id && (
                        <TeamChatButton
                          entityType="activity"
                          entityId={selectedActivity.id}
                          entityName={selectedActivity.title}
                          variant="full"
                          className="h-8"
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1"
                        onClick={() => setChatOpen(true)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> Chat IA
                      </Button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {selectedActivity?.status === 'concluida' && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                              <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-40 p-1" align="start">
                            <div className="flex flex-col gap-0.5">
                              {[
                                { value: 'pendente', label: 'Pendente' },
                                { value: 'em_andamento', label: 'Em Andamento' },
                              ].map(opt => (
                                <Button
                                  key={opt.value}
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs justify-start"
                                  onClick={async () => {
                                    if (!selectedActivity) return;
                                    await updateActivity(selectedActivity.id, { status: opt.value, completed_at: null, completed_by: null, completed_by_name: null });
                                    fetchActivities(getFilterParams());
                                    setSelectedActivity(prev => prev ? { ...prev, status: opt.value, completed_at: null, completed_by: null, completed_by_name: null } : prev);
                                  }}
                                >
                                  {opt.label}
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {selectedActivity?.status !== 'concluida' && (
                        <Button size="sm" className="h-8 text-xs bg-success hover:bg-success/90 text-success-foreground" onClick={() => selectedActivity && handleComplete(selectedActivity.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Concluir
                        </Button>
                      )}
                      {selectedActivity?.status !== 'concluida' && (
                        <Button size="sm" className="h-8 text-xs gap-1 bg-warning hover:bg-warning/90 text-warning-foreground" onClick={() => openCompleteAndNotify('sheet')}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Concluir e Criar Próxima Atv
                        </Button>
                      )}
                      <Button size="sm" className="h-8 text-xs" onClick={handleUpdate}>Salvar</Button>
                    </div>
                  </div>
              ) : (
                <div className="flex items-center justify-between max-w-2xl">
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={closeSheet}>Cancelar</Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1"
                      onClick={async () => {
                        // If we have title+type, create first then open chat in edit mode
                        if (formTitle.trim() && formType) {
                          try {
                            const result = await createActivity({
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
                              notes: formNotes || null,
                              contact_id: formContactId || null,
                              contact_name: formContactName || null,
                              deadline: formDeadline || null,
                              notification_date: formNotificationDate || null,
                            });
                            if (result) {
                              const createdActivity = result as LeadActivity;
                              setSelectedActivity(createdActivity);
                              setSelectedActivityId(createdActivity.id);
                              setSheetMode('edit');
                              fetchActivities(getFilterParams());
                              setChatOpen(true);
                            }
                          } catch {
                            // Error already toasted by createActivity
                          }
                        } else {
                          // Open chat directly without requiring fields - AI will handle it
                          setChatOpen(true);
                        }
                      }}
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> Chat
                    </Button>
                    <Button size="sm" className="h-8 text-xs gap-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" onClick={handleCreate}>
                      <Plus className="h-3.5 w-3.5" /> Criar
                    </Button>
                  </div>
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
        leadId={selectedActivity?.lead_id || formLeadId || null}
        activityTitle={selectedActivity?.title || formTitle}
        onApplySuggestion={(suggestion) => {
          if (suggestion.what_was_done) setFormWhatWasDone(suggestion.what_was_done);
          if (suggestion.current_status_notes) setFormCurrentStatus(suggestion.current_status_notes);
          if (suggestion.next_steps) setFormNextSteps(suggestion.next_steps);
          if (suggestion.notes) setFormNotes(suggestion.notes);
        }}
        onCreateActivity={async (activityData) => {
          try {
            const result = await createActivity({
              title: activityData.title || 'Nova atividade',
              description: activityData.notes || null,
              what_was_done: activityData.what_was_done || null,
              current_status_notes: activityData.current_status_notes || null,
              next_steps: activityData.next_steps || null,
              activity_type: activityData.activity_type || formType || 'tarefa',
              priority: activityData.priority || 'normal',
              lead_id: activityData.lead_id || formLeadId || null,
              lead_name: activityData.lead_name || formLeadName || null,
              assigned_to: activityData.assigned_to || formAssignedTo || null,
              assigned_to_name: activityData.assigned_to_name || formAssignedToName || null,
              notes: activityData.notes || null,
              contact_id: activityData.contact_id || formContactId || null,
              contact_name: activityData.contact_name || formContactName || null,
              deadline: activityData.deadline || null,
              notification_date: activityData.notification_date || null,
              matrix_quadrant: activityData.matrix_quadrant || null,
            });
            if (result) {
              const createdActivity = result as LeadActivity;
              // Auto-add assignee to filter so the new activity is visible
              const newAssigneeFilter = [...filterAssignee];
              if (createdActivity.assigned_to && filterAssignee.length > 0 && !filterAssignee.includes(createdActivity.assigned_to)) {
                newAssigneeFilter.push(createdActivity.assigned_to);
                setFilterAssignee(newAssigneeFilter);
              }
              setSelectedActivity(createdActivity);
              setSelectedActivityId(createdActivity.id);
              setSheetMode('edit');
              // Use updated filter with the new assignee included
              fetchActivities({
                ...getFilterParams(),
                assigned_to: newAssigneeFilter.length > 0 ? newAssigneeFilter : 'all',
              });
              return createdActivity;
            }
          } catch { /* error toasted */ }
          return null;
        }}
      />

      <TimeBlockSettingsDialog
        open={timeBlockSettingsOpen}
        onOpenChange={setTimeBlockSettingsOpen}
        configs={timeBlockSettings}
        onSave={saveTimeBlockConfigs}
        targetUserId={user?.id}
      />

      {/* Countdown Timer Overlay */}
      {countdownBlock && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center" onClick={() => setCountdownBlock(null)}>
          <div className="bg-card rounded-2xl shadow-2xl border p-8 max-w-sm w-full mx-4 text-center space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center gap-2">
              <span className={cn('h-4 w-4 rounded-full', countdownBlock.color)} />
              <h2 className="text-lg font-bold">{countdownBlock.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {String(countdownBlock.startHour).padStart(2,'0')}:{String(countdownBlock.startMinute ?? 0).padStart(2,'0')}
              {' – '}
              {String(countdownBlock.endHour).padStart(2,'0')}:{String(countdownBlock.endMinute ?? 0).padStart(2,'0')}
            </p>
            <div className={cn('rounded-xl p-6', countdownBlock.color)}>
              <p className="text-white/70 text-xs font-medium uppercase tracking-widest mb-1">Tempo restante</p>
              <p className="text-white text-5xl font-mono font-bold tabular-nums">
                {(() => {
                  const h = Math.floor(countdownRemaining / 3600);
                  const m = Math.floor((countdownRemaining % 3600) / 60);
                  const s = countdownRemaining % 60;
                  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                })()}
              </p>
              {countdownRemaining <= 0 && (
                <p className="text-white/80 text-sm font-semibold mt-2">⏰ Tempo esgotado!</p>
              )}
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => setCountdownBlock(null)}>
                Fechar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setFormType(countdownBlock.activityType);
                  setCountdownBlock(null);
                  resetForm();
                  setFormType(countdownBlock.activityType);
                  setSheetMode('create');
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nova Atividade
              </Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDeleteDialog />
      {/* Lead Edit Sheet */}
      {formLeadId && (
        <LeadEditDialog
          open={showLeadSheet}
          onOpenChange={setShowLeadSheet}
          lead={{ id: formLeadId, lead_name: formLeadName } as any}
          onSave={async (leadId, updates) => {
            const { error } = await supabase.from('leads').update(updates as any).eq('id', leadId);
            if (error) throw error;
            setShowLeadSheet(false);
          }}
          mode="sheet"
        />
      )}

      <CompleteAndNotifyDialog
        open={completeNotifyOpen}
        onClose={() => setCompleteNotifyOpen(false)}
        onConfirm={handleCompleteAndCreateNextWithNotify}
        leadId={formLeadId || null}
        buildMsg={buildMsg}
      />
    </div>
  );
};

export default ActivitiesPage;
