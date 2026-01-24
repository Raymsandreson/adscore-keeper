import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Clock, 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  Settings2,
  Zap,
  MessageSquare,
  RefreshCw,
  Calendar
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useCommentSchedules, CreateScheduleInput } from "@/hooks/useCommentSchedules";

const INTERVALS = [
  { value: 5, label: "A cada 5 minutos" },
  { value: 10, label: "A cada 10 minutos" },
  { value: 15, label: "A cada 15 minutos" },
  { value: 30, label: "A cada 30 minutos" },
  { value: 60, label: "A cada 1 hora" },
];

const TONES = [
  { value: "friendly", label: "Amigável" },
  { value: "professional", label: "Profissional" },
  { value: "empathetic", label: "Empático" },
  { value: "sales", label: "Vendas" },
  { value: "casual", label: "Casual" },
];

export function CommentScheduleManager() {
  const { schedules, loading, createSchedule, toggleSchedule, deleteSchedule, runScheduleNow, fetchSchedules } = useCommentSchedules();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateScheduleInput>({
    name: "",
    interval_minutes: 30,
    max_comments_per_run: 5,
    auto_post: false,
    tone: "friendly",
  });

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    
    await createSchedule(formData);
    setDialogOpen(false);
    setFormData({
      name: "",
      interval_minutes: 30,
      max_comments_per_run: 5,
      auto_post: false,
      tone: "friendly",
    });
  };

  const handleRunNow = async (schedule: typeof schedules[0]) => {
    setExecuting(schedule.id);
    await runScheduleNow(schedule);
    setExecuting(null);
  };

  const getToneLabel = (value: string) => {
    return TONES.find(t => t.value === value)?.label || value;
  };

  const getIntervalLabel = (minutes: number) => {
    return INTERVALS.find(i => i.value === minutes)?.label || `A cada ${minutes} min`;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Agendamentos Automáticos
          </h4>
          <p className="text-sm text-muted-foreground">
            Configure execuções automáticas via pg_cron
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchSchedules} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Novo Agendamento
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Agendamento</DialogTitle>
                <DialogDescription>
                  Configure uma execução automática de respostas a comentários
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome do Agendamento</Label>
                  <Input
                    placeholder="Ex: Respostas Diárias"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Intervalo</Label>
                  <Select
                    value={String(formData.interval_minutes)}
                    onValueChange={(v) => setFormData({ ...formData, interval_minutes: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVALS.map((interval) => (
                        <SelectItem key={interval.value} value={String(interval.value)}>
                          {interval.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Máximo de Comentários por Execução</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={formData.max_comments_per_run}
                    onChange={(e) => setFormData({ ...formData, max_comments_per_run: parseInt(e.target.value) || 5 })}
                  />
                  <p className="text-xs text-muted-foreground">Máximo: 20 comentários</p>
                </div>

                <div className="space-y-2">
                  <Label>Tom das Respostas</Label>
                  <Select
                    value={formData.tone}
                    onValueChange={(v) => setFormData({ ...formData, tone: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((tone) => (
                        <SelectItem key={tone.value} value={tone.value}>
                          {tone.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Postar Respostas</Label>
                    <p className="text-xs text-muted-foreground">
                      Posta automaticamente as respostas geradas
                    </p>
                  </div>
                  <Switch
                    checked={formData.auto_post}
                    onCheckedChange={(v) => setFormData({ ...formData, auto_post: v })}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={!formData.name.trim()}>
                  Criar Agendamento
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Schedules List */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" />
          <p className="text-sm">Carregando agendamentos...</p>
        </div>
      ) : schedules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-center py-8">
            <Calendar className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground mb-3">
              Nenhum agendamento configurado
            </p>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeiro Agendamento
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <Card key={schedule.id} className={!schedule.is_active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full ${schedule.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                      <h5 className="font-medium truncate">{schedule.name}</h5>
                      <Badge variant={schedule.is_active ? "default" : "secondary"} className="text-xs">
                        {schedule.is_active ? "Ativo" : "Pausado"}
                      </Badge>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-2">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {getIntervalLabel(schedule.interval_minutes)}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        Max {schedule.max_comments_per_run}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Settings2 className="h-3 w-3" />
                        {getToneLabel(schedule.tone)}
                      </span>
                      {schedule.auto_post && (
                        <>
                          <span>•</span>
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            <Zap className="h-3 w-3 mr-1" />
                            Auto-post
                          </Badge>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-4 text-xs">
                      {schedule.last_run_at && (
                        <span className="text-muted-foreground">
                          Última execução: {formatDistanceToNow(new Date(schedule.last_run_at), { addSuffix: true, locale: ptBR })}
                        </span>
                      )}
                      {schedule.next_run_at && schedule.is_active && (
                        <span className="text-primary">
                          Próxima: {format(new Date(schedule.next_run_at), "HH:mm", { locale: ptBR })}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {schedule.total_runs} execuções • {schedule.total_replies} respostas
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRunNow(schedule)}
                      disabled={executing === schedule.id}
                      title="Executar agora"
                    >
                      {executing === schedule.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleSchedule(schedule.id, !schedule.is_active)}
                      title={schedule.is_active ? "Pausar" : "Retomar"}
                    >
                      {schedule.is_active ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4 text-green-600" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteSchedule(schedule.id)}
                      title="Excluir"
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

      {/* Info Card */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
        <CardContent className="p-4">
          <h5 className="font-medium text-sm flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-blue-500" />
            Como funciona?
          </h5>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Os agendamentos usam pg_cron para executar automaticamente</li>
            <li>• A cada intervalo, o sistema busca comentários pendentes e gera respostas IA</li>
            <li>• Com "Auto-post" ativado, as respostas são postadas automaticamente no Instagram</li>
            <li>• Todas as execuções são registradas na aba de Logs</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
