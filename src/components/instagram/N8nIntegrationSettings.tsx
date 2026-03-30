import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Webhook, 
  Copy, 
  Check, 
  ExternalLink, 
  Play, 
  Settings2,
  History,
  Zap,
  MessageSquare,
  RefreshCw,
  AlertCircle,
  Clock
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CommentScheduleManager } from "./CommentScheduleManager";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface AutomationLog {
  id: string;
  action_type: string;
  comment_id: string | null;
  message_sent: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface N8nSettings {
  enabled: boolean;
  autoPost: boolean;
  defaultTone: string;
  maxRepliesPerRun: number;
  webhookSecret: string;
}

export function N8nIntegrationSettings() {
  const [copied, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [settings, setSettings] = useState<N8nSettings>({
    enabled: false,
    autoPost: false,
    defaultTone: "friendly",
    maxRepliesPerRun: 5,
    webhookSecret: "",
  });

  const webhookUrl = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/n8n-comment-webhook`;

  useEffect(() => {
    loadSettings();
    loadLogs();
  }, []);

  const loadSettings = () => {
    const saved = localStorage.getItem("n8n_integration_settings");
    if (saved) {
      setSettings(JSON.parse(saved));
    }
  };

  const saveSettings = (newSettings: N8nSettings) => {
    setSettings(newSettings);
    localStorage.setItem("n8n_integration_settings", JSON.stringify(newSettings));
    toast.success("Configurações salvas!");
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      // Use fetch directly since table was just created and types not regenerated yet
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/n8n_automation_logs?select=*&order=created_at.desc&limit=50`,
        {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setLogs(data || []);
      }
    } catch (error) {
      console.error("Error loading logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("Copiado!");
    setTimeout(() => setCopied(null), 2000);
  };

  const testWebhook = async (action: string) => {
    setTesting(true);
    try {
      const response = await cloudFunctions.invoke("n8n-comment-webhook", {
        body: {
          action,
          limit: 3,
          tone: settings.defaultTone,
        },
      });

      if (response.error) throw response.error;
      
      toast.success(`Teste "${action}" executado com sucesso!`);
      console.log("Test response:", response.data);
      loadLogs();
    } catch (error: any) {
      toast.error(error.message || "Erro no teste");
    } finally {
      setTesting(false);
    }
  };

  const TONES = [
    { value: "friendly", label: "Amigável" },
    { value: "professional", label: "Profissional" },
    { value: "empathetic", label: "Empático" },
    { value: "sales", label: "Vendas" },
    { value: "casual", label: "Casual" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Webhook className="h-5 w-5 text-orange-500" />
            Integração n8n
          </h3>
          <p className="text-sm text-muted-foreground">
            Automatize respostas de comentários usando n8n + IA
          </p>
        </div>
        <Badge variant={settings.enabled ? "default" : "secondary"}>
          {settings.enabled ? "Ativo" : "Inativo"}
        </Badge>
      </div>

      <Tabs defaultValue="setup" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="setup" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Configuração
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-2">
            <Clock className="h-4 w-4" />
            Agendamentos
          </TabsTrigger>
          <TabsTrigger value="endpoints" className="gap-2">
            <Zap className="h-4 w-4" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <History className="h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        {/* Setup Tab */}
        <TabsContent value="setup" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configurações Gerais</CardTitle>
              <CardDescription>
                Configure o comportamento da automação
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Habilitar Integração</Label>
                  <p className="text-xs text-muted-foreground">
                    Permite que o n8n acesse os endpoints
                  </p>
                </div>
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(enabled) => saveSettings({ ...settings, enabled })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-Postar Respostas</Label>
                  <p className="text-xs text-muted-foreground">
                    Posta automaticamente as respostas geradas pela IA
                  </p>
                </div>
                <Switch
                  checked={settings.autoPost}
                  onCheckedChange={(autoPost) => saveSettings({ ...settings, autoPost })}
                />
              </div>

              <div className="space-y-2">
                <Label>Tom Padrão das Respostas</Label>
                <Select
                  value={settings.defaultTone}
                  onValueChange={(defaultTone) => saveSettings({ ...settings, defaultTone })}
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

              <div className="space-y-2">
                <Label>Máximo de Respostas por Execução</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.maxRepliesPerRun}
                  onChange={(e) => saveSettings({ ...settings, maxRepliesPerRun: parseInt(e.target.value) || 5 })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Quick Guide */}
          <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-500" />
                Guia Rápido n8n
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-2">
                <span className="font-semibold text-orange-600">1.</span>
                <span>Crie um workflow no n8n com um trigger (ex: Schedule ou Webhook)</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold text-orange-600">2.</span>
                <span>Adicione um node HTTP Request apontando para os endpoints abaixo</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold text-orange-600">3.</span>
                <span>Use <code className="bg-orange-100 dark:bg-orange-900 px-1 rounded">auto_process</code> para automação completa</span>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={() => window.open("https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/", "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Documentação n8n
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedules Tab */}
        <TabsContent value="schedules" className="mt-4">
          <CommentScheduleManager />
        </TabsContent>

        {/* Endpoints Tab */}
        <TabsContent value="endpoints" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">URL do Webhook</CardTitle>
              <CardDescription>
                Use esta URL no node HTTP Request do n8n
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(webhookUrl, "url")}
                >
                  {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="grid gap-4">
            {/* fetch_pending_comments */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    fetch_pending_comments
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => testWebhook("fetch_pending_comments")} disabled={testing}>
                    <Play className="h-3 w-3 mr-1" />
                    Testar
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  Retorna comentários pendentes de resposta
                </p>
                <div className="bg-muted p-2 rounded text-xs font-mono">
                  {`{ "action": "fetch_pending_comments", "limit": 10 }`}
                </div>
              </CardContent>
            </Card>

            {/* generate_reply */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    generate_reply
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  Gera resposta IA para um comentário específico
                </p>
                <div className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto">
                  {`{ "action": "generate_reply", "comment_id": "...", "comment_text": "...", "author_username": "...", "tone": "friendly" }`}
                </div>
              </CardContent>
            </Card>

            {/* post_reply */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-green-500" />
                    post_reply
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  Posta uma resposta no Instagram
                </p>
                <div className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto">
                  {`{ "action": "post_reply", "comment_id": "...", "message": "...", "access_token": "..." }`}
                </div>
              </CardContent>
            </Card>

            {/* auto_process */}
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-orange-500" />
                    auto_process
                    <Badge variant="outline" className="text-orange-500 border-orange-500">Recomendado</Badge>
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => testWebhook("auto_process")} disabled={testing}>
                    <Play className="h-3 w-3 mr-1" />
                    Testar
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  Automação completa: busca comentários, gera IA e opcionalmente posta
                </p>
                <div className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto">
                  {`{ "action": "auto_process", "limit": 5, "auto_post": true, "access_token": "..." }`}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Histórico de Automação</CardTitle>
                <Button variant="outline" size="sm" onClick={loadLogs} disabled={loadingLogs}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loadingLogs ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhum log de automação ainda</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                      >
                        <div className={`p-1.5 rounded-full ${
                          log.status === "success" 
                            ? "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
                            : "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400"
                        }`}>
                          {log.status === "success" ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {log.action_type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(log.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                          {log.message_sent && (
                            <p className="text-xs mt-1 text-muted-foreground truncate">
                              {log.message_sent}
                            </p>
                          )}
                          {log.error_message && (
                            <p className="text-xs mt-1 text-red-500">
                              {log.error_message}
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
}
