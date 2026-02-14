import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, PiggyBank, Calendar, Edit2, Save, X, User, Users, Tag, CheckCircle2, AlertCircle, LayoutGrid, Settings, ChevronDown, ChevronUp, Plus, Eye, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { exportInvestments } from '@/utils/financeExport';
import { ExportFormatMenu } from '@/components/finance/ExportFormatMenu';
import { ExpenseCategoryManager } from '@/components/finance/ExpenseCategoryManager';
import { CategorySelector } from '@/components/finance/CategorySelector';
import { useAuth } from '@/hooks/useAuth';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Investment {
  id: string;
  name: string | null;
  type: string | null;
  balance: number | null;
  amount_original: number | null;
  amount_profit: number | null;
  annual_rate: number | null;
  due_date: string | null;
  issuer_name: string | null;
  status: string | null;
  last_updated_at: string | null;
}

interface Lead { id: string; lead_name: string | null; city: string | null; state: string | null; }
interface Contact { id: string; full_name: string; city: string | null; state: string | null; }

const NONE_SELECTED = 'NONE';

interface InvestmentsViewProps {
  searchTerm?: string;
  filterCategories?: string[];
  filterSubcategory?: string;
}

export function InvestmentsView({ searchTerm, filterCategories, filterSubcategory }: InvestmentsViewProps) {
  const { user } = useAuth();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('lista');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editData, setEditData] = useState<{ categoryId: string | null; linkType: 'lead' | 'contact'; linkId: string | null; notes: string }>({ categoryId: null, linkType: 'lead', linkId: null, notes: '' });

  const { categories, overrides, setTransactionOverride, getTransactionOverride, getCategoryById } = useExpenseCategories();
  const parentCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);

  // Auto-switch to lista tab when category filter is applied
  useEffect(() => {
    if (filterCategories && !filterCategories.includes('all')) {
      setActiveTab('lista');
    }
  }, [filterCategories]);

  useEffect(() => {
    if (!user) return;
    fetchInvestments();
    fetchLeadsAndContacts();
  }, [user]);

  const fetchInvestments = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('investments').select('*').order('balance', { ascending: false });
      if (error) throw error;
      setInvestments(data || []);
    } catch (err) { console.error('Error fetching investments:', err); }
    finally { setLoading(false); }
  };

  const fetchLeadsAndContacts = async () => {
    const [leadsRes, contactsRes] = await Promise.all([
      supabase.from('leads').select('id, lead_name, city, state').order('created_at', { ascending: false }).limit(200),
      supabase.from('contacts').select('id, full_name, city, state').order('full_name').limit(200),
    ]);
    setLeads(leadsRes.data || []);
    setContacts(contactsRes.data || []);
  };

  // Filter investments by search and category
  const filteredInvestments = useMemo(() => {
    let result = investments;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(inv => 
        inv.name?.toLowerCase().includes(term) ||
        inv.type?.toLowerCase().includes(term) ||
        inv.issuer_name?.toLowerCase().includes(term)
      );
    }
    if (filterCategories && !filterCategories.includes('all')) {
      result = result.filter(inv => {
        const override = getTransactionOverride(inv.id);
        const categoryId = override?.category_id || null;
        if (filterCategories.includes('uncategorized') && !categoryId) return true;
        if (categoryId) {
          if (filterCategories.includes(categoryId)) return true;
          const cat = getCategoryById(categoryId);
          if (cat?.parent_id && filterCategories.includes(cat.parent_id)) return true;
        }
        return false;
      });
    }
    if (filterSubcategory && filterSubcategory !== 'all') {
      result = result.filter(inv => {
        const override = getTransactionOverride(inv.id);
        return override?.category_id === filterSubcategory;
      });
    }
    return result;
  }, [investments, searchTerm, filterCategories, filterSubcategory, getTransactionOverride, getCategoryById]);

  const totalBalance = filteredInvestments.reduce((sum, i) => sum + (i.balance || 0), 0);
  const totalProfit = filteredInvestments.reduce((sum, i) => sum + (i.amount_profit || 0), 0);

  const pendingCount = useMemo(() => {
    return filteredInvestments.filter(inv => {
      const ov = getTransactionOverride(inv.id);
      return !ov || (!ov.lead_id && !ov.contact_id && !ov.link_acknowledged);
    }).length;
  }, [filteredInvestments, getTransactionOverride, overrides]);

  const startEditing = (inv: Investment) => {
    const override = getTransactionOverride(inv.id);
    setEditingId(inv.id);
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
      toast.success('Investimento categorizado!');
    } catch (err) { toast.error('Erro ao salvar'); }
  };

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const renderInvestmentCard = (inv: Investment) => {
    const isEditing = editingId === inv.id;
    const isExpanded = expandedId === inv.id || isEditing;
    const override = getTransactionOverride(inv.id);
    const isPending = !override || (!override.lead_id && !override.contact_id && !override.link_acknowledged);
    const category = override?.category_id ? getCategoryById(override.category_id) : null;
    let linkedName = '';
    if (override?.lead_id) { const lead = leads.find(l => l.id === override.lead_id); linkedName = lead?.lead_name || ''; }
    else if (override?.contact_id) { const contact = contacts.find(c => c.id === override.contact_id); linkedName = contact?.full_name || ''; }

    return (
      <Card key={inv.id} className={cn("border-0 shadow-card", isPending && "border border-amber-500/50")}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2 cursor-pointer" onClick={() => !isEditing && setExpandedId(isExpanded ? null : inv.id)}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{inv.name || 'Investimento'}</h3>
                {isPending && <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px]">Pendente</Badge>}
                {category && <Badge variant="outline" className="text-[10px]"><div className={cn("w-2 h-2 rounded-full mr-1", category.color)} />{category.name}</Badge>}
                {linkedName && <Badge variant="secondary" className="text-[10px]">{override?.lead_id ? <User className="h-3 w-3 mr-0.5" /> : <Users className="h-3 w-3 mr-0.5" />}{linkedName}</Badge>}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {inv.type && <Badge variant="outline" className="text-xs">{inv.type}</Badge>}
                {inv.issuer_name && <span className="text-xs text-muted-foreground">{inv.issuer_name}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-lg font-bold">{formatCurrency(inv.balance || 0)}</p>
                <Badge variant={inv.status === 'active' ? 'default' : 'secondary'} className="text-xs">{inv.status === 'active' ? 'Ativo' : inv.status}</Badge>
              </div>
              {!isEditing && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); startEditing(inv); }}><Edit2 className="h-4 w-4" /></Button>}
              <Button variant="ghost" size="icon" className="h-6 w-6">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
            </div>
          </div>

          {isExpanded && (
            <div className="border-t pt-3 space-y-3">
              {isEditing ? (
                <>
                  <CategorySelector
                    categories={categories}
                    selectedCategoryId={editData.categoryId}
                    onSelect={(id) => setEditData(prev => ({ ...prev, categoryId: id }))}
                  />
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
                    <Button size="sm" onClick={() => saveEdit(inv.id)}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {inv.amount_original != null && <div><p className="text-xs text-muted-foreground">Valor Aplicado</p><p className="text-sm font-medium">{formatCurrency(inv.amount_original)}</p></div>}
                  {inv.amount_profit != null && <div><p className="text-xs text-muted-foreground">Rendimento</p><p className={cn("text-sm font-medium", (inv.amount_profit || 0) >= 0 ? "text-green-600" : "text-destructive")}>{formatCurrency(inv.amount_profit)}</p></div>}
                  {inv.annual_rate != null && <div><p className="text-xs text-muted-foreground">Taxa a.a.</p><p className="text-sm font-medium">{inv.annual_rate.toFixed(2)}%</p></div>}
                  {inv.due_date && <div><p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Vencimento</p><p className="text-sm font-medium">{format(new Date(inv.due_date + 'T12:00:00'), "dd/MM/yyyy")}</p></div>}
                </div>
              )}
              {!isEditing && inv.last_updated_at && <p className="text-xs text-muted-foreground/70 mt-2">Atualizado em {format(new Date(inv.last_updated_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}</p>}
              {!isEditing && override?.notes && <p className="text-xs text-muted-foreground">📝 {override.notes}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  if (investments.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <PiggyBank className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhum investimento encontrado.</p>
          <p className="text-sm text-muted-foreground/70 mt-2">Sincronize sua conta para ver seus investimentos.</p>
        </CardContent>
      </Card>
    );
  }

  const pendingInvestments = filteredInvestments.filter(inv => {
    const ov = getTransactionOverride(inv.id);
    return !ov || (!ov.lead_id && !ov.contact_id && !ov.link_acknowledged);
  });

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className="flex justify-end">
        <ExportFormatMenu onExport={(fmt) => exportInvestments(filteredInvestments, fmt)} disabled={filteredInvestments.length === 0} />
      </div>
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><PiggyBank className="h-4 w-4" /> Patrimônio Total</div>
            <p className="text-2xl font-bold">{formatCurrency(totalBalance)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><TrendingUp className="h-4 w-4 text-green-500" /> Rendimentos</div>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalProfit)}</p>
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
              <Badge variant="secondary" className="rounded-full">{filteredInvestments.length - pendingCount} / {filteredInvestments.length} vinculados</Badge>
            </div>
            <Progress value={filteredInvestments.length > 0 ? ((filteredInvestments.length - pendingCount) / filteredInvestments.length) * 100 : 0} className="h-1.5" />
            {pendingCount === 0 ? (
              <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Tudo Categorizado!</h3>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">{pendingInvestments.map(inv => renderInvestmentCard(inv))}</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="lista" className="mt-4">
          <div className="grid gap-4">{filteredInvestments.map(inv => renderInvestmentCard(inv))}</div>
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <ExpenseCategoryManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
