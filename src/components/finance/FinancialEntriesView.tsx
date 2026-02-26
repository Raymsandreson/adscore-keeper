import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFinancialEntries, FinancialEntry } from '@/hooks/useFinancialEntries';
import { useCompanies } from '@/hooks/useCompanies';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useBeneficiaries } from '@/hooks/useBeneficiaries';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { FinancialEntryForm } from './FinancialEntryForm';
import { Plus, Edit2, Trash2, ArrowDownCircle, ArrowUpCircle, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface FinancialEntriesViewProps {
  startDate: Date;
  endDate: Date;
  searchTerm: string;
  onNewEntry?: () => void;
}

export function FinancialEntriesView({ startDate, endDate, searchTerm, onNewEntry }: FinancialEntriesViewProps) {
  const { entries, loading, fetchEntries, deleteEntry } = useFinancialEntries();
  const { companies } = useCompanies();
  const { costCenters } = useCostCenters();
  const { beneficiaries } = useBeneficiaries();
  const { categories } = useExpenseCategories();

  const [filterCompany, setFilterCompany] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [editingEntry, setEditingEntry] = useState<FinancialEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    fetchEntries({ start: startDate, end: endDate });
  }, [startDate, endDate, fetchEntries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesCompany = filterCompany === 'all' || e.company_id === filterCompany;
      const matchesType = filterType === 'all' || e.entry_type === filterType;
      const matchesSearch = !searchTerm || e.description?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCompany && matchesType && matchesSearch;
    });
  }, [entries, filterCompany, filterType, searchTerm]);

  const totals = useMemo(() => {
    const entradas = filteredEntries.filter(e => e.entry_type === 'entrada').reduce((s, e) => s + e.cash_amount, 0);
    const saidas = filteredEntries.filter(e => e.entry_type === 'saida').reduce((s, e) => s + e.cash_amount, 0);
    return { entradas, saidas, saldo: entradas - saidas };
  }, [filteredEntries]);

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const getCompanyName = (id: string) => {
    const c = companies.find(c => c.id === id);
    return c?.trading_name || c?.name || '—';
  };

  const getCostCenterName = (id: string | null) => {
    if (!id) return '—';
    return costCenters.find(cc => cc.id === id)?.name || '—';
  };

  const getBeneficiaryName = (id: string | null) => {
    if (!id) return '—';
    return beneficiaries.find(b => b.id === id)?.name || '—';
  };

  const getCategoryName = (id: string | null) => {
    if (!id) return '—';
    const cat = categories.find(c => c.id === id);
    if (!cat) return '—';
    if (cat.parent_id) {
      const parent = categories.find(c => c.id === cat.parent_id);
      return `${parent?.name || ''} > ${cat.name}`;
    }
    return cat.name;
  };

  const getNatureLabel = (n: string | null) => {
    if (!n) return '—';
    const map: Record<string, string> = { fixo: 'Fixo', variavel: 'Variável', semi_fixo: 'Semi-fixo' };
    return map[n] || n;
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este lançamento?')) return;
    try {
      await deleteEntry(id);
      fetchEntries({ start: startDate, end: endDate });
    } catch (err: any) {
      toast.error('Erro ao excluir: ' + err.message);
    }
  };

  const handleEdit = (entry: FinancialEntry) => {
    setEditingEntry(entry);
    setFormOpen(true);
  };

  const handleNewEntry = () => {
    setEditingEntry(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
          <CardContent className="py-3">
            <div className="flex items-center gap-2">
              <ArrowDownCircle className="h-4 w-4 text-green-600" />
              <span className="text-xs text-muted-foreground">Entradas</span>
            </div>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totals.entradas)}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
          <CardContent className="py-3">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Saídas</span>
            </div>
            <p className="text-lg font-bold text-destructive">{formatCurrency(totals.saidas)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <span className="text-xs text-muted-foreground">Saldo</span>
            <p className={`text-lg font-bold ${totals.saldo >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {formatCurrency(totals.saldo)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + New button */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filterCompany} onValueChange={setFilterCompany}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas empresas</SelectItem>
            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.trading_name || c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="entrada">Entradas</SelectItem>
            <SelectItem value="saida">Saídas</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={handleNewEntry}>
          <Plus className="h-4 w-4 mr-1" /> Novo Lançamento
        </Button>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum lançamento encontrado</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleNewEntry}>
                <Plus className="h-4 w-4 mr-1" /> Criar primeiro lançamento
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Beneficiário</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Natureza</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-16">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {format(new Date(entry.entry_date + 'T12:00:00'), 'dd/MM/yy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.entry_type === 'entrada' ? 'default' : 'destructive'} className="text-[10px]">
                          {entry.entry_type === 'entrada' ? '📥 Entrada' : '📤 Saída'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{getCompanyName(entry.company_id)}</TableCell>
                      <TableCell className="text-xs">{getCostCenterName(entry.cost_center_id)}</TableCell>
                      <TableCell className="text-xs">{getCategoryName(entry.category_id)}</TableCell>
                      <TableCell className="text-xs">{getBeneficiaryName(entry.beneficiary_id)}</TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">{entry.description || '—'}</TableCell>
                      <TableCell className="text-xs">{getNatureLabel(entry.nature)}</TableCell>
                      <TableCell className="text-right font-mono font-medium whitespace-nowrap">
                        <span className={entry.entry_type === 'entrada' ? 'text-green-600' : 'text-destructive'}>
                          {entry.entry_type === 'entrada' ? '+' : '-'}{formatCurrency(entry.cash_amount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(entry)}><Edit2 className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(entry.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Entry Form Dialog */}
      <FinancialEntryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editEntry={editingEntry}
        onSaved={() => fetchEntries({ start: startDate, end: endDate })}
      />
    </div>
  );
}
