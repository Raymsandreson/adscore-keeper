import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Megaphone, Target, Sparkles, FolderKanban, Plus, X, Loader2, RefreshCw, Phone } from 'lucide-react';
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
}

interface Instance {
  id: string;
  instance_name: string;
  owner_phone?: string;
}

interface Agent {
  id: string;
  name: string;
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
  const [manualCampaignId, setManualCampaignId] = useState('');
  const [manualCampaignName, setManualCampaignName] = useState('');
  const [useManualInput, setUseManualInput] = useState(false);
  const [showPaused, setShowPaused] = useState(false);

  const getMetaCredentials = () => {
    const savedAccounts = localStorage.getItem('meta_saved_accounts');
    if (savedAccounts) {
      try {
        const accounts = JSON.parse(savedAccounts);
        const selectedIds = localStorage.getItem('meta_selected_account_ids');
        const selectedId = selectedIds ? JSON.parse(selectedIds)?.[0] : localStorage.getItem('meta_selected_account');
        const selected = accounts.find((a: any) => a.id === selectedId) || accounts[0];
        if (selected) {
          // accountId is the property name used by useMultiAccountSelection hook
          const adAccountId = selected.accountId || selected.adAccountId || selected.ad_account_id;
          console.log('CTWA credentials found:', { hasToken: !!selected.accessToken, adAccountId });
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
    if (!accessToken || !adAccountId) {
      console.warn('CTWA: No Meta credentials found. accessToken:', !!accessToken, 'adAccountId:', !!adAccountId);
      setUseManualInput(true);
      return;
    }
    setLoadingCampaigns(true);
    try {
      const formattedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
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
      console.log('CTWA: Loaded', campaigns.length, 'campaigns from Meta');
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
      supabase.from('whatsapp_ai_agents').select('id, name').eq('is_active', true).order('name'),
      supabase.from('kanban_boards' as any).select('id, name, stages'),
      supabase.from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true).order('instance_name'),
    ]);

    setLinks((linksRes.data as any[]) || []);
    setAgents((agentsRes.data as Agent[]) || []);
    setBoards((boardsRes.data as Board[]) || []);
    setInstances((instancesRes.data as Instance[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    fetchMetaCampaigns();
  }, []);

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

    const { error } = await supabase.from('whatsapp_agent_campaign_links').upsert({
      agent_id: addingAgent,
      campaign_id: campaignId,
      campaign_name: campaignName,
    } as any, { onConflict: 'campaign_id' });

    if (error) { toast.error('Erro ao vincular'); return; }
    toast.success('Campanha vinculada!');
    setAddingAgent('');
    setAddingCampaign('');
    setManualCampaignId('');
    setManualCampaignName('');
    fetchData();
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

          return (
            <div key={link.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{link.campaign_name || link.campaign_id}</span>
                  </div>
                  {(() => {
                    const camp = metaCampaigns.find(c => c.campaign_id === link.campaign_id);
                    return camp?.destination_phone ? (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 ml-6">
                        <Phone className="h-3 w-3" /> {camp.destination_phone}
                      </span>
                    ) : null;
                  })()}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(link.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Agente IA
                  </Label>
                  <Select value={link.agent_id} onValueChange={v => handleUpdate(link.id, { agent_id: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

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
            </div>
          );
        })}

        <div className="border border-dashed rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Vincular nova campanha
          </p>
          <div className="space-y-3">
            {/* Campaign selector - first */}
            {useManualInput ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Campanha</Label>
                  {metaCampaigns.length > 0 && (
                    <button className="text-[10px] text-primary underline" onClick={() => setUseManualInput(false)}>
                      Selecionar da lista
                    </button>
                  )}
                </div>
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
                <Select value={addingCampaign} onValueChange={setAddingCampaign}>
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

            {/* Instance + Agent in a row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Instância WhatsApp</Label>
                <Select value={addingInstance} onValueChange={setAddingInstance}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar instância..." /></SelectTrigger>
                  <SelectContent>
                    {instances.map(inst => (
                      <SelectItem key={inst.id} value={inst.id}>
                        <span>{inst.instance_name}</span>
                        {inst.owner_phone && <span className="text-[10px] text-muted-foreground ml-1">({inst.owner_phone})</span>}
                      </SelectItem>
                    ))}
                    {instances.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma instância ativa</div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px]">Agente IA</Label>
                <Select value={addingAgent} onValueChange={setAddingAgent}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar agente..." /></SelectTrigger>
                  <SelectContent>
                    {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    {agents.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum agente ativo</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
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
