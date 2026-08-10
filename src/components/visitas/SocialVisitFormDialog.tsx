/**
 * Formulário único do agendamento — o mesmo no painel /visitas e na aba Visitas
 * dentro do lead. Quando aberto de dentro do lead, o lead vem travado (o vínculo
 * já está dado) e o endereço da visita é herdado do cadastro.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSocialVisits, type SocialVisit, type SocialVisitStatus } from '@/hooks/useSocialVisits';
import { VISIT_STATUS_LABELS, VISIT_STATUS_ORDER } from './visitStyles';
import { SocialWorkerPicker, type SocialWorkerValue } from './SocialWorkerPicker';
import { VisitLeadPicker, type VisitLeadOption } from './VisitLeadPicker';

/** Lead já definido pelo contexto (aba dentro do lead). */
export interface LockedLead {
  id: string;
  name: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visit?: SocialVisit | null;
  defaultDate?: string;
  lockedLead?: LockedLead | null;
}

const BR_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
];

const emptyForm = (defaultDate?: string, lockedLead?: LockedLead | null) => ({
  lead_id: lockedLead?.id || (null as string | null),
  lead_name: lockedLead?.name || (null as string | null),
  worker: { contactId: null, name: '', phone: null } as SocialWorkerValue,
  visit_date: defaultDate || new Date().toISOString().slice(0, 10),
  visit_time: '09:00',
  status: 'agendada' as SocialVisitStatus,
  address: lockedLead?.address || '',
  city: lockedLead?.city || '',
  state: lockedLead?.state || '',
  notes: '',
});

export function SocialVisitFormDialog({ open, onOpenChange, visit, defaultDate, lockedLead }: Props) {
  const { create, update, remove } = useSocialVisits({ enabled: false });
  const [form, setForm] = useState(emptyForm(defaultDate, lockedLead));

  useEffect(() => {
    if (!open) return;
    if (visit) {
      setForm({
        lead_id: visit.lead_id,
        lead_name: visit.lead_name,
        worker: {
          contactId: visit.social_worker_contact_id,
          name: visit.social_worker_name,
          phone: visit.social_worker_phone,
        },
        visit_date: visit.visit_date,
        visit_time: (visit.visit_time || '').slice(0, 5),
        status: visit.status,
        address: visit.address || '',
        city: visit.city || '',
        state: visit.state || '',
        notes: visit.notes || '',
      });
    } else {
      setForm(emptyForm(defaultDate, lockedLead));
    }
  }, [visit, defaultDate, lockedLead, open]);

  const set = <K extends keyof ReturnType<typeof emptyForm>>(
    key: K,
    value: ReturnType<typeof emptyForm>[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const pickLead = (lead: VisitLeadOption) => {
    setForm((prev) => ({
      ...prev,
      lead_id: lead.id,
      lead_name: lead.lead_name,
      // Só preenche o que está vazio: endereço já digitado à mão não é sobrescrito.
      address: prev.address || lead.visit_address || '',
      city: prev.city || lead.visit_city || lead.city || '',
      state: prev.state || lead.visit_state || lead.state || '',
    }));
  };

  const submit = async () => {
    if (!form.lead_id) {
      toast.error('Escolha o lead a ser visitado.');
      return;
    }
    if (!form.worker.name.trim()) {
      toast.error('Informe a assistente social responsável.');
      return;
    }
    if (!form.visit_date) {
      toast.error('Informe a data da visita.');
      return;
    }

    const payload = {
      lead_id: form.lead_id,
      lead_name: form.lead_name || null,
      social_worker_contact_id: form.worker.contactId,
      social_worker_name: form.worker.name.trim(),
      social_worker_phone: form.worker.phone || null,
      visit_date: form.visit_date,
      visit_time: form.visit_time || null,
      status: form.status,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (visit) await update.mutateAsync({ id: visit.id, patch: payload });
    else await create.mutateAsync(payload);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!visit) return;
    if (!confirm('Excluir esta visita da agenda? Ela sai do calendário e da aba do lead.')) return;
    await remove.mutateAsync(visit);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{visit ? 'Editar visita' : 'Agendar visita'}</DialogTitle>
          <DialogDescription>
            Visita da assistente social ao lead. Aparece no calendário /visitas e na aba Visitas do lead.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Lead a ser visitado *</Label>
            {lockedLead ? (
              <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {lockedLead.name || 'Lead sem nome'}
              </div>
            ) : (
              <VisitLeadPicker value={{ id: form.lead_id, name: form.lead_name }} onChange={pickLead} />
            )}
          </div>

          <div className="col-span-2">
            <Label>Assistente social responsável *</Label>
            <SocialWorkerPicker value={form.worker} onChange={(worker) => set('worker', worker)} />
          </div>

          <div>
            <Label>Data da visita *</Label>
            <Input
              type="date"
              value={form.visit_date}
              onChange={(e) => set('visit_date', e.target.value)}
            />
          </div>
          <div>
            <Label>Horário</Label>
            <Input
              type="time"
              value={form.visit_time}
              onChange={(e) => set('visit_time', e.target.value)}
            />
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v as SocialVisitStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VISIT_STATUS_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>{VISIT_STATUS_LABELS[status]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Telefone da assistente social</Label>
            <Input
              value={form.worker.phone || ''}
              onChange={(e) => set('worker', { ...form.worker, phone: e.target.value })}
              placeholder="(00) 00000-0000"
            />
          </div>

          <div className="col-span-2">
            <Label>Endereço da visita</Label>
            <Input
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Rua, número, bairro"
            />
          </div>

          <div>
            <Label>Cidade</Label>
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <Label>UF</Label>
            <Select
              value={form.state || '__none__'}
              onValueChange={(v) => set('state', v === '__none__' ? '' : v)}
            >
              <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {BR_STATES.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Ex: família só recebe de manhã, levar vídeo de instrução, confirmar por WhatsApp na véspera..."
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {visit ? (
            <Button variant="ghost" className="text-destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-1" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {visit ? 'Salvar' : 'Agendar visita'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
