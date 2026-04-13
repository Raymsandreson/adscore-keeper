import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bug, RefreshCw, AlertTriangle, Clock, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  shortId: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  level: string;
  status: string;
  permalink: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  type: string;
  platform: string;
}

export default function BugMonitorPage() {
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('is:unresolved');
  const [period, setPeriod] = useState('24h');
  const [selectedIssue, setSelectedIssue] = useState<SentryIssue | null>(null);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('sentry-issues', {
        body: null,
        method: 'GET',
      });

      // Use fetch directly since we need query params
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sentry-issues?endpoint=issues&query=${encodeURIComponent(query)}&statsPeriod=${period}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Erro ao buscar issues');

      const issuesData = await response.json();
      setIssues(Array.isArray(issuesData) ? issuesData : []);
    } catch (err) {
      console.error('Error fetching sentry issues:', err);
      toast.error('Erro ao carregar bugs do Sentry');
    } finally {
      setLoading(false);
    }
  }, [query, period]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'fatal': return 'bg-red-600 text-white';
      case 'error': return 'bg-destructive text-destructive-foreground';
      case 'warning': return 'bg-yellow-500 text-white';
      case 'info': return 'bg-blue-500 text-white';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'fatal': return <XCircle className="h-4 w-4" />;
      case 'error': return <AlertTriangle className="h-4 w-4" />;
      case 'warning': return <Clock className="h-4 w-4" />;
      default: return <CheckCircle2 className="h-4 w-4" />;
    }
  };

  const stats = {
    total: issues.length,
    fatal: issues.filter(i => i.level === 'fatal').length,
    error: issues.filter(i => i.level === 'error').length,
    warning: issues.filter(i => i.level === 'warning').length,
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bug className="h-6 w-6 text-destructive" />
          <div>
            <h1 className="text-2xl font-bold">Monitor de Bugs</h1>
            <p className="text-sm text-muted-foreground">Erros em produção via Sentry</p>
          </div>
        </div>
        <Button onClick={fetchIssues} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Issues</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.fatal}</p>
            <p className="text-xs text-muted-foreground">Fatal</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-destructive">{stats.error}</p>
            <p className="text-xs text-muted-foreground">Errors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-500">{stats.warning}</p>
            <p className="text-xs text-muted-foreground">Warnings</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={query} onValueChange={setQuery}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="is:unresolved">Não Resolvidos</SelectItem>
            <SelectItem value="is:resolved">Resolvidos</SelectItem>
            <SelectItem value="is:ignored">Ignorados</SelectItem>
            <SelectItem value="">Todos</SelectItem>
          </SelectContent>
        </Select>

        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">Última hora</SelectItem>
            <SelectItem value="24h">24 horas</SelectItem>
            <SelectItem value="7d">7 dias</SelectItem>
            <SelectItem value="14d">14 dias</SelectItem>
            <SelectItem value="30d">30 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Issues List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Issues ({issues.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : issues.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="text-lg font-medium">Nenhum bug encontrado! 🎉</p>
              <p className="text-sm text-muted-foreground">Tudo limpo no período selecionado</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-2">
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    onClick={() => setSelectedIssue(selectedIssue?.id === issue.id ? null : issue)}
                    className="p-4 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={getLevelColor(issue.level)} variant="secondary">
                            {getLevelIcon(issue.level)}
                            <span className="ml-1 capitalize">{issue.level}</span>
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">{issue.shortId}</span>
                        </div>
                        <p className="font-medium text-sm truncate">{issue.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{issue.culprit}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{issue.count}x</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(issue.lastSeen), { addSuffix: true, locale: ptBR })}
                        </p>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {selectedIssue?.id === issue.id && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        {issue.metadata?.type && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Tipo: </span>
                            <span className="font-mono">{issue.metadata.type}</span>
                          </div>
                        )}
                        {issue.metadata?.value && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Mensagem: </span>
                            <span className="font-mono break-all">{issue.metadata.value}</span>
                          </div>
                        )}
                        {issue.metadata?.filename && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Arquivo: </span>
                            <span className="font-mono">{issue.metadata.filename}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Primeira vez: {format(new Date(issue.firstSeen), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                          <span>Usuários afetados: {issue.userCount}</span>
                          <span>Plataforma: {issue.platform}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(issue.permalink, '_blank');
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Ver no Sentry
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
