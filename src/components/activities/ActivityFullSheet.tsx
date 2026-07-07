import { useState, useEffect, useCallback } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToCloud } from '@/integrations/supabase/uuid-remap';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Save, Loader2, CheckCircle2, Trash2, ExternalLink, X } from 'lucide-react';
import { ActivityFormCompact } from '@/components/activities/ActivityFormCompact';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityStepContext } from '@/hooks/useActivityStepContext';
import { useLeadActivities, type LeadActivity } from '@/hooks/useLeadActivities';

interface ActivityFullSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string | null;
  /** Contexto do lead quando o sheet é aberto de dentro de um lead/caso. */
  leadId?: string | null;
  leadName?: string | null;
  onUpdated?: () => void;
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
export function ActivityFullSheet({ open, onOpenChange, activityId, leadId, leadName, onUpdated }: ActivityFullSheetProps) {
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
  const [formIsSystem, setFormIsSystem] = useState(false);
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
  const [boardId, setBoardId] = useState<string | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [caseSearch, setCaseSearch] = useState('');

  const { types: activityTypes } = useActivityTypes();
  const profiles = useProfilesList();
  const { fields: fieldSettings, updateField: updateFieldSetting, reorderFields } = useActivityFieldSettings();
  const { updateActivity, completeActivity, deleteActivity } = useLeadActivities();
  const { stepContext, saveStepFieldTemplates, selectedStepId, setSelectedStepId } = useActivityStepContext(formLeadId || null, boardId);

  const routineActivityTypes = activityTypes.map(t => ({ value: t.key, label: t.label }));
  const teamMembers = profiles.map(p => ({ user_id: p.user_id, full_name: p.full_name }));
  const leadOptions = formLeadId ? [{ id: formLeadId, lead_name: formLeadName }] : [];
  const availableCases = leadCases.map(c => ({ ...c, lead_id: formLeadId || null }));

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

  const loadBoardId = useCallback(async (lid: string) => {
    const { data } = await externalSupabase.from('leads').select('board_id').eq('id', lid).maybeSingle();
    setBoardId(data?.board_id || null);
  }, []);

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
    setFormIsSystem(!!act.is_system);
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
      loadBoardId(lid);
    }
    if (act.case_id) {
      externalSupabase
        .from('lead_processes')
        .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
        .eq('case_id', act.case_id)
        .then(({ data }) => setCaseProcesses((data as ProcessRow[]) || []));
    }
  }, [activityId, leadId, leadName, loadContactsForLead, loadBoardId]);

  useEffect(() => {
    if (open && activityId) fetchActivity();
    if (!open) { setSelectedActivity(null); setCaseProcesses([]); }
  }, [open, activityId, fetchActivity]);

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
    const opt = leadOptions.find(l => l.id === lid);
    setFormLeadId(lid);
    setFormLeadName(opt?.lead_name || '');
    setFormClientNameOverride('');
    setFormContactId(''); setFormContactName(''); setContactSearch('');
    setFormCaseId(''); setFormCaseTitle('');
    setFormProcessId(''); setFormProcessTitle('');
    setCaseProcesses([]);
    const { data } = await externalSupabase.from('legal_cases').select('id, case_number, title').eq('lead_id', lid);
    setLeadCases((data as CaseRow[]) || []);
    loadContactsForLead(lid);
    loadBoardId(lid);
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
    matrix_quadrant: formMatrixQuadrant || null,
    client_name_override: formClientNameOverride || null,
  });

  const handleSave = async () => {
    if (!activityId) return;
    if (!formTitle.trim()) { toast.error('Informe o assunto'); return; }
    if (!formAssignedTo) { toast.error('Selecione o assessor'); return; }
    if (!formDeadline) { toast.error('Informe o prazo'); return; }
    if (!formNotificationDate) { toast.error('Informe a data de notificação'); return; }
    setSaving(true);
    await updateActivity(activityId, buildPayload() as Partial<LeadActivity>);
    setSaving(false);
    onUpdated?.();
    onOpenChange(false);
  };

  const handleComplete = async () => {
    if (!activityId) return;
    await completeActivity(activityId);
    onUpdated?.();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!activityId) return;
    await deleteActivity(activityId);
    onUpdated?.();
    onOpenChange(false);
  };

  const handleOpenInPage = () => {
    if (activityId) window.open(`${window.location.origin}/?openActivity=${activityId}`, '_blank');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base truncate">{formTitle || 'Atividade'}</SheetTitle>
            <Button variant="ghost" size="sm" onClick={handleOpenInPage} className="gap-1 text-xs shrink-0" title="Abrir na tela de Atividades">
              <ExternalLink className="h-3 w-3" /> Tela cheia
            </Button>
          </div>
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
                formClientNameOverride={formClientNameOverride}
                setFormClientNameOverride={setFormClientNameOverride}
                formIsSystem={formIsSystem} setFormIsSystem={setFormIsSystem}
                formRepeatWeekDays={formRepeatWeekDays} setFormRepeatWeekDays={setFormRepeatWeekDays}
                formWhatWasDone={formWhatWasDone} setFormWhatWasDone={setFormWhatWasDone}
                formCurrentStatus={formCurrentStatus} setFormCurrentStatus={setFormCurrentStatus}
                formNextSteps={formNextSteps} setFormNextSteps={setFormNextSteps}
                formSolicitacao={formSolicitacao} setFormSolicitacao={setFormSolicitacao}
                formRespostaJuizo={formRespostaJuizo} setFormRespostaJuizo={setFormRespostaJuizo}
                formNotes={formNotes} setFormNotes={setFormNotes}
                teamMembers={teamMembers}
                routineActivityTypes={routineActivityTypes}
                filteredLeads={leadOptions}
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
                leads={leadOptions}
              />
            </div>
          </ScrollArea>
        )}

        {/* Footer actions */}
        <div className="shrink-0 border-t">
          <div className="flex items-center justify-between p-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              className="gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Excluir
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
              {selectedActivity?.status !== 'concluida' && (
                <Button variant="outline" size="sm" onClick={handleComplete} className="gap-1 text-xs bg-success hover:bg-success/90 text-success-foreground border-0">
                  <CheckCircle2 className="h-3 w-3" /> Concluir
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
