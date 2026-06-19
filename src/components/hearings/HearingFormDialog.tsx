import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHearings, type Hearing, type HearingCategory, type HearingStatus } from '@/hooks/useHearings';
import { CATEGORY_LABELS, HEARING_TYPES, STATUS_LABELS, TIMEZONE_OPTIONS } from './hearingStyles';
import { Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hearing?: Hearing | null;
  defaultDate?: string;
}

const empty = (defaultDate?: string) => ({
  process_number: '',
  case_ref: '',
  hearing_type: 'UNA Virtual',
  category: 'civel' as HearingCategory,
  hearing_date: defaultDate || new Date().toISOString().slice(0, 10),
  hearing_time: '09:00',
  timezone_label: 'Padrão Brasília',
  status: 'ativa' as HearingStatus,
  location: '',
  notes: '',
});

export function HearingFormDialog({ open, onOpenChange, hearing, defaultDate }: Props) {
  const { create, update, remove } = useHearings();
  const [form, setForm] = useState(empty(defaultDate));

  useEffect(() => {
    if (hearing) {
      setForm({
        process_number: hearing.process_number || '',
        case_ref: hearing.case_ref || '',
        hearing_type: hearing.hearing_type || 'UNA Virtual',
        category: hearing.category,
        hearing_date: hearing.hearing_date,
        hearing_time: (hearing.hearing_time || '09:00').slice(0, 5),
        timezone_label: hearing.timezone_label || 'Padrão Brasília',
        status: hearing.status,
        location: hearing.location || '',
        notes: hearing.notes || '',
      });
    } else {
      setForm(empty(defaultDate));
    }
  }, [hearing, defaultDate, open]);

  const set = (k: keyof typeof form, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const payload: any = {
      process_number: form.process_number || null,
      case_ref: form.case_ref || null,
      hearing_type: form.hearing_type || null,
      category: form.category,
      hearing_date: form.hearing_date,
      hearing_time: form.hearing_time || null,
      timezone_label: form.timezone_label || null,
      status: form.status,
      location: form.location || null,
      notes: form.notes || null,
    };
    if (hearing) await update.mutateAsync({ id: hearing.id, patch: payload });
    else await create.mutateAsync(payload);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!hearing) return;
    if (!confirm('Excluir esta audiência?')) return;
    await remove.mutateAsync(hearing);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{hearing ? 'Editar audiência' : 'Nova audiência'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 md:col-span-1">
            <Label>Identificador interno</Label>
            <Input placeholder="CASO 295" value={form.case_ref} onChange={(e) => set('case_ref', e.target.value)} />
          </div>
          <div className="col-span-2 md:col-span-1">
            <Label>Número do processo</Label>
            <Input
              placeholder="0801799-23.2025.8.14.0125"
              value={form.process_number}
              onChange={(e) => set('process_number', e.target.value)}
            />
          </div>

          <div>
            <Label>Tipo</Label>
            <Select value={form.hearing_type} onValueChange={(v) => set('hearing_type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEARING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Categoria</Label>
            <Select value={form.category} onValueChange={(v) => set('category', v as HearingCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Data</Label>
            <Input type="date" value={form.hearing_date} onChange={(e) => set('hearing_date', e.target.value)} />
          </div>
          <div>
            <Label>Horário</Label>
            <Input type="time" value={form.hearing_time} onChange={(e) => set('hearing_time', e.target.value)} />
          </div>

          <div>
            <Label>Fuso/Localidade</Label>
            <Select value={form.timezone_label} onValueChange={(v) => set('timezone_label', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v as HearingStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Local (sala virtual, endereço)</Label>
            <Input value={form.location} onChange={(e) => set('location', e.target.value)} />
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              rows={3}
              placeholder="Ex: verificar obrigatoriedade da presença, pedir link à vara antes..."
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {hearing ? (
            <Button variant="ghost" className="text-destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-1" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {hearing ? 'Salvar' : 'Criar audiência'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
