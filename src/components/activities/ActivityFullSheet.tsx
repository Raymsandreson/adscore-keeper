import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityChainPanel, useActivityChain } from '@/components/activities/ActivityChainPanel';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Save, Loader2, CheckCircle2, Trash2, ExternalLink, X, Plus, Building2, Briefcase, UserPlus, FileText, Sparkles, ChevronDown, Mic, Pencil, DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EntityFinancialsPanel, buildFinancialLinkOptions } from '@/components/finance/EntityFinancialsPanel';
import { ActivityFormCompact } from '@/components/activities/ActivityFormCompact';
import { displayProcessLabel, displayCaseLabel } from '@/lib/processLabel';
import { ProcessUpdatesBell } from '@/components/notifications/ProcessUpdatesBell';
import { useLinkedCaseProcess } from '@/hooks/useLinkedCaseProcess';
import ProcessMarcosInline from '@/components/cases/ProcessMarcosInline';
import PericiaInssChips from '@/components/activities/PericiaInssChips';
import { ActivityCallRecorder, type ActivityCallFields } from '@/components/activities/ActivityCallRecorder';
import { callFieldTextToHtml, stripHtmlToText, draftRichText } from '@/components/activities/richTextFields';
import { buildActivityMessage } from '@/components/activities/buildActivityMessage';
import { useActivityMessageTemplates } from '@/hooks/useActivityMessageTemplates';
import { useSystemOabs } from '@/hooks/useSystemOabs';
import { remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { ActivityDocumentUpload } from '@/components/activities/ActivityDocumentUpload';
import { AIFieldMergeDialog, type AIFieldOrigin } from '@/components/activities/AIFieldMergeDialog';
import { useKeepAsObserverPrompt, shouldAskKeepAsObserver } from '@/components/activities/useKeepAsObserverPrompt';
import { useEstimateConfirmPrompt } from '@/components/activities/useEstimateConfirmPrompt';
import { PostponeActivityPopover } from '@/components/activities/PostponeActivityPopover';
import { formatPostponeDate } from '@/lib/postponeDates';
import { splitAIFields, AI_FIELD_LABELS, type AIFieldConflict, type AIReviewedField } from '@/lib/activityAIFields';
import { LeadFunnelProgressBar } from '@/components/activities/LeadFunnelProgressBar';
import { useActivityTypes, isMeetingType } from '@/hooks/useActivityTypes';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { useAuthContext } from '@/contexts/AuthContext';
import { useKanbanBoards, isBoardArchived } from '@/hooks/useKanbanBoards';
import { useProfilesList } from '@/hooks/useProfilesList';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { useInactiveUserIds } from '@/hooks/useInactiveUserIds';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityStepContext } from '@/hooks/useActivityStepContext';
import { useLeadActivities, type LeadActivity } from '@/hooks/useLeadActivities';
import { useActivityTimer } from '@/contexts/ActivityTimerContext';
import { useActivitySpentSeconds, useEstimateSuggestion, formatEstimate, formatSpent } from '@/hooks/useActivityTimeEstimate';
import { cloudFunctions as routedFunctions } from '@/lib/functionRouter';
import { loadActivityMessageOrigin, type ActivityMessageOrigin } from '@/lib/whatsappMessageActivities';
import { MessageSquare } from 'lucide-react';

// Conversa do WhatsApp em painel de baixo pra cima — mesmo componente que a
// caixa de pendências usa pra não tirar a pessoa da tela.
const DashboardChatPreview = lazy(() =>
  import('@/components/whatsapp/DashboardChatPreview').then((m) => ({ default: m.DashboardChatPreview }))
);

/**
 * Tipos-base jurídicos (mesma seed da ActivitiesPage). Usados como fallback do
 * seletor de TIPO quando o assessor selecionado não tem rotina configurada —
 * evita despejar todos os tipos custom (marketing/ABRACI/Prev) no formulário.
 */
const BASE_ACTIVITY_TYPES = [
  { value: 'tarefa', label: 'Tarefa' },
  { value: 'audiencia', label: 'Audiência' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'acompanhamento', label: 'Acompanhamento' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'diligencia', label: 'Diligência' },
];

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
  /** Observadores pré-definidos (UUIDs do Cloud, como no seletor de assessor). */
  observers?: { user_id: string; full_name: string }[];
  /** Marca como atividade de gestão — dispensa vínculo com lead/caso/processo. */
  is_management?: boolean;
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
  /** Chamado após criar com sucesso no modo 'create' — recebe a atividade criada (id, título…). */
  onCreated?: (created?: LeadActivity | null) => void;
  /** Lado da tela em que o painel abre. 'left' serve para empilhar ao lado de um sheet já aberto à direita. */
  side?: 'left' | 'right';
  /** Sobrescreve a largura do painel (ex.: esticar até a borda de um sheet vizinho). */
  contentClassName?: string;
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
export function ActivityFullSheet({ open, onOpenChange, activityId, leadId, leadName, onUpdated, mode = 'edit', draft, onCreated, side = 'right', contentClassName }: ActivityFullSheetProps) {
  const isCreate = mode === 'create';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null);

  // Cadeia de continuidade ("Concluir + próxima"). O painel só faz sentido em
  // atividade já existente — no modo criar não há de onde vir nem para onde ir.
  const chain = useActivityChain(!isCreate && open ? selectedActivity : null);
  const [chainOpenId, setChainOpenId] = useState<string | null>(null);

  // Caminho inverso do selo do WhatsApp: de qual mensagem esta atividade nasceu.
  const [messageOrigin, setMessageOrigin] = useState<ActivityMessageOrigin | null>(null);
  const [originChatOpen, setOriginChatOpen] = useState(false);
  useEffect(() => {
    if (!open || !activityId) { setMessageOrigin(null); return; }
    let cancelled = false;
    loadActivityMessageOrigin(activityId)
      .then(origin => { if (!cancelled) setMessageOrigin(origin); })
      // Ficha funciona sem isso — só perde o atalho pra conversa.
      .catch(e => console.warn('[ActivityFullSheet] origem da atividade indisponível:', e));
    return () => { cancelled = true; };
  }, [open, activityId]);

  // ---- Form state (mesmo conjunto do formulário completo) ----
  const [formTitle, setFormTitle] = useState('');
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [aiConflicts, setAiConflicts] = useState<AIFieldConflict[]>([]);
  const [aiMergeOpen, setAiMergeOpen] = useState(false);
  const [aiMergeOrigin, setAiMergeOrigin] = useState<AIFieldOrigin>('áudio');

  const [formType, setFormType] = useState('');
  const [formStatus, setFormStatus] = useState('pendente');
  const [formPriority, setFormPriority] = useState('normal');
  // Previsão de tempo (min). `estimateTouchedRef` distingue "o assessor escolheu"
  // de "veio da sugestão" — trocar o tipo só re-sugere enquanto ninguém mexeu.
  const [formEstimatedMinutes, setFormEstimatedMinutesState] = useState<number | null>(null);
  const estimateTouchedRef = useRef(false);
  const setFormEstimatedMinutes = useCallback((v: number | null) => {
    estimateTouchedRef.current = true;
    setFormEstimatedMinutesState(v);
  }, []);
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
  // Responsáveis (Cloud UUID) da atividade como ela foi carregada — base para saber
  // se EU passei a atividade para outra pessoa e oferecer ficar como observador.
  const initialResponsiblesRef = useRef<string[]>([]);
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
  const [financeOpen, setFinanceOpen] = useState(false);
  const [callRecorderOpen, setCallRecorderOpen] = useState(false);
  const [docUploadOpen, setDocUploadOpen] = useState(false);
  const [searchedLeads, setSearchedLeads] = useState<{ id: string; lead_name: string | null }[]>([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [caseSearch, setCaseSearch] = useState('');

  const { types: activityTypes } = useActivityTypes();
  const { user } = useAuthContext();
  const { boards: allBoards } = useKanbanBoards();
  const workflowOptions = allBoards.filter(b => b.board_type === 'workflow' && !isBoardArchived(b)).map(b => ({ id: b.id, name: b.name }));
  const profiles = useProfilesList();
  // Desativados na aba Times somem do seletor de assessor (filterAssignableMembers).
  useInactiveUserIds();
  const { fields: fieldSettings, updateField: updateFieldSetting, reorderFields } = useActivityFieldSettings();
  const { createActivity, updateActivity, completeActivity, deleteActivity } = useLeadActivities();
  const { startTimer, requestLeave, stopTimerFor, current: runningTimer } = useActivityTimer();
  const { ask: askKeepAsObserver, dialog: keepAsObserverDialog } = useKeepAsObserverPrompt();
  const { ask: askEstimate, dialog: estimateConfirmDialog } = useEstimateConfirmPrompt();

  // Previsão sugerida (mediana real do tipo) e tempo já gasto na atividade.
  const { ready: estimateReady, suggestFor: suggestEstimateFor, samplesFor: estimateSamplesFor } = useEstimateSuggestion();
  const { spentSeconds, refreshSpent } = useActivitySpentSeconds(activityId, open && !isCreate);
  // Cronômetro rodando NESTA atv: o total do banco só é gravado de tempos em
  // tempos, então o contador ao vivo é o piso do que já foi gasto.
  const liveSpentSeconds = Math.max(
    spentSeconds,
    runningTimer?.kind === 'activity' && runningTimer.activityId === activityId ? runningTimer.activeSeconds : 0,
  );

  // Criação: sugere a previsão pelo tipo escolhido enquanto o assessor não mexer
  // no campo. Trocar o tipo re-sugere; escolher um valor congela a escolha.
  useEffect(() => {
    if (!open || !isCreate || !estimateReady || estimateTouchedRef.current) return;
    setFormEstimatedMinutesState(suggestEstimateFor(formType));
  }, [open, isCreate, estimateReady, formType, suggestEstimateFor]);

  // Cronômetro parou nesta atv → relê o total gravado (o contador ao vivo zera).
  const timerWasRunningRef = useRef(false);
  useEffect(() => {
    const running = runningTimer?.kind === 'activity' && runningTimer.activityId === activityId;
    if (timerWasRunningRef.current && !running) void refreshSpent();
    timerWasRunningRef.current = running;
  }, [runningTimer?.kind, runningTimer?.activityId, activityId, refreshSpent]);

  // Board dos "Modelos do passo"/checklist: POP escolhido na atividade tem
  // prioridade (mesma regra do activeStepBoardId da ActivitiesPage); senão
  // workflow do processo; senão funil do lead
  const linkedProcess = formProcessId ? caseProcesses.find(p => p.id === formProcessId) : null;
  // Caso/processo vivos para o rótulo do vínculo (o snapshot de título pode ser nulo)
  const { linkedCase, linkedProcess: linkedProcessLive } = useLinkedCaseProcess({
    caseId: formCaseId, processId: formProcessId, caseProcesses, leadCases,
  });
  const stepBoardId = formWorkflowId || linkedProcess?.workflow_id || leadPreview?.board_id || null;
  const { stepContext, saveStepFieldTemplates, selectedStepId, setSelectedStepId } = useActivityStepContext(formLeadId || null, stepBoardId);

  // Herda o POP do processo vinculado quando a atividade não tem um próprio
  // (paridade com a ActivitiesPage). Sem isso o campo ficava vazio e vermelho
  // enquanto a barra de progresso já mostrava as fases do POP do processo.
  // Só preenche quando está vazio — escolha manual do usuário não é sobrescrita.
  useEffect(() => {
    if (formWorkflowId) return;
    if (linkedProcess?.workflow_id) setFormWorkflowId(linkedProcess.workflow_id);
  }, [linkedProcess?.workflow_id, formWorkflowId]);

  // Rotina do assessor selecionado (ou do usuário logado, se nenhum) — usada pra
  // filtrar o seletor de TIPO. `user_timeblock_settings` guarda user_id em UUID do
  // Cloud, mesmo namespace de formAssignedTo (remapToCloud) e de user.id.
  const { configs: assigneeRoutine } = useTimeBlockSettings(formAssignedTo || user?.id || undefined);

  // Só mostra os tipos que estão na rotina do assessor (paridade com a
  // ActivitiesPage). Sem rotina: cai nos tipos-base jurídicos, não em todos os
  // tipos custom do sistema. "Reunião" fura o filtro apenas em atividade interna.
  const routineActivityTypes = useMemo(() => {
    const routineKeys = new Set(assigneeRoutine.map(c => c.activityType));
    const list = assigneeRoutine.length === 0
      ? BASE_ACTIVITY_TYPES.map(t => ({ value: t.value, label: t.label }))
      : activityTypes.filter(t => routineKeys.has(t.key)).map(t => ({ value: t.key, label: t.label }));
    if (formIsSystem && !list.some(t => isMeetingType(t.value, t.label))) {
      const meetings = activityTypes.filter(t => isMeetingType(t.key, t.label));
      const meeting = meetings.find(t => t.key !== 'reuniao') ?? meetings[0];
      if (meeting) list.push({ value: meeting.key, label: meeting.label });
    }
    // O tipo já selecionado (rascunho da IA ou atividade existente) fura o filtro
    // da rotina — senão o select renderiza vazio mesmo com formType preenchido.
    if (formType && !list.some(t => t.value === formType)) {
      const cur = activityTypes.find(t => t.key === formType);
      if (cur) list.push({ value: cur.key, label: cur.label });
    }
    return list;
  }, [assigneeRoutine, activityTypes, formIsSystem, formType]);
  // Só quem pode receber atividade. `profiles` cru continua sendo usado abaixo
  // para resolver nome de quem já consta no histórico.
  const teamMembers = filterAssignableMembers(profiles).map(p => ({ user_id: p.user_id, full_name: p.full_name }));

  // ---- Mensagem da atividade (Copiar / Enviar ao Grupo / Enviar ao Assessor / áudio) ----
  // Mesma função da ActivitiesPage: a ficha é a mesma em qualquer tela que a abra.
  const { getTemplateForContext } = useActivityMessageTemplates();
  const systemOabs = useSystemOabs();
  const resolveUserName = useCallback((userId: string | null) => {
    if (!userId) return null;
    const direct = teamMembers.find(m => m.user_id === userId)?.full_name;
    if (direct) return direct;
    const cloudId = remapToCloudSync(userId);
    if (cloudId && cloudId !== userId) {
      const viaRemap = teamMembers.find(m => m.user_id === cloudId)?.full_name;
      if (viaRemap) return viaRemap;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  // Badges "N atv" ao lado de Prazo/Notificação: quantas atividades abertas o
  // assessor já tem naquele dia (mesma consulta da tela de Atividades).
  const [deadlineDateCount, setDeadlineDateCount] = useState<number | null>(null);
  const [notifDateCount, setNotifDateCount] = useState<number | null>(null);
  useEffect(() => {
    const fetchDateCount = async (date: string, setter: (v: number | null) => void) => {
      if (!date || !formAssignedTo) { setter(null); return; }
      // lead_activities vive no Externo e assigned_to guarda UUID do Externo;
      // formAssignedTo é do Cloud — precisa remapear antes de filtrar.
      const extAssignedTo = await remapToExternal(formAssignedTo);
      if (!extAssignedTo) { setter(null); return; }
      const dayStr = date.length >= 10 ? date.slice(0, 10) : date;
      const { count, error } = await externalSupabase
        .from('lead_activities')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', extAssignedTo)
        .neq('status', 'concluida')
        .eq('deadline', dayStr);
      if (!error) setter(count ?? 0);
    };
    fetchDateCount(formDeadline, setDeadlineDateCount);
    // Notificação mostra a mesma ocupação do dia (contagem por `deadline`).
    fetchDateCount(formNotificationDate, setNotifDateCount);
  }, [formDeadline, formNotificationDate, formAssignedTo]);

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
    // Atividade antiga não tem previsão: fica "sem previsão" e o assessor decide.
    // Não sugerimos em cima do que já existe pra não inventar meta retroativa.
    estimateTouchedRef.current = true;
    setFormEstimatedMinutesState(act.estimated_minutes ?? null);
    setFormDeadline(act.deadline || '');
    // Atividades auto-criadas (onboarding, "Dar andamento") nascem sem
    // notification_date, e o Salvar exige o campo — sem o fallback, nenhuma
    // edição (inclusive vincular lead/caso) persistia nelas.
    setFormNotificationDate(act.notification_date || act.deadline || '');
    // meeting_at é timestamptz; datetime-local espera YYYY-MM-DDTHH:mm
    setFormMeetingAt((((act as any).meeting_at as string | null) || '').slice(0, 16));
    setFormCallbackAt((act as any).callback_at ? format(parseISO((act as any).callback_at), "yyyy-MM-dd'T'HH:mm") : '');
    const assignedCloud = ((await remapToCloud(act.assigned_to)) as string) || '';
    setFormAssignedTo(assignedCloud);
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
      const cloudIds = await Promise.all(extIds.map((id) => remapToCloud(id)));
      const co = cloudIds
        .map((cid, i) => ({ user_id: (cid as string) || '', full_name: extNames[i] || '' }))
        .filter((c) => c.user_id && c.user_id !== assignedCloud);
      setFormCoAssignees(co);
      setLoadedHadCoAssignees(true);
      initialResponsiblesRef.current = [assignedCloud, ...co.map(c => c.user_id)].filter(Boolean);
    } else {
      setFormCoAssignees([]);
      setLoadedHadCoAssignees(false);
      initialResponsiblesRef.current = [assignedCloud].filter(Boolean);
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
    // Criação: previsão nasce da sugestão (mediana do tipo) — o efeito abaixo
    // preenche assim que as medianas chegam.
    estimateTouchedRef.current = false;
    setFormEstimatedMinutesState(null);
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
    setFormIsManagement(!!d.is_management);
    setFormWhatWasDone(draftRichText(d.what_was_done));
    setFormCurrentStatus(draftRichText(d.current_status_notes));
    setFormNextSteps(draftRichText(d.next_steps));
    setFormSolicitacao(draftRichText(d.solicitacao));
    setFormRespostaJuizo(draftRichText(d.resposta_juizo));
    setFormNotes(draftRichText(d.notes));
    setFormCoAssignees([]); setLoadedHadCoAssignees(false);
    setFormObservers(d.observers || []); setLoadedHadObservers(false);
    initialResponsiblesRef.current = [];
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
      estimateTouchedRef.current = false; // próxima criação volta a aceitar sugestão
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
          // Previsão da atividade vira a previsão da sessão (gatilho de urgência).
          estimated_minutes: selectedActivity.estimated_minutes ?? null,
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
    // Fechar a ficha fecha junto a ficha da cadeia aberta ao lado — senão ela
    // ficaria órfã na tela, sem a origem por trás.
    setChainOpenId(null);
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

  // `extraObserver` entra quando o usuário aceita continuar acompanhando a
  // atividade que acabou de passar para outra pessoa.
  const buildPayload = (extraObserver?: { user_id: string; full_name: string } | null) => ({
    title: formTitle,
    description: null as string | null,
    what_was_done: formWhatWasDone || null,
    current_status_notes: formCurrentStatus || null,
    next_steps: formNextSteps || null,
    solicitacao: formSolicitacao || null,
    resposta_juizo: formRespostaJuizo || null,
    activity_type: formType,
    priority: formPriority,
    estimated_minutes: formEstimatedMinutes ?? null,
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
    // Retorno agendado: só entra quando MUDOU. Não existe callback_notified_at
    // no Externo (o comentário antigo prometia esse carimbo); o ganho real é
    // não reescrever a coluna a cada save. Campo limpo vira null aqui, então
    // dá para desmarcar o retorno.
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
    ...(() => {
      const list = extraObserver && !formObservers.some(o => o.user_id === extraObserver.user_id)
        ? [...formObservers, extraObserver]
        : formObservers;
      if (list.length === 0 && !loadedHadObservers) return {};
      return {
        observer_ids: list.map(o => o.user_id),
        observer_names: list.map(o => o.full_name),
      };
    })(),
  });

  // Gera o assunto por IA a partir dos campos de detalhe (paridade com a
  // ActivitiesPage). Usado na criação quando o usuário deixa o assunto em branco
  // mas preencheu situação/o que foi feito/próximo passo etc.
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
      const { data, error } = await authClient.functions.invoke('ai-text-editor', {
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

  // Renomear o assunto sob demanda: a IA reescreve o título como "o que precisa
  // ser feito", priorizando o Próximo passo preenchido e o passo atual do fluxo.
  // Diferente da generateTitleWithAI (que só resume "do que se trata"), aqui o
  // título é de AÇÃO. Não salva sozinho — só popula o campo; o usuário revisa.
  const handleRenameWithAI = async () => {
    const strip = (s: string) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    setRenamingTitle(true);
    const loadingId = toast.loading('Renomeando com IA...');
    try {
      const nextFlowStep = stepContext ? (() => {
        const steps = stepContext.allSteps || [];
        const idx = steps.findIndex((s) => s.stepId === stepContext.stepId);
        const after = idx >= 0 ? steps.slice(idx + 1) : steps;
        return (after.find((s) => !s.checked) || after[0])?.stepLabel;
      })() : undefined;
      const { data } = await routedFunctions.invoke('generate-activity-title', {
        body: {
          fields: {
            what_was_done: strip(formWhatWasDone) || undefined,
            current_status: strip(formCurrentStatus) || undefined,
            next_steps: strip(formNextSteps) || undefined,
            notes: strip(formNotes) || undefined,
          },
          context: {
            process_title: formProcessTitle || undefined,
            case_title: formCaseTitle || undefined,
            lead_name: formLeadName || undefined,
            current_title: formTitle || undefined,
            activity_type: formType || undefined,
          },
          step: stepContext ? {
            step_label: stepContext.stepLabel,
            phase_label: stepContext.phaseLabel || undefined,
            next_step: nextFlowStep,
          } : undefined,
        },
      });
      toast.dismiss(loadingId);
      if (data?.success && data.title) {
        // Com assunto já escrito, a sugestão passa pelo diálogo: o botão fica ao
        // lado do "Preencher com" e um clique sem querer trocava o título do
        // usuário por um gerado a partir do conteúdo, calado.
        if (formTitle.trim() && data.title.trim() !== formTitle.trim()) {
          setAiConflicts([{
            key: 'title',
            label: AI_FIELD_LABELS.title,
            current: formTitle.trim(),
            incoming: data.title.trim(),
            defaultChecked: false,
          }]);
          setAiMergeOrigin('renomear');
          setAiMergeOpen(true);
        } else {
          setFormTitle(data.title);
          toast.success('Assunto renomeado. Revise e salve.');
        }
      } else {
        toast.error(data?.error || 'Não foi possível gerar o assunto — preencha o próximo passo/contexto.');
      }
    } catch (e) {
      toast.dismiss(loadingId);
      console.error('[renomear-com-ia]', e);
      toast.error('Erro ao renomear com IA.');
    } finally {
      setRenamingTitle(false);
    }
  };

  // ── Resposta da IA (áudio da ligação / documento anexado) → formulário ─────
  // As duas funções declaram os 6 campos de detalhe como `required` no schema:
  // a IA devolve todos em toda chamada, mesmo sem o áudio/documento falar deles.
  // Aplicar tudo direto reescrevia o texto do usuário sem avisar. Agora campo
  // vazio a IA preenche à vontade e campo preenchido passa pelo diálogo.
  const applyAIFieldValues = (f: Partial<Record<AIReviewedField, string>>) => {
    if (f.title !== undefined && f.title) setFormTitle(f.title);
    if (f.what_was_done !== undefined) setFormWhatWasDone(f.what_was_done ? callFieldTextToHtml(f.what_was_done) : '');
    if (f.current_status !== undefined) setFormCurrentStatus(f.current_status ? callFieldTextToHtml(f.current_status) : '');
    if (f.next_steps !== undefined) setFormNextSteps(f.next_steps ? callFieldTextToHtml(f.next_steps) : '');
    if (f.solicitacao !== undefined) setFormSolicitacao(f.solicitacao ? callFieldTextToHtml(f.solicitacao) : '');
    if (f.resposta_juizo !== undefined) setFormRespostaJuizo(f.resposta_juizo ? callFieldTextToHtml(f.resposta_juizo) : '');
    if (f.notes !== undefined) setFormNotes(f.notes ? callFieldTextToHtml(f.notes) : '');
  };

  const handleAIFields = (f: ActivityCallFields, origin: 'áudio' | 'documento') => {
    const { autoApply, conflicts } = splitAIFields(f, {
      title: formTitle,
      what_was_done: stripHtmlToText(formWhatWasDone),
      current_status: stripHtmlToText(formCurrentStatus),
      next_steps: stripHtmlToText(formNextSteps),
      solicitacao: stripHtmlToText(formSolicitacao),
      resposta_juizo: stripHtmlToText(formRespostaJuizo),
      notes: stripHtmlToText(formNotes),
    });

    applyAIFieldValues(autoApply);

    // Metadados objetivos seguem aplicados direto — ficam visíveis no formulário.
    if (autoApply.deadline && /^\d{4}-\d{2}-\d{2}$/.test(autoApply.deadline)) handleDeadlineChange(autoApply.deadline);
    if (autoApply.notification_date && /^\d{4}-\d{2}-\d{2}$/.test(autoApply.notification_date)) setFormNotificationDate(autoApply.notification_date);
    if (autoApply.priority && ['baixa', 'normal', 'alta', 'urgente'].includes(autoApply.priority)) setFormPriority(autoApply.priority);
    if (autoApply.status && ['pendente', 'em_andamento', 'concluida'].includes(autoApply.status)) setFormStatus(autoApply.status);
    if (autoApply.activity_type) {
      const t = routineActivityTypes.find((x) => x.value === autoApply.activity_type);
      if (t && t.value !== formType) {
        setFormType(t.value);
        toast.info(`Tipo ajustado pela IA para ${t.label}.`, { duration: 2500 });
      }
    }

    // Assessores designados: o 1º vira o principal, os demais co-assessores.
    const spokenNames = (autoApply.assessor_names && autoApply.assessor_names.length > 0)
      ? autoApply.assessor_names
      : (autoApply.assessor_name ? [autoApply.assessor_name] : []);
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
        toast.error(`Assessor(es) citado(s) no ${origin} não encontrado(s) na equipe: ${notFound.join(', ')}.`);
      }
    }

    if (conflicts.length > 0) {
      setAiConflicts(conflicts);
      setAiMergeOrigin(origin);
      setAiMergeOpen(true);
    }
  };

  const handleSave = async () => {
    let titleToUse = formTitle.trim();
    // Na criação, o assunto pode vir vazio se houver detalhes para a IA resumir.
    const hasContentForAI =
      !!(formWhatWasDone || formCurrentStatus || formNextSteps || formSolicitacao || formRespostaJuizo || formNotes);

    if (!titleToUse && !(isCreate && hasContentForAI)) { toast.error('Informe o assunto'); return; }
    if (!formAssignedTo) { toast.error('Selecione o assessor'); return; }
    if (!formDeadline) { toast.error('Informe o prazo'); return; }
    if (!formNotificationDate) { toast.error('Informe a data de notificação'); return; }

    if (isCreate) {
      // Sem assunto mas com detalhes → gera o assunto por IA antes de criar.
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
      // Confirmação da previsão antes de criar: a sugestão acerta o caso comum,
      // mas quem executa é quem sabe se ESTA atividade foge da média. Sem a
      // parada, o número viraria enfeite e o gasto x previsto perderia sentido.
      const estimateChoice = await askEstimate({
        current: formEstimatedMinutes,
        typeLabel: activityTypes.find(t => t.key === formType)?.label || null,
        samples: estimateSamplesFor(formType),
      });
      if (!estimateChoice.confirmed) {
        // Mesmo silêncio do Salvar: sair do pop-up cancelava a criação sem
        // nenhum aviso, com a ficha preenchida parecendo salva. 14/08/2026.
        toast.warning('Atividade NÃO criada — a previsão de tempo não foi confirmada. O formulário continua preenchido.', { duration: 8000 });
        return;
      }
      setFormEstimatedMinutesState(estimateChoice.minutes);

      setSaving(true);
      // `estimated_minutes` vem do diálogo, não do state: setState é assíncrono e
      // o payload sairia com o valor anterior.
      const payload = {
        ...buildPayload(),
        title: titleToUse,
        estimated_minutes: estimateChoice.minutes,
      } as Partial<LeadActivity> & { observer_ids?: string[]; observer_names?: string[] };
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
        onCreated?.(created as LeadActivity);
        onOpenChange(false);
      }
      return;
    }

    if (!activityId) return;

    // Passei a atividade que era minha para outra pessoa? Ofereço ficar como
    // observador — é o que mantém ela no meu funil de Feedback e me avisa do retorno.
    let extraObserver: { user_id: string; full_name: string } | null = null;
    if (shouldAskKeepAsObserver({
      myUserId: user?.id,
      previousResponsibles: initialResponsiblesRef.current,
      formAssignedTo, formCoAssignees, formObservers,
    })) {
      const keep = await askKeepAsObserver(formAssignedToName);
      if (keep) {
        const myName = teamMembers.find(m => m.user_id === user!.id)?.full_name || '';
        extraObserver = { user_id: user!.id, full_name: myName };
      }
    }

    // Atividade sem previsão (nasceu antes deste campo) pergunta ao salvar. Com
    // previsão já definida, salvar não vira interrogatório — o campo está na tela.
    let estimateToSave = formEstimatedMinutes ?? null;
    if (estimateToSave == null) {
      const choice = await askEstimate({
        current: null,
        typeLabel: activityTypes.find(t => t.key === formType)?.label || null,
        samples: estimateSamplesFor(formType),
      });
      if (!choice.confirmed) {
        // Fechar este pop-up descartava a edição em silêncio (inclusive uma
        // troca de prazo), sem toast e sem deixar rastro no audit log — o
        // UPDATE nunca chegava a acontecer. 14/08/2026.
        toast.warning('Alterações NÃO salvas — a previsão de tempo não foi confirmada. O formulário continua com o que você digitou.', { duration: 8000 });
        return;
      }
      estimateToSave = choice.minutes;
      setFormEstimatedMinutesState(choice.minutes);
    }

    setSaving(true);
    await updateActivity(activityId, {
      ...buildPayload(extraObserver),
      estimated_minutes: estimateToSave,
    } as Partial<LeadActivity>);
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

  /**
   * Adiar sem concluir e sem criar filha — mesmo caminho da ActivitiesPage. Não
   * fecha a ficha: adiar não é sair da atividade. O bloqueio por ausência
   * registrada mora no `updateActivity`, que devolve `false` com o motivo.
   */
  const handlePostpone = async (dateStr: string) => {
    if (!activityId) return;
    const ok = await updateActivity(
      activityId,
      { deadline: dateStr, notification_date: dateStr } as any,
      { successMessage: null },
    );
    if (!ok) return;
    toast.success(`Adiada para ${formatPostponeDate(dateStr)}`);
    // Formulário sincronizado: sem isto, um Salvar depois regravaria o prazo antigo.
    setFormDeadline(dateStr);
    setFormNotificationDate(dateStr);
    setSelectedActivity(prev => prev ? ({ ...prev, deadline: dateStr, notification_date: dateStr } as any) : prev);
    onUpdated?.();
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

  /**
   * Abre a conversa do WhatsApp na mensagem que gerou esta atividade — no painel
   * de baixo, por cima da ficha, sem tirar a pessoa da tela (skill
   * `ui-sem-redirecionar`). Fechar devolve a ficha exatamente como estava.
   */
  const handleOpenOriginMessage = () => {
    if (!messageOrigin?.phone) return;
    setOriginChatOpen(true);
  };

  /** Mensagem da atividade — idêntica à da tela de Atividades (função compartilhada). */
  const buildMsg = (audience: 'client' | 'assessor' = 'client') =>
    buildActivityMessage({
      formTitle, formDeadline, formNotificationDate,
      formWhatWasDone, formCurrentStatus, formNextSteps, formSolicitacao, formRespostaJuizo, formNotes,
      formAssignedToName, formCoAssignees, formIsSystem, formClientNameOverride, formLeadName,
      formCaseTitle, formProcessId, formProcessTitle,
      fieldSettings, selectedActivity, caseProcesses, stepContext, leadPreview, systemOabs,
      currentUserId: user?.id || null, resolveUserName, getTemplateForContext,
    }, audience);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <SheetContent side={side} className={cn('w-full sm:max-w-2xl flex flex-col p-0', contentClassName)}>
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle
              className="text-base font-semibold leading-snug line-clamp-2 flex-1 min-w-0"
              title={formTitle || undefined}
            >
              {formTitle || (isCreate ? 'Nova atividade' : 'Atividade')}
              {/* Tempo gasto x previsto, ao lado do assunto: quem abre a atividade
                  já vê quanto ela custou até agora sem descer até o formulário.
                  Fica no fluxo do texto (inline) pra não cobrir o título. */}
              {!isCreate && (liveSpentSeconds > 0 || !!formEstimatedMinutes) && (() => {
                const estSec = (formEstimatedMinutes || 0) * 60;
                const over = estSec > 0 && liveSpentSeconds > estSec;
                const near = estSec > 0 && !over && liveSpentSeconds >= estSec * 0.8;
                return (
                  <span
                    className={cn(
                      'ml-2 align-middle inline-flex items-center gap-1 text-[11px] font-mono tabular-nums font-normal rounded px-1.5 py-0.5',
                      over
                        ? 'bg-destructive/10 text-destructive'
                        : near
                          ? 'bg-warning/15 text-warning'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                    )}
                    title={
                      formEstimatedMinutes
                        ? `Tempo gasto nesta atividade (todas as sessões) x previsão de ${formatEstimate(formEstimatedMinutes)}`
                        : 'Tempo gasto nesta atividade (todas as sessões). Sem previsão definida.'
                    }
                  >
                    ⏱️ {formatSpent(liveSpentSeconds)}
                    {formEstimatedMinutes ? ` / ${formatEstimate(formEstimatedMinutes)}` : ''}
                    {over ? ` (+${formatSpent(liveSpentSeconds - estSec)})` : ''}
                  </span>
                );
              })()}
            </SheetTitle>
            <div className="flex items-center gap-1">
              {/* Renomear o assunto com IA (título de ação a partir do próximo passo + fluxo) */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={handleRenameWithAI}
                disabled={renamingTitle}
                title="Renomear o assunto com IA, a partir do próximo passo e do contexto"
              >
                {renamingTitle ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Renomear
              </Button>
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

              {/* Despesa/receita lançada de dentro da atividade. Grava já vinculada
                  ao processo/caso/lead da própria atividade, então o lançamento
                  aparece sozinho na aba Financeiro do processo e na do lead —
                  não precisa mais abrir a ficha do lead só para registrar custa. */}
              {!isCreate && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 shrink-0"
                  onClick={() => setFinanceOpen(true)}
                  title="Registrar despesa/receita desta atividade"
                >
                  <DollarSign className="h-3 w-3" />
                  Financeiro
                </Button>
              )}

              {/* Movimentações DESTE processo, sem passar pelo sino global e sem
                  sair da ficha: o sino carrega as 100 mais recentes de todo
                  mundo, então o processo desta atividade pode nem estar lá. */}
              {formProcessId && (
                <ProcessUpdatesBell
                  processId={formProcessId}
                  processLabel={displayProcessLabel(linkedProcess || linkedProcessLive, formProcessTitle) || null}
                />
              )}

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
                onFields={(f) => handleAIFields(f, 'áudio')}
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
                onFields={(f) => handleAIFields(f, 'documento')}
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
            {/* Vínculo já preenchido permite Trocar (lápis) e Remover (X): atividades
                auto-criadas chegam com lead/caso/processo errados e antes não havia
                como corrigir — o badge era estático. A remoção só persiste no Salvar. */}
            {formLeadName ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[260px]">
                <Building2 className="h-3 w-3 shrink-0" /><span className="truncate">{formLeadName}</span>
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary" title="Trocar lead"
                  onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-lead'))}>
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-destructive" title="Remover vínculo de lead"
                  onClick={() => { setFormLeadId(''); setFormLeadName(''); }}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-lead'))}>
                <Plus className="h-3 w-3" /> Vincular Lead
              </Button>
            )}
            {/* Vínculo aparece pelo *id*, não pelo snapshot de título: atividade
                auto-criada grava case_id/process_id com título nulo e a badge
                sumia, mostrando "Vincular Caso" onde já havia caso vinculado. */}
            {(formCaseId || formCaseTitle) ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[260px]">
                <Briefcase className="h-3 w-3 shrink-0" />
                <span className="truncate" title={displayCaseLabel(linkedCase, formCaseTitle) || 'Caso vinculado'}>
                  {displayCaseLabel(linkedCase, formCaseTitle) || 'Caso vinculado'}
                </span>
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary" title="Trocar caso"
                  onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-case'))}>
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-destructive" title="Remover vínculo de caso (remove também o processo)"
                  onClick={() => { setFormCaseId(''); setFormCaseTitle(''); setFormProcessId(''); setFormProcessTitle(''); setCaseProcesses([]); }}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-case'))}>
                <Briefcase className="h-3 w-3" /> Vincular Caso
              </Button>
            )}
            {(formProcessId || formProcessTitle) ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[260px]">
                {/* Rótulo vem do processo vivo, não do snapshot `process_title`:
                    atividades auto-criadas nasciam só com o título e mostravam
                    "INDENIZAÇÃO" no lugar do nº do processo. */}
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate" title={displayProcessLabel(linkedProcess || linkedProcessLive, formProcessTitle) || 'Processo vinculado'}>
                  {displayProcessLabel(linkedProcess || linkedProcessLive, formProcessTitle) || 'Processo vinculado'}
                </span>
                {formCaseId && (
                  <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary" title="Trocar processo"
                    onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-process'))}>
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                )}
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-destructive" title="Remover vínculo de processo"
                  onClick={() => { setFormProcessId(''); setFormProcessTitle(''); }}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ) : formCaseId ? (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-process'))}>
                <FileText className="h-3 w-3" /> Vincular Processo
              </Button>
            ) : null}
            {/* Benefício INSS: perícia médica e perícia social. Mesmo cabeçalho da
                tela de Atividades — a data mora no processo, não na atividade. */}
            <PericiaInssChips
              processId={formProcessId}
              processTitle={(linkedProcess || linkedProcessLive)?.title || formProcessTitle}
            />
            {/* Em que altura está o processo desta atividade. Antes era preciso
                sair da tela pra saber se já tinha sentença. */}
            {formProcessId && (
              <div className="w-full mt-1">
                <ProcessMarcosInline
                  processId={formProcessId}
                  processNumber={(linkedProcess as any)?.process_number}
                />
              </div>
            )}
            {formContactName ? (
              <Badge variant="outline" className="text-[10px] gap-1 max-w-[220px]">
                <UserPlus className="h-3 w-3 shrink-0" /><span className="truncate">{formContactName}</span>
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-primary" title="Trocar contato"
                  onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-contact'))}>
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                <button type="button" className="shrink-0 p-0.5 rounded hover:bg-muted hover:text-destructive" title="Remover vínculo de contato"
                  onClick={() => { setFormContactId(''); setFormContactName(''); }}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={() => window.dispatchEvent(new CustomEvent('activity-form:open-link-contact'))}>
                <UserPlus className="h-3 w-3" /> Vincular Contato
              </Button>
            )}
            {/* Nasceu de uma mensagem do WhatsApp: atalho de volta pra conversa,
                com a bolha de origem destacada. */}
            {messageOrigin?.phone && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1 border-green-600/40 text-green-700 dark:text-green-400 hover:bg-green-600/10"
                onClick={handleOpenOriginMessage}
                title={`Abrir aqui a conversa do WhatsApp na mensagem que gerou esta atividade${messageOrigin.total > 1 ? ` (${messageOrigin.total} mensagens de origem)` : ''}`}
              >
                <MessageSquare className="h-3 w-3" /> Ver mensagem de origem
              </Button>
            )}
          </div>

          {/* Fluxo de trabalho: POP da atividade > workflow do processo > funil do lead
              `processId` NÃO é opcional quando a atividade tem processo: sem ele a
              barra não carrega a régua de marcos (useProcessoMarcos(null) volta vazio)
              e cai no percentual de PASSOS EXECUTADOS. Era por isso que o caso 88
              aparecia como "Pré-Processual · 8%" na atividade e "Execução iniciada ·
              80%" na carteira — mesma régua, duas medidas diferentes na tela. */}
          {formLeadId && (() => {
            if (formWorkflowId) {
              return <LeadFunnelProgressBar leadId={formLeadId} boardId={formWorkflowId} activityId={activityId} processId={formProcessId || null} />;
            }
            if (formProcessId) {
              if (linkedProcess?.workflow_id) {
                return <LeadFunnelProgressBar leadId={formLeadId} boardId={linkedProcess.workflow_id} activityId={activityId} processId={formProcessId} />;
              }
              return (
                <p className="text-[10px] text-muted-foreground italic">
                  Processo sem POP vinculado — cadastre um POP no processo para ver o progresso.
                </p>
              );
            }
            if (leadPreview?.lead_status !== 'closed' && leadPreview?.board_id) {
              return <LeadFunnelProgressBar leadId={formLeadId} boardId={leadPreview.board_id} activityId={activityId} />;
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
          <Tabs defaultValue="atividade" className="flex-1 flex flex-col min-h-0">
            {/* Aba de continuidade: só existe em atividade já criada. Fica
                sempre visível (mesmo sem cadeia ainda) pra quem abre a ficha
                saber que dá pra caminhar pelas atividades da sequência. */}
            {!isCreate && (
              <TabsList className="mx-4 mt-2 h-8 shrink-0 self-start">
                <TabsTrigger value="atividade" className="h-6 text-xs">Atividade</TabsTrigger>
                <TabsTrigger value="historico" className="h-6 text-xs gap-1">
                  Histórico
                  {chain.items.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">
                      {chain.items.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            )}

          <ScrollArea className="flex-1">
            {/* forceMount: o formulário NUNCA desmonta ao trocar de aba —
                desmontar perderia o estado interno de busca/editor e faria a
                ficha recarregar do zero na volta. */}
            <TabsContent value="atividade" forceMount className="mt-0 data-[state=inactive]:hidden">
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
                formEstimatedMinutes={formEstimatedMinutes} setFormEstimatedMinutes={setFormEstimatedMinutes}
                spentSeconds={liveSpentSeconds}
                estimateSamples={isCreate ? estimateSamplesFor(formType) : 0}
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
                funnelOptions={allBoards.filter(b => b.board_type === 'funnel' && !isBoardArchived(b)).map(b => ({ id: b.id, name: b.name }))}
                inheritedFlowName={leadPreview?.board_id
                  ? (allBoards.find(b => b.id === leadPreview.board_id)?.name || 'fluxo do lead')
                  : null}
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
                aiSuggestingType={false}
                buildMsg={buildMsg}
                activeRoutine={assigneeRoutine}
                formAssignedToName={formAssignedToName}
                formLeadIdForTTS={formLeadId || undefined}
                formContactIdForTTS={formContactId || undefined}
                supabase={externalSupabase}
                leads={searchedLeads}
              />
            </div>
            </TabsContent>

            <TabsContent value="historico" className="mt-0">
              <div className="p-4">
                <ActivityChainPanel
                  currentActivityId={activityId}
                  items={chain.items}
                  loading={chain.loading}
                  unavailable={chain.unavailable}
                  onOpenActivity={setChainOpenId}
                />
              </div>
            </TabsContent>
          </ScrollArea>
          </Tabs>
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
                <PostponeActivityPopover
                  currentDeadline={selectedActivity?.deadline}
                  onPostpone={handlePostpone}
                />
              )}
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

      {/* Outra atividade da MESMA cadeia, aberta pela aba Histórico. Entra à
          esquerda pra ficar AO LADO desta ficha, não por cima (skills
          `ui-sem-redirecionar` + `ui-sem-sobreposicao`). Fechar devolve a pessoa
          exatamente à ficha de onde ela saiu, na mesma aba. */}
      {chainOpenId && (
        <ActivityFullSheet
          open
          onOpenChange={(o) => { if (!o) setChainOpenId(null); }}
          activityId={chainOpenId}
          side="left"
          onUpdated={() => { chain.reload(); onUpdated?.(); }}
        />
      )}

      {/* Conversa que gerou a atividade — painel de baixo pra cima, por cima da
          ficha. Fechar devolve a pessoa à ficha, no mesmo lugar. */}
      {messageOrigin?.phone && originChatOpen && (
        <Suspense fallback={null}>
          <DashboardChatPreview
            open={originChatOpen}
            onOpenChange={(o) => { if (!o) setOriginChatOpen(false); }}
            phone={messageOrigin.phone}
            contactName={formContactName || formLeadName || null}
            instanceName={messageOrigin.instance_name}
            highlightMessageId={messageOrigin.message_id}
            hasLead={!!formLeadId}
            hasContact={!!formContactId}
            wasResponded={false}
            responseTimeMinutes={null}
          />
        </Suspense>
      )}

      <Dialog open={financeOpen} onOpenChange={setFinanceOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Financeiro da atividade</DialogTitle>
          </DialogHeader>
          <EntityFinancialsPanel
            scope="activity"
            activityId={activityId}
            linkOptions={buildFinancialLinkOptions({
              processId: formProcessId,
              processLabel: displayProcessLabel(linkedProcess, formProcessTitle),
              caseId: formCaseId,
              caseLabel: formCaseTitle,
              leadId: formLeadId,
              leadLabel: formLeadName,
            })}
            contextLabel="O lançamento fica pendurado no destino escolhido e aparece no financeiro dele."
            listMaxHeight="260px"
          />
        </DialogContent>
      </Dialog>

      <AIFieldMergeDialog
        open={aiMergeOpen}
        onOpenChange={setAiMergeOpen}
        origin={aiMergeOrigin}
        conflicts={aiConflicts}
        onApply={applyAIFieldValues}
      />
      {keepAsObserverDialog}
      {estimateConfirmDialog}
    </Sheet>
  );
}
