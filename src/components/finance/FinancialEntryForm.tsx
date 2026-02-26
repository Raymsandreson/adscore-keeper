import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CategorySelector } from '@/components/finance/CategorySelector';
import { useCompanies } from '@/hooks/useCompanies';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useBeneficiaries } from '@/hooks/useBeneficiaries';
import { useFinancialEntries, FinancialEntry } from '@/hooks/useFinancialEntries';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { toast } from 'sonner';
import { Save, Upload, X, Plus } from 'lucide-react';
import { format } from 'date-fns';

interface FinancialEntryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editEntry?: FinancialEntry | null;
  onSaved?: () => void;
  defaultSourceType?: 'manual' | 'credit_card' | 'bank';
  defaultSourceTransactionId?: string;
}

const NATURE_OPTIONS = [
  { value: 'fixo', label: 'Fixo' },
  { value: 'variavel', label: 'Variável' },
  { value: 'semi_fixo', label: 'Semi-fixo' },
];

const RECURRENCE_OPTIONS = [
  { value: 'semanal', label: 'Semanal' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'anual', label: 'Anual' },
  { value: 'eventual', label: 'Eventual' },
];

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cartao_credito', label: 'Cartão de Crédito' },
  { value: 'cartao_debito', label: 'Cartão de Débito' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cheque', label: 'Cheque' },
];

export function FinancialEntryForm({ open, onOpenChange, editEntry, onSaved, defaultSourceType, defaultSourceTransactionId }: FinancialEntryFormProps) {
  const { activeCompanies } = useCompanies();
  const { activeCostCenters, getByCompany } = useCostCenters();
  const { activeBeneficiaries, addBeneficiary } = useBeneficiaries();
  const { addEntry, updateEntry, uploadInvoice } = useFinancialEntries();
  const { categories } = useExpenseCategories();

  const [saving, setSaving] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
  const [showNewBeneficiary, setShowNewBeneficiary] = useState(false);

  const [form, setForm] = useState({
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    entry_type: 'saida' as 'entrada' | 'saida',
    company_id: '',
    cost_center_id: '',
    category_id: '',
    nature: '',
    recurrence: '',
    beneficiary_id: '',
    description: '',
    cash_amount: '',
    accrual_amount: '',
    accrual_start_date: '',
    accrual_end_date: '',
    invoice_number: '',
    linked_account: '',
    payment_method: '',
    reference_id: '',
  });

  useEffect(() => {
    if (editEntry) {
      setForm({
        entry_date: editEntry.entry_date || format(new Date(), 'yyyy-MM-dd'),
        entry_type: editEntry.entry_type,
        company_id: editEntry.company_id || '',
        cost_center_id: editEntry.cost_center_id || '',
        category_id: editEntry.category_id || '',
        nature: editEntry.nature || '',
        recurrence: editEntry.recurrence || '',
        beneficiary_id: editEntry.beneficiary_id || '',
        description: editEntry.description || '',
        cash_amount: editEntry.cash_amount?.toString() || '',
        accrual_amount: editEntry.accrual_amount?.toString() || '',
        accrual_start_date: editEntry.accrual_start_date || '',
        accrual_end_date: editEntry.accrual_end_date || '',
        invoice_number: editEntry.invoice_number || '',
        linked_account: editEntry.linked_account || '',
        payment_method: editEntry.payment_method || '',
        reference_id: editEntry.reference_id || '',
      });
    } else {
      setForm(prev => ({
        ...prev,
        entry_date: format(new Date(), 'yyyy-MM-dd'),
        entry_type: 'saida',
        company_id: activeCompanies[0]?.id || '',
      }));
    }
  }, [editEntry, open, activeCompanies]);

  const filteredCostCenters = form.company_id ? getByCompany(form.company_id) : activeCostCenters;

  const handleSave = async () => {
    if (!form.company_id) { toast.error('Selecione a empresa'); return; }
    if (!form.cash_amount) { toast.error('Informe o valor'); return; }

    setSaving(true);
    try {
      const payload: Partial<FinancialEntry> = {
        entry_date: form.entry_date,
        entry_type: form.entry_type,
        company_id: form.company_id,
        cost_center_id: form.cost_center_id || null,
        category_id: form.category_id || null,
        nature: form.nature || null,
        recurrence: form.recurrence || null,
        beneficiary_id: form.beneficiary_id || null,
        description: form.description || null,
        cash_amount: parseFloat(form.cash_amount),
        accrual_amount: form.accrual_amount ? parseFloat(form.accrual_amount) : null,
        accrual_start_date: form.accrual_start_date || null,
        accrual_end_date: form.accrual_end_date || null,
        invoice_number: form.invoice_number || null,
        linked_account: form.linked_account || null,
        payment_method: form.payment_method || null,
        reference_id: form.reference_id || null,
        source_type: defaultSourceType || 'manual',
        source_transaction_id: defaultSourceTransactionId || null,
      };

      let entryId: string;
      if (editEntry) {
        await updateEntry(editEntry.id, payload);
        entryId = editEntry.id;
      } else {
        const created = await addEntry(payload);
        entryId = created.id;
      }

      if (invoiceFile) {
        await uploadInvoice(invoiceFile, entryId);
      }

      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddBeneficiary = async () => {
    if (!newBeneficiaryName.trim()) return;
    try {
      const created = await addBeneficiary({ name: newBeneficiaryName.trim() });
      setForm(prev => ({ ...prev, beneficiary_id: created.id }));
      setNewBeneficiaryName('');
      setShowNewBeneficiary(false);
    } catch {}
  };

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{editEntry ? 'Editar Lançamento' : 'Novo Lançamento Financeiro'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4 pb-4">
            {/* Row 1: Date + Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data do Lançamento *</Label>
                <Input type="date" value={form.entry_date} onChange={e => update('entry_date', e.target.value)} />
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select value={form.entry_type} onValueChange={v => update('entry_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrada">📥 Entrada</SelectItem>
                    <SelectItem value="saida">📤 Saída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Company + Cost Center */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Empresa *</Label>
                <Select value={form.company_id} onValueChange={v => { update('company_id', v); update('cost_center_id', ''); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {activeCompanies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.trading_name || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Setor / Centro de Custo</Label>
                <Select value={form.cost_center_id} onValueChange={v => update('cost_center_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {filteredCostCenters.map(cc => (
                      <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Category */}
            <div>
              <Label>Categoria / Subcategoria</Label>
              <CategorySelector
                categories={categories}
                selectedCategoryId={form.category_id}
                onSelect={(id) => update('category_id', id)}
              />
            </div>

            {/* Row 4: Nature + Recurrence */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Natureza</Label>
                <Select value={form.nature} onValueChange={v => update('nature', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {NATURE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Recorrência</Label>
                <Select value={form.recurrence} onValueChange={v => update('recurrence', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 5: Beneficiary */}
            <div>
              <div className="flex items-center justify-between">
                <Label>Beneficiário</Label>
                <Button variant="ghost" size="sm" onClick={() => setShowNewBeneficiary(!showNewBeneficiary)}>
                  <Plus className="h-3 w-3 mr-1" /> Novo
                </Button>
              </div>
              {showNewBeneficiary ? (
                <div className="flex gap-2 mt-1">
                  <Input placeholder="Nome do beneficiário" value={newBeneficiaryName} onChange={e => setNewBeneficiaryName(e.target.value)} />
                  <Button size="sm" onClick={handleAddBeneficiary}>Salvar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewBeneficiary(false)}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <Select value={form.beneficiary_id} onValueChange={v => update('beneficiary_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {activeBeneficiaries.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name} {b.document ? `(${b.document})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Row 6: Description */}
            <div>
              <Label>Descrição / Histórico</Label>
              <Textarea placeholder="Descreva o que foi este gasto..." value={form.description} onChange={e => update('description', e.target.value)} rows={2} />
            </div>

            {/* Row 7: Cash Amount + Accrual Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor – Regime de Caixa *</Label>
                <Input type="number" step="0.01" placeholder="0,00" value={form.cash_amount} onChange={e => update('cash_amount', e.target.value)} />
              </div>
              <div>
                <Label>Valor – Regime de Competência</Label>
                <Input type="number" step="0.01" placeholder="Igual ao caixa se vazio" value={form.accrual_amount} onChange={e => update('accrual_amount', e.target.value)} />
              </div>
            </div>

            {/* Row 8: Accrual dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Competência Início</Label>
                <Input type="date" value={form.accrual_start_date} onChange={e => update('accrual_start_date', e.target.value)} />
              </div>
              <div>
                <Label>Competência Fim</Label>
                <Input type="date" value={form.accrual_end_date} onChange={e => update('accrual_end_date', e.target.value)} />
              </div>
            </div>

            {/* Row 9: Invoice */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nº Nota Fiscal</Label>
                <Input placeholder="Nº NF" value={form.invoice_number} onChange={e => update('invoice_number', e.target.value)} />
              </div>
              <div>
                <Label>Anexo NF</Label>
                <div className="flex items-center gap-2">
                  <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setInvoiceFile(e.target.files?.[0] || null)} className="text-xs" />
                  {invoiceFile && <Upload className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            </div>

            {/* Row 10: Account + Payment method */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Conta Vinculada</Label>
                <Input placeholder="Ex: Banco X – Conta Y" value={form.linked_account} onChange={e => update('linked_account', e.target.value)} />
              </div>
              <div>
                <Label>Forma de Pagamento</Label>
                <Select value={form.payment_method} onValueChange={v => update('payment_method', v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 11: Reference */}
            <div>
              <Label>ID / Referência (opcional)</Label>
              <Input placeholder="Pedido, contrato, lead, processo..." value={form.reference_id} onChange={e => update('reference_id', e.target.value)} />
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}><X className="h-4 w-4 mr-1" /> Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
