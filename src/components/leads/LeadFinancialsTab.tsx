import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Edit2 } from 'lucide-react';
import { format } from 'date-fns';

interface LeadFinancial {
  id: string;
  lead_id: string | null;
  case_id: string | null;
  entry_type: 'entrada' | 'saida';
  amount: number;
  description: string | null;
  category: string | null;
  entry_date: string;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

interface LeadFinancialsTabProps {
  leadId: string;
  caseId?: string | null;
}

const CATEGORIES = [
  'Honorários', 'Custas Processuais', 'Perícia', 'Deslocamento', 'Documentação',
  'Publicidade/Anúncio', 'Comissão', 'Acordo', 'Pagamento Cliente', 'Outros',
];

export function LeadFinancialsTab({ leadId, caseId }: LeadFinancialsTabProps) {
  const [entries, setEntries] = useState<LeadFinancial[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LeadFinancial | null>(null);
  const [form, setForm] = useState({
    entry_type: 'saida' as 'entrada' | 'saida',
    amount: '',
    description: '',
    category: '',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    payment_method: '',
    notes: '',
  });

  const fetchEntries = async () => {
    setLoading(true);
    let query = supabase
      .from('lead_financials' as any)
      .select('*')
      .order('entry_date', { ascending: false });
    
    if (caseId) {
      query = query.or(`lead_id.eq.${leadId},case_id.eq.${caseId}`);
    } else {
      query = query.eq('lead_id', leadId);
    }

    const { data } = await query;
    setEntries((data as any[] || []) as LeadFinancial[]);
    setLoading(false);
  };

  useEffect(() => { fetchEntries(); }, [leadId, caseId]);

  const totals = useMemo(() => {
    const receitas = entries.filter(e => e.entry_type === 'entrada').reduce((s, e) => s + Number(e.amount), 0);
    const despesas = entries.filter(e => e.entry_type === 'saida').reduce((s, e) => s + Number(e.amount), 0);
    return { receitas, despesas, lucro: receitas - despesas };
  }, [entries]);

  const handleSave = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Informe o valor');
      return;
    }

    try {
      const payload = {
        lead_id: leadId,
        case_id: caseId || null,
        entry_type: form.entry_type,
        amount: parseFloat(form.amount),
        description: form.description || null,
        category: form.category || null,
        entry_date: form.entry_date,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
      };

      if (editingEntry) {
        await supabase.from('lead_financials' as any).update(payload).eq('id', editingEntry.id);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('lead_financials' as any).insert({ ...payload, created_by: user?.id });
      }

      toast.success(editingEntry ? 'Registro atualizado' : 'Registro adicionado');
      setDialogOpen(false);
      setEditingEntry(null);
      resetForm();
      fetchEntries();
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('lead_financials' as any).delete().eq('id', id);
    toast.success('Removido');
    fetchEntries();
  };

  const resetForm = () => {
    setForm({
      entry_type: 'saida',
      amount: '',
      description: '',
      category: '',
      entry_date: format(new Date(), 'yyyy-MM-dd'),
      payment_method: '',
      notes: '',
    });
  };

  const openEdit = (entry: LeadFinancial) => {
    setEditingEntry(entry);
    setForm({
      entry_type: entry.entry_type,
      amount: String(entry.amount),
      description: entry.description || '',
      category: entry.category || '',
      entry_date: entry.entry_date,
      payment_method: entry.payment_method || '',
      notes: entry.notes || '',
    });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="p-3 text-center">
            <TrendingUp className="h-4 w-4 text-green-600 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Receitas</p>
            <p className="text-sm font-bold text-green-600">{formatCurrency(totals.receitas)}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-3 text-center">
            <TrendingDown className="h-4 w-4 text-red-600 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Despesas</p>
            <p className="text-sm font-bold text-red-600">{formatCurrency(totals.despesas)}</p>
          </CardContent>
        </Card>
        <Card className={`border-${totals.lucro >= 0 ? 'blue' : 'amber'}-200 bg-${totals.lucro >= 0 ? 'blue' : 'amber'}-50/50`}>
          <CardContent className="p-3 text-center">
            <DollarSign className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Resultado</p>
            <p className={`text-sm font-bold ${totals.lucro >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>{formatCurrency(totals.lucro)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Add Button */}
      <Button size="sm" onClick={() => { resetForm(); setEditingEntry(null); setDialogOpen(true); }} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Novo Lançamento
      </Button>

      {/* List */}
      <ScrollArea className="max-h-[300px]">
        <div className="space-y-2">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground py-4">Carregando...</p>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">Nenhum lançamento financeiro</p>
          ) : entries.map(entry => (
            <div key={entry.id} className="flex items-center justify-between p-2 rounded border text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={entry.entry_type === 'entrada' ? 'default' : 'destructive'} className="text-xs flex-shrink-0">
                  {entry.entry_type === 'entrada' ? '📥' : '📤'}
                </Badge>
                <div className="min-w-0">
                  <p className="font-medium truncate">{entry.description || entry.category || 'Sem descrição'}</p>
                  <p className="text-xs text-muted-foreground">{entry.entry_date} {entry.category && `• ${entry.category}`}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className={`font-bold text-sm ${entry.entry_type === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                  {entry.entry_type === 'entrada' ? '+' : '-'}{formatCurrency(Number(entry.amount))}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(entry)}>
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(entry.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEntry ? 'Editar Lançamento' : 'Novo Lançamento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={form.entry_type === 'entrada' ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 ${form.entry_type === 'entrada' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={() => setForm(p => ({ ...p, entry_type: 'entrada' }))}
              >📥 Receita</Button>
              <Button
                type="button"
                variant={form.entry_type === 'saida' ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 ${form.entry_type === 'saida' ? 'bg-red-600 hover:bg-red-700' : ''}`}
                onClick={() => setForm(p => ({ ...p, entry_type: 'saida' }))}
              >📤 Despesa</Button>
            </div>
            <div>
              <Label className="text-xs">Valor *</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input placeholder="Descrição do lançamento" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editingEntry ? 'Atualizar' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
