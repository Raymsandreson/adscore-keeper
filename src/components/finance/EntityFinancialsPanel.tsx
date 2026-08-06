import { useState, useEffect, useMemo, useCallback } from 'react';
// `lead_financials` é tabela de NEGÓCIO: vive no Supabase Externo, com FK para
// leads/legal_cases/lead_processes/lead_activities de lá. A aba do lead usava o
// client Cloud — errado, e por isso silenciosamente vazia. Aqui vai pelo `db`
// (Externo), com `created_by` remapeado para o auth do Externo.
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { trackFinanceEntry } from '@/hooks/useFinanceTimeTracker';
import { toast } from 'sonner';
import { Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Edit2 } from 'lucide-react';
import { format } from 'date-fns';

export interface EntityFinancialEntry {
  id: string;
  lead_id: string | null;
  case_id: string | null;
  process_id: string | null;
  activity_id: string | null;
  entry_type: 'entrada' | 'saida';
  amount: number;
  description: string | null;
  category: string | null;
  entry_date: string;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * De onde o painel está sendo aberto. Define QUAL filtro busca os lançamentos:
 *  - lead     -> tudo do lead (comportamento histórico da aba Financeiro do lead)
 *  - case     -> tudo do caso
 *  - process  -> tudo do processo, inclusive o que foi lançado dentro das atividades dele
 *  - activity -> só o que foi lançado dentro daquela atividade
 *
 * O INSERT sempre grava TODOS os vínculos conhecidos, então uma despesa criada
 * na atividade aparece também no processo, no caso e no lead sem consulta extra.
 */
export type FinancialScope = 'lead' | 'case' | 'process' | 'activity';

/**
 * Destino possível de um lançamento feito de dentro da atividade. A atividade
 * pode estar vinculada a processo, caso e lead ao mesmo tempo, e nem toda
 * despesa é do processo — deslocamento para conversar com o cliente é do lead.
 * Por isso o formulário pergunta em qual dos vínculos gravar, em vez de assumir.
 */
export interface FinancialLinkOption {
  key: string;
  label: string;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
}

/**
 * Monta os destinos de uma atividade, do mais específico ao menos: processo,
 * caso, lead. Só entram os que a atividade realmente tem vinculados.
 * Compartilhado entre a ActivitiesPage e o ActivityFullSheet — são duas telas
 * diferentes para a mesma atividade e precisam oferecer as mesmas opções.
 */
export function buildFinancialLinkOptions(input: {
  processId?: string | null; processLabel?: string | null;
  caseId?: string | null;    caseLabel?: string | null;
  leadId?: string | null;    leadLabel?: string | null;
}): FinancialLinkOption[] {
  const out: FinancialLinkOption[] = [];
  if (input.processId) {
    out.push({
      key: 'processo',
      label: `Processo — ${input.processLabel || 'sem número'}`,
      processId: input.processId,
      caseId: input.caseId || null,
      leadId: input.leadId || null,
    });
  }
  if (input.caseId) {
    out.push({
      key: 'caso',
      label: `Caso — ${input.caseLabel || 'sem título'}`,
      caseId: input.caseId,
      leadId: input.leadId || null,
    });
  }
  if (input.leadId) {
    out.push({
      key: 'lead',
      label: `Lead — ${input.leadLabel || 'sem nome'}`,
      leadId: input.leadId,
    });
  }
  return out;
}

interface EntityFinancialsPanelProps {
  scope: FinancialScope;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
  activityId?: string | null;
  /**
   * Destinos oferecidos no formulário. Com 2+ opções vira um seletor
   * obrigatório; com 1 o destino é usado direto. Vazio/ausente = usa os ids
   * passados nas props (comportamento das abas de lead e processo).
   */
  linkOptions?: FinancialLinkOption[];
  /** Texto curto mostrado acima da lista, explicando a que o lançamento fica vinculado. */
  contextLabel?: string;
  /** Altura máxima da lista. Padrão 300px (igual à aba do lead). */
  listMaxHeight?: string;
}

const CATEGORIES = [
  'Honorários', 'Custas Processuais', 'Perícia', 'Deslocamento', 'Documentação',
  'Publicidade/Anúncio', 'Comissão', 'Acordo', 'Pagamento Cliente', 'Outros',
];

const EMPTY_MESSAGE: Record<FinancialScope, string> = {
  lead: 'Nenhum lançamento financeiro',
  case: 'Nenhum lançamento financeiro neste caso',
  process: 'Nenhum lançamento financeiro neste processo',
  activity: 'Nenhum lançamento financeiro nesta atividade',
};

export function EntityFinancialsPanel({
  scope,
  leadId,
  caseId,
  processId,
  activityId,
  linkOptions,
  contextLabel,
  listMaxHeight = '300px',
}: EntityFinancialsPanelProps) {
  const [entries, setEntries] = useState<EntityFinancialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntityFinancialEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [targetKey, setTargetKey] = useState<string>('');
  const [form, setForm] = useState({
    entry_type: 'saida' as 'entrada' | 'saida',
    amount: '',
    description: '',
    category: '',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    payment_method: '',
    notes: '',
  });

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    await ensureExternalSession().catch(() => {});
    let query = db
      .from('lead_financials' as any)
      .select('*')
      .order('entry_date', { ascending: false });

    if (scope === 'activity') {
      if (!activityId) { setEntries([]); setLoading(false); return; }
      query = query.eq('activity_id', activityId);
    } else if (scope === 'process') {
      if (!processId) { setEntries([]); setLoading(false); return; }
      query = query.eq('process_id', processId);
    } else if (scope === 'case') {
      if (!caseId) { setEntries([]); setLoading(false); return; }
      query = query.eq('case_id', caseId);
    } else {
      if (!leadId) { setEntries([]); setLoading(false); return; }
      // Aba do lead: mantém o comportamento histórico (lead OU caso vinculado).
      query = caseId
        ? query.or(`lead_id.eq.${leadId},case_id.eq.${caseId}`)
        : query.eq('lead_id', leadId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[EntityFinancialsPanel] erro ao carregar lançamentos:', error.message);
      toast.error('Erro ao carregar lançamentos: ' + error.message);
      setEntries([]);
    } else {
      setEntries((data as any[] || []) as EntityFinancialEntry[]);
    }
    setLoading(false);
  }, [scope, leadId, caseId, processId, activityId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  /** Só entram destinos que de fato têm vínculo — atividade sem processo não oferece "Processo". */
  const targets = useMemo(
    () => (linkOptions || []).filter(o => o.leadId || o.caseId || o.processId),
    [linkOptions],
  );
  const hasTargets = targets.length > 0;
  const target = targets.find(t => t.key === targetKey) || null;

  /** Destino que corresponde a um lançamento já gravado — do mais específico ao menos. */
  const targetKeyOf = useCallback((entry: EntityFinancialEntry) => {
    const match =
      (entry.process_id && targets.find(t => t.processId === entry.process_id)) ||
      (entry.case_id && targets.find(t => t.caseId === entry.case_id && !t.processId)) ||
      (entry.lead_id && targets.find(t => t.leadId === entry.lead_id && !t.processId && !t.caseId));
    return match ? match.key : (targets[0]?.key || '');
  }, [targets]);

  const totals = useMemo(() => {
    const receitas = entries.filter(e => e.entry_type === 'entrada').reduce((s, e) => s + Number(e.amount), 0);
    const despesas = entries.filter(e => e.entry_type === 'saida').reduce((s, e) => s + Number(e.amount), 0);
    return { receitas, despesas, lucro: receitas - despesas };
  }, [entries]);

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

  const handleSave = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Informe o valor');
      return;
    }
    if (hasTargets && !target) {
      toast.error('Escolha onde registrar');
      return;
    }

    setSaving(true);
    try {
      // Com destino escolhido, gravam-se os vínculos DELE — uma despesa atribuída
      // ao lead não deve aparecer no financeiro do processo. Sem destino (abas de
      // lead e processo), valem os ids das props.
      const payload = {
        lead_id: (hasTargets ? target?.leadId : leadId) || null,
        case_id: (hasTargets ? target?.caseId : caseId) || null,
        process_id: (hasTargets ? target?.processId : processId) || null,
        activity_id: activityId || null,
        entry_type: form.entry_type,
        amount: parseFloat(form.amount),
        description: form.description || null,
        category: form.category || null,
        entry_date: form.entry_date,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
      };

      await ensureExternalSession().catch(() => {});

      if (editingEntry) {
        const { error } = await db.from('lead_financials' as any).update(payload).eq('id', editingEntry.id);
        if (error) throw error;
      } else {
        // O usuário autentica no Cloud; `created_by` referencia o auth do Externo.
        const { data: { user } } = await authClient.auth.getUser();
        const createdBy = await remapToExternal(user?.id).catch(() => null);
        const { error } = await db.from('lead_financials' as any).insert({ ...payload, created_by: createdBy });
        if (error) throw error;
      }

      // Lançamento gravado → conta o tempo no cronômetro (guarda-chuva do dia).
      void trackFinanceEntry();

      toast.success(editingEntry ? 'Registro atualizado' : 'Registro adicionado');
      setDialogOpen(false);
      setEditingEntry(null);
      resetForm();
      fetchEntries();
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await ensureExternalSession().catch(() => {});
    const { error } = await db.from('lead_financials' as any).delete().eq('id', id);
    if (error) { toast.error('Erro ao remover: ' + error.message); return; }
    toast.success('Removido');
    fetchEntries();
  };

  const openEdit = (entry: EntityFinancialEntry) => {
    setEditingEntry(entry);
    setTargetKey(targetKeyOf(entry));
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
      {contextLabel && (
        <p className="text-[11px] text-muted-foreground leading-snug">{contextLabel}</p>
      )}

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
        <Card className={totals.lucro >= 0 ? 'border-blue-200 bg-blue-50/50' : 'border-amber-200 bg-amber-50/50'}>
          <CardContent className="p-3 text-center">
            <DollarSign className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Resultado</p>
            <p className={`text-sm font-bold ${totals.lucro >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>{formatCurrency(totals.lucro)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Add Button */}
      <Button
        size="sm"
        onClick={() => { resetForm(); setEditingEntry(null); setTargetKey(targets[0]?.key || ''); setDialogOpen(true); }}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" /> Novo Lançamento
      </Button>

      {/* List */}
      <ScrollArea style={{ maxHeight: listMaxHeight }}>
        <div className="space-y-2">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground py-4">Carregando...</p>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">{EMPTY_MESSAGE[scope]}</p>
          ) : entries.map(entry => (
            <div key={entry.id} className="flex items-center justify-between p-2 rounded border text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={entry.entry_type === 'entrada' ? 'default' : 'destructive'} className="text-xs flex-shrink-0">
                  {entry.entry_type === 'entrada' ? '📥' : '📤'}
                </Badge>
                <div className="min-w-0">
                  <p className="font-medium truncate">{entry.description || entry.category || 'Sem descrição'}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.entry_date}
                    {entry.category && ` • ${entry.category}`}
                    {scope !== 'activity' && entry.activity_id && ' • via atividade'}
                  </p>
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
            {/* Onde o lançamento fica pendurado. Com um vínculo só, não faz sentido
                perguntar — mostra qual é e segue. */}
            {hasTargets && (targets.length > 1 ? (
              <div>
                <Label className="text-xs">Registrar em *</Label>
                <Select value={targetKey} onValueChange={setTargetKey}>
                  <SelectTrigger><SelectValue placeholder="Escolha o processo ou lead..." /></SelectTrigger>
                  <SelectContent>
                    {targets.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Registrando em: <span className="font-medium text-foreground">{targets[0].label}</span>
              </p>
            ))}

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
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (editingEntry ? 'Atualizar' : 'Salvar')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
