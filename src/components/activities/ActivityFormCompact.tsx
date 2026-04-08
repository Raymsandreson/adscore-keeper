import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Search, X, ChevronDown, Copy, Loader2, Maximize2 } from 'lucide-react';
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
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const [linkedOpen, setLinkedOpen] = useState(!!props.formLeadId || !!props.formContactId || !!props.formCaseId);

  return (
    <div className="space-y-3">
      {/* === ROW 1: Title === */}
      <Input
        value={props.formTitle}
        onChange={e => props.handleTitleChange(e.target.value)}
        placeholder="Assunto da atividade *"
        className="h-9 text-sm font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/60"
      />

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

      {/* === COLLAPSIBLE: Linked entities (Lead, Contact, Case) === */}
      <Collapsible open={linkedOpen} onOpenChange={setLinkedOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left py-1">
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", linkedOpen && "rotate-180")} />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Vínculos</span>
          {(props.formLeadName || props.formContactName || props.formCaseTitle) && (
            <div className="flex gap-1 ml-auto">
              {props.formLeadName && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{props.formLeadName}</Badge>}
              {props.formContactName && <Badge variant="outline" className="text-[9px] h-4 px-1.5">{props.formContactName}</Badge>}
            </div>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2.5 pt-1.5">
          {/* Lead */}
          <CompactSearchField
            label="Lead"
            placeholder="Buscar lead..."
            searchValue={props.leadSearch}
            onSearchChange={props.setLeadSearch}
            selectedName={props.formLeadName}
            onClear={props.handleClearLead}
            items={props.filteredLeads.map(l => ({ id: l.id, name: l.lead_name || 'Lead sem nome' }))}
            selectedId={props.formLeadId}
            onSelect={(id) => { props.handleSelectLead(id); props.setLeadSearch(''); }}
            showList={!!props.leadSearch || !props.formLeadId}
          />
          {/* Contact */}
          <CompactSearchField
            label="Contato"
            placeholder="Buscar contato..."
            searchValue={props.contactSearch}
            onSearchChange={props.setContactSearch}
            selectedName={props.formContactName}
            onClear={() => { props.setFormContactId(''); props.setFormContactName(''); }}
            items={(props.contactSearch
              ? props.availableContacts.filter(c => c.full_name?.toLowerCase().includes(props.contactSearch.toLowerCase()))
              : props.availableContacts.slice(0, 20)
            ).map(c => ({ id: c.id, name: c.full_name }))}
            selectedId={props.formContactId}
            onSelect={(id) => {
              const c = props.availableContacts.find(c => c.id === id);
              if (c) { props.setFormContactId(c.id); props.setFormContactName(c.full_name); props.setContactSearch(''); }
            }}
            showList={!!props.contactSearch || !props.formContactId}
          />
          {/* Case */}
          <CompactSearchField
            label="Caso"
            placeholder="Buscar caso..."
            searchValue={props.caseSearch}
            onSearchChange={props.setCaseSearch}
            selectedName={props.formCaseTitle}
            onClear={() => { props.setFormCaseId(''); props.setFormCaseTitle(''); props.setFormProcessId(''); props.setFormProcessTitle(''); props.setCaseProcesses([]); }}
            items={(() => {
              const src = props.formLeadId
                ? (props.caseSearch ? props.leadCases.filter(c => c.title?.toLowerCase().includes(props.caseSearch.toLowerCase()) || c.case_number?.toLowerCase().includes(props.caseSearch.toLowerCase())) : props.leadCases)
                : (props.caseSearch ? props.availableCases.filter(c => c.title?.toLowerCase().includes(props.caseSearch.toLowerCase()) || c.case_number?.toLowerCase().includes(props.caseSearch.toLowerCase())) : props.availableCases.slice(0, 20));
              return src.map(c => ({ id: c.id, name: `${c.case_number} — ${c.title}` }));
            })()}
            selectedId={props.formCaseId}
            onSelect={async (id) => {
              const c = [...props.leadCases, ...props.availableCases].find(c => c.id === id);
              if (!c) return;
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
            }}
            showList={!!props.caseSearch || !props.formCaseId}
          />
          {/* Process */}
          {props.formCaseId && props.caseProcesses.length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Processo</span>
              <ScrollArea className="max-h-[60px] mt-0.5 border rounded">
                {props.caseProcesses.map(p => (
                  <button
                    key={p.id}
                    className={cn("w-full text-left px-2 py-1 text-xs hover:bg-accent", props.formProcessId === p.id && "bg-accent font-medium")}
                    onClick={() => {
                      props.setFormProcessId(p.id);
                      props.setFormProcessTitle(p.process_number ? `${p.process_number} - ${p.title}` : p.title);
                    }}
                  >
                    {p.process_number && <span className="font-medium">{p.process_number}</span>}
                    {p.process_number ? ' — ' : ''}{p.title}
                  </button>
                ))}
              </ScrollArea>
              {props.formProcessTitle && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Badge variant="outline" className="text-[9px] h-4">{props.formProcessTitle}</Badge>
                  <button type="button" onClick={() => { props.setFormProcessId(''); props.setFormProcessTitle(''); }} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

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
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{field.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    title="Expandir campo"
                    onClick={() => setExpandedField({ key: field.field_key, label: field.label, value, setter, placeholder: field.placeholder || '' })}
                  >
                    <Maximize2 className="h-3 w-3" />
                  </Button>
                </div>
                <Textarea value={value} onChange={e => setter(e.target.value)} placeholder={field.placeholder || ''} rows={1} className="text-xs min-h-[32px] resize-none mt-0.5" />
              </div>
            );
          })}
        </CollapsibleContent>
      </Collapsible>

      {/* === SHEET: Single field expanded === */}
      <Sheet open={!!expandedField} onOpenChange={(open) => { if (!open) setExpandedField(null); }}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-base">{expandedField?.label}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 pt-4">
            <Textarea
              value={expandedField?.value || ''}
              onChange={e => expandedField?.setter(e.target.value)}
              placeholder={expandedField?.placeholder || ''}
              className="text-sm min-h-[300px] h-full resize-none"
            />
          </div>
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
    </div>
  );
}

/* === Detail fields sub-component === */
function DetailFields(props: ActivityFormCompactProps & { compact: boolean }) {
  return (
    <>
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
            <span className={cn("text-muted-foreground uppercase tracking-wider", props.compact ? "text-[10px]" : "text-xs font-medium")}>{field.label}</span>
            <Textarea
              value={value}
              onChange={e => setter(e.target.value)}
              placeholder={field.placeholder || ''}
              rows={props.compact ? 1 : 3}
              className={cn("mt-0.5", props.compact ? "text-xs min-h-[32px] resize-none" : "text-sm min-h-[80px]")}
            />
          </div>
        );
      })}
    </>
  );
}

/* === Compact search field sub-component === */
function CompactSearchField({
  label, placeholder, searchValue, onSearchChange, selectedName, onClear,
  items, selectedId, onSelect, showList
}: {
  label: string; placeholder: string;
  searchValue: string; onSearchChange: (v: string) => void;
  selectedName: string; onClear: () => void;
  items: { id: string; name: string }[];
  selectedId: string; onSelect: (id: string) => void;
  showList: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      {selectedName ? (
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge variant="secondary" className="text-[10px] h-5 max-w-[200px] truncate">{selectedName}</Badge>
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative mt-0.5">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder={placeholder}
              value={searchValue}
              onChange={e => onSearchChange(e.target.value)}
              className="h-7 text-xs pl-7"
            />
          </div>
          {showList && items.length > 0 && (
            <ScrollArea className="max-h-[80px] mt-0.5 border rounded">
              {items.map(item => (
                <button
                  key={item.id}
                  className={cn("w-full text-left px-2 py-1 text-xs hover:bg-accent", selectedId === item.id && "bg-accent font-medium")}
                  onClick={() => onSelect(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </ScrollArea>
          )}
        </>
      )}
    </div>
  );
}
