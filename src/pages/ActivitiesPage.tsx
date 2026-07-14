import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, type Dispatch, type SetStateAction } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePageState } from '@/hooks/usePageState';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToCloud, remapToCloudSync, remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useLeadActivities, LeadActivity } from '@/hooks/useLeadActivities';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import { useAuthContext } from '@/contexts/AuthContext';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityMessageTemplates } from '@/hooks/useActivityMessageTemplates';
import { useActivityStepContext } from '@/hooks/useActivityStepContext';
import { ActivityFieldSettingsDialog } from '@/components/activities/ActivityFieldSettingsDialog';
import { ActivityTTSButton } from '@/components/voice/ActivityTTSButton';
import { ActivityFormCompact, SendToGroupSection } from '@/components/activities/ActivityFormCompact';
import { CobrarVaraSection } from '@/components/activities/CobrarVaraSection';
import { CourtContactsSheet } from '@/components/activities/CourtContactsSheet';
import { ActivityCallRecorder, callFieldTextToHtml, stripHtmlToText } from '@/components/activities/ActivityCallRecorder';
import { ActivityDocumentUpload } from '@/components/activities/ActivityDocumentUpload';
import { sendVoiceToWa } from '@/lib/whatsappVoiceSend';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useSystemOabs } from '@/hooks/useSystemOabs';
import { detectClientPolo } from '@/utils/clientPoloDetection';
import { ActivityNextStepsAgent } from '@/components/activities/ActivityNextStepsAgent';
import { CompleteAndNotifyDialog } from '@/components/activities/CompleteAndNotifyDialog';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import { LeadGroupSearchDialog } from '@/components/kanban/LeadGroupSearchDialog';
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
  Play, ArrowRight, Trophy, SkipForward, Timer, Share2, User, ExternalLink, RotateCcw, LayoutGrid, List, Layers, Settings2, Sparkles, TrendingUp, Briefcase, MoreVertical,
  Users, Pin, PinOff, Pencil, UserPlus, Mic, ChevronDown, Link, Landmark,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ShareMenu } from '@/components/ShareMenu';
import { WorkflowTimer } from '@/components/instagram/WorkflowTimer';
import { ActivityChatSheet } from '@/components/activities/ActivityChatSheet';
import { ActivityDetailPanel } from '@/components/activities/ActivityDetailPanel';
import { LeadFunnelProgressBar } from '@/components/activities/LeadFunnelProgressBar';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { TeamChatButton } from '@/components/chat/TeamChatButton';
import { TeamChatSheet } from '@/components/chat/TeamChatSheet';
import { ActivityNotesField, type Attachment } from '@/components/activities/ActivityNotesField';
import { AssessorSummaryShareDialog } from '@/components/activities/AssessorSummaryShareDialog';
import { TimeBlockSettingsDialog, TimeBlockConfig } from '@/components/activities/TimeBlockSettingsDialog';
import { ActivityCreatedDialog, randomChurchillQuote } from '@/components/activities/ActivityCreatedDialog';
import { TrafficActivityPanel } from '@/components/traffic/TrafficActivityPanel';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, isToday, parseISO, startOfWeek, addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
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
  { value: 'atrasada', label: 'Atrasada' },
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

// Situação temporal derivada (não vem do banco): atrasada = prazo já passou e não concluída.
type TemporalStatus = 'atrasada' | 'hoje' | 'pendente' | 'concluida';

const getTemporalStatus = (activity: { status?: string | null; deadline?: string | null }): TemporalStatus => {
  if (activity.status === 'concluida') return 'concluida';
  if (activity.deadline) {
    try {
      const d = startOfDay(parseISO(activity.deadline));
      const today = startOfDay(new Date());
      const diff = differenceInCalendarDays(d, today);
      if (diff < 0) return 'atrasada';
      if (diff === 0) return 'hoje';
    } catch { /* deadline inválido: trata como pendente */ }
  }
  return 'pendente';
};

// Rótulo da fita do topo. Para atrasada/hoje sobrescreve o status cru; senão usa o label do STATUS_OPTIONS.
const getTemporalRibbon = (
  activity: { status?: string | null; deadline?: string | null },
): { className: string; label: string } => {
  const ts = getTemporalStatus(activity);
  if (ts === 'atrasada') {
    const dias = activity.deadline
      ? Math.abs(differenceInCalendarDays(startOfDay(parseISO(activity.deadline)), startOfDay(new Date())))
      : 0;
    const sufixo = dias === 1 ? 'venceu há 1 dia' : dias > 1 ? `venceu há ${dias} dias` : 'venceu';
    return { className: 'bg-red-600 text-white', label: `Atrasada · ${sufixo}` };
  }
  if (ts === 'hoje') return { className: 'bg-amber-500 text-white', label: 'Vence hoje' };
  if (ts === 'concluida') return { className: 'bg-emerald-600 text-white', label: 'Concluída' };
  const rawLabel = STATUS_OPTIONS.find(s => s.value === activity.status)?.label || 'Pendente';
  return { className: 'bg-muted text-muted-foreground border-b border-border/50', label: rawLabel };
};

interface LeadOption {
  id: string;
  lead_name: string | null;
}

interface TeamMember {
  user_id: string;
  full_name: string | null;
}

/**
 * Extrai apenas o primeiro nome do cliente a partir de uma string que pode ser
 * o nome de um grupo de WhatsApp.
 *  "✅PREV 291 | Allana / Irma socorro II" -> "Allana"
 *  "PREV 123 - João Silva"                 -> "João"
 *  "Maria Souza"                            -> "Maria"
 */
function extractClientFirstName(raw: string): string {
  if (!raw) return '';
  const titleCase = (w: string) =>
    w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
  const lower = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const formatTokens = (tokens: string[]) =>
    tokens
      .map((w, i) => (i > 0 && lower.has(w.toLowerCase()) ? w.toLowerCase() : titleCase(w)))
      .join(' ')
      .trim();
  const isMeaningful = (str: string) => /\p{L}{2,}/u.test(str);

  let s = raw.trim().replace(/^[^\p{L}\p{N}]+/u, '');

  // Padrão esperado: "Cidade/Estado | Vítima x Empresa | (data) - lesão"
  // Procura o segmento que contém " x " (vítima x empresa) e pega a parte antes do " x ".
  if (s.includes('|')) {
    const segments = s.split('|').map(p => p.trim()).filter(Boolean);
    const victimSeg = segments.find(seg => / x /i.test(seg));
    if (victimSeg) {
      s = victimSeg.split(/ x /i)[0].trim();
    } else {
      // Sem "x": tenta o segundo segmento (após cidade/estado), senão o primeiro com letras
      s = segments[1] && isMeaningful(segments[1]) ? segments[1] : (segments.find(isMeaningful) || segments[0] || '');
    }
  }

  // Limpa códigos iniciais tipo "PREV", "123", "PREV291"
  let tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const t = tokens[0];
    const looksLikeCode = /^[A-Z]{2,}$/.test(t) || /^\d+$/.test(t) || /^[A-Z]{2,}\d+$/.test(t);
    if (looksLikeCode) tokens.shift(); else break;
  }

  const result = formatTokens(tokens);
  // Se sobrou algo sem letras (ex: ".", "-"), retorna vazio para o caller decidir o fallback
  return isMeaningful(result) ? result : '';
}

const ActivitiesPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, profile } = useAuthContext();
  const [celebrateBlock, setCelebrateBlock] = useState<{ label: string; color: string } | null>(null);
  const celebratedBlocksRef = useRef<Set<string>>(new Set());
  const celebrationInitRef = useRef(false);
  useEffect(() => { celebrationInitRef.current = true; }, []);
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
  // Lazy initializer reads localStorage synchronously on mount, avoiding the race where
  // the filter UI shows the assignee but the fetch ran with an empty filter.
  const readAssigneeFromStorage = (key: string, fallback: string[]): string[] => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter((value): value is string => typeof value === 'string');
        }
      }
    } catch {}
    return fallback;
  };
  const [filterAssignee, setFilterAssigneeState] = useState<string[]>(() =>
    readAssigneeFromStorage(`page_state_activities_filterAssignee_${user?.id ?? 'pending'}`, user?.id ? [user.id] : [])
  );
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
  const [filterCase, setFilterCase] = usePageState<string[]>('activities_filterCase', []);
  const [filterWorkflow, setFilterWorkflow] = usePageState<string[]>('activities_filterWorkflow', []);
  const [filterHasDocs, setFilterHasDocs] = usePageState<boolean>('activities_filterHasDocs', false);
  const [activityIdsWithDocs, setActivityIdsWithDocs] = useState<Set<string>>(new Set());
  const [sheetMode, setSheetMode] = usePageState<'create' | 'edit' | null>('activities_sheetMode', null);
  const [selectedActivityId, setSelectedActivityId] = usePageState<string | null>('activities_selectedId', null);
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null);
  // Anexos/links adicionados no campo de notas antes da atividade ter id
  const pendingNoteAttachmentsRef = useRef<Attachment[]>([]);
  // Anexos adicionados nesta edição, inclusive os que já tentaram insert imediato.
  // Usado como confirmação final antes de salvar/concluir para evitar perda por race/RLS momentâneo.
  const noteAttachmentCommitCandidatesRef = useRef<Attachment[]>([]);
  const [noteAttachmentsUploading, setNoteAttachmentsUploading] = useState(false);
  const noteAttachmentsUploadingRef = useRef(false);
  const handleNotesPendingChange = useCallback((pending: Attachment[]) => {
    pendingNoteAttachmentsRef.current = pending;
  }, []);
  const handleNotesCommitCandidatesChange = useCallback((attachments: Attachment[]) => {
    noteAttachmentCommitCandidatesRef.current = attachments;
  }, []);
  const handleNotesUploadStateChange = useCallback((uploading: boolean) => {
    noteAttachmentsUploadingRef.current = uploading;
    setNoteAttachmentsUploading(uploading);
  }, []);
  const [createdDialog, setCreatedDialog] = useState<{ open: boolean; title: string; activity: LeadActivity | null }>({ open: false, title: '', activity: null });
  const [shareSummaryOpen, setShareSummaryOpen] = useState(false);
  const [courtContactsOpen, setCourtContactsOpen] = useState(false);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [leadSearch, setLeadSearch] = useState('');
  const [searchedLeads, setSearchedLeads] = useState<LeadOption[]>([]);

  // Pinned UI prefs (per-user, localStorage). Default = unpinned (hidden até passar mouse).
  const [headerPinned, setHeaderPinned] = useState<boolean>(() => {
    try { return localStorage.getItem('activities_headerPinned') === '1'; } catch { return false; }
  });
  const [actionsPinned, setActionsPinned] = useState<boolean>(() => {
    try { return localStorage.getItem('activities_actionsPinned') === '1'; } catch { return false; }
  });
  const toggleHeaderPinned = useCallback(() => {
    setHeaderPinned(p => { const n = !p; try { localStorage.setItem('activities_headerPinned', n ? '1' : '0'); } catch {} return n; });
  }, []);
  const toggleActionsPinned = useCallback(() => {
    setActionsPinned(p => { const n = !p; try { localStorage.setItem('activities_actionsPinned', n ? '1' : '0'); } catch {} return n; });
  }, []);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formWhatWasDone, setFormWhatWasDone] = useState('');
  const [formCurrentStatus, setFormCurrentStatus] = useState('');
  const [formNextSteps, setFormNextSteps] = useState('');
  const [formSolicitacao, setFormSolicitacao] = useState('');
  const [formRespostaJuizo, setFormRespostaJuizo] = useState('');
  const [formType, setFormType] = useState('');
  const [formPriority, setFormPriority] = useState('normal');
  const [formLeadId, setFormLeadId] = useState<string>('');
  const [formLeadName, setFormLeadName] = useState('');
  const [formClientNameOverride, setFormClientNameOverride] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToName, setFormAssignedToName] = useState('');
  // Co-assessores (além do principal). Cloud UUIDs.
  const [formCoAssignees, setFormCoAssignees] = useState<{ user_id: string; full_name: string }[]>([]);
  // A atividade carregada já tinha co-assessores? (permite limpar os arrays no update)
  const [loadedHadCoAssignees, setLoadedHadCoAssignees] = useState(false);
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
  const [formWorkflowId, setFormWorkflowId] = useState('');
  const [formIsSystem, setFormIsSystem] = useState(false);
  const [formIsManagement, setFormIsManagement] = useState(false);
  const [availableCases, setAvailableCases] = useState<{id: string; case_number: string; title: string; lead_id: string | null}[]>([]);
  const [caseSearch, setCaseSearch] = useState('');
  const [leadCases, setLeadCases] = useState<{id: string; case_number: string; title: string}[]>([]);
  const [caseProcesses, setCaseProcesses] = useState<{id: string; title: string; process_number: string | null; polo_ativo?: string | null; polo_passivo: string | null; cliente_polo?: string | null; tribunal: string | null; area: string | null; assuntos: string[] | null; workflow_id: string | null; envolvidos: any[] | null}[]>([]);
  // OABs dos usuários do escritório — para auto-detectar o polo do cliente.
  const systemOabs = useSystemOabs();
  const applyUpdatedCaseProcess = useCallback((updatedProcess?: any) => {
    if (!updatedProcess?.id) return;
    setCaseProcesses(prev => prev.map(proc => (
      proc.id === updatedProcess.id
        ? { ...proc, ...updatedProcess }
        : proc
    )));
  }, []);
  const [availableContacts, setAvailableContacts] = useState<{id: string; full_name: string}[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  // Activity counts for filter badges
  const [allActivitiesRaw, setAllActivitiesRaw] = useState<{ lead_id: string | null; contact_id: string | null; assigned_to: string | null; activity_type: string; status: string; workflow_id: string | null }[]>([]);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const [showAllTypes, setShowAllTypes] = useState(false);

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
  const [teamChatOpen, setTeamChatOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'form' | 'context'>('form');
  const [completeNotifyOpen, setCompleteNotifyOpen] = useState(false);
  const [completeNotifySource, setCompleteNotifySource] = useState<'sheet' | 'workflow'>('sheet');
  const [showLeadSheet, setShowLeadSheet] = useState(false);
  const [waChatPreview, setWaChatPreview] = useState<{ phone: string; contact_name: string | null; instance_name: string | null } | null>(null);
  const [groupSearchOpen, setGroupSearchOpen] = useState(false);
  // Áudio da gravação (Preenchimento por Áudio) pendente pra envio direto no botão WA.
  const [pendingAudio, setPendingAudio] = useState<{ url: string; seconds: number } | null>(null);
  const [sendingPendingAudio, setSendingPendingAudio] = useState(false);
  const [showProcessSheetId, setShowProcessSheetId] = useState<string | null>(null);
  const [viewModeRaw, setViewMode] = usePageState<'list' | 'blocks'>('activities_viewMode', 'blocks');
  const viewMode = (viewModeRaw === 'list' ? 'list' : 'blocks') as 'list' | 'blocks';
  const [formMatrixQuadrant, setFormMatrixQuadrant] = useState<string>('');
  const [dragOverQuadrant, setDragOverQuadrant] = useState<string | null>(null);
  const [aiSuggestingType, setAiSuggestingType] = useState(false);
  // Alerta de tipo incoerente com o contexto (ex.: título fala em "prazo" mas tipo = Tarefa).
  const [typeMismatch, setTypeMismatch] = useState<{ suggested: string; label: string } | null>(null);
  const typeCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [deadlineDateCount, setDeadlineDateCount] = useState<number | null>(null);
  const [notifDateCount, setNotifDateCount] = useState<number | null>(null);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [preencherOpen, setPreencherOpen] = useState(false);
  const [callRecorderOpen, setCallRecorderOpen] = useState(false);
  const [docUploadOpen, setDocUploadOpen] = useState(false);
  const [nextStepsOpen, setNextStepsOpen] = useState(false);
  const { configs: timeBlockSettings, saveSettings: saveTimeBlockConfigs } = useTimeBlockSettings();
  // Assignee's routine: when creating/editing for another user, load their routine
  const { configs: assigneeTimeBlockSettings } = useTimeBlockSettings(formAssignedTo || user?.id || undefined);
  // Blocks view: load the routine of the single selected assignee
  const blocksViewUserId = viewMode === 'blocks' && filterAssignee.length === 1 ? filterAssignee[0] : undefined;
  const { configs: blocksViewSettings } = useTimeBlockSettings(blocksViewUserId || user?.id || undefined);
  const { types: dbActivityTypes } = useActivityTypes();
  const { boards: allBoards } = useKanbanBoards();
  const workflowOptions = useMemo(
    () => allBoards.filter(b => b.board_type === 'workflow').map(b => ({ id: b.id, name: b.name })),
    [allBoards]
  );
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
    whatsapp_group_id?: string | null;
    lead_phone?: string | null;
  } | null>(null);

  const getFilterParams = () => ({
    // 'atrasada' é situação derivada (prazo vencido), não um status do banco.
    // Quando está selecionada, o hook busca TODAS as vencidas não concluídas no servidor,
    // paginando sem teto, e mescla com os demais status selecionados (OR do multi-select).
    status: (() => {
      const real = filterStatus.filter(s => s !== 'atrasada');
      return real.length > 0 ? real : 'all';
    })(),
    overdue: filterStatus.includes('atrasada'),
    activity_type: filterType.length > 0 ? filterType : 'all',
    assigned_to: filterAssignee.length > 0 ? filterAssignee : 'all',
    lead_id: filterLead.length > 0 ? filterLead : 'all',
    contact_id: filterContact.length > 0 ? filterContact : 'all',
    workflow_id: filterWorkflow.length > 0 ? filterWorkflow : 'all',
    // Sem isso, o teto padrão de 500 corta pendentes antigas quando "Todos" está ativo
    // (as mais recentes 500 enchem com concluídas e a lista perde pendentes).
    limit: 5000,
  });

  // Re-sync from localStorage when the storage key changes (e.g. user logs in after mount).
  // The initial value already came from the lazy initializer, so we skip the first run
  // to avoid clobbering an in-memory selection on every render.
  const lastSyncedKeyRef = useRef<string | null>(assigneeStorageKey);
  useEffect(() => {
    if (lastSyncedKeyRef.current === assigneeStorageKey) return;
    lastSyncedKeyRef.current = assigneeStorageKey;

    if (!user?.id) {
      setFilterAssigneeState([]);
      return;
    }

    setFilterAssigneeState(readAssigneeFromStorage(assigneeStorageKey, [user.id]));
    // Persist default if nothing was stored yet
    try {
      if (localStorage.getItem(assigneeStorageKey) === null) {
        localStorage.setItem(assigneeStorageKey, JSON.stringify([user.id]));
      }
    } catch {}
  }, [assigneeStorageKey, user?.id]);

  useEffect(() => {
    fetchActivities(getFilterParams());
  }, [fetchActivities, filterStatus, filterType, filterAssignee, filterLead, filterContact, filterWorkflow]);

  useEffect(() => {
    if (viewMode === 'blocks') setOpenFilterKey(null);
  }, [viewMode]);

  // Prefill workflow from linked process (user can still change)
  useEffect(() => {
    if (!formProcessId) return;
    const proc = caseProcesses.find(p => p.id === formProcessId);
    if (proc?.workflow_id && !formWorkflowId) {
      setFormWorkflowId(proc.workflow_id);
    }
  }, [formProcessId, caseProcesses, formWorkflowId]);

  // Busca IDs de atividades marcadas manualmente como "Com documentação" (marker)
  useEffect(() => {
    const load = async () => {
      const { data } = await externalSupabase.from('activity_attachments')
        .select('activity_id')
        .eq('attachment_type', 'marker');
      if (data) setActivityIdsWithDocs(new Set(data.map((a: any) => a.activity_id)));
    };
    load();
  }, []);

  const toggleHasDocs = useCallback(async (activityId: string) => {
    const has = activityIdsWithDocs.has(activityId);
    const next = new Set(activityIdsWithDocs);
    if (has) {
      next.delete(activityId);
      setActivityIdsWithDocs(next);
      try {
        await externalSupabase.from('activity_attachments')
          .delete()
          .eq('activity_id', activityId)
          .eq('attachment_type', 'marker');
      } catch (e) { console.warn('[toggleHasDocs] delete falhou', e); }
    } else {
      next.add(activityId);
      setActivityIdsWithDocs(next);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const extUserId = await remapToExternal(user?.id || null);
        await externalSupabase.from('activity_attachments').insert({
          activity_id: activityId,
          file_url: '',
          file_name: 'marker',
          file_type: 'marker',
          attachment_type: 'marker',
          created_by: extUserId,
        });
      } catch (e) { console.warn('[toggleHasDocs] insert falhou', e); }
    }
  }, [activityIdsWithDocs]);

  const toggleFilter = (setter: React.Dispatch<React.SetStateAction<string[]>>, current: string[], value: string) => {
    setter(current.includes(value) ? current.filter(v => v !== value) : [...current, value]);
  };

  // Fetch raw counts (lightweight) - only on mount, deferred so it doesn't block first paint
  const countsLoadedRef = useRef(false);
  useEffect(() => {
    const loadCounts = async () => {
      const { data } = await (externalSupabase as any).from('lead_activities').select('lead_id, contact_id, assigned_to, activity_type, status, workflow_id').limit(2000);
      setAllActivitiesRaw(data || []);
      countsLoadedRef.current = true;
    };
    const idle = (cb: () => void) => {
      if (typeof (window as any).requestIdleCallback === 'function') {
        (window as any).requestIdleCallback(cb, { timeout: 1500 });
      } else {
        setTimeout(cb, 400);
      }
    };
    idle(() => { loadCounts(); });
  }, []); // Load once on mount
  
  // Refresh counts only after mutations (create/update/delete) - not on every fetch
  const refreshCounts = useCallback(async () => {
    const { data } = await (externalSupabase as any).from('lead_activities').select('lead_id, contact_id, assigned_to, activity_type, status, workflow_id').limit(2000);
    setAllActivitiesRaw(data || []);
  }, []);
  
  // Wire up the ref so fetchActivities wrapper can call refreshCounts
  useEffect(() => { refreshCountsRef.current = refreshCounts; }, [refreshCounts]);

  useEffect(() => {
    const loadSupport = async () => {
      const [leadsRes, membersRes, contactsRes, casesRes] = await Promise.all([
        externalSupabase.from('leads').select('id, lead_name').order('lead_name').limit(500),
        supabase.from('profiles').select('user_id, full_name'),
        externalSupabase.from('contacts').select('id, full_name').order('full_name').limit(500),
        externalSupabase.from('legal_cases').select('id, case_number, title, lead_id').order('created_at', { ascending: false }).limit(500),
      ]);
      setLeads(leadsRes.data || []);
      setTeamMembers(membersRes.data || []);
      setAvailableContacts(contactsRes.data || []);
      setAvailableCases(casesRes.data || []);
      ensureRemapCache();
    };
    loadSupport();
  }, []);

  // Load workflow step activity types: for each lead, find the activityType from workflow checklist items.
  // Runs ONCE on mount (deferred to idle time) — used to be re-running on every `activities` change,
  // which refetched ALL leads + templates dozens of times per session.
  useEffect(() => {
    const loadWorkflowStepTypes = async () => {
      const { data: leadsData } = await externalSupabase.from('leads').select('id, status, board_id');
      if (!leadsData || leadsData.length === 0) return;
      const { data: linksData } = await externalSupabase.from('checklist_stage_links').select('stage_id, checklist_template_id');
      if (!linksData || linksData.length === 0) return;
      const templateIds = [...new Set(linksData.map(l => l.checklist_template_id))];
      const { data: templatesData } = await externalSupabase.from('checklist_templates').select('id, items').in('id', templateIds);
      if (!templatesData) return;
      const stageTypeMap: Record<string, string> = {};
      linksData.forEach(link => {
        if (stageTypeMap[link.stage_id]) return;
        const tmpl = templatesData.find(t => t.id === link.checklist_template_id);
        if (!tmpl) return;
        const items = (tmpl.items as any[]) || [];
        const stepWithType = items.find((item: any) => item.activityType);
        if (stepWithType?.activityType) stageTypeMap[link.stage_id] = stepWithType.activityType;
      });
      const leadTypeMap: Record<string, string> = {};
      leadsData.forEach(lead => {
        if (!lead.status) return;
        const type = stageTypeMap[lead.status];
        if (type) leadTypeMap[lead.id] = type;
      });
      setLeadWorkflowActivityTypes(leadTypeMap);
    };
    const idle = (cb: () => void) => {
      if (typeof (window as any).requestIdleCallback === 'function') {
        (window as any).requestIdleCallback(cb, { timeout: 2000 });
      } else {
        setTimeout(cb, 600);
      }
    };
    idle(() => { loadWorkflowStepTypes(); });
  }, []);

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
      if (excludeField !== 'status' && filterStatus.length > 0) {
        // 'atrasada' é derivado e o raw não traz deadline — ignora na contagem.
        const realStatuses = filterStatus.filter(s => s !== 'atrasada');
        if (realStatuses.length > 0)
          filtered = filtered.filter(a => realStatuses.includes(a.status));
      }
      if (excludeField !== 'lead_id' && filterLead.length > 0)
        filtered = filtered.filter(a => a.lead_id && filterLead.includes(a.lead_id));
      if (excludeField !== 'contact_id' && filterContact.length > 0)
        filtered = filtered.filter(a => a.contact_id && filterContact.includes(a.contact_id));
      if (excludeField !== 'workflow_id' && filterWorkflow.length > 0) {
        const hasUnassigned = filterWorkflow.includes('__unassigned__');
        const validIds = filterWorkflow.filter(v => v !== '__unassigned__');
        filtered = filtered.filter(a => {
          if (hasUnassigned && !a.workflow_id) return true;
          return validIds.length > 0 && a.workflow_id && validIds.includes(a.workflow_id);
        });
      }
      return filtered;
    };
  }, [allActivitiesRaw, filterAssignee, filterType, filterStatus, filterLead, filterContact, filterWorkflow]);

  // Count helpers - contextual to other active filters
  const countByField = useMemo(() => {
    const countFor = (fieldKey: 'lead_id' | 'contact_id' | 'assigned_to' | 'activity_type' | 'status' | 'workflow_id', value: string) => {
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
    setFormSolicitacao('');
    setFormRespostaJuizo('');
    setFormType(timeBlockSettings.length > 0 ? timeBlockSettings[0].activityType : '');
    setFormPriority('normal');
    setFormLeadId('');
    setFormLeadName('');
    setFormClientNameOverride('');
    const currentUser = teamMembers.find(m => m.user_id === user?.id);
    setFormAssignedTo(user?.id || '');
    setFormAssignedToName(currentUser?.full_name || '');
    setFormCoAssignees([]);
    setLoadedHadCoAssignees(false);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    setFormDeadline(todayStr);
    setFormNotificationDate(todayStr);
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
    setFormWorkflowId('');
    setLeadCases([]);
    setCaseProcesses([]);
    setFormMatrixQuadrant('');
    setFormIsSystem(false);
    setFormIsManagement(false);
    handleNotesPendingChange([]);
    handleNotesCommitCandidatesChange([]);
    handleNotesUploadStateChange(false);
  };

  // suggestActivityType moved below routineActivityTypes

  // handleTitleChange moved below routineActivityTypes

  const generateTitleWithAI = async (): Promise<string | null> => {
    const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = [
      formCurrentStatus && `COMO ESTÁ: ${stripHtml(formCurrentStatus)}`,
      formWhatWasDone && `O QUE FOI FEITO: ${stripHtml(formWhatWasDone)}`,
      formNextSteps && `PRÓXIMO PASSO: ${stripHtml(formNextSteps)}`,
      formSolicitacao && `SOLICITAÇÃO: ${stripHtml(formSolicitacao)}`,
      formRespostaJuizo && `RESPOSTA DO JUÍZO: ${stripHtml(formRespostaJuizo)}`,
      formNotes && `OBSERVAÇÕES: ${stripHtml(formNotes)}`,
    ].filter(Boolean).join('\n');
    if (!parts) return null;
    try {
      const { data, error } = await supabase.functions.invoke('ai-text-editor', {
        body: {
          text: parts,
          action: 'custom',
          custom_prompt: 'Gere um título curto (no máximo 8 palavras, sem aspas, sem ponto final) que resuma o assunto desta atividade jurídica de forma clara para qualquer pessoa entender do que se trata. Retorne APENAS o título, sem prefixos como "Título:".',
        },
      });
      if (error) throw error;
      const opt = (data?.options?.[0] || '').trim().replace(/^["'`]+|["'`.]+$/g, '');
      return opt || null;
    } catch (e) {
      console.error('Erro gerando título com IA:', e);
      return null;
    }
  };

  const uniqueAttachmentsByUrl = (items: Attachment[]) => {
    const seen = new Set<string>();
    return items.filter((attachment) => {
      if (!attachment.file_url) return false;
      const key = attachment.file_url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  // Confirma no banco externo os anexos/links adicionados no campo de notas.
  // Em vez de depender só do insert imediato do componente, este commit final
  // consulta o activity_id atual e insere somente o que ainda não está vinculado.
  const flushPendingAttachments = async (activityId: string, pendingOverride?: Attachment[]) => {
    const pending = pendingOverride ?? pendingNoteAttachmentsRef.current;
    const candidates = uniqueAttachmentsByUrl([
      ...pending,
      ...noteAttachmentCommitCandidatesRef.current,
    ]);
    if (!activityId || candidates.length === 0) return true;
    const { data: { user } } = await supabase.auth.getUser();
    const extUserId = await remapToExternal(user?.id || null);

    const urls = candidates.map((a) => a.file_url);
    const { data: existing, error: existingError } = await externalSupabase
      .from('activity_attachments')
      .select('id, file_url')
      .eq('activity_id', activityId)
      .in('file_url', urls);

    if (existingError) {
      toast.error('Não consegui confirmar os anexos da atividade');
      console.error('[flushPendingAttachments] select existente falhou', existingError);
      throw existingError;
    }

    const existingUrls = new Set((existing || []).map((row: any) => row.file_url));
    const missing = candidates.filter((attachment) => !existingUrls.has(attachment.file_url));
    if (missing.length === 0) {
      handleNotesPendingChange([]);
      handleNotesCommitCandidatesChange([]);
      return true;
    }

    const rows = missing.map((a) => ({
      activity_id: activityId,
      file_url: a.file_url,
      file_name: a.file_name,
      file_type: a.file_type,
      file_size: a.file_size ?? null,
      attachment_type: a.attachment_type,
      link_url: a.link_url ?? null,
      link_title: a.link_title ?? null,
      created_by: extUserId,
    }));
    const { data, error } = await externalSupabase
      .from('activity_attachments')
      .insert(rows)
      .select('id');
    if (error) {
      toast.error('Atividade salva, mas falhou ao salvar os anexos');
      console.error('[flushPendingAttachments]', error);
      throw error;
    }
    if ((data?.length || 0) !== rows.length) {
      const err = new Error(`Insert de anexos retornou ${data?.length || 0}/${rows.length} registros`);
      console.error('[flushPendingAttachments]', err);
      throw err;
    }
    handleNotesPendingChange([]);
    handleNotesCommitCandidatesChange([]);
    return true;
  };

  const handleCreate = async () => {
    if (noteAttachmentsUploadingRef.current) {
      toast.info('Aguarde o envio dos anexos terminar antes de salvar.');
      return;
    }

    let titleToUse = formTitle.trim();

    const hasContentForAI =
      !!(formWhatWasDone || formCurrentStatus || formNextSteps || formSolicitacao || formRespostaJuizo || formNotes);

    if (!titleToUse && !hasContentForAI) {
      toast.error('Informe o assunto da atividade ou preencha algum campo de detalhes');
      return;
    }
    if (!formType) {
      toast.error('Selecione o tipo de atividade');
      return;
    }
    if (!formAssignedTo) {
      toast.error('Selecione o assessor');
      return;
    }
    if (!formDeadline) {
      toast.error('Informe o prazo');
      return;
    }
    if (!formNotificationDate) {
      toast.error('Informe a data de notificação');
      return;
    }
    if (!formWorkflowId && !formIsSystem && !formIsManagement) {
      toast.error('Selecione um fluxo de trabalho para continuar');
      return;
    }

    if (!titleToUse && hasContentForAI) {
      const aiLoadingId = toast.loading('Gerando assunto com IA...');
      const aiTitle = await generateTitleWithAI();
      toast.dismiss(aiLoadingId);
      if (aiTitle) {
        titleToUse = aiTitle;
        setFormTitle(aiTitle);
      } else {
        toast.error('Não foi possível gerar o assunto automaticamente. Escreva manualmente.');
        return;
      }
    }

    const baseData = {
      title: titleToUse,
      description: null,
      what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null,
      next_steps: formNextSteps || null,
      solicitacao: formSolicitacao || null,
      resposta_juizo: formRespostaJuizo || null,
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
      workflow_id: formWorkflowId || null,
      is_system: formIsSystem,
      is_management: formIsManagement,
      client_name_override: formClientNameOverride || null,
      ...buildAssigneesPayload(),
    };

    let createdActivityId: string | null = null;
    let createdActivityFull: any = null;
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
        if (!createdActivityId && result?.id) {
          createdActivityId = result.id;
          createdActivityFull = result;
        }
      }
      toast.success(`${formRepeatWeekDays.length} atividades criadas para a semana!`);
    } else {
      const result = await createActivity({
        ...baseData,
        deadline: formDeadline || null,
        notification_date: formNotificationDate || null,
      });
      if (result?.id) {
        createdActivityId = result.id;
        createdActivityFull = result;
      }
    }


    // Persiste links/anexos adicionados antes da atividade existir
    if (createdActivityId) await flushPendingAttachments(createdActivityId, pendingNoteAttachmentsRef.current);

    // If created for another assignee, add them to the filter so the activities are visible
    if (formAssignedTo && formAssignedTo !== user?.id && !filterAssignee.includes(formAssignedTo)) {
      setFilterAssignee(prev => [...prev, formAssignedTo!]);
    }

    closeSheet();
    fetchActivities(getFilterParams());

    // Confirmation dialog with title + edit/delete actions
    if (createdActivityId && createdActivityFull) {
      const activityForActions = createdActivityFull as LeadActivity;
      setCreatedDialog({ open: true, title: titleToUse, activity: activityForActions });
    }
  };

  const handleOpenEdit = async (activity: LeadActivity) => {
    // Set all form state synchronously first (instant UI)
    setSelectedActivity(activity);
    setSelectedActivityId(activity.id);
    setFormTitle(activity.title);
    setFormWhatWasDone(activity.what_was_done || '');
    setFormCurrentStatus(activity.current_status_notes || '');
    setFormNextSteps(activity.next_steps || '');
    setFormSolicitacao((activity as any).solicitacao || '');
    setFormRespostaJuizo((activity as any).resposta_juizo || '');
    setFormType(activity.activity_type);
    setFormPriority(activity.priority || 'normal');
    setFormLeadId(activity.lead_id || '');
    setFormIsSystem(!!(activity as any).is_system);
    setFormIsManagement(!!(activity as any).is_management);
    setFormLeadName(activity.lead_name || '');
    setFormAssignedTo(((await remapToCloud(activity.assigned_to)) as string) || '');
    setFormAssignedToName(activity.assigned_to_name || '');
    await hydrateCoAssignees(activity);
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
    setFormClientNameOverride((activity as any).client_name_override || '');
    setSheetMode('edit');

    // Fire all DB queries in parallel (non-blocking)
    const promises: Promise<any>[] = [];

    if (activity.lead_id) {
      promises.push(
        Promise.all([
          externalSupabase.from('legal_cases').select('id, case_number, title').eq('lead_id', activity.lead_id),
          externalSupabase.from('contact_leads').select('contact_id').eq('lead_id', activity.lead_id),
          externalSupabase.from('leads').select('case_type, damage_description, accident_date, updated_at, board_id, lead_status, whatsapp_group_id, lead_phone').eq('id', activity.lead_id).maybeSingle(),
        ]).then(async ([casesRes, linkedRes, leadPreviewRes]) => {
          setLeadCases(casesRes.data || []);

          // Board name
          let boardName: string | null = null;
          if (leadPreviewRes.data?.board_id) {
            const { data: boardData } = await externalSupabase.from('kanban_boards').select('name').eq('id', leadPreviewRes.data.board_id).maybeSingle();
            boardName = boardData?.name || null;
          }
          setLeadPreview(leadPreviewRes.data ? { ...leadPreviewRes.data, board_name: boardName } : null);

          // Contacts
          if (linkedRes.data && linkedRes.data.length > 0) {
            const contactIds = linkedRes.data.map(cl => cl.contact_id);
            const { data: contactsData } = await externalSupabase.from('contacts').select('id, full_name').in('id', contactIds).order('full_name');
            setAvailableContacts(contactsData || []);
          } else {
            const { data: allContacts } = await externalSupabase.from('contacts').select('id, full_name').order('full_name').limit(500);
            setAvailableContacts(allContacts || []);
          }
        }).catch(() => {})
      );
    } else {
      setLeadPreview(null);
    }

    if ((activity as any).case_id) {
      promises.push(
        Promise.resolve(externalSupabase.from('lead_processes').select('id, title, process_number, polo_ativo, polo_passivo, cliente_polo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos').eq('case_id', (activity as any).case_id)).then(({ data }) => {
          setCaseProcesses((data || []).map((p: any) => ({ id: p.id, title: p.title, process_number: p.process_number, polo_ativo: p.polo_ativo, polo_passivo: p.polo_passivo, cliente_polo: p.cliente_polo, tribunal: p.tribunal, area: p.area, assuntos: p.assuntos, workflow_id: p.workflow_id, workflow_name: p.workflow_name, envolvidos: p.envolvidos })));
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

      (externalSupabase as any)
        .from('lead_activities')
        .select('*')
        .eq('id', openActivityId)
        .is('deleted_at', null)
        .maybeSingle()
        .then(({ data, error }: { data: any; error: any }) => {
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
    if (noteAttachmentsUploadingRef.current) {
      toast.info('Aguarde o envio dos anexos terminar antes de salvar.');
      return;
    }
    if (!formAssignedTo) { toast.error('Selecione o assessor'); return; }
    if (!formDeadline) { toast.error('Informe o prazo'); return; }
    if (!formNotificationDate) { toast.error('Informe a data de notificação'); return; }
    try {
      await flushPendingAttachments(selectedActivity.id, pendingNoteAttachmentsRef.current);
    } catch {
      toast.error('Falha ao salvar anexos. A atividade não foi salva.');
      return;
    }
    await updateActivity(selectedActivity.id, {
      title: formTitle,
      description: null,
      what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null,
      next_steps: formNextSteps || null,
      solicitacao: formSolicitacao || null,
      resposta_juizo: formRespostaJuizo || null,
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
      client_name_override: formClientNameOverride || null,
      ...buildAssigneesPayload(),
    } as any);
    closeSheet();
    fetchActivities(getFilterParams());
  };

  const handleComplete = async (id: string) => {
    if (noteAttachmentsUploadingRef.current) {
      toast.info('Aguarde o envio dos anexos terminar antes de concluir.');
      return;
    }
    try {
      await flushPendingAttachments(id, pendingNoteAttachmentsRef.current);
    } catch {
      toast.error('Falha ao salvar anexos. A atividade não foi concluída.');
      return;
    }
    await completeActivity(id);
    fetchActivities(getFilterParams());
    toast.success('Atividade concluída! 🎉', {
      description: randomChurchillQuote(),
      duration: 6000,
    });
  };

  const openCompleteAndNotify = (source: 'sheet' | 'workflow') => {
    if (noteAttachmentsUploadingRef.current) {
      toast.info('Aguarde o envio dos anexos terminar antes de concluir.');
      return;
    }
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

      // BUGFIX: anexos pendentes (sem id) pertencem à atividade ATUAL que está
      // sendo concluída — não à próxima. Persistir AGORA, antes de concluir,
      // para garantir que os arquivos não se percam.
      const pendingBeforeComplete = pendingNoteAttachmentsRef.current;
      // Snapshot dos anexos para replicar também na próxima atividade.
      const attachmentsToCarryOver = uniqueAttachmentsByUrl([
        ...pendingBeforeComplete,
        ...noteAttachmentCommitCandidatesRef.current,
      ]);
      if (pendingBeforeComplete.length > 0) {
        try {
          await flushPendingAttachments(currentActivity.id, pendingBeforeComplete);
        } catch (e) {
          console.error('[completeAndNext] flush atual falhou', e);
          toast.error('Falha ao salvar anexos da atividade atual. Tente novamente.');
          return;
        }
      }

      // Capture form values BEFORE any state changes
      const nextData = {
        title: formTitle,
        description: null as string | null,
        what_was_done: formWhatWasDone || null,
        current_status_notes: formCurrentStatus || null,
        next_steps: formNextSteps || null,
        // Solicitação e Resposta do juízo são específicos da atividade concluída —
        // a próxima etapa começa em branco nesses dois campos.
        solicitacao: null,
        resposta_juizo: null,
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
        is_system: formIsSystem,
        is_management: formIsManagement,
        client_name_override: formClientNameOverride || null,
        ...buildAssigneesPayload(),
      };

      // Conclude the current activity without overwriting its existing data
      await completeActivity(currentActivity.id);
      toast.success('Atividade concluída! 🎉', {
        description: randomChurchillQuote(),
        duration: 6000,
      });

      // Create the next activity with the captured form data
      const nextCreated = await createActivity(nextData);

      // BUGFIX: replicar os MESMOS anexos na nova atividade, para que apareçam
      // tanto na atividade concluída quanto na nova criada.
      if (nextCreated?.id && attachmentsToCarryOver.length > 0) {
        try {
          const { data: { user: au } } = await supabase.auth.getUser();
          const extUid = await remapToExternal(au?.id || null);
          const rows = attachmentsToCarryOver.map((a) => ({
            activity_id: nextCreated.id,
            file_url: a.file_url,
            file_name: a.file_name,
            file_type: a.file_type,
            file_size: a.file_size ?? null,
            attachment_type: a.attachment_type,
            link_url: a.link_url ?? null,
            link_title: a.link_title ?? null,
            created_by: extUid,
          }));
          const { error: carryErr } = await externalSupabase
            .from('activity_attachments')
            .insert(rows);
          if (carryErr) {
            console.error('[completeAndNext] carry-over anexos falhou', carryErr);
            toast.error('Anexos não foram replicados na nova atividade');
          }
        } catch (e) {
          console.error('[completeAndNext] carry-over anexos exception', e);
        }
      }

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
    setFormSolicitacao((activity as any).solicitacao || '');
    setFormRespostaJuizo((activity as any).resposta_juizo || '');
    setFormType(activity.activity_type);
    setFormPriority(activity.priority || 'normal');
    setFormLeadId(activity.lead_id || '');
    setFormIsSystem(!!(activity as any).is_system);
    setFormIsManagement(!!(activity as any).is_management);
    setFormLeadName(activity.lead_name || '');
    setFormAssignedTo(((await remapToCloud(activity.assigned_to)) as string) || '');
    setFormAssignedToName(activity.assigned_to_name || '');
    await hydrateCoAssignees(activity);
    setFormDeadline(activity.deadline || '');
    setFormNotificationDate(activity.notification_date || '');
    setFormNotes(activity.notes || '');
    setFormStatus(activity.status || 'pendente');
    setFormContactId(activity.contact_id || '');
    setFormContactName(activity.contact_name || '');
    setFormClientNameOverride((activity as any).client_name_override || '');
    setFormMatrixQuadrant((activity as any).matrix_quadrant || '');
    if (activity.lead_id) {
      try {
        const [linkedData, leadPreviewRes] = await Promise.all([
          externalSupabase.from('contact_leads').select('contact_id').eq('lead_id', activity.lead_id),
          externalSupabase.from('leads').select('case_type, damage_description, accident_date, updated_at, board_id, lead_status, whatsapp_group_id, lead_phone').eq('id', activity.lead_id).maybeSingle(),
        ]);
        let boardName: string | null = null;
        if (leadPreviewRes.data?.board_id) {
          const { data: boardData } = await externalSupabase.from('kanban_boards').select('name').eq('id', leadPreviewRes.data.board_id).maybeSingle();
          boardName = boardData?.name || null;
        }
        setLeadPreview(leadPreviewRes.data ? { ...leadPreviewRes.data, board_name: boardName } : null);
        if (linkedData.data && linkedData.data.length > 0) {
          const contactIds = linkedData.data.map(cl => cl.contact_id);
          const { data: contactsData } = await externalSupabase
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
    if (noteAttachmentsUploadingRef.current) {
      toast.info('Aguarde o envio dos anexos terminar antes de concluir.');
      return;
    }
    try {
      await flushPendingAttachments(selectedActivity.id, pendingNoteAttachmentsRef.current);
    } catch {
      toast.error('Falha ao salvar anexos. A atividade não foi concluída.');
      return;
    }
    await updateActivity(selectedActivity.id, {
      title: formTitle, what_was_done: formWhatWasDone || null,
      current_status_notes: formCurrentStatus || null, next_steps: formNextSteps || null,
      solicitacao: formSolicitacao || null, resposta_juizo: formRespostaJuizo || null,
      activity_type: formType, priority: formPriority, lead_id: formLeadId || null,
      lead_name: formLeadName || null, assigned_to: formAssignedTo || null,
      assigned_to_name: formAssignedToName || null, deadline: formDeadline || null,
      notification_date: formNotificationDate || null, notes: formNotes || null,
      status: formStatus, contact_id: formContactId || null, contact_name: formContactName || null,
      client_name_override: formClientNameOverride || null,
      ...buildAssigneesPayload(),
    } as any);
    await completeActivity(selectedActivity.id);
    toast.success('Atividade concluída! 🎉', {
      description: randomChurchillQuote(),
      duration: 6000,
    });
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
    setFormClientNameOverride('');
    setFormContactId('');
    setFormContactName('');
    setContactSearch('');
    setFormCaseId('');
    setFormCaseTitle('');
    setFormProcessId('');
    setFormProcessTitle('');
    setFormWorkflowId('');
    setCaseProcesses([]);
    // Load cases for this lead
    externalSupabase.from('legal_cases').select('id, case_number, title').eq('lead_id', leadId).then(({ data }) => {
      setLeadCases(data || []);
    });
    // Load lead preview (needed for header progress bar)
    externalSupabase
      .from('leads')
      .select('case_type, damage_description, accident_date, updated_at, board_id, lead_status, whatsapp_group_id, lead_phone')
      .eq('id', leadId)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) { setLeadPreview(null); return; }
        let boardName: string | null = null;
        if (data.board_id) {
          const { data: boardData } = await externalSupabase.from('kanban_boards').select('name').eq('id', data.board_id).maybeSingle();
          boardName = boardData?.name || null;
        }
        setLeadPreview({ ...data, board_name: boardName });
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
      const { data: linkedData } = await externalSupabase
        .from('contact_leads')
        .select('contact_id')
        .eq('lead_id', leadId);
      if (linkedData && linkedData.length > 0) {
        const contactIds = linkedData.map(cl => cl.contact_id);
        const { data: contactsData } = await externalSupabase
          .from('contacts')
          .select('id, full_name')
          .in('id', contactIds)
          .order('full_name');
        setAvailableContacts(contactsData || []);
      } else {
        // No linked contacts, load all
        const { data: allContacts } = await externalSupabase
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
    setFormClientNameOverride('');
    setFormContactId('');
    setFormContactName('');
    setFormCaseId('');
    setFormCaseTitle('');
    setFormProcessId('');
    setFormProcessTitle('');
    setFormWorkflowId('');
    setLeadCases([]);
    setCaseProcesses([]);
    // Load all contacts
    const { data } = await externalSupabase.from('contacts').select('id, full_name').order('full_name').limit(500);
    setAvailableContacts(data || []);
  };

  // Carrega os co-assessores da atividade (colunas de array do Externo → Cloud UUIDs).
  const hydrateCoAssignees = async (activity: any) => {
    const extIds = (activity.assigned_to_ids as string[] | null) || [];
    const names = (activity.assigned_to_names as string[] | null) || [];
    if (extIds.length > 1) {
      const primaryCloud = ((await remapToCloud(activity.assigned_to)) as string) || '';
      const cloudIds = await Promise.all(extIds.map((id) => remapToCloud(id)));
      const co = cloudIds
        .map((cid, i) => ({ user_id: (cid as string) || '', full_name: names[i] || '' }))
        .filter((c) => c.user_id && c.user_id !== primaryCloud);
      setFormCoAssignees(co);
      setLoadedHadCoAssignees(true);
    } else {
      setFormCoAssignees([]);
      setLoadedHadCoAssignees(false);
    }
  };

  // Seleção multi: 1º clique define o principal; cliques seguintes alternam co-assessores.
  // Clicar no principal o desmarca (o 1º co-assessor, se houver, vira o principal).
  const handleSelectAssignee = (userId: string) => {
    const member = teamMembers.find(m => m.user_id === userId);
    const name = member?.full_name || '';
    if (formAssignedTo === userId) {
      const [next, ...rest] = formCoAssignees;
      setFormAssignedTo(next?.user_id || '');
      setFormAssignedToName(next?.full_name || '');
      setFormCoAssignees(rest);
    } else if (formCoAssignees.some(c => c.user_id === userId)) {
      setFormCoAssignees(prev => prev.filter(c => c.user_id !== userId));
    } else if (!formAssignedTo) {
      setFormAssignedTo(userId);
      setFormAssignedToName(name);
    } else {
      setFormCoAssignees(prev => [...prev, { user_id: userId, full_name: name }]);
    }
  };

  // Colunas de array (multi-assessor) só entram no payload quando há co-assessor
  // (ou quando a atividade carregada já tinha — para permitir limpar). Assim, banco
  // ainda sem a migração de assigned_to_ids/assigned_to_names continua funcionando.
  const buildAssigneesPayload = () => {
    if (formCoAssignees.length === 0 && !loadedHadCoAssignees) return {};
    return {
      assigned_to_ids: [formAssignedTo, ...formCoAssignees.map(c => c.user_id)].filter(Boolean),
      assigned_to_names: [formAssignedToName, ...formCoAssignees.map(c => c.full_name)].filter(Boolean),
    };
  };

  const handleDeadlineChange = (value: string) => {
    setFormDeadline(value);
    if (!formNotificationDate) {
      setFormNotificationDate(value);
    }
  };

  // Fetch open activity counts for the assignee on the selected dates
  useEffect(() => {
    const fetchDateCount = async (
      date: string,
      column: 'deadline' | 'notification_date',
      setter: (v: number | null) => void,
    ) => {
      if (!date || !formAssignedTo) { setter(null); return; }
      // lead_activities vive no Externo; assigned_to guarda UUID do Externo.
      // formAssignedTo é UUID do Cloud — precisa remapear antes de filtrar.
      const extAssignedTo = await remapToExternal(formAssignedTo);
      if (!extAssignedTo) { setter(null); return; }
      // Usa exatamente a mesma comparação de data do Prazo.
      // O input entrega YYYY-MM-DD e o banco também deve ser comparado por esse valor puro.
      const dayStr = date.length >= 10 ? date.slice(0, 10) : date;
      let query = externalSupabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', extAssignedTo)
        .neq('status', 'concluida');
      query = query.eq(column, dayStr);
      const { count, error } = await query;
      if (!error) setter(count ?? 0);
    };
    fetchDateCount(formDeadline, 'deadline', setDeadlineDateCount);
    // O badge de Notificação deve indicar a mesma ocupação do dia exibida em Prazo.
    // Portanto, mesmo usando a data escolhida em Notificação, a contagem é feita por `deadline`.
    fetchDateCount(formNotificationDate, 'deadline', setNotifDateCount);
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
      // Usa deadline como chave principal; cai pra notification_date quando não há prazo
      // (ex: atividades concluídas sem prazo definido mas com data de notificação)
      const raw = a.deadline || (a as any).notification_date || null;
      const key = raw ? raw.slice(0, 10) : null;
      if (key) {
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
    let list = activities;
    // 'atrasada' é filtrada no client (não existe como status no banco). Quando selecionada,
    // o backend trouxe 'all', então aplicamos o filtro de status aqui mantendo o OR do multi-select.
    if (filterStatus.includes('atrasada')) {
      const realStatuses = filterStatus.filter(s => s !== 'atrasada');
      list = list.filter(a =>
        getTemporalStatus(a) === 'atrasada' || realStatuses.includes(a.status as string)
      );
    }
    if (filterHasDocs) {
      list = list.filter(a => activityIdsWithDocs.has(a.id));
    }
    if (filterCase.length > 0) {
      list = list.filter(a => (a as any).case_id && filterCase.includes((a as any).case_id));
    }
    if (selectedCalDays.length > 0) {
      list = list.filter(a => {
        const raw = a.deadline || a.notification_date;
        const dateKey = raw ? raw.slice(0, 10) : null;
        return dateKey ? selectedCalDays.includes(dateKey) : false;
      });
    } else if (viewMode === 'list' && !filterStatus.includes('atrasada')) {
      // Sem dia selecionado: a lista acompanha o mês exibido no calendário.
      // Exceção: com o filtro 'Atrasada' ativo, mostramos vencidas de qualquer mês.
      // Atividades sem nenhuma data continuam visíveis (não têm lugar no calendário).
      const monthPrefix = format(calendarMonth, 'yyyy-MM');
      list = list.filter(a => {
        const raw = a.deadline || a.notification_date;
        const dateKey = raw ? raw.slice(0, 10) : null;
        return !dateKey || dateKey.startsWith(monthPrefix);
      });
    }
    // Ordena por prioridade: urgente > alta > normal > baixa (mantém ordem original como tiebreaker)
    const priorityRank: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
    return [...list].sort((a, b) => {
      const ra = priorityRank[a.priority || 'normal'] ?? 2;
      const rb = priorityRank[b.priority || 'normal'] ?? 2;
      return ra - rb;
    });
  }, [activities, selectedCalDays, filterCase, viewMode, calendarMonth, filterStatus, filterHasDocs, activityIdsWithDocs]);

  // A busca sem teto (filtro Atrasada) pode trazer milhares de linhas; o DOM não aguenta
  // todos os cards de uma vez — renderiza em lotes e revela o resto sob demanda.
  const RENDER_BATCH = 200;
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  useEffect(() => {
    setRenderLimit(RENDER_BATCH);
  }, [filterStatus, filterType, filterAssignee, filterLead, filterContact, filterWorkflow, filterCase, selectedCalDays, calendarMonth, viewMode]);

  const resolveUserName = (userId: string | null) => {
    if (!userId) return null;
    // Tenta direto (cloud_uuid) e via remap (ext_uuid → cloud_uuid)
    const direct = teamMembers.find(m => m.user_id === userId)?.full_name;
    if (direct) return direct;
    const cloudId = remapToCloudSync(userId);
    if (cloudId && cloudId !== userId) {
      const viaRemap = teamMembers.find(m => m.user_id === cloudId)?.full_name;
      if (viaRemap) return viaRemap;
    }
    return null;
  };

  useEffect(() => {
    if (!leadSearch.trim()) {
      setSearchedLeads(leads.slice(0, 20));
      return;
    }
    const timer = setTimeout(async () => {
      const term = leadSearch.trim();
      const { data } = await externalSupabase
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
    // Sem rotina do assessor: mostra só os tipos base (jurídicos padrão), não
    // todos os tipos custom do sistema (ex.: tipos de marketing). Assessores com
    // rotina configurada continuam vendo exatamente os tipos da rotina deles.
    if (activeRoutine.length === 0) return ACTIVITY_TYPES.map(t => ({ value: t.value, label: t.label }));
    const routineKeys = new Set(activeRoutine.map(c => c.activityType));
    return allKnownActivityTypes.filter(t => routineKeys.has(t.value));
  }, [activeRoutine, allKnownActivityTypes]);

  const suggestActivityType = useCallback(async (title: string) => {
    if (!title || title.trim().length < 5) return;
    setAiSuggestingType(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-activity-type', {
        body: {
          title,
          // Sugere só entre os tipos disponíveis no seletor (rotina/base).
          allowed_types: routineActivityTypes.map(t => ({ key: t.value, label: t.label })),
        },
      });
      if (!error && data?.suggested_type) {
        const match = routineActivityTypes.find(t => t.value === data.suggested_type);
        if (match) {
          setFormType(match.value);
          toast.info(`Tipo sugerido pela IA: ${match.label}`, { duration: 2000 });
        }
      }
    } catch { /* silent */ }
    setAiSuggestingType(false);
  }, [routineActivityTypes]);

  const handleTitleChange = useCallback((value: string) => {
    setFormTitle(value);
    if (aiSuggestTimer.current) clearTimeout(aiSuggestTimer.current);
    if (value.trim().length >= 5 && sheetMode === 'create') {
      aiSuggestTimer.current = setTimeout(() => suggestActivityType(value), 800);
    }
  }, [sheetMode, suggestActivityType]);

  // Verifica se o tipo escolhido bate com o contexto (assunto + campos). Se a IA
  // sugerir um tipo diferente do atual, mostra um alerta com botão de aplicar —
  // nunca troca sozinho (diferente do auto-sugerir do modo criar).
  const checkTypeMismatch = useCallback(async () => {
    const title = (formTitle || '').trim();
    if (title.length < 5 || !formType) { setTypeMismatch(null); return; }
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-activity-type', {
        body: {
          title,
          context: {
            current_status: stripHtml(formCurrentStatus).slice(0, 400),
            what_was_done: stripHtml(formWhatWasDone).slice(0, 400),
            next_steps: stripHtml(formNextSteps).slice(0, 400),
          },
          // Restringe a sugestão aos tipos válidos deste contexto (rotina/base).
          allowed_types: routineActivityTypes.map(t => ({ key: t.value, label: t.label })),
        },
      });
      const suggested = data?.suggested_type;
      if (error || !suggested || suggested === formType) { setTypeMismatch(null); return; }
      // Só alerta se a sugestão for um tipo realmente disponível no seletor.
      const match = routineActivityTypes.find(t => t.value === suggested);
      setTypeMismatch(match ? { suggested: match.value, label: match.label } : null);
    } catch {
      setTypeMismatch(null);
    }
  }, [formTitle, formType, formCurrentStatus, formWhatWasDone, formNextSteps, routineActivityTypes]);

  // Dispara a checagem (debounced) enquanto o formulário está aberto.
  useEffect(() => {
    if (!sheetMode) { setTypeMismatch(null); return; }
    if (typeCheckTimer.current) clearTimeout(typeCheckTimer.current);
    typeCheckTimer.current = setTimeout(() => { checkTypeMismatch(); }, 900);
    return () => { if (typeCheckTimer.current) clearTimeout(typeCheckTimer.current); };
  }, [sheetMode, checkTypeMismatch]);

  const applySuggestedType = useCallback(() => {
    if (!typeMismatch) return;
    setFormType(typeMismatch.suggested);
    setTypeMismatch(null);
    toast.success(`Tipo alterado para ${typeMismatch.label}.`);
  }, [typeMismatch]);

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

  // audience: 'client' (grupo do lead — padrão) ou 'assessor' (mensagem interna,
  // endereçada ao(s) assessor(es) responsável(is) — usado quando não há lead).
  const buildMsg = (audience: 'client' | 'assessor' = 'client') => {
    const joinNames = (names: string[]) =>
      names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
    const notifDate = formNotificationDate ? (() => {
      const d = parseISO(formNotificationDate);
      const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
      return `${format(d, 'dd/MM/yyyy')} ${dias[d.getDay()]}`;
    })() : '';
    const valueMap: Record<string, string> = { what_was_done: stripHtml(formWhatWasDone), current_status: stripHtml(formCurrentStatus), next_steps: stripHtml(formNextSteps), solicitacao: stripHtml(formSolicitacao), resposta_juizo: stripHtml(formRespostaJuizo), notes: stripHtml(formNotes) };
    const fieldLines = fieldSettings
      .filter(f => f.include_in_message)
      .map(f => ({ label: f.label, value: (valueMap[f.field_key] || '').trim() }))
      .filter(({ value }) => value.length > 0)
      .map(({ label, value }) => `*${label}:* ${value}`)
      .join('\n\n');
    const createdByName = selectedActivity ? resolveUserName(selectedActivity.created_by) : resolveUserName(user?.id || null);
    const createdAtFmt = selectedActivity ? format(parseISO(selectedActivity.created_at), "dd/MM/yyyy 'às' HH:mm") : format(new Date(), "dd/MM/yyyy 'às' HH:mm");
    const updatedByName = selectedActivity ? resolveUserName((selectedActivity as any).updated_by) : null;
    const updatedAtFmt = selectedActivity?.updated_at && selectedActivity.updated_at !== selectedActivity.created_at ? format(parseISO(selectedActivity.updated_at), "dd/MM/yyyy 'às' HH:mm") : null;
    const timeSpent = workflowMode ? getActivityTimeSpent() : 0;
    const tempoStr = timeSpent > 0 ? `⏱️ Tempo dedicado à atividade: ${formatDuration(timeSpent)}` : '';
    const activityLink = selectedActivity ? `🔗 Ver atividade: ${window.location.origin}/?openActivity=${selectedActivity.id}` : '';
    const updatedInfo = updatedByName && updatedAtFmt ? `\n*Última atualização por:* ${updatedByName} em ${updatedAtFmt}` : '';
    const buildReturnDateLine = (responsavelDr: string) => {
      if (!notifDate) return '';
      const subject = responsavelDr ? `${responsavelDr} voltará` : 'Retornaremos';
      return `*${subject} com mais informações no dia ${notifDate}, até o final do dia.*`;
    };

    // Linked process info — "Referente ao processo n° "X" de "Y""
    // Cai para formProcessTitle quando caseProcesses ainda não carregou (atividade sem case_id).
    const linkedProcessForMsg = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
    const procNumberForMsg = linkedProcessForMsg?.process_number || '';
    const procTitleForMsg = linkedProcessForMsg?.title || formProcessTitle || '';
    const processInfo = (procNumberForMsg || procTitleForMsg)
      ? `Referente ao processo n° "${procNumberForMsg || '—'}" de "${procTitleForMsg || '—'}"`
      : '';

    const envolvidos = (linkedProcessForMsg?.envolvidos as any[]) || [];
    // Qual polo é o NOSSO cliente:
    //   1) marcação manual no cadastro (cliente_polo)
    //   2) auto-detecção: advogado de uma parte tem OAB de um usuário do sistema
    //   3) padrão ATIVO (autor) — caso mais comum.
    const clientePolo = (linkedProcessForMsg as any)?.cliente_polo
      || detectClientPolo(envolvidos, systemOabs)
      || 'ATIVO';
    // Nomes das PARTES (não advogados) do polo do cliente.
    const isParte = (e: any) => e && e.nome && !/advog/i.test(String(e.tipo || e.tipo_normalizado || ''));
    let processClientNames: string[] = envolvidos
      .filter((e: any) => isParte(e) && e.polo === clientePolo)
      .map((e: any) => String(e.nome));
    // Sem envolvidos estruturados: cai para o título do polo (polo_ativo/polo_passivo).
    if (processClientNames.length === 0) {
      const poloTitle = clientePolo === 'PASSIVO'
        ? (linkedProcessForMsg as any)?.polo_passivo
        : (linkedProcessForMsg as any)?.polo_ativo;
      if (poloTitle) processClientNames = [String(poloTitle)];
    }

    // Nome exibido na saudação ao CLIENTE: só o PRIMEIRO NOME da parte cliente.
    // Prioridade: override manual > 1ª parte do polo do cliente > nome do lead.
    const clientDisplayName = formClientNameOverride
      ? extractClientFirstName(formClientNameOverride)
      : processClientNames.length > 0
        ? extractClientFirstName(processClientNames[0])
        : extractClientFirstName(formLeadName || '');

    // Workflow do processo (etapa / objetivo / passo atual) — vem do checklist do lead (stepContext).
    const wfPhase = stepContext?.phaseLabel || '';
    const wfObjective = stepContext?.objectiveLabel || '';
    const wfStep = stepContext?.stepLabel || '';
    const workflowInfo = (wfPhase || wfObjective || wfStep)
      ? [
          wfPhase && `*Etapa:* ${wfPhase}`,
          wfObjective && `*Objetivo:* ${wfObjective}`,
          wfStep && `*Passo atual:* ${wfStep}`,
        ].filter(Boolean).join('\n')
      : '';

    // Progresso em 3 níveis a partir do checklist do fluxo:
    //   Fase (stage do kanban) → Objetivo (template de checklist) → Passo (item).
    // headline = só a % geral (mensagem do CLIENTE — evita jargão interno).
    // full = quebra completa (mensagem ao ASSESSOR e painel). Vazio sem checklist.
    const progress = (() => {
      const steps = stepContext?.allSteps || [];
      if (steps.length === 0) return { headline: '', full: '' };
      const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

      const doneSteps = steps.filter((s) => s.checked).length;
      const overallPct = pct(doneSteps, steps.length);

      const phaseIds = [...new Set(steps.map((s) => s.phaseId))];
      const phasesDone = phaseIds.filter((pid) => {
        const ps = steps.filter((s) => s.phaseId === pid);
        return ps.length > 0 && ps.every((s) => s.checked);
      }).length;

      const curPhase = stepContext?.stageId;
      const phaseSteps = steps.filter((s) => s.phaseId === curPhase);
      const objIds = [...new Set(phaseSteps.map((s) => s.templateId))];
      const objDone = objIds.filter((tid) => {
        const os = phaseSteps.filter((s) => s.templateId === tid);
        return os.length > 0 && os.every((s) => s.checked);
      }).length;

      const curObj = stepContext?.templateId;
      const objSteps = phaseSteps.filter((s) => s.templateId === curObj);
      const objStepsDone = objSteps.filter((s) => s.checked).length;

      const headline = `*📊 Progresso do caso: ${overallPct}% concluído*`;
      const full = [
        headline,
        `• Fases: ${pct(phasesDone, phaseIds.length)}% (${phasesDone}/${phaseIds.length})`,
        `• Objetivos (fase atual): ${pct(objDone, objIds.length)}% (${objDone}/${objIds.length})`,
        `• Passos (objetivo atual): ${pct(objStepsDone, objSteps.length)}% (${objStepsDone}/${objSteps.length})`,
      ].join('\n');
      return { headline, full };
    })();
    // Cliente vê só a manchete; assessor/painel veem o detalhe completo.
    const progressInfo = progress.headline;      // usado nas mensagens do cliente
    const progressDetail = progress.full;        // usado na mensagem ao assessor

    // Mensagem endereçada ao(s) ASSESSOR(es) responsável(is) — não usa template de cliente.
    if (audience === 'assessor') {
      const allAssessorNames = [formAssignedToName, ...formCoAssignees.map(c => c.full_name)].filter(Boolean);
      const assessorGreet = joinNames(allAssessorNames.map(n => `Dr(a). ${String(n).split(' ').slice(0, 2).join(' ')}`));
      const hourA = new Date().getHours();
      const saudA = hourA < 12 ? 'Bom dia' : hourA < 18 ? 'Boa tarde' : 'Boa noite';
      const header = `*${saudA}${assessorGreet ? `, ${assessorGreet}` : ''}!*`;
      const sysTag = formIsSystem ? '🤖 *Atividade do sistema* — sob sua responsabilidade.' : '';
      const prazoLine = formDeadline ? `*Prazo:* ${format(parseISO(formDeadline), 'dd/MM/yyyy')}` : '';
      const notifLine = notifDate ? `*Notificação:* ${notifDate}` : '';
      return [
        header,
        sysTag,
        processInfo,
        `*Assunto da atividade:* ${formTitle.toUpperCase()}`,
        fieldLines,
        [prazoLine, notifLine].filter(Boolean).join('\n'),
        workflowInfo,
        progressDetail,
        tempoStr,
        activityLink,
      ].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // Try to use a saved template for this board/workflow
    const boardId = leadPreview?.board_id || undefined;
    const template = getTemplateForContext(boardId);

    // Check if template has mustache-style variables
    if (template && template.includes('{{')) {
      // Build a context object for evaluating conditional expressions
      const responsavelDr = formAssignedToName
        ? `Dr. ${formAssignedToName.split(' ').slice(0, 2).join(' ')}`
        : '';
      const returnDateLine = buildReturnDateLine(responsavelDr);
      const _hour = new Date().getHours();
      const saudacao = _hour < 12 ? 'Bom dia' : _hour < 18 ? 'Boa tarde' : 'Boa noite';
      const tplVars: Record<string, string> = {
        saudacao,
        titulo: formTitle.toUpperCase(),
        lead_name: clientDisplayName,
        clientes_processo: processClientNames.join(', '),
        campos_dinamicos: fieldLines,
        responsavel: [formAssignedToName, ...formCoAssignees.map(c => c.full_name)].filter(Boolean).join(', '),
        responsavel_dr: responsavelDr,
        data_retorno: notifDate,
        linha_retorno: returnDateLine,
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
        process_number: procNumberForMsg || formProcessTitle || '—',
        process_info: processInfo,
        etapa: wfPhase || '—',
        objetivo: wfObjective || '—',
        passo_atual: wfStep || '—',
        workflow_info: workflowInfo,
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

      // Auto-inject processInfo if template doesn't reference it but a process is linked
      if (processInfo && !template.includes('process_info') && !result.includes('Referente ao processo')) {
        const lines = result.split('\n');
        // Insert after first non-empty line (greeting)
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim()) { insertAt = i + 1; break; }
        }
        lines.splice(insertAt, 0, '', processInfo);
        result = lines.join('\n');
      }

      // Workflow (fase/objetivo/passo atual — o passo logo após o último concluído):
      // auto-injeta após o "Referente ao processo" quando o template não o referencia.
      if (workflowInfo && !template.includes('workflow_info') && !result.includes('*Passo atual:*')) {
        const lines = result.split('\n');
        const afterProc = lines.findIndex(line => line.includes('Referente ao processo'));
        const at = afterProc >= 0 ? afterProc + 1 : (() => {
          for (let i = 0; i < lines.length; i++) if (lines[i].trim()) return i + 1;
          return 0;
        })();
        lines.splice(at, 0, '', workflowInfo);
        result = lines.join('\n');
      }

      // Progresso (3 níveis): auto-injeta após o workflow/processo quando o
      // template não referencia {{progresso}} e há checklist.
      if (progressInfo && !template.includes('progresso') && !result.includes('Progresso do caso')) {
        const lines = result.split('\n');
        const anchor = lines.findIndex(line => line.includes('*Passo atual:*') || line.includes('Referente ao processo'));
        const at = anchor >= 0 ? anchor + 1 : (() => { for (let i = 0; i < lines.length; i++) if (lines[i].trim()) return i + 1; return 0; })();
        lines.splice(at, 0, '', progressInfo);
        result = lines.join('\n');
      }

      // Link da atividade: auto-injeta antes de "Estamos à disposição" quando a
      // atividade já existe e o template não referencia {{link_atividade}}.
      if (activityLink && !template.includes('link_atividade') && !result.includes('openActivity=')) {
        const lines = result.split('\n');
        const beforeSupport = lines.findIndex(line => line.includes('Estamos à disposição'));
        if (beforeSupport >= 0) lines.splice(beforeSupport, 0, activityLink, '');
        else lines.push('', activityLink);
        result = lines.join('\n');
      }

      // Assinatura carinhosa com o nome de quem CRIOU a atividade, ao final.
      if (createdByName && !result.includes('Com carinho')) {
        const lines = result.split('\n');
        const digiteIdx = lines.findIndex(line => line.includes('Digite 1'));
        const sig = `Com carinho,\n${createdByName} 💚`;
        if (digiteIdx >= 0) lines.splice(digiteIdx, 0, sig, '');
        else lines.push('', sig);
        result = lines.join('\n');
      }

      // Templates antigos escondiam a data quando o responsável estava vazio.
      // Se o modelo tentou usar data_retorno, garante que o cliente veja a data.
      if (returnDateLine && template.includes('data_retorno') && !result.includes(notifDate)) {
        const lines = result.split('\n');
        const beforeSupportLine = lines.findIndex(line => line.includes('Estamos à disposição'));
        if (beforeSupportLine >= 0) lines.splice(beforeSupportLine, 0, '', returnDateLine);
        else lines.push('', returnDateLine);
        result = lines.join('\n');
      }

      return result
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // Fallback: hardcoded default
    const responsavelDrFb = formAssignedToName ? `Dr. ${formAssignedToName.split(' ').slice(0, 2).join(' ')}` : '';
    const clientFirstName = clientDisplayName;
    const hourFb = new Date().getHours();
    const saudacaoFb = hourFb < 12 ? 'Bom dia' : hourFb < 18 ? 'Boa tarde' : 'Boa noite';
    const greetingLine = clientFirstName
      ? `*${saudacaoFb} Sr(a). ${clientFirstName}*`
      : `*${saudacaoFb}*`;
    const linkLineFb = activityLink ? `\n\n${activityLink}` : '';
    const workflowLineFb = workflowInfo ? `\n\n${workflowInfo}` : '';
    const progressLineFb = progressInfo ? `\n\n${progressInfo}` : '';
    const signatureFb = createdByName ? `\n\nCom carinho,\n${createdByName} 💚` : '';
    return `${greetingLine}${processInfo ? `\n\n${processInfo}` : ''}${workflowLineFb}${progressLineFb}\n\n*Assunto da atividade:* ${formTitle.toUpperCase()}\n\n${fieldLines}\n\n${buildReturnDateLine(responsavelDrFb)}\n${tempoStr}${linkLineFb}\n\nEstamos à disposição para quaisquer dúvidas.\n\n🚀Avante!${signatureFb}\n\nTem alguma dúvida ou precisa de uma explicação mais detalhada? Digite 1 . Se tudo está claro, digite 2.`;
  };

  // Active step context — process workflow > lead's funnel board.
  // Note: also resolves for closed leads (CASO mode) so templates of the
  // checkpoint step where the case was created keep working.
  const activeStepBoardId = (() => {
    const linkedProcess = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
    if (linkedProcess?.workflow_id) return linkedProcess.workflow_id;
    if (leadPreview?.board_id) return leadPreview.board_id;
    return null;
  })();
  const { stepContext, saveStepFieldTemplates, selectedStepId, setSelectedStepId } = useActivityStepContext(formLeadId || null, activeStepBoardId);

  const activityFormContent = (
    <ActivityFormCompact
      stepContext={stepContext}
      saveStepFieldTemplates={saveStepFieldTemplates}
      selectedStepId={selectedStepId}
      setSelectedStepId={setSelectedStepId}
      formTitle={formTitle} setFormTitle={setFormTitle}
      formAssignedTo={formAssignedTo} handleSelectAssignee={handleSelectAssignee}
      formCoAssignees={formCoAssignees}
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
      formWorkflowId={formWorkflowId} setFormWorkflowId={setFormWorkflowId}
      workflowOptions={workflowOptions}
      formClientNameOverride={formClientNameOverride}
      setFormClientNameOverride={setFormClientNameOverride}
      formIsSystem={formIsSystem} setFormIsSystem={setFormIsSystem}
      formIsManagement={formIsManagement} setFormIsManagement={setFormIsManagement}
      formRepeatWeekDays={formRepeatWeekDays} setFormRepeatWeekDays={setFormRepeatWeekDays}
      formWhatWasDone={formWhatWasDone} setFormWhatWasDone={setFormWhatWasDone}
      formCurrentStatus={formCurrentStatus} setFormCurrentStatus={setFormCurrentStatus}
      formNextSteps={formNextSteps} setFormNextSteps={setFormNextSteps}
      formSolicitacao={formSolicitacao} setFormSolicitacao={setFormSolicitacao}
      formRespostaJuizo={formRespostaJuizo} setFormRespostaJuizo={setFormRespostaJuizo}
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
      typeMismatch={typeMismatch}
      onApplySuggestedType={applySuggestedType}
      onDismissTypeMismatch={() => setTypeMismatch(null)}
      activeRoutine={activeRoutine}
      buildMsg={buildMsg}
      formAssignedToName={formAssignedToName}
      formLeadIdForTTS={formLeadId || undefined}
      formContactIdForTTS={formContactId || undefined}
      supabase={supabase}
      leads={leads}
      onNotesPendingChange={handleNotesPendingChange}
      onNotesCommitCandidatesChange={handleNotesCommitCandidatesChange}
      onNotesUploadStateChange={handleNotesUploadStateChange}
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
                      disabled={noteAttachmentsUploading}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Concluir
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleWorkflowCompleteAndNext}
                  disabled={noteAttachmentsUploading}
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


  // Larguras das colunas laterais no modo edição (declaradas ANTES de qualquer early return
  // para preservar a ordem dos hooks entre renders).
  const [weekColWidth, setWeekColWidth] = useState(220);
  const [listColWidth, setListColWidth] = useState(400);
  const weekColDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const listColDragRef = useRef<{ startX: number; startW: number } | null>(null);

  if (loading && activities.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isEditing = sheetMode !== null;


  const makeColDragHandlers = (
    dragRef: React.MutableRefObject<{ startX: number; startW: number } | null>,
    currentW: number,
    setW: (n: number) => void,
    min: number,
    max: number,
    resetTo: number,
  ) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = { startX: e.clientX, startW: currentW };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.min(max, Math.max(min, d.startW + (e.clientX - d.startX)));
      setW(next);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    onDoubleClick: () => setW(resetTo),
  });




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
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setCourtContactsOpen(true)} title="Varas e Tribunais — contatos">
            <Landmark className="h-4 w-4" />
          </Button>
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

      {/* Filters strip - wraps into 2 rows when tight */}
      <div className={cn("bg-muted/30 border-b px-3 py-1.5 flex flex-wrap items-center gap-2 shrink-0", isEditing && "hidden md:flex")}>
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
                  {filterAssignableMembers([...teamMembers]).sort((a, b) => {
                    const aSel = filterAssignee.includes(a.user_id) ? 0 : 1;
                    const bSel = filterAssignee.includes(b.user_id) ? 0 : 1;
                    if (aSel !== bSel) return aSel - bSel;
                    return (a.full_name || '').localeCompare(b.full_name || '');
                  }).map(m => {
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
                  {(() => {
                    const withCounts = ACTIVITY_TYPES.map(t => ({ t, c: countByField('activity_type', t.value) }));
                    // Sem assessor selecionado = mostra todos os tipos cadastrados na rotina.
                    // Com assessor(es) selecionado(s) = só os tipos que aquele(s) assessor(es) usa(m).
                    const hasAssigneeFilter = filterAssignee.length > 0;
                    const visible = (showAllTypes || !hasAssigneeFilter)
                      ? withCounts
                      : withCounts.filter(({ t, c }) => (c.open + c.done) > 0 || filterType.includes(t.value));
                    const hiddenCount = withCounts.length - visible.length;
                    return (
                      <>
                        {visible.map(({ t, c }) => {
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
                        {hasAssigneeFilter && (hiddenCount > 0 || showAllTypes) && (
                          <CommandItem
                            value="__toggle_show_all_types"
                            onSelect={() => setShowAllTypes(v => !v)}
                            className="text-xs text-muted-foreground border-t mt-1 pt-2"
                          >
                            <span className="ml-5">
                              {showAllTypes ? 'Ocultar tipos sem atividades' : `Mostrar todos os tipos (+${hiddenCount} sem uso)`}
                            </span>
                          </CommandItem>
                        )}
                      </>
                    );
                  })()}
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
                        {s.value !== 'atrasada' && (
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

        {/* Fluxo de Trabalho */}
        <Popover open={openFilterKey === 'workflow'} onOpenChange={o => setOpenFilterKey(o ? 'workflow' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterWorkflow.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <Layers className="h-3 w-3" />
              {filterWorkflow.length === 0
                ? 'Fluxo'
                : filterWorkflow.length === 1
                  ? (workflowOptions.find(w => w.id === filterWorkflow[0])?.name?.split(' ')[0] || '1')
                  : `${filterWorkflow.length}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar fluxo de trabalho..." />
              <CommandList>
                <CommandEmpty>Nenhum encontrado</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__clear_all_workflow" onSelect={() => setFilterWorkflow([])}>
                    <Check className={cn("mr-2 h-3.5 w-3.5", filterWorkflow.length === 0 ? "opacity-100" : "opacity-0")} />
                    Todos
                  </CommandItem>
                  <CommandItem value="__unassigned__" onSelect={() => toggleFilter(setFilterWorkflow, filterWorkflow, '__unassigned__')}>
                    <Check className={cn("mr-2 h-3.5 w-3.5", filterWorkflow.includes('__unassigned__') ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate text-muted-foreground italic">Sem fluxo</span>
                    <span className="ml-2 flex gap-1 text-[10px]">
                      <Badge variant="outline" className="px-1 py-0 text-[10px]">
                        {allActivitiesRaw.filter(a => !a.workflow_id && a.status !== 'concluida').length}⏳
                      </Badge>
                      <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                        {allActivitiesRaw.filter(a => !a.workflow_id && a.status === 'concluida').length}✓
                      </Badge>
                    </span>
                  </CommandItem>
                  {workflowOptions.map(w => {
                    const c = countByField('workflow_id', w.id);
                    const isSelected = filterWorkflow.includes(w.id);
                    return (
                      <CommandItem key={w.id} value={w.name} onSelect={() => toggleFilter(setFilterWorkflow, filterWorkflow, w.id)}>
                        <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 truncate">{w.name}</span>
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

        {/* Caso */}
        <Popover open={openFilterKey === 'case'} onOpenChange={o => setOpenFilterKey(o ? 'case' : null)}>
          <PopoverTrigger asChild>
            <Button variant={filterCase.length > 0 ? "default" : "outline"} size="sm" className="h-7 text-xs shrink-0 gap-1">
              <Briefcase className="h-3 w-3" />
              {filterCase.length === 0
                ? 'Caso'
                : filterCase.length === 1
                  ? (availableCases.find(c => c.id === filterCase[0])?.case_number || '1')
                  : `${filterCase.length}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] p-0" align="start">
            <Command
              filter={(value, search) => {
                const v = value.toLowerCase();
                const s = search.toLowerCase().trim();
                if (!s) return 1;
                // Match all whitespace-separated tokens (so "PREV 663" matches "prev-0663 título")
                const tokens = s.split(/\s+/).filter(Boolean);
                return tokens.every(t => v.includes(t)) ? 1 : 0;
              }}
            >
              <CommandInput placeholder="Buscar caso (ex: PREV 663)..." />
              <CommandList>
                <CommandEmpty>Nenhum caso encontrado</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__clear_all_case" onSelect={() => setFilterCase([])}>
                    <Check className={cn("mr-2 h-3.5 w-3.5", filterCase.length === 0 ? "opacity-100" : "opacity-0")} />
                    Todos
                  </CommandItem>
                  {availableCases.map(cs => {
                    const isSelected = filterCase.includes(cs.id);
                    const count = activities.filter(a => (a as any).case_id === cs.id).length;
                    return (
                      <CommandItem
                        key={cs.id}
                        value={`${cs.case_number} ${cs.title || ''}`}
                        onSelect={() => toggleFilter(setFilterCase, filterCase, cs.id)}
                      >
                        <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{cs.case_number}</div>
                          {cs.title && <div className="text-[10px] text-muted-foreground truncate">{cs.title}</div>}
                        </div>
                        {count > 0 && (
                          <Badge variant="outline" className="ml-2 px-1 py-0 text-[10px]">{count}</Badge>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          variant={filterHasDocs ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs shrink-0 gap-1"
          onClick={() => setFilterHasDocs(v => !v)}
        >
          <FileText className="h-3 w-3" />
          Com documentação
        </Button>

        {(filterStatus.length > 0 || filterType.length > 0 || filterAssignee.length > 0 || filterLead.length > 0 || filterContact.length > 0 || filterCase.length > 0 || filterWorkflow.length > 0 || selectedCalDays.length > 0 || filterHasDocs) && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive shrink-0" onClick={() => { setFilterStatus([]); setFilterType([]); setFilterAssignee([]); setFilterLead([]); setFilterContact([]); setFilterCase([]); setFilterWorkflow([]); setSelectedCalDays([]); setFilterHasDocs(false); }}>
            <X className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">

        {/* Eisenhower view removida */}

        {/* === BLOCOS DE TEMPO (AGENDA SEMANAL) === */}
        {viewMode === 'blocks' && (() => {
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
          const ALL_WEEK_DAYS = [
            { label: 'SEG', dayIdx: 0 },
            { label: 'TER', dayIdx: 1 },
            { label: 'QUA', dayIdx: 2 },
            { label: 'QUI', dayIdx: 3 },
            { label: 'SEX', dayIdx: 4 },
          ];

          const today = new Date();
          const weekStart = startOfWeek(today, { weekStartsOn: 1 });
          // Quando estiver editando, encolhe a grade para mostrar apenas o dia de hoje
          const todayWeekIdx = ALL_WEEK_DAYS.findIndex(d => isSameDay(addDays(weekStart, d.dayIdx), today));
          const WEEK_DAYS = isEditing && todayWeekIdx >= 0 ? [ALL_WEEK_DAYS[todayWeekIdx]] : ALL_WEEK_DAYS;
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

          // Agrega atividades do dia por tipo cadastrado.
          // Ordena: tipos com MENOS atividades no início do dia, MAIS atividades no fim.
          // Cada grupo recebe uma fatia igual do tempo disponível (minHour..maxHour).
          const getBlocksForDay = (dayDate: Date, dayIdx: number) => {
            const dayActivities = displayedActivities.filter(a => {
              const d = getActivityDay(a);
              return d && isSameDay(d, dayDate);
            });

            // Agrupa por tipo efetivo
            const groups = new Map<string, LeadActivity[]>();
            dayActivities.forEach(a => {
              const t = getEffectiveType(a) || 'sem_tipo';
              if (!groups.has(t)) groups.set(t, []);
              groups.get(t)!.push(a);
            });

            if (groups.size === 0) return [];

            // Ordena ascendente por quantidade (menor primeiro)
            const sorted = Array.from(groups.entries()).sort((a, b) => a[1].length - b[1].length);

            const totalHours = maxHour - minHour;
            const slotHours = totalHours / sorted.length;

            return sorted.map(([type, items], idx) => {
              const meta = dbActivityTypes.find(t => t.key === type);
              const label = meta?.label || type;
              const color = meta?.color || 'bg-muted-foreground';
              const startDecimal = minHour + idx * slotHours;
              const endDecimal = startDecimal + slotHours;
              const startHour = Math.floor(startDecimal);
              const startMinute = Math.round((startDecimal % 1) * 60);
              const endHour = Math.floor(endDecimal);
              const endMinute = Math.round((endDecimal % 1) * 60);
              return {
                cfg: {
                  blockId: `__agg_${dayIdx}_${type}`,
                  activityType: type,
                  label: `${label} (${items.length})`,
                  color,
                  days: [dayIdx],
                  startHour,
                  startMinute,
                  endHour,
                  endMinute,
                  isCustom: false,
                } as any,
                items,
                topPx: (startDecimal - minHour) * HOUR_HEIGHT,
                heightPx: slotHours * HOUR_HEIGHT,
              };
            });
          };

          // Toda atividade sem data cai no "Sem data" — independe de existir
          // rotina para o tipo. Antes, atividades sem deadline cujo tipo tinha
          // rotina configurada sumiam da tela inteira (não entram em bloco
          // porque não têm dia, e eram excluídas daqui também).
          const unscheduled = displayedActivities.filter(a => {
            if (a.deadline || a.notification_date) return false;
            return a.status !== 'concluida';
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
            <div
              className={cn("relative flex flex-col overflow-hidden h-full", isEditing ? "shrink-0 border-r" : "flex-1")}
              style={isEditing ? { width: weekColWidth } : undefined}
            >
              {isEditing && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="Arraste para redimensionar • duplo clique reseta"
                  {...makeColDragHandlers(weekColDragRef, weekColWidth, setWeekColWidth, 160, 480, 220)}
                  className="hidden md:block absolute top-0 bottom-0 -right-0.5 w-1.5 z-30 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
                />
              )}
              <div className={cn("overflow-auto", selectedBlockData ? "shrink-0 max-h-[45vh]" : "flex-1")}>
                {/* Day headers */}
                <div className="sticky top-0 z-10 bg-card border-b flex min-w-max sm:min-w-0">
                  <div className="w-8 sm:w-10 shrink-0" />
                  {weekDates.map((dayDate, i) => (
                    <div key={i} className={cn(
                      'flex-1 min-w-[64px] sm:min-w-0 text-center py-2 border-l text-[10px] sm:text-xs font-bold uppercase tracking-wider',
                      isSameDay(dayDate, today) ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                    )}>
                      {WEEK_DAYS[i].label}
                      <div className="text-[9px] sm:text-[10px] font-normal opacity-70">{format(dayDate, 'dd/MM')}</div>
                    </div>
                  ))}
                </div>

                {/* Time grid with proportional blocks */}
                <div className="relative flex min-w-max sm:min-w-0">
                  {/* Hour labels */}
                  <div className="w-8 sm:w-10 shrink-0 relative" style={{ height: totalHeight }}>
                    {WEEK_HOURS.map((hour) => (
                      <div
                        key={hour}
                        className="absolute left-0 w-full text-[9px] sm:text-[10px] text-muted-foreground font-medium pl-1"
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
                          'flex-1 min-w-[64px] sm:min-w-0 border-l relative',
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
                          const fullLabel = block.cfg.label;
                          const count = block.items.length;
                          const openCount = block.items.filter(a => a.status !== 'concluida').length;
                          const doneCount = count - openCount;
                          const blockKey = `${dayIdx}::${block.cfg.activityType}`;
                          const celebrationKey = `${format(dayDate, 'yyyy-MM-dd')}::${block.cfg.activityType}`;
                          const isFullyDone = openCount === 0 && count > 0;
                          if (isFullyDone && !celebratedBlocksRef.current.has(celebrationKey)) {
                            celebratedBlocksRef.current.add(celebrationKey);
                            if (celebrationInitRef.current && isSameDay(dayDate, today)) {
                              const labelSnapshot = fullLabel;
                              const colorSnapshot = bgColor;
                              queueMicrotask(() => setCelebrateBlock({ label: labelSnapshot, color: colorSnapshot }));
                            }
                          }
                          const isSelected = selectedBlockKey === blockKey;

                          const blockH = Math.max(block.heightPx - 2, 24);
                          // Tamanho do número proporcional à altura do bloco (clamp entre 18 e 64px)
                          const numberSize = Math.max(18, Math.min(64, Math.round(blockH * 0.42)));
                          const labelSize = Math.max(8, Math.min(13, Math.round(blockH * 0.09)));
                          const metaSize = Math.max(8, Math.min(12, Math.round(blockH * 0.08)));

                          return (
                            <div key={bi} className="contents">
                              <div
                                className={cn(
                                  'absolute left-0.5 right-0.5 sm:left-1 sm:right-1 rounded-lg cursor-pointer hover:opacity-90 transition-all shadow-sm flex flex-col items-center justify-center text-white overflow-hidden',
                                  bgColor,
                                  count === 0 && 'opacity-30',
                                  openCount === 0 && count > 0 && 'brightness-[0.55] saturate-[0.35] opacity-55',
                                  isSelected && 'ring-2 ring-foreground ring-offset-1'
                                )}
                                style={{
                                  top: block.topPx + 1,
                                  height: blockH,
                                }}
                                title={fullLabel}
                                onClick={() => {
                                  setOpenFilterKey(null);
                                  setBlockSearchText('');
                                  setSelectedBlockKey(isSelected ? null : blockKey);
                                }}
                              >
                                {openCount === 0 && count > 0 ? (
                                  <div className="flex flex-col items-center justify-center w-full h-full gap-0.5 px-1">
                                    <div
                                      className="font-bold uppercase tracking-tight text-white/85 px-1 text-center leading-tight line-clamp-2 break-words"
                                      style={{ fontSize: labelSize }}
                                    >{fullLabel}</div>
                                    <span className="text-white/90 drop-shadow-md leading-none" style={{ fontSize: Math.max(14, Math.min(28, blockH * 0.28)) }}>✓</span>
                                    <span className="text-white/60 font-medium leading-none" style={{ fontSize: Math.max(8, Math.min(13, blockH * 0.13)) }}>{doneCount} feitas</span>
                                  </div>
                                ) : (
                                  <>
                                    <div
                                      className="font-bold uppercase tracking-tight opacity-95 px-1 text-center leading-tight line-clamp-2 break-words"
                                      style={{ fontSize: labelSize }}
                                    >{fullLabel}</div>
                                    <div
                                      className="font-extrabold leading-none tabular-nums drop-shadow-sm"
                                      style={{ fontSize: numberSize }}
                                    >{doneCount > 0 ? `${doneCount}/${count}` : count}</div>
                                    {count > 0 && (
                                      <div
                                        className="flex items-center gap-1.5 font-bold mt-0.5"
                                        style={{ fontSize: metaSize }}
                                      >
                                        <span className="text-red-700">○{openCount}</span>
                                        <span className="text-emerald-700">✓{doneCount}</span>
                                      </div>
                                    )}
                                    <div
                                      className="font-medium opacity-80 mt-0.5"
                                      style={{ fontSize: Math.max(8, metaSize - 1) }}
                                    >
                                      {block.cfg.startHour}:{String(block.cfg.startMinute || 0).padStart(2, '0')}–{block.cfg.endHour}:{String(block.cfg.endMinute || 0).padStart(2, '0')}
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Bloco apenas com aparência apagada quando concluído — sem overlay */}
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

              {/* Painel de atividades do bloco selecionado (abaixo da grade) */}
              {selectedBlockData && (
                <div className="flex-1 min-h-0 border-t flex flex-col overflow-hidden bg-card animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className={cn('px-3 py-2 text-white flex items-center justify-between', selectedBlockData.cfg.color || 'bg-muted-foreground')}>
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
                  <ScrollArea className="flex-1 min-h-0">
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
                              className={cn(
                                "group/blockitem px-3 py-2 transition-colors hover:bg-muted/50 cursor-pointer flex items-start gap-2",
                                selectedActivityId === a.id && "bg-primary/10"
                              )}
                              onClick={() => handleOpenEdit(a)}
                            >
                              <span className={cn('mt-1 h-2 w-2 rounded-full shrink-0', selectedBlockData.cfg.color || 'bg-muted-foreground')} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{a.title}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {a.lead_name && <span className="text-[10px] text-muted-foreground truncate max-w-[240px]">📁 {a.lead_name}</span>}
                                  <Badge variant={a.status === 'concluida' ? 'default' : 'outline'} className="text-[9px] px-1 py-0 h-4">
                                    {a.status === 'concluida' ? '✓' : a.status === 'em_andamento' ? '▶' : '○'}
                                  </Badge>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                                className="shrink-0 opacity-0 group-hover/blockitem:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                                title="Excluir atividade"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </ScrollArea>
                  <div className="px-3 py-1.5 border-t text-xs text-muted-foreground text-center shrink-0">
                    {selectedBlockData.items.length} atividade{selectedBlockData.items.length !== 1 ? 's' : ''}
                  </div>
                </div>
              )}
            </div>
          );
        })()}


        {/* LEFT: Calendar + Activity list (chat-style) */}
        <div
          className={cn(
            "relative flex-col overflow-hidden transition-all",
            viewMode === 'blocks' ? "hidden" : (isEditing ? "hidden md:flex shrink-0 border-r" : "flex flex-1")
          )}
          style={isEditing && viewMode !== 'blocks' ? { width: listColWidth, minWidth: 280 } : undefined}
        >
          {isEditing && viewMode !== 'blocks' && (
            <div
              role="separator"
              aria-orientation="vertical"
              title="Arraste para redimensionar • duplo clique reseta"
              {...makeColDragHandlers(listColDragRef, listColWidth, setListColWidth, 280, 720, 400)}
              className="hidden md:block absolute top-0 bottom-0 -right-0.5 w-1.5 z-30 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
            />
          )}
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
                            const base = displayedActivities;
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
                          const baseActivities = displayedActivities;
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
                    <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-2rem)] p-0">
                      <div className="px-3 pt-3 pb-2 border-b flex items-center justify-between">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Resumo por assessor</p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] gap-1 px-2 text-primary hover:text-primary hover:bg-primary/10"
                            onClick={() => setShareSummaryOpen(true)}
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            Compartilhar imagem
                          </Button>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-destructive" />Abertas</span>
                            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-600" />Concluídas</span>
                          </div>
                        </div>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto p-2">
                        {(() => {
                          const baseActivities = displayedActivities;
                          const selectedMembers = filterAssignee.length > 0
                            ? teamMembers.filter(m => filterAssignee.includes(m.user_id))
                            : teamMembers.filter(m => baseActivities.some(a => a.assigned_to === m.user_id));

                          if (selectedMembers.length === 0) {
                            return <div className="text-xs text-muted-foreground p-2">Nenhuma atividade para o filtro atual.</div>;
                          }

                          const rows = selectedMembers.map(member => {
                            const memberActivities = baseActivities.filter(a => a.assigned_to === member.user_id);
                            if (memberActivities.length === 0) return null;

                            const typeRows = allKnownActivityTypes
                              .map(t => {
                                const typeActs = memberActivities.filter(a => a.activity_type === t.value);
                                const open = typeActs.filter(a => a.status !== 'concluida').length;
                                const done = typeActs.filter(a => a.status === 'concluida').length;
                                return { label: t.label, open, done };
                              })
                              .filter(r => r.open > 0 || r.done > 0)
                              .sort((a, b) => (b.open + b.done) - (a.open + a.done));

                            const totalOpen = typeRows.reduce((s, r) => s + r.open, 0);
                            const totalDone = typeRows.reduce((s, r) => s + r.done, 0);

                            return (
                              <div key={member.user_id} className="mb-2 last:mb-0 rounded-md border border-border/50 overflow-hidden">
                                <div className="flex items-center justify-between bg-muted/50 px-2.5 py-1.5">
                                  <span className="text-xs font-semibold truncate">{member.full_name?.split(' ').slice(0, 2).join(' ') || 'Sem nome'}</span>
                                  <div className="flex items-center gap-2 text-[11px] font-bold tabular-nums">
                                    <span className="text-destructive">{totalOpen}</span>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span className="text-green-600">{totalDone}</span>
                                  </div>
                                </div>
                                <div className="divide-y divide-border/40">
                                  {typeRows.map(r => (
                                    <div key={r.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2.5 py-1 text-[11px]">
                                      <span className="text-muted-foreground truncate">{r.label}</span>
                                      <span className="text-destructive font-semibold tabular-nums w-6 text-right">{r.open || ''}</span>
                                      <span className="text-green-600 font-semibold tabular-nums w-6 text-right">{r.done || ''}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          });

                          return rows;
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
                displayedActivities.slice(0, renderLimit).map(activity => (
                  <ContextMenu key={activity.id}>
                    <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      "bg-card rounded-lg shadow-sm border border-border/50 cursor-pointer transition-all hover:shadow-md active:scale-[0.99] overflow-hidden",
                      selectedActivity?.id === activity.id && "ring-2 ring-primary border-primary/30",
                      activity.status === 'concluida' && "opacity-60"
                    )}
                    onClick={() => handleOpenEdit(activity)}
                  >
                    {/* Situation ribbon (top) — codifica a situação temporal, não a prioridade */}
                    {(() => {
                      const ribbon = getTemporalRibbon(activity);
                      return (
                        <div className={cn("px-3 py-1 text-[10px] font-semibold tracking-wide", ribbon.className)}>
                          {ribbon.label}
                        </div>
                      );
                    })()}
                    <div className="p-3">

                    {/* Top row: badges + actions */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {ACTIVITY_TYPES.find(t => t.value === activity.activity_type)?.label}
                        </Badge>
                        {activity.priority && activity.priority !== 'normal' && (
                          <span className={cn(
                            "flex items-center gap-1 text-[10px] font-medium",
                            activity.priority === 'urgente' && "text-red-600 dark:text-red-400",
                            activity.priority === 'alta' && "text-orange-600 dark:text-orange-400",
                            activity.priority === 'baixa' && "text-muted-foreground",
                          )}>
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              activity.priority === 'urgente' && "bg-red-600",
                              activity.priority === 'alta' && "bg-orange-500",
                              activity.priority === 'baixa' && "bg-slate-400",
                            )} />
                            {PRIORITY_OPTIONS.find(p => p.value === activity.priority)?.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {activity.status !== 'concluida' && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={e => { e.stopPropagation(); handleComplete(activity.id); }} title="Concluir">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-6 w-6",
                            activityIdsWithDocs.has(activity.id)
                              ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              : "text-muted-foreground hover:text-emerald-600"
                          )}
                          onClick={e => { e.stopPropagation(); toggleHasDocs(activity.id); }}
                          title={activityIdsWithDocs.has(activity.id) ? "Desmarcar 'Com documentação'" : "Marcar como 'Com documentação'"}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
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
                    <h3 className={cn("font-medium text-sm mt-1.5 leading-snug", activity.status === 'concluida' && "line-through")}>{activity.title}</h3>

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
                          <span className={cn("flex items-center gap-0.5", getTemporalStatus(activity) === 'atrasada' && "text-red-600 dark:text-red-400 font-semibold")}>
                            <Calendar className="h-3 w-3" />
                            {format(parseISO(activity.deadline), 'dd/MM/yyyy')}
                          </span>
                        )}
                        {activity.assigned_to_name && <span>• {activity.assigned_to_name}</span>}
                      </div>
                      <span>{format(parseISO(activity.created_at), "dd/MM 'às' HH:mm")}</span>
                    </div>
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
                        onClick={async () => {
                          const url = `${window.location.origin}/?openActivity=${activity.id}`;
                          const ok = await copyTextToClipboard(url);
                          if (ok) toast.success('Link copiado!');
                          else toast.error('Não foi possível copiar o link.');
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
              {displayedActivities.length > renderLimit && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setRenderLimit(l => l + RENDER_BATCH)}
                >
                  Mostrar mais ({(displayedActivities.length - renderLimit).toLocaleString('pt-BR')} restantes)
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Form panel (WhatsApp chat-detail style) */}
        {isEditing && (
          <div className="flex-1 flex flex-col overflow-hidden md:relative fixed inset-0 z-50 bg-background md:inset-auto md:z-auto">
            {/* Form header com lead preview — oculto por padrão, revela no hover; pode fixar */}
            <div className={cn("shrink-0 relative", !headerPinned && "group/header")}>
              {!headerPinned && (
                <div
                  className="h-1.5 hover:h-2 bg-gradient-to-r from-primary/40 via-primary/60 to-primary/40 cursor-pointer transition-all"
                  title="Passe o mouse para ver lead/funil. Clique para fixar."
                  aria-label="Mostrar cabeçalho"
                  onClick={toggleHeaderPinned}
                />
              )}
              <div className={cn(
                "bg-primary/5 px-4 py-2.5 transition-all overflow-hidden border-b",
                !headerPinned && "absolute top-1.5 left-0 right-0 z-30 bg-background shadow-lg max-h-0 opacity-0 pointer-events-none group-hover/header:max-h-[500px] group-hover/header:opacity-100 group-hover/header:pointer-events-auto"
              )}>
              <div className="flex flex-col md:flex-row md:items-start gap-2">
                <div className="flex items-center gap-2 w-full min-w-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden shrink-0" onClick={closeSheet}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 group/title">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-focus-within/title:text-primary" />
                      <Input
                        value={formTitle}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        placeholder={sheetMode === 'create' ? 'Nova atividade — clique para nomear *' : 'Assunto da atividade *'}
                        className="h-7 text-sm font-bold border-0 border-b border-transparent hover:border-border focus-visible:border-primary rounded-none px-0 bg-transparent focus-visible:ring-0 placeholder:text-muted-foreground/60 placeholder:font-normal"
                        title="Clique para editar o assunto da atividade"
                      />
                    </div>
                    {formLeadName && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyTextToClipboard(formLeadName);
                            if (ok) toast.success('Lead copiado');
                            else toast.error('Não foi possível copiar.');
                          }}
                          className="truncate hover:text-primary text-left"
                          title="Clique para copiar"
                        >
                          📁 {formLeadName}
                        </button>
                        {formLeadId && (
                          <button
                            type="button"
                            onClick={() => setShowLeadSheet(true)}
                            className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary"
                            title="Editar lead"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}


                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {/* Dropdown Vincular */}
                  <Popover open={vincularOpen} onOpenChange={setVincularOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <Link className="h-3 w-3" />
                        Vincular <ChevronDown className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-1.5 space-y-1">
                      {!formLeadId && (
                        <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs gap-2" onClick={() => { window.dispatchEvent(new CustomEvent('activity-form:open-link-lead')); setVincularOpen(false); }}>
                          <Plus className="h-3.5 w-3.5" /> Vincular Lead
                        </Button>
                      )}
                      {!formCaseId && (
                        <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs gap-2" onClick={() => { window.dispatchEvent(new CustomEvent('activity-form:open-link-case')); setVincularOpen(false); }}>
                          <Briefcase className="h-3.5 w-3.5" /> Vincular Caso
                        </Button>
                      )}
                      {formCaseId && !formProcessId && (
                        <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs gap-2" onClick={() => { window.dispatchEvent(new CustomEvent('activity-form:open-link-process')); setVincularOpen(false); }}>
                          <FileText className="h-3.5 w-3.5" /> Vincular Processo
                        </Button>
                      )}
                      {!formContactId && (
                        <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs gap-2" onClick={() => { window.dispatchEvent(new CustomEvent('activity-form:open-link-contact')); setVincularOpen(false); }}>
                          <UserPlus className="h-3.5 w-3.5" /> Vincular Contato
                        </Button>
                      )}
                      {formProcessId && (
                        <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs gap-2" onClick={() => { setShowProcessSheetId(formProcessId); setVincularOpen(false); }}>
                          <FileText className="h-3.5 w-3.5" /> Últimas movimentações
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>

                  {/* Dropdown Preencher com */}
                  <Popover open={preencherOpen} onOpenChange={setPreencherOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <Sparkles className="h-3 w-3" />
                        Preencher com <ChevronDown className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-1.5 space-y-1">
                      <ActivityCallRecorder
                        open={callRecorderOpen}
                        onOpenChange={(o) => { setCallRecorderOpen(o); if (o) setPreencherOpen(false); }}
                        activityId={selectedActivity?.id}
                        leadId={formLeadId}
                        caseId={formCaseId}
                        processId={formProcessId}
                        groupJid={leadPreview?.whatsapp_group_id}
                        leadPhone={leadPreview?.lead_phone}
                        onRecordingReady={setPendingAudio}
                        context={{
                          title: formTitle,
                          type: formType,
                          lead_name: formLeadName,
                          contact_name: formContactName,
                          process_title: formProcessTitle,
                          current_status: stripHtmlToText(formCurrentStatus),
                          what_was_done: stripHtmlToText(formWhatWasDone),
                          next_steps: stripHtmlToText(formNextSteps),
                          solicitacao: stripHtmlToText(formSolicitacao),
                          resposta_juizo: stripHtmlToText(formRespostaJuizo),
                          notes: stripHtmlToText(formNotes),
                          deadline: formDeadline || undefined,
                          notification_date: formNotificationDate || undefined,
                          priority: formPriority || undefined,
                          status: formStatus || undefined,
                          assessor_name: formAssignedToName || undefined,
                          team_members: teamMembers.map((m) => m.full_name).filter(Boolean) as string[],
                          workflow: stepContext ? {
                            step_label: stepContext.stepLabel,
                            phase_label: stepContext.phaseLabel || undefined,
                            objective_label: stepContext.objectiveLabel || undefined,
                            next_step: (() => {
                              const steps = stepContext.allSteps || [];
                              const idx = steps.findIndex((s) => s.stepId === stepContext.stepId);
                              const after = idx >= 0 ? steps.slice(idx + 1) : steps;
                              return (after.find((s) => !s.checked) || after[0])?.stepLabel;
                            })(),
                          } : undefined,
                        }}
                        onFields={(f) => {
                          // Campos de texto: '' significa "o áudio mandou apagar" — limpa o campo.
                          if (f.what_was_done !== undefined) setFormWhatWasDone(f.what_was_done ? callFieldTextToHtml(f.what_was_done) : '');
                          if (f.current_status !== undefined) setFormCurrentStatus(f.current_status ? callFieldTextToHtml(f.current_status) : '');
                          if (f.next_steps !== undefined) setFormNextSteps(f.next_steps ? callFieldTextToHtml(f.next_steps) : '');
                          if (f.solicitacao !== undefined) setFormSolicitacao(f.solicitacao ? callFieldTextToHtml(f.solicitacao) : '');
                          if (f.resposta_juizo !== undefined) setFormRespostaJuizo(f.resposta_juizo ? callFieldTextToHtml(f.resposta_juizo) : '');
                          if (f.notes !== undefined) setFormNotes(f.notes ? callFieldTextToHtml(f.notes) : '');
                          // Metadados ditados no áudio (prazo, prioridade, situação, assessor, título).
                          if (f.title) setFormTitle(f.title);
                          if (f.deadline && /^\d{4}-\d{2}-\d{2}$/.test(f.deadline)) handleDeadlineChange(f.deadline);
                          if (f.notification_date && /^\d{4}-\d{2}-\d{2}$/.test(f.notification_date)) setFormNotificationDate(f.notification_date);
                          if (f.priority && ['baixa', 'normal', 'alta', 'urgente'].includes(f.priority)) setFormPriority(f.priority);
                          if (f.status && ['pendente', 'em_andamento', 'concluida'].includes(f.status)) setFormStatus(f.status);
                          if (f.assessor_name) {
                            const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                            const spoken = norm(f.assessor_name);
                            const member = teamMembers.find((m) => {
                              const full = norm(m.full_name || '');
                              return full && (full.includes(spoken) || spoken.includes(full) || full.split(' ')[0] === spoken.split(' ')[0]);
                            });
                            if (member) {
                              setFormAssignedTo(member.user_id);
                              setFormAssignedToName(member.full_name || '');
                            } else {
                              toast.error(`Assessor "${f.assessor_name}" citado no áudio não foi encontrado na equipe.`);
                            }
                          }
                        }}
                      />
                      <ActivityDocumentUpload
                        open={docUploadOpen}
                        onOpenChange={(o) => { setDocUploadOpen(o); if (o) setPreencherOpen(false); }}
                        activityId={selectedActivity?.id}
                        leadId={formLeadId}
                        caseId={formCaseId}
                        processId={formProcessId}
                        context={{
                          title: formTitle,
                          type: formType,
                          lead_name: formLeadName,
                          contact_name: formContactName,
                          process_title: formProcessTitle,
                          current_status: stripHtmlToText(formCurrentStatus),
                          what_was_done: stripHtmlToText(formWhatWasDone),
                          next_steps: stripHtmlToText(formNextSteps),
                          solicitacao: stripHtmlToText(formSolicitacao),
                          resposta_juizo: stripHtmlToText(formRespostaJuizo),
                          notes: stripHtmlToText(formNotes),
                          workflow: stepContext ? {
                            step_label: stepContext.stepLabel,
                            phase_label: stepContext.phaseLabel || undefined,
                            objective_label: stepContext.objectiveLabel || undefined,
                            next_step: (() => {
                              const steps = stepContext.allSteps || [];
                              const idx = steps.findIndex((s) => s.stepId === stepContext.stepId);
                              const after = idx >= 0 ? steps.slice(idx + 1) : steps;
                              return (after.find((s) => !s.checked) || after[0])?.stepLabel;
                            })(),
                          } : undefined,
                        }}
                        onFields={(f) => {
                          if (f.what_was_done) setFormWhatWasDone(callFieldTextToHtml(f.what_was_done));
                          if (f.current_status) setFormCurrentStatus(callFieldTextToHtml(f.current_status));
                          if (f.next_steps) setFormNextSteps(callFieldTextToHtml(f.next_steps));
                          if (f.solicitacao) setFormSolicitacao(callFieldTextToHtml(f.solicitacao));
                          if (f.resposta_juizo) setFormRespostaJuizo(callFieldTextToHtml(f.resposta_juizo));
                          if (f.notes) setFormNotes(callFieldTextToHtml(f.notes));
                        }}
                      />
                    </PopoverContent>
                  </Popover>

                  <ActivityNextStepsAgent
                    open={nextStepsOpen}
                    onOpenChange={setNextStepsOpen}
                    activityId={selectedActivity?.id}
                    leadId={formLeadId}
                    caseId={formCaseId}
                    processId={formProcessId}
                    leadPhone={leadPreview?.lead_phone}
                    groupJid={leadPreview?.whatsapp_group_id}
                    context={{
                      step: stepContext ? {
                        step_label: stepContext.stepLabel,
                        phase_label: stepContext.phaseLabel || undefined,
                        objective_label: stepContext.objectiveLabel || undefined,
                        next_step: (() => {
                          const steps = stepContext.allSteps || [];
                          const idx = steps.findIndex((s) => s.stepId === stepContext.stepId);
                          const after = idx >= 0 ? steps.slice(idx + 1) : steps;
                          return (after.find((s) => !s.checked) || after[0])?.stepLabel;
                        })(),
                        checklist: (stepContext.docChecklist || []).map((c) => ({ label: c.label, checked: c.checked })),
                      } : undefined,
                      activity: {
                        title: formTitle,
                        type: formType,
                        lead_name: formLeadName,
                        process_title: formProcessTitle,
                        current_status: stripHtmlToText(formCurrentStatus),
                        what_was_done: stripHtmlToText(formWhatWasDone),
                        next_steps: stripHtmlToText(formNextSteps),
                        notes: stripHtmlToText(formNotes),
                      },
                    }}
                    onApply={(text) => {
                      const html = callFieldTextToHtml(text);
                      setFormNextSteps((prev) => (prev && prev !== '<p></p>' ? `${prev}${html}` : html));
                    }}
                  />

                  {formLeadId && (() => {
                    const hasGroup = !!leadPreview?.whatsapp_group_id;
                    const hasPhone = !!leadPreview?.lead_phone;
                    const hasAnyWa = hasGroup || hasPhone;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-7 text-xs gap-1 ${
                          hasAnyWa
                            ? 'text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/30'
                            : 'text-muted-foreground/60 border-border hover:text-muted-foreground hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          if (hasAnyWa) {
                            const target = leadPreview?.whatsapp_group_id || leadPreview?.lead_phone || '';
                            if (!target) return;
                            setWaChatPreview({
                              phone: target,
                              contact_name: formLeadName || null,
                              instance_name: null,
                            });
                          } else {
                            setGroupSearchOpen(true);
                          }
                        }}
                        title={
                          hasGroup
                            ? 'Abrir grupo do WhatsApp vinculado'
                            : hasPhone
                              ? 'Abrir conversa do WhatsApp'
                              : 'Vincular grupo do WhatsApp ao lead'
                        }
                      >
                        <MessageCircle className="h-3 w-3" />
                        {hasGroup ? 'Grupo WA' : hasPhone ? 'WhatsApp' : 'Vincular WA'}
                      </Button>
                    );
                  })()}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={closeSheet}
                    title="Fechar atividade"
                    aria-label="Fechar atividade"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {(formCaseTitle || formProcessTitle) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1">
                  {formCaseTitle && (
                    <span className="flex items-center gap-1 min-w-0 max-w-full" title={formCaseTitle}>
                      <Briefcase className="h-3 w-3 shrink-0" />
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyTextToClipboard(formCaseTitle);
                          if (ok) toast.success('Caso copiado');
                          else toast.error('Não foi possível copiar.');
                        }}
                        className="truncate hover:text-primary text-left"
                        title="Clique para copiar"
                      >
                        {formCaseTitle}
                      </button>
                      {formCaseId && (
                        <button
                          type="button"
                          onClick={() => window.open(`/cases/${formCaseId}`, '_blank')}
                          className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary"
                          title="Editar caso"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  )}
                  {formProcessTitle && (() => {
                    const proc = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
                    const procNumber = proc?.process_number || formProcessTitle;
                    return (
                      <span className="flex items-center gap-1 min-w-0 max-w-full" title={procNumber}>
                        <FileText className="h-3 w-3 shrink-0" />
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyTextToClipboard(procNumber);
                            if (ok) toast.success('Nº do processo copiado');
                            else toast.error('Não foi possível copiar.');
                          }}
                          className="truncate hover:text-primary text-left"
                          title="Clique para copiar o nº"
                        >
                          {formProcessTitle}
                        </button>
                        {formProcessId && (
                          <button
                            type="button"
                            onClick={() => setShowProcessSheetId(formProcessId)}
                            className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary"
                            title="Editar processo"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    );
                  })()}
                </div>
              )}
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
                      <Clock className="h-3 w-3" /> Atualizado {format(parseISO(leadPreview.updated_at), 'dd/MM HH:mm')}
                    </span>
                  )}
                  {/* board_name badge removed — case_type already shown above and next to process */}
                </div>
              )}
              {/* No lead message */}
              {!formLeadId && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Nenhum lead vinculado. Vincule um lead existente no formulário ou crie um novo.
                </p>
              )}
              {/* Nome do cliente (override) — acima da barra de progresso */}
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
                <User className="h-3 w-3 shrink-0" />
                <span className="uppercase tracking-wider text-[9px] whitespace-nowrap">Cliente</span>
                <Input
                  value={formClientNameOverride || ''}
                  onChange={(e) => setFormClientNameOverride(e.target.value)}
                  placeholder={formLeadName ? `Auto: ${formLeadName}` : '—'}
                  className="h-6 text-[11px] px-1.5 border-0 border-b rounded-none bg-transparent focus-visible:ring-0 focus-visible:border-primary flex-1 min-w-0"
                  title="Se vazio, usa o nome do lead. Se preenchido, este nome aparece nos templates."
                />
                {formClientNameOverride && (
                  <button type="button" onClick={() => setFormClientNameOverride('')} className="text-muted-foreground hover:text-foreground shrink-0" title="Limpar">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {/* Funnel or Process Workflow progress bar */}
              {formLeadId && (() => {
                const isLeadClosed = leadPreview?.lead_status === 'closed';
                const linkedProcess = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
                const processWorkflowId = linkedProcess?.workflow_id;

                // Se há processo vinculado: só mostra se o processo tem fluxo próprio.
                // Sem fluxo no processo = sem barra (não cai no funil do lead).
                if (formProcessId) {
                  if (processWorkflowId) {
                    return <LeadFunnelProgressBar leadId={formLeadId} boardId={processWorkflowId} />;
                  }
                  return (
                    <p className="text-[10px] text-muted-foreground mt-1.5 italic">
                      Processo sem fluxo de trabalho vinculado — cadastre um fluxo no processo para ver o progresso.
                    </p>
                  );
                }
                // Sem processo vinculado: usa o funil do lead (apenas se ainda em andamento).
                if (!isLeadClosed && leadPreview?.board_id) {
                  return <LeadFunnelProgressBar leadId={formLeadId} boardId={leadPreview.board_id} />;
                }
                return null;
              })()}
              </div>
              {/* Botão fixar/desafixar cabeçalho */}
              <button
                type="button"
                onClick={toggleHeaderPinned}
                className={cn(
                  "absolute right-1 top-1 z-40 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors",
                  !headerPinned && "opacity-0 group-hover/header:opacity-100"
                )}
                title={headerPinned ? "Desafixar cabeçalho (ocultar automático)" : "Fixar cabeçalho sempre visível"}
              >
                {headerPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* Form body - scrollable */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="max-w-[1200px] mx-auto">
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

            {/* Action bar — oculta por padrão, revela no hover; pode fixar */}
            <div className={cn("shrink-0 relative", !actionsPinned && "group/actions")}>
              {!actionsPinned && (
                <div
                  className="h-1.5 hover:h-2 bg-gradient-to-r from-success/40 via-primary/60 to-success/40 cursor-pointer transition-all"
                  title="Passe o mouse para ações. Clique para fixar."
                  onClick={toggleActionsPinned}
                />
              )}
              <button
                type="button"
                onClick={toggleActionsPinned}
                className={cn(
                  "absolute -top-7 z-40 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-background shadow-sm hover:bg-muted transition-colors",
                  actionsPinned ? "right-32 text-primary border-primary/40" : "right-2 text-muted-foreground border-border"
                )}
                title={actionsPinned ? "Desafixar ações (ocultar automático)" : "Fixar ações sempre visíveis"}
              >
                {actionsPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                {actionsPinned ? 'Fixada' : 'Fixar'}
              </button>

              <div className={cn(
                "border-t border-border bg-primary/5 px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-10 flex flex-col md:flex-row gap-2 md:gap-3 md:items-center md:justify-between transition-all overflow-hidden",
                !actionsPinned && "absolute bottom-1.5 left-0 right-0 z-30 shadow-2xl max-h-0 opacity-0 pointer-events-none group-hover/actions:max-h-[400px] group-hover/actions:opacity-100 group-hover/actions:pointer-events-auto"
              )}>
                {/* Left group: utilities */}
                <div className="flex items-center gap-1.5 flex-wrap md:mr-auto">
                  {buildMsg && (
                    <SendToGroupSection buildMsg={buildMsg} leadId={formLeadId} fieldSettings={fieldSettings} updateFieldSetting={updateFieldSetting} reorderFields={reorderFields} formLeadIdForTTS={formLeadId || undefined} formContactIdForTTS={formContactId || undefined} formAssignedTo={formAssignedTo || undefined} activityId={selectedActivity?.id} compactLabel />
                  )}
                  {/* Enviar só o áudio gravado — junto do "Enviar" da mensagem completa, pra ação
                      de envio ficar toda no mesmo lugar (antes ficava no header, longe do Concluir). */}
                  {pendingAudio && (leadPreview?.whatsapp_group_id || leadPreview?.lead_phone) && (() => {
                    const target = leadPreview?.whatsapp_group_id || leadPreview?.lead_phone || '';
                    const label = leadPreview?.whatsapp_group_id ? 'grupo' : 'contato';
                    const mm = Math.floor(pendingAudio.seconds / 60).toString().padStart(2, '0');
                    const ss = (pendingAudio.seconds % 60).toString().padStart(2, '0');
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30"
                        disabled={sendingPendingAudio}
                        onClick={async () => {
                          if (!target || !pendingAudio) return;
                          setSendingPendingAudio(true);
                          try {
                            await sendVoiceToWa(pendingAudio.url, target, formLeadId);
                            toast.success(`Áudio enviado ao ${label} do WhatsApp!`);
                            setPendingAudio(null);
                          } catch (e: any) {
                            toast.error(e?.message || 'Erro ao enviar áudio no WhatsApp');
                          } finally {
                            setSendingPendingAudio(false);
                          }
                        }}
                        title={`Enviar a gravação (${mm}:${ss}) como áudio no WhatsApp do ${label}`}
                      >
                        {sendingPendingAudio ? (
                          <><Loader2 className="h-3 w-3 animate-spin" /> Enviando…</>
                        ) : (
                          <><Mic className="h-3 w-3" /> Enviar áudio ({mm}:{ss})</>
                        )}
                      </Button>
                    );
                  })()}
                  {formProcessId && (
                    <CobrarVaraSection processId={formProcessId} activityId={selectedActivity?.id} leadId={formLeadId || null} />
                  )}
                  {sheetMode === 'edit' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                          <MoreVertical className="h-3.5 w-3.5" /> Mais
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        {selectedActivity?.id && (
                          <DropdownMenuItem
                            className="text-xs"
                            onSelect={(e) => {
                              e.preventDefault();
                              setTeamChatOpen(true);
                            }}
                          >
                            <Users className="h-3.5 w-3.5 mr-2" /> Chat Equipe
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setChatOpen(true)} className="text-xs">
                          <MessageCircle className="h-3.5 w-3.5 mr-2" /> Chat IA
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => selectedActivity && handleCloneActivity(selectedActivity)}
                          className="text-xs"
                        >
                          <Copy className="h-3.5 w-3.5 mr-2" /> Duplicar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Right group: primary actions */}
                {sheetMode === 'edit' ? (
                  <div className="flex items-center gap-2 flex-wrap md:ml-auto md:justify-end">
                    {selectedActivity?.status === 'concluida' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                            <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-40 p-1" align="end">
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => selectedActivity && handleDelete(selectedActivity.id)}
                      title="Excluir atividade"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleUpdate}>Salvar</Button>
                    {selectedActivity?.status !== 'concluida' && (() => {
                      const audioTarget = leadPreview?.whatsapp_group_id || null;
                      const canSendAudioToGroup = !!pendingAudio && !!audioTarget;
                      return (
                        <div className="inline-flex items-stretch rounded-md overflow-hidden shadow-sm">
                          <Button
                            size="sm"
                            className="h-8 text-xs gap-1 bg-warning hover:bg-warning/90 text-warning-foreground rounded-r-none"
                            onClick={() => openCompleteAndNotify('sheet')}
                            disabled={noteAttachmentsUploading}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Concluir + próxima
                          </Button>
                          {canSendAudioToGroup && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  className="h-8 px-1.5 bg-warning hover:bg-warning/90 text-warning-foreground rounded-l-none border-l border-warning-foreground/20"
                                  disabled={noteAttachmentsUploading}
                                  title="Mais opções"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-72">
                                <DropdownMenuItem
                                  className="text-xs"
                                  disabled={sendingPendingAudio}
                                  onClick={async () => {
                                    if (!pendingAudio || !audioTarget) return;
                                    setSendingPendingAudio(true);
                                    try {
                                      await sendVoiceToWa(pendingAudio.url, audioTarget, formLeadId);
                                      toast.success('Áudio enviado ao grupo do WhatsApp!');
                                      setPendingAudio(null);
                                    } catch (e: any) {
                                      toast.error(e?.message || 'Erro ao enviar áudio no WhatsApp');
                                    } finally {
                                      setSendingPendingAudio(false);
                                    }
                                    openCompleteAndNotify('sheet');
                                  }}
                                >
                                  <Mic className="h-3.5 w-3.5 mr-2" /> Concluir + próxima e enviar áudio no grupo
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      );
                    })()}
                    {selectedActivity?.status !== 'concluida' && (
                      <Button size="sm" className="h-8 text-xs bg-success hover:bg-success/90 text-success-foreground shadow-sm" onClick={() => selectedActivity && handleComplete(selectedActivity.id)} disabled={noteAttachmentsUploading}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Concluir
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 md:ml-auto md:justify-end">
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
                              solicitacao: formSolicitacao || null,
                              resposta_juizo: formRespostaJuizo || null,
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
                              client_name_override: formClientNameOverride || null,
                              ...buildAssigneesPayload(),
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
          </div>
        )}
      </div>

      {selectedActivity?.id && (
        <TeamChatSheet
          open={teamChatOpen}
          onOpenChange={setTeamChatOpen}
          entityType="activity"
          entityId={selectedActivity.id}
          entityName={selectedActivity.title}
        />
      )}

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
      <CourtContactsSheet open={courtContactsOpen} onOpenChange={setCourtContactsOpen} />
      <ActivityCreatedDialog
        open={createdDialog.open}
        onOpenChange={(open) => setCreatedDialog((prev) => ({ ...prev, open }))}
        title={createdDialog.title}
        onEdit={() => createdDialog.activity && handleOpenEdit(createdDialog.activity)}
        onDelete={() => {
          const act = createdDialog.activity;
          const titleToUse = createdDialog.title;
          if (!act) return;
          confirmDelete(
            'Excluir atividade?',
            `"${titleToUse}" será excluída.`,
            async () => {
              await deleteActivity(act.id);
              fetchActivities(getFilterParams());
            }
          );
        }}
      />
      {/* Lead Edit Sheet */}
      {formLeadId && (
        <LeadEditDialog
          open={showLeadSheet}
          onOpenChange={setShowLeadSheet}
          lead={{ id: formLeadId, lead_name: formLeadName } as any}
          onSave={async (leadId, updates) => {
            const { error } = await externalSupabase.from('leads').update(updates as any).eq('id', leadId);
            if (error) throw error;
            setShowLeadSheet(false);
          }}
          mode="sheet"
        />
      )}

      {/* Process Detail Sheet — Últimas movimentações */}
      {showProcessSheetId && (() => {
        const proc = caseProcesses.find(p => p.id === showProcessSheetId);
        if (!proc) return null;
        const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));
        return (
          <Suspense fallback={null}>
            <ProcessDetailSheet
              open={!!showProcessSheetId}
              onOpenChange={(o) => { if (!o) setShowProcessSheetId(null); }}
              process={proc}
              onUpdated={applyUpdatedCaseProcess}
              defaultTab="atividades"
            />
          </Suspense>
        );
      })()}

      <CompleteAndNotifyDialog
        open={completeNotifyOpen}
        onClose={() => setCompleteNotifyOpen(false)}
        onConfirm={handleCompleteAndCreateNextWithNotify}
        leadId={formLeadId || null}
        buildMsg={buildMsg}
      />

      {/* Preview de conversa do WhatsApp inline (mesmo componente do Monitor IA / Contatos) */}
      <DashboardChatPreview
        open={!!waChatPreview}
        onOpenChange={(open) => { if (!open) setWaChatPreview(null); }}
        phone={waChatPreview?.phone || null}
        contactName={waChatPreview?.contact_name || null}
        instanceName={waChatPreview?.instance_name || null}
        hasLead={!!formLeadId}
        hasContact={false}
        wasResponded={false}
        responseTimeMinutes={null}
      />

      <AssessorSummaryShareDialog
        open={shareSummaryOpen}
        onOpenChange={setShareSummaryOpen}
        activities={displayedActivities}
        teamMembers={teamMembers}
        filterAssignee={filterAssignee}
        selectedCalDays={selectedCalDays}
        allKnownActivityTypes={allKnownActivityTypes}
      />

      {/* Busca de grupos do contato (mesmo dialog usado dentro do Lead) */}
      {formLeadId && (
        <LeadGroupSearchDialog
          open={groupSearchOpen}
          onOpenChange={setGroupSearchOpen}
          leadId={formLeadId}
          contactPhone={leadPreview?.lead_phone || undefined}
          instanceName={undefined}
          leadName={formLeadName || ''}
          onGroupSelected={async (g) => {
            try {
              const { error } = await externalSupabase
                .from('leads')
                .update({ whatsapp_group_id: g.jid })
                .eq('id', formLeadId);
              if (error) throw error;
              setLeadPreview((prev) => prev ? { ...prev, whatsapp_group_id: g.jid } : prev);
              toast.success('Grupo vinculado ao lead.');
            } catch (e: any) {
              toast.error('Falha ao vincular grupo: ' + (e?.message || 'erro desconhecido'));
            }
          }}
        />
      )}



      {/* Popup fullscreen de Parabéns ao concluir a última atividade do bloco */}
      {celebrateBlock && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-300 cursor-pointer"
          onClick={() => setCelebrateBlock(null)}
        >
          {/* Confetes */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {Array.from({ length: 40 }).map((_, i) => {
              const colors = ['bg-yellow-400', 'bg-pink-400', 'bg-sky-400', 'bg-lime-400', 'bg-orange-400', 'bg-purple-400'];
              const color = colors[i % colors.length];
              const left = (i * 37) % 100;
              const delay = (i * 73) % 1500;
              const duration = 2000 + ((i * 131) % 1500);
              return (
                <span
                  key={i}
                  className={cn('absolute top-[-20px] w-2 h-3 rounded-sm', color)}
                  style={{
                    left: `${left}%`,
                    animation: `confetti-fall ${duration}ms ease-in ${delay}ms infinite`,
                    transform: `rotate(${(i * 47) % 360}deg)`,
                  }}
                />
              );
            })}
          </div>

          <div className="relative text-center px-6 animate-in zoom-in-50 duration-500">
            <div className="text-7xl sm:text-8xl mb-4">🎉</div>
            <h1
              className="font-black uppercase text-yellow-300 tracking-tight leading-none mb-4"
              style={{
                fontSize: 'clamp(3rem, 12vw, 8rem)',
                textShadow: '0 0 30px rgba(250,204,21,0.6), 0 4px 12px rgba(0,0,0,0.8)',
                WebkitTextStroke: '2px rgba(0,0,0,0.4)',
              }}
            >
              Parabéns!
            </h1>
            <p className="text-2xl sm:text-4xl font-bold text-white drop-shadow-lg mb-2">
              {profile?.full_name || user?.email?.split('@')[0] || 'Você'}
            </p>
            <p className="text-lg sm:text-2xl font-semibold text-white/95 italic drop-shadow-lg max-w-2xl mx-auto leading-snug">
              Você é merecedor de suas batalhas, avante!
            </p>
            <p className="text-sm sm:text-lg font-bold text-yellow-200/90 uppercase tracking-wide mt-3 drop-shadow">
              {celebrateBlock.label}
            </p>
            <p className="text-xs sm:text-sm text-white/60 mt-6">Toque em qualquer lugar para fechar</p>
          </div>

          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(110vh) rotate(720deg); opacity: 0.6; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default ActivitiesPage;
