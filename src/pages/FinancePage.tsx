import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Filter,
  Download,
  Trash2,
  Settings,
  LayoutGrid,
  Users
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useCreditCardTransactions } from "@/hooks/useCreditCardTransactions";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ExpenseCategoryManager } from "@/components/finance/ExpenseCategoryManager";
import { CardAssignmentManager } from "@/components/finance/CardAssignmentManager";
import { TransactionsGroupedByCard } from "@/components/finance/TransactionsGroupedByCard";
import { LimitAnalysisPanel } from "@/components/finance/LimitAnalysisPanel";
import { AcolhedorLogisticsDashboard } from "@/components/finance/AcolhedorLogisticsDashboard";

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

  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [manualItemId, setManualItemId] = useState("");
  const [isImportingManual, setIsImportingManual] = useState(false);
  const [activeTab, setActiveTab] = useState("logistics");

  // Get unique card digits for assignment manager
  const availableCards = useMemo(() => {
    const cards = new Set(transactions.map(t => t.card_last_digits).filter(Boolean) as string[]);
    return Array.from(cards);
  }, [transactions]);

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
        fetchTransactions(dateRange);
      }
    };
    loadData();
  }, [user, fetchConnections, fetchTransactions, dateRange]);

  // Auto-sync when connections exist and page loads
  useEffect(() => {
    const autoSync = async () => {
      if (connections.length > 0 && !syncing && !autoSyncing) {
        setAutoSyncing(true);
        try {
          await syncTransactions(dateRange);
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
        await syncTransactions(dateRange);
      } else {
        toast.info('Nenhuma conexão ativa encontrada no Pluggy');
      }
    } catch (err: any) {
      console.error('Error importing:', err);
      toast.error('Erro ao importar conexões');
    } finally {
      setIsImporting(false);
    }
  }, [importExistingConnections, syncTransactions, dateRange]);

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
      await syncTransactions(dateRange);
    } catch (err: any) {
      console.error('Error importing by itemId:', err);
      toast.error(`Erro ao importar: ${err.message}`);
    } finally {
      setIsImportingManual(false);
    }
  }, [manualItemId, importByItemId, syncTransactions, dateRange]);

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
            await syncTransactions(dateRange);
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
  }, [createConnectToken, saveConnection, syncTransactions, dateRange]);

  const handleSync = useCallback(async () => {
    await syncTransactions(dateRange);
    setLastSyncTime(new Date());
    toast.success('Transações sincronizadas!');
  }, [syncTransactions, dateRange]);

  const handleDeleteConnection = useCallback(async (itemId: string) => {
    if (confirm('Tem certeza que deseja desconectar esta conta?')) {
      await deleteConnection(itemId);
      toast.success('Conta desconectada');
    }
  }, [deleteConnection]);

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = searchTerm === "" || 
      t.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.merchant_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === null || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categoryTotals = getCategoryTotals();
  const totalSpent = getTotalSpent();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const quickDateRanges = [
    { label: 'Este mês', start: startOfMonth(new Date()), end: endOfMonth(new Date()) },
    { label: 'Mês passado', start: startOfMonth(subMonths(new Date(), 1)), end: endOfMonth(subMonths(new Date(), 1)) },
    { label: 'Últimos 3 meses', start: startOfMonth(subMonths(new Date(), 2)), end: endOfMonth(new Date()) },
  ];

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Faça login para acessar</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <CreditCard className="h-6 w-6 text-primary" />
                  Gastos do Cartão
                </h1>
                <p className="text-sm text-muted-foreground">
                  Open Finance via Pluggy
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {lastSyncTime && (
                <span className="text-xs text-muted-foreground">
                  Atualizado às {format(lastSyncTime, "HH:mm")}
                </span>
              )}
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={syncing || autoSyncing || connections.length === 0}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", (syncing || autoSyncing) && "animate-spin")} />
                {autoSyncing ? 'Atualizando...' : 'Sincronizar'}
              </Button>
              <Button onClick={handleConnect} disabled={isConnecting}>
                <Link2 className="h-4 w-4 mr-2" />
                Conectar Banco
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Connected Accounts */}
        {connections.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Contas Conectadas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2"
                  >
                    <Badge variant={conn.status === 'UPDATED' ? 'default' : 'secondary'}>
                      {conn.connector_name}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {conn.last_sync_at
                        ? `Sync: ${format(new Date(conn.last_sync_at), "dd/MM HH:mm")}`
                        : 'Nunca sincronizado'}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleDeleteConnection(conn.pluggy_item_id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
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

        {/* Date Range & Filters */}
        {connections.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {quickDateRanges.map((range, i) => (
                  <Button
                    key={i}
                    variant={
                      dateRange.start.getTime() === range.start.getTime() &&
                      dateRange.end.getTime() === range.end.getTime()
                        ? 'default'
                        : 'outline'
                    }
                    size="sm"
                    onClick={() => setDateRange(range)}
                  >
                    {range.label}
                  </Button>
                ))}
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {format(dateRange.start, "dd/MM/yy")} - {format(dateRange.end, "dd/MM/yy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={{ from: dateRange.start, to: dateRange.end }}
                    onSelect={(range) => {
                      if (range?.from && range?.to) {
                        setDateRange({ start: range.from, end: range.to });
                      }
                    }}
                    locale={ptBR}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>

              <div className="flex-1" />

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar transação..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Gasto
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">
                    {loading ? <Skeleton className="h-8 w-32" /> : formatCurrency(totalSpent)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {filteredTransactions.length} transações
                  </p>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    Categorias
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={categoryFilter === null ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setCategoryFilter(null)}
                    >
                      Todas
                    </Badge>
                    {categoryTotals.slice(0, 6).map(({ category, total }) => (
                      <Badge
                        key={category}
                        variant={categoryFilter === category ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setCategoryFilter(category)}
                      >
                        {category} ({formatCurrency(total)})
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabs for different views */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="logistics" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Acolhedores
                </TabsTrigger>
                <TabsTrigger value="by-card" className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Por Cartão
                </TabsTrigger>
                <TabsTrigger value="list" className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Lista
                </TabsTrigger>
                <TabsTrigger value="settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Configurações
                </TabsTrigger>
              </TabsList>

              <TabsContent value="logistics" className="mt-4">
                <AcolhedorLogisticsDashboard transactions={filteredTransactions} />
              </TabsContent>

              <TabsContent value="by-card" className="mt-4">
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
                  <TransactionsGroupedByCard transactions={filteredTransactions} />
                )}
              </TabsContent>

              <TabsContent value="list" className="mt-4">
                <Card>
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
                                  <Badge variant="secondary" className="text-xs">
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ExpenseCategoryManager />
                  <CardAssignmentManager availableCards={availableCards} />
                </div>
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
