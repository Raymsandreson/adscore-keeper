import { useState, useEffect, useCallback, useRef } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToCloud, remapToExternal } from '@/integrations/supabase/uuid-remap';
import { authClient } from '@/integrations/supabase';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Save, Loader2, CheckCircle2, Trash2, ExternalLink, X, Plus, Building2, Briefcase, UserPlus, FileText } from 'lucide-react';
import { ActivityFormCompact } from '@/components/activities/ActivityFormCompact';
import { LeadFunnelProgressBar } from '@/components/activities/LeadFunnelProgressBar';
import { useActivityTypes } from '@/hooks/useActivityTypes';
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
  const [leadPreview, setLeadPreview] = useState<{ board_id: string | null; lead_status: string | null } | null>(null);
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
    const { data } = await externalSupabase.from('leads').select('board_id, lead_status').eq('id', lid).maybeSingle();
    setLeadPreview(data ? { board_id: data.board_id, lead_status: data.lead_status } : null);
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
    setFormDeadline('');
    setFormNotificationDate('');
    setFormAssignedTo('');
    setFormAssignedToName('');
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
  const handleSelectAssignee = (userId: string) => {
    const member = teamMembers.find(m => m.user_id === userId);
    setFormAssignedTo(userId);
    setFormAssignedToName(member?.full_name || '');
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
  });

  const handleSave = async () => {
    if (!formTitle.trim()) { toast.error('Informe o assunto'); return; }
    if (!formAssignedTo) { toast.error('Selecione o assessor'); return; }
    if (!formDeadline) { toast.error('Informe o prazo'); return; }
    if (!formNotificationDate) { toast.error('Informe a data de notificação'); return; }

    if (isCreate) {
      setSaving(true);
      const created = await createActivity(buildPayload() as Partial<LeadActivity>);
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
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base truncate">{formTitle || (isCreate ? 'Nova atividade' : 'Atividade')}</SheetTitle>
            <div className="flex items-center gap-1">
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
                  Processo sem fluxo de trabalho vinculado — cadastre um fluxo no processo para ver o progresso.
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
