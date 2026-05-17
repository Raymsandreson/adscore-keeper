import { useState, useEffect } from 'react';
import { useContacts, Contact } from '@/hooks/useContacts';
import { ContactDetailSheet } from './ContactDetailSheet';
import { CreateContactDialog } from './CreateContactDialog';
import { useBroadcastLists, BroadcastList, BroadcastListMember } from '@/hooks/useBroadcastLists';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
// (Removido Tabs do Radix — usando renderização condicional simples)
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Search, Users, Send, Plus, Trash2, Radio, UserPlus,
  Phone, Loader2, X, ImagePlus, Bot, BotOff, Filter, UsersRound, Wand2, Info,
  SlidersHorizontal, ArrowDownAZ, ArrowUpAZ, AlertTriangle, CheckCircle2, ClipboardCheck
} from 'lucide-react';

export function ContactsListPage() {
  const { contacts, loading: contactsLoading, fetchContacts, totalCount, stats } = useContacts();
  const {
    lists, loading: listsLoading, createList, deleteList,
    fetchMembers, addMembers, removeMember, sendBroadcast,
  } = useBroadcastLists();

  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const [activeTab, setActiveTab] = useState('contacts');
  
  // Filter states
  const [cityFilter, setCityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [createdByFilter, setCreatedByFilter] = useState('all');
  const [classificationFilter, setClassificationFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState<'all' | 'with_group' | 'without_group'>('all');
  const [leadLinkedFilter, setLeadLinkedFilter] = useState<'all' | 'linked' | 'not_linked'>('all');
  const [showFilters, setShowFilters] = useState(true);
  
  // Filter options loaded from DB
  const [filterOptions, setFilterOptions] = useState<{
    states: string[];
    cities: string[];
    creators: { id: string; name: string }[];
  }>({ states: [], cities: [], creators: [] });
  
  // Broadcast list dialogs
  const [showCreateList, setShowCreateList] = useState(false);
  const [showCreateContact, setShowCreateContact] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
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
  const [classifyingClients, setClassifyingClients] = useState(false);

  // Groups data
  const [groups, setGroups] = useState<{ group_jid: string; group_name: string; lead_name: string; lead_status: string; contact_count: number }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupSort, setGroupSort] = useState<'alpha' | 'number' | 'prefix'>('alpha');
  const [groupSortDir, setGroupSortDir] = useState<'asc' | 'desc'>('asc');
  const [groupSearchScope, setGroupSearchScope] = useState<'group' | 'lead'>('group');
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set());
  const [showGroupFilters, setShowGroupFilters] = useState(false);
  const [auditMode, setAuditMode] = useState(false);
  const [auditOnlyMismatch, setAuditOnlyMismatch] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState<Set<string>>(new Set());
  const [leadLinkFilter, setLeadLinkFilter] = useState<'all' | 'with' | 'without'>('all');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupContacts, setGroupContacts] = useState<Contact[]>([]);
  const [groupContactsLoading, setGroupContactsLoading] = useState(false);

  useEffect(() => {
    fetchAgentsAndAssignments();
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setGroupsLoading(true);
    try {
      const { data } = await externalSupabase
        .from('lead_whatsapp_groups')
        .select('group_jid, group_name, lead_id, leads!lead_whatsapp_groups_lead_id_fkey(lead_name, lead_status)')
        .order('created_at', { ascending: false });

      if (data) {
        // Deduplicate by group_jid and count contacts
        const groupMap = new Map<string, any>();
        for (const g of data) {
          if (!groupMap.has(g.group_jid)) {
            const lead = g.leads as any;
            groupMap.set(g.group_jid, {
              group_jid: g.group_jid,
              group_name: g.group_name || '',
              lead_name: lead?.lead_name || '',
              lead_status: lead?.lead_status || '',
              contact_count: 0,
            });
          }
        }

        // Enrich names: para grupos sem nome, busca em whatsapp_groups_index e whatsapp_messages
        const needNameJids = Array.from(groupMap.values())
          .filter((g) => !g.group_name)
          .map((g) => g.group_jid);

        if (needNameJids.length > 0) {
          const { data: idx } = await (externalSupabase as any)
            .from('whatsapp_groups_index')
            .select('group_jid, contact_name')
            .in('group_jid', needNameJids);
          (idx as any[] | null)?.forEach((r: any) => {
            const g = groupMap.get(r.group_jid);
            if (g && r.contact_name) g.group_name = String(r.contact_name).trim();
          });

          const stillMissing = Array.from(groupMap.values())
            .filter((g) => !g.group_name)
            .map((g) => g.group_jid);
          if (stillMissing.length > 0) {
            const { data: msgs } = await externalSupabase
              .from('whatsapp_messages')
              .select('phone, contact_name, created_at')
              .in('phone', stillMissing)
              .not('contact_name', 'is', null)
              .order('created_at', { ascending: false })
              .limit(stillMissing.length * 5);
            const nameByJid = new Map<string, string>();
            msgs?.forEach((m: any) => {
              if (m.phone && m.contact_name && !nameByJid.has(m.phone)) {
                nameByJid.set(m.phone, String(m.contact_name).trim());
              }
            });
            nameByJid.forEach((name, jid) => {
              const g = groupMap.get(jid);
              if (g) g.group_name = name;
            });
          }
        }

        // Fallback final: rótulo curto em vez do JID inteiro
        groupMap.forEach((g) => {
          if (!g.group_name) {
            g.group_name = `Grupo ${String(g.group_jid).slice(-6)}`;
          }
        });

        // Count contacts per group
        const { data: contactCounts } = await externalSupabase
          .from('contacts')
          .select('whatsapp_group_id')
          .not('whatsapp_group_id', 'is', null)
          .is('deleted_at', null);

        if (contactCounts) {
          for (const c of contactCounts) {
            const g = groupMap.get(c.whatsapp_group_id as string);
            if (g) g.contact_count++;
          }
        }
        setGroups(Array.from(groupMap.values()));
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleSelectGroup = async (groupJid: string) => {
    setSelectedGroup(groupJid);
    setGroupContactsLoading(true);
    try {
      const { data } = await externalSupabase
        .from('contacts')
        .select('*')
        .eq('whatsapp_group_id', groupJid)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      setGroupContacts((data || []) as Contact[]);
    } catch (err) {
      console.error(err);
    } finally {
      setGroupContactsLoading(false);
    }
  };

  const handleClassifyClosedAsClients = async () => {
    setClassifyingClients(true);
    try {
      // Get group JIDs from closed leads
      const { data: closedGroups } = await externalSupabase
        .from('lead_whatsapp_groups')
        .select('group_jid, leads!lead_whatsapp_groups_lead_id_fkey(lead_status)')
        .not('group_jid', 'is', null);

      if (!closedGroups) { setClassifyingClients(false); return; }

      const closedJids = closedGroups
        .filter((g: any) => g.leads?.lead_status === 'closed')
        .map(g => g.group_jid);

      if (closedJids.length === 0) {
        toast.info('Nenhum grupo de lead fechado encontrado');
        setClassifyingClients(false);
        return;
      }

      const { data: updated, error } = await externalSupabase
        .from('contacts')
        .update({ classification: 'client', updated_at: new Date().toISOString() } as any)
        .in('whatsapp_group_id', closedJids)
        .neq('classification', 'client')
        .is('deleted_at', null)
        .select('id');

      toast.success(`${updated?.length || 0} contatos atualizados para 'Cliente'`);
      fetchContacts(1, 5000, {
        ...(stateFilter !== 'all' ? { state: stateFilter } : {}),
        ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
        ...(sourceFilter !== 'all' ? { actionSource: sourceFilter } : {}),
        ...(createdByFilter !== 'all' ? { createdBy: createdByFilter } : {}),
        ...(classificationFilter !== 'all' ? { classification: classificationFilter } : {}),
        ...(groupFilter !== 'all' ? { groupFilter } : {}),
      });
    } catch (err) {
      console.error(err);
      toast.error('Erro ao classificar contatos');
    } finally {
      setClassifyingClients(false);
    }
  };

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
    fetchContacts(1, 5000, {
      ...(stateFilter !== 'all' ? { state: stateFilter } : {}),
      ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
      ...(sourceFilter !== 'all' ? { actionSource: sourceFilter } : {}),
      ...(createdByFilter !== 'all' ? { createdBy: createdByFilter } : {}),
      ...(classificationFilter !== 'all' ? { classification: classificationFilter } : {}),
      groupFilter: groupFilter !== 'all' ? groupFilter : 'without_group',
      ...(leadLinkedFilter !== 'all' ? { leadLinked: leadLinkedFilter } : {}),
    });
  }, [fetchContacts, stateFilter, cityFilter, sourceFilter, createdByFilter, classificationFilter, groupFilter, leadLinkedFilter]);

  // Load filter options and instances on mount
  useEffect(() => {
    const loadExtras = async () => {
      const [instancesRes, creatorsRes] = await Promise.all([
        externalSupabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true),
        supabase.from('profiles').select('user_id, full_name').order('full_name'),
      ]);
      setInstances(instancesRes.data || []);
      if (instancesRes.data?.length) setSendInstanceId(instancesRes.data[0].id);
      setFilterOptions(prev => ({
        ...prev,
        creators: (creatorsRes.data || []).map((p: any) => ({ id: p.user_id, name: p.full_name })),
      }));
    };
    loadExtras();
  }, []);

  // Rebuild filter options when contacts change
  useEffect(() => {
    if (contacts.length > 0) {
      const uniqueStates = [...new Set(contacts.map(c => c.state).filter(Boolean))] as string[];
      const uniqueCities = [...new Set(contacts.map(c => c.city).filter(Boolean))] as string[];
      setFilterOptions(prev => ({
        ...prev,
        states: uniqueStates.sort(),
        cities: uniqueCities.sort(),
      }));
    }
  }, [contacts]);

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

  const selectableContacts = filteredContacts.filter(c => c.phone);

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedContacts.size === selectableContacts.length && selectableContacts.length > 0) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(selectableContacts.map(c => c.id)));
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
        <Badge variant="secondary" className="text-xs">{totalCount}</Badge>
        <Button variant="outline" size="sm" onClick={handleClassifyClosedAsClients} disabled={classifyingClients} title="Classificar contatos em grupos fechados como Cliente">
          {classifyingClients ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
          Classificar Clientes
        </Button>
        <Button size="sm" onClick={() => setShowCreateContact(true)}>
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Novo Contato
        </Button>
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

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 pt-3 shrink-0">
          <div className="grid w-full max-w-lg grid-cols-3 h-10 items-center rounded-md bg-muted p-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'contacts' ? 'bg-background text-foreground shadow-sm' : ''}`}
            >
              <Users className="h-4 w-4 mr-1.5" />
              Contatos ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('groups')}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'groups' ? 'bg-background text-foreground shadow-sm' : ''}`}
            >
              <UsersRound className="h-4 w-4 mr-1.5" />
              Grupos ({groups.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('lists')}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'lists' ? 'bg-background text-foreground shadow-sm' : ''}`}
            >
              <Radio className="h-4 w-4 mr-1.5" />
              Listas ({lists.length})
            </button>
          </div>
        </div>

        {activeTab === 'contacts' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
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
            <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}>
              <Filter className="h-3.5 w-3.5 mr-1" />
              Filtros
              {(stateFilter !== 'all' || cityFilter !== 'all' || sourceFilter !== 'all' || createdByFilter !== 'all' || classificationFilter !== 'all' || groupFilter !== 'all' || leadLinkedFilter !== 'all') && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {[stateFilter, cityFilter, sourceFilter, createdByFilter, classificationFilter, groupFilter, leadLinkedFilter].filter(v => v !== 'all').length}
                </Badge>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={toggleAll}>
              {selectedContacts.size === selectableContacts.length && selectableContacts.length > 0 ? 'Desmarcar' : 'Selecionar'} todos
            </Button>
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-2 pb-3 shrink-0">
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Estados</SelectItem>
                  {filterOptions.states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={cityFilter} onValueChange={setCityFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Cidade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Cidades</SelectItem>
                  {filterOptions.cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Origens</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="system">Automático (IA)</SelectItem>
                  <SelectItem value="group_creation">Criação de Grupo</SelectItem>
                  <SelectItem value="whatsapp_group">Grupo WhatsApp</SelectItem>
                </SelectContent>
              </Select>

              <Select value={createdByFilter} onValueChange={setCreatedByFilter}>
                <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue placeholder="Criado por" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Membros</SelectItem>
                  {filterOptions.creators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={classificationFilter} onValueChange={setClassificationFilter}>
                <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue placeholder="Relacionamento Conosco" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Relacionamentos</SelectItem>
                  <SelectItem value="client">Cliente</SelectItem>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="non_client">Não-Cliente</SelectItem>
                  <SelectItem value="partner">Parceiro</SelectItem>
                  <SelectItem value="supplier">Fornecedor</SelectItem>
                  <SelectItem value="ponte">Ponte</SelectItem>
                  <SelectItem value="ex_cliente">Ex-cliente</SelectItem>
                  <SelectItem value="acolhedor">Acolhedor</SelectItem>
                  <SelectItem value="Embaixador">Embaixador</SelectItem>
                  <SelectItem value="none">Sem classificação</SelectItem>
                </SelectContent>
              </Select>

              <Select value={groupFilter} onValueChange={(v) => setGroupFilter(v as any)}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="with_group">Com Grupo</SelectItem>
                  <SelectItem value="without_group">Sem Grupo</SelectItem>
                </SelectContent>
              </Select>

              <Select value={leadLinkedFilter} onValueChange={(v) => setLeadLinkedFilter(v as any)}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Lead" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos (Lead)</SelectItem>
                  <SelectItem value="linked">Com Lead</SelectItem>
                  <SelectItem value="not_linked">Sem Lead</SelectItem>
                </SelectContent>
              </Select>

              {(stateFilter !== 'all' || cityFilter !== 'all' || sourceFilter !== 'all' || createdByFilter !== 'all' || classificationFilter !== 'all' || groupFilter !== 'all' || leadLinkedFilter !== 'all') && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  setStateFilter('all');
                  setCityFilter('all');
                  setSourceFilter('all');
                  setCreatedByFilter('all');
                  setClassificationFilter('all');
                  setGroupFilter('all');
                  setLeadLinkedFilter('all');
                }}>
                  <X className="h-3 w-3 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-1">
              {contactsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : filteredContacts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Nenhum contato encontrado</p>
              ) : (
                filteredContacts.map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={() => setDetailContact(contact)}
                  >
                    <Checkbox
                      checked={selectedContacts.has(contact.id)}
                      onCheckedChange={() => toggleContact(contact.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{contact.full_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contact.phone || 'Sem telefone'}
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
          </div>
        </div>
        )}

        {/* Groups Tab */}
        {activeTab === 'groups' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0 flex-wrap">
            <div className="relative flex-1 max-w-md min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={groupSearchScope === 'group' ? 'Buscar grupo por nome...' : 'Buscar pelo nome do lead...'}
                value={groupSearch}
                onChange={e => setGroupSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Sheet open={showGroupFilters} onOpenChange={setShowGroupFilters}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0 gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtrar e ordenar
                  {(excludedGroups.size > 0 || groupSort !== 'alpha' || groupSortDir !== 'asc' || groupSearchScope !== 'group' || auditMode || leadStatusFilter.size > 0 || leadLinkFilter !== 'all') && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] rounded-full">
                      {[
                        groupSearchScope !== 'group',
                        groupSort !== 'alpha',
                        groupSortDir !== 'asc',
                        excludedGroups.size > 0,
                        auditMode,
                        leadStatusFilter.size > 0,
                        leadLinkFilter !== 'all',
                      ].filter(Boolean).length}
                    </Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Filtrar e ordenar grupos</SheetTitle>
                  <SheetDescription>
                    Funciona como o filtro do Google Planilhas: escolha onde buscar, como ordenar e em qual direção.
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-6">
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Buscar e ordenar por</Label>
                    <RadioGroup value={groupSearchScope} onValueChange={(v) => setGroupSearchScope(v as any)} className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="group" id="scope-group" />
                        <Label htmlFor="scope-group" className="flex-1 cursor-pointer">
                          <p className="text-sm font-medium">Nome do grupo</p>
                          <p className="text-xs text-muted-foreground">Padrão. O lead aparece apenas como detalhe.</p>
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="lead" id="scope-lead" />
                        <Label htmlFor="scope-lead" className="flex-1 cursor-pointer">
                          <p className="text-sm font-medium">Nome do lead vinculado</p>
                          <p className="text-xs text-muted-foreground">Útil pra conferir se o nome do grupo bate com o do lead.</p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-2 block">Ordenar por</Label>
                    <RadioGroup value={groupSort} onValueChange={(v) => setGroupSort(v as any)} className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="alpha" id="sort-alpha" />
                        <Label htmlFor="sort-alpha" className="flex-1 cursor-pointer text-sm">Ordem alfabética</Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="number" id="sort-number" />
                        <Label htmlFor="sort-number" className="flex-1 cursor-pointer text-sm">
                          <p>Por numeração</p>
                          <p className="text-xs text-muted-foreground">Ex.: "Caso 12" antes de "Caso 100".</p>
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="prefix" id="sort-prefix" />
                        <Label htmlFor="sort-prefix" className="flex-1 cursor-pointer text-sm">
                          <p>Por prefixo</p>
                          <p className="text-xs text-muted-foreground">Agrupa pelo início do nome (letras antes do número).</p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-2 block">Direção</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={groupSortDir === 'asc' ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => setGroupSortDir('asc')}
                      >
                        <ArrowDownAZ className="h-4 w-4" />
                        Crescente (A→Z / 1→9)
                      </Button>
                      <Button
                        variant={groupSortDir === 'desc' ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => setGroupSortDir('desc')}
                      >
                        <ArrowUpAZ className="h-4 w-4" />
                        Decrescente (Z→A / 9→1)
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-2 block">Vínculo com lead</Label>
                    <RadioGroup value={leadLinkFilter} onValueChange={(v) => setLeadLinkFilter(v as any)} className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="all" id="link-all" />
                        <Label htmlFor="link-all" className="flex-1 cursor-pointer text-sm">Todos os grupos</Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="with" id="link-with" />
                        <Label htmlFor="link-with" className="flex-1 cursor-pointer text-sm">Somente com lead vinculado</Label>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50">
                        <RadioGroupItem value="without" id="link-without" />
                        <Label htmlFor="link-without" className="flex-1 cursor-pointer text-sm">Somente sem lead vinculado</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {(() => {
                    const statuses = Array.from(new Set(groups.map(g => g.lead_status).filter(Boolean))).sort();
                    if (statuses.length === 0) return null;
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Status do lead</Label>
                          {leadStatusFilter.size > 0 && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLeadStatusFilter(new Set())}>
                              Limpar
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {leadStatusFilter.size === 0 ? 'Mostrando todos os status.' : `Mostrando: ${Array.from(leadStatusFilter).join(', ')}`}
                        </p>
                        <div className="space-y-1">
                          {statuses.map(st => (
                            <div key={st} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50">
                              <Checkbox
                                id={`status-${st}`}
                                checked={leadStatusFilter.has(st)}
                                onCheckedChange={(v) => {
                                  setLeadStatusFilter(prev => {
                                    const next = new Set(prev);
                                    if (v) next.add(st); else next.delete(st);
                                    return next;
                                  });
                                }}
                              />
                              <Label htmlFor={`status-${st}`} className="flex-1 cursor-pointer text-sm capitalize">{st}</Label>
                              <Badge variant="outline" className="text-[10px]">
                                {groups.filter(g => g.lead_status === st).length}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {excludedGroups.size > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">Grupos ocultos manualmente</Label>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExcludedGroups(new Set())}>
                          Restaurar todos
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {excludedGroups.size} grupo(s) ocultos. Desmarque na lista para esconder mais.
                      </p>
                    </div>
                  )}

                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <ClipboardCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                      <div className="flex-1">
                        <Label htmlFor="audit-mode" className="text-sm font-medium cursor-pointer">
                          Modo auditoria (caso fechado)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Mostra só leads fechados, ordenados pelo nº do caso, lado a lado com o nome do grupo. Aponta quando não bate.
                        </p>
                      </div>
                      <Checkbox
                        id="audit-mode"
                        checked={auditMode}
                        onCheckedChange={(v) => setAuditMode(!!v)}
                      />
                    </div>
                    {auditMode && (
                      <div className="flex items-center gap-2 pl-6">
                        <Checkbox
                          id="audit-only-mismatch"
                          checked={auditOnlyMismatch}
                          onCheckedChange={(v) => setAuditOnlyMismatch(!!v)}
                        />
                        <Label htmlFor="audit-only-mismatch" className="text-xs cursor-pointer">
                          Mostrar só os divergentes
                        </Label>
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setGroupSearchScope('group');
                      setGroupSort('alpha');
                      setGroupSortDir('asc');
                      setExcludedGroups(new Set());
                      setAuditMode(false);
                      setAuditOnlyMismatch(false);
                      setLeadStatusFilter(new Set());
                      setLeadLinkFilter('all');
                    }}
                  >
                    Restaurar padrões
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            {selectedGroup && (
              <Button variant="outline" size="sm" onClick={() => { setSelectedGroup(null); setGroupContacts([]); }}>
                <X className="h-3.5 w-3.5 mr-1" />
                Voltar à lista
              </Button>
            )}
          </div>

          {/* Chips de critério ativo */}
          {!selectedGroup && (
            <div className="flex items-center gap-2 flex-wrap pb-2 shrink-0">
              <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                Busca: {groupSearchScope === 'group' ? 'Grupo' : 'Lead'}
                {groupSearchScope !== 'group' && (
                  <button
                    onClick={() => setGroupSearchScope('group')}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Voltar para busca por grupo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
              <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                Ordem: {groupSort === 'alpha' ? 'Alfabética' : groupSort === 'number' ? 'Numérica' : 'Prefixo'} ·
                {groupSortDir === 'asc' ? ' ↑' : ' ↓'}
                {(groupSort !== 'alpha' || groupSortDir !== 'asc') && (
                  <button
                    onClick={() => { setGroupSort('alpha'); setGroupSortDir('asc'); }}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Restaurar ordem padrão"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
              {groupSearch && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  Termo: "{groupSearch}"
                  <button
                    onClick={() => setGroupSearch('')}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Limpar termo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {excludedGroups.size > 0 && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  {excludedGroups.size} oculto(s)
                  <button
                    onClick={() => setExcludedGroups(new Set())}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Restaurar grupos ocultos"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {auditMode && (
                <Badge variant="default" className="gap-1 pl-2 pr-1">
                  <ClipboardCheck className="h-3 w-3" />
                  Auditoria{auditOnlyMismatch ? ' · só divergentes' : ''}
                  <button
                    onClick={() => { setAuditMode(false); setAuditOnlyMismatch(false); }}
                    className="ml-1 rounded-full hover:bg-primary-foreground/20 p-0.5"
                    aria-label="Sair do modo auditoria"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {leadLinkFilter !== 'all' && (
                <Badge variant="secondary" className="gap-1 pl-2 pr-1">
                  {leadLinkFilter === 'with' ? 'Com lead' : 'Sem lead'}
                  <button
                    onClick={() => setLeadLinkFilter('all')}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label="Limpar filtro de vínculo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {Array.from(leadStatusFilter).map(st => (
                <Badge key={st} variant="secondary" className="gap-1 pl-2 pr-1 capitalize">
                  Status: {st}
                  <button
                    onClick={() => setLeadStatusFilter(prev => {
                      const next = new Set(prev);
                      next.delete(st);
                      return next;
                    })}
                    className="ml-1 rounded-full hover:bg-muted p-0.5"
                    aria-label={`Remover filtro ${st}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {selectedGroup ? (
              <div className="space-y-1">
                <div className="p-3 mb-2 rounded-lg bg-muted/50 border">
                  <p className="text-sm font-medium">{groups.find(g => g.group_jid === selectedGroup)?.group_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Lead: {groups.find(g => g.group_jid === selectedGroup)?.lead_name} •
                    Status: <Badge variant="outline" className="text-[10px] ml-1">{groups.find(g => g.group_jid === selectedGroup)?.lead_status || 'N/A'}</Badge>
                  </p>
                </div>
                {groupContactsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : groupContacts.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhum contato neste grupo</p>
                ) : (
                  groupContacts.map(contact => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => setDetailContact(contact)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{contact.full_name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.phone || 'Sem telefone'}
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
            ) : (() => {
              const extractCaseNum = (s: string | null | undefined): number | null => {
                if (!s) return null;
                const m = String(s).match(/caso\s*0*(\d+)/i) || String(s).match(/\b0*(\d{1,6})\b/);
                if (!m) return null;
                const n = parseInt(m[1], 10);
                return isNaN(n) ? null : n;
              };
              const normalizeName = (s: string | null | undefined) =>
                (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

              const matchesSearch = (g: typeof groups[number]) => {
                if (!groupSearch) return true;
                const q = groupSearch.toLowerCase();
                if (groupSearchScope === 'lead') return (g.lead_name || '').toLowerCase().includes(q);
                return g.group_name.toLowerCase().includes(q);
              };

              let visible = [...groups].filter(g => {
                if (excludedGroups.has(g.group_jid)) return false;
                if (!matchesSearch(g)) return false;
                if (leadLinkFilter === 'with' && !g.lead_name) return false;
                if (leadLinkFilter === 'without' && g.lead_name) return false;
                if (leadStatusFilter.size > 0 && !leadStatusFilter.has(g.lead_status)) return false;
                return true;
              });

              if (auditMode) {
                visible = visible.filter(g => g.lead_status === 'closed');
                if (auditOnlyMismatch) {
                  visible = visible.filter(g => {
                    const ng = normalizeName(g.group_name);
                    const nl = normalizeName(g.lead_name);
                    if (!ng || !nl) return true;
                    return !ng.includes(nl) && !nl.includes(ng);
                  });
                }
                visible.sort((a, b) => {
                  const ca = extractCaseNum(a.group_name) ?? extractCaseNum(a.lead_name);
                  const cb = extractCaseNum(b.group_name) ?? extractCaseNum(b.lead_name);
                  if (ca == null && cb == null) {
                    return (a.group_name || '').localeCompare(b.group_name || '', 'pt-BR');
                  }
                  if (ca == null) return 1;
                  if (cb == null) return -1;
                  const cmp = ca - cb;
                  return groupSortDir === 'desc' ? -cmp : cmp;
                });
              } else {
                visible.sort((a, b) => {
                  const sortField = groupSearchScope === 'lead' ? 'lead_name' : 'group_name';
                  const na = ((a as any)[sortField] || '').trim();
                  const nb = ((b as any)[sortField] || '').trim();
                  let cmp = 0;
                  if (groupSort === 'number') {
                    const numA = parseInt(na.match(/\d+/)?.[0] || '', 10);
                    const numB = parseInt(nb.match(/\d+/)?.[0] || '', 10);
                    const aHas = !isNaN(numA);
                    const bHas = !isNaN(numB);
                    if (aHas && bHas && numA !== numB) cmp = numA - numB;
                    else if (aHas && !bHas) cmp = -1;
                    else if (!aHas && bHas) cmp = 1;
                    else cmp = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
                  } else if (groupSort === 'prefix') {
                    const pa = (na.match(/^[^\s\d]+/)?.[0] || na).toLowerCase();
                    const pb = (nb.match(/^[^\s\d]+/)?.[0] || nb).toLowerCase();
                    cmp = pa.localeCompare(pb, 'pt-BR', { sensitivity: 'base' });
                    if (cmp === 0) cmp = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
                  } else {
                    cmp = na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
                  }
                  return groupSortDir === 'desc' ? -cmp : cmp;
                });
              }

              const highlight = (text: string | null | undefined, shouldHighlight: boolean) => {
                const value = text || '';
                if (!groupSearch || !shouldHighlight) return value;
                const escaped = groupSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const parts = value.split(new RegExp(`(${escaped})`, 'ig'));
                return parts.map((p, i) =>
                  p.toLowerCase() === groupSearch.toLowerCase()
                    ? <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">{p}</mark>
                    : <span key={i}>{p}</span>
                );
              };

              if (groupsLoading) {
                return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
              }
              if (visible.length === 0) {
                return <p className="text-center text-muted-foreground py-8">
                  {auditMode ? 'Nenhum caso fechado encontrado' : 'Nenhum grupo encontrado'}
                </p>;
              }

              if (auditMode) {
                const total = visible.length;
                const mismatched = visible.filter(g => {
                  const ng = normalizeName(g.group_name);
                  const nl = normalizeName(g.lead_name);
                  if (!ng || !nl) return true;
                  return !ng.includes(nl) && !nl.includes(ng);
                }).length;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
                      <span>{total} caso(s) fechado(s)</span>
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        {mismatched} divergente(s)
                      </span>
                    </div>
                    <div className="grid grid-cols-[40px_60px_1fr_1fr_24px] gap-2 px-3 py-2 text-[11px] font-medium text-muted-foreground border-b">
                      <span></span>
                      <span>Nº caso</span>
                      <span>Nome do grupo</span>
                      <span>Nome do lead</span>
                      <span></span>
                    </div>
                    {visible.map(group => {
                      const caseNum = extractCaseNum(group.group_name) ?? extractCaseNum(group.lead_name);
                      const ng = normalizeName(group.group_name);
                      const nl = normalizeName(group.lead_name);
                      const hasBoth = !!ng && !!nl;
                      const matches = hasBoth && (ng.includes(nl) || nl.includes(ng));
                      return (
                        <div
                          key={group.group_jid}
                          className={`grid grid-cols-[40px_60px_1fr_1fr_24px] gap-2 items-center p-3 rounded-lg border transition-colors hover:bg-accent/50 ${!matches ? 'border-amber-500/40 bg-amber-500/5' : ''}`}
                        >
                          <Checkbox
                            checked={!excludedGroups.has(group.group_jid)}
                            onCheckedChange={(checked) => {
                              setExcludedGroups(prev => {
                                const next = new Set(prev);
                                if (checked) next.delete(group.group_jid);
                                else next.add(group.group_jid);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Incluir grupo no filtro"
                          />
                          <span className="text-sm font-mono font-semibold tabular-nums">
                            {caseNum != null ? caseNum : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span
                            className="text-sm truncate cursor-pointer"
                            title={group.group_name || ''}
                            onClick={() => handleSelectGroup(group.group_jid)}
                          >
                            {highlight(group.group_name, groupSearchScope === 'group')}
                          </span>
                          <span className="text-sm truncate" title={group.lead_name || ''}>
                            {highlight(group.lead_name, groupSearchScope === 'lead')}
                          </span>
                          {matches ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Bate" />
                          ) : (
                            <AlertTriangle
                              className="h-4 w-4 text-amber-500"
                              aria-label={hasBoth ? 'Nomes diferentes' : 'Faltando nome'}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return (
                <div className="space-y-1">
                  {visible.map(group => (
                    <div
                      key={group.group_jid}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors border"
                    >
                      <Checkbox
                        checked={!excludedGroups.has(group.group_jid)}
                        onCheckedChange={(checked) => {
                          setExcludedGroups(prev => {
                            const next = new Set(prev);
                            if (checked) next.delete(group.group_jid);
                            else next.add(group.group_jid);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Incluir grupo no filtro"
                      />
                      <UsersRound className="h-5 w-5 text-primary shrink-0" />
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => handleSelectGroup(group.group_jid)}
                      >
                        <p className="font-medium text-sm truncate">
                          {highlight(group.group_name, groupSearchScope === 'group')}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          Lead: {highlight(group.lead_name, groupSearchScope === 'lead')} • {group.contact_count} contato(s)
                        </p>
                      </div>
                      <Badge variant={group.lead_status === 'closed' ? 'default' : 'outline'} className="text-[10px] shrink-0">
                        {group.lead_status || 'N/A'}
                      </Badge>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
        )}

        {activeTab === 'lists' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
          <div className="flex items-center gap-2 py-3 shrink-0">
            <Button size="sm" onClick={() => setShowCreateList(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova Lista
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
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
          </div>
        </div>
        )}
      </div>

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

      <ContactDetailSheet
        contact={detailContact}
        open={!!detailContact}
        onOpenChange={(open) => { if (!open) setDetailContact(null); }}
        onContactUpdated={() => {
          fetchContacts(1, 5000, {
            ...(stateFilter !== 'all' ? { state: stateFilter } : {}),
            ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
            ...(sourceFilter !== 'all' ? { actionSource: sourceFilter } : {}),
            ...(createdByFilter !== 'all' ? { createdBy: createdByFilter } : {}),
            ...(classificationFilter !== 'all' ? { classification: classificationFilter } : {}),
            groupFilter: groupFilter !== 'all' ? groupFilter : 'without_group',
          });
        }}
      />

      <CreateContactDialog
        open={showCreateContact}
        onOpenChange={setShowCreateContact}
        onContactCreated={() => {
          setShowCreateContact(false);
          fetchContacts();
        }}
      />
    </div>
  );
}
