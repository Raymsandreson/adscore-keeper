import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLeadActivities } from '@/hooks/useLeadActivities';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Plus } from 'lucide-react';
import { toast } from 'sonner';

const ACTIVITY_TYPES = [
  { value: 'tarefa', label: 'Tarefa' },
  { value: 'audiencia', label: 'Audiência' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'acompanhamento', label: 'Acompanhamento' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'diligencia', label: 'Diligência' },
];

const PRIORITY_OPTIONS = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

interface WhatsAppActivitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLeadId?: string;
  defaultLeadName?: string;
  defaultContactId?: string;
  defaultContactName?: string;
}

interface LeadOption {
  id: string;
  lead_name: string | null;
}

interface TeamMember {
  user_id: string;
  full_name: string | null;
}

export function WhatsAppActivitySheet({
  open,
  onOpenChange,
  defaultLeadId,
  defaultLeadName,
  defaultContactId,
  defaultContactName,
}: WhatsAppActivitySheetProps) {
  const { createActivity } = useLeadActivities();

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState('tarefa');
  const [formStatus, setFormStatus] = useState('pendente');
  const [formPriority, setFormPriority] = useState('normal');
  const [formDeadline, setFormDeadline] = useState('');
  const [formNotificationDate, setFormNotificationDate] = useState('');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formAssignedToName, setFormAssignedToName] = useState('');
  const [formLeadId, setFormLeadId] = useState('');
  const [formLeadName, setFormLeadName] = useState('');
  const [formContactId, setFormContactId] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formWhatWasDone, setFormWhatWasDone] = useState('');
  const [formCurrentStatus, setFormCurrentStatus] = useState('');
  const [formNextSteps, setFormNextSteps] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formRepeatWeekDays, setFormRepeatWeekDays] = useState<number[]>([]);

  // Data
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [contacts, setContacts] = useState<{ id: string; full_name: string }[]>([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // Reset and set defaults
      setFormTitle('');
      setFormType('tarefa');
      setFormStatus('pendente');
      setFormPriority('normal');
      setFormDeadline('');
      setFormNotificationDate('');
      // Default assignee set after team members load
      setFormLeadId(defaultLeadId || '');
      setFormLeadName(defaultLeadName || '');
      setFormContactId(defaultContactId || '');
      setFormContactName(defaultContactName || '');
      setFormWhatWasDone('');
      setFormCurrentStatus('');
      setFormNextSteps('');
      setFormNotes('');
      setFormRepeatWeekDays([]);
      setLeadSearch('');
      setContactSearch('');

      // Fetch data
      fetchLeads();
      fetchTeamMembers();
      fetchContacts();
    }
  }, [open, defaultLeadId, defaultLeadName, defaultContactId, defaultContactName]);

  const fetchLeads = async () => {
    const { data } = await supabase.from('leads').select('id, lead_name').order('created_at', { ascending: false }).limit(200);
    setLeads(data || []);
  };

  const fetchTeamMembers = async () => {
    const { data } = await supabase.from('profiles').select('user_id, full_name').order('full_name');
    setTeamMembers(data || []);
    // Default assignee to logged-in user
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const me = (data || []).find((m: TeamMember) => m.user_id === user.id);
      setFormAssignedTo(user.id);
      setFormAssignedToName(me?.full_name || '');
    }
  };

  const fetchContacts = async () => {
    const { data } = await supabase.from('contacts').select('id, full_name').order('full_name').limit(200);
    setContacts(data || []);
  };

  const handleSelectAssignee = (userId: string) => {
    setFormAssignedTo(userId);
    const member = teamMembers.find(m => m.user_id === userId);
    setFormAssignedToName(member?.full_name || '');
  };

  const handleSelectLead = (leadId: string) => {
    setFormLeadId(leadId);
    const lead = leads.find(l => l.id === leadId);
    setFormLeadName(lead?.lead_name || '');
  };

  const filteredLeads = leadSearch
    ? leads.filter(l => l.lead_name?.toLowerCase().includes(leadSearch.toLowerCase()))
    : leads.slice(0, 20);

  const filteredContacts = contactSearch
    ? contacts.filter(c => c.full_name?.toLowerCase().includes(contactSearch.toLowerCase()))
    : contacts.slice(0, 20);

  const handleSave = async () => {
    if (!formTitle.trim()) {
      toast.error('Informe o assunto da atividade');
      return;
    }
    setSaving(true);
    try {
      await createActivity({
        title: formTitle,
        activity_type: formType,
        status: formStatus,
        priority: formPriority,
        deadline: formDeadline || null,
        notification_date: formNotificationDate || null,
        assigned_to: formAssignedTo || null,
        assigned_to_name: formAssignedToName || null,
        lead_id: formLeadId || null,
        lead_name: formLeadName || null,
        contact_id: formContactId || null,
        contact_name: formContactName || null,
        what_was_done: formWhatWasDone || null,
        current_status_notes: formCurrentStatus || null,
        next_steps: formNextSteps || null,
        notes: formNotes || null,
      });
      onOpenChange(false);
    } catch {
      // error handled in hook
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Nova Atividade</SheetTitle>
          </div>
          {!formLeadId && (
            <p className="text-xs text-muted-foreground">
              Vincule um lead existente no formulário ou crie um novo.
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Assunto */}
          <div>
            <Label>Assunto da atividade *</Label>
            <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Ex: ACOMPANHAR PROTOCOLO" />
          </div>

          {/* Assessor + Tipo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Assessor</Label>
              <Select value={formAssignedTo} onValueChange={handleSelectAssignee}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {teamMembers.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.full_name || 'Sem nome'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de atividade</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Situação + Prioridade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Situação</Label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="concluida">Concluída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={formPriority} onValueChange={setFormPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Prazo + Notificação */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prazo da atividade</Label>
              <Input type="date" value={formDeadline} onChange={e => {
                setFormDeadline(e.target.value);
                if (!formNotificationDate) setFormNotificationDate(e.target.value);
              }} />
            </div>
            <div>
              <Label>Prazo de notificação</Label>
              <Input type="date" value={formNotificationDate} onChange={e => setFormNotificationDate(e.target.value)} />
            </div>
          </div>

          {/* Repetir dias */}
          <div>
            <Label className="text-xs">Repetir nos dias da semana</Label>
            <div className="flex gap-1 mt-1">
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day, idx) => {
                const isSelected = formRepeatWeekDays.includes(idx);
                return (
                  <Button
                    key={idx}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 w-9 px-0 text-[10px]"
                    onClick={() => setFormRepeatWeekDays(prev => isSelected ? prev.filter(d => d !== idx) : [...prev, idx])}
                  >
                    {day}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Lead */}
          <div>
            <Label>Nome do cliente (Lead)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar lead..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)} className="pl-9" />
            </div>
            {(leadSearch || !formLeadId) && (
              <div className="max-h-[100px] mt-1 border rounded-md overflow-y-auto">
                {filteredLeads.map(l => (
                  <button
                    key={l.id}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${formLeadId === l.id ? 'bg-accent font-medium' : ''}`}
                    onClick={() => { handleSelectLead(l.id); setLeadSearch(''); }}
                  >
                    {l.lead_name || 'Lead sem nome'}
                  </button>
                ))}
              </div>
            )}
            {formLeadName && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary">{formLeadName}</Badge>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setFormLeadId(''); setFormLeadName(''); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Contato */}
          <div>
            <Label>Contato vinculado</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar contato..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} className="pl-9" />
            </div>
            {(contactSearch || !formContactId) && (
              <div className="max-h-[100px] mt-1 border rounded-md overflow-y-auto">
                {filteredContacts.map(c => (
                  <button
                    key={c.id}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${formContactId === c.id ? 'bg-accent font-medium' : ''}`}
                    onClick={() => { setFormContactId(c.id); setFormContactName(c.full_name); setContactSearch(''); }}
                  >
                    {c.full_name}
                  </button>
                ))}
              </div>
            )}
            {formContactName && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary">{formContactName}</Badge>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setFormContactId(''); setFormContactName(''); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {/* O que foi feito */}
          <div>
            <Label>O que foi feito?</Label>
            <Textarea value={formWhatWasDone} onChange={e => setFormWhatWasDone(e.target.value)} placeholder="Descreva o que foi realizado..." rows={2} />
          </div>

          {/* Como está */}
          <div>
            <Label>Como está?</Label>
            <Textarea value={formCurrentStatus} onChange={e => setFormCurrentStatus(e.target.value)} placeholder="Situação atual do caso..." rows={2} />
          </div>

          {/* Próximo passo */}
          <div>
            <Label>Próximo passo</Label>
            <Textarea value={formNextSteps} onChange={e => setFormNextSteps(e.target.value)} placeholder="Qual será o próximo passo..." rows={2} />
          </div>

          {/* Observações */}
          <div>
            <Label>Observações</Label>
            <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Notas adicionais..." rows={2} />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 p-4 border-t bg-card flex gap-2">
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Criar Atividade'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
