import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  History,
  Search,
  Loader2,
  MessageCircle,
  ExternalLink,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  DollarSign,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePostExtractionHistory } from '@/hooks/usePostExtractionHistory';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function PostExtractionHistory() {
  const {
    history,
    isLoading,
    fetchHistory,
    deleteExtractionRecord,
    totalCostUsd,
    totalCostBrl,
    totalComments,
  } = usePostExtractionHistory();

  const [searchTerm, setSearchTerm] = useState('');

  // Filtrar histórico pelo termo de busca
  const filteredHistory = history.filter(item => {
    if (!searchTerm.trim()) return true;
    
    const search = searchTerm.toLowerCase();
    
    // Buscar nas URLs dos posts
    const matchUrls = item.post_urls?.some(url => url.toLowerCase().includes(search));
    
    // Buscar nas keywords
    const matchKeywords = item.keywords?.some(kw => kw.toLowerCase().includes(search));
    
    // Buscar no nome do criador
    const matchCreator = item.creator_name?.toLowerCase().includes(search) ||
                         item.creator_email?.toLowerCase().includes(search);
    
    // Buscar nos resultados (comentários)
    const matchResults = Array.isArray(item.results) && item.results.some((result: any) =>
      result?.comment_text?.toLowerCase().includes(search) ||
      result?.author_username?.toLowerCase().includes(search)
    );
    
    return matchUrls || matchKeywords || matchCreator || matchResults;
  });

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default"><CheckCircle2 className="h-3 w-3 mr-1" /> Concluído</Badge>;
      case 'running':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1 animate-spin" /> Em andamento</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Falhou</Badge>;
      default:
        return <Badge variant="outline">{status || 'Desconhecido'}</Badge>;
    }
  };

  const formatCurrency = (value: number, currency: 'USD' | 'BRL') => {
    if (!value || value === 0) return '-';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(value);
  };

  const extractShortcode = (url: string) => {
    const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : url.substring(0, 20) + '...';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de Extrações
            </CardTitle>
            <CardDescription>
              Todas as extrações de comentários realizadas
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchHistory} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <MessageCircle className="h-4 w-4" />
              Total de Comentários
            </div>
            <div className="text-2xl font-bold mt-1">
              {totalComments.toLocaleString('pt-BR')}
            </div>
          </div>
          <div className="p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <DollarSign className="h-4 w-4" />
              Custo Total (USD)
            </div>
            <div className="text-2xl font-bold mt-1">
              {formatCurrency(totalCostUsd, 'USD')}
            </div>
          </div>
          <div className="p-4 rounded-lg border bg-primary/10">
            <div className="flex items-center gap-2 text-primary text-sm">
              <DollarSign className="h-4 w-4" />
              Custo Total (BRL)
            </div>
            <div className="text-2xl font-bold text-primary mt-1">
              {formatCurrency(totalCostBrl, 'BRL')}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por URL, usuário, comentário ou criador..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchTerm ? (
              <>
                <Search className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Nenhum resultado encontrado para "{searchTerm}"</p>
              </>
            ) : (
              <>
                <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Nenhuma extração realizada ainda</p>
              </>
            )}
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Posts</TableHead>
                  <TableHead>Comentários</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Custo</TableHead>
                  <TableHead>Criado por</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {format(new Date(item.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(item.created_at), "HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {item.post_urls && item.post_urls.length > 0 ? (
                          item.post_urls.slice(0, 3).map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Link2 className="h-3 w-3" />
                              {extractShortcode(url)}
                            </a>
                          ))
                        ) : item.keywords && item.keywords.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Keywords: {item.keywords.slice(0, 3).join(', ')}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                        {(item.post_urls?.length || 0) > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{(item.post_urls?.length || 0) - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <MessageCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {item.results_count?.toLocaleString('pt-BR') || 0}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(item.status)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-primary">
                          {formatCurrency(item.cost_brl || 0, 'BRL')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(item.cost_usd || 0, 'USD')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {item.creator_name || item.creator_email?.split('@')[0] || 'Desconhecido'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {item.post_urls?.[0] && (
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                          >
                            <a
                              href={item.post_urls[0]}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja remover este registro do histórico? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteExtractionRecord(item.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
  );
}
