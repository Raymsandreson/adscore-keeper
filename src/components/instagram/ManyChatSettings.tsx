import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Send, Search, Zap, CheckCircle, XCircle, Loader2, MessageSquare, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

export const ManyChatSettings = () => {
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

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            ManyChat + IA
          </CardTitle>
          <CardDescription>
            Integração com ManyChat para respostas automáticas com IA no Instagram e Facebook
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
      <Tabs defaultValue="send" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="send" className="gap-2">
            <Send className="h-4 w-4" /> Enviar Resposta IA
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-2">
            <Search className="h-4 w-4" /> Buscar Assinante
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" /> Histórico
          </TabsTrigger>
        </TabsList>

        {/* Send AI Reply */}
        <TabsContent value="send">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Resposta Automática com IA</CardTitle>
              <CardDescription>
                A IA gera uma resposta personalizada e envia via ManyChat
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>ID do Assinante (ManyChat)</Label>
                <Input value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)}
                  placeholder="Ex: 123456789" />
              </div>
              <div>
                <Label>Mensagem Recebida do Cliente</Label>
                <Textarea value={incomingMessage} onChange={(e) => setIncomingMessage(e.target.value)}
                  placeholder="Cole aqui a mensagem que o cliente enviou..." rows={3} />
              </div>
              <div>
                <Label>Contexto Adicional (opcional)</Label>
                <Textarea value={aiContext} onChange={(e) => setAiContext(e.target.value)}
                  placeholder="Ex: Cliente interessado em caso trabalhista, já fez consulta inicial..." rows={2} />
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

        {/* Search Subscriber */}
        <TabsContent value="search">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Buscar Assinante</CardTitle>
              <CardDescription>Encontre assinantes do ManyChat por nome</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={searchName} onChange={(e) => setSearchName(e.target.value)}
                  placeholder="Nome do assinante..." className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && findSubscriber()} />
                <Button onClick={findSubscriber} disabled={isSearching}>
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  {searchResults.map((sub: any) => (
                    <div key={sub.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{sub.name || sub.first_name + " " + sub.last_name}</p>
                        <p className="text-xs text-muted-foreground">ID: {sub.id}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => {
                        setSubscriberId(String(sub.id));
                        toast.success("ID copiado para envio");
                      }}>
                        Usar
                      </Button>
                    </div>
                  ))}
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
              <CardDescription>Últimas mensagens enviadas via ManyChat</CardDescription>
            </CardHeader>
            <CardContent>
              {!interactions?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma interação registrada</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {interactions.map((item: any) => (
                    <div key={item.id} className="p-3 border rounded-lg space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">#{item.subscriber_id}</span>
                          <Badge variant={item.status === "sent" ? "default" : "destructive"} className="text-xs">
                            {item.status}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(item.created_at), "dd/MM HH:mm")}
                        </span>
                      </div>
                      {item.message_text && (
                        <p className="text-xs text-muted-foreground">📩 {item.message_text}</p>
                      )}
                      {item.ai_generated_reply && (
                        <p className="text-xs">🤖 {item.ai_generated_reply.substring(0, 150)}...</p>
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
