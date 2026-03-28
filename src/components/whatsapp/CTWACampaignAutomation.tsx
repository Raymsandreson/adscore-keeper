import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Megaphone, Target, Sparkles, FolderKanban, Plus, X, Loader2, RefreshCw, Phone, 
  Pause, Play, ChevronDown, ChevronUp, MessageSquare, Users 
} from 'lucide-react';
import { toast } from 'sonner';

interface CampaignLink {
  id: string;
  agent_id: string;
  campaign_id: string;
  campaign_name: string;
  auto_create_lead?: boolean;
  board_id?: string | null;
  stage_id?: string | null;
  instance_id?: string | null;
  is_active?: boolean;
}

interface Instance {
  id: string;
  instance_name: string;
  owner_phone?: string;
}

interface Agent {
  id: string;
  shortcut_name: string;
  description: string | null;
}

interface Board {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

interface MetaCampaign {
  campaign_id: string;
  campaign_name: string;
  status?: string;
  destination_phone?: string | null;
}

interface ConversationInfo {
  phone: string;
  contact_name: string | null;
  last_message_at: string | null;
  is_agent_active: boolean;
}

export function CTWACampaignAutomation() {
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [addingAgent, setAddingAgent] = useState('');
  const [addingCampaign, setAddingCampaign] = useState('');
  const [addingInstance, setAddingInstance] = useState('');
  const [addingBoard, setAddingBoard] = useState('');
  const [addingStage, setAddingStage] = useState('');
  const [manualCampaignId, setManualCampaignId] = useState('');
  const [manualCampaignName, setManualCampaignName] = useState('');
  const [useManualInput, setUseManualInput] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [expandedLink, setExpandedLink] = useState<string | null>(null);
  const [linkConversations, setLinkConversations] = useState<Record<string, ConversationInfo[]>>({});
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});
  const [loadingConversations, setLoadingConversations] = useState<string | null>(null);

  const getMetaCredentials = () => {
    const savedAccounts = localStorage.getItem('meta_saved_accounts');
    if (savedAccounts) {
      try {
        const accounts = JSON.parse(savedAccounts);
        const selectedIds = localStorage.getItem('meta_selected_account_ids');
        const selectedId = selectedIds ? JSON.parse(selectedIds)?.[0] : localStorage.getItem('meta_selected_account');
        const selected = accounts.find((a: any) => a.id === selectedId) || accounts[0];
        if (selected) {
          const adAccountId = selected.accountId || selected.adAccountId || selected.ad_account_id;
          return { accessToken: selected.accessToken, adAccountId };
        }
      } catch (e) { console.error('CTWA: Error parsing saved accounts:', e); }
    }
    return {
      accessToken: localStorage.getItem('meta_access_token'),
      adAccountId: localStorage.getItem('meta_ad_account_id'),
    };
  };

  const fetchMetaCampaigns = async () => {
    const { accessToken, adAccountId } = getMetaCredentials();
    console.log('CTWA: credentials check', { hasToken: !!accessToken, hasAccount: !!adAccountId });
    if (!accessToken || !adAccountId) {
      console.warn('CTWA: No Meta credentials found in localStorage. Keys present:', 
        Object.keys(localStorage).filter(k => k.includes('meta')));
      setUseManualInput(true);
      return;
    }
    setLoadingCampaigns(true);
    try {
      const formattedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      console.log('CTWA: Fetching campaigns for', formattedAdAccountId);
      const { data, error } = await supabase.functions.invoke('list-meta-ads', {
        body: { accessToken, adAccountId: formattedAdAccountId, limit: 100, status: ['ACTIVE', 'PAUSED'] },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const campaigns: MetaCampaign[] = (data?.campaigns || []).map((c: any) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        status: c.status || 'ACTIVE',
        destination_phone: c.destination_phone || null,
      }));
      console.log('CTWA: Found', campaigns.length, 'campaigns');
      setMetaCampaigns(campaigns);
      if (campaigns.length === 0) setUseManualInput(true);
      else setUseManualInput(false);
    } catch (err) {
      console.error('CTWA: Error fetching campaigns:', err);
      setUseManualInput(true);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const [linksRes, agentsRes, boardsRes, instancesRes]: any[] = await Promise.all([
      supabase.from('whatsapp_agent_campaign_links' as any).select('*'),
      supabase.from('wjia_command_shortcuts').select('id, shortcut_name, description').eq('is_active', true).order('shortcut_name'),
      supabase.from('kanban_boards' as any).select('id, name, stages'),
      supabase.from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true).order('instance_name'),
    ]);

    setLinks((linksRes.data as any[]) || []);
    setAgents((agentsRes.data as Agent[]) || []);
    setBoards((boardsRes.data as Board[]) || []);
    setInstances((instancesRes.data as Instance[]) || []);
    setLoading(false);

    // Fetch conversation counts for each link
    if (linksRes.data?.length) {
      fetchConversationCounts(linksRes.data as CampaignLink[]);
    }
  };

  const fetchConversationCounts = async (currentLinks: CampaignLink[]) => {
    const counts: Record<string, number> = {};
    for (const link of currentLinks) {
      const { count } = await supabase
        .from('whatsapp_conversation_agents' as any)
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', link.agent_id);
      counts[link.id] = count || 0;
    }
    setConversationCounts(counts);
  };

  const fetchLinkConversations = async (link: CampaignLink) => {
    setLoadingConversations(link.id);
    try {
      // Get conversations where this agent is assigned
      const { data: convAgents } = await supabase
        .from('whatsapp_conversation_agents' as any)
        .select('phone, instance_name, is_active, activated_by')
        .eq('agent_id', link.agent_id);

      if (!convAgents?.length) {
        setLinkConversations(prev => ({ ...prev, [link.id]: [] }));
        return;
      }

      // Get last message info for each conversation
      const conversations: ConversationInfo[] = [];
      for (const conv of convAgents as any[]) {
        const { data: msg } = await supabase
          .from('whatsapp_messages')
          .select('contact_name, created_at')
          .eq('phone', conv.phone)
          .eq('instance_name', conv.instance_name)
          .order('created_at', { ascending: false })
          .limit(1);

        conversations.push({
          phone: conv.phone,
          contact_name: msg?.[0]?.contact_name || conv.phone,
          last_message_at: msg?.[0]?.created_at || null,
          is_agent_active: conv.is_active,
        });
      }

      conversations.sort((a, b) => {
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });

      setLinkConversations(prev => ({ ...prev, [link.id]: conversations }));
    } catch (err) {
      console.error('Error fetching conversations:', err);
    } finally {
      setLoadingConversations(null);
    }
  };

  const normalizePhone = (phone: string) => phone.replace(/\D/g, '').slice(-8);
  
  const findInstanceByPhone = (destPhone: string): Instance | undefined => {
    if (!destPhone) return undefined;
    const normDest = normalizePhone(destPhone);
    return instances.find(inst => {
      if (!inst.owner_phone) return false;
      return normalizePhone(inst.owner_phone) === normDest;
    });
  };

  useEffect(() => {
    if (metaCampaigns.length === 0 || instances.length === 0 || links.length === 0) return;
    links.forEach(link => {
      const linkAny = link as any;
      if (linkAny.instance_id) return;
      const camp = metaCampaigns.find(c => c.campaign_id === link.campaign_id);
      if (!camp?.destination_phone) return;
      const matchedInst = findInstanceByPhone(camp.destination_phone);
      if (matchedInst) {
        handleUpdate(link.id, { instance_id: matchedInst.id } as any);
      }
    });
  }, [metaCampaigns, instances, links.length]);

  useEffect(() => {
    fetchData();
    fetchMetaCampaigns();
  }, []);

  const handleToggleExpand = (link: CampaignLink) => {
    if (expandedLink === link.id) {
      setExpandedLink(null);
    } else {
      setExpandedLink(link.id);
      if (!linkConversations[link.id]) {
        fetchLinkConversations(link);
      }
    }
  };

  const handleTogglePause = async (link: CampaignLink) => {
    const linkAny = link as any;
    const newActive = !(linkAny.is_active !== false);
    await supabase.from('whatsapp_agent_campaign_links').update({ is_active: newActive } as any).eq('id', link.id);
    toast.success(newActive ? 'Vínculo reativado!' : 'Vínculo pausado!');
    fetchData();
  };

  const handleAddLink = async () => {
    if (!addingAgent) return;

    let campaignId = '';
    let campaignName = '';

    if (useManualInput) {
      if (!manualCampaignId) return;
      campaignId = manualCampaignId;
      campaignName = manualCampaignName || manualCampaignId;
    } else {
      if (!addingCampaign) return;
      campaignId = addingCampaign;
      const camp = metaCampaigns.find(c => c.campaign_id === addingCampaign);
      campaignName = camp?.campaign_name || addingCampaign;
    }

    const camp = metaCampaigns.find(c => c.campaign_id === campaignId);
    const detectedInstance = camp?.destination_phone ? findInstanceByPhone(camp.destination_phone) : undefined;

    const payload: any = {
      agent_id: addingAgent,
      campaign_id: campaignId,
      campaign_name: campaignName,
    };
    if (detectedInstance) payload.instance_id = detectedInstance.id;
    else if (addingInstance) payload.instance_id = addingInstance;
    if (addingBoard) payload.board_id = addingBoard;
    if (addingStage) payload.stage_id = addingStage;

    const { error } = await supabase.from('whatsapp_agent_campaign_links').upsert(payload, { onConflict: 'campaign_id' });

    if (error) { toast.error('Erro ao vincular'); return; }

    // If apply to existing, assign agent to existing conversations from this campaign
    if (applyToExisting) {
      await applyAgentToExistingConversations(campaignId, addingAgent, detectedInstance?.id || addingInstance);
    }

    toast.success('Campanha vinculada!');
    setAddingAgent('');
    setAddingCampaign('');
    setAddingInstance('');
    setAddingBoard('');
    setAddingStage('');
    setManualCampaignId('');
    setManualCampaignName('');
    setApplyToExisting(false);
    fetchData();
  };

  const applyAgentToExistingConversations = async (campaignId: string, agentId: string, instanceId?: string) => {
    try {
      // Find leads that came from this campaign
      const { data: leads } = await supabase
        .from('leads')
        .select('lead_phone, id')
        .eq('campaign_id', campaignId);

      if (!leads?.length) return;

      // Get instance name for these conversations
      let instanceName = '';
      if (instanceId) {
        const inst = instances.find(i => i.id === instanceId);
        instanceName = inst?.instance_name || '';
      }

      let applied = 0;
      for (const lead of leads) {
        if (!lead.lead_phone) continue;
        const phone = lead.lead_phone.replace(/\D/g, '');
        
        // Check if already has agent assigned
        const { data: existing } = await supabase
          .from('whatsapp_conversation_agents' as any)
          .select('id')
          .eq('phone', phone)
          .limit(1);

        if (existing?.length) continue;

        // Assign agent
        await supabase.from('whatsapp_conversation_agents' as any).insert({
          phone,
          agent_id: agentId,
          instance_name: instanceName,
          is_active: true,
          activated_by: 'campaign_retroactive',
        });
        applied++;
      }

      if (applied > 0) {
        toast.success(`Agente aplicado a ${applied} conversa(s) existente(s)`);
      }
    } catch (err) {
      console.error('Error applying to existing:', err);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('whatsapp_agent_campaign_links').delete().eq('id', id);
    toast.success('Vínculo removido');
    fetchData();
  };

  const handleUpdate = async (id: string, updates: Partial<CampaignLink>) => {
    await supabase.from('whatsapp_agent_campaign_links').update(updates as any).eq('id', id);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando campanhas...</span>
      </div>
    );
  }

  const linkedCampaignIds = new Set(links.map(l => l.campaign_id));
  const unlinkedCampaigns = metaCampaigns.filter(c => !linkedCampaignIds.has(c.campaign_id));
  const activeCampaigns = unlinkedCampaigns.filter(c => c.status === 'ACTIVE');
  const pausedCampaigns = unlinkedCampaigns.filter(c => c.status !== 'ACTIVE');

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}min atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    return `${Math.floor(hrs / 24)}d atrás`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Automação de Campanhas CTWA
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Configure a criação automática de leads e o funil de destino para cada campanha Click-to-WhatsApp.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {links.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma campanha vinculada. Adicione abaixo para configurar automações.
          </p>
        )}

        {links.map(link => {
          const linkAny = link as any;
          const selectedBoard = boards.find(b => b.id === linkAny.board_id);
          const boardStages = selectedBoard?.stages || [];
          const isActive = linkAny.is_active !== false;
          const isExpanded = expandedLink === link.id;
          const conversations = linkConversations[link.id] || [];
          const convCount = conversationCounts[link.id] || 0;

          return (
            <div key={link.id} className={`border rounded-lg p-4 space-y-3 transition-opacity ${!isActive ? 'opacity-60 border-dashed' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">{link.campaign_name || link.campaign_id}</span>
                    {!isActive && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Pausado</Badge>
                    )}
                  </div>
                  {(() => {
                    const camp = metaCampaigns.find(c => c.campaign_id === link.campaign_id);
                    if (!camp?.destination_phone) return null;
                    const matchedInst = findInstanceByPhone(camp.destination_phone);
                    return (
                      <div className="ml-6 space-y-0.5">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {camp.destination_phone}
                        </span>
                        {matchedInst && (
                          <span className="text-[10px] text-green-600 flex items-center gap-1">
                            ✅ Instância detectada: {matchedInst.instance_name}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Conversations button */}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-2 text-[10px] gap-1"
                    onClick={() => handleToggleExpand(link)}
                  >
                    <MessageSquare className="h-3 w-3" />
                    {convCount > 0 && <span>{convCount}</span>}
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                  {/* Pause/Resume */}
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7" 
                    onClick={() => handleTogglePause(link)}
                    title={isActive ? 'Pausar vínculo' : 'Reativar vínculo'}
                  >
                    {isActive ? <Pause className="h-3.5 w-3.5 text-amber-500" /> : <Play className="h-3.5 w-3.5 text-green-500" />}
                  </Button>
                  {/* Delete */}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(link.id)}>
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {/* Conversations panel */}
              {isExpanded && (
                <div className="bg-muted/50 rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    <Users className="h-3 w-3" /> Conversas ativas com este agente
                  </div>
                  {loadingConversations === link.id ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                    </div>
                  ) : conversations.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">Nenhuma conversa ativa.</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {conversations.map((conv, i) => (
                        <div key={i} className="flex items-center justify-between bg-background rounded px-2 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${conv.is_agent_active ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                            <span className="text-xs truncate">{conv.contact_name || conv.phone}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                            {formatTimeAgo(conv.last_message_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isActive && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> Instância
                      </Label>
                      <Select value={linkAny.instance_id || ''} onValueChange={v => handleUpdate(link.id, { instance_id: v || null } as any)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {instances.map(inst => (
                            <SelectItem key={inst.id} value={inst.id}>
                              {inst.instance_name} {inst.owner_phone ? `(${inst.owner_phone})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Agente IA
                      </Label>
                      <Select value={link.agent_id} onValueChange={v => handleUpdate(link.id, { agent_id: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {agents.map(a => <SelectItem key={a.id} value={a.id}>#{a.shortcut_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <FolderKanban className="h-3 w-3" /> Funil
                      </Label>
                      <Select value={linkAny.board_id || ''} onValueChange={v => handleUpdate(link.id, { board_id: v || null, stage_id: null } as any)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Etapa inicial</Label>
                      <Select
                        value={linkAny.stage_id || ''}
                        onValueChange={v => handleUpdate(link.id, { stage_id: v || null } as any)}
                        disabled={!linkAny.board_id}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {boardStages.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      id={`auto-lead-${link.id}`}
                      checked={linkAny.auto_create_lead || false}
                      onCheckedChange={v => handleUpdate(link.id, { auto_create_lead: v } as any)}
                    />
                    <Label htmlFor={`auto-lead-${link.id}`} className="text-xs">
                      Criar lead automaticamente quando mensagem chegar desta campanha
                    </Label>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Add new link form */}
        <div className="border border-dashed rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Vincular nova campanha
          </p>
          <div className="space-y-3">
            {/* Campaign selector */}
            {useManualInput ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Campanha</Label>
                  <div className="flex items-center gap-1">
                    <button className="text-[10px] text-primary underline" onClick={() => fetchMetaCampaigns()}>
                      Buscar campanhas
                    </button>
                    {metaCampaigns.length > 0 && (
                      <button className="text-[10px] text-primary underline" onClick={() => setUseManualInput(false)}>
                        Selecionar da lista
                      </button>
                    )}
                  </div>
                </div>
                {loadingCampaigns && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Buscando campanhas...
                  </div>
                )}
                <Input
                  className="h-8 text-xs"
                  placeholder="Ex: 123456789"
                  value={manualCampaignId}
                  onChange={e => setManualCampaignId(e.target.value)}
                />
                <Input
                  className="h-8 text-xs mt-1"
                  placeholder="Nome da campanha (opcional)"
                  value={manualCampaignName}
                  onChange={e => setManualCampaignName(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Campanha</Label>
                  <div className="flex items-center gap-1">
                    <button className="text-[10px] text-primary underline" onClick={() => setUseManualInput(true)}>
                      Digitar manualmente
                    </button>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={fetchMetaCampaigns} disabled={loadingCampaigns}>
                      <RefreshCw className={`h-3 w-3 ${loadingCampaigns ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
                <Select value={addingCampaign} onValueChange={(val) => {
                  setAddingCampaign(val);
                  const camp = metaCampaigns.find(c => c.campaign_id === val);
                  if (camp?.destination_phone) {
                    const matched = findInstanceByPhone(camp.destination_phone);
                    if (matched) setAddingInstance(matched.id);
                  }
                }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar campanha..." /></SelectTrigger>
                  <SelectContent>
                    {activeCampaigns.length > 0 && (
                      <div className="px-2 py-1 text-[10px] font-semibold text-green-600 uppercase tracking-wider">🟢 Ativas</div>
                    )}
                    {activeCampaigns.map(c => (
                      <SelectItem key={c.campaign_id} value={c.campaign_id}>
                        <div className="flex flex-col">
                          <span>{c.campaign_name}</span>
                          {c.destination_phone && (
                            <span className="text-[10px] text-muted-foreground">📞 {c.destination_phone}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                    {showPaused && pausedCampaigns.length > 0 && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">⏸ Pausadas</div>
                        {pausedCampaigns.map(c => (
                          <SelectItem key={c.campaign_id} value={c.campaign_id}>
                            <div className="flex flex-col">
                              <span>{c.campaign_name}</span>
                              {c.destination_phone && (
                                <span className="text-[10px] text-muted-foreground">📞 {c.destination_phone}</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {!showPaused && pausedCampaigns.length > 0 && (
                      <div
                        className="px-2 py-1.5 text-[10px] text-primary cursor-pointer hover:bg-accent rounded"
                        onPointerDown={(e) => { e.preventDefault(); setShowPaused(true); }}
                      >
                        Mostrar {pausedCampaigns.length} campanha(s) pausada(s)
                      </div>
                    )}
                    {activeCampaigns.length === 0 && pausedCampaigns.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhuma campanha disponível
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Instance info (auto-detected) */}
            {(() => {
              const selectedCamp = metaCampaigns.find(c => c.campaign_id === addingCampaign);
              const detectedInstance = selectedCamp?.destination_phone ? findInstanceByPhone(selectedCamp.destination_phone) : undefined;
              return selectedCamp?.destination_phone ? (
                <div className="space-y-1 bg-muted/50 rounded-md p-2">
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> Instância detectada
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {detectedInstance ? (
                        <span className="flex items-center gap-1 text-green-600">
                          ✅ {detectedInstance.instance_name} ({detectedInstance.owner_phone})
                        </span>
                      ) : (
                        <span className="text-amber-600 text-xs">
                          ⚠️ Nenhuma instância com o número {selectedCamp.destination_phone}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Agent selector */}
            <div className="space-y-1">
              <Label className="text-[10px]">Agente IA (exclusivo para leads desta campanha)</Label>
              <Select value={addingAgent} onValueChange={setAddingAgent}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar agente..." /></SelectTrigger>
                <SelectContent>
                  {agents.length > 0 ? (
                    agents.map(a => <SelectItem key={a.id} value={a.id}>#{a.shortcut_name}</SelectItem>)
                  ) : (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum agente ativo</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Board / Stage selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] flex items-center gap-1">
                  <FolderKanban className="h-3 w-3" /> Funil de destino
                </Label>
                <Select value={addingBoard} onValueChange={v => { setAddingBoard(v); setAddingStage(''); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar funil..." /></SelectTrigger>
                  <SelectContent>
                    {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Etapa inicial</Label>
                <Select value={addingStage} onValueChange={setAddingStage} disabled={!addingBoard}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    {(boards.find(b => b.id === addingBoard)?.stages || []).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Apply to existing conversations toggle */}
            <div className="flex items-center gap-2 bg-muted/50 rounded-md p-2">
              <Switch
                id="apply-existing"
                checked={applyToExisting}
                onCheckedChange={setApplyToExisting}
              />
              <Label htmlFor="apply-existing" className="text-xs leading-tight">
                Aplicar também às conversas antigas que vieram desta campanha
              </Label>
            </div>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!addingAgent || (useManualInput ? !manualCampaignId : !addingCampaign)}
            onClick={handleAddLink}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Vincular
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
