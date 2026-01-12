import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { format, addDays, addWeeks, addMonths, setHours, setMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Send, 
  Calendar, 
  Clock, 
  MessageSquare, 
  Settings, 
  Plus, 
  Trash2,
  Play,
  Pause,
  Copy,
  Check,
  Webhook,
  Zap,
  RefreshCw,
  History,
  Phone,
  FileText,
  Target
} from "lucide-react";
import { Goal } from "./GoalsManager";

interface ScheduledReport {
  id: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  dayOfWeek?: number; // 0-6 for Sunday-Saturday
  dayOfMonth?: number; // 1-31
  time: string; // HH:mm format
  phoneNumbers: string[];
  includeGoals: 'all' | 'active' | 'completed' | 'overdue';
  isActive: boolean;
  webhookUrl: string;
  lastSentAt?: Date;
  nextSendAt?: Date;
  createdAt: Date;
}

interface ReportLog {
  id: string;
  scheduleId: string;
  scheduleName: string;
  sentAt: Date;
  status: 'success' | 'failed';
  phoneNumbers: string[];
  message: string;
  error?: string;
}

interface GoalReportSchedulerProps {
  goals: Goal[];
  getProgress: (goal: Goal) => number;
  getStatus: (goal: Goal) => string;
}

const GoalReportScheduler = ({ goals, getProgress, getStatus }: GoalReportSchedulerProps) => {
  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [logs, setLogs] = useState<ReportLog[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<ScheduledReport['frequency']>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [time, setTime] = useState('09:00');
  const [phoneNumbers, setPhoneNumbers] = useState('');
  const [includeGoals, setIncludeGoals] = useState<ScheduledReport['includeGoals']>('active');

  // Load data from localStorage
  useEffect(() => {
    const savedSchedules = localStorage.getItem('goal_report_schedules');
    const savedLogs = localStorage.getItem('goal_report_logs');
    const savedWebhook = localStorage.getItem('n8n_webhook_url');
    
    if (savedSchedules) {
      const parsed = JSON.parse(savedSchedules);
      setSchedules(parsed.map((s: any) => ({
        ...s,
        lastSentAt: s.lastSentAt ? new Date(s.lastSentAt) : undefined,
        nextSendAt: s.nextSendAt ? new Date(s.nextSendAt) : undefined,
        createdAt: new Date(s.createdAt)
      })));
    }
    
    if (savedLogs) {
      const parsed = JSON.parse(savedLogs);
      setLogs(parsed.map((l: any) => ({
        ...l,
        sentAt: new Date(l.sentAt)
      })));
    }

    if (savedWebhook) {
      setWebhookUrl(savedWebhook);
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (schedules.length > 0) {
      localStorage.setItem('goal_report_schedules', JSON.stringify(schedules));
    }
  }, [schedules]);

  useEffect(() => {
    if (logs.length > 0) {
      localStorage.setItem('goal_report_logs', JSON.stringify(logs));
    }
  }, [logs]);

  const saveWebhookUrl = () => {
    localStorage.setItem('n8n_webhook_url', webhookUrl);
    toast.success('Webhook n8n salvo com sucesso!');
    setIsSettingsOpen(false);
  };

  const generateReportMessage = (filteredGoals: Goal[]) => {
    const now = new Date();
    const dateStr = format(now, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    
    let message = `📊 *RELATÓRIO DE METAS*\n`;
    message += `📅 ${dateStr}\n\n`;

    if (filteredGoals.length === 0) {
      message += `Nenhuma meta encontrada para este filtro.\n`;
      return message;
    }

    // Summary
    const completed = filteredGoals.filter(g => getStatus(g) === 'completed').length;
    const overdue = filteredGoals.filter(g => getStatus(g) === 'overdue').length;
    const inProgress = filteredGoals.filter(g => ['in-progress', 'on-track', 'urgent'].includes(getStatus(g))).length;

    message += `📈 *RESUMO*\n`;
    message += `✅ Concluídas: ${completed}\n`;
    message += `⚠️ Atrasadas: ${overdue}\n`;
    message += `🔄 Em progresso: ${inProgress}\n`;
    message += `📋 Total: ${filteredGoals.length}\n\n`;

    message += `━━━━━━━━━━━━━━━━\n\n`;

    // Goals detail
    filteredGoals.forEach((goal, index) => {
      const progress = getProgress(goal);
      const status = getStatus(goal);
      const statusEmoji = status === 'completed' ? '✅' : status === 'overdue' ? '❌' : status === 'urgent' ? '⚠️' : '🔄';
      const progressBar = getProgressBar(progress);

      message += `${statusEmoji} *${goal.title}*\n`;
      message += `${progressBar} ${progress.toFixed(0)}%\n`;
      message += `📊 ${goal.currentValue} / ${goal.targetValue} ${goal.unit}\n`;
      message += `📅 Prazo: ${format(goal.deadline, "dd/MM/yyyy", { locale: ptBR })}\n`;
      if (goal.notes) {
        message += `📝 ${goal.notes}\n`;
      }
      if (index < filteredGoals.length - 1) {
        message += `\n`;
      }
    });

    message += `\n━━━━━━━━━━━━━━━━\n`;
    message += `_Relatório gerado automaticamente_`;

    return message;
  };

  const getProgressBar = (progress: number) => {
    const filled = Math.round(progress / 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
  };

  const getFilteredGoals = (filter: ScheduledReport['includeGoals']) => {
    switch (filter) {
      case 'completed':
        return goals.filter(g => getStatus(g) === 'completed');
      case 'overdue':
        return goals.filter(g => getStatus(g) === 'overdue');
      case 'active':
        return goals.filter(g => !['completed'].includes(getStatus(g)));
      default:
        return goals;
    }
  };

  const calculateNextSendDate = (schedule: Partial<ScheduledReport>) => {
    const now = new Date();
    const [hours, minutes] = (schedule.time || '09:00').split(':').map(Number);
    let nextDate = setMinutes(setHours(now, hours), minutes);

    if (nextDate <= now) {
      nextDate = addDays(nextDate, 1);
    }

    switch (schedule.frequency) {
      case 'daily':
        return nextDate;
      case 'weekly':
        while (nextDate.getDay() !== (schedule.dayOfWeek || 1)) {
          nextDate = addDays(nextDate, 1);
        }
        return nextDate;
      case 'monthly':
        nextDate.setDate(schedule.dayOfMonth || 1);
        if (nextDate <= now) {
          nextDate = addMonths(nextDate, 1);
        }
        return nextDate;
      default:
        return nextDate;
    }
  };

  const handleSaveSchedule = () => {
    if (!name || !webhookUrl) {
      toast.error('Preencha o nome e configure o webhook n8n');
      return;
    }

    const phones = phoneNumbers.split(',').map(p => p.trim()).filter(Boolean);
    if (phones.length === 0) {
      toast.error('Adicione pelo menos um número de telefone');
      return;
    }

    const newSchedule: ScheduledReport = {
      id: crypto.randomUUID(),
      name,
      frequency,
      dayOfWeek: frequency === 'weekly' ? dayOfWeek : undefined,
      dayOfMonth: frequency === 'monthly' ? dayOfMonth : undefined,
      time,
      phoneNumbers: phones,
      includeGoals,
      isActive: true,
      webhookUrl,
      nextSendAt: calculateNextSendDate({ frequency, dayOfWeek, dayOfMonth, time }),
      createdAt: new Date()
    };

    setSchedules(prev => [...prev, newSchedule]);
    setIsDialogOpen(false);
    resetForm();
    toast.success('Agendamento criado com sucesso!');
  };

  const resetForm = () => {
    setName('');
    setFrequency('weekly');
    setDayOfWeek(1);
    setDayOfMonth(1);
    setTime('09:00');
    setPhoneNumbers('');
    setIncludeGoals('active');
  };

  const toggleSchedule = (id: string) => {
    setSchedules(prev => prev.map(s => 
      s.id === id ? { ...s, isActive: !s.isActive } : s
    ));
  };

  const deleteSchedule = (id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
    toast.success('Agendamento removido');
  };

  const sendReportNow = async (schedule: ScheduledReport) => {
    if (!schedule.webhookUrl) {
      toast.error('Configure o webhook n8n primeiro');
      return;
    }

    setIsTesting(true);
    const filteredGoals = getFilteredGoals(schedule.includeGoals);
    const message = generateReportMessage(filteredGoals);

    try {
      const response = await fetch(schedule.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        mode: 'no-cors',
        body: JSON.stringify({
          phoneNumbers: schedule.phoneNumbers,
          message,
          scheduleName: schedule.name,
          timestamp: new Date().toISOString(),
          goalsCount: filteredGoals.length,
          summary: {
            completed: filteredGoals.filter(g => getStatus(g) === 'completed').length,
            overdue: filteredGoals.filter(g => getStatus(g) === 'overdue').length,
            inProgress: filteredGoals.filter(g => ['in-progress', 'on-track', 'urgent'].includes(getStatus(g))).length
          }
        }),
      });

      // Log the send
      const log: ReportLog = {
        id: crypto.randomUUID(),
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        sentAt: new Date(),
        status: 'success',
        phoneNumbers: schedule.phoneNumbers,
        message
      };
      setLogs(prev => [log, ...prev].slice(0, 50)); // Keep last 50 logs

      // Update schedule
      setSchedules(prev => prev.map(s => 
        s.id === schedule.id ? {
          ...s,
          lastSentAt: new Date(),
          nextSendAt: calculateNextSendDate(s)
        } : s
      ));

      toast.success('Relatório enviado para n8n! Verifique seu workflow.');
    } catch (error) {
      console.error('Erro ao enviar:', error);
      
      const log: ReportLog = {
        id: crypto.randomUUID(),
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        sentAt: new Date(),
        status: 'failed',
        phoneNumbers: schedule.phoneNumbers,
        message,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
      setLogs(prev => [log, ...prev].slice(0, 50));
      
      toast.error('Erro ao enviar relatório');
    } finally {
      setIsTesting(false);
    }
  };

  const copyMessageToClipboard = () => {
    const message = generateReportMessage(getFilteredGoals('active'));
    navigator.clipboard.writeText(message);
    setCopiedMessage(true);
    toast.success('Mensagem copiada!');
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  const getFrequencyLabel = (schedule: ScheduledReport) => {
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    switch (schedule.frequency) {
      case 'daily':
        return `Diário às ${schedule.time}`;
      case 'weekly':
        return `${days[schedule.dayOfWeek || 0]} às ${schedule.time}`;
      case 'monthly':
        return `Dia ${schedule.dayOfMonth} às ${schedule.time}`;
      default:
        return schedule.time;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Relatórios Automáticos
          </h3>
          <p className="text-sm text-muted-foreground">
            Agende relatórios de metas via WhatsApp com n8n
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyMessageToClipboard}>
            {copiedMessage ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">Copiar Mensagem</span>
          </Button>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Configurar n8n</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Webhook className="h-5 w-5" />
                  Configurar Webhook n8n
                </DialogTitle>
                <DialogDescription>
                  Configure a URL do webhook do seu workflow n8n para receber os relatórios
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>URL do Webhook n8n</Label>
                  <Input 
                    placeholder="https://seu-n8n.com/webhook/..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cole a URL do webhook do seu workflow n8n que enviará para o WhatsApp
                  </p>
                </div>

                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    Como configurar no n8n:
                  </h4>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Crie um workflow com trigger "Webhook"</li>
                    <li>Adicione o nó "WhatsApp Business Cloud"</li>
                    <li>Configure com sua conta WhatsApp Business</li>
                    <li>Mapeie os campos: phoneNumbers e message</li>
                    <li>Ative o workflow e copie a URL do webhook</li>
                  </ol>
                </div>

                <Button onClick={saveWebhookUrl} className="w-full">
                  Salvar Configuração
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="schedules" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="schedules" className="gap-2">
            <Calendar className="h-4 w-4" />
            Agendamentos
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-2">
            <FileText className="h-4 w-4" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <History className="h-4 w-4" />
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="space-y-4 mt-4">
          {!webhookUrl && (
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Webhook className="h-5 w-5 text-orange-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-orange-800 dark:text-orange-200">
                      Configure o webhook n8n primeiro
                    </p>
                    <p className="text-sm text-orange-600 dark:text-orange-300">
                      Clique em "Configurar n8n" para adicionar a URL do seu webhook
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full gap-2" disabled={!webhookUrl}>
                <Plus className="h-4 w-4" />
                Novo Agendamento
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Novo Agendamento de Relatório</DialogTitle>
                <DialogDescription>
                  Configure quando e para quem enviar os relatórios
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome do Agendamento</Label>
                  <Input 
                    placeholder="Ex: Relatório Semanal - Equipe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Frequência</Label>
                    <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduledReport['frequency'])}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Diário</SelectItem>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="monthly">Mensal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {frequency === 'weekly' && (
                    <div className="space-y-2">
                      <Label>Dia da Semana</Label>
                      <Select value={dayOfWeek.toString()} onValueChange={(v) => setDayOfWeek(parseInt(v))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Domingo</SelectItem>
                          <SelectItem value="1">Segunda</SelectItem>
                          <SelectItem value="2">Terça</SelectItem>
                          <SelectItem value="3">Quarta</SelectItem>
                          <SelectItem value="4">Quinta</SelectItem>
                          <SelectItem value="5">Sexta</SelectItem>
                          <SelectItem value="6">Sábado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {frequency === 'monthly' && (
                    <div className="space-y-2">
                      <Label>Dia do Mês</Label>
                      <Select value={dayOfMonth.toString()} onValueChange={(v) => setDayOfMonth(parseInt(v))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 28 }, (_, i) => (
                            <SelectItem key={i + 1} value={(i + 1).toString()}>
                              Dia {i + 1}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Horário</Label>
                    <Input 
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Incluir Metas</Label>
                    <Select value={includeGoals} onValueChange={(v) => setIncludeGoals(v as ScheduledReport['includeGoals'])}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="active">Ativas</SelectItem>
                        <SelectItem value="completed">Concluídas</SelectItem>
                        <SelectItem value="overdue">Atrasadas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Números de WhatsApp
                  </Label>
                  <Input 
                    placeholder="5511999999999, 5511888888888"
                    value={phoneNumbers}
                    onChange={(e) => setPhoneNumbers(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Números com código do país, separados por vírgula
                  </p>
                </div>

                <Button 
                  className="w-full" 
                  onClick={handleSaveSchedule}
                  disabled={!name || !phoneNumbers}
                >
                  Criar Agendamento
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {schedules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Nenhum agendamento</h3>
                <p className="text-muted-foreground">
                  Crie um agendamento para enviar relatórios automaticamente
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => (
                <Card key={schedule.id} className="border-border/50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-medium">{schedule.name}</h4>
                          <Badge variant={schedule.isActive ? "default" : "secondary"}>
                            {schedule.isActive ? 'Ativo' : 'Pausado'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {getFrequencyLabel(schedule)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-4 w-4" />
                            {schedule.phoneNumbers.length} número(s)
                          </span>
                          <span className="flex items-center gap-1">
                            <Target className="h-4 w-4" />
                            {schedule.includeGoals === 'all' ? 'Todas' : 
                             schedule.includeGoals === 'active' ? 'Ativas' :
                             schedule.includeGoals === 'completed' ? 'Concluídas' : 'Atrasadas'}
                          </span>
                        </div>
                        {schedule.nextSendAt && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Próximo envio: {format(schedule.nextSendAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="icon"
                          onClick={() => sendReportNow(schedule)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon"
                          onClick={() => toggleSchedule(schedule.id)}
                        >
                          {schedule.isActive ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon"
                          onClick={() => deleteSchedule(schedule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5" />
                Preview da Mensagem
              </CardTitle>
              <CardDescription>
                Assim ficará o relatório enviado pelo WhatsApp
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-[#075E54] rounded-lg p-4 max-w-md">
                <div className="bg-[#DCF8C6] rounded-lg p-3 text-[#303030] text-sm whitespace-pre-wrap font-[system-ui]">
                  {generateReportMessage(getFilteredGoals('active'))}
                </div>
                <div className="text-right mt-1">
                  <span className="text-xs text-white/60">
                    {format(new Date(), "HH:mm")}
                  </span>
                </div>
              </div>
              <Button 
                variant="outline" 
                className="mt-4 gap-2"
                onClick={copyMessageToClipboard}
              >
                {copiedMessage ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copiar Mensagem
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="h-5 w-5" />
                Histórico de Envios
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Nenhum envio realizado ainda</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-3">
                    {logs.map((log) => (
                      <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <div className={`h-2 w-2 rounded-full mt-2 ${log.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="font-medium">{log.scheduleName}</p>
                            <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                              {log.status === 'success' ? 'Enviado' : 'Falhou'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(log.sentAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Para: {log.phoneNumbers.join(', ')}
                          </p>
                          {log.error && (
                            <p className="text-xs text-red-500 mt-1">
                              Erro: {log.error}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GoalReportScheduler;
