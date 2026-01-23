import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Trophy, 
  Clock, 
  MessageCircle, 
  UserPlus, 
  Target, 
  Send as SendIcon, 
  Trash2,
  TrendingUp,
  Calendar,
  BarChart3,
  MapPin,
  Zap
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

interface WorkflowReport {
  id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  total_comments: number;
  replies_count: number;
  leads_created: number;
  follows_count: number;
  dms_sent: number;
  skips_count: number;
  registrations_count: number;
  created_at: string;
}

interface WorkflowReportHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WorkflowReportHistory = ({ 
  open, 
  onOpenChange 
}: WorkflowReportHistoryProps) => {
  const [reports, setReports] = useState<WorkflowReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d' | 'all'>('7d');

  const fetchReports = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('workflow_reports')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (selectedPeriod === '7d') {
        query = query.gte('created_at', subDays(new Date(), 7).toISOString());
      } else if (selectedPeriod === '30d') {
        query = query.gte('created_at', subDays(new Date(), 30).toISOString());
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      setReports(data || []);
    } catch (error) {
      console.error('Error fetching reports:', error);
      toast.error("Erro ao carregar histórico");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchReports();
    }
  }, [open, selectedPeriod]);

  const deleteReport = async (id: string) => {
    try {
      const { error } = await supabase
        .from('workflow_reports')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      setReports(prev => prev.filter(r => r.id !== id));
      toast.success("Relatório excluído");
    } catch (error) {
      console.error('Error deleting report:', error);
      toast.error("Erro ao excluir relatório");
    }
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    // Group reports by day
    const groupedByDay = new Map<string, {
      replies: number;
      leads: number;
      follows: number;
      dms: number;
      duration: number;
      sessions: number;
    }>();

    reports.forEach(report => {
      const day = format(new Date(report.created_at), 'yyyy-MM-dd');
      const existing = groupedByDay.get(day) || {
        replies: 0,
        leads: 0,
        follows: 0,
        dms: 0,
        duration: 0,
        sessions: 0
      };
      
      groupedByDay.set(day, {
        replies: existing.replies + report.replies_count,
        leads: existing.leads + report.leads_created,
        follows: existing.follows + report.follows_count,
        dms: existing.dms + report.dms_sent,
        duration: existing.duration + report.duration_seconds,
        sessions: existing.sessions + 1
      });
    });

    return Array.from(groupedByDay.entries())
      .map(([date, data]) => ({
        date,
        dateLabel: format(new Date(date), 'dd/MM', { locale: ptBR }),
        ...data,
        avgDuration: Math.round(data.duration / data.sessions / 60) // in minutes
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [reports]);

  // Calculate totals
  const totals = useMemo(() => {
    return reports.reduce((acc, report) => ({
      replies: acc.replies + report.replies_count,
      leads: acc.leads + report.leads_created,
      follows: acc.follows + report.follows_count,
      dms: acc.dms + report.dms_sent,
      registrations: acc.registrations + report.registrations_count,
      skips: acc.skips + report.skips_count,
      duration: acc.duration + report.duration_seconds,
      sessions: acc.sessions + 1
    }), {
      replies: 0,
      leads: 0,
      follows: 0,
      dms: 0,
      registrations: 0,
      skips: 0,
      duration: 0,
      sessions: 0
    });
  }, [reports]);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const chartConfig = {
    replies: {
      label: "Respostas",
      color: "hsl(var(--chart-1))",
    },
    leads: {
      label: "Leads",
      color: "hsl(var(--chart-2))",
    },
    follows: {
      label: "Seguindo",
      color: "hsl(var(--chart-3))",
    },
    dms: {
      label: "DMs",
      color: "hsl(var(--chart-4))",
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Histórico de Produtividade
          </DialogTitle>
          <DialogDescription>
            Acompanhe sua evolução ao longo do tempo
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Resumo</TabsTrigger>
            <TabsTrigger value="charts">Gráficos</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          {/* Period Filter */}
          <div className="flex gap-2 py-3 border-b">
            <Button
              variant={selectedPeriod === '7d' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedPeriod('7d')}
            >
              7 dias
            </Button>
            <Button
              variant={selectedPeriod === '30d' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedPeriod('30d')}
            >
              30 dias
            </Button>
            <Button
              variant={selectedPeriod === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedPeriod('all')}
            >
              Tudo
            </Button>
          </div>

          <TabsContent value="overview" className="flex-1 overflow-auto mt-0 pt-4">
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Trophy className="h-4 w-4 text-yellow-500" />
                    <span className="text-xs">Sessões</span>
                  </div>
                  <p className="text-2xl font-bold">{totals.sessions}</p>
                </div>
                
                <div className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Clock className="h-4 w-4" />
                    <span className="text-xs">Tempo Total</span>
                  </div>
                  <p className="text-2xl font-bold">{formatDuration(totals.duration)}</p>
                </div>
                
                <div className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <MessageCircle className="h-4 w-4 text-green-500" />
                    <span className="text-xs">Respostas</span>
                  </div>
                  <p className="text-2xl font-bold">{totals.replies}</p>
                </div>
                
                <div className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Target className="h-4 w-4 text-purple-500" />
                    <span className="text-xs">Leads</span>
                  </div>
                  <p className="text-2xl font-bold">{totals.leads}</p>
                </div>
              </div>

              {/* Additional Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border bg-muted/30 text-center">
                  <UserPlus className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                  <p className="text-lg font-bold">{totals.follows}</p>
                  <p className="text-xs text-muted-foreground">Seguindo</p>
                </div>
                
                <div className="p-3 rounded-lg border bg-muted/30 text-center">
                  <SendIcon className="h-5 w-5 text-pink-500 mx-auto mb-1" />
                  <p className="text-lg font-bold">{totals.dms}</p>
                  <p className="text-xs text-muted-foreground">DMs</p>
                </div>
                
                <div className="p-3 rounded-lg border bg-muted/30 text-center">
                  <MapPin className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                  <p className="text-lg font-bold">{totals.registrations}</p>
                  <p className="text-xs text-muted-foreground">Contatos</p>
                </div>
              </div>

              {/* Averages */}
              {totals.sessions > 0 && (
                <div className="p-4 rounded-lg border bg-gradient-to-r from-primary/10 to-primary/5">
                  <p className="text-sm font-medium mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Médias por Sessão
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold">{Math.round(totals.replies / totals.sessions)}</p>
                      <p className="text-xs text-muted-foreground">Respostas</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{(totals.leads / totals.sessions).toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">Leads</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatDuration(Math.round(totals.duration / totals.sessions))}</p>
                      <p className="text-xs text-muted-foreground">Duração</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{Math.round(totals.replies / (totals.duration / 60))}/min</p>
                      <p className="text-xs text-muted-foreground">Velocidade</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="charts" className="flex-1 overflow-auto mt-0 pt-4">
            <div className="space-y-6">
              {chartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mb-3 opacity-50" />
                  <p>Nenhum dado para exibir</p>
                  <p className="text-sm">Complete sessões de fluxo para ver gráficos</p>
                </div>
              ) : (
                <>
                  {/* Replies Evolution */}
                  <div className="p-4 rounded-lg border">
                    <p className="text-sm font-medium mb-4">Evolução de Respostas</p>
                    <ChartContainer config={chartConfig} className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="dateLabel" className="text-xs" />
                          <YAxis className="text-xs" />
                          <Tooltip content={<ChartTooltipContent />} />
                          <Line 
                            type="monotone" 
                            dataKey="replies" 
                            stroke="var(--color-replies)" 
                            strokeWidth={2}
                            dot={{ fill: "var(--color-replies)" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>

                  {/* Actions Breakdown */}
                  <div className="p-4 rounded-lg border">
                    <p className="text-sm font-medium mb-4">Ações por Dia</p>
                    <ChartContainer config={chartConfig} className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="dateLabel" className="text-xs" />
                          <YAxis className="text-xs" />
                          <Tooltip content={<ChartTooltipContent />} />
                          <Legend />
                          <Bar dataKey="replies" fill="var(--color-replies)" name="Respostas" />
                          <Bar dataKey="leads" fill="var(--color-leads)" name="Leads" />
                          <Bar dataKey="follows" fill="var(--color-follows)" name="Seguindo" />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="flex-1 overflow-hidden mt-0 pt-4">
            <ScrollArea className="h-[400px]">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : reports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Calendar className="h-12 w-12 mb-3 opacity-50" />
                  <p>Nenhum relatório encontrado</p>
                  <p className="text-sm">Complete sessões de fluxo para ver o histórico</p>
                </div>
              ) : (
                <div className="space-y-2 pr-4">
                  {reports.map(report => (
                    <div 
                      key={report.id}
                      className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm">
                            {format(new Date(report.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Duração: {formatDuration(report.duration_seconds)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteReport(report.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {report.replies_count} respostas
                        </Badge>
                        {report.leads_created > 0 && (
                          <Badge variant="secondary" className="gap-1 bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
                            <Target className="h-3 w-3" />
                            {report.leads_created} leads
                          </Badge>
                        )}
                        {report.follows_count > 0 && (
                          <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                            <UserPlus className="h-3 w-3" />
                            {report.follows_count} seguindo
                          </Badge>
                        )}
                        {report.dms_sent > 0 && (
                          <Badge variant="secondary" className="gap-1 bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400">
                            <SendIcon className="h-3 w-3" />
                            {report.dms_sent} DMs
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
