import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Search,
  CalendarIcon,
  MessageCircle,
  Copy,
  ExternalLink,
  Pencil,
  Filter,
  X,
  RefreshCw,
  Instagram,
  Send,
} from 'lucide-react';

interface DmHistoryEntry {
  id: string;
  instagram_username: string;
  author_id: string | null;
  dm_message: string;
  original_suggestion: string | null;
  was_edited: boolean;
  action_type: string;
  created_at: string;
  comment_id: string | null;
}

type DateRange = {
  from: Date | undefined;
  to: Date | undefined;
};

export function DmWorkflowHistory() {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [editedFilter, setEditedFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const [showFilters, setShowFilters] = useState(false);

  const { data: dmHistory = [], isLoading, refetch } = useQuery({
    queryKey: ['dm-workflow-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dm_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return data as DmHistoryEntry[];
    },
  });

  const filteredHistory = useMemo(() => {
    return dmHistory.filter((entry) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesUsername = entry.instagram_username?.toLowerCase().includes(query);
        const matchesMessage = entry.dm_message?.toLowerCase().includes(query);
        if (!matchesUsername && !matchesMessage) return false;
      }

      // Action type filter
      if (actionFilter !== 'all' && entry.action_type !== actionFilter) {
        return false;
      }

      // Edited filter
      if (editedFilter === 'edited' && !entry.was_edited) return false;
      if (editedFilter === 'original' && entry.was_edited) return false;

      // Date range filter
      if (dateRange.from || dateRange.to) {
        const entryDate = new Date(entry.created_at);
        if (dateRange.from && dateRange.to) {
          if (!isWithinInterval(entryDate, {
            start: startOfDay(dateRange.from),
            end: endOfDay(dateRange.to),
          })) {
            return false;
          }
        } else if (dateRange.from && entryDate < startOfDay(dateRange.from)) {
          return false;
        } else if (dateRange.to && entryDate > endOfDay(dateRange.to)) {
          return false;
        }
      }

      return true;
    });
  }, [dmHistory, searchQuery, actionFilter, editedFilter, dateRange]);

  const stats = useMemo(() => {
    const total = filteredHistory.length;
    const copied = filteredHistory.filter(e => e.action_type === 'copied').length;
    const copiedAndOpened = filteredHistory.filter(e => e.action_type === 'copied_and_opened').length;
    const openedOnly = filteredHistory.filter(e => e.action_type === 'opened_only').length;
    const edited = filteredHistory.filter(e => e.was_edited).length;
    const uniqueUsers = new Set(filteredHistory.map(e => e.instagram_username)).size;

    return { total, copied, copiedAndOpened, openedOnly, edited, uniqueUsers };
  }, [filteredHistory]);

  const getActionBadge = (actionType: string) => {
    switch (actionType) {
      case 'copied':
        return <Badge variant="secondary" className="gap-1"><Copy className="h-3 w-3" />Copiado</Badge>;
      case 'copied_and_opened':
        return <Badge className="gap-1 bg-primary"><Send className="h-3 w-3" />Copiado + Aberto</Badge>;
      case 'opened_only':
        return <Badge variant="outline" className="gap-1"><ExternalLink className="h-3 w-3" />Apenas Aberto</Badge>;
      default:
        return <Badge variant="outline">{actionType}</Badge>;
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setActionFilter('all');
    setEditedFilter('all');
    setDateRange({ from: subDays(new Date(), 7), to: new Date() });
  };

  const hasActiveFilters = searchQuery || actionFilter !== 'all' || editedFilter !== 'all';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Histórico de DMs do Workflow
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-2" />
              Filtros
              {hasActiveFilters && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  !
                </Badge>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-primary">{stats.uniqueUsers}</div>
            <div className="text-xs text-muted-foreground">Usuários</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-500">{stats.copiedAndOpened}</div>
            <div className="text-xs text-muted-foreground">Enviadas</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-500">{stats.copied}</div>
            <div className="text-xs text-muted-foreground">Copiadas</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-500">{stats.openedOnly}</div>
            <div className="text-xs text-muted-foreground">Abertas</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-500">{stats.edited}</div>
            <div className="text-xs text-muted-foreground">Editadas</div>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-muted/30 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filtros</span>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar usuário ou mensagem..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>

              {/* Action Type Filter */}
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de ação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  <SelectItem value="copied">Apenas copiado</SelectItem>
                  <SelectItem value="copied_and_opened">Copiado + Aberto</SelectItem>
                  <SelectItem value="opened_only">Apenas aberto</SelectItem>
                </SelectContent>
              </Select>

              {/* Edited Filter */}
              <Select value={editedFilter} onValueChange={setEditedFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Edição" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="edited">Editadas</SelectItem>
                  <SelectItem value="original">Originais</SelectItem>
                </SelectContent>
              </Select>

              {/* Date Range */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, 'dd/MM', { locale: ptBR })} -{' '}
                          {format(dateRange.to, 'dd/MM', { locale: ptBR })}
                        </>
                      ) : (
                        format(dateRange.from, 'dd/MM/yyyy', { locale: ptBR })
                      )
                    ) : (
                      'Selecionar período'
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange.from}
                    selected={dateRange}
                    onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
                    numberOfMonths={2}
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum histórico de DM encontrado</p>
            {hasActiveFilters && (
              <Button variant="link" onClick={clearFilters} className="mt-2">
                Limpar filtros
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Editada</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Instagram className="h-4 w-4 text-pink-500" />
                        <span className="font-medium">@{entry.instagram_username}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate text-sm" title={entry.dm_message}>
                        {entry.dm_message}
                      </p>
                      {entry.was_edited && entry.original_suggestion && (
                        <p className="text-xs text-muted-foreground mt-1 truncate" title={entry.original_suggestion}>
                          Original: {entry.original_suggestion}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{getActionBadge(entry.action_type)}</TableCell>
                    <TableCell>
                      {entry.was_edited ? (
                        <Badge variant="outline" className="gap-1 text-purple-500 border-purple-500/30">
                          <Pencil className="h-3 w-3" />
                          Editada
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Original</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(entry.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(`https://instagram.com/${entry.instagram_username}`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {filteredHistory.length > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            Exibindo {filteredHistory.length} de {dmHistory.length} registros
          </div>
        )}
      </CardContent>
    </Card>
  );
}
