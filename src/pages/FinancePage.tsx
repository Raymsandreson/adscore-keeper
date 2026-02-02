import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  CreditCard, 
  RefreshCw, 
  CalendarIcon, 
  Search, 
  ArrowLeft,
  Link2,
  Link2Off,
  Building2,
  TrendingDown,
  Download,
  Trash2,
  Settings,
  LayoutGrid,
  Users,
  Shield,
  EyeOff,
  AlertCircle,
  TableIcon,
  X,
  Tag,
  Wallet
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useCreditCardTransactions } from "@/hooks/useCreditCardTransactions";
import { useAuth } from "@/hooks/useAuth";
import { useCardPermissions } from "@/hooks/useCardPermissions";
import { useUserRole } from "@/hooks/useUserRole";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useCategoryApiMappings } from "@/hooks/useCategoryApiMappings";
import { useCostAccounts } from "@/hooks/useCostAccounts";
import { toast } from "sonner";
import { ExpenseCategoryManager } from "@/components/finance/ExpenseCategoryManager";
import { CardAssignmentManager } from "@/components/finance/CardAssignmentManager";
import { CardPermissionsManager } from "@/components/finance/CardPermissionsManager";
import { TransactionsAggregatedView } from "@/components/finance/TransactionsAggregatedView";
import { TransactionAggregationSelector, AggregationType } from "@/components/finance/TransactionAggregationSelector";
import { LimitAnalysisPanel } from "@/components/finance/LimitAnalysisPanel";
import { AcolhedorLogisticsDashboard } from "@/components/finance/AcolhedorLogisticsDashboard";
import { PendingTransactionsWorkflow } from "@/components/finance/PendingTransactionsWorkflow";
import { MultiSelectFilter, FilterOption } from "@/components/finance/MultiSelectFilter";
import { CostAccountsManager } from "@/components/finance/CostAccountsManager";
import { translateCategory } from "@/utils/categoryTranslations";

// Pluggy Connect type definition
interface PluggyConnectConfig {
  connectToken: string;
  includeSandbox?: boolean;
  onSuccess?: (data: { item: { id: string } }) => void;
  onError?: (error: { message: string; data?: unknown }) => void;
  onClose?: () => void;
}

interface PluggyConnectInstance {
  init: () => Promise<void>;
}

type PluggyConnectConstructor = new (config: PluggyConnectConfig) => PluggyConnectInstance;

export default function FinancePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { 
    allowedCards, 
    loading: permissionsLoading, 
    filterByPermissions 
  } = useCardPermissions();
  const {
    transactions,
    connections,
    loading,
    syncing,
    error,
    fetchTransactions,
    fetchConnections,
    createConnectToken,
    saveConnection,
    syncTransactions,
    deleteConnection,
    importExistingConnections,
    importByItemId,
    getCategoryTotals,
    getTotalSpent,
  } = useCreditCardTransactions();

  const { categories, cardAssignments, getCardAssignment, overrides, getTransactionOverride } = useExpenseCategories();
  const { mappings, findLocalCategoryByApiName } = useCategoryApiMappings();
  const { accounts: costAccounts } = useCostAccounts();

  // Unified filters
  const [startDate, setStartDate] = useState(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(endOfMonth(new Date()));
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCards, setFilterCards] = useState<string[]>(["all"]);
  const [filterCategories, setFilterCategories] = useState<string[]>(["all"]);
  const [filterAccounts, setFilterAccounts] = useState<string[]>(["all"]);
  const [filterSubcategory, setFilterSubcategory] = useState<string>("all");
  const [aggregationType, setAggregationType] = useState<AggregationType>('card');
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [manualItemId, setManualItemId] = useState("");
  const [isImportingManual, setIsImportingManual] = useState(false);
  const [activeTab, setActiveTab] = useState("workflow");

  // Get unique card digits for assignment manager
  const availableCards = useMemo(() => {
    const cards = new Set(transactions.map(t => t.card_last_digits).filter(Boolean) as string[]);
    return Array.from(cards);
  }, [transactions]);

  // Get parent categories and subcategories from our local categories
  const parentCategories = useMemo(() => {
    return categories.filter(c => !c.parent_id);
  }, [categories]);

  const subcategories = useMemo(() => {
    // For multi-select, only show subcategories if exactly one parent is selected
    const selectedCats = filterCategories.filter(v => v !== 'all' && v !== 'uncategorized');
    if (selectedCats.length !== 1) return [];
    return categories.filter(c => c.parent_id === selectedCats[0]);
  }, [categories, filterCategories]);

  // Function to get local category ID for a transaction (via overrides or API mapping)
  const getLocalCategoryForTransaction = useCallback((transaction: { id: string; category?: string | null }) => {
    // First check if there's a manual override
    const override = getTransactionOverride(transaction.id);
    if (override) {
      return override.category_id;
    }
    
    // Otherwise, try to find via API category mapping
    if (transaction.category) {
      const translatedCategory = translateCategory(transaction.category);
      const localCategoryId = findLocalCategoryByApiName(translatedCategory);
      return localCategoryId;
    }
    
    return null;
  }, [getTransactionOverride, findLocalCategoryByApiName]);

  useEffect(() => {
    // Load Pluggy Connect SDK - using latest version
    const script = document.createElement('script');
    script.src = 'https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js';
    script.async = true;
    script.onload = () => {
      console.log('Pluggy Connect SDK loaded');
    };
    script.onerror = () => {
      console.error('Failed to load Pluggy Connect SDK');
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);

  // Auto-sync on page load
  useEffect(() => {
    const loadData = async () => {
      if (user) {
        await fetchConnections();
        fetchTransactions({ start: startDate, end: endDate });
      }
    };
    loadData();
  }, [user, fetchConnections, fetchTransactions, startDate, endDate]);

  // Auto-sync when connections exist and page loads
  useEffect(() => {
    const autoSync = async () => {
      if (connections.length > 0 && !syncing && !autoSyncing) {
        setAutoSyncing(true);
        try {
          // Sync all historical data (last 24 months) on first load
          const historicalStart = subMonths(new Date(), 24);
          const historicalEnd = endOfMonth(new Date());
          await syncTransactions({ start: historicalStart, end: historicalEnd });
          // Refresh the view with current filter
          await fetchTransactions({ start: startDate, end: endDate });
          setLastSyncTime(new Date());
          toast.success('Transações atualizadas automaticamente');
        } catch (err) {
          console.error('Auto-sync failed:', err);
        } finally {
          setAutoSyncing(false);
        }
      }
    };
    
    // Only run auto-sync once when connections are loaded
    if (connections.length > 0 && !lastSyncTime) {
      autoSync();
    }
  }, [connections.length]);

  // Auto-import existing Pluggy connections if none found
  const handleImportConnections = useCallback(async () => {
    setIsImporting(true);
    try {
      const result = await importExistingConnections();
      if (result.imported > 0) {
        toast.success(`${result.imported} conta(s) importada(s) com sucesso!`);
        await syncTransactions({ start: startDate, end: endDate });
      } else {
        toast.info('Nenhuma conexão ativa encontrada no Pluggy');
      }
    } catch (err: any) {
      console.error('Error importing:', err);
      toast.error('Erro ao importar conexões');
    } finally {
      setIsImporting(false);
    }
  }, [importExistingConnections, syncTransactions, startDate, endDate]);

  const handleImportByItemId = useCallback(async () => {
    if (!manualItemId.trim()) {
      toast.error('Informe o itemId');
      return;
    }
    
    setIsImportingManual(true);
    try {
      const result = await importByItemId(manualItemId.trim());
      toast.success(`Conexão "${result.connection.connector_name}" importada com sucesso!`);
      setManualItemId("");
      await syncTransactions({ start: startDate, end: endDate });
    } catch (err: any) {
      console.error('Error importing by itemId:', err);
      toast.error(`Erro ao importar: ${err.message}`);
    } finally {
      setIsImportingManual(false);
    }
  }, [manualItemId, importByItemId, syncTransactions, startDate, endDate]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const connectToken = await createConnectToken();
      
      const PluggyConnect = (window as unknown as { PluggyConnect?: PluggyConnectConstructor }).PluggyConnect;
      
      if (PluggyConnect) {
        const pluggyConnect = new PluggyConnect({
          connectToken,
          includeSandbox: false,
          onSuccess: async (data) => {
            await saveConnection(data.item.id);
            toast.success('Conta conectada com sucesso!');
            await syncTransactions({ start: startDate, end: endDate });
            setIsConnecting(false);
          },
          onError: (error) => {
            console.error('Pluggy Connect error:', error);
            toast.error('Erro ao conectar conta');
            setIsConnecting(false);
          },
          onClose: () => {
            setIsConnecting(false);
          },
        });
        await pluggyConnect.init();
      } else {
        toast.error('SDK Pluggy não carregado. Tente recarregar a página.');
        setIsConnecting(false);
      }
    } catch (err: any) {
      console.error('Error creating connect token:', err);
      toast.error('Erro ao iniciar conexão');
      setIsConnecting(false);
    }
  }, [createConnectToken, saveConnection, syncTransactions, startDate, endDate]);

  const handleSync = useCallback(async () => {
    // Sync all historical data, not just the current filter period
    // Fetch last 24 months of data to get complete history
    const historicalStart = subMonths(new Date(), 24);
    const historicalEnd = endOfMonth(new Date());
    await syncTransactions({ start: historicalStart, end: historicalEnd });
    // Refresh the view with current filter
    await fetchTransactions({ start: startDate, end: endDate });
    setLastSyncTime(new Date());
    toast.success('Transações sincronizadas!');
  }, [syncTransactions, fetchTransactions, startDate, endDate]);

  const handleDeleteConnection = useCallback(async (itemId: string) => {
    if (confirm('Tem certeza que deseja desconectar esta conta?')) {
      await deleteConnection(itemId);
      toast.success('Conta desconectada');
    }
  }, [deleteConnection]);

  // Filter transactions by card permissions first, then by all filters
  const permittedTransactions = useMemo(() => {
    if (permissionsLoading) return [];
    if (allowedCards.length === 0) return [];
    return filterByPermissions(transactions);
  }, [transactions, allowedCards, permissionsLoading, filterByPermissions]);

  const filteredTransactions = useMemo(() => {
    if (permittedTransactions.length === 0) return [];
    
    // Normalize dates for string comparison (YYYY-MM-DD format)
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');
    
    return permittedTransactions.filter(t => {
      // Date filter - Compare as strings since transaction_date is stored as 'YYYY-MM-DD'
      const txDateStr = t.transaction_date;
      const matchesDate = txDateStr >= startDateStr && txDateStr <= endDateStr;
      
      const matchesSearch = searchTerm === "" || 
        t.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.merchant_name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCard = filterCards.includes("all") || filterCards.includes(t.card_last_digits || '');
      
      // Filter by cost accounts (multi-select)
      const isAllAccounts = filterAccounts.includes("all");
      let matchesAccount = isAllAccounts;
      if (!matchesAccount) {
        const override = getTransactionOverride(t.id);
        const costAccountId = override?.cost_account_id || null;
        if (filterAccounts.includes("no-account")) {
          matchesAccount = !costAccountId;
        }
        if (costAccountId && filterAccounts.includes(costAccountId)) {
          matchesAccount = true;
        }
      }
      
      // Filter by local categories (multi-select)
      const isAllCategories = filterCategories.includes("all");
      let matchesCategory = isAllCategories;
      if (!matchesCategory) {
        const localCategoryId = getLocalCategoryForTransaction(t);
        if (filterCategories.includes("uncategorized")) {
          matchesCategory = !localCategoryId;
        }
        if (localCategoryId && filterCategories.includes(localCategoryId)) {
          matchesCategory = true;
        }
      }
      
      // Subcategory filter
      let matchesSubcategory = filterSubcategory === "all";
      if (!matchesSubcategory && filterSubcategory !== "all") {
        const localCategoryId = getLocalCategoryForTransaction(t);
        matchesSubcategory = localCategoryId === filterSubcategory;
      }
      
      return matchesDate && matchesSearch && matchesCard && matchesAccount && matchesCategory && matchesSubcategory;
    });
  }, [permittedTransactions, searchTerm, filterCards, filterAccounts, filterCategories, filterSubcategory, startDate, endDate, getLocalCategoryForTransaction, getTransactionOverride]);

  // Calculate totals for PREVIEW in dropdown (without category filter applied)
  // This shows totals for each category based on date, search, and card filters only
  const categoryTotalsForPreview = useMemo(() => {
    const totals: Record<string, number> = {};
    let uncategorizedTotal = 0;
    
    // Normalize dates once for filtering
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');
    
    // Filter by date, search, and card only (NOT by category)
    const baseFiltered = permittedTransactions.filter(t => {
      // Date filter - Compare as strings (YYYY-MM-DD format)
      const txDateStr = t.transaction_date;
      const matchesDate = txDateStr >= startDateStr && txDateStr <= endDateStr;
      
      const matchesSearch = searchTerm === "" || 
        t.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.merchant_name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCard = filterCards.includes("all") || filterCards.includes(t.card_last_digits || '');
      
      // Credit card transactions from Pluggy come as positive values for expenses
      return matchesDate && matchesSearch && matchesCard && t.amount > 0;
    });
    
    baseFiltered.forEach(t => {
      const localCategoryId = getLocalCategoryForTransaction(t);
      if (localCategoryId) {
        totals[localCategoryId] = (totals[localCategoryId] || 0) + Math.abs(t.amount);
      } else {
        uncategorizedTotal += Math.abs(t.amount);
      }
    });
    
    return { totals, uncategorizedTotal };
  }, [permittedTransactions, startDate, endDate, searchTerm, filterCards, getLocalCategoryForTransaction]);

  // Calculate totals for LOCAL categories (not API categories) - ONLY expenses
  // Note: Credit card transactions from Pluggy come as positive values for expenses
  const localCategoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    let uncategorizedTotal = 0;
    
    // Credit card expenses come as positive values from Pluggy
    const expenses = filteredTransactions.filter(t => t.amount > 0);
    
    expenses.forEach(t => {
      const localCategoryId = getLocalCategoryForTransaction(t);
      
      if (localCategoryId) {
        totals[localCategoryId] = (totals[localCategoryId] || 0) + Math.abs(t.amount);
      } else {
        uncategorizedTotal += Math.abs(t.amount);
      }
    });
    
    // Map category IDs to names and add uncategorized
    const result = Object.entries(totals)
      .map(([categoryId, total]) => {
        const category = categories.find(c => c.id === categoryId);
        return {
          categoryId,
          categoryName: category?.name || 'Desconhecida',
          total,
          color: category?.color || 'bg-gray-500',
          icon: category?.icon || 'tag'
        };
      })
      .sort((a, b) => b.total - a.total);
    
    // Add uncategorized if there are any
    if (uncategorizedTotal > 0) {
      result.push({
        categoryId: 'uncategorized',
        categoryName: 'Sem categoria',
        total: uncategorizedTotal,
        color: 'bg-gray-400',
        icon: 'tag'
      });
    }
    
    return result;
  }, [filteredTransactions, categories, getLocalCategoryForTransaction]);

  // Total spent - Credit card transactions from Pluggy come as positive values for expenses
  const totalSpent = useMemo(() => {
    return filteredTransactions
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [filteredTransactions]);

  // Count pending transactions (uncategorized)
  const pendingCount = useMemo(() => {
    return filteredTransactions.filter(t => !getLocalCategoryForTransaction(t)).length;
  }, [filteredTransactions, getLocalCategoryForTransaction]);

  // Group transactions by day for table view
  const transactionsByDay = useMemo(() => {
    const grouped: Record<string, typeof filteredTransactions> = {};
    filteredTransactions.forEach(t => {
      const date = format(new Date(t.transaction_date), 'yyyy-MM-dd');
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(t);
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, trans]) => ({
        date,
        transactions: trans,
        total: trans.reduce((sum, t) => sum + t.amount, 0),
        count: trans.length
      }));
  }, [filteredTransactions]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const quickDateRanges = [
    { label: 'Este mês', start: startOfMonth(new Date()), end: endOfMonth(new Date()) },
    { label: 'Mês passado', start: startOfMonth(subMonths(new Date(), 1)), end: endOfMonth(subMonths(new Date(), 1)) },
    { label: '3 meses', start: startOfMonth(subMonths(new Date(), 2)), end: endOfMonth(new Date()) },
  ];

  const setQuickRange = (range: typeof quickDateRanges[0]) => {
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const isQuickRangeActive = (range: typeof quickDateRanges[0]) => {
    return startDate.getTime() === range.start.getTime() && endDate.getTime() === range.end.getTime();
  };

  const hasActiveFilters = !filterCards.includes('all') || !filterAccounts.includes('all') || !filterCategories.includes('all') || filterSubcategory !== 'all' || searchTerm !== '';

  const clearAllFilters = () => {
    setFilterCards(['all']);
    setFilterAccounts(['all']);
    setFilterCategories(['all']);
    setFilterSubcategory('all');
    setSearchTerm('');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Faça login para acessar</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header - Inter Style */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-3">
                <CreditCard className="h-6 w-6 text-primary" />
                <div>
                  <h1 className="text-xl font-semibold">Gastos do Cartão</h1>
                  <p className="text-xs text-muted-foreground">
                    Open Finance via Pluggy
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {lastSyncTime && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Atualizado às {format(lastSyncTime, "HH:mm")}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing || autoSyncing || connections.length === 0}
                className="h-8"
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", (syncing || autoSyncing) && "animate-spin")} />
                {autoSyncing ? 'Atualizando...' : 'Sincronizar'}
              </Button>
              <Button size="sm" onClick={handleConnect} disabled={isConnecting} className="h-8">
                <Link2 className="h-4 w-4 mr-2" />
                Conectar
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Connected Accounts - Compact */}
        {connections.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1.5"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{conn.connector_name}</span>
                <Badge variant={conn.status === 'UPDATED' ? 'default' : 'secondary'} className="text-[10px] h-4 px-1.5">
                  {conn.status === 'UPDATED' ? 'OK' : conn.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 hover:bg-destructive/10"
                  onClick={() => handleDeleteConnection(conn.pluggy_item_id)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Empty State - No Connections */}
        {connections.length === 0 && !loading && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Link2Off className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Nenhuma conta conectada</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                Conecte uma conta bancária através do Open Finance para acompanhar seus gastos no cartão de crédito.
              </p>
              <div className="flex gap-2">
                <Button onClick={handleConnect} disabled={isConnecting}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Conectar Banco
                </Button>
              </div>
              
              {/* Manual Import Section */}
              <div className="mt-6 pt-6 border-t w-full max-w-md">
                <p className="text-sm text-muted-foreground mb-3 text-center">
                  Ou importe uma conexão existente pelo itemId:
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Cole o itemId aqui..."
                    value={manualItemId}
                    onChange={(e) => setManualItemId(e.target.value)}
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleImportByItemId} 
                    disabled={isImportingManual || !manualItemId.trim()}
                    variant="secondary"
                  >
                    {isImportingManual ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      "Importar"
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State - No Permissions */}
        {connections.length > 0 && !permissionsLoading && allowedCards.length === 0 && (
          <Card className="border-dashed border-amber-500/50">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <EyeOff className="h-12 w-12 text-amber-500 mb-4" />
              <h3 className="text-lg font-medium mb-2">Acesso Restrito</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                Você ainda não tem permissão para visualizar nenhum cartão. 
                Solicite ao administrador que libere o acesso aos cartões desejados.
              </p>
              {isAdmin && (
                <div className="mt-4 p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    <Shield className="h-4 w-4 inline mr-1" />
                    Você é admin. Vá em Configurações para liberar acesso aos cartões.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main Content - Show when has connections AND permissions */}
        {connections.length > 0 && allowedCards.length > 0 && (
          <>
            {/* Unified Global Filters - Inter Style */}
            <Card className="border-0 shadow-card">
              <CardContent className="py-4 space-y-4">
                {/* Row 1: Quick Pills + Date Range */}
                <div className="flex flex-wrap items-center gap-2">
                  {quickDateRanges.map((range, i) => (
                    <Button
                      key={i}
                      variant={isQuickRangeActive(range) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setQuickRange(range)}
                      className="rounded-full px-4 h-8"
                    >
                      {range.label}
                    </Button>
                  ))}
                  
                  <div className="flex items-center gap-2 ml-auto">
                    {/* Start Date */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 min-w-[120px]">
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {format(startDate, "dd/MM/yy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={startDate}
                          onSelect={(date) => date && setStartDate(date)}
                          defaultMonth={startDate}
                          locale={ptBR}
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    
                    <span className="text-muted-foreground text-sm">até</span>
                    
                    {/* End Date */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 min-w-[120px]">
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {format(endDate, "dd/MM/yy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="single"
                          selected={endDate}
                          onSelect={(date) => date && setEndDate(date)}
                          defaultMonth={endDate}
                          locale={ptBR}
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Row 2: Search + Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  {/* Search Bar */}
                  <div className="relative lg:col-span-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar transação..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-10 rounded-xl bg-muted/50 border-0"
                    />
                  </div>
                  
                  {/* Card Filter - Multi Select */}
                  <MultiSelectFilter
                    icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Cartão"
                    allLabel="Todos os cartões"
                    options={availableCards.map(card => {
                      const assignment = getCardAssignment(card);
                      return {
                        value: card,
                        label: assignment?.card_name 
                          ? `${assignment.card_name} (**** ${card})`
                          : `**** ${card}`,
                        sublabel: assignment?.lead_name || undefined
                      };
                    })}
                    selectedValues={filterCards}
                    onSelectionChange={setFilterCards}
                  />
                  
                  {/* Cost Account Filter - Multi Select */}
                  <MultiSelectFilter
                    icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Conta"
                    allLabel="Todas as contas"
                    options={[
                      {
                        value: 'no-account',
                        label: 'Sem conta vinculada',
                      },
                      ...costAccounts.filter(a => a.is_active).map(account => ({
                        value: account.id,
                        label: account.name,
                      }))
                    ]}
                    selectedValues={filterAccounts}
                    onSelectionChange={setFilterAccounts}
                  />
                  
                  {/* Category Filter - Multi Select with Preview Totals */}
                  <MultiSelectFilter
                    icon={<Tag className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Categoria"
                    allLabel="Todas as categorias"
                    options={[
                      {
                        value: 'uncategorized',
                        label: 'Sem categoria',
                        previewAmount: categoryTotalsForPreview.uncategorizedTotal
                      },
                      ...parentCategories.map(cat => ({
                        value: cat.id,
                        label: cat.name,
                        previewAmount: categoryTotalsForPreview.totals[cat.id] || 0
                      }))
                    ]}
                    selectedValues={filterCategories}
                    onSelectionChange={(values) => {
                      setFilterCategories(values);
                      setFilterSubcategory('all');
                    }}
                    formatCurrency={formatCurrency}
                  />
                  
                  {/* Subcategory Filter */}
                  <Select 
                    value={filterSubcategory} 
                    onValueChange={setFilterSubcategory}
                    disabled={subcategories.length === 0}
                  >
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Subcategoria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {subcategories.map(sub => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Row 3: Summary + Category Chips */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Total Card */}
                  <Card className="bg-gradient-to-br from-destructive/5 to-destructive/10 border-destructive/20">
                    <CardContent className="py-4">
                      <p className="text-sm text-muted-foreground">Total Gasto</p>
                      <p className="text-2xl font-bold text-destructive">
                        {loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totalSpent)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {filteredTransactions.length} transações
                      </p>
                    </CardContent>
                  </Card>
                  
                  {/* Category Chips - Local Categories with Totals */}
                  <div className="md:col-span-3 flex flex-wrap items-center gap-2 content-center">
                    {hasActiveFilters && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                        Limpar filtros
                      </Button>
                    )}
                    
                    {localCategoryTotals.slice(0, 6).map(({ categoryId, categoryName, total }) => {
                      const isSelected = filterCategories.includes(categoryId);
                      return (
                        <Badge
                          key={categoryId}
                          variant={isSelected ? 'default' : 'outline'}
                          className="cursor-pointer rounded-full px-3 py-1.5 hover:bg-primary/10 transition-colors"
                          onClick={() => {
                            if (isSelected) {
                              const newValues = filterCategories.filter(v => v !== categoryId);
                              setFilterCategories(newValues.length === 0 ? ['all'] : newValues);
                            } else {
                              setFilterCategories([...filterCategories.filter(v => v !== 'all'), categoryId]);
                            }
                          }}
                        >
                          {categoryName} ({formatCurrency(total)})
                        </Badge>
                      );
                    })}
                    {localCategoryTotals.length > 6 && (
                      <Badge variant="outline" className="rounded-full px-3 py-1.5">
                        +{localCategoryTotals.length - 6} mais
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tabs for different views */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-6 h-10">
                <TabsTrigger value="workflow" className="flex items-center gap-2 text-xs sm:text-sm">
                  <AlertCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">Pendentes</span>
                  {pendingCount > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {pendingCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="logistics" className="flex items-center gap-2 text-xs sm:text-sm">
                  <Users className="h-4 w-4" />
                  <span className="hidden sm:inline">Acolhedores</span>
                </TabsTrigger>
                <TabsTrigger value="by-card" className="flex items-center gap-2 text-xs sm:text-sm">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">Agrupado</span>
                </TabsTrigger>
                <TabsTrigger value="by-day" className="flex items-center gap-2 text-xs sm:text-sm">
                  <TableIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Por Dia</span>
                </TabsTrigger>
                <TabsTrigger value="list" className="flex items-center gap-2 text-xs sm:text-sm">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">Lista</span>
                </TabsTrigger>
                <TabsTrigger value="settings" className="flex items-center gap-2 text-xs sm:text-sm">
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Config</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="workflow" className="mt-4">
                <PendingTransactionsWorkflow 
                  transactions={filteredTransactions} 
                  onComplete={() => setActiveTab('logistics')}
                />
              </TabsContent>

              <TabsContent value="logistics" className="mt-4">
                <AcolhedorLogisticsDashboard transactions={filteredTransactions} />
              </TabsContent>

              <TabsContent value="by-card" className="mt-4">
                <div className="mb-4 flex items-center justify-between">
                  <TransactionAggregationSelector 
                    value={aggregationType} 
                    onChange={setAggregationType} 
                  />
                  <p className="text-sm text-muted-foreground">
                    {filteredTransactions.length} transações
                  </p>
                </div>
                {loading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-24 w-full" />
                    ))}
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      Nenhuma transação encontrada
                    </CardContent>
                  </Card>
                ) : (
                  <TransactionsAggregatedView 
                    transactions={filteredTransactions} 
                    aggregationType={aggregationType}
                    onPeriodSelect={(start, end) => {
                      setStartDate(start);
                      setEndDate(end);
                    }}
                  />
                )}
              </TabsContent>

              {/* New: By Day Tab - Consolidated Table */}
              <TabsContent value="by-day" className="mt-4">
                <Card className="border-0 shadow-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TableIcon className="h-5 w-5" />
                        Gastos por Dia
                      </CardTitle>
                      <Button variant="outline" size="sm" disabled>
                        <Download className="h-4 w-4 mr-2" />
                        Exportar
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {loading ? (
                      <div className="p-6 space-y-3">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : transactionsByDay.length === 0 ? (
                      <div className="p-12 text-center text-muted-foreground">
                        Nenhuma transação encontrada
                      </div>
                    ) : (
                      <ScrollArea className="h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Data</TableHead>
                              <TableHead className="text-center">Qtd</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {transactionsByDay.map(({ date, transactions: dayTrans, total, count }) => (
                              <TableRow 
                                key={date}
                                className="cursor-pointer hover:bg-muted/50"
                              >
                                <TableCell>
                                  <div>
                                    <p className="font-medium">
                                      {format(new Date(date), "EEEE", { locale: ptBR })}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {format(new Date(date), "dd 'de' MMMM", { locale: ptBR })}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant="secondary" className="rounded-full">
                                    {count}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium">
                                  <span className={total < 0 ? 'text-destructive' : 'text-green-600'}>
                                    {formatCurrency(total)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="list" className="mt-4">
                <Card className="border-0 shadow-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingDown className="h-5 w-5" />
                        Transações
                      </CardTitle>
                      <Button variant="outline" size="sm" disabled>
                        <Download className="h-4 w-4 mr-2" />
                        Exportar
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {loading ? (
                      <div className="p-6 space-y-3">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : filteredTransactions.length === 0 ? (
                      <div className="p-12 text-center text-muted-foreground">
                        Nenhuma transação encontrada
                      </div>
                    ) : (
                      <ScrollArea className="h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Data</TableHead>
                              <TableHead>Descrição</TableHead>
                              <TableHead>Categoria</TableHead>
                              <TableHead>Cartão</TableHead>
                              <TableHead className="text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredTransactions.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell className="font-mono text-sm">
                                  {format(new Date(transaction.transaction_date), "dd/MM/yy")}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <p className="font-medium truncate max-w-[300px]">
                                      {transaction.description}
                                    </p>
                                    {transaction.merchant_name && (
                                      <p className="text-xs text-muted-foreground">
                                        {transaction.merchant_name}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary" className="text-xs rounded-full">
                                    {transaction.category || 'Outros'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {transaction.card_last_digits
                                    ? `****${transaction.card_last_digits}`
                                    : '-'}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  <span className={transaction.amount < 0 ? 'text-destructive' : 'text-green-600'}>
                                    {formatCurrency(transaction.amount)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="settings" className="mt-4 space-y-4">
                <LimitAnalysisPanel transactions={filteredTransactions} />
                
                {/* Card Permissions Manager - Admin only */}
                {isAdmin && (
                  <CardPermissionsManager availableCards={availableCards} />
                )}
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ExpenseCategoryManager />
                  <CardAssignmentManager availableCards={availableCards} />
                </div>
                
                {/* Cost Accounts Manager */}
                <CostAccountsManager />
              </TabsContent>
            </Tabs>
          </>
        )}

        {error && (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-destructive text-sm">{error}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
