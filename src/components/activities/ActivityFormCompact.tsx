import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useCampaigns, useCreateCampaign } from '@/hooks/useCampaigns';
import { isMeetingType } from '@/hooks/useActivityTypes';
import { Megaphone } from 'lucide-react';

const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));
const AddProcessDialog = lazy(() => import('@/components/cases/AddProcessDialog'));
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, X, ChevronDown, Copy, Loader2, UserPlus, Building2, Briefcase, Send, Info, Settings2, FileText, Plus, Mic, Check, Star, Eye, Users, Sparkles } from 'lucide-react';
import { TeamChatPanel } from '@/components/chat/TeamChatPanel';
import { reviewActivityWithAI, type SuggestedActivity } from '@/lib/activityFeedbackSummary';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { ActivityTTSButton } from '@/components/voice/ActivityTTSButton';
import { TimeOffAssigneeWarning } from '@/components/activities/TimeOffAssigneeWarning';
import { ActivityFieldSettingsDialog } from '@/components/activities/ActivityFieldSettingsDialog';
import { ActivityMessageTemplateSettings } from '@/components/activities/ActivityMessageTemplateSettings';
import { ActivityNotesField, type Attachment } from '@/components/activities/ActivityNotesField';
import { UserFieldTemplatesHub } from '@/components/activities/UserFieldTemplatesHub';
import { StepChecklistButton } from '@/components/activities/StepChecklistButton';
import type { ActivityStepContext } from '@/hooks/useActivityStepContext';
import type { TemplateVariation } from '@/hooks/useChecklists';
import { cn } from '@/lib/utils';
import { isInstanceDisconnectedError, showInstanceDisconnectedToast } from '@/lib/whatsappReconnectEvent';
import { sendVoiceToWa } from '@/lib/whatsappVoiceSend';
import { getMyAllowedInstanceIds } from '@/integrations/supabase/permissions';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useLeads } from '@/hooks/useLeads';
import { useLegalCases } from '@/hooks/useLegalCases';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { toast } from 'sonner';
import { copyTextToClipboard } from '@/lib/clipboard';

function copyField(text: string | null | undefined) {
  if (!text) return;
  copyTextToClipboard(text).then((ok) => {
    if (ok) toast.success(`"${text.length > 40 ? text.slice(0, 37) + '...' : text}" copiado!`, { duration: 1500 });
    else toast.error('Falha ao copiar');
  });
}

function CampaignLinkerButton({ value, onChange, user }: { value: string; onChange: (v: string) => void; user: any }) {
  const { data: campaigns = [], isLoading } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const active = campaigns.filter(c => c.status !== 'closed');
  const filtered = active.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const selected = campaigns.find(c => c.id === value);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCampaign.mutateAsync({
        name,
        status: 'active',
        investment_total: 0,
        created_by: user?.id,
      } as any);
      onChange(created.id);
      setNewName('');
      setOpen(false);
    } catch (e) {
      // toast handled in hook
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={selected ? 'default' : 'outline'}
          size="sm"
          className="h-6 px-2 text-[10px] gap-1 max-w-[200px]"
          title={selected ? `Campanha: ${selected.name}` : 'Vincular a uma campanha'}
        >
          <Megaphone className="h-3 w-3" />
          <span className="truncate">{selected ? selected.name : 'Campanha'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Campanhas</div>
          <Input
            placeholder="Buscar campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="max-h-40 overflow-y-auto border rounded">
            {isLoading ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">Carregando...</div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                {active.length === 0 ? 'Nenhuma campanha ainda.' : 'Nada encontrado.'}
              </div>
            ) : (
              <>
                {value && (
                  <button
                    type="button"
                    onClick={() => { onChange(''); setOpen(false); }}
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted text-destructive"
                  >
                    ✕ Remover vínculo
                  </button>
                )}
                {filtered.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onChange(c.id); setOpen(false); }}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-muted ${c.id === value ? 'bg-muted font-medium' : ''}`}
                  >
                    {c.name}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="border-t pt-2 space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Criar nova</div>
            <div className="flex gap-1">
              <Input
                placeholder="Nome da campanha"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
                className="h-7 text-xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={handleCreate}
                disabled={!newName.trim() || createCampaign.isPending}
              >
                {createCampaign.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}



interface TeamMember { user_id: string; full_name: string | null; }
interface LeadOption { id: string; lead_name: string | null; }

interface ActivityFormCompactProps {
  // Form values
  formTitle: string; setFormTitle: (v: string) => void;
  formAssignedTo: string; handleSelectAssignee: (v: string) => void;
  formCoAssignees?: { user_id: string; full_name: string }[];
  // Observadores: acompanham (popup de feedback) sem serem cobrados.
  formObservers?: { user_id: string; full_name: string }[];
  onToggleObserver?: (userId: string) => void;
  // Feedback do responsável + data de reagendamento (status 'reagendada').
  formFeedback?: string; setFormFeedback?: (v: string) => void;
  // IA sugeriu uma próxima atividade a partir da revisão do feedback (abre popup no pai).
  onSuggestNextActivity?: (s: SuggestedActivity) => void;
  formRescheduledTo?: string; setFormRescheduledTo?: (v: string) => void;
  formType: string; setFormType: (v: string) => void;
  formStatus: string; setFormStatus: (v: string) => void;
  formPriority: string; setFormPriority: (v: string) => void;
  formDeadline: string; handleDeadlineChange: (v: string) => void;
  formNotificationDate: string; setFormNotificationDate: (v: string) => void;
  formMeetingAt: string; setFormMeetingAt: (v: string) => void;
  formMatrixQuadrant: string; setFormMatrixQuadrant: (v: string) => void;
  formLeadId: string; formLeadName: string;
  formContactId: string; formContactName: string;
  formCaseId: string; formCaseTitle: string;
  formProcessId: string; formProcessTitle: string;
  formWorkflowId: string; setFormWorkflowId: (v: string) => void;
  workflowOptions: { id: string; name: string }[];
  formCampaignId?: string; setFormCampaignId?: (v: string) => void;
  formClientNameOverride?: string;
  setFormClientNameOverride?: (v: string) => void;
  formIsSystem?: boolean; setFormIsSystem?: (v: boolean) => void;
  formIsManagement?: boolean; setFormIsManagement?: (v: boolean) => void;
  formRepeatWeekDays: number[]; setFormRepeatWeekDays: (v: number[] | ((prev: number[]) => number[])) => void;
  formWhatWasDone: string; setFormWhatWasDone: (v: string) => void;
  formCurrentStatus: string; setFormCurrentStatus: (v: string) => void;
  formNextSteps: string; setFormNextSteps: (v: string) => void;
  formSolicitacao: string; setFormSolicitacao: (v: string) => void;
  formRespostaJuizo: string; setFormRespostaJuizo: (v: string) => void;
  formNotes: string; setFormNotes: (v: string) => void;
  // Data
  teamMembers: TeamMember[];
  routineActivityTypes: { value: string; label: string }[];
  filteredLeads: LeadOption[];
  availableContacts: { id: string; full_name: string }[];
  availableCases: { id: string; case_number: string; title: string; lead_id: string | null }[];
  leadCases: { id: string; case_number: string; title: string }[];
  caseProcesses: { id: string; title: string; process_number: string | null; polo_passivo?: string | null; tribunal?: string | null; area?: string | null; assuntos?: string[] | null; workflow_id?: string | null; envolvidos?: any[] | null }[];
  // Counts
  deadlineDateCount: number | null;
  notifDateCount: number | null;
  // Callbacks
  handleTitleChange: (v: string) => void;
  handleSelectLead: (id: string) => void;
  handleClearLead: () => void;
  setFormContactId: (v: string) => void;
  setFormContactName: (v: string) => void;
  setFormCaseId: (v: string) => void;
  setFormCaseTitle: (v: string) => void;
  setFormProcessId: (v: string) => void;
  setFormProcessTitle: (v: string) => void;
  setCaseProcesses: (v: any) => void;
  setCaseSearch: (v: string) => void;
  caseSearch: string;
  leadSearch: string; setLeadSearch: (v: string) => void;
  contactSearch: string; setContactSearch: (v: string) => void;
  // Settings
  fieldSettings: any[];
  updateFieldSetting: any;
  reorderFields: any;
  selectedActivity: any;
  aiSuggestingType: boolean;
  typeMismatch?: { suggested: string; label: string } | null;
  onApplySuggestedType?: () => void;
  onDismissTypeMismatch?: () => void;
  activeRoutine: any[];
  // WhatsApp message
  buildMsg?: () => string;
  formAssignedToName?: string;
  formLeadIdForTTS?: string;
  formContactIdForTTS?: string;
  // Supabase for case processes
  supabase: any;
  // Step context (current funnel/process step → templates + checklist)
  stepContext?: ActivityStepContext | null;
  saveStepFieldTemplates?: (fieldKey: string, variations: TemplateVariation[]) => Promise<boolean>;
  selectedStepId?: string | null;
  setSelectedStepId?: (id: string | null) => void;
  leads: LeadOption[];
  // Anexos do campo de notas ainda não persistidos (atividade nova / etapas)
  onNotesPendingChange?: (pending: Attachment[]) => void;
  onNotesCommitCandidatesChange?: (attachments: Attachment[]) => void;
  onNotesUploadStateChange?: (uploading: boolean) => void;
}

const PRIORITY_OPTIONS = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

const MATRIX_OPTIONS = [
  { value: 'do_now', emoji: '🔥', label: 'Agora', color: 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-400', active: 'border-red-500 bg-red-500 text-white' },
  { value: 'schedule', emoji: '📅', label: 'Agendar', color: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400', active: 'border-blue-600 bg-blue-600 text-white' },
  { value: 'delegate', emoji: '🤝', label: 'Delegar', color: 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-400', active: 'border-orange-500 bg-orange-500 text-white' },
  { value: 'eliminate', emoji: '🗑️', label: 'Retirar', color: 'border-muted bg-muted/50 text-muted-foreground', active: 'border-muted-foreground bg-muted-foreground text-background' },
];

export function SendToGroupSection({ buildMsg, leadId, fieldSettings, updateFieldSetting, reorderFields, formLeadIdForTTS, formContactIdForTTS, formAssignedTo, formCoAssignees, activityId, compactLabel }: {
  buildMsg: (audience?: 'client' | 'assessor') => string;
  leadId: string;
  fieldSettings: any[];
  updateFieldSetting: any;
  reorderFields: any;
  formLeadIdForTTS?: string;
  formContactIdForTTS?: string;
  formAssignedTo?: string;
  formCoAssignees?: { user_id: string; full_name: string }[];
  activityId?: string;
  compactLabel?: boolean;
}) {
  const [sending, setSending] = useState(false);
  const { user } = useAuthContext();
  const { isAdmin } = useUserRole();
  const [instances, setInstances] = useState<{ id: string; instance_name: string }[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  // Gravação de ligação anexada à atividade (para enviar junto, se o usuário quiser).
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [includeRecording, setIncludeRecording] = useState(false);
  // Preview editável + escolha de destino
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [hasGroup, setHasGroup] = useState(false);
  const [destGroup, setDestGroup] = useState(false);
  const [destAssessor, setDestAssessor] = useState(false);

  // Descobre se o lead tem grupo (usado para o preview e destinos padrão).
  useEffect(() => {
    let cancelled = false;
    if (!leadId) { setHasGroup(false); return; }
    (async () => {
      await ensureExternalSession();
      const { data } = await externalSupabase
        .from('leads')
        .select('whatsapp_group_id')
        .eq('id', leadId)
        .maybeSingle();
      if (!cancelled) setHasGroup(!!(data as any)?.whatsapp_group_id);
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activityId) { setRecordingUrl(null); setIncludeRecording(false); return; }
      const { data } = await externalSupabase
        .from('activity_attachments')
        .select('file_url, file_type')
        .eq('activity_id', activityId)
        .eq('attachment_type', 'audio')
        .order('created_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      const rec = (data || [])[0] as { file_url?: string } | undefined;
      setRecordingUrl(rec?.file_url || null);
      if (!rec) setIncludeRecording(false);
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  const sendRecording = async (phone: string, chatId?: string, instanceId?: string) => {
    if (!recordingUrl) return;
    // Envia como nota de voz (PTT): transcodifica pra ogg/opus e marca ptt/is_voice.
    // Sem isso a UazAPI manda como type 'audio' de webm cru e o WhatsApp iOS não abre
    // ("áudio não está mais disponível"). Mesmo pipeline do menu do WhatsApp.
    try {
      await sendVoiceToWa(recordingUrl, chatId || phone, leadId || null, instanceId || null);
    } catch (e) {
      console.error('Erro ao enviar gravação:', e);
      toast.error('Texto enviado, mas falhou ao enviar a gravação.');
    }
  };

  // Lista as instâncias que o usuário pode usar para enviar (Externo = fonte da verdade).
  useEffect(() => {
    let cancelled = false;
    const loadInstances = async () => {
      if (!user) return;
      try {
        let query = externalSupabase
          .from('whatsapp_instances')
          .select('id, instance_name')
          .eq('is_active', true)
          .order('instance_name');
        if (!isAdmin) {
          const allowedIds = await getMyAllowedInstanceIds(user.id);
          if (allowedIds.length === 0) { if (!cancelled) setInstances([]); return; }
          query = query.in('id', allowedIds);
        }
        const { data } = await query;
        if (cancelled) return;
        const list = (data || []) as { id: string; instance_name: string }[];
        setInstances(list);
        // Pré-seleciona a instância default do perfil; senão, a primeira da lista.
        const { data: prof } = await supabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', user.id)
          .maybeSingle();
        const def = (prof as any)?.default_instance_id;
        setSelectedInstanceId(prev => prev || (def && list.some(i => i.id === def) ? def : (list[0]?.id || '')));
      } catch {
        if (!cancelled) setInstances([]);
      }
    };
    loadInstances();
    return () => { cancelled = true; };
  }, [user?.id, isAdmin]);

  // Envia o texto (já editado) ao grupo do lead.
  const sendToGroupNow = async (text: string): Promise<void> => {
    if (!leadId) return;
    await ensureExternalSession();
    const [leadRes, profileRes] = await Promise.all([
      externalSupabase
        .from('leads')
        .select('whatsapp_group_id, board_id')
        .eq('id', leadId)
        .maybeSingle(),
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return null;
        const { data } = await supabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', user.id)
          .maybeSingle();
        return (data as any)?.default_instance_id || null;
      }),
    ]);
    const lead = leadRes.data as any;
    const groupId = lead?.whatsapp_group_id;
    if (!groupId) { toast.error('Este lead não tem grupo WhatsApp vinculado'); return; }

    let instanceId: string | undefined = selectedInstanceId || profileRes || undefined;
    if (!instanceId && lead?.board_id) {
      const { data: boardInstances } = await externalSupabase
        .from('board_group_instances')
        .select('instance_id')
        .eq('board_id', lead.board_id)
        .limit(1);
      instanceId = (boardInstances as any)?.[0]?.instance_id;
    }

    const sendBody: Record<string, any> = {
      phone: groupId, chat_id: groupId, message: text, lead_id: leadId,
    };
    if (instanceId) sendBody.instance_id = instanceId;

    const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: sendBody });
    if (error || !data?.success) {
      if (!error && isInstanceDisconnectedError(data)) {
        showInstanceDisconnectedToast(data.instance_id || instanceId, data.instance_name);
      } else {
        toast.error(data?.error || 'Erro ao enviar ao grupo');
      }
      return;
    }
    toast.success('Mensagem enviada ao grupo!');
    if (includeRecording && recordingUrl) {
      await sendRecording(groupId, groupId, instanceId);
    }
  };

  // Envia o texto (já editado) a TODOS os assessores da atividade (principal +
  // co-assessores) via WhatsApp privado (se tiver). Não registra mais no Chat da
  // Equipe: estava poluindo o chat com uma mensagem por atividade criada.
  const sendToAssessorNow = async (text: string): Promise<void> => {
    const assessorIds = [...new Set([formAssignedTo, ...(formCoAssignees || []).map(c => c.user_id)].filter(Boolean))] as string[];
    if (assessorIds.length === 0) { toast.error('Sem assessor responsável'); return; }

    // Perfis de todos em uma query só (evita N+1)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, phone, default_instance_id, full_name')
      .in('user_id', assessorIds);
    const profileByUser = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    const waSent: string[] = [];
    for (const assessorId of assessorIds) {
      const profile = profileByUser.get(assessorId);
      const hasWhatsApp = !!profile?.phone && !!profile?.default_instance_id;
      if (!hasWhatsApp) continue;
      const phone = (profile.phone as string).replace(/\D/g, '');
      const instId = selectedInstanceId || (profile.default_instance_id as string);
      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: { phone, message: text, instance_id: instId },
      });
      if (error || !data?.success) {
        if (!error && isInstanceDisconnectedError(data)) {
          showInstanceDisconnectedToast(data.instance_id || instId, data.instance_name);
        } else {
          toast.error(`Erro ao enviar no WhatsApp para ${profile?.full_name || 'assessor'}: ${data?.error || 'falha'}`);
        }
      } else {
        waSent.push(profile?.full_name || 'assessor');
        if (includeRecording && recordingUrl) {
          await sendRecording(phone, undefined, instId);
        }
      }
    }
    if (waSent.length > 0) toast.success(`WhatsApp enviado para ${waSent.join(', ')}!`);
  };

  // Abre o preview com a mensagem montada e destinos padrão.
  const openPreview = () => {
    let msg = '';
    try {
      msg = buildMsg(hasGroup ? 'client' : 'assessor');
    } catch (e) {
      console.error('[Preview] buildMsg falhou:', e);
      toast.error('Erro ao montar a mensagem.');
      return;
    }
    setPreviewText(msg);
    setDestGroup(hasGroup);
    setDestAssessor(!hasGroup && !!formAssignedTo);
    setPreviewOpen(true);
  };

  const confirmSend = async () => {
    if (!destGroup && !destAssessor) { toast.error('Escolha ao menos um destino'); return; }
    if (!previewText.trim()) { toast.error('Mensagem vazia'); return; }
    setSending(true);
    try {
      if (destGroup) await sendToGroupNow(previewText);
      if (destAssessor) await sendToAssessorNow(previewText);
      setPreviewOpen(false);
    } finally {
      setSending(false);
    }
  };

  const hasLead = !!leadId;
  const buttonLabel = compactLabel ? 'Enviar' : (hasLead ? 'Enviar ao Grupo' : 'Enviar ao Assessor');

  const [generatingRating, setGeneratingRating] = useState(false);
  // Gera um link público de avaliação (0–5 estrelas) e copia pra área de transferência,
  // pronto pra colar na mensagem ao cliente. Cada clique gera um link novo (uso único).
  const handleGenerateRatingLink = async () => {
    if (!leadId) { toast.error('Vincule um lead para pedir avaliação do cliente.'); return; }
    setGeneratingRating(true);
    try {
      const { data, error } = await cloudFunctions.invoke('service-rating', {
        body: {
          action: 'create',
          lead_id: leadId,
          activity_id: activityId || null,
          // Avaliação é do assessor que ESTÁ ENVIANDO a mensagem (usuário atual),
          // não necessariamente o responsável pela atividade.
          assessor_id: user?.id || null,
          created_by: user?.id || null,
        },
      });
      if (error || !data?.success || !data?.token) throw new Error(data?.error || 'Falha ao gerar link');
      const link = `${window.location.origin}/avaliar/${data.token}`;
      const ok = await copyTextToClipboard(`Avalie nosso atendimento (leva 10s): ${link}`);
      toast.success(ok ? 'Link de avaliação copiado — cole na mensagem ao cliente.' : `Link: ${link}`, { duration: 6000 });
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível gerar o link de avaliação.');
    } finally {
      setGeneratingRating(false);
    }
  };


  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1 h-8 text-xs"
        onClick={async () => {
          let msg = '';
          try {
            msg = buildMsg(hasLead ? 'client' : 'assessor');
          } catch (e) {
            console.error('[Copiar] buildMsg falhou:', e);
            toast.error('Erro ao montar a mensagem.');
            return;
          }
          const ok = await copyTextToClipboard(msg);
          if (ok) toast.success('Mensagem copiada!');
          else toast.error('Não foi possível copiar automaticamente. Use "Enviar" ou copie pelo WhatsApp.');
        }}
      >
        <Copy className="h-3.5 w-3.5" /> Copiar
      </Button>
      {hasLead && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1 h-8 text-xs text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800"
          onClick={handleGenerateRatingLink}
          disabled={generatingRating}
          title="Gera um link de avaliação (0–5 estrelas) para enviar ao cliente"
        >
          {generatingRating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
          Avaliação
        </Button>
      )}
      <Button type="button" variant="default" size="sm" className="gap-1 h-8 text-xs" onClick={openPreview} disabled={sending}>
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        {buttonLabel}
      </Button>
      <ActivityTTSButton messageText={buildMsg()} leadId={formLeadIdForTTS} contactId={formContactIdForTTS} />
      <ActivityFieldSettingsDialog fields={fieldSettings} onUpdateField={updateFieldSetting} onReorder={reorderFields} />
      <ActivityMessageTemplateSettings />

      <Dialog open={previewOpen} onOpenChange={(v) => !sending && setPreviewOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Revisar e enviar mensagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Mensagem (editável)</Label>
              <Textarea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                rows={10}
                className="text-sm font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Destino</Label>
              <div className="space-y-2">
                <label className={cn("flex items-start gap-2 text-sm", !hasGroup && "opacity-50")}>
                  <Checkbox
                    checked={destGroup}
                    onCheckedChange={(v) => setDestGroup(!!v)}
                    disabled={!hasGroup}
                    className="mt-0.5"
                  />
                  <div>
                    <div>Grupo do lead</div>
                    {!hasGroup && <div className="text-[11px] text-muted-foreground">Lead não tem grupo WhatsApp vinculado</div>}
                  </div>
                </label>
                <label className={cn("flex items-start gap-2 text-sm", !formAssignedTo && "opacity-50")}>
                  <Checkbox
                    checked={destAssessor}
                    onCheckedChange={(v) => setDestAssessor(!!v)}
                    disabled={!formAssignedTo}
                    className="mt-0.5"
                  />
                  <div>
                    <div>
                      {(formCoAssignees?.length || 0) > 0
                        ? `Assessores (${1 + (formCoAssignees?.length || 0)}) — WhatsApp privado`
                        : 'Assessor (WhatsApp privado)'}
                    </div>
                    {!formAssignedTo && <div className="text-[11px] text-muted-foreground">Nenhum assessor responsável selecionado</div>}
                  </div>
                </label>
              </div>
            </div>

            {instances.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Instância do WhatsApp</Label>
                <Select value={selectedInstanceId} onValueChange={setSelectedInstanceId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((i) => (
                      <SelectItem key={i.id} value={i.id} className="text-xs">{i.instance_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {recordingUrl && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={includeRecording}
                  onCheckedChange={(v) => setIncludeRecording(!!v)}
                />
                <Mic className="h-3.5 w-3.5 text-red-500" />
                Incluir gravação da ligação
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)} disabled={sending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={confirmSend} disabled={sending || (!destGroup && !destAssessor)}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ActivityFormCompact(props: ActivityFormCompactProps) {
  const { user } = useAuthContext();
  // Opções de @menção nos campos de texto (membros atribuíveis da equipe).
  const mentionOptions = useMemo(
    () => filterAssignableMembers(props.teamMembers)
      .map((m: any) => ({ id: m.user_id, name: m.full_name || '' }))
      .filter((o: { id: string; name: string }) => o.name),
    [props.teamMembers],
  );
  const [detailsOpen, setDetailsOpen] = useState(true);
  // Chat interno da equipe (colapsável) + estado de "Revisar com IA" no feedback.
  const [chatOpen, setChatOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [expandedFieldKey, setExpandedFieldKey] = useState<string | null>(null);
  const [linkLeadOpen, setLinkLeadOpen] = useState(false);
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [linkCaseOpen, setLinkCaseOpen] = useState(false);
  // availableCases traz só os 500 casos mais recentes (há 1500+) — casos antigos
  // (ex.: CASO 225) não apareciam na busca. Ao digitar, busca também no servidor.
  const [remoteCases, setRemoteCases] = useState<{ id: string; case_number: string; title: string; lead_id: string | null }[]>([]);
  useEffect(() => {
    const q = props.caseSearch.trim().replace(/[%,()]/g, ' ').trim();
    if (!linkCaseOpen || props.formLeadId || q.length < 2) {
      setRemoteCases([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await externalSupabase
        .from('legal_cases')
        .select('id, case_number, title, lead_id')
        .or(`case_number.ilike.%${q}%,title.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      setRemoteCases((data as any) || []);
    }, 300);
    return () => clearTimeout(t);
  }, [props.caseSearch, linkCaseOpen, props.formLeadId]);

  // Permite que o cabeçalho fixo (fora deste componente) dispare a abertura dos sheets de vínculo
  useEffect(() => {
    const onOpenLead = () => setLinkLeadOpen(true);
    const onOpenCase = () => setLinkCaseOpen(true);
    const onOpenContact = () => setLinkContactOpen(true);
    const onOpenProcess = () => setProcessPopoverOpen(true);
    window.addEventListener('activity-form:open-link-lead', onOpenLead);
    window.addEventListener('activity-form:open-link-case', onOpenCase);
    window.addEventListener('activity-form:open-link-contact', onOpenContact);
    window.addEventListener('activity-form:open-link-process', onOpenProcess);
    return () => {
      window.removeEventListener('activity-form:open-link-lead', onOpenLead);
      window.removeEventListener('activity-form:open-link-case', onOpenCase);
      window.removeEventListener('activity-form:open-link-contact', onOpenContact);
      window.removeEventListener('activity-form:open-link-process', onOpenProcess);
    };
  }, []);
  const [processPopoverOpen, setProcessPopoverOpen] = useState(false);
  const [editProcessData, setEditProcessData] = useState<any>(null);
  const [loadingProcessEdit, setLoadingProcessEdit] = useState(false);

  // Create-new flows (reuses existing forms/hooks)
  const { addLead } = useLeads();
  const { createCase } = useLegalCases();
  const { nuclei } = useSpecializedNuclei();
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [creatingLead, setCreatingLead] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseNumber, setNewCaseNumber] = useState('');
  const [newCaseNucleusId, setNewCaseNucleusId] = useState<string>('none');
  const [creatingCase, setCreatingCase] = useState(false);
  const [newProcessOpen, setNewProcessOpen] = useState(false);

  const handleCreateLead = async () => {
    if (!newLeadName.trim()) { toast.error('Nome do lead obrigatório'); return; }
    setCreatingLead(true);
    try {
      const lead: any = await addLead({ lead_name: newLeadName.trim(), lead_phone: newLeadPhone.trim() || undefined } as any);
      if (lead?.id) {
        props.handleSelectLead(lead.id);
        props.setFormCaseId(''); props.setFormCaseTitle('');
        props.setFormProcessId(''); props.setFormProcessTitle('');
        props.setCaseProcesses([]);
        setNewLeadOpen(false);
        setNewLeadName(''); setNewLeadPhone('');
      }
    } catch (e: any) {
      toast.error('Erro ao criar lead: ' + (e?.message || ''));
    } finally { setCreatingLead(false); }
  };

  const handleCreateCase = async () => {
    if (!newCaseTitle.trim()) { toast.error('Título do caso obrigatório'); return; }
    if (!props.formLeadId) { toast.error('Selecione um lead primeiro'); return; }
    setCreatingCase(true);
    try {
      const c: any = await createCase({
        lead_id: props.formLeadId,
        title: newCaseTitle.trim(),
        case_number: newCaseNumber.trim() || undefined,
        nucleus_id: newCaseNucleusId !== 'none' ? newCaseNucleusId : null,
      });
      if (c?.id) {
        props.setFormCaseId(c.id);
        props.setFormCaseTitle(`${c.case_number} - ${c.title}`);
        props.setFormProcessId(''); props.setFormProcessTitle('');
        props.setCaseProcesses([]);
        setNewCaseOpen(false);
        setNewCaseTitle(''); setNewCaseNumber(''); setNewCaseNucleusId('none');
        // trigger upstream lead-cases refresh by reselecting the lead
        props.handleSelectLead(props.formLeadId);
      }
    } catch (e: any) {
      toast.error('Erro ao criar caso: ' + (e?.message || ''));
    } finally { setCreatingCase(false); }
  };

  const refreshCaseProcesses = async () => {
    if (!props.formCaseId) return;
    const { data: procs } = await externalSupabase
      .from('lead_processes')
      .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
      .eq('case_id', props.formCaseId);
    props.setCaseProcesses(procs || []);
  };


  const openProcessEditor = async (processId: string) => {
    if (!processId) return;
    setLoadingProcessEdit(true);
    try {
      await ensureExternalSession();
      const { data, error } = await externalSupabase
        .from('lead_processes')
        .select('*, legal_cases(case_number, title)')
        .eq('id', processId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error('Processo não encontrado');
        return;
      }
      setEditProcessData(data);
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao abrir processo: ' + (e.message || ''));
    } finally {
      setLoadingProcessEdit(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Título foi movido para o cabeçalho fixo (editável inline com ícone de lápis). */}

      {/* Vínculos (Lead/Caso/Processo/Contato/Sistema) ficam APENAS no cabeçalho fixo da atividade
          para evitar duplicação visual. Só mostramos os botões de seleção aqui quando NADA está vinculado,
          como atalho inicial. */}
      {props.setFormCampaignId && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Vincular:</span>
          <CampaignLinkerButton
            value={props.formCampaignId || ''}
            onChange={props.setFormCampaignId}
            user={user}
          />
        </div>
      )}
      {!props.formLeadId && !props.formCaseId && !props.formProcessId && !props.formContactId && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!props.formIsSystem && !props.formIsManagement && (
            <>
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkLeadOpen(true)}>
                <Building2 className="h-3 w-3" /> Lead
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkCaseOpen(true)}>
                <Briefcase className="h-3 w-3" /> Caso
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkContactOpen(true)}>
                <UserPlus className="h-3 w-3" /> Contato
              </Button>
            </>
          )}
          {(props.setFormIsSystem || props.setFormIsManagement) && (
            <>
              {!props.formIsSystem && !props.formIsManagement && <span className="text-muted-foreground text-xs">|</span>}
              {props.setFormIsSystem && (
                <Button
                  type="button"
                  variant={props.formIsSystem ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-[10px] gap-1"
                  onClick={() => {
                    const next = !props.formIsSystem;
                    props.setFormIsSystem?.(next);
                    if (next) props.setFormIsManagement?.(false);
                  }}
                  title={props.formIsSystem ? 'Desmarcar atividade interna' : 'Marcar como atividade interna (de equipe) — demanda de membro para membro'}
                >
                  <Settings2 className="h-3 w-3" /> Interna{props.formIsSystem ? ' ✓' : ''}
                </Button>
              )}
            </>
          )}
          {!props.formIsSystem && !props.formIsManagement && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 w-full mt-1">
              <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                Vincule esta atividade a um <strong>Lead</strong>, <strong>Caso</strong> ou marque como <strong>Interna (de equipe)</strong>.
              </span>
            </div>
          )}
        </div>
      )}

      {/* === ROW 2: Core selects - 4 columns === */}
      <div className="grid grid-cols-4 gap-2">
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Assessor *</span>
          {(() => {
            const coAssignees = props.formCoAssignees || [];
            const isCo = (id: string) => coAssignees.some(c => c.user_id === id);
            // Selecionados sobem pro topo (principal primeiro, depois co-responsáveis
            // na ordem de escolha); o resto segue em ordem alfabética.
            const selectedRank = new Map<string, number>();
            if (props.formAssignedTo) selectedRank.set(props.formAssignedTo, 0);
            coAssignees.forEach((c, i) => selectedRank.set(c.user_id, i + 1));
            const assignable = filterAssignableMembers(props.teamMembers)
              .slice().sort((a, b) => {
                const ra = selectedRank.get(a.user_id);
                const rb = selectedRank.get(b.user_id);
                if (ra !== undefined || rb !== undefined) {
                  if (ra === undefined) return 1;
                  if (rb === undefined) return -1;
                  return ra - rb;
                }
                return (a.full_name || '').localeCompare(b.full_name || '', 'pt-BR', { sensitivity: 'base' });
              });
            const selected = assignable.find(m => m.user_id === props.formAssignedTo);
            const triggerLabel = selected
              ? `${selected.full_name || 'Sem nome'}${coAssignees.length > 0 ? ` +${coAssignees.length}` : ''}`
              : '—';
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="h-8 mt-0.5 w-full justify-between text-xs font-normal px-2"
                    title={coAssignees.length > 0 ? [selected?.full_name, ...coAssignees.map(c => c.full_name)].filter(Boolean).join(', ') : undefined}
                  >
                    <span className={cn("truncate", !selected && "text-muted-foreground")}>
                      {triggerLabel}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[240px]" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar assessor..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty className="text-xs py-4 text-center">Nenhum encontrado</CommandEmpty>
                      <CommandGroup>
                        {assignable.map(m => (
                          <CommandItem
                            key={m.user_id}
                            value={`${m.full_name || 'Sem nome'} ${m.user_id}`}
                            onSelect={() => props.handleSelectAssignee(m.user_id)}
                            className="text-xs"
                          >
                            <Check className={cn("mr-2 h-3 w-3 shrink-0", (props.formAssignedTo === m.user_id || isCo(m.user_id)) ? "opacity-100" : "opacity-0")} />
                            <span className="truncate">{m.full_name || 'Sem nome'}</span>
                            {props.formAssignedTo === m.user_id && (
                              <span className="ml-auto text-[9px] uppercase tracking-wider text-primary shrink-0">Principal</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                    <p className="text-[10px] text-muted-foreground px-2 py-1.5 border-t">
                      Clique para adicionar/remover responsáveis. O 1º é o principal;
                      cada responsável recebe a própria atividade.
                    </p>
                  </Command>
                </PopoverContent>
              </Popover>
            );
          })()}
          <TimeOffAssigneeWarning
            assignedIds={[props.formAssignedTo, ...(props.formCoAssignees || []).map(c => c.user_id)]}
            deadline={props.formDeadline}
          />
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider inline-flex items-center gap-1 leading-none h-[14px]">
            <span>Tipo *</span>{props.aiSuggestingType && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          </span>
          <Select value={props.formType} onValueChange={props.setFormType}>
            <SelectTrigger className={cn("h-8 text-xs mt-0.5", props.typeMismatch && "border-amber-400 ring-1 ring-amber-300 dark:border-amber-600")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {props.routineActivityTypes.map(t => (
                <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.typeMismatch && (
            <div className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-1.5">
              <Info className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-tight">
                  Pelo contexto, parece ser <strong>{props.typeMismatch.label}</strong>, não {props.routineActivityTypes.find(t => t.value === props.formType)?.label || props.formType}.
                </p>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={props.onApplySuggestedType} className="text-[10px] font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2">
                    Alterar para {props.typeMismatch.label}
                  </button>
                  <button type="button" onClick={props.onDismissTypeMismatch} className="text-[10px] text-muted-foreground">
                    Manter
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {isMeetingType(props.formType, props.routineActivityTypes.find(t => t.value === props.formType)?.label) && (
          <div className="col-span-full">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              📆 Data e hora da reunião
            </span>
            <Input
              type="datetime-local"
              value={props.formMeetingAt}
              onChange={e => props.setFormMeetingAt(e.target.value)}
              className="h-8 text-xs mt-0.5"
            />
          </div>
        )}
        <div className="col-span-full">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Fluxo de Trabalho {(props.formIsSystem || props.formIsManagement) ? '(opcional)' : '*'}
          </span>
          <Select value={props.formWorkflowId || undefined} onValueChange={props.setFormWorkflowId}>
            <SelectTrigger
              className={cn(
                "h-8 text-xs mt-0.5",
                !props.formWorkflowId && !props.formIsSystem && !props.formIsManagement && "border-destructive/60 ring-1 ring-destructive/20"
              )}
            >
              <SelectValue placeholder="Selecione um fluxo de trabalho" />
            </SelectTrigger>
            <SelectContent>
              {props.workflowOptions.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhum fluxo cadastrado
                </div>
              ) : (
                props.workflowOptions.map(w => (
                  <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {!props.formWorkflowId && !props.formIsSystem && !props.formIsManagement && (
            <p className="text-[10px] text-destructive mt-0.5">Selecione um fluxo de trabalho para continuar</p>
          )}
        </div>

        {/* Campanha movida para o topo (em "Vincular"). */}


        {/* Observadores — acompanham a atividade e recebem os popups (feedback, mudança
            de situação, reagendamento), sem serem cobrados. Campo próprio, separado dos
            responsáveis. Quem cria a atividade entra como observador automaticamente. */}
        {props.onToggleObserver && (
          <div className="col-span-full">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider inline-flex items-center gap-1">
              <Eye className="h-3 w-3" /> Observadores
            </span>
            {(() => {
              const observers = props.formObservers || [];
              const isObserver = (id: string) => observers.some(o => o.user_id === id);
              const obsRank = new Map<string, number>();
              observers.forEach((o, i) => obsRank.set(o.user_id, i));
              // Não deixa marcar como observador quem já é responsável (papéis exclusivos).
              const isResponsible = (id: string) =>
                props.formAssignedTo === id || (props.formCoAssignees || []).some(c => c.user_id === id);
              const selectable = filterAssignableMembers(props.teamMembers)
                .slice().sort((a, b) => {
                  const ra = obsRank.get(a.user_id);
                  const rb = obsRank.get(b.user_id);
                  if (ra !== undefined || rb !== undefined) {
                    if (ra === undefined) return 1;
                    if (rb === undefined) return -1;
                    return ra - rb;
                  }
                  return (a.full_name || '').localeCompare(b.full_name || '', 'pt-BR', { sensitivity: 'base' });
                });
              const triggerLabel = observers.length === 0
                ? 'Ninguém (só quem criar acompanha)'
                : observers.map(o => o.full_name).filter(Boolean).join(', ');
              return (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="h-8 mt-0.5 w-full justify-between text-xs font-normal px-2"
                      title={observers.length > 0 ? triggerLabel : undefined}
                    >
                      <span className={cn("truncate", observers.length === 0 && "text-muted-foreground")}>
                        {observers.length > 0 ? `${observers.length} observador(es): ${triggerLabel}` : triggerLabel}
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[280px]" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar membro..." className="h-8 text-xs" />
                      <CommandList>
                        <CommandEmpty className="text-xs py-4 text-center">Nenhum encontrado</CommandEmpty>
                        <CommandGroup>
                          {selectable.map(m => {
                            const responsible = isResponsible(m.user_id);
                            return (
                              <CommandItem
                                key={m.user_id}
                                value={`${m.full_name || 'Sem nome'} ${m.user_id}`}
                                disabled={responsible}
                                onSelect={() => { if (!responsible) props.onToggleObserver?.(m.user_id); }}
                                className={cn("text-xs", responsible && "opacity-40")}
                              >
                                <Check className={cn("mr-2 h-3 w-3 shrink-0", isObserver(m.user_id) ? "opacity-100" : "opacity-0")} />
                                <span className="truncate">{m.full_name || 'Sem nome'}</span>
                                {responsible && (
                                  <span className="ml-auto text-[9px] uppercase tracking-wider text-primary shrink-0">Responsável</span>
                                )}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                      <p className="text-[10px] text-muted-foreground px-2 py-1.5 border-t">
                        Observadores recebem os avisos (feedback, situação, reagendamento) sem
                        serem cobrados. Quem cria a atividade já observa automaticamente.
                      </p>
                    </Command>
                  </PopoverContent>
                </Popover>
              );
            })()}
          </div>
        )}

        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Situação</span>
          <Select value={props.formStatus} onValueChange={props.setFormStatus}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente" className="text-xs">Pendente</SelectItem>
              <SelectItem value="em_andamento" className="text-xs">Em Andamento</SelectItem>
              <SelectItem value="concluida" className="text-xs">Concluída</SelectItem>
              <SelectItem value="reagendada" className="text-xs">Reagendada</SelectItem>
            </SelectContent>
          </Select>
          {props.formStatus === 'reagendada' && props.setFormRescheduledTo && (
            <div className="mt-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Reagendada para</span>
              <Input
                type="date"
                value={props.formRescheduledTo || ''}
                onChange={e => props.setFormRescheduledTo?.(e.target.value)}
                className="h-8 text-xs mt-0.5"
              />
            </div>
          )}
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Prioridade</span>
          <Select value={props.formPriority} onValueChange={props.setFormPriority}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(p => (
                <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Matriz Eisenhower e Nome do cliente removidos do form — cliente vive no cabeçalho */}

      {/* Chat interno da equipe + Feedback — só em atividade INTERNA (demanda de
          membro para membro). Retorno do responsável; observadores recebem popup ao salvar. */}
      {props.setFormFeedback && props.formIsSystem && (
        <div className="space-y-2">
          {/* Chat interno da equipe embutido (colapsável). Só após a atv existir. */}
          {props.selectedActivity?.id && (
            <div className="rounded-lg border border-primary/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setChatOpen(o => !o)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-primary/5 hover:bg-primary/10 transition-colors"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                  <Users className="h-3.5 w-3.5" /> Chat interno da equipe
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-primary transition-transform", chatOpen && "rotate-180")} />
              </button>
              {chatOpen && (
                <div className="h-64 bg-background border-t">
                  <TeamChatPanel
                    entityType="activity"
                    entityId={props.selectedActivity.id}
                    entityName={props.formTitle}
                  />
                </div>
              )}
            </div>
          )}

          {/* Feedback da atv (resumo do que foi dito e feito) */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">💬 Feedback da atv</span>
              {props.selectedActivity?.id && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={summarizing}
                  className="h-6 px-2 text-[10px] gap-1 text-primary hover:bg-primary/10"
                  title="Revisar com IA: gera o feedback a partir do chat, funil, movimentações e documentos, e sugere a próxima atividade"
                  onClick={async () => {
                    setSummarizing(true);
                    try {
                      const review = await reviewActivityWithAI({
                        activityId: props.selectedActivity.id,
                        leadId: props.formLeadId || props.selectedActivity.lead_id || null,
                        processId: props.formProcessId || props.selectedActivity.process_id || null,
                        whatWasDone: props.formWhatWasDone,
                        currentStatus: props.formCurrentStatus,
                        nextSteps: props.formNextSteps,
                      });
                      if (review?.feedback) {
                        props.setFormFeedback?.(review.feedback);
                        toast.success('Feedback gerado pela IA');
                      } else {
                        toast.info('Sem conversa ou dados para revisar');
                      }
                      if (review?.suggestion) {
                        props.onSuggestNextActivity?.(review.suggestion);
                      }
                    } catch {
                      toast.error('Erro ao revisar com IA');
                    } finally {
                      setSummarizing(false);
                    }
                  }}
                >
                  {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Revisar com IA
                </Button>
              )}
            </div>
            <Textarea
              value={props.formFeedback || ''}
              onChange={e => props.setFormFeedback?.(e.target.value)}
              placeholder="Retorno do responsável: o que foi feito com esta demanda, como ficou..."
              rows={2}
              className="text-xs"
            />
          </div>
        </div>
      )}

      {/* === ROW 4: Dates side by side === */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">📅 Prazo *</span>
            {props.deadlineDateCount !== null && props.formDeadline && (
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border shadow-sm",
                props.deadlineDateCount > 0
                  ? "bg-warning/15 text-warning border-warning/40 ring-1 ring-warning/30"
                  : "bg-success/15 text-success border-success/40 ring-1 ring-success/30"
              )}>
                {props.deadlineDateCount} atv
              </span>
            )}
          </div>
          <Input type="date" value={props.formDeadline} onChange={e => props.handleDeadlineChange(e.target.value)} className="h-8 text-xs" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">🔔 Notificação *</span>
            {props.notifDateCount !== null && props.formNotificationDate && (
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border shadow-sm",
                props.notifDateCount > 0
                  ? "bg-warning/15 text-warning border-warning/40 ring-1 ring-warning/30"
                  : "bg-success/15 text-success border-success/40 ring-1 ring-success/30"
              )}>
                {props.notifDateCount} atv
              </span>
            )}
          </div>
          <Input type="date" value={props.formNotificationDate} onChange={e => props.setFormNotificationDate(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>

      {/* === ROW 5: Repeat weekdays (only on create) === */}
      {!props.selectedActivity && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">Repetir</span>
          {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((day, idx) => {
            const isSelected = props.formRepeatWeekDays.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                className={cn(
                  'w-7 h-7 rounded-full text-[10px] font-semibold border transition-all',
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                )}
                onClick={() => props.setFormRepeatWeekDays((prev: number[]) =>
                  isSelected ? prev.filter((d: number) => d !== idx) : [...prev, idx]
                )}
              >
                {day}
              </button>
            );
          })}
          {props.formRepeatWeekDays.length > 0 && (
            <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground ml-1" onClick={() => props.setFormRepeatWeekDays([])}>
              ✕
            </button>
          )}
        </div>
      )}

      {/* SendToGroupSection moved to action bar */}
      {/* === COLLAPSIBLE: Detail fields === */}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="flex items-center justify-between gap-2 w-full py-1">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-left">
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", detailsOpen && "rotate-180")} />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Detalhes e Observações</span>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1.5">
            {(() => {
              const notesField = props.fieldSettings?.find((f: any) => f.field_key === 'notes');
              if (!notesField) return null;
              return (
                <UserFieldTemplatesHub
                  fieldKey="notes"
                  fieldLabel={notesField.label}
                  currentValue={props.formNotes}
                  onApply={props.setFormNotes}
                  stepLabel={props.stepContext?.stepLabel || null}
                  phaseLabel={props.stepContext?.phaseLabel || null}
                  objectiveLabel={props.stepContext?.objectiveLabel || null}
                  allSteps={props.stepContext?.allSteps || []}
                  activeStepId={props.stepContext?.stepId || null}
                  onSelectStep={props.setSelectedStepId}
                />
              );
            })()}
            {props.stepContext?.docChecklist && props.stepContext.docChecklist.length > 0 && (
              <StepChecklistButton
                stepLabel={props.stepContext.stepLabel}
                items={props.stepContext.docChecklist}
              />
            )}
          </div>
        </div>
        <CollapsibleContent className="pt-1.5 space-y-2.5">
          {(() => {
            const valueMap: Record<string, [string, (v: string) => void]> = {
              what_was_done: [props.formWhatWasDone, props.setFormWhatWasDone],
              current_status: [props.formCurrentStatus, props.setFormCurrentStatus],
              next_steps: [props.formNextSteps, props.setFormNextSteps],
              solicitacao: [props.formSolicitacao, props.setFormSolicitacao],
              resposta_juizo: [props.formRespostaJuizo, props.setFormRespostaJuizo],
              notes: [props.formNotes, props.setFormNotes],
            };
            const labelMap: Record<string, string> = {
              solicitacao: 'Solicitação',
              resposta_juizo: 'Resposta do juízo',
            };
            const compactEditorHeight = '160px';
            const renderField = (field: any) => {
              const entry = valueMap[field.field_key];
              if (!entry) return null;
              const [value, setter] = entry;
              const hubProps = {
                fieldKey: field.field_key,
                fieldLabel: field.label,
                currentValue: value,
                onApply: setter,
                stepLabel: props.stepContext?.stepLabel || null,
                phaseLabel: props.stepContext?.phaseLabel || null,
                objectiveLabel: props.stepContext?.objectiveLabel || null,
                allSteps: props.stepContext?.allSteps || [],
                activeStepId: props.stepContext?.stepId || null,
                onSelectStep: props.setSelectedStepId,
              };
              if (field.field_key === 'notes') {
                return (
                  <div key={field.field_key} className="min-w-0">
                    <ActivityNotesField
                      value={value}
                      onChange={setter}
                      activityId={props.selectedActivity?.id || null}
                      placeholder={field.placeholder || 'Notas adicionais...'}
                      label={field.label}
                      editorHeight={compactEditorHeight}
                      onPendingChange={props.onNotesPendingChange}
                      onCommitCandidatesChange={props.onNotesCommitCandidatesChange}
                      onUploadStateChange={props.onNotesUploadStateChange}
                      onExpand={() => setExpandedFieldKey('notes')}
                    />
                  </div>
                );
              }
              return (
                <div key={field.field_key} className="min-w-0 flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{field.label}</span>
                  <UserFieldTemplatesHub {...hubProps} />
                  <div className={cn('flex-1 min-h-0', expandedFieldKey === field.field_key ? 'hidden' : '')}>
                    <RichTextEditor
                      value={value}
                      onChange={setter}
                      placeholder={field.placeholder || ''}
                      minHeight={compactEditorHeight}
                      height={compactEditorHeight}
                      maxHeight={compactEditorHeight}
                      onExpand={() => setExpandedFieldKey(field.field_key)}
                      className="mt-0.5 h-full"
                      mentionOptions={mentionOptions}
                    />
                  </div>
                </div>
              );
            };
            // Render fixed extra field (label fallback when not in fieldSettings)
            const renderFixedExtra = (key: 'solicitacao' | 'resposta_juizo') => {
              const [value, setter] = valueMap[key];
              return (
                <div key={key} className="min-w-0 flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{labelMap[key]}</span>
                  <div className="flex-1 min-h-0">
                    <RichTextEditor
                      value={value}
                      onChange={setter}
                      placeholder=""
                      minHeight={compactEditorHeight}
                      height={compactEditorHeight}
                      maxHeight={compactEditorHeight}
                      onExpand={() => setExpandedFieldKey(key)}
                      className="mt-0.5 h-full"
                      mentionOptions={mentionOptions}
                    />
                  </div>
                </div>
              );
            };
            // Top 3 columns: Como está / O que foi feito / Próximos passos (in the order configured)
            const corePrimary = props.fieldSettings.filter((f: any) =>
              ['what_was_done', 'current_status', 'next_steps'].includes(f.field_key)
            );
            const coreSecondary = props.fieldSettings.filter((f: any) =>
              ['solicitacao', 'resposta_juizo'].includes(f.field_key)
            );
            const otherFields = props.fieldSettings.filter((f: any) =>
              valueMap[f.field_key] &&
              !['what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo'].includes(f.field_key)
            );
            // If solicitacao/resposta_juizo not configured in fieldSettings, render them as fixed extras
            const hasSolicitacaoConfigured = coreSecondary.some((f: any) => f.field_key === 'solicitacao');
            const hasRespostaConfigured = coreSecondary.some((f: any) => f.field_key === 'resposta_juizo');
            return (
              <>
                {corePrimary.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 items-stretch">
                    {corePrimary.map(renderField)}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 items-stretch">
                  {hasSolicitacaoConfigured
                    ? renderField(coreSecondary.find((f: any) => f.field_key === 'solicitacao'))
                    : renderFixedExtra('solicitacao')}
                  {hasRespostaConfigured
                    ? renderField(coreSecondary.find((f: any) => f.field_key === 'resposta_juizo'))
                    : renderFixedExtra('resposta_juizo')}
                </div>
                {otherFields.length > 0 && (
                  <div className="flex flex-col gap-2.5">
                    {otherFields.map(renderField)}
                  </div>
                )}
              </>
            );
          })()}
        </CollapsibleContent>
      </Collapsible>

      {/* === SHEET: Single field expanded === */}
      <Sheet open={!!expandedFieldKey} onOpenChange={(open) => { if (!open) setExpandedFieldKey(null); }}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col">
          {expandedFieldKey && (() => {
            const fieldValueMap: Record<string, [string, (v: string) => void]> = {
              what_was_done: [props.formWhatWasDone, props.setFormWhatWasDone],
              current_status: [props.formCurrentStatus, props.setFormCurrentStatus],
              next_steps: [props.formNextSteps, props.setFormNextSteps],
              solicitacao: [props.formSolicitacao, props.setFormSolicitacao],
              resposta_juizo: [props.formRespostaJuizo, props.setFormRespostaJuizo],
              notes: [props.formNotes, props.setFormNotes],
            };
            const fallbackLabels: Record<string, string> = {
              solicitacao: 'Solicitação',
              resposta_juizo: 'Resposta do juízo',
            };
            const fieldDef = props.fieldSettings.find((f: any) => f.field_key === expandedFieldKey);
            const entry = fieldValueMap[expandedFieldKey];
            if (!entry) return null;
            const [val, set] = entry;
            const label = fieldDef?.label || fallbackLabels[expandedFieldKey] || expandedFieldKey;
            const placeholder = fieldDef?.placeholder || '';
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="text-base">{label}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 pt-4">
                  <RichTextEditor
                    value={val}
                    onChange={set}
                    placeholder={placeholder}
                    minHeight="300px"
                    autoFocus
                    mentionOptions={mentionOptions}
                  />
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>


      {/* === SHEET: Link Lead === */}
      <Sheet open={linkLeadOpen} onOpenChange={setLinkLeadOpen}>
        <SheetContent className="w-full sm:max-w-sm flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-3 shrink-0 flex-row items-center justify-between space-y-0">
            <SheetTitle className="text-base">Vincular Lead</SheetTitle>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setNewLeadOpen(true)}>
              <Plus className="h-3 w-3" /> Novo lead
            </Button>
          </SheetHeader>
          <div className="px-6 pb-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lead..."
                value={props.leadSearch}
                onChange={e => props.setLeadSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ScrollArea className={cn("min-h-0 px-6", props.formLeadId ? "max-h-[35%]" : "flex-1")}>
              <div className="space-y-0.5 pb-2">
                {props.filteredLeads.map(l => (
                  <button
                    key={l.id}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors",
                      props.formLeadId === l.id && "bg-accent font-medium"
                    )}
                    onClick={() => {
                      props.handleSelectLead(l.id);
                      props.setLeadSearch('');
                      props.setFormCaseId('');
                      props.setFormCaseTitle('');
                      props.setFormProcessId('');
                      props.setFormProcessTitle('');
                      props.setCaseProcesses([]);
                    }}
                  >
                    {l.lead_name || 'Lead sem nome'}
                  </button>
                ))}
                {props.filteredLeads.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead encontrado</p>
                )}
              </div>
            </ScrollArea>

            {/* Cases of selected lead */}
            {props.formLeadId && (
              <div className="border-t shrink-0 px-6 pt-3 pb-2 max-h-[35%] overflow-y-auto bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Casos do lead</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 text-[10px]" onClick={() => setNewCaseOpen(true)}>
                    <Plus className="h-3 w-3" /> Novo caso
                  </Button>
                </div>
                <div className="mt-2 space-y-0.5">
                  {props.leadCases.length === 0 && (
                    <p className="text-[11px] text-muted-foreground py-2">Nenhum caso vinculado a este lead</p>
                  )}
                  {props.leadCases.map(c => (
                    <button
                      key={c.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors",
                        props.formCaseId === c.id && "bg-accent font-medium"
                      )}
                      onClick={async () => {
                        props.setFormCaseId(c.id);
                        props.setFormCaseTitle(`${c.case_number} - ${c.title}`);
                        props.setFormProcessId('');
                        props.setFormProcessTitle('');
                        const { data: procs } = await externalSupabase
                          .from('lead_processes')
                          .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
                          .eq('case_id', c.id);
                        const processItems = (procs || []).map((p: any) => ({ id: p.id, title: p.title, process_number: p.process_number, polo_passivo: p.polo_passivo, tribunal: p.tribunal, area: p.area, assuntos: p.assuntos, workflow_id: p.workflow_id, workflow_name: p.workflow_name, envolvidos: p.envolvidos }));
                        props.setCaseProcesses(processItems);
                      }}
                    >
                      <span className="font-medium">{c.case_number}</span> — {c.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Processes of selected case */}
            {props.formCaseId && (
              <div className="border-t shrink-0 px-6 pt-3 pb-2 max-h-[35%] overflow-y-auto bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Processos do caso</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 text-[10px]" onClick={() => setNewProcessOpen(true)}>
                    <Plus className="h-3 w-3" /> Novo processo
                  </Button>
                </div>
                <div className="mt-2 space-y-0.5">
                  {props.caseProcesses.length === 0 && (
                    <p className="text-[11px] text-muted-foreground py-2">Nenhum processo neste caso</p>
                  )}
                  {props.caseProcesses.map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors",
                        props.formProcessId === p.id && "bg-accent font-medium"
                      )}
                      onClick={() => {
                        props.setFormProcessId(p.id);
                        const label = [p.process_number, p.title].filter(Boolean).join(' - ');
                        props.setFormProcessTitle(label);
                      }}
                    >
                      {p.process_number && <span className="font-semibold">{p.process_number}</span>}
                      {p.process_number ? ' — ' : ''}<span className="font-medium">{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {props.formLeadId && (
            <div className="border-t px-6 py-3 shrink-0">
              <Button type="button" size="sm" className="w-full" onClick={() => setLinkLeadOpen(false)}>
                Confirmar
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* === SHEET: Link Contact === */}
      <Sheet open={linkContactOpen} onOpenChange={setLinkContactOpen}>
        <SheetContent className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle className="text-base">Vincular Contato</SheetTitle>
          </SheetHeader>
          <div className="pt-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                value={props.contactSearch}
                onChange={e => props.setContactSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
                autoFocus
              />
            </div>
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="space-y-0.5">
                {(props.contactSearch
                  ? props.availableContacts.filter(c => c.full_name?.toLowerCase().includes(props.contactSearch.toLowerCase()))
                  : props.availableContacts.slice(0, 50)
                ).map(c => (
                  <button
                    key={c.id}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors",
                      props.formContactId === c.id && "bg-accent font-medium"
                    )}
                    onClick={() => {
                      props.setFormContactId(c.id);
                      props.setFormContactName(c.full_name);
                      props.setContactSearch('');
                      setLinkContactOpen(false);
                    }}
                  >
                    {c.full_name}
                  </button>
                ))}
                {props.availableContacts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum contato encontrado</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      {/* === SHEET: Link Case === */}
      <Sheet open={linkCaseOpen} onOpenChange={setLinkCaseOpen}>
        <SheetContent className="w-full sm:max-w-sm flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-3 shrink-0">
            <SheetTitle className="text-base">Vincular Caso</SheetTitle>
          </SheetHeader>
          <div className="px-6 pb-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar caso..."
                value={props.caseSearch}
                onChange={e => props.setCaseSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ScrollArea className="flex-1 min-h-0 px-6">
              <div className="space-y-0.5 pb-2">
                {(() => {
                  const q = props.caseSearch.toLowerCase();
                  const matches = (c: { title: string; case_number: string }) =>
                    !q || c.title?.toLowerCase().includes(q) || c.case_number?.toLowerCase().includes(q);
                  let src: { id: string; case_number: string; title: string; lead_id?: string | null }[];
                  if (props.formLeadId) {
                    src = props.leadCases.filter(matches);
                  } else if (q) {
                    const local = props.availableCases.filter(matches);
                    const seen = new Set(local.map(c => c.id));
                    src = [...local, ...remoteCases.filter(c => !seen.has(c.id))];
                  } else {
                    src = props.availableCases.slice(0, 30);
                  }
                  return src.map(c => (
                    <button
                      key={c.id}
                      className={cn(
                        "w-full text-left px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors",
                        props.formCaseId === c.id && "bg-accent font-medium"
                      )}
                      onClick={async () => {
                        props.setFormCaseId(c.id);
                        props.setFormCaseTitle(`${c.case_number} - ${c.title}`);
                        props.setCaseSearch('');
                        props.setFormProcessId('');
                        props.setFormProcessTitle('');
                        if (!props.formLeadId) {
                          const fullCase = props.availableCases.find(ac => ac.id === c.id)
                            ?? remoteCases.find(rc => rc.id === c.id)
                            ?? c;
                          if (fullCase?.lead_id) {
                            const lead = props.leads.find(l => l.id === fullCase.lead_id);
                            if (lead) props.handleSelectLead(lead.id);
                          }
                        }
                        const { data: procs } = await externalSupabase
                          .from('lead_processes')
                          .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
                          .eq('case_id', c.id);
                        const processItems = (procs || []).map((p: any) => ({ id: p.id, title: p.title, process_number: p.process_number, polo_passivo: p.polo_passivo, tribunal: p.tribunal, area: p.area, assuntos: p.assuntos, workflow_id: p.workflow_id, workflow_name: p.workflow_name, envolvidos: p.envolvidos }));
                        props.setCaseProcesses(processItems);
                        if (processItems.length === 0) {
                          setLinkCaseOpen(false);
                        }
                      }}
                    >
                      <span className="font-medium">{c.case_number}</span> — {c.title}
                    </button>
                  ));
                })()}
              </div>
            </ScrollArea>

            {/* Process selection within case sheet */}
            {props.formCaseId && props.caseProcesses.length > 0 && (
              <div className="border-t shrink-0 px-6 pt-3 pb-2 max-h-[45%] overflow-y-auto bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Processos do caso</span>
                <div className="mt-2 space-y-0.5">
                  {props.caseProcesses.map(p => {
                    const parties = Array.isArray(p.envolvidos) ? p.envolvidos : [];
                    const firstParty = parties[0];
                    const remainingParties = parties.slice(1);
                    const firstAssunto = p.assuntos?.[0];

                    return (
                      <button
                        key={p.id}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors",
                          props.formProcessId === p.id && "bg-accent font-medium"
                        )}
                        onClick={() => {
                          props.setFormProcessId(p.id);
                          const label = [p.process_number, p.title].filter(Boolean).join(' - ');
                          props.setFormProcessTitle(label);
                        }}
                      >
                        <div className="flex flex-col gap-0.5">
                          <div>
                            {p.process_number && <span className="font-semibold">{p.process_number}</span>}
                            {p.process_number ? ' — ' : ''}<span className="font-medium">{p.title}</span>
                          </div>
                          {firstAssunto && (
                            <div className="text-[11px] text-muted-foreground">
                              📋 {firstAssunto}
                            </div>
                          )}
                          {(p.polo_passivo || p.tribunal) && (
                            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                              {p.polo_passivo && <span>⚔️ vs {p.polo_passivo}</span>}
                              {p.tribunal && <span>📍 {p.tribunal}</span>}
                            </div>
                          )}
                          {firstParty && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              👤 {firstParty.nome || firstParty.name || '—'}
                              {(firstParty.tipo_participacao || firstParty.role) && (
                                <span className="opacity-70"> ({firstParty.tipo_participacao || firstParty.role})</span>
                              )}
                              {remainingParties.length > 0 && (
                                <Collapsible>
                                  <CollapsibleTrigger
                                    className="text-[10px] text-primary hover:underline ml-1 inline-flex items-center gap-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    +{remainingParties.length} parte{remainingParties.length > 1 ? 's' : ''}
                                    <ChevronDown className="h-2.5 w-2.5" />
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <div className="mt-1 space-y-0.5 pl-4 border-l border-border/50">
                                      {remainingParties.map((party: any, idx: number) => (
                                        <div key={idx} className="text-[10px] text-muted-foreground">
                                          👤 {party.nome || party.name || '—'}
                                          {(party.tipo_participacao || party.role) && (
                                            <span className="opacity-70"> ({party.tipo_participacao || party.role})</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {props.formProcessTitle && (
                  <div className="flex items-center gap-1 mt-2">
                    <Badge variant="outline" className="text-[10px]">{props.formProcessTitle}</Badge>
                    <button type="button" onClick={() => { props.setFormProcessId(''); props.setFormProcessTitle(''); }} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {props.formCaseId && (
            <div className="border-t px-6 py-3 shrink-0">
              <Button type="button" size="sm" className="w-full" onClick={() => setLinkCaseOpen(false)}>
                Confirmar
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>


      <Suspense fallback={null}>
        {editProcessData && (
          <ProcessDetailSheet
            open={!!editProcessData}
            onOpenChange={(open) => { if (!open) setEditProcessData(null); }}
            process={editProcessData}
            mode="sheet"
            onUpdated={async () => {
              // Refresh in-memory caseProcesses so badge reflects new title/workflow
              if (props.formCaseId) {
                const { data: procs } = await externalSupabase
                  .from('lead_processes')
                  .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, workflow_name, envolvidos')
                  .eq('case_id', props.formCaseId);
                if (procs) props.setCaseProcesses(procs);
              }
            }}
          />
        )}
        {newProcessOpen && props.formCaseId && props.formLeadId && (
          <AddProcessDialog
            open={newProcessOpen}
            onOpenChange={setNewProcessOpen}
            caseId={props.formCaseId}
            leadId={props.formLeadId}
            onProcessAdded={refreshCaseProcesses}
          />
        )}
      </Suspense>

      {/* === Dialog: Novo Lead (minimal) === */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Novo lead</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Nome *</Label><Input value={newLeadName} onChange={e => setNewLeadName(e.target.value)} autoFocus /></div>
            <div><Label>Telefone</Label><Input value={newLeadPhone} onChange={e => setNewLeadPhone(e.target.value)} placeholder="(11) 99999-9999" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewLeadOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateLead} disabled={creatingLead || !newLeadName.trim()}>
              {creatingLead ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Dialog: Novo Caso (minimal) === */}
      <Dialog open={newCaseOpen} onOpenChange={setNewCaseOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Novo caso</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Título *</Label><Input value={newCaseTitle} onChange={e => setNewCaseTitle(e.target.value)} autoFocus /></div>
            <div><Label>Número (opcional)</Label><Input value={newCaseNumber} onChange={e => setNewCaseNumber(e.target.value)} placeholder="auto-gerado se vazio" /></div>
            <div>
              <Label>Núcleo Especializado</Label>
              <Select value={newCaseNucleusId} onValueChange={setNewCaseNucleusId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Nenhum (sequência geral)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum (sequência geral)</SelectItem>
                  {nuclei.filter(n => n.is_active).map(n => (
                    <SelectItem key={n.id} value={n.id}>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: n.color }} />
                        {n.name} ({n.prefix})
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCaseOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateCase} disabled={creatingCase || !newCaseTitle.trim()}>
              {creatingCase ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}