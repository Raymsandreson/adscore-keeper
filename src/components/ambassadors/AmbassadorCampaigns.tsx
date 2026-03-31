import { useState, useMemo } from 'react';
import { useAmbassadors, AmbassadorCampaign } from '@/hooks/useAmbassadors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Loader2, Pencil, Trophy, Calendar, Target, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const METRIC_OPTIONS = [
  { value: 'leads_captured', label: 'Leads Captados' },
  { value: 'leads_converted', label: 'Leads Convertidos (Fechados)' },
];

export function AmbassadorCampaigns() {
  const { campaigns, loading, createCampaign, updateCampaign } = useAmbassadors();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AmbassadorCampaign | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    period_start: '',
    period_end: '',
    metric_key: 'leads_captured',
    target_value: 10,
    reward_value: 100,
    min_threshold_percent: 70,
    accelerator_multiplier: 1.5,
    cap_percent: 200,
    is_active: true,
  });

  const openCreate = () => {
    setEditing(null);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setForm({
      name: '',
      description: '',
      period_start: format(start, 'yyyy-MM-dd'),
      period_end: format(end, 'yyyy-MM-dd'),
      metric_key: 'leads_captured',
      target_value: 10,
      reward_value: 100,
      min_threshold_percent: 70,
      accelerator_multiplier: 1.5,
      cap_percent: 200,
      is_active: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (c: AmbassadorCampaign) => {
    setEditing(c);
    setForm({
      name: c.name,
      description: c.description || '',
      period_start: c.period_start,
      period_end: c.period_end,
      metric_key: c.metric_key,
      target_value: c.target_value,
      reward_value: c.reward_value,
      min_threshold_percent: c.min_threshold_percent,
      accelerator_multiplier: c.accelerator_multiplier ?? 1.5,
      cap_percent: c.cap_percent ?? 200,
      is_active: c.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return; }
    if (!form.period_start || !form.period_end) { toast.error('Período é obrigatório'); return; }
    try {
      if (editing) {
        await updateCampaign(editing.id, form);
      } else {
        await createCampaign(form);
      }
      setDialogOpen(false);
    } catch {}
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Campanhas & Metas</h3>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Nova Campanha
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campaigns.map(c => (
          <Card key={c.id} className={!c.is_active ? 'opacity-60' : ''}>
            <CardContent className="pt-4 pb-3 px-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <p className="font-semibold text-sm">{c.name}</p>
                </div>
                <div className="flex items-center gap-1">
                  {!c.is_active && <Badge variant="secondary" className="text-[10px]">Inativa</Badge>}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(c.period_start + 'T12:00:00'), 'dd/MM', { locale: ptBR })} - {format(new Date(c.period_end + 'T12:00:00'), 'dd/MM', { locale: ptBR })}
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Target className="h-3 w-3" />
                  Meta: {c.target_value} ({METRIC_OPTIONS.find(m => m.value === c.metric_key)?.label})
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <DollarSign className="h-3 w-3" />
                  R$ {c.reward_value.toFixed(2)}
                </div>
                <div className="text-muted-foreground">
                  Mín: {c.min_threshold_percent}% · Teto: {c.cap_percent}%
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {campaigns.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma campanha criada. Clique em "Nova Campanha" para definir metas e recompensas.
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Campanha' : 'Nova Campanha'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label>Nome da campanha *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Meta Março 2026" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Início</Label>
                <Input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
              </div>
              <div>
                <Label>Fim</Label>
                <Input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Métrica da meta</Label>
              <Select value={form.metric_key} onValueChange={v => setForm(f => ({ ...f, metric_key: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Meta (quantidade)</Label>
                <Input type="number" value={form.target_value} onChange={e => setForm(f => ({ ...f, target_value: Number(e.target.value) }))} min={1} />
              </div>
              <div>
                <Label>Recompensa (R$)</Label>
                <Input type="number" value={form.reward_value} onChange={e => setForm(f => ({ ...f, reward_value: Number(e.target.value) }))} min={0} step={10} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Mínimo (%)</Label>
                <Input type="number" value={form.min_threshold_percent} onChange={e => setForm(f => ({ ...f, min_threshold_percent: Number(e.target.value) }))} min={0} max={100} />
              </div>
              <div>
                <Label>Acelerador (×)</Label>
                <Input type="number" value={form.accelerator_multiplier} onChange={e => setForm(f => ({ ...f, accelerator_multiplier: Number(e.target.value) }))} min={1} step={0.1} />
              </div>
              <div>
                <Label>Teto (%)</Label>
                <Input type="number" value={form.cap_percent} onChange={e => setForm(f => ({ ...f, cap_percent: Number(e.target.value) }))} min={100} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              O embaixador precisa atingir pelo menos {form.min_threshold_percent}% da meta para receber. 
              Acima de 100%, o valor é multiplicado por {form.accelerator_multiplier}×, com teto de {form.cap_percent}% do valor base.
            </p>
            {editing && (
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>Campanha ativa</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editing ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
