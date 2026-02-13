import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Landmark, Calendar, Percent, Edit2, Save, X, User, Users, AlertCircle, LayoutGrid, Settings, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { exportLoans } from '@/utils/financeExport';
import { ExportFormatMenu } from '@/components/finance/ExportFormatMenu';
import { ExpenseCategoryManager } from '@/components/finance/ExpenseCategoryManager';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Loan {
  id: string;
  name: string | null;
  loan_type: string | null;
  total_amount: number | null;
  outstanding_balance: number | null;
  monthly_payment: number | null;
  interest_rate: number | null;
  installments_total: number | null;
  installments_paid: number | null;
  start_date: string | null;
  due_date: string | null;
  status: string | null;
}

interface Lead { id: string; lead_name: string | null; }
interface Contact { id: string; full_name: string; }

const NONE_SELECTED = 'NONE';

export function LoansView() {
  const { user } = useAuth();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('lista');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editData, setEditData] = useState<{ categoryId: string | null; linkType: 'lead' | 'contact'; linkId: string | null; notes: string }>({ categoryId: null, linkType: 'lead', linkId: null, notes: '' });

  const { categories, overrides, setTransactionOverride, getTransactionOverride, getCategoryById } = useExpenseCategories();
  const parentCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);

  useEffect(() => {
    if (!user) return;
    fetchLoans();
    fetchLeadsAndContacts();
  }, [user]);

  const fetchLoans = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('loans').select('*').eq('user_id', user.id).order('outstanding_balance', { ascending: false });
      if (error) throw error;
      setLoans(data || []);
    } catch (err) { console.error('Error fetching loans:', err); }
    finally { setLoading(false); }
  };

  const fetchLeadsAndContacts = async () => {
    const [leadsRes, contactsRes] = await Promise.all([
      supabase.from('leads').select('id, lead_name').order('created_at', { ascending: false }).limit(200),
      supabase.from('contacts').select('id, full_name').order('full_name').limit(200),
    ]);
    setLeads(leadsRes.data || []);
    setContacts(contactsRes.data || []);
  };

  const totalOutstanding = loans.reduce((sum, l) => sum + (l.outstanding_balance || 0), 0);
  const totalMonthly = loans.reduce((sum, l) => sum + (l.monthly_payment || 0), 0);

  const pendingCount = useMemo(() => {
    return loans.filter(l => {
      const ov = getTransactionOverride(l.id);
      return !ov || (!ov.lead_id && !ov.contact_id && !ov.link_acknowledged);
    }).length;
  }, [loans, getTransactionOverride, overrides]);

  const startEditing = (loan: Loan) => {
    const override = getTransactionOverride(loan.id);
    setEditingId(loan.id);
    setEditData({
      categoryId: override?.category_id || null,
      linkType: override?.lead_id ? 'lead' : override?.contact_id ? 'contact' : 'lead',
      linkId: override?.lead_id || override?.contact_id || null,
      notes: override?.notes || '',
    });
  };

  const saveEdit = async (id: string) => {
    if (!editData.categoryId) { toast.error('Selecione uma categoria'); return; }
    if (!editData.linkId) { toast.error('Selecione um vínculo ou "Nenhum"'); return; }
    try {
      const isNone = editData.linkId === NONE_SELECTED;
      await setTransactionOverride(
        id, editData.categoryId,
        !isNone && editData.linkType === 'contact' ? editData.linkId : undefined,
        !isNone && editData.linkType === 'lead' ? editData.linkId : undefined,
        editData.notes || undefined, undefined, undefined, isNone
      );
      setEditingId(null);
      toast.success('Empréstimo categorizado!');
    } catch (err) { toast.error('Erro ao salvar'); }
  };

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const renderLoanCard = (loan: Loan) => {
    const isEditing = editingId === loan.id;
    const isExpanded = expandedId === loan.id || isEditing;
    const override = getTransactionOverride(loan.id);
    const isPending = !override || (!override.lead_id && !override.contact_id && !override.link_acknowledged);
    const category = override?.category_id ? getCategoryById(override.category_id) : null;
    let linkedName = '';
    if (override?.lead_id) { const lead = leads.find(l => l.id === override.lead_id); linkedName = lead?.lead_name || ''; }
    else if (override?.contact_id) { const contact = contacts.find(c => c.id === override.contact_id); linkedName = contact?.full_name || ''; }

    const progress = loan.installments_total && loan.installments_paid ? (loan.installments_paid / loan.installments_total) * 100 : 0;

    return (
      <Card key={loan.id} className={cn("border-0 shadow-card", isPending && "border border-amber-500/50")}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 cursor-pointer" onClick={() => !isEditing && setExpandedId(isExpanded ? null : loan.id)}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{loan.name || 'Empréstimo'}</h3>
                {isPending && <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px]">Pendente</Badge>}
                {category && <Badge variant="outline" className="text-[10px]"><div className={cn("w-2 h-2 rounded-full mr-1", category.color)} />{category.name}</Badge>}
                {linkedName && <Badge variant="secondary" className="text-[10px]">{override?.lead_id ? <User className="h-3 w-3 mr-0.5" /> : <Users className="h-3 w-3 mr-0.5" />}{linkedName}</Badge>}
              </div>
              {loan.loan_type && <Badge variant="outline" className="text-xs mt-1">{loan.loan_type}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-lg font-bold text-destructive">{formatCurrency(loan.outstanding_balance || 0)}</p>
                <Badge variant={loan.status === 'active' ? 'destructive' : 'secondary'} className="text-xs">{loan.status === 'active' ? 'Em andamento' : loan.status}</Badge>
              </div>
              {!isEditing && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); startEditing(loan); }}><Edit2 className="h-4 w-4" /></Button>}
              <Button variant="ghost" size="icon" className="h-6 w-6">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
            </div>
          </div>

          {/* Progress */}
          {loan.installments_total && loan.installments_paid != null && (
            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{loan.installments_paid} de {loan.installments_total} parcelas pagas</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {isExpanded && (
            <div className="border-t pt-3 space-y-3">
              {isEditing ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Categoria</label>
                    <div className="flex flex-wrap gap-1">
                      {parentCategories.map(cat => (
                        <Button key={cat.id} variant={editData.categoryId === cat.id ? 'default' : 'outline'} size="sm" onClick={() => setEditData(prev => ({ ...prev, categoryId: cat.id }))} className="h-7 text-xs gap-1">
                          <div className={cn("w-2 h-2 rounded", cat.color)} />{cat.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Vincular a</label>
                      <Select value={editData.linkType} onValueChange={(v: 'lead' | 'contact') => setEditData(prev => ({ ...prev, linkType: v, linkId: null }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="lead">Lead</SelectItem><SelectItem value="contact">Contato</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">{editData.linkType === 'lead' ? 'Lead' : 'Contato'}</label>
                      <Select value={editData.linkId || ''} onValueChange={(v) => setEditData(prev => ({ ...prev, linkId: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_SELECTED} className="text-amber-600 font-medium italic"><div className="flex items-center gap-2"><X className="h-3 w-3" /> Nenhum</div></SelectItem>
                          {editData.linkType === 'lead'
                            ? leads.map(l => <SelectItem key={l.id} value={l.id}>{l.lead_name || 'Sem nome'}</SelectItem>)
                            : contacts.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)
                          }
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Observações</label>
                    <Input value={editData.notes} onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Notas..." className="h-8 text-xs" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}><X className="h-4 w-4 mr-1" /> Cancelar</Button>
                    <Button size="sm" onClick={() => saveEdit(loan.id)}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {loan.total_amount != null && <div><p className="text-xs text-muted-foreground">Valor Total</p><p className="text-sm font-medium">{formatCurrency(loan.total_amount)}</p></div>}
                    {loan.monthly_payment != null && <div><p className="text-xs text-muted-foreground">Parcela</p><p className="text-sm font-medium">{formatCurrency(loan.monthly_payment)}</p></div>}
                    {loan.interest_rate != null && <div><p className="text-xs text-muted-foreground flex items-center gap-1"><Percent className="h-3 w-3" /> Juros</p><p className="text-sm font-medium">{loan.interest_rate.toFixed(2)}% a.m.</p></div>}
                    {loan.due_date && <div><p className="text-xs text-muted-foreground">Vencimento</p><p className="text-sm font-medium">{format(new Date(loan.due_date + 'T12:00:00'), 'dd/MM/yyyy')}</p></div>}
                  </div>
                  {override?.notes && <p className="text-xs text-muted-foreground">📝 {override.notes}</p>}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  if (loans.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <Landmark className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhum empréstimo encontrado.</p>
          <p className="text-sm text-muted-foreground/70 mt-2">Sincronize sua conta para ver seus empréstimos.</p>
        </CardContent>
      </Card>
    );
  }

  const pendingLoans = loans.filter(l => {
    const ov = getTransactionOverride(l.id);
    return !ov || (!ov.lead_id && !ov.contact_id && !ov.link_acknowledged);
  });

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className="flex justify-end">
        <ExportFormatMenu onExport={(fmt) => exportLoans(loans, fmt)} disabled={loans.length === 0} />
      </div>
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Landmark className="h-4 w-4" /> Saldo Devedor Total</div>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Calendar className="h-4 w-4" /> Parcela Mensal Total</div>
            <p className="text-2xl font-bold">{formatCurrency(totalMonthly)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 h-10">
          <TabsTrigger value="pendentes" className="flex items-center gap-2 text-xs sm:text-sm">
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Pendentes</span>
            {pendingCount > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="lista" className="flex items-center gap-2 text-xs sm:text-sm">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Lista</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="flex items-center gap-2 text-xs sm:text-sm">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Config</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pendentes" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <span className="font-medium">{pendingCount} pendentes</span>
              <Badge variant="secondary" className="rounded-full">{loans.length - pendingCount} / {loans.length} vinculados</Badge>
            </div>
            <Progress value={loans.length > 0 ? ((loans.length - pendingCount) / loans.length) * 100 : 0} className="h-1.5" />
            {pendingCount === 0 ? (
              <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Tudo Categorizado!</h3>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">{pendingLoans.map(l => renderLoanCard(l))}</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="lista" className="mt-4">
          <div className="grid gap-4">{loans.map(l => renderLoanCard(l))}</div>
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <ExpenseCategoryManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
