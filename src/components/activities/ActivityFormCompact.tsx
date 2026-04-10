import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Search, X, ChevronDown, Copy, Loader2, UserPlus, Building2, Briefcase, Send, Info } from 'lucide-react';
import { ActivityTTSButton } from '@/components/voice/ActivityTTSButton';
import { ActivityFieldSettingsDialog } from '@/components/activities/ActivityFieldSettingsDialog';
import { ActivityMessageTemplateSettings } from '@/components/activities/ActivityMessageTemplateSettings';
import { ActivityNotesField } from '@/components/activities/ActivityNotesField';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

function copyField(text: string | null | undefined) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    toast.success(`"${text.length > 40 ? text.slice(0, 37) + '...' : text}" copiado!`, { duration: 1500 });
  }).catch(() => {
    toast.error('Falha ao copiar');
  });
}

interface TeamMember { user_id: string; full_name: string | null; }
interface LeadOption { id: string; lead_name: string | null; }

interface ActivityFormCompactProps {
  // Form values
  formTitle: string; setFormTitle: (v: string) => void;
  formAssignedTo: string; handleSelectAssignee: (v: string) => void;
  formType: string; setFormType: (v: string) => void;
  formStatus: string; setFormStatus: (v: string) => void;
  formPriority: string; setFormPriority: (v: string) => void;
  formDeadline: string; handleDeadlineChange: (v: string) => void;
  formNotificationDate: string; setFormNotificationDate: (v: string) => void;
  formMatrixQuadrant: string; setFormMatrixQuadrant: (v: string) => void;
  formLeadId: string; formLeadName: string;
  formContactId: string; formContactName: string;
  formCaseId: string; formCaseTitle: string;
  formProcessId: string; formProcessTitle: string;
  formRepeatWeekDays: number[]; setFormRepeatWeekDays: (v: number[] | ((prev: number[]) => number[])) => void;
  formWhatWasDone: string; setFormWhatWasDone: (v: string) => void;
  formCurrentStatus: string; setFormCurrentStatus: (v: string) => void;
  formNextSteps: string; setFormNextSteps: (v: string) => void;
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
  activeRoutine: any[];
  // WhatsApp message
  buildMsg?: () => string;
  formAssignedToName?: string;
  formLeadIdForTTS?: string;
  formContactIdForTTS?: string;
  // Supabase for case processes
  supabase: any;
  leads: LeadOption[];
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

export function SendToGroupSection({ buildMsg, leadId, fieldSettings, updateFieldSetting, reorderFields, formLeadIdForTTS, formContactIdForTTS, formAssignedTo }: {
  buildMsg: () => string;
  leadId: string;
  fieldSettings: any[];
  updateFieldSetting: any;
  reorderFields: any;
  formLeadIdForTTS?: string;
  formContactIdForTTS?: string;
  formAssignedTo?: string;
}) {
  const [sending, setSending] = useState(false);

  const handleSendToGroup = async () => {
    if (!leadId) {
      // No lead: send to assessor's WhatsApp instance as private message
      if (!formAssignedTo) {
        toast.error('Vincule um lead ou selecione um assessor para enviar');
        return;
      }
      setSending(true);
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('phone, default_instance_id, full_name')
          .eq('user_id', formAssignedTo)
          .maybeSingle();

        if (!profile?.phone) {
          toast.error('O assessor não possui telefone cadastrado no perfil');
          setSending(false);
          return;
        }
        if (!profile?.default_instance_id) {
          toast.error('O assessor não possui instância WhatsApp configurada');
          setSending(false);
          return;
        }

        const message = buildMsg();
        const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
          body: {
            phone: (profile.phone as string).replace(/\D/g, ''),
            message,
            instance_id: profile.default_instance_id,
          },
        });

        if (error || !data?.success) {
          toast.error(data?.error || 'Erro ao enviar mensagem');
        } else {
          toast.success(`Mensagem enviada para ${profile.full_name || 'o assessor'}!`);
        }
      } catch (e: any) {
        toast.error(e.message || 'Erro ao enviar');
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    try {
      const [leadRes, profileRes] = await Promise.all([
        supabase
          .from('leads')
          .select('whatsapp_group_id, group_link, lead_name, board_id')
          .eq('id', leadId)
          .single(),
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

      const lead = leadRes.data;
      const groupId = lead?.whatsapp_group_id;
      if (!groupId) {
        toast.error('Este lead não tem grupo WhatsApp vinculado');
        setSending(false);
        return;
      }

      let instanceId: string | undefined = profileRes || undefined;
      if (!instanceId && lead?.board_id) {
        const { data: boardInstances } = await supabase
          .from('board_group_instances')
          .select('instance_id')
          .eq('board_id', lead.board_id)
          .limit(1);
        instanceId = boardInstances?.[0]?.instance_id;
      }

      const message = buildMsg();
      const sendBody: Record<string, any> = { 
        phone: groupId, 
        chat_id: groupId, 
        message, 
        lead_id: leadId,
      };
      if (instanceId) sendBody.instance_id = instanceId;

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: sendBody,
      });

      if (error || !data?.success) {
        toast.error(data?.error || 'Erro ao enviar mensagem');
      } else {
        toast.success('Mensagem enviada ao grupo!');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar');
    } finally {
      setSending(false);
    }
  };

  const hasLead = !!leadId;
  const buttonLabel = hasLead ? 'Enviar ao Grupo' : 'Enviar ao Assessor';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button type="button" variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => { navigator.clipboard.writeText(buildMsg()); toast.success('Mensagem copiada!'); }}>
        <Copy className="h-3.5 w-3.5" /> Copiar
      </Button>
      <Button type="button" variant="default" size="sm" className="gap-1 h-8 text-xs" onClick={handleSendToGroup} disabled={sending}>
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        {buttonLabel}
      </Button>
      <ActivityTTSButton messageText={buildMsg()} leadId={formLeadIdForTTS} contactId={formContactIdForTTS} />
      <ActivityFieldSettingsDialog fields={fieldSettings} onUpdateField={updateFieldSetting} onReorder={reorderFields} />
      <ActivityMessageTemplateSettings />
    </div>
  );
}

export function ActivityFormCompact(props: ActivityFormCompactProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [expandedFieldKey, setExpandedFieldKey] = useState<string | null>(null);
  const [linkLeadOpen, setLinkLeadOpen] = useState(false);
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [linkCaseOpen, setLinkCaseOpen] = useState(false);

  return (
    <div className="space-y-3">
      {/* === ROW 1: Title === */}
      <div>
        <Input
          value={props.formTitle}
          onChange={e => props.handleTitleChange(e.target.value)}
          placeholder="Assunto da atividade *"
          className="h-9 text-sm font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/60"
        />
      </div>

      {/* === ROW 2: Hierarchy links - Lead → Caso → Processo === */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Lead */}
        {props.formLeadName ? (
          <div className="flex items-center gap-0.5">
            <Badge
              variant="secondary"
              className="text-[10px] h-6 max-w-[160px] truncate cursor-pointer hover:opacity-80 gap-1"
              onClick={() => setLinkLeadOpen(true)}
            >
              <Building2 className="h-3 w-3 shrink-0" />
              {props.formLeadName}
            </Badge>
            <button type="button" onClick={props.handleClearLead} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkLeadOpen(true)}>
            <Building2 className="h-3 w-3" /> Lead
          </Button>
        )}

        {/* Separator → */}
        {props.formLeadName && <span className="text-muted-foreground text-xs">→</span>}

        {/* Case (only show if lead is selected, or always as option) */}
        {props.formCaseTitle ? (
          <div className="flex items-center gap-0.5">
            <Badge
              variant="secondary"
              className="text-[10px] h-6 max-w-[160px] truncate cursor-copy hover:opacity-80 gap-1 bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
              onClick={() => copyField(props.formCaseTitle)}
              title="Clique para copiar"
            >
              <Briefcase className="h-3 w-3 shrink-0" />
              {props.formCaseTitle}
            </Badge>
            <button type="button" onClick={() => { props.setFormCaseId(''); props.setFormCaseTitle(''); props.setFormProcessId(''); props.setFormProcessTitle(''); props.setCaseProcesses([]); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkCaseOpen(true)}>
            <Briefcase className="h-3 w-3" /> Caso
          </Button>
        )}

        {/* Separator → */}
        {props.formCaseId && <span className="text-muted-foreground text-xs">→</span>}

        {/* Process (only show if case is selected) */}
        {props.formCaseId && (
          props.formProcessTitle ? (() => {
            const selectedProc = props.caseProcesses.find(p => p.id === props.formProcessId);
            const firstAssunto = selectedProc?.assuntos?.[0];
            return (
              <div className="flex items-center gap-0.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-auto max-w-[180px] cursor-pointer hover:opacity-80 gap-1 bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 flex flex-col items-start py-0.5 px-2"
                    >
                      <span className="truncate w-full">{props.formProcessTitle}</span>
                      {firstAssunto && (
                        <span className="text-[9px] opacity-70 truncate w-full">({firstAssunto})</span>
                      )}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3 text-xs space-y-2" side="bottom" align="start">
                    <div className="font-semibold text-sm">Detalhes do Processo</div>
                    {selectedProc?.process_number && (
                      <div><span className="text-muted-foreground">Número:</span> {selectedProc.process_number}</div>
                    )}
                    {selectedProc?.title && (
                      <div><span className="text-muted-foreground">Título:</span> {selectedProc.title}</div>
                    )}
                    {selectedProc?.assuntos && selectedProc.assuntos.length > 0 && (
                      <div><span className="text-muted-foreground">Assuntos:</span> {selectedProc.assuntos.join(', ')}</div>
                    )}
                    {selectedProc?.polo_passivo && (
                      <div><span className="text-muted-foreground">Polo Passivo:</span> {selectedProc.polo_passivo}</div>
                    )}
                    {selectedProc?.tribunal && (
                      <div><span className="text-muted-foreground">Tribunal/Vara:</span> {selectedProc.tribunal}</div>
                    )}
                    {selectedProc?.area && (
                      <div><span className="text-muted-foreground">Área:</span> {selectedProc.area}</div>
                    )}
                    {selectedProc?.envolvidos && selectedProc.envolvidos.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Partes:</span>
                        <ul className="ml-2 mt-0.5 space-y-0.5">
                          {selectedProc.envolvidos.map((e: any, i: number) => (
                            <li key={i}>👤 {e.nome || e.name}{e.tipo_participacao ? ` (${e.tipo_participacao})` : ''}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <Button type="button" variant="outline" size="sm" className="w-full mt-1 text-[10px] h-6" onClick={() => setLinkCaseOpen(true)}>
                      Trocar processo
                    </Button>
                  </PopoverContent>
                </Popover>
                <button type="button" onClick={() => { props.setFormProcessId(''); props.setFormProcessTitle(''); }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })() : props.caseProcesses.length > 0 ? (
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkCaseOpen(true)}>
              Processo
            </Button>
          ) : null
        )}

        {/* Contact */}
        <span className="text-muted-foreground text-xs">|</span>
        {props.formContactName ? (
          <div className="flex items-center gap-0.5">
            <Badge
              variant="outline"
              className="text-[10px] h-6 max-w-[160px] truncate cursor-copy hover:opacity-80 gap-1"
              onClick={() => copyField(props.formContactName)}
              title="Clique para copiar"
            >
              <UserPlus className="h-3 w-3 shrink-0" />
              {props.formContactName}
            </Badge>
            <button type="button" onClick={() => { props.setFormContactId(''); props.setFormContactName(''); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setLinkContactOpen(true)}>
            <UserPlus className="h-3 w-3" /> Contato
          </Button>
        )}
      </div>

      {/* === ROW 2: Core selects - 4 columns === */}
      <div className="grid grid-cols-4 gap-2">
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Assessor</span>
          <Select value={props.formAssignedTo} onValueChange={props.handleSelectAssignee}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {props.teamMembers.map(m => (
                <SelectItem key={m.user_id} value={m.user_id} className="text-xs">{m.full_name || 'Sem nome'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            Tipo *{props.aiSuggestingType && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          </span>
          <Select value={props.formType} onValueChange={props.setFormType}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {props.routineActivityTypes.map(t => (
                <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Situação</span>
          <Select value={props.formStatus} onValueChange={props.setFormStatus}>
            <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente" className="text-xs">Pendente</SelectItem>
              <SelectItem value="em_andamento" className="text-xs">Em Andamento</SelectItem>
              <SelectItem value="concluida" className="text-xs">Concluída</SelectItem>
            </SelectContent>
          </Select>
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

      {/* === ROW 3: Matrix as inline chips === */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">Matriz</span>
        {MATRIX_OPTIONS.map(q => {
          const isActive = props.formMatrixQuadrant === q.value;
          return (
            <button
              key={q.value}
              type="button"
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                isActive ? q.active : q.color,
                !isActive && 'hover:opacity-80'
              )}
              onClick={() => props.setFormMatrixQuadrant(isActive ? '' : q.value)}
            >
              {q.emoji} {q.label}
            </button>
          );
        })}
      </div>

      {/* === ROW 4: Dates side by side === */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">📅 Prazo</span>
            {props.deadlineDateCount !== null && props.formDeadline && (
              <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full",
                props.deadlineDateCount > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
              )}>
                {props.deadlineDateCount} atv
              </span>
            )}
          </div>
          <Input type="date" value={props.formDeadline} onChange={e => props.handleDeadlineChange(e.target.value)} className="h-8 text-xs" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">🔔 Notificação</span>
            {props.notifDateCount !== null && props.formNotificationDate && (
              <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full",
                props.notifDateCount > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
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
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left py-1">
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", detailsOpen && "rotate-180")} />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Detalhes e Observações</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2.5 pt-1.5">
          {props.fieldSettings.map(field => {
            const valueMap: Record<string, [string, (v: string) => void]> = {
              what_was_done: [props.formWhatWasDone, props.setFormWhatWasDone],
              current_status: [props.formCurrentStatus, props.setFormCurrentStatus],
              next_steps: [props.formNextSteps, props.setFormNextSteps],
              notes: [props.formNotes, props.setFormNotes],
            };
            const entry = valueMap[field.field_key];
            if (!entry) return null;
            const [value, setter] = entry;

            if (field.field_key === 'notes') {
              return (
                <ActivityNotesField
                  key={field.field_key}
                  value={value}
                  onChange={setter}
                  activityId={props.selectedActivity?.id || null}
                  placeholder={field.placeholder || 'Notas adicionais...'}
                  label={field.label}
                />
              );
            }

            return (
              <div key={field.field_key}>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{field.label}</span>
                <div className={expandedFieldKey === field.field_key ? 'hidden' : ''}>
                  <RichTextEditor
                    value={value}
                    onChange={setter}
                    placeholder={field.placeholder || ''}
                    minHeight="32px"
                    onExpand={() => setExpandedFieldKey(field.field_key)}
                    className="mt-0.5"
                  />
                </div>
              </div>
            );
          })}
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
              notes: [props.formNotes, props.setFormNotes],
            };
            const fieldDef = props.fieldSettings.find((f: any) => f.field_key === expandedFieldKey);
            const entry = fieldValueMap[expandedFieldKey];
            if (!fieldDef || !entry) return null;
            const [val, set] = entry;
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="text-base">{fieldDef.label}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 pt-4">
                  <RichTextEditor
                    value={val}
                    onChange={set}
                    placeholder={fieldDef.placeholder || ''}
                    minHeight="300px"
                    autoFocus
                  />
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>


      {/* === SHEET: Link Lead === */}
      <Sheet open={linkLeadOpen} onOpenChange={setLinkLeadOpen}>
        <SheetContent className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle className="text-base">Vincular Lead</SheetTitle>
          </SheetHeader>
          <div className="pt-4 space-y-3">
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
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="space-y-0.5">
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
                      setLinkLeadOpen(false);
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
          </div>
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
        <SheetContent className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle className="text-base">Vincular Caso</SheetTitle>
          </SheetHeader>
          <div className="pt-4 space-y-3">
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
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="space-y-0.5">
                {(() => {
                  const src = props.formLeadId
                    ? (props.caseSearch ? props.leadCases.filter(c => c.title?.toLowerCase().includes(props.caseSearch.toLowerCase()) || c.case_number?.toLowerCase().includes(props.caseSearch.toLowerCase())) : props.leadCases)
                    : (props.caseSearch ? props.availableCases.filter(c => c.title?.toLowerCase().includes(props.caseSearch.toLowerCase()) || c.case_number?.toLowerCase().includes(props.caseSearch.toLowerCase())) : props.availableCases.slice(0, 30));
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
                          const fullCase = props.availableCases.find(ac => ac.id === c.id);
                          if (fullCase?.lead_id) {
                            const lead = props.leads.find(l => l.id === fullCase.lead_id);
                            if (lead) props.handleSelectLead(lead.id);
                          }
                        }
                        const { data: procs } = await props.supabase
                          .from('lead_processes')
                          .select('id, title, process_number, polo_passivo, tribunal, area, assuntos, workflow_id, envolvidos')
                          .eq('case_id', c.id);
                        const processItems = (procs || []).map((p: any) => ({ id: p.id, title: p.title, process_number: p.process_number, polo_passivo: p.polo_passivo, tribunal: p.tribunal, area: p.area, assuntos: p.assuntos, workflow_id: p.workflow_id, envolvidos: p.envolvidos }));
                        props.setCaseProcesses(processItems);
                        // Only close sheet if no processes to select
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
              <div className="border-t pt-3">
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
                          "w-full text-left px-3 py-2.5 text-sm rounded-md hover:bg-accent transition-colors",
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
            {props.formCaseId && (
              <div className="border-t pt-3 mt-3">
                <Button type="button" size="sm" className="w-full" onClick={() => setLinkCaseOpen(false)}>
                  Confirmar
                </Button>
              </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}