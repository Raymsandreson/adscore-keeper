import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Tag, Plus, Trash2, Loader2, Users, Send, Search, Filter, 
  MapPin, Briefcase, Heart, UserCheck, RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ManyChatTag {
  id: number;
  name: string;
}

interface ManyChatSubscriber {
  id: number;
  first_name: string;
  last_name: string;
  name: string;
  gender?: string;
  custom_fields?: Record<string, any>;
}

const TAG_CATEGORIES = [
  { prefix: "Cidade:", icon: MapPin, color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", description: "Cidade do contato" },
  { prefix: "Estado:", icon: MapPin, color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200", description: "Estado (UF) do contato" },
  { prefix: "Vínculo:", icon: Heart, color: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200", description: "Vínculo com a vítima" },
  { prefix: "Relação:", icon: UserCheck, color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", description: "Relacionamento conosco" },
  { prefix: "Profissão:", icon: Briefcase, color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", description: "Profissão do contato" },
];

export const ManyChatTagManager = () => {
  const [tags, setTags] = useState<ManyChatTag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(TAG_CATEGORIES[0].prefix);
  const [isCreating, setIsCreating] = useState(false);

  // Filter state
  const [filterTags, setFilterTags] = useState<number[]>([]);
  const [filteredSubscribers, setFilteredSubscribers] = useState<ManyChatSubscriber[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);

  // Bulk send state
  const [bulkMessage, setBulkMessage] = useState("");
  const [isSendingBulk, setIsSendingBulk] = useState(false);

  // Subscriber tag assignment
  const [assignSubscriberId, setAssignSubscriberId] = useState("");
  const [assignTagId, setAssignTagId] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [searchName, setSearchName] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const loadTags = async () => {
    setIsLoadingTags(true);
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: { action: "list_subscribers" },
      });
      if (error) throw error;
      setTags(data?.tags || []);
    } catch (err: any) {
      toast.error("Erro ao carregar tags: " + err.message);
    } finally {
      setIsLoadingTags(false);
    }
  };

  useEffect(() => { loadTags(); }, []);

  const createTag = async () => {
    if (!newTagName.trim()) return;
    setIsCreating(true);
    const fullName = `${selectedCategory} ${newTagName.trim()}`;
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: { action: "create_tag", name: fullName },
      });
      if (error) throw error;
      if (data?.status === "success") {
        toast.success(`Tag "${fullName}" criada!`);
        setNewTagName("");
        loadTags();
      } else {
        toast.error("Erro ao criar tag: " + JSON.stringify(data));
      }
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteTag = async (tagId: number, tagName: string) => {
    if (!confirm(`Remover a tag "${tagName}"?`)) return;
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: { action: "remove_page_tag", tag_id: tagId },
      });
      if (error) throw error;
      toast.success("Tag removida!");
      loadTags();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const findSubscriber = async () => {
    if (!searchName) return;
    setIsSearching(true);
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: { action: "find_subscriber", name: searchName },
      });
      if (error) throw error;
      setSearchResults(data?.data || []);
      if (!data?.data?.length) toast.info("Nenhum assinante encontrado");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const assignTag = async () => {
    if (!assignSubscriberId || !assignTagId) {
      toast.error("Selecione um assinante e uma tag");
      return;
    }
    setIsAssigning(true);
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: { action: "add_tag", subscriber_id: assignSubscriberId, tag_id: parseInt(assignTagId) },
      });
      if (error) throw error;
      if (data?.status === "success") {
        toast.success("Tag atribuída ao assinante!");
      } else {
        toast.error("Erro: " + JSON.stringify(data));
      }
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsAssigning(false);
    }
  };

  const removeTagFromSubscriber = async () => {
    if (!assignSubscriberId || !assignTagId) return;
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: { action: "remove_tag", subscriber_id: assignSubscriberId, tag_id: parseInt(assignTagId) },
      });
      if (error) throw error;
      toast.success("Tag removida do assinante!");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const filterByTags = async () => {
    if (filterTags.length === 0) {
      toast.error("Selecione pelo menos uma tag para filtrar");
      return;
    }
    setIsFiltering(true);
    try {
      // Get subscribers for each selected tag
      const allSubs: ManyChatSubscriber[] = [];
      for (const tagId of filterTags) {
        const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
          body: { action: "get_subscribers_by_tag", tag_id: tagId },
        });
        if (!error && data?.data) {
          for (const sub of data.data) {
            if (!allSubs.find(s => s.id === sub.id)) {
              allSubs.push(sub);
            }
          }
        }
      }
      setFilteredSubscribers(allSubs);
      if (allSubs.length === 0) toast.info("Nenhum assinante encontrado com essas tags");
      else toast.success(`${allSubs.length} assinante(s) encontrado(s)`);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsFiltering(false);
    }
  };

  const sendBulkMessage = async () => {
    if (!bulkMessage.trim() || filteredSubscribers.length === 0) {
      toast.error("Escreva uma mensagem e filtre os assinantes primeiro");
      return;
    }
    if (!confirm(`Enviar mensagem para ${filteredSubscribers.length} assinantes?`)) return;
    setIsSendingBulk(true);
    try {
      const { data, error } = await cloudFunctions.invoke("manychat-send-message", {
        body: {
          action: "bulk_send",
          subscriber_ids: filteredSubscribers.map(s => String(s.id)),
          message_text: bulkMessage,
        },
      });
      if (error) throw error;
      const successCount = data?.results?.filter((r: any) => r.success).length || 0;
      toast.success(`Mensagem enviada para ${successCount}/${filteredSubscribers.length} assinantes`);
      setBulkMessage("");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setIsSendingBulk(false);
    }
  };

  const toggleFilterTag = (tagId: number) => {
    setFilterTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  };

  const getCategoryForTag = (tagName: string) => {
    return TAG_CATEGORIES.find(c => tagName.startsWith(c.prefix));
  };

  const categorizedTags = TAG_CATEGORIES.map(cat => ({
    ...cat,
    tags: tags.filter(t => t.name.startsWith(cat.prefix)),
  }));

  const uncategorizedTags = tags.filter(t => !TAG_CATEGORIES.some(c => t.name.startsWith(c.prefix)));

  return (
    <div className="space-y-6">
      <Tabs defaultValue="manage" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="manage" className="gap-1 text-xs">
            <Tag className="h-4 w-4" /> Gerenciar Tags
          </TabsTrigger>
          <TabsTrigger value="assign" className="gap-1 text-xs">
            <UserCheck className="h-4 w-4" /> Atribuir Tags
          </TabsTrigger>
          <TabsTrigger value="filter" className="gap-1 text-xs">
            <Filter className="h-4 w-4" /> Filtrar & Enviar
          </TabsTrigger>
        </TabsList>

        {/* Manage Tags */}
        <TabsContent value="manage">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Tag className="h-5 w-5 text-primary" />
                Tags do ManyChat
              </CardTitle>
              <CardDescription>
                Crie tags categorizadas para organizar seus contatos por cidade, estado, profissão, etc.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Create new tag */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Categoria</Label>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAG_CATEGORIES.map(cat => (
                        <SelectItem key={cat.prefix} value={cat.prefix}>
                          {cat.prefix} {cat.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Valor</Label>
                  <Input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Ex: São Paulo"
                    onKeyDown={(e) => e.key === "Enter" && createTag()}
                  />
                </div>
                <Button onClick={createTag} disabled={isCreating} size="sm">
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{tags.length} tags no ManyChat</span>
                <Button onClick={loadTags} disabled={isLoadingTags} variant="ghost" size="sm">
                  <RefreshCw className={`h-4 w-4 ${isLoadingTags ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {/* Tags by category */}
              {categorizedTags.map(cat => (
                <div key={cat.prefix} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <cat.icon className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-xs font-semibold uppercase tracking-wider">{cat.description}</Label>
                    <Badge variant="secondary" className="text-xs">{cat.tags.length}</Badge>
                  </div>
                  {cat.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {cat.tags.map(tag => (
                        <Badge key={tag.id} className={`${cat.color} gap-1 cursor-default`}>
                          {tag.name.replace(cat.prefix + " ", "")}
                          <button onClick={() => deleteTag(tag.id, tag.name)} className="ml-1 hover:text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Nenhuma tag nesta categoria</p>
                  )}
                </div>
              ))}

              {uncategorizedTags.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider">Outras Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {uncategorizedTags.map(tag => (
                      <Badge key={tag.id} variant="outline" className="gap-1">
                        {tag.name}
                        <button onClick={() => deleteTag(tag.id, tag.name)} className="ml-1 hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Assign Tags */}
        <TabsContent value="assign">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <UserCheck className="h-5 w-5 text-primary" />
                Atribuir Tags a Assinantes
              </CardTitle>
              <CardDescription>
                Busque um assinante e adicione ou remova tags
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search subscriber */}
              <div>
                <Label className="text-xs">Buscar assinante por nome</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                    placeholder="Nome..."
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && findSubscriber()}
                  />
                  <Button onClick={findSubscriber} disabled={isSearching} size="sm">
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-1 mt-2 max-h-32 overflow-y-auto">
                    {searchResults.map((sub: any) => (
                      <div key={sub.id} className="flex items-center justify-between p-2 border rounded text-sm">
                        <span>{sub.name || `${sub.first_name} ${sub.last_name || ""}`}</span>
                        <Button size="sm" variant="ghost" onClick={() => { setAssignSubscriberId(String(sub.id)); toast.success(`ID ${sub.id} selecionado`); }}>
                          Usar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs">ID do Assinante</Label>
                <Input value={assignSubscriberId} onChange={(e) => setAssignSubscriberId(e.target.value)} placeholder="ID do ManyChat" />
              </div>

              <div>
                <Label className="text-xs">Tag</Label>
                <Select value={assignTagId} onValueChange={setAssignTagId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map(tag => (
                      <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button onClick={assignTag} disabled={isAssigning} className="flex-1">
                  {isAssigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  Adicionar Tag
                </Button>
                <Button onClick={removeTagFromSubscriber} variant="outline" className="flex-1">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remover Tag
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Filter & Bulk Send */}
        <TabsContent value="filter">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Filter className="h-5 w-5 text-primary" />
                Filtrar e Enviar em Massa
              </CardTitle>
              <CardDescription>
                Selecione tags para filtrar assinantes e envie mensagens em massa
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tag filter selection */}
              <div>
                <Label className="text-xs font-semibold">Filtrar por tags (clique para selecionar)</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {tags.map(tag => {
                    const cat = getCategoryForTag(tag.name);
                    const isSelected = filterTags.includes(tag.id);
                    return (
                      <Badge
                        key={tag.id}
                        className={`cursor-pointer transition-all ${
                          isSelected
                            ? "bg-primary text-primary-foreground ring-2 ring-primary"
                            : cat ? cat.color : "bg-muted text-muted-foreground"
                        }`}
                        onClick={() => toggleFilterTag(tag.id)}
                      >
                        {tag.name}
                      </Badge>
                    );
                  })}
                </div>
                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-2">Nenhuma tag encontrada. Crie tags na aba "Gerenciar Tags".</p>
                )}
              </div>

              <Button onClick={filterByTags} disabled={isFiltering || filterTags.length === 0} className="w-full">
                {isFiltering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Filter className="h-4 w-4 mr-2" />}
                Filtrar Assinantes ({filterTags.length} tag(s) selecionada(s))
              </Button>

              {/* Results */}
              {filteredSubscribers.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{filteredSubscribers.length} assinantes encontrados</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {filteredSubscribers.map(sub => (
                      <div key={sub.id} className="flex items-center justify-between p-2 border rounded text-xs">
                        <span>{sub.name || `${sub.first_name} ${sub.last_name || ""}`}</span>
                        <span className="text-muted-foreground">#{sub.id}</span>
                      </div>
                    ))}
                  </div>

                  {/* Bulk message */}
                  <div className="border-t pt-3 space-y-2">
                    <Label>Mensagem para enviar</Label>
                    <Textarea
                      value={bulkMessage}
                      onChange={(e) => setBulkMessage(e.target.value)}
                      placeholder="Digite a mensagem que será enviada para todos os assinantes filtrados..."
                      rows={3}
                    />
                    <Button onClick={sendBulkMessage} disabled={isSendingBulk || !bulkMessage.trim()} className="w-full">
                      {isSendingBulk ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                      Enviar para {filteredSubscribers.length} assinantes
                    </Button>
                  </div>

                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      <strong>⚠️ Atenção:</strong> O envio usa a tag <code>HUMAN_AGENT</code> que só funciona dentro da janela de 24h após a última interação do assinante. Para mensagens fora dessa janela, use Broadcasts no ManyChat.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
