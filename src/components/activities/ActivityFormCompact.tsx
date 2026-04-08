import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Search, X, ChevronDown, Copy, Loader2, UserPlus, Building2, Briefcase } from 'lucide-react';
import { ActivityTTSButton } from '@/components/voice/ActivityTTSButton';
import { ActivityFieldSettingsDialog } from '@/components/activities/ActivityFieldSettingsDialog';
import { ActivityNotesField } from '@/components/activities/ActivityNotesField';
import { cn } from '@/lib/utils';

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
  caseProcesses: { id: string; title: string; process_number: string | null }[];
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

export function ActivityFormCompact(props: ActivityFormCompactProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedFieldKey, setExpandedFieldKey] = useState<string | null>(null);
  const [linkLeadOpen, setLinkLeadOpen] = useState(false);
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [linkCaseOpen, setLinkCaseOpen] = useState(false);

  return (
    <div className="space-y-3">
      {/* === ROW 1: Title + Link buttons === */}
      <div className="flex items-center gap-2">
        <Input
          value={props.formTitle}
          onChange={e => props.handleTitleChange(e.target.value)}
          placeholder="Assunto da atividade *"
          className="h-9 text-sm font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/60 flex-1"
        />
        <div className="flex items-center gap-1 shrink-0">
          {/* Lead link button */}
          {props.formLeadName ? (
            <div className="flex items-center gap-0.5">
              <Badge
                variant="secondary"
                className="text-[9px] h-5 max-w-[120px] truncate cursor-pointer hover:opacity-80"
                onClick={() => setLinkLeadOpen(true)}
              >
                {props.formLeadName}
              </Badge>
              <button type="button" onClick={props.handleClearLead} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1 text-muted-foreground" onClick={() => setLinkLeadOpen(true)}>
              <Building2 className="h-3 w-3" /> Lead
            </Button>
          )}
          {/* Contact link button */}
          {props.formContactName ? (
            <div className="flex items-center gap-0.5">
              <Badge
                variant="outline"
                className="text-[9px] h-5 max-w-[120px] truncate cursor-pointer hover:opacity-80"
                onClick={() => setLinkContactOpen(true)}
              >
                {props.formContactName}
              </Badge>
              <button type="button" onClick={() => { props.setFormContactId(''); props.setFormContactName(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1 text-muted-foreground" onClick={() => setLinkContactOpen(true)}>
              <UserPlus className="h-3 w-3" /> Contato
            </Button>
          )}
          {/* Case link button */}
          {props.formCaseTitle ? (
            <div className="flex items-center gap-0.5">
              <Badge
                variant="secondary"
                className="text-[9px] h-5 max-w-[120px] truncate cursor-pointer hover:opacity-80 bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
                onClick={() => setLinkCaseOpen(true)}
              >
                {props.formCaseTitle}
              </Badge>
              <button type="button" onClick={() => { props.setFormCaseId(''); props.setFormCaseTitle(''); props.setFormProcessId(''); props.setFormProcessTitle(''); props.setCaseProcesses([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1 text-muted-foreground" onClick={() => setLinkCaseOpen(true)}>
              <Briefcase className="h-3 w-3" /> Caso
            </Button>
          )}
        </div>
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
                {expandedFieldKey === field.field_key ? (
                  <div className="mt-0.5 min-h-8 rounded-md border border-dashed border-border bg-muted/20" />
                ) : (
                  <RichTextEditor
                    value={value}
                    onChange={setter}
                    placeholder={field.placeholder || ''}
                    minHeight="32px"
                    onExpand={() => setExpandedFieldKey(field.field_key)}
                    className="mt-0.5"
                  />
                )}
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

      {/* === WhatsApp Actions === */}
      {props.buildMsg && (
        <div className="flex items-center gap-2 pt-1 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 h-8 text-xs"
            onClick={() => {
              if (props.buildMsg) {
                navigator.clipboard.writeText(props.buildMsg());
                import('sonner').then(({ toast }) => toast.success('Mensagem copiada!'));
              }
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Gerar mensagem WhatsApp
          </Button>
          <ActivityTTSButton messageText={props.buildMsg()} leadId={props.formLeadIdForTTS} contactId={props.formContactIdForTTS} />
          <ActivityFieldSettingsDialog fields={props.fieldSettings} onUpdateField={props.updateFieldSetting} onReorder={props.reorderFields} />
        </div>
      )}

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
                          .select('id, title, process_number')
                          .eq('case_id', c.id);
                        props.setCaseProcesses((procs || []).map((p: any) => ({ id: p.id, title: p.title, process_number: p.process_number })));
                        setLinkCaseOpen(false);
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
                  {props.caseProcesses.map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors",
                        props.formProcessId === p.id && "bg-accent font-medium"
                      )}
                      onClick={() => {
                        props.setFormProcessId(p.id);
                        props.setFormProcessTitle(p.process_number ? `${p.process_number} - ${p.title}` : p.title);
                      }}
                    >
                      {p.process_number && <span className="font-medium">{p.process_number}</span>}
                      {p.process_number ? ' — ' : ''}{p.title}
                    </button>
                  ))}
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
        </SheetContent>
      </Sheet>
    </div>
  );
}