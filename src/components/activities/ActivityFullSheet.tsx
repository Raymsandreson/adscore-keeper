import { useState, useEffect, useCallback, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToCloud, remapToExternal } from '@/integrations/supabase/uuid-remap';
import { authClient } from '@/integrations/supabase';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Save, Loader2, CheckCircle2, Trash2, ExternalLink, X, Plus, Building2, Briefcase, UserPlus, FileText, Sparkles, ChevronDown, Mic } from 'lucide-react';
import { ActivityFormCompact } from '@/components/activities/ActivityFormCompact';
import { ActivityCallRecorder, callFieldTextToHtml, stripHtmlToText } from '@/components/activities/ActivityCallRecorder';
import { ActivityDocumentUpload } from '@/components/activities/ActivityDocumentUpload';
import { LeadFunnelProgressBar } from '@/components/activities/LeadFunnelProgressBar';
import { useActivityTypes, isMeetingType } from '@/hooks/useActivityTypes';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityStepContext } from '@/hooks/useActivityStepContext';
import { useLeadActivities, type LeadActivity } from '@/hooks/useLeadActivities';
import { useActivityTimer } from '@/contexts/ActivityTimerContext';

/**
 * Rascunho para abrir o formulário em modo CRIAR já pré-preenchido
 * (ex.: "Criar atividade a partir da movimentação" preenchido por IA).
 * O usuário revisa/edita e só então cria de fato.
 */
export interface ActivityDraft {
  title?: string;
  activity_type?: string;
  priority?: string;
  deadline?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  lead_id?: string;
  lead_name?: string;
  case_id?: string;
  case_title?: string;
  process_id?: string;
  process_title?: string;
  workflow_id?: string;
  what_was_done?: string;
  current_status_notes?: string;
  next_steps?: string;
  solicitacao?: string;
  resposta_juizo?: string;
  notes?: string;
}

interface ActivityFullSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string | null;
  /** Contexto do lead quando o sheet é aberto de dentro de um lead/caso. */
  leadId?: string | null;
  leadName?: string | null;
  onUpdated?: () => void;
  /** 'edit' (padrão) edita a atividade de `activityId`; 'create' cria a partir de `draft`. */
  mode?: 'edit' | 'create';
  /** Valores pré-preenchidos usados no modo 'create'. */
  draft?: ActivityDraft | null;
  /** Chamado após criar com sucesso no modo 'create'. */
  onCreated?: () => void;
}

type CaseRow = { id: string; case_number: string; title: string };
type ProcessRow = {
  id: string; title: string; process_number: string | null;
  polo_passivo?: string | null; tribunal?: string | null; area?: string | null;
  assuntos?: string[] | null; workflow_id?: string | null; envolvidos?: unknown[] | null;
};

/**
 * Formulário COMPLETO de atividade num Sheet — reutiliza o mesmo
 * `ActivityFormCompact` da ActivitiesPage (formulário único do sistema).
 * Substitui o antigo ActivityEditSheet reduzido dentro das abas de Lead/Caso.
 */
export function ActivityFullSheet({ open, onOpenChange, activityId, leadId, leadName, onUpdated, mode = 'edit', draft, onCreated }: ActivityFullSheetProps) {
  const isCreate = mode === 'create';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null);

  // ---- Form state (mesmo conjunto do formulário completo) ----
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState('');
  const [formStatus, setFormStatus] = useState('pendente');
  const [formPriority, setFormPriority] = useState('normal');
  const [formDeadline, setFormDeadline] = useState('');
  const [formNotificationDate, setFormNotificationDate] = useState('');
  const [formMeetingAt, setFormMeetingAt] = useState('');
  // Retorno agendado (datetime-local, fuso do navegador) — vira callback_at (ISO) no banco.
  const [formCallbackAt, setFormCallbackAt] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToName, setFormAssignedToName] = useState('');
  const [formMatrixQuadrant, setFormMatrixQuadrant] = useState('');
  const [formLeadId, setFormLeadId] = useState('');
  const [formLeadName, setFormLeadName] = useState('');
  const [formClientNameOverride, setFormClientNameOverride] = useState('');
  const [formContactId, setFormContactId] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formCaseId, setFormCaseId] = useState('');
  const [formCaseTitle, setFormCaseTitle] = useState('');
  const [formProcessId, setFormProcessId] = useState('');
  const [formProcessTitle, setFormProcessTitle] = useState('');
  const [formWorkflowId, setFormWorkflowId] = useState('');
  const [formIsSystem, setFormIsSystem] = useState(false);
  const [formIsManagement, setFormIsManagement] = useState(false);
  const [formRepeatWeekDays, setFormRepeatWeekDays] = useState<number[]>([]);
  // Paridade com a ActivitiesPage (formulário único): co-assessores, observadores,
  // campanha, feedback e reagendamento também existem quando aberto de Lead/Caso.
  const [formCoAssignees, setFormCoAssignees] = useState<{ user_id: string; full_name: string }[]>([]);
  const [loadedHadCoAssignees, setLoadedHadCoAssignees] = useState(false);
  const [formObservers, setFormObservers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [loadedHadObservers, setLoadedHadObservers] = useState(false);
  const [formCampaignId, setFormCampaignId] = useState('');
  const [formFeedback, setFormFeedback] = useState('');
  const [formRescheduledTo, setFormRescheduledTo] = useState('');
  const [formWhatWasDone, setFormWhatWasDone] = useState('');
  const [formCurrentStatus, setFormCurrentStatus] = useState('');
  const [formNextSteps, setFormNextSteps] = useState('');
  const [formSolicitacao, setFormSolicitacao] = useState('');
  const [formRespostaJuizo, setFormRespostaJuizo] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // ---- Support data ----
  const [leadCases, setLeadCases] = useState<CaseRow[]>([]);
  const [caseProcesses, setCaseProcesses] = useState<ProcessRow[]>([]);
  const [availableContacts, setAvailableContacts] = useState<{ id: string; full_name: string }[]>([]);
  const [availableCases, setAvailableCases] = useState<{ id: string; case_number: string; title: string; lead_id: string | null }[]>([]);
  const [leadPreview, setLeadPreview] = useState<{ board_id: string | null; lead_status: string | null; whatsapp_group_id?: string | null; lead_phone?: string | null } | null>(null);
  // "Preencher com" (paridade com a ActivitiesPage): áudio e documento preenchem o form via IA.
  const [preencherOpen, setPreencherOpen] = useState(false);
  const [callRecorderOpen, setCallRecorderOpen] = useState(false);
  const [docUploadOpen, setDocUploadOpen] = useState(false);
  const [searchedLeads, setSearchedLeads] = useState<{ id: string; lead_name: string | null }[]>([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [caseSearch, setCaseSearch] = useState('');

  const { types: activityTypes } = useActivityTypes();
  const { boards: allBoards } = useKanbanBoards();
  const workflowOptions = allBoards.filter(b => b.board_type === 'workflow').map(b => ({ id: b.id, name: b.name }));
  const profiles = useProfilesList();
  const { fields: fieldSettings, updateField: updateFieldSetting, reorderFields } = useActivityFieldSettings();
  const { createActivity, updateActivity, completeActivity, deleteActivity } = useLeadActivities();
  const { startTimer, requestLeave, stopTimerFor, current: runningTimer } = useActivityTimer();

  // Board dos "Modelos do passo"/checklist: workflow do processo tem prioridade; senão funil do lead
  const linkedProcess = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
  const stepBoardId = linkedProcess?.workflow_id || leadPreview?.board_id || null;
  const { stepContext, saveStepFieldTemplates, selectedStepId, setSelectedStepId } = useActivityStepContext(formLeadId || null, stepBoardId);

  const routineActivityTypes = activityTypes.map(t => ({ value: t.key, label: t.label }));
  const teamMembers = profiles.map(p => ({ user_id: p.user_id, full_name: p.full_name }));

  const loadContactsForLead = useCallback(async (lid: string) => {
    try {
      const { data: linked } = await externalSupabase.from('contact_leads').select('contact_id').eq('lead_id', lid);
      if (linked && linked.length > 0) {
        const ids = linked.map(l => l.contact_id);
        const { data } = await externalSupabase.from('contacts').select('id, full_name').in('id', ids).order('full_name');
        setAvailableContacts(data || []);
      } else {
        const { data } = await externalSupabase.from('contacts').select('id, full_name').order('full_name').limit(500);
        setAvailableContacts(data || []);
      }
    } catch { /* mantém contatos atuais */ }
  }, []);

  const loadLeadPreview = useCallback(async (lid: string) => {
    const { data } = await externalSupabase.from('leads').select('board_id, lead_status, whatsapp_group_id, lead_phone').eq('id', lid).maybeSingle();
    setLeadPreview(data ? { board_id: data.board_id, lead_status: data.lead_status, whatsapp_group_id: (data as any).whatsapp_group_id, lead_phone: (data as any).lead_phone } : null);
  }, []);

  // Busca de leads para o sheet "Vincular Lead" (mesma lógica da ActivitiesPage)
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      const term = leadSearch.trim();
      let query = externalSupabase.from('leads').select('id, lead_name').order('lead_name').limit(20);
      if (term) query = query.ilike('lead_name', `%${term}%`);
      const { data } = await query;
      setSearchedLeads(data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [leadSearch, open]);

  // Lista global de casos para o sheet "Vincular Caso"
  useEffect(() => {
    if (!open) return;
    externalSupabase
      .from('legal_cases')
      .select('id, case_number, title, lead_id')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => setAvailableCases(data || []));
  }, [open]);

  const fetchActivity = useCallback(async () => {
    if (!activityId) return;
    setLoading(true);
    const { data, error } = await externalSupabase
      .from('lead_activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle();

    if (error || !data) {
      toast.error('Erro ao carregar atividade');
      setLoading(false);
      return;
    }

    const act = data as LeadActivity;
    setSelectedActivity(act);
    setFormTitle(act.title || '');
    setFormType(act.activity_type || '');
    setFormStatus(act.status || 'pendente');
    setFormPriority(act.priority || 'normal');
    setFormDeadline(act.deadline || '');
    setFormNotificationDate(act.notification_date || '');
    // meeting_at é timestamptz; datetime-local espera YYYY-MM-DDTHH:mm
    setFormMeetingAt((((act as any).meeting_at as string | null) || '').slice(0, 16));
    setFormCallbackAt((act as any).callback_at ? format(parseISO((act as any).callback_at), "yyyy-MM-dd'T'HH:mm") : '');
    setFormAssignedTo(((await remapToCloud(act.assigned_to)) as string) || '');
    setFormAssignedToName(act.assigned_to_name || '');
    setFormMatrixQuadrant(act.matrix_quadrant || '');
    const lid = act.lead_id || leadId || '';
    setFormLeadId(lid);
    setFormLeadName(act.lead_name || leadName || '');
    setFormClientNameOverride(act.client_name_override || '');
    setFormContactId(act.contact_id || '');
    setFormContactName(act.contact_name || '');
    setFormCaseId(act.case_id || '');
    setFormCaseTitle(act.case_title || '');
    setFormProcessId(act.process_id || '');
    setFormProcessTitle(act.process_title || '');
    setFormWorkflowId((act as any).workflow_id || '');
    setFormIsSystem(!!act.is_system);
    setFormIsManagement(!!(act as any).is_management);
    setFormWhatWasDone(act.what_was_done || '');
    setFormCurrentStatus(act.current_status_notes || '');
    setFormNextSteps(act.next_steps || '');
    setFormSolicitacao(act.solicitacao || '');
    setFormRespostaJuizo(act.resposta_juizo || '');
    setFormNotes(act.notes || '');
    setFormCampaignId((act as any).crm_campaign_id || '');
    setFormFeedback((act as any).feedback || '');
    setFormRescheduledTo((act as any).rescheduled_to || '');

    // Co-assessores e observadores: arrays gravados com UUIDs do Externo → Cloud.
    const extIds = (act.assigned_to_ids as string[] | null) || [];
    const extNames = ((act as any).assigned_to_names as string[] | null) || [];
    if (extIds.length > 1) {
      const primaryCloud = ((await remapToCloud(act.assigned_to)) as string) || '';
      const cloudIds = await Promise.all(extIds.map((id) => remapToCloud(id)));
      const co = cloudIds
        .map((cid, i) => ({ user_id: (cid as string) || '', full_name: extNames[i] || '' }))
        .filter((c) => c.user_id && c.user_id !== primaryCloud);
      setFormCoAssignees(co);
      setLoadedHadCoAssignees(true);
    } else {
      setFormCoAssignees([]);
      setLoadedHadCoAssignees(false);
    }
    const obsExt = ((act as any).observer_ids as string[] | null) || [];
    const obsNames = ((act as any).observer_names as string[] | null) || [];
    if (obsExt.length > 0) {
      const cloudIds = await Promise.all(obsExt.map((id) => remapToCloud(id)));
      const obs = cloudIds
        .map((cid, i) => ({ user_id: (cid as string) || '', full_name: obsNames[i] || '' }))
        .filter((o) => o.user_id);
      setFormObservers(obs);
      setLoadedHadObservers(true);
    } else {
      setFormObservers([]);
      setLoadedHadObservers(false);
    }
    setLoading(false);

    // Dados de apoio em paralelo (não bloqueiam a UI)
    if (lid) {
      externalSupabase.from('legal_cases').select('id, case_number, title').eq('lead_id', lid).then(({ data }) => setLeadCases((data as CaseRow[]) || []));
      loadContactsForLead(lid);
      loadLeadPreview(lid);
    }
    if (act.case_id) {
      externalSupabase
        .from('lead_processes')
        .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
        .eq('case_id', act.case_id)
        .then(({ data }) => setCaseProcesses((data as ProcessRow[]) || []));
    }
  }, [activityId, leadId, leadName, loadContactsForLead, loadLeadPreview]);

  // Modo CRIAR: preenche o formulário a partir do rascunho (IA) em vez de buscar do banco.
  const initFromDraft = useCallback(async (d: ActivityDraft) => {
    setSelectedActivity(null);
    setFormTitle(d.title || '');
    setFormType(d.activity_type || '');
    setFormStatus('pendente');
    setFormPriority(d.priority || 'normal');
    setFormDeadline(d.deadline || '');
    setFormNotificationDate('');
    setFormMeetingAt('');
    setFormCallbackAt('');
    setFormAssignedTo(d.assigned_to || '');
    setFormAssignedToName(d.assigned_to_name || '');
    setFormMatrixQuadrant('');
    setFormLeadId(d.lead_id || '');
    setFormLeadName(d.lead_name || '');
    setFormClientNameOverride('');
    setFormContactId('');
    setFormContactName('');
    setFormCaseId(d.case_id || '');
    setFormCaseTitle(d.case_title || '');
    setFormProcessId(d.process_id || '');
    setFormProcessTitle(d.process_title || '');
    setFormWorkflowId(d.workflow_id || '');
    setFormIsSystem(false);
    setFormIsManagement(false);
    setFormWhatWasDone(d.what_was_done || '');
    setFormCurrentStatus(d.current_status_notes || '');
    setFormNextSteps(d.next_steps || '');
    setFormSolicitacao(d.solicitacao || '');
    setFormRespostaJuizo(d.resposta_juizo || '');
    setFormNotes(d.notes || '');
    setFormCoAssignees([]); setLoadedHadCoAssignees(false);
    setFormObservers([]); setLoadedHadObservers(false);
    setFormCampaignId('');
    setFormFeedback('');
    setFormRescheduledTo('');

    if (d.lead_id) {
      externalSupabase.from('legal_cases').select('id, case_number, title').eq('lead_id', d.lead_id).then(({ data }) => setLeadCases((data as CaseRow[]) || []));
      loadContactsForLead(d.lead_id);
      loadLeadPreview(d.lead_id);
    } else {
      setLeadCases([]);
    }
    if (d.case_id) {
      const { data } = await externalSupabase
        .from('lead_processes')
        .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
        .eq('case_id', d.case_id);
      setCaseProcesses((data as ProcessRow[]) || []);
    } else {
      setCaseProcesses([]);
    }
  }, [loadContactsForLead, loadLeadPreview]);

  // Evita reinicializar o rascunho a cada render enquanto o sheet fica aberto.
  const draftInitedRef = useRef(false);

  useEffect(() => {
    if (open && !isCreate && activityId) fetchActivity();
    if (open && isCreate && draft && !draftInitedRef.current) {
      draftInitedRef.current = true;
      initFromDraft(draft);
    }
    if (!open) {
      draftInitedRef.current = false;
      setSelectedActivity(null); setCaseProcesses([]); setLeadPreview(null);
    }
  }, [open, activityId, fetchActivity, isCreate, draft, initFromDraft]);

  // Cronômetro: auto-start ao abrir a atividade (banco de horas).
  // Só se a atv for SUA (principal, co-assessor ou sem responsável) —
  // abrir atv de outro assessor é consulta e não conta tempo.
  useEffect(() => {
    if (!open || !selectedActivity?.id || selectedActivity.status === 'concluida') return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await authClient.auth.getUser();
      const myExt = await remapToExternal(user?.id || null);
      const ids = selectedActivity.assigned_to_ids || null;
      const unassigned = !selectedActivity.assigned_to && !(ids && ids.length > 0);
      const mine = unassigned || selectedActivity.assigned_to === myExt || !!(myExt && ids?.includes(myExt));
      if (!cancelled && mine) {
        startTimer({
          id: selectedActivity.id,
          activity_type: selectedActivity.activity_type,
          title: selectedActivity.title,
          lead_name: selectedActivity.lead_name,
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedActivity?.id]);

  // Fechar o sheet → pergunta continuar/pausar SÓ se esta atv é a cronometrada
  // (fechar uma atv consultada não mexe no seu cronômetro).
  const handleClose = () => {
    if (runningTimer?.kind === 'activity' && runningTimer.activityId === activityId) requestLeave();
    onOpenChange(false);
  };

  // ---- Handlers passados ao ActivityFormCompact ----
  const handleTitleChange = (v: string) => setFormTitle(v);
  const handleDeadlineChange = (v: string) => {
    setFormDeadline(v);
    if (!formNotificationDate) setFormNotificationDate(v);
  };
  // Seleção multi: 1º clique define o principal; cliques seguintes alternam co-responsáveis.
  // Clicar no principal o desmarca (o 1º co-responsável, se houver, vira o principal).
  // Virar responsável remove a pessoa dos observadores (papéis são exclusivos).
  const handleSelectAssignee = (userId: string) => {
    const member = teamMembers.find(m => m.user_id === userId);
    const name = member?.full_name || '';
    setFormObservers(prev => prev.filter(o => o.user_id !== userId));
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
  // Alterna a pessoa como OBSERVADORA (acompanha e recebe popups, sem ser cobrada).
  // Virar observador remove a pessoa dos responsáveis.
  const handleToggleObserver = (userId: string) => {
    const member = teamMembers.find(m => m.user_id === userId);
    const name = member?.full_name || '';
    if (formObservers.some(o => o.user_id === userId)) {
      setFormObservers(prev => prev.filter(o => o.user_id !== userId));
      return;
    }
    if (formAssignedTo === userId) {
      const [next, ...rest] = formCoAssignees;
      setFormAssignedTo(next?.user_id || '');
      setFormAssignedToName(next?.full_name || '');
      setFormCoAssignees(rest);
    } else if (formCoAssignees.some(c => c.user_id === userId)) {
      setFormCoAssignees(prev => prev.filter(c => c.user_id !== userId));
    }
    setFormObservers(prev => [...prev, { user_id: userId, full_name: name }]);
  };
  const handleSelectLead = async (lid: string) => {
    let name = searchedLeads.find(l => l.id === lid)?.lead_name || '';
    if (!name) {
      const { data } = await externalSupabase.from('leads').select('lead_name').eq('id', lid).maybeSingle();
      name = data?.lead_name || '';
    }
    setFormLeadId(lid);
    setFormLeadName(name);
    setFormClientNameOverride('');
    setFormContactId(''); setFormContactName(''); setContactSearch('');
    setFormCaseId(''); setFormCaseTitle('');
    setFormProcessId(''); setFormProcessTitle('');
    setCaseProcesses([]);
    const { data } = await externalSupabase.from('legal_cases').select('id, case_number, title').eq('lead_id', lid);
    setLeadCases((data as CaseRow[]) || []);
    loadContactsForLead(lid);
    loadLeadPreview(lid);
  };
  const handleClearLead = async () => {
    setFormLeadId(''); setFormLeadName(''); setFormClientNameOverride('');
    setFormContactId(''); setFormContactName('');
    setFormCaseId(''); setFormCaseTitle('');
    setFormProcessId(''); setFormProcessTitle('');
    setLeadCases([]); setCaseProcesses([]);
    const { data } = await externalSupabase.from('contacts').select('id, full_name').order('full_name').limit(500);
    setAvailableContacts(data || []);
  };

  const buildPayload = () => ({
    title: formTitle,
    description: null as string | null,
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
    // Só persiste horário quando o tipo é Reunião (detecção por rótulo — no Externo a key é custom_...).
    meeting_at: isMeetingType(formType, activityTypes.find(t => t.key === formType)?.label) ? (formMeetingAt || null) : null,
    notes: formNotes || null,
    status: formStatus,
    contact_id: formContactId || null,
    contact_name: formContactName || null,
    case_id: formCaseId || null,
    case_title: formCaseTitle || null,
    process_id: formProcessId || null,
    process_title: formProcessTitle || null,
    workflow_id: formWorkflowId || null,
    matrix_quadrant: formMatrixQuadrant || null,
    client_name_override: formClientNameOverride || null,
    is_system: formIsSystem,
    is_management: formIsManagement,
    crm_campaign_id: formCampaignId || null,
    feedback: formFeedback || null,
    rescheduled_to: formRescheduledTo || null,
    // Retorno agendado: só entra quando MUDOU — senão todo save zeraria o carimbo
    // callback_notified_at e o lembrete dispararia de novo.
    ...(() => {
      const nextIso = formCallbackAt ? new Date(formCallbackAt).toISOString() : null;
      const prevRaw = (selectedActivity as any)?.callback_at || null;
      const prevMs = prevRaw ? new Date(prevRaw).getTime() : null;
      const nextMs = nextIso ? new Date(nextIso).getTime() : null;
      return prevMs !== nextMs ? { callback_at: nextIso } : {};
    })(),
    // Arrays multi-assessor/observador: só entram quando há (ou quando a atividade
    // carregada já tinha — para permitir limpar). Hook remapeia Cloud→Externo.
    ...(formCoAssignees.length === 0 && !loadedHadCoAssignees ? {} : {
      assigned_to_ids: [formAssignedTo, ...formCoAssignees.map(c => c.user_id)].filter(Boolean),
      assigned_to_names: [formAssignedToName, ...formCoAssignees.map(c => c.full_name)].filter(Boolean),
    }),
    ...(formObservers.length === 0 && !loadedHadObservers ? {} : {
      observer_ids: formObservers.map(o => o.user_id),
      observer_names: formObservers.map(o => o.full_name),
    }),
  });

  const handleSave = async () => {
    if (!formTitle.trim()) { toast.error('Informe o assunto'); return; }
    if (!formAssignedTo) { toast.error('Selecione o assessor'); return; }
    if (!formDeadline) { toast.error('Informe o prazo'); return; }
    if (!formNotificationDate) { toast.error('Informe a data de notificação'); return; }

    if (isCreate) {
      setSaving(true);
      const payload = buildPayload() as Partial<LeadActivity> & { observer_ids?: string[]; observer_names?: string[] };
      // Quem cria a atividade entra como observador automaticamente (se não for responsável).
      const { data: { user } } = await authClient.auth.getUser();
      const uid = user?.id || '';
      const isResponsible = uid && (formAssignedTo === uid || formCoAssignees.some(c => c.user_id === uid));
      if (uid && !isResponsible && !formObservers.some(o => o.user_id === uid)) {
        const myName = teamMembers.find(m => m.user_id === uid)?.full_name || '';
        payload.observer_ids = [...(payload.observer_ids || []), uid];
        payload.observer_names = [...(payload.observer_names || []), myName];
      }
      const created = await createActivity(payload);
      setSaving(false);
      if (created) {
        toast.success('Atividade criada.');
        onUpdated?.();
        onCreated?.();
        onOpenChange(false);
      }
      return;
    }

    if (!activityId) return;
    setSaving(true);
    await updateActivity(activityId, buildPayload() as Partial<LeadActivity>);
    setSaving(false);
    onUpdated?.();
    handleClose();
  };

  const handleComplete = async () => {
    if (!activityId) return;
    await completeActivity(activityId);
    await stopTimerFor(activityId); // concluiu A ATV CRONOMETRADA → salva e encerra; consulta não mexe no cronômetro
    onUpdated?.();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!activityId) return;
    await deleteActivity(activityId);
    await stopTimerFor(activityId); // excluiu a atv cronometrada → salva o tempo; consulta não mexe no cronômetro
    onUpdated?.();
    onOpenChange(false);
  };

  const handleOpenInPage = () => {
    if (activityId) window.open(`${window.location.origin}/?openActivity=${activityId}`, '_blank');
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle
              className="text-base font-semibold leading-snug line-clamp-2 flex-1 min-w-0"
              title={formTitle || undefined}
            >
              {formTitle || (isCreate ? 'Nova atividade' : 'Atividade')}
            </SheetTitle>
            <div className="flex items-center gap-1">
              {/* Preencher com IA (áudio/documento) — mesma função da ActivitiesPage */}
              <Popover open={preencherOpen} onOpenChange={setPreencherOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1 shrink-0">
                    <Sparkles className="h-3 w-3" />
                    Preencher com <ChevronDown className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1.5 space-y-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-8 text-xs gap-2 text-green-700 dark:text-green-400"
                    onClick={() => { setPreencherOpen(false); setCallRecorderOpen(true); }}
                  >
                    <Mic className="h-3.5 w-3.5" /> Preenchimento por Áudio
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-8 text-xs gap-2 text-blue-700 dark:text-blue-400"
                    onClick={() => { setPreencherOpen(false); setDocUploadOpen(true); }}
                  >
                    <FileText className="h-3.5 w-3.5" /> Preenchimento por Documento
                  </Button>
                </PopoverContent>
              </Popover>

              {/* Painéis controlados pelo menu acima (gatilho sr-only sempre montado,
                  como na ActivitiesPage, pra não perder a âncora ao fechar o dropdown) */}
              <ActivityCallRecorder
                triggerClassName="sr-only"
                open={callRecorderOpen}
                onOpenChange={setCallRecorderOpen}
                activityId={selectedActivity?.id}
                leadId={formLeadId}
                caseId={formCaseId}
                processId={formProcessId}
                groupJid={leadPreview?.whatsapp_group_id}
                leadPhone={leadPreview?.lead_phone}
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
                  co_assessor_names: formCoAssignees.map((c) => c.full_name).filter(Boolean),
                  team_members: teamMembers.map((m) => m.full_name).filter(Boolean) as string[],
                  activity_types: routineActivityTypes.map((t) => ({ key: t.value, label: t.label })),
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
                  // Metadados ditados no áudio (prazo, prioridade, situação, título, tipo).
                  if (f.title) setFormTitle(f.title);
                  if (f.deadline && /^\d{4}-\d{2}-\d{2}$/.test(f.deadline)) handleDeadlineChange(f.deadline);
                  if (f.notification_date && /^\d{4}-\d{2}-\d{2}$/.test(f.notification_date)) setFormNotificationDate(f.notification_date);
                  if (f.priority && ['baixa', 'normal', 'alta', 'urgente'].includes(f.priority)) setFormPriority(f.priority);
                  if (f.status && ['pendente', 'em_andamento', 'concluida'].includes(f.status)) setFormStatus(f.status);
                  if (f.activity_type) {
                    const t = routineActivityTypes.find((x) => x.value === f.activity_type);
                    if (t && t.value !== formType) {
                      setFormType(t.value);
                      toast.info(`Tipo ajustado pela IA para ${t.label}.`, { duration: 2500 });
                    }
                  }
                  // Assessores ditados no áudio: o primeiro vira o principal, os demais co-assessores.
                  const spokenNames = (f.assessor_names && f.assessor_names.length > 0)
                    ? f.assessor_names
                    : (f.assessor_name ? [f.assessor_name] : []);
                  if (spokenNames.length > 0) {
                    const norm = (s: string) => s.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase().trim();
                    const matched: { user_id: string; full_name: string }[] = [];
                    const notFound: string[] = [];
                    for (const name of spokenNames) {
                      const spoken = norm(name);
                      const member = teamMembers.find((m) => {
                        const full = norm(m.full_name || '');
                        return full && (full.includes(spoken) || spoken.includes(full) || full.split(' ')[0] === spoken.split(' ')[0]);
                      });
                      if (member && !matched.some((x) => x.user_id === member.user_id)) {
                        matched.push({ user_id: member.user_id, full_name: member.full_name || '' });
                      } else if (!member) {
                        notFound.push(name);
                      }
                    }
                    if (matched.length > 0) {
                      setFormAssignedTo(matched[0].user_id);
                      setFormAssignedToName(matched[0].full_name);
                      setFormCoAssignees(matched.slice(1));
                    }
                    if (notFound.length > 0) {
                      toast.error(`Assessor(es) citado(s) no áudio não encontrado(s) na equipe: ${notFound.join(', ')}.`);
                    }
                  }
                }}
              />
              <ActivityDocumentUpload
                triggerClassName="sr-only"
                open={docUploadOpen}
                onOpenChange={setDocUploadOpen}
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

              {!isCreate && (
                <Button variant="ghost" size="sm" onClick={handleOpenInPage} className="gap-1 text-xs shrink-0" title="Abrir na tela de Atividades">
                  <ExternalLink className="h-3 w-3" /> Tela cheia
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8 shrink-0"
                title="Fechar atividade"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Vínculos: badges do que está vinculado + botões para vincular
              (os eventos são ouvidos pelo ActivityFormCompact, que abre os sheets) */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {formLeadName ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[220px]">
                <Building2 className="h-3 w-3 shrink-0" /><span className="truncate">{formLeadName}</span>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-lead'))}>
                <Plus className="h-3 w-3" /> Vincular Lead
              </Button>
            )}
            {formCaseTitle ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[220px]">
                <Briefcase className="h-3 w-3 shrink-0" /><span className="truncate">{formCaseTitle}</span>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-case'))}>
                <Briefcase className="h-3 w-3" /> Vincular Caso
              </Button>
            )}
            {formProcessTitle ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[220px]">
                <FileText className="h-3 w-3 shrink-0" /><span className="truncate">{formProcessTitle}</span>
              </Badge>
            ) : formCaseId ? (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-process'))}>
                <FileText className="h-3 w-3" /> Vincular Processo
              </Button>
            ) : null}
            {formContactName ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[180px]">
                <UserPlus className="h-3 w-3 shrink-0" /><span className="truncate">{formContactName}</span>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-contact'))}>
                <UserPlus className="h-3 w-3" /> Vincular Contato
              </Button>
            )}
          </div>

          {/* Fluxo de trabalho: workflow do processo tem prioridade; senão funil do lead */}
          {formLeadId && (() => {
            if (formProcessId) {
              if (linkedProcess?.workflow_id) {
                return <LeadFunnelProgressBar leadId={formLeadId} boardId={linkedProcess.workflow_id} />;
              }
              return (
                <p className="text-[10px] text-muted-foreground italic">
                  Processo sem POP vinculado — cadastre um POP no processo para ver o progresso.
                </p>
              );
            }
            if (leadPreview?.lead_status !== 'closed' && leadPreview?.board_id) {
              return <LeadFunnelProgressBar leadId={formLeadId} boardId={leadPreview.board_id} />;
            }
            return null;
          })()}
        </SheetHeader>

        {loading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4">
              <ActivityFormCompact
                stepContext={stepContext}
                saveStepFieldTemplates={saveStepFieldTemplates}
                selectedStepId={selectedStepId}
                setSelectedStepId={setSelectedStepId}
                formTitle={formTitle} setFormTitle={setFormTitle}
                formAssignedTo={formAssignedTo} handleSelectAssignee={handleSelectAssignee}
                formCoAssignees={formCoAssignees}
                formObservers={formObservers} onToggleObserver={handleToggleObserver}
                formFeedback={formFeedback} setFormFeedback={setFormFeedback}
                formRescheduledTo={formRescheduledTo} setFormRescheduledTo={setFormRescheduledTo}
                formCampaignId={formCampaignId} setFormCampaignId={setFormCampaignId}
                formType={formType} setFormType={setFormType}
                formStatus={formStatus} setFormStatus={setFormStatus}
                formPriority={formPriority} setFormPriority={setFormPriority}
                formDeadline={formDeadline} handleDeadlineChange={handleDeadlineChange}
                formCallbackAt={formCallbackAt} setFormCallbackAt={setFormCallbackAt}
                formNotificationDate={formNotificationDate} setFormNotificationDate={setFormNotificationDate}
                formMeetingAt={formMeetingAt} setFormMeetingAt={setFormMeetingAt}
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
                filteredLeads={searchedLeads}
                availableContacts={availableContacts}
                availableCases={availableCases}
                leadCases={leadCases}
                caseProcesses={caseProcesses}
                deadlineDateCount={null}
                notifDateCount={null}
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
                aiSuggestingType={false}
                activeRoutine={[]}
                formAssignedToName={formAssignedToName}
                formLeadIdForTTS={formLeadId || undefined}
                formContactIdForTTS={formContactId || undefined}
                supabase={externalSupabase}
                leads={searchedLeads}
              />
            </div>
          </ScrollArea>
        )}

        {/* Footer actions */}
        <div className="shrink-0 border-t">
          <div className="flex items-center justify-between p-3 gap-2">
            {!isCreate && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                className="gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" /> Excluir
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handleClose}>Cancelar</Button>
              {!isCreate && selectedActivity?.status !== 'concluida' && (
                <Button variant="outline" size="sm" onClick={handleComplete} className="gap-1 text-xs bg-success hover:bg-success/90 text-success-foreground border-0">
                  <CheckCircle2 className="h-3 w-3" /> Concluir
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {isCreate ? 'Criar atividade' : 'Salvar'}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
