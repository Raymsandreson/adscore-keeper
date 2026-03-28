import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Megaphone, Target, Sparkles, FolderKanban, Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface CampaignLink {
  id: string;
  agent_id: string;
  campaign_id: string;
  campaign_name: string;
  auto_create_lead?: boolean;
  board_id?: string | null;
  stage_id?: string | null;
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

export function CTWACampaignAutomation() {
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [availableCampaigns, setAvailableCampaigns] = useState<{ campaign_id: string; campaign_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingAgent, setAddingAgent] = useState<string>('');
  const [addingCampaign, setAddingCampaign] = useState<string>('');

  const fetchData = async () => {
    setLoading(true);
    const [linksRes, agentsRes, boardsRes] = await Promise.all([
      supabase.from('whatsapp_agent_campaign_links').select('*'),
      supabase.from('whatsapp_ai_agents').select('id, name').eq('is_active', true),
      supabase.from('kanban_boards').select('id, name, stages').eq('is_active', true),
    ]);

    setLinks((linksRes.data as any[]) || []);
    setAgents((agentsRes.data as Agent[]) || []);
    setBoards((boardsRes.data as Board[]) || []);

    const uniqueCampaigns = new Map<string, string>();
    ((linksRes.data as any[]) || []).forEach((l: any) => {
      uniqueCampaigns.set(l.campaign_id, l.campaign_name || l.campaign_id);
    });

    try {
      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('ad_account_id')
        .eq('is_active', true)
        .not('ad_account_id', 'is', null);
      
      const { data: settings } = await supabase
        .from('whatsapp_settings')
        .select('meta_access_token')
        .limit(1)
        .single();

      if (instances && settings && (settings as any).meta_access_token) {
        for (const inst of instances) {
          try {
            const { data } = await supabase.functions.invoke('list-meta-ads', {
              body: { accessToken: (settings as any).meta_access_token, adAccountId: (inst as any).ad_account_id, limit: 50 }
            });
            if (data?.campaigns) {
              data.campaigns.forEach((c: any) => {
                uniqueCampaigns.set(c.campaign_id, c.campaign_name);
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    setAvailableCampaigns(Array.from(uniqueCampaigns.entries()).map(([id, name]) => ({ campaign_id: id, campaign_name: name })));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleAddLink = async () => {
    if (!addingAgent || !addingCampaign) return;
    const camp = availableCampaigns.find(c => c.campaign_id === addingCampaign);
    const { error } = await supabase.from('whatsapp_agent_campaign_links').upsert({
      agent_id: addingAgent,
      campaign_id: addingCampaign,
      campaign_name: camp?.campaign_name || addingCampaign,
    } as any, { onConflict: 'campaign_id' });
    if (error) { toast.error('Erro ao vincular'); return; }
    toast.success('Campanha vinculada!');
    setAddingAgent('');
    setAddingCampaign('');
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
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-medium">{link.campaign_name || link.campaign_id}</span>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px]">Agente IA</Label>
              <Select value={addingAgent} onValueChange={setAddingAgent}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar agente..." /></SelectTrigger>
                <SelectContent>
                  {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Campanha</Label>
              <Select value={addingCampaign} onValueChange={setAddingCampaign}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar campanha..." /></SelectTrigger>
                <SelectContent>
                  {availableCampaigns
                    .filter(c => !links.some(l => l.campaign_id === c.campaign_id))
                    .map(c => <SelectItem key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs" disabled={!addingAgent || !addingCampaign} onClick={handleAddLink}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Vincular
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
