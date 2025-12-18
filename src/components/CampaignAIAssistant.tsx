import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  MessageSquare, 
  FileText, 
  Send, 
  Loader2, 
  Bot, 
  User,
  Sparkles,
  Target,
  X
} from "lucide-react";
import { CampaignInsight } from "@/services/metaAPI";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CampaignAIAssistantProps {
  item: CampaignInsight;
  onClose: () => void;
}

const CampaignAIAssistant = ({ item, onClose }: CampaignAIAssistantProps) => {
  const [activeTab, setActiveTab] = useState<"questions" | "copy">("questions");
  const [messages, setMessages] = useState<Message[]>([]);
  const [copyMessages, setCopyMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [copyInput, setCopyInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasStartedQuestions, setHasStartedQuestions] = useState(false);

  const streamChat = async (
    userMessages: Message[],
    type: "questions" | "copy_analysis" | "general",
    setMessagesFunc: React.Dispatch<React.SetStateAction<Message[]>>
  ) => {
    setIsLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaign-ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: userMessages,
            campaignData: item,
            type,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erro ao processar requisição");
      }

      if (!response.body) throw new Error("Sem resposta do servidor");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantContent = "";

      // Add empty assistant message
      setMessagesFunc(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessagesFunc(prev => {
                const newMessages = [...prev];
                const lastIndex = newMessages.length - 1;
                if (newMessages[lastIndex]?.role === "assistant") {
                  newMessages[lastIndex] = { role: "assistant", content: assistantContent };
                }
                return newMessages;
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (error) {
      console.error("AI Chat error:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao conectar com a IA");
    } finally {
      setIsLoading(false);
    }
  };

  const startQuestions = async () => {
    setHasStartedQuestions(true);
    const initialMessage: Message = { 
      role: "user", 
      content: "Olá! Preciso de ajuda para otimizar esta campanha. Pode fazer perguntas para entender melhor o contexto?" 
    };
    setMessages([initialMessage]);
    await streamChat([initialMessage], "questions", setMessages);
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage: Message = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    
    await streamChat(newMessages, "questions", setMessages);
  };

  const analyzeCopy = async () => {
    if (!copyInput.trim() || isLoading) return;
    
    const userMessage: Message = { 
      role: "user", 
      content: `Analise esta copy do meu anúncio e me dê sugestões de ganchos e segmentação:\n\n${copyInput}` 
    };
    setCopyMessages([userMessage]);
    
    await streamChat([userMessage], "copy_analysis", setCopyMessages);
  };

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-card to-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Assistente de IA</CardTitle>
              <p className="text-xs text-muted-foreground">{item.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Campaign metrics summary */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-xs">
            CTR: {item.ctr.toFixed(2)}%
          </Badge>
          <Badge variant="outline" className="text-xs">
            Conv: {item.conversionRate.toFixed(2)}%
          </Badge>
          <Badge variant="outline" className="text-xs">
            CPC: R${item.cpc.toFixed(2)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Gasto: R${item.spend.toFixed(0)}
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="questions" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Perguntas
            </TabsTrigger>
            <TabsTrigger value="copy" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Análise de Copy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="questions" className="space-y-4 mt-4">
            {!hasStartedQuestions ? (
              <div className="text-center py-8">
                <Target className="h-12 w-12 text-primary/50 mx-auto mb-4" />
                <h3 className="font-medium mb-2">Consultoria Personalizada</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  A IA fará perguntas sobre sua campanha para dar sugestões de segmentação e otimização personalizadas.
                </p>
                <Button onClick={startQuestions} disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <MessageSquare className="h-4 w-4 mr-2" />
                  )}
                  Iniciar Conversa
                </Button>
              </div>
            ) : (
              <>
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-4">
                    {messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        {msg.role === "assistant" && (
                          <div className="p-1.5 rounded-full bg-primary/10 h-fit">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={`max-w-[80%] rounded-lg p-3 text-sm ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        {msg.role === "user" && (
                          <div className="p-1.5 rounded-full bg-primary h-fit">
                            <User className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    ))}
                    {isLoading && messages[messages.length - 1]?.role === "user" && (
                      <div className="flex gap-3 justify-start">
                        <div className="p-1.5 rounded-full bg-primary/10 h-fit">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div className="bg-muted rounded-lg p-3">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <div className="flex gap-2">
                  <Textarea
                    placeholder="Responda às perguntas ou faça novas perguntas..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    className="min-h-[60px] resize-none"
                  />
                  <Button 
                    onClick={sendMessage} 
                    disabled={isLoading || !input.trim()}
                    className="px-3"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="copy" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Cole a copy do seu anúncio abaixo:
                </label>
                <Textarea
                  placeholder="Exemplo: 🔥 Descubra o método que já ajudou +5.000 empreendedores a faturar R$10k/mês com tráfego pago..."
                  value={copyInput}
                  onChange={(e) => setCopyInput(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
              <Button 
                onClick={analyzeCopy} 
                disabled={isLoading || !copyInput.trim()}
                className="w-full"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Analisar Copy e Gerar Sugestões
              </Button>
            </div>

            {copyMessages.length > 0 && (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-4">
                  {copyMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="p-1.5 rounded-full bg-primary/10 h-fit">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div
                        className={`max-w-[90%] rounded-lg p-3 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.role === "user" && (
                        <div className="p-1.5 rounded-full bg-primary h-fit">
                          <User className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                  {isLoading && copyMessages[copyMessages.length - 1]?.role === "user" && (
                    <div className="flex gap-3 justify-start">
                      <div className="p-1.5 rounded-full bg-primary/10 h-fit">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="bg-muted rounded-lg p-3">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default CampaignAIAssistant;
