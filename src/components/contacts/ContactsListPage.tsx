import { useState, useEffect } from 'react';
import { useContacts, Contact } from '@/hooks/useContacts';
import { useBroadcastLists, BroadcastList, BroadcastListMember } from '@/hooks/useBroadcastLists';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Search, Users, Send, Plus, Trash2, Edit2, Radio, UserPlus,
  Phone, Loader2, ChevronRight, X, List, ImagePlus, Bot, BotOff
} from 'lucide-react';

export function ContactsListPage() {
  const { contacts, loading: contactsLoading, fetchContacts } = useContacts();
  const {
    lists, loading: listsLoading, createList, updateList, deleteList,
    fetchMembers, addMembers, removeMember, sendBroadcast,
  } = useBroadcastLists();

  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState('contacts');
  
  // Broadcast list dialogs
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [editingList, setEditingList] = useState<BroadcastList | null>(null);
  const [viewingList, setViewingList] = useState<BroadcastList | null>(null);
  const [listMembers, setListMembers] = useState<BroadcastListMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Send dialog
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [sendInstanceId, setSendInstanceId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFromList, setSendFromList] = useState<BroadcastList | null>(null);
  const [sendMediaFile, setSendMediaFile] = useState<File | null>(null);
  const [sendMediaPreview, setSendMediaPreview] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Agent assignment state
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [listAgentMap, setListAgentMap] = useState<Record<string, { agent_id: string; agent_name: string; is_active: boolean }>>({});

  useEffect(() => {
    fetchAgentsAndAssignments();
  }, []);

  const fetchAgentsAndAssignments = async () => {
    const [{ data: agentsData }, { data: assignmentsData }] = await Promise.all([
      supabase.from('whatsapp_ai_agents').select('id, name').eq('is_active', true).order('name'),
      supabase.from('broadcast_list_agents').select('broadcast_list_id, agent_id, is_active, whatsapp_ai_agents(name)') as any,
    ]);
    setAgents((agentsData || []) as any);
    const map: Record<string, any> = {};
    (assignmentsData || []).forEach((a: any) => {
      map[a.broadcast_list_id] = {
        agent_id: a.agent_id,
        agent_name: a.whatsapp_ai_agents?.name || '',
        is_active: a.is_active,
      };
    });
    setListAgentMap(map);
  };

  const handleAssignAgentToList = async (listId: string, agentId: string | null) => {
    if (!agentId) {
      await supabase.from('broadcast_list_agents').delete().eq('broadcast_list_id', listId);
      setListAgentMap(prev => { const n = { ...prev }; delete n[listId]; return n; });
      toast.success('Agente removido da lista');
      return;
    }
    const { error } = await (supabase.from('broadcast_list_agents') as any).upsert({
      broadcast_list_id: listId,
      agent_id: agentId,
      is_active: true,
    }, { onConflict: 'broadcast_list_id' });
    if (error) { toast.error('Erro: ' + error.message); return; }
    const agent = agents.find(a => a.id === agentId);
    setListAgentMap(prev => ({
      ...prev,
      [listId]: { agent_id: agentId, agent_name: agent?.name || '', is_active: true },
    }));
    toast.success(`🤖 Agente "${agent?.name}" ativado para esta lista`);
  };

  // Instances
  const [instances, setInstances] = useState<{ id: string; instance_name: string }[]>([]);

  useEffect(() => {
    fetchContacts(1, 1000);
    const loadInstances = async () => {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name')
        .eq('is_active', true);
      setInstances(data || []);
      if (data && data.length > 0) setSendInstanceId(data[0].id);
    };
    loadInstances();
  }, []);

  const filteredContacts = contacts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.full_name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.city && c.city.toLowerCase().includes(q)) ||
      (c.state && c.state.toLowerCase().includes(q)) ||
      (c.neighborhood && c.neighborhood.toLowerCase().includes(q))
    );
  });

  const withPhone = filteredContacts.filter(c => c.phone);

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedContacts.size === withPhone.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(withPhone.map(c => c.id)));
    }
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    const list = await createList(newListName.trim(), newListDesc.trim() || undefined);
    if (list && selectedContacts.size > 0) {
      await addMembers(list.id, Array.from(selectedContacts));
    }
    setShowCreateList(false);
    setNewListName('');
    setNewListDesc('');
  };

  const handleViewList = async (list: BroadcastList) => {
    setViewingList(list);
    setLoadingMembers(true);
    const members = await fetchMembers(list.id);
    setListMembers(members);
    setLoadingMembers(false);
  };

  const handleAddSelectedToList = async (listId: string) => {
    if (selectedContacts.size === 0) {
      toast.info('Selecione contatos primeiro');
      return;
    }
    await addMembers(listId, Array.from(selectedContacts));
    if (viewingList?.id === listId) {
      const members = await fetchMembers(listId);
      setListMembers(members);
    }
  };

  const handleOpenSend = (list?: BroadcastList) => {
    if (list) {
      setSendFromList(list);
    } else if (selectedContacts.size === 0) {
      toast.info('Selecione contatos ou use uma lista');
      return;
    }
    setShowSendDialog(true);
  };

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendMediaFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setSendMediaPreview(url);
    } else {
      setSendMediaPreview(null);
    }
  };

  const handleRemoveMedia = () => {
    setSendMediaFile(null);
    if (sendMediaPreview) {
      URL.revokeObjectURL(sendMediaPreview);
      setSendMediaPreview(null);
    }
  };

  const handleSend = async () => {
    if ((!sendMessage.trim() && !sendMediaFile) || !sendInstanceId) return;
    setSending(true);
    try {
      let contactIds: string[];
      if (sendFromList) {
        const members = await fetchMembers(sendFromList.id);
        contactIds = members.map(m => m.contact_id);
      } else {
        contactIds = Array.from(selectedContacts);
      }

      let mediaUrl: string | undefined;
      let mediaType: string | undefined;

      if (sendMediaFile) {
        setUploadingMedia(true);
        const ext = sendMediaFile.name.split('.').pop() || 'bin';
        const path = `broadcast/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('whatsapp-media')
          .upload(path, sendMediaFile, { contentType: sendMediaFile.type });
        setUploadingMedia(false);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(uploadData.path);
        mediaUrl = urlData.publicUrl;
        mediaType = sendMediaFile.type;
      }

      await sendBroadcast({
        listId: sendFromList?.id,
        contactIds,
        message: sendMessage.trim(),
        instanceId: sendInstanceId,
        mediaUrl,
        mediaType,
      });
      setShowSendDialog(false);
      setSendMessage('');
      setSendFromList(null);
      handleRemoveMedia();
    } catch {
      // handled in hook
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-lg font-semibold">Contatos & Transmissão</h1>
        <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
        <div className="ml-auto flex gap-2">
          {selectedContacts.size > 0 && (
            <>
              <Badge variant="default">{selectedContacts.size} selecionados</Badge>
              <Button size="sm" variant="outline" onClick={() => setShowCreateList(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nova Lista
              </Button>
              <Button size="sm" onClick={() => handleOpenSend()}>
                <Send className="h-3.5 w-3.5 mr-1" />
                Enviar
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 shrink-0">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="contacts">
              <Users className="h-4 w-4 mr-1.5" />
              Contatos ({withPhone.length})
            </TabsTrigger>
            <TabsTrigger value="lists">
              <Radio className="h-4 w-4 mr-1.5" />
              Listas ({lists.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="contacts" className="flex-1 flex flex-col overflow-hidden mt-0 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone, cidade, estado..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={toggleAll}>
              {selectedContacts.size === withPhone.length ? 'Desmarcar' : 'Selecionar'} todos
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {contactsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : withPhone.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum contato com telefone encontrado</p>
              ) : (
                withPhone.map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={() => toggleContact(contact.id)}
                  >
                    <Checkbox
                      checked={selectedContacts.has(contact.id)}
                      onCheckedChange={() => toggleContact(contact.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{contact.full_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                        {(contact.city || contact.state) && (
                          <span className="ml-2 text-muted-foreground/70">
                            📍 {[contact.city, contact.state].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </p>
                    </div>
                    {contact.classification && (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {contact.classification}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="lists" className="flex-1 flex flex-col overflow-hidden mt-0 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0">
            <Button size="sm" onClick={() => setShowCreateList(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova Lista
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-2">
              {listsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : lists.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhuma lista criada</p>
              ) : (
                lists.map(list => {
                  const listAgent = listAgentMap[list.id];
                  return (
                    <div
                      key={list.id}
                      className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                    >
                      <Radio className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleViewList(list)}>
                        <p className="font-medium text-sm">{list.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {list.member_count || 0} contatos
                          {list.description && ` • ${list.description}`}
                        </p>
                        {listAgent && (
                          <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                            <Bot className="h-3 w-3" />
                            {listAgent.agent_name}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {/* Agent selector */}
                        <Select
                          value={listAgent?.agent_id || ''}
                          onValueChange={(val) => handleAssignAgentToList(list.id, val === '__remove__' ? null : val)}
                        >
                          <SelectTrigger className="h-8 w-8 p-0 border-0 bg-transparent [&>svg.lucide-chevron-down]:hidden justify-center" title="Agente IA">
                            {listAgent ? (
                              <Bot className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <BotOff className="h-4 w-4 text-muted-foreground" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {agents.map(agent => (
                              <SelectItem key={agent.id} value={agent.id}>
                                🤖 {agent.name}
                              </SelectItem>
                            ))}
                            {listAgent && (
                              <SelectItem value="__remove__" className="text-destructive">
                                Remover agente
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => handleAddSelectedToList(list.id)}
                          title="Adicionar selecionados"
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => handleOpenSend(list)}
                          title="Enviar transmissão"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          onClick={() => deleteList(list.id)}
                          title="Excluir lista"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Create List Dialog */}
      <Dialog open={showCreateList} onOpenChange={setShowCreateList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Lista de Transmissão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome da lista</Label>
              <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Ex: Clientes VIP" />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Input value={newListDesc} onChange={e => setNewListDesc(e.target.value)} placeholder="Descrição da lista" />
            </div>
            {selectedContacts.size > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedContacts.size} contato(s) selecionado(s) serão adicionados à lista
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateList(false)}>Cancelar</Button>
            <Button onClick={handleCreateList} disabled={!newListName.trim()}>Criar Lista</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View List Members Dialog */}
      <Dialog open={!!viewingList} onOpenChange={open => !open && setViewingList(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              {viewingList?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            {loadingMembers ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : listMembers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhum contato nesta lista</p>
            ) : (
              <div className="space-y-1">
                {listMembers.map(member => (
                  <div key={member.id} className="flex items-center gap-3 p-2 rounded hover:bg-accent/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{member.contact?.full_name || 'Contato'}</p>
                      <p className="text-xs text-muted-foreground">{member.contact?.phone || 'Sem telefone'}</p>
                    </div>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={async () => {
                        await removeMember(member.id);
                        const updated = await fetchMembers(viewingList!.id);
                        setListMembers(updated);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingList(null)}>Fechar</Button>
            <Button onClick={() => { setViewingList(null); handleOpenSend(viewingList!); }}>
              <Send className="h-4 w-4 mr-1.5" />
              Enviar para lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Broadcast Dialog */}
      <Dialog open={showSendDialog} onOpenChange={open => { if (!open) { setShowSendDialog(false); setSendFromList(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Enviar Transmissão
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-sm text-muted-foreground">
              {sendFromList
                ? `Enviando para lista "${sendFromList.name}" (${sendFromList.member_count} contatos)`
                : `Enviando para ${selectedContacts.size} contato(s) selecionado(s)`
              }
            </p>

            <div>
              <Label>Instância WhatsApp</Label>
              <Select value={sendInstanceId} onValueChange={setSendInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a instância" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map(inst => (
                    <SelectItem key={inst.id} value={inst.id}>{inst.instance_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="flex items-center gap-1.5">
                <ImagePlus className="h-4 w-4" />
                Foto / Mídia (opcional)
              </Label>
              {sendMediaFile ? (
                <div className="mt-1.5 flex items-center gap-3 p-2 border rounded-md bg-muted/50">
                  {sendMediaPreview ? (
                    <img src={sendMediaPreview} alt="Preview" className="h-14 w-14 rounded object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
                      {sendMediaFile.name.split('.').pop()?.toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm truncate flex-1">{sendMediaFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleRemoveMedia}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label className="mt-1.5 flex items-center gap-2 p-2.5 border border-dashed rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Clique para adicionar imagem ou arquivo</span>
                  <input type="file" accept="image/*,video/*,application/pdf" className="hidden" onChange={handleMediaSelect} />
                </label>
              )}
            </div>

            <div>
              <Label>Mensagem</Label>
              <Textarea
                value={sendMessage}
                onChange={e => setSendMessage(e.target.value)}
                placeholder="Digite a mensagem para todos os contatos..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowSendDialog(false); setSendFromList(null); handleRemoveMedia(); }}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={(!sendMessage.trim() && !sendMediaFile) || !sendInstanceId || sending || uploadingMedia}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
              {uploadingMedia ? 'Enviando mídia...' : sending ? 'Enviando...' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
