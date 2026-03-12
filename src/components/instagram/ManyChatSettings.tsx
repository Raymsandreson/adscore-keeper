import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Bot, Send, Search, Zap, CheckCircle, XCircle, Loader2, MessageSquare, History, Copy, Settings, Webhook } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

export const ManyChatSettings = () => {
  const queryClient = useQueryClient();
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connected" | "error">("idle");
  const [pageInfo, setPageInfo] = useState<any>(null);

  // Send AI Reply state
  const [subscriberId, setSubscriberId] = useState("");
  const [incomingMessage, setIncomingMessage] = useState("");
  const [aiContext, setAiContext] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lastReply, setLastReply] = useState("");

  // Find subscriber state
  const [searchName, setSearchName] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Agent config
  const [systemPrompt, setSystemPrompt] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);

  const webhookUrl = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/manychat-webhook`;

  // Fetch agent config
  const { data: agentConfig } = useQuery({
    queryKey: ["manychat-agent-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("manychat_agent_config")
        .select("*")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (agentConfig) {
      setSystemPrompt(agentConfig.system_prompt || "");
      setAutoReplyEnabled(agentConfig.auto_reply_enabled ?? true);
    }
  }, [agentConfig]);

  // Interactions history
  const { data: interactions, refetch: refetchInteractions } = useQuery({
    queryKey: ["manychat-interactions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("manychat_interactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const saveConfig = async () => {
    try {
      if (agentConfig?.id) {
        await (supabase as any)
          .from("manychat_agent_config")
          .update({ system_prompt: systemPrompt, auto_reply_enabled: autoReplyEnabled, updated_at: new Date().toISOString() })
          .eq("id", agentConfig.id);
      } else {
        await (supabase as any)
          .from("manychat_agent_config")
          .insert({ system_prompt: systemPrompt, auto_reply_enabled: autoReplyEnabled });
      }
      queryClient.invalidateQueries({ queryKey: ["manychat-agent-config"] });
      toast.success("Configuração salva!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    }
  };

  const testConnection = async () => {
    setIsTestingConnection(true);
    try {
      const { data, error } = await supabase.functions.invoke("manychat-send-message", {
        body: { action: "test_connection" },
      });
      if (error) throw error;
      if (data.connected) {
        setConnectionStatus("connected");
        setPageInfo(data.data?.data);
        toast.success("ManyChat conectado com sucesso!");
      } else {
        setConnectionStatus("error");
        toast.error("Falha na conexão com ManyChat");
      }
    } catch (err: any) {
      setConnectionStatus("error");
      toast.error("Erro ao testar conexão: " + err.message);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const sendAiReply = async () => {
    if (!subscriberId || !incomingMessage) {
      toast.error("Preencha o ID do assinante e a mensagem");
      return;
    }
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("manychat-send-message", {
        body: {
          action: "send_ai_reply",
          subscriber_id: subscriberId,
          incoming_message: incomingMessage,
          context: aiContext,
        },
      });
      if (error) throw error;
      if (data.success) {
        setLastReply(data.ai_reply);
        toast.success("Resposta IA enviada com sucesso!");
        refetchInteractions();
      } else {
        toast.error("Erro ao enviar: " + JSON.stringify(data.manychat_response));
      }
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsSending(false);
    }
  };

  const findSubscriber = async () => {
    if (!searchName) return;
    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("manychat-send-message", {
        body: { action: "find_subscriber", name: searchName },
      });
      if (error) throw error;
      setSearchResults(data?.data || []);
      if (!data?.data?.length) toast.info("Nenhum assinante encontrado");
    } catch (err: any) {
      toast.error("Erro na busca: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL do webhook copiada!");
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            ManyChat + IA (Automação Instagram)
          </CardTitle>
          <CardDescription>
            Respostas automáticas com IA no Instagram — funciona igual aos assistentes de WhatsApp
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button onClick={testConnection} disabled={isTestingConnection} variant="outline">
              {isTestingConnection ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Testar Conexão
            </Button>
            <Badge variant={connectionStatus === "connected" ? "default" : connectionStatus === "error" ? "destructive" : "secondary"}
              className={connectionStatus === "connected" ? "bg-green-500" : ""}>
              {connectionStatus === "connected" && <><CheckCircle className="h-3 w-3 mr-1" /> Conectado</>}
              {connectionStatus === "error" && <><XCircle className="h-3 w-3 mr-1" /> Erro</>}
              {connectionStatus === "idle" && "Não testado"}
            </Badge>
          </div>
          {pageInfo && (
            <div className="text-sm text-muted-foreground">
              Página: <strong>{pageInfo.name || pageInfo.page_name}</strong>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs defaultValue="webhook" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="webhook" className="gap-1 text-xs">
            <Webhook className="h-4 w-4" /> Webhook
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1 text-xs">
            <Settings className="h-4 w-4" /> Prompt IA
          </TabsTrigger>
          <TabsTrigger value="send" className="gap-1 text-xs">
            <Send className="h-4 w-4" /> Manual
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1 text-xs">
            <History className="h-4 w-4" /> Histórico
          </TabsTrigger>
        </TabsList>

        {/* Webhook Setup */}
        <TabsContent value="webhook">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Webhook className="h-5 w-5 text-primary" />
                Configurar Resposta Automática
              </CardTitle>
              <CardDescription>
                Configure o ManyChat para enviar mensagens recebidas para este webhook. A IA responde automaticamente!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Webhook URL */}
              <div className="space-y-2">
                <Label className="font-semibold">URL do Webhook</Label>
                <div className="flex gap-2">
                  <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                  <Button onClick={copyWebhookUrl} variant="outline" size="icon">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Auto reply toggle */}
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <Label className="font-medium">Resposta Automática</Label>
                  <p className="text-xs text-muted-foreground">Quando ativado, a IA responde automaticamente via webhook</p>
                </div>
                <Switch checked={autoReplyEnabled} onCheckedChange={(v) => { setAutoReplyEnabled(v); }} />
              </div>

              {/* Step by step instructions */}
              <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                <h4 className="font-semibold text-sm">📋 Como configurar no ManyChat:</h4>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">1.</span>
                    <span>No ManyChat, vá em <strong>Automation → Flows</strong> e crie um novo Flow</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">2.</span>
                    <span>Defina o <strong>Trigger</strong> como <strong>"Default Reply"</strong> (responde a qualquer mensagem)</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">3.</span>
                    <span>Adicione uma ação <strong>"External Request"</strong> (POST)</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">4.</span>
                    <span>Cole a URL do webhook acima no campo URL</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">5.</span>
                    <span>No <strong>Body (JSON)</strong>, configure:</span>
                  </li>
                </ol>
                <div className="p-3 bg-background border rounded font-mono text-xs overflow-x-auto">
                  <pre>{`{
  "subscriber_id": "{{subscriber_id}}",
  "first_name": "{{first_name}}",
  "last_name": "{{last_name}}",
  "last_input_text": "{{last_input_text}}",
  "platform": "instagram"
}`}</pre>
                </div>
                <ol className="space-y-3 text-sm" start={6}>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">6.</span>
                    <span>Em <strong>Response Mapping</strong>, mapeie <code>content.messages[0].text</code> para um Custom Field (ex: "ai_reply")</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">7.</span>
                    <span>Adicione uma ação <strong>"Send Message"</strong> usando o Custom Field <code>{"{{ai_reply}}"}</code></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-primary">8.</span>
                    <span><strong>Publique o Flow</strong> e pronto! A IA responderá automaticamente 🎉</span>
                  </li>
                </ol>
              </div>

              <Button onClick={saveConfig} className="w-full">
                Salvar Configurações
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Config */}
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Prompt do Assistente IA</CardTitle>
              <CardDescription>Configure a personalidade e instruções da IA para responder no Instagram</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Prompt do Sistema (Personalidade da IA)</Label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Descreva como a IA deve se comportar..."
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Este prompt define como a IA responde no Instagram, igual ao "Prompt Base" dos agentes de WhatsApp.
                </p>
              </div>
              <Button onClick={saveConfig} className="w-full">
                Salvar Prompt
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Send */}
        <TabsContent value="send">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Envio Manual</CardTitle>
              <CardDescription>
                Envie uma resposta IA manualmente para um assinante específico
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>ID do Assinante (ManyChat)</Label>
                <Input value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)}
                  placeholder="Ex: 654156908" />
              </div>
              <div>
                <Label>Mensagem Recebida do Cliente</Label>
                <Textarea value={incomingMessage} onChange={(e) => setIncomingMessage(e.target.value)}
                  placeholder="Cole aqui a mensagem que o cliente enviou..." rows={3} />
              </div>
              <div>
                <Label>Contexto Adicional (opcional)</Label>
                <Textarea value={aiContext} onChange={(e) => setAiContext(e.target.value)}
                  placeholder="Ex: Cliente interessado em caso trabalhista..." rows={2} />
              </div>

              {/* Search */}
              <div className="border-t pt-4">
                <Label className="text-xs text-muted-foreground">Buscar assinante por nome</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={searchName} onChange={(e) => setSearchName(e.target.value)}
                    placeholder="Nome..." className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && findSubscriber()} />
                  <Button onClick={findSubscriber} disabled={isSearching} size="sm">
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                    {searchResults.map((sub: any) => (
                      <div key={sub.id} className="flex items-center justify-between p-2 border rounded text-sm">
                        <div>
                          <span className="font-medium">{sub.name || sub.first_name + " " + (sub.last_name || "")}</span>
                          <span className="text-xs text-muted-foreground ml-2">ID: {sub.id}</span>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => { setSubscriberId(String(sub.id)); toast.success("ID selecionado"); }}>
                          Usar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button onClick={sendAiReply} disabled={isSending} className="w-full">
                {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Gerar e Enviar Resposta IA
              </Button>
              {lastReply && (
                <div className="p-3 bg-muted rounded-lg">
                  <Label className="text-xs text-muted-foreground">Última resposta gerada:</Label>
                  <p className="text-sm mt-1">{lastReply}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Histórico de Interações</CardTitle>
              <CardDescription>Mensagens recebidas e respostas da IA</CardDescription>
            </CardHeader>
            <CardContent>
              {!interactions?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma interação registrada. Configure o webhook para começar!</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {interactions.map((item: any) => (
                    <div key={item.id} className="p-3 border rounded-lg space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {item.metadata?.subscriber_name || `#${item.subscriber_id}`}
                          </span>
                          <Badge variant={item.direction === "inbound" ? "outline" : "secondary"} className="text-xs">
                            {item.direction === "inbound" ? "📩 Recebido" : "📤 Enviado"}
                          </Badge>
                          <Badge variant={item.status === "sent" ? "default" : "destructive"} className="text-xs">
                            {item.status}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(item.created_at), "dd/MM HH:mm")}
                        </span>
                      </div>
                      {item.message_text && (
                        <p className="text-xs text-muted-foreground">👤 {item.message_text}</p>
                      )}
                      {item.ai_generated_reply && (
                        <p className="text-xs">🤖 {item.ai_generated_reply.substring(0, 200)}{item.ai_generated_reply.length > 200 ? "..." : ""}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
