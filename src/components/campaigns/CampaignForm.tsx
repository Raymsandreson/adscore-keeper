import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateCampaign, useUpdateCampaign, type Campaign, type CampaignStatus } from '@/hooks/useCampaigns';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useAuthContext } from '@/contexts/AuthContext';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign?: Campaign | null;
  onSaved?: (c: Campaign) => void;
}

const STATUS_OPTIONS: { value: CampaignStatus; label: string }[] = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'active', label: 'Ativa' },
  { value: 'paused', label: 'Pausada' },
  { value: 'closed', label: 'Encerrada' },
];

export default function CampaignForm({ open, onOpenChange, campaign, onSaved }: Props) {
  const { user } = useAuthContext();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const { boards } = useKanbanBoards();
  const workflowBoards = boards.filter((b) => b.board_type === 'workflow');

  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'draft' as CampaignStatus,
    start_date: '',
    end_date: '',
    board_id: '',
    investment_total: '0',
  });

  useEffect(() => {
    if (campaign) {
      setForm({
        name: campaign.name || '',
        description: campaign.description || '',
        status: campaign.status,
        start_date: campaign.start_date || '',
        end_date: campaign.end_date || '',
        board_id: campaign.board_id || '',
        investment_total: String(campaign.investment_total ?? 0),
      });
    } else {
      setForm({ name: '', description: '', status: 'draft', start_date: '', end_date: '', board_id: '', investment_total: '0' });
    }
  }, [campaign, open]);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    const payload: any = {
      name: form.name.trim(),
      description: form.description || null,
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      board_id: form.board_id || null,
      investment_total: parseFloat(form.investment_total) || 0,
    };
    let saved: Campaign;
    if (campaign?.id) {
      saved = await update.mutateAsync({ id: campaign.id, ...payload });
    } else {
      payload.created_by = user?.id;
      saved = await create.mutateAsync(payload);
    }
    onSaved?.(saved);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign ? 'Editar campanha' : 'Nova campanha'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label>Nome</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Mães Atípicas - Julho/26" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as CampaignStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Investimento (R$)</Label>
              <Input type="number" step="0.01" value={form.investment_total} onChange={(e) => setForm({ ...form, investment_total: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Início</Label>
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <Label>Fim</Label>
              <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Fluxo de trabalho</Label>
            <Select value={form.board_id || 'none'} onValueChange={(v) => setForm({ ...form, board_id: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Selecionar fluxo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem fluxo</SelectItem>
                {workflowBoards.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!form.name.trim() || create.isPending || update.isPending}>
            {campaign ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
