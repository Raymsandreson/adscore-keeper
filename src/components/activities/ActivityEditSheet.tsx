import { useState, useEffect, useCallback } from 'react';
import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { externalSupabase as supabase } from '@/integrations/supabase/external-client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

function copyField(text: string | null | undefined) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    toast.success(`"${text.length > 40 ? text.slice(0, 37) + '...' : text}" copiado!`, { duration: 1500 });
  }).catch(() => {});
}
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Save, Loader2, ChevronDown, CheckCircle2, Trash2, ExternalLink, X, Search } from 'lucide-react';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useProfilesList } from '@/hooks/useProfilesList';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { ActivityNotesField } from '@/components/activities/ActivityNotesField';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface ActivityEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string | null;
  onUpdated?: () => void;
}

interface ActivityData {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: string;
  priority: string | null;
  deadline: string | null;
  notification_date: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  case_id: string | null;
  case_title: string | null;
  process_id: string | null;
  process_title: string | null;
  what_was_done: string | null;
  current_status_notes: string | null;
  next_steps: string | null;
  notes: string | null;
  matrix_quadrant: string | null;
  created_at: string;
  completed_at: string | null;
}

const QUADRANT_OPTIONS = [
  { value: 'do_now', label: '🔥 Faça Agora' },
  { value: 'schedule', label: '📅 Agende' },
  { value: 'delegate', label: '🤝 Delegue' },
  { value: 'eliminate', label: '🗑️ Retire' },
];

export function ActivityEditSheet({ open, onOpenChange, activityId, onUpdated }: ActivityEditSheetProps) {
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  // Form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState('tarefa');
  const [status, setStatus] = useState('pendente');
  const [priority, setPriority] = useState('normal');
  const [deadline, setDeadline] = useState('');
  const [notificationDate, setNotificationDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedToName, setAssignedToName] = useState('');
  const [matrixQuadrant, setMatrixQuadrant] = useState('');
  const [whatWasDone, setWhatWasDone] = useState('');
  const [currentStatus, setCurrentStatus] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [notes, setNotes] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(true);

  // Linked entities (editable)
  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadName, setLeadName] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const [processId, setProcessId] = useState<string | null>(null);
  const [processTitle, setProcessTitle] = useState<string | null>(null);
  const [processNumber, setProcessNumber] = useState<string>('');

  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<{ id: string; lead_name: string | null }[]>([]);
  const [caseResults, setCaseResults] = useState<{ id: string; case_number: string | null; title: string | null }[]>([]);
  const [processResults, setProcessResults] = useState<{ id: string; title: string | null; process_number: string | null }[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);

  const { types: activityTypes } = useActivityTypes();
  const profiles = useProfilesList();

  const fetchActivity = useCallback(async () => {
    if (!activityId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('lead_activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle();

    if (error || !data) {
      toast.error('Erro ao carregar atividade');
      setLoading(false);
      return;
    }

    const act = data as ActivityData;
    setActivity(act);
    setTitle(act.title || '');
    setType(act.activity_type || 'tarefa');
    setStatus(act.status || 'pendente');
    setPriority(act.priority || 'normal');
    setDeadline(act.deadline ? act.deadline.slice(0, 16) : '');
    setNotificationDate(act.notification_date ? act.notification_date.slice(0, 16) : '');
    setAssignedTo(act.assigned_to || '');
    setAssignedToName(act.assigned_to_name || '');
    setMatrixQuadrant(act.matrix_quadrant || '');
    setWhatWasDone(act.what_was_done || '');
    setCurrentStatus(act.current_status_notes || '');
    setNextSteps(act.next_steps || '');
    setNotes(act.notes || '');
    setLeadId(act.lead_id || null);
    setLeadName(act.lead_name || null);
    setCaseId(act.case_id || null);
    setCaseTitle(act.case_title || null);
    setProcessId(act.process_id || null);
    setProcessTitle(act.process_title || null);
    // Fetch process_number if we have a process
    if (act.process_id) {
      supabase.from('lead_processes').select('process_number').eq('id', act.process_id).maybeSingle()
        .then(({ data }) => setProcessNumber((data as any)?.process_number || ''));
    } else {
      setProcessNumber('');
    }
    setLoading(false);
  }, [activityId]);

  // Search leads
  useEffect(() => {
    if (!leadOpen) return;
    const timer = setTimeout(async () => {
      const q = supabase.from('leads').select('id, lead_name').is('deleted_at', null).order('created_at', { ascending: false }).limit(30);
      const { data } = leadSearch.trim()
        ? await q.ilike('lead_name', `%${leadSearch.trim()}%`)
        : await q;
      setLeadResults((data || []) as any);
    }, 200);
    return () => clearTimeout(timer);
  }, [leadSearch, leadOpen]);

  // Fetch cases when lead changes / case popover opens
  useEffect(() => {
    if (!leadId) { setCaseResults([]); return; }
    supabase.from('legal_cases').select('id, case_number, title').eq('lead_id', leadId).is('deleted_at', null).order('created_at', { ascending: false })
      .then(({ data }) => setCaseResults((data || []) as any));
  }, [leadId]);

  // Fetch processes when case changes
  useEffect(() => {
    if (!caseId) { setProcessResults([]); return; }
    supabase.from('lead_processes').select('id, title, process_number').eq('case_id', caseId).order('created_at', { ascending: false })
      .then(({ data }) => setProcessResults((data || []) as any));
  }, [caseId]);


  useEffect(() => {
    if (open && activityId) {
      fetchActivity();
    }
  }, [open, activityId, fetchActivity]);

  const handleSave = async () => {
    if (!activityId) return;
    setSaving(true);
    const { error } = await supabase
      .from('lead_activities')
      .update({
        title,
        activity_type: type,
        status,
        priority,
        deadline: deadline || null,
        notification_date: notificationDate || null,
        assigned_to: assignedTo || null,
        assigned_to_name: assignedToName || null,
        matrix_quadrant: matrixQuadrant || null,
        what_was_done: whatWasDone || null,
        current_status_notes: currentStatus || null,
        next_steps: nextSteps || null,
        notes: notes || null,
        lead_id: leadId || null,
        lead_name: leadName || null,
        case_id: caseId || null,
        case_title: caseTitle || null,
        process_id: processId || null,
        process_title: processTitle || null,
        completed_at: status === 'concluida' && !activity?.completed_at ? new Date().toISOString() : activity?.completed_at,
      } as any)
      .eq('id', activityId);

    // Persist process_number back to lead_processes if it changed
    if (processId) {
      await supabase.from('lead_processes').update({ process_number: processNumber || null } as any).eq('id', processId);
    }

    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar');
    } else {
      toast.success('Atividade salva!');
      onUpdated?.();
      onOpenChange(false);
    }
  };

  const handleComplete = async () => {
    if (!activityId) return;
    const { data: { user } } = await cloudSupabase.auth.getUser();
    const { error } = await supabase
      .from('lead_activities')
      .update({
        status: 'concluida',
        completed_at: new Date().toISOString(),
        completed_by: user?.id || null,
      } as any)
      .eq('id', activityId);

    if (!error) {
      toast.success('Atividade concluída!');
      onUpdated?.();
      onOpenChange(false);
    }
  };

  const handleOpenFull = () => {
    if (activityId) {
      window.open(`${window.location.origin}/?openActivity=${activityId}`, '_blank');
    }
  };

  const getTypeColor = (key: string) => activityTypes.find(t => t.key === key)?.color || '#888';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Editar Atividade</SheetTitle>
            <Button variant="ghost" size="sm" onClick={handleOpenFull} className="gap-1 text-xs">
              <ExternalLink className="h-3 w-3" /> Abrir completo
            </Button>
          </div>
          {/* Linked entities badges */}
          {activity && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {activity.lead_name && (
                <Badge variant="outline" className="text-[10px] cursor-copy hover:bg-muted/50" onClick={() => copyField(activity.lead_name)} title="Copiar">Lead: {activity.lead_name}</Badge>
              )}
              {activity.contact_name && (
                <Badge variant="outline" className="text-[10px] cursor-copy hover:bg-muted/50" onClick={() => copyField(activity.contact_name)} title="Copiar">Contato: {activity.contact_name}</Badge>
              )}
              {activity.case_title && (
                <Badge variant="outline" className="text-[10px] cursor-copy hover:bg-muted/50" onClick={() => copyField(activity.case_title)} title="Copiar">Caso: {activity.case_title}</Badge>
              )}
            </div>
          )}
        </SheetHeader>

        {loading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {/* Title */}
              <div>
                <Label className="text-xs">Título</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} className="h-8 text-sm" />
              </div>

              {/* Type + Status + Priority row */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activityTypes.map(t => (
                        <SelectItem key={t.key} value={t.key}>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                            {t.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendente">Pendente</SelectItem>
                      <SelectItem value="em_andamento">Em andamento</SelectItem>
                      <SelectItem value="concluida">Concluída</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Prioridade</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Assignee + Quadrant */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Responsável</Label>
                  <Select value={assignedTo} onValueChange={(val) => {
                    setAssignedTo(val);
                    const p = profiles.find(p => p.user_id === val);
                    setAssignedToName(p?.full_name || '');
                  }}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {profiles.map(p => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.full_name || 'Sem nome'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Quadrante</Label>
                  <Select value={matrixQuadrant} onValueChange={setMatrixQuadrant}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      {QUADRANT_OPTIONS.map(q => (
                        <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Deadline + Notification */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Prazo</Label>
                  <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Notificação</Label>
                  <Input type="datetime-local" value={notificationDate} onChange={e => setNotificationDate(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>

              {/* Linked entities: Lead / Caso / Processo */}
              <div className="space-y-2 border-t pt-3">
                <Label className="text-xs font-semibold">Vínculos</Label>

                {/* Lead */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">Lead</Label>
                  <div className="flex gap-1">
                    <Popover open={leadOpen} onOpenChange={setLeadOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs flex-1 justify-between">
                          <span className="truncate">{leadName || 'Selecionar lead...'}</span>
                          <Search className="h-3 w-3 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[320px]" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput placeholder="Buscar lead..." value={leadSearch} onValueChange={setLeadSearch} className="h-8 text-xs" />
                          <CommandList>
                            <CommandEmpty className="text-xs py-4 text-center">Nenhum lead</CommandEmpty>
                            <CommandGroup>
                              {leadResults.map(l => (
                                <CommandItem key={l.id} value={l.id} onSelect={() => {
                                  setLeadId(l.id);
                                  setLeadName(l.lead_name);
                                  setCaseId(null); setCaseTitle(null);
                                  setProcessId(null); setProcessTitle(null); setProcessNumber('');
                                  setLeadOpen(false);
                                }} className="text-xs">
                                  {l.lead_name || '(sem nome)'}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {leadId && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        setLeadId(null); setLeadName(null);
                        setCaseId(null); setCaseTitle(null);
                        setProcessId(null); setProcessTitle(null); setProcessNumber('');
                      }} title="Remover">
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Caso */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">Caso</Label>
                  <div className="flex gap-1">
                    <Popover open={caseOpen} onOpenChange={setCaseOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs flex-1 justify-between" disabled={!leadId && caseResults.length === 0}>
                          <span className="truncate">{caseTitle || (leadId ? 'Selecionar caso...' : 'Selecione um lead primeiro')}</span>
                          <Search className="h-3 w-3 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[320px]" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar caso..." className="h-8 text-xs" />
                          <CommandList>
                            <CommandEmpty className="text-xs py-4 text-center">Nenhum caso</CommandEmpty>
                            <CommandGroup>
                              {caseResults.map(c => {
                                const label = [c.case_number, c.title].filter(Boolean).join(' — ');
                                return (
                                  <CommandItem key={c.id} value={c.id} onSelect={() => {
                                    setCaseId(c.id);
                                    setCaseTitle(label || c.title);
                                    setProcessId(null); setProcessTitle(null); setProcessNumber('');
                                    setCaseOpen(false);
                                  }} className="text-xs">
                                    {label}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {caseId && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        setCaseId(null); setCaseTitle(null);
                        setProcessId(null); setProcessTitle(null); setProcessNumber('');
                      }} title="Remover">
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Processo */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">Processo</Label>
                  <div className="flex gap-1">
                    <Popover open={processOpen} onOpenChange={setProcessOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs flex-1 justify-between" disabled={!caseId && processResults.length === 0}>
                          <span className="truncate">{processTitle || (caseId ? 'Selecionar processo...' : 'Selecione um caso primeiro')}</span>
                          <Search className="h-3 w-3 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[320px]" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar processo..." className="h-8 text-xs" />
                          <CommandList>
                            <CommandEmpty className="text-xs py-4 text-center">Nenhum processo</CommandEmpty>
                            <CommandGroup>
                              {processResults.map(p => {
                                const label = [p.process_number, p.title].filter(Boolean).join(' — ');
                                return (
                                  <CommandItem key={p.id} value={p.id} onSelect={() => {
                                    setProcessId(p.id);
                                    setProcessTitle(label || p.title);
                                    setProcessNumber(p.process_number || '');
                                    setProcessOpen(false);
                                  }} className="text-xs">
                                    {label}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {processId && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        setProcessId(null); setProcessTitle(null); setProcessNumber('');
                      }} title="Remover">
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {/* Número do Processo (editável) */}
                  <div className="mt-1">
                    <Label className="text-[10px] text-muted-foreground">Nº do Processo</Label>
                    <Input
                      value={processNumber}
                      onChange={e => setProcessNumber(e.target.value)}
                      placeholder={processId ? 'Ex: 0000000-00.0000.0.00.0000' : 'Selecione um processo para editar'}
                      disabled={!processId}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>


              {/* Details section (collapsible) */}
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-7">
                    Detalhes e Observações
                    <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 mt-2">
                  <ActivityNotesField
                    label="O que foi feito"
                    value={whatWasDone}
                    onChange={setWhatWasDone}
                    placeholder="Descreva o que foi realizado..."
                    activityId={activityId || undefined}
                  />
                  <ActivityNotesField
                    label="Status Atual"
                    value={currentStatus}
                    onChange={setCurrentStatus}
                    placeholder="Qual o status atual..."
                    activityId={activityId || undefined}
                  />
                  <ActivityNotesField
                    label="Próximos Passos"
                    value={nextSteps}
                    onChange={setNextSteps}
                    placeholder="O que precisa ser feito..."
                    activityId={activityId || undefined}
                  />
                  <ActivityNotesField
                    label="Observações"
                    value={notes}
                    onChange={setNotes}
                    placeholder="Anotações adicionais..."
                    activityId={activityId || undefined}
                  />
                </CollapsibleContent>
              </Collapsible>

              {/* Meta info */}
              {activity?.created_at && (
                <p className="text-[10px] text-muted-foreground">
                  Criada em {format(new Date(activity.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  {activity.completed_at && ` • Concluída em ${format(new Date(activity.completed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`}
                </p>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Footer actions */}
        <div className="shrink-0 border-t">
          <div className="flex items-center justify-between p-3">
            {activity?.status !== 'concluida' && (
              <Button variant="outline" size="sm" onClick={handleComplete} className="gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" /> Concluir
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
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
