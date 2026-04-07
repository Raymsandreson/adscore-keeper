import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAdSetGeoRules, AdSetGeoRule } from '@/hooks/useAdSetGeoRules';
import { useKanbanBoards, KanbanBoard } from '@/hooks/useKanbanBoards';
import { useProfilesList } from '@/hooks/useProfilesList';
import { getMetaCredentials } from '@/utils/metaCredentials';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, Plus, Trash2, Loader2, Target, FolderKanban, User, Zap } from 'lucide-react';
import { toast } from 'sonner';

interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  campaign_name?: string;
  effective_status?: string;
}

export function AdSetGeoRulesConfig() {
  const { rules, loading, createRule, updateRule, deleteRule } = useAdSetGeoRules();
  const { boards } = useKanbanBoards();
  const profiles = useProfilesList();
  const [showDialog, setShowDialog] = useState(false);
  const [adSets, setAdSets] = useState<MetaAdSet[]>([]);
  const [loadingAdSets, setLoadingAdSets] = useState(false);

  // Form state
  const [formBoardId, setFormBoardId] = useState('');
  const [formStageId, setFormStageId] = useState('');
  const [formAcolhedor, setFormAcolhedor] = useState('');
  const [formAdSetId, setFormAdSetId] = useState('');
  const [formRadiusKm, setFormRadiusKm] = useState(10);

  const funnelBoards = boards.filter(b => b.board_type === 'funnel');

  const selectedBoard = funnelBoards.find(b => b.id === formBoardId);

  const fetchAdSets = async () => {
    setLoadingAdSets(true);
    try {
      const { accessToken, adAccountId } = await getMetaCredentials();
      if (!accessToken || !adAccountId) {
        toast.error('Conecte sua conta Meta primeiro');
        return;
      }
      const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const statusFilter = encodeURIComponent(JSON.stringify([{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","ARCHIVED","CAMPAIGN_PAUSED","ADSET_PAUSED","PENDING_REVIEW","DISAPPROVED","PREAPPROVED","PENDING_BILLING_INFO","WITH_ISSUES"]}]));
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${actId}/adsets?fields=id,name,effective_status,campaign_id,campaign{name}&limit=200&filtering=${statusFilter}&access_token=${accessToken}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setAdSets(
        (data.data || []).map((a: any) => ({
          id: a.id,
          name: a.name,
          campaign_id: a.campaign_id,
          campaign_name: a.campaign?.name || '',
        }))
      );
    } catch (e: any) {
      console.error('Error fetching ad sets:', e);
      toast.error('Erro ao buscar conjuntos de anúncios');
    } finally {
      setLoadingAdSets(false);
    }
  };

  const handleCreate = async () => {
    if (!formBoardId || !formAdSetId) {
      toast.error('Selecione o funil e o conjunto de anúncios');
      return;
    }
    const { adAccountId } = await getMetaCredentials();
    const selectedAdSet = adSets.find(a => a.id === formAdSetId);
    
    await createRule({
      board_id: formBoardId,
      stage_id: formStageId || null,
      acolhedor: formAcolhedor || null,
      adset_id: formAdSetId,
      ad_account_id: adAccountId || '',
      campaign_id: selectedAdSet?.campaign_id || null,
      campaign_name: selectedAdSet?.campaign_name || null,
      adset_name: selectedAdSet?.name || null,
      radius_km: formRadiusKm,
      is_active: true,
    });
    setShowDialog(false);
    resetForm();
  };

  const resetForm = () => {
    setFormBoardId('');
    setFormStageId('');
    setFormAcolhedor('');
    setFormAdSetId('');
    setFormRadiusKm(10);
  };

  const getBoardName = (boardId: string) => funnelBoards.find(b => b.id === boardId)?.name || boardId;
  const getStageName = (boardId: string, stageId: string | null) => {
    if (!stageId) return 'Todas';
    const board = funnelBoards.find(b => b.id === boardId);
    return board?.stages.find(s => s.id === stageId)?.name || stageId;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Regras de Geo-Segmentação Automática
        </CardTitle>
        <Button size="sm" onClick={() => { setShowDialog(true); fetchAdSets(); }}>
          <Plus className="h-4 w-4 mr-1" /> Nova Regra
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Configure para que ao criar um lead, a cidade dele seja automaticamente adicionada à segmentação geográfica do conjunto de anúncios vinculado.
        </p>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rules.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Nenhuma regra configurada. Clique em "Nova Regra" para começar.
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map(rule => (
              <div key={rule.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="gap-1">
                      <FolderKanban className="h-3 w-3" /> {getBoardName(rule.board_id)}
                    </Badge>
                    <Badge variant="secondary" className="gap-1">
                      <Target className="h-3 w-3" /> Etapa: {getStageName(rule.board_id, rule.stage_id)}
                    </Badge>
                    {rule.acolhedor && (
                      <Badge variant="secondary" className="gap-1">
                        <User className="h-3 w-3" /> {rule.acolhedor}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={(checked) => updateRule(rule.id, { is_active: checked })}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteRule(rule.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>Ad Set: {rule.adset_name || rule.adset_id}</span>
                  {rule.campaign_name && <span>• Campanha: {rule.campaign_name}</span>}
                  <span>• Raio: {rule.radius_km}km</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Regra de Geo-Segmentação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Funil de Vendas *</Label>
              <Select value={formBoardId} onValueChange={setFormBoardId}>
                <SelectTrigger><SelectValue placeholder="Selecione o funil" /></SelectTrigger>
                <SelectContent>
                  {funnelBoards.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Etapa do Funil</Label>
              <Select value={formStageId} onValueChange={setFormStageId}>
                <SelectTrigger><SelectValue placeholder="Todas as etapas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as etapas</SelectItem>
                  {selectedBoard?.stages.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Acolhedor / Assessor</Label>
              <Select value={formAcolhedor} onValueChange={setFormAcolhedor}>
                <SelectTrigger><SelectValue placeholder="Todos os acolhedores" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.full_name || p.email || p.user_id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Conjunto de Anúncios (Ad Set) *</Label>
              {loadingAdSets ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando ad sets...
                </div>
              ) : (
                <Select value={formAdSetId} onValueChange={setFormAdSetId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o ad set" /></SelectTrigger>
                  <SelectContent>
                    {adSets.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} {a.campaign_name ? `(${a.campaign_name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <Label>Raio (km)</Label>
              <Input
                type="number"
                min={1}
                max={80}
                value={formRadiusKm}
                onChange={(e) => setFormRadiusKm(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Raio em km ao redor da cidade do lead para segmentação
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Criar Regra</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
