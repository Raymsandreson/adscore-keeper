import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  MessageSquare, 
  FileText, 
  Send, 
  Loader2, 
  Bot, 
  User,
  Sparkles,
  Target,
  X,
  History,
  Trash2,
  Users,
  MapPin,
  Heart,
  Zap,
  ChevronDown,
  ChevronUp,
  Type,
  AlignLeft,
  MousePointerClick,
  Pencil,
  Save,
  XCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { CampaignInsight, metaAPIService, TargetingData, AdCreativeData } from "@/services/metaAPI";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCampaignManager } from "@/hooks/useCampaignManager";
import { AdFeedPreview } from "./AdFeedPreview";
import { getMetaCredentials } from "@/utils/metaCredentials";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CampaignAIAssistantProps {
  item: CampaignInsight;
  onClose: () => void;
}

const CampaignAIAssistant = ({ item, onClose }: CampaignAIAssistantProps) => {
  const [activeTab, setActiveTab] = useState<"questions" | "copy" | "history">("questions");
  const [messages, setMessages] = useState<Message[]>([]);
  const [copyMessages, setCopyMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [copyInput, setCopyInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasStartedQuestions, setHasStartedQuestions] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [enrichedData, setEnrichedData] = useState<{
    targeting?: TargetingData;
    creative?: AdCreativeData;
    objective?: string;
  }>({});
  const [showTargeting, setShowTargeting] = useState(false);
  const [showCreative, setShowCreative] = useState(false);
  const [isEditingCopy, setIsEditingCopy] = useState(false);
  const [editedCreative, setEditedCreative] = useState<{
    title: string;
    body: string;
    linkDescription: string;
    callToActionType: string;
  }>({ title: '', body: '', linkDescription: '', callToActionType: '' });
  const [isSavingCreative, setIsSavingCreative] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  
  const { updateCreative } = useCampaignManager();

  // Load conversation history and enriched data on mount
  useEffect(() => {
    loadConversationHistory();
    loadEnrichedData();
  }, [item.id]);

  const loadEnrichedData = async () => {
    const { accessToken } = await getMetaCredentials();
    if (!accessToken) {
      console.log('No access token found, using item data');
      return;
    }

    try {
      const data = await metaAPIService.getEnrichedEntityData(
        accessToken,
        item.id,
        item.type
      );
      setEnrichedData(data);
      // Initialize edit fields with current creative data
      if (data.creative) {
        setEditedCreative({
          title: data.creative.title || '',
          body: data.creative.body || data.creative.object_story_spec?.link_data?.message || '',
          linkDescription: data.creative.link_description || '',
          callToActionType: data.creative.call_to_action_type || '',
        });
      }
      console.log('✅ Enriched data loaded:', data);
    } catch (error) {
      console.error('Error loading enriched data:', error);
    }
  };

  const startEditingCopy = () => {
    if (enrichedData.creative) {
      setEditedCreative({
        title: enrichedData.creative.title || '',
        body: enrichedData.creative.body || enrichedData.creative.object_story_spec?.link_data?.message || '',
        linkDescription: enrichedData.creative.link_description || '',
        callToActionType: enrichedData.creative.call_to_action_type || '',
      });
    }
    setIsEditingCopy(true);
  };

  const cancelEditingCopy = () => {
    setIsEditingCopy(false);
    if (enrichedData.creative) {
      setEditedCreative({
        title: enrichedData.creative.title || '',
        body: enrichedData.creative.body || enrichedData.creative.object_story_spec?.link_data?.message || '',
        linkDescription: enrichedData.creative.link_description || '',
        callToActionType: enrichedData.creative.call_to_action_type || '',
      });
    }
  };

  const saveCreativeChanges = async () => {
    if (item.type !== 'creative') {
      toast.error('Só é possível editar copy de anúncios');
      return;
    }

    setIsSavingCreative(true);
    try {
      const result = await updateCreative(
        item.id,
        {
          title: editedCreative.title || undefined,
          body: editedCreative.body || undefined,
          linkDescription: editedCreative.linkDescription || undefined,
          callToActionType: editedCreative.callToActionType || undefined,
        },
        item.name
      );

      if (result.success) {
        // Update local enriched data
        setEnrichedData(prev => ({
          ...prev,
          creative: prev.creative ? {
            ...prev.creative,
            title: editedCreative.title || prev.creative.title,
            body: editedCreative.body || prev.creative.body,
            link_description: editedCreative.linkDescription || prev.creative.link_description,
            call_to_action_type: editedCreative.callToActionType || prev.creative.call_to_action_type,
          } : undefined
        }));
        setIsEditingCopy(false);
      }
    } catch (error) {
      console.error('Error saving creative:', error);
      toast.error('Erro ao salvar alterações');
    } finally {
      setIsSavingCreative(false);
    }
  };

  const loadConversationHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("ai_conversation_history")
        .select("*")
        .eq("entity_id", item.id)
        .eq("entity_type", "adset")
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        const loadedMessages: Message[] = data.map(row => ({
          role: row.role as "user" | "assistant",
          content: row.content
        }));
        setMessages(loadedMessages);
        setHasStartedQuestions(true);
      }
    } catch (error) {
      console.error("Error loading history:", error);
    } finally {
      setHistoryLoading(false);
    }
  };

  const saveMessage = async (message: Message) => {
    try {
      const { error } = await supabase
        .from("ai_conversation_history")
        .insert({
          entity_id: item.id,
          entity_name: item.name,
          entity_type: "adset",
          role: message.role,
          content: message.content
        });

      if (error) throw error;
    } catch (error) {
      console.error("Error saving message:", error);
    }
  };

  const clearHistory = async () => {
    try {
      const { error } = await supabase
        .from("ai_conversation_history")
        .delete()
        .eq("entity_id", item.id)
        .eq("entity_type", "adset");

      if (error) throw error;

      setMessages([]);
      setHasStartedQuestions(false);
      toast.success("Histórico limpo com sucesso");
    } catch (error) {
      console.error("Error clearing history:", error);
      toast.error("Erro ao limpar histórico");
    }
  };

  const streamChat = async (
    userMessages: Message[],
    type: "questions" | "copy_analysis" | "general",
    setMessagesFunc: React.Dispatch<React.SetStateAction<Message[]>>,
    shouldSave: boolean = true
  ) => {
    setIsLoading(true);

    try {
      const campaignDataWithEnrichment = {
        ...item,
        ...enrichedData
      };

      const response = await fetch(
        `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/campaign-ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: userMessages,
            campaignData: campaignDataWithEnrichment,
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

      // Save assistant message after streaming is complete
      if (shouldSave && assistantContent) {
        await saveMessage({ role: "assistant", content: assistantContent });
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
    await saveMessage(initialMessage);
    await streamChat([initialMessage], "questions", setMessages);
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage: Message = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    
    await saveMessage(userMessage);
    await streamChat(newMessages, "questions", setMessages);
  };

  const analyzeCopy = async () => {
    if (!copyInput.trim() || isLoading) return;
    
    const userMessage: Message = { 
      role: "user", 
      content: `Analise esta copy do meu anúncio e me dê sugestões de ganchos e segmentação:\n\n${copyInput}` 
    };
    setCopyMessages([userMessage]);
    
    // Copy analysis is not saved to history
    await streamChat([userMessage], "copy_analysis", setCopyMessages, false);
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
          <div className="flex items-center gap-1">
            {hasStartedQuestions && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearHistory}
                title="Limpar histórico"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
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

        {/* Targeting Panel */}
        {(enrichedData.targeting || item.type === 'adset') && (
          <Collapsible open={showTargeting} onOpenChange={setShowTargeting}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between p-2 h-auto bg-muted/50 hover:bg-muted">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Segmentação Atual</span>
                </div>
                {showTargeting ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              {enrichedData.targeting ? (
                <>
                  {/* Demographics */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>Demográfico</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {enrichedData.targeting.age_min && enrichedData.targeting.age_max && (
                        <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
                          {enrichedData.targeting.age_min}-{enrichedData.targeting.age_max} anos
                        </Badge>
                      )}
                      {enrichedData.targeting.genders?.map((g) => (
                        <Badge key={g} variant="secondary" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/20">
                          {g === 0 ? 'Todos' : g === 1 ? 'Masculino' : 'Feminino'}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Location */}
                  {(enrichedData.targeting.geo_locations?.countries || enrichedData.targeting.geo_locations?.cities) && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span>Localização</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {enrichedData.targeting.geo_locations.countries?.map((country) => (
                          <Badge key={country} variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                            {country}
                          </Badge>
                        ))}
                        {enrichedData.targeting.geo_locations.cities?.slice(0, 5).map((city) => (
                          <Badge key={city.key} variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                            {city.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Interests */}
                  {enrichedData.targeting.interests && enrichedData.targeting.interests.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Heart className="h-3 w-3" />
                        <span>Interesses ({enrichedData.targeting.interests.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {enrichedData.targeting.interests.slice(0, 8).map((interest) => (
                          <Badge key={interest.id} variant="secondary" className="text-xs bg-pink-500/10 text-pink-600 border-pink-500/20">
                            {interest.name}
                          </Badge>
                        ))}
                        {enrichedData.targeting.interests.length > 8 && (
                          <Badge variant="outline" className="text-xs">
                            +{enrichedData.targeting.interests.length - 8}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Behaviors */}
                  {enrichedData.targeting.behaviors && enrichedData.targeting.behaviors.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Zap className="h-3 w-3" />
                        <span>Comportamentos ({enrichedData.targeting.behaviors.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {enrichedData.targeting.behaviors.slice(0, 5).map((behavior) => (
                          <Badge key={behavior.id} variant="secondary" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/20">
                            {behavior.name}
                          </Badge>
                        ))}
                        {enrichedData.targeting.behaviors.length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{enrichedData.targeting.behaviors.length - 5}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Optimization Goal */}
                  {enrichedData.targeting.optimization_goal && (
                    <div className="flex items-center gap-2 pt-1">
                      <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
                        Otimização: {enrichedData.targeting.optimization_goal.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                  Carregando segmentação...
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Creative/Copy Panel */}
        {(enrichedData.creative || item.type === 'creative') && (
          <Collapsible open={showCreative} onOpenChange={setShowCreative}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between p-2 h-auto bg-muted/50 hover:bg-muted">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Copy do Anúncio</span>
                </div>
                {showCreative ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              {enrichedData.creative ? (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  {/* Action buttons */}
                  {item.type === 'creative' && (
                    <div className="flex justify-between gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowPreview(!showPreview)}
                      >
                        {showPreview ? (
                          <>
                            <EyeOff className="h-4 w-4 mr-1" />
                            Ocultar Preview
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-1" />
                            Ver Preview
                          </>
                        )}
                      </Button>
                      <div className="flex gap-2">
                        {isEditingCopy ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditingCopy}
                              disabled={isSavingCreative}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              onClick={saveCreativeChanges}
                              disabled={isSavingCreative}
                            >
                              {isSavingCreative ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4 mr-1" />
                              )}
                              Salvar
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={startEditingCopy}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            Editar Copy
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Preview Panel */}
                  {showPreview && (
                    <div className="border-t pt-4 mt-2">
                      <AdFeedPreview 
                        creative={enrichedData.creative}
                        pageName={item.name.split(' - ')[0] || "Sua Página"}
                        isEditing={isEditingCopy}
                        editedCreative={editedCreative}
                      />
                    </div>
                  )}

                  {isEditingCopy ? (
                    <>
                      {/* Editable Title */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Type className="h-3 w-3" />
                          <span>Título</span>
                        </div>
                        <Input
                          value={editedCreative.title}
                          onChange={(e) => setEditedCreative(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="Título do anúncio"
                          className="text-sm"
                        />
                      </div>

                      {/* Editable Body Text */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <AlignLeft className="h-3 w-3" />
                          <span>Texto Principal</span>
                        </div>
                        <Textarea
                          value={editedCreative.body}
                          onChange={(e) => setEditedCreative(prev => ({ ...prev, body: e.target.value }))}
                          placeholder="Texto principal do anúncio"
                          className="text-sm min-h-[100px]"
                        />
                      </div>

                      {/* Editable Link Description */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          <span>Descrição do Link</span>
                        </div>
                        <Input
                          value={editedCreative.linkDescription}
                          onChange={(e) => setEditedCreative(prev => ({ ...prev, linkDescription: e.target.value }))}
                          placeholder="Descrição do link"
                          className="text-sm"
                        />
                      </div>

                      {/* Editable CTA */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <MousePointerClick className="h-3 w-3" />
                          <span>Call to Action (CTA)</span>
                        </div>
                        <Select
                          value={editedCreative.callToActionType}
                          onValueChange={(value) => setEditedCreative(prev => ({ ...prev, callToActionType: value }))}
                        >
                          <SelectTrigger className="text-sm">
                            <SelectValue placeholder="Selecione o CTA" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover z-50">
                            <SelectItem value="LEARN_MORE">Saiba Mais</SelectItem>
                            <SelectItem value="SHOP_NOW">Comprar Agora</SelectItem>
                            <SelectItem value="SIGN_UP">Cadastre-se</SelectItem>
                            <SelectItem value="SUBSCRIBE">Assinar</SelectItem>
                            <SelectItem value="CONTACT_US">Fale Conosco</SelectItem>
                            <SelectItem value="GET_OFFER">Obter Oferta</SelectItem>
                            <SelectItem value="GET_QUOTE">Solicitar Orçamento</SelectItem>
                            <SelectItem value="DOWNLOAD">Baixar</SelectItem>
                            <SelectItem value="BOOK_TRAVEL">Reservar</SelectItem>
                            <SelectItem value="WATCH_MORE">Assistir Mais</SelectItem>
                            <SelectItem value="APPLY_NOW">Candidatar-se</SelectItem>
                            <SelectItem value="BUY_NOW">Comprar</SelectItem>
                            <SelectItem value="GET_DIRECTIONS">Ver Direções</SelectItem>
                            <SelectItem value="MESSAGE_PAGE">Enviar Mensagem</SelectItem>
                            <SelectItem value="WHATSAPP_MESSAGE">WhatsApp</SelectItem>
                            <SelectItem value="CALL_NOW">Ligar Agora</SelectItem>
                            <SelectItem value="INSTALL_APP">Instalar App</SelectItem>
                            <SelectItem value="USE_APP">Usar App</SelectItem>
                            <SelectItem value="PLAY_GAME">Jogar</SelectItem>
                            <SelectItem value="LISTEN_NOW">Ouvir Agora</SelectItem>
                            <SelectItem value="ORDER_NOW">Pedir Agora</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Title */}
                      {(enrichedData.creative.title || editedCreative.title) && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Type className="h-3 w-3" />
                            <span>Título</span>
                          </div>
                          <p className="text-sm font-medium bg-gradient-to-r from-primary/10 to-transparent px-2 py-1 rounded">
                            {enrichedData.creative.title}
                          </p>
                        </div>
                      )}

                      {/* Body Text */}
                      {(enrichedData.creative.body || enrichedData.creative.object_story_spec?.link_data?.message) && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <AlignLeft className="h-3 w-3" />
                            <span>Texto Principal</span>
                          </div>
                          <p className="text-sm bg-muted/50 px-3 py-2 rounded-lg whitespace-pre-wrap">
                            {enrichedData.creative.body || enrichedData.creative.object_story_spec?.link_data?.message}
                          </p>
                        </div>
                      )}

                      {/* Link Description */}
                      {enrichedData.creative.link_description && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <FileText className="h-3 w-3" />
                            <span>Descrição do Link</span>
                          </div>
                          <p className="text-sm text-muted-foreground italic px-2">
                            {enrichedData.creative.link_description}
                          </p>
                        </div>
                      )}

                      {/* CTA */}
                      {enrichedData.creative.call_to_action_type && (
                        <div className="flex items-center gap-2 pt-1">
                          <MousePointerClick className="h-3 w-3 text-muted-foreground" />
                          <Badge className="text-xs bg-primary text-primary-foreground">
                            {enrichedData.creative.call_to_action_type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                  Carregando copy do anúncio...
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {historyLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Carregando histórico...</span>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="questions" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Perguntas
                {messages.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {messages.length}
                  </Badge>
                )}
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
                  {messages.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                      <History className="h-3 w-3" />
                      <span>Histórico carregado ({messages.length} mensagens)</span>
                    </div>
                  )}
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
        )}
      </CardContent>
    </Card>
  );
};

export default CampaignAIAssistant;
