import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useAdSetGeoRules, AdSetGeoRule } from '@/hooks/useAdSetGeoRules';
import { useKanbanBoards, KanbanBoard } from '@/hooks/useKanbanBoards';
import { useProfilesList } from '@/hooks/useProfilesList';
import { getMetaCredentials } from '@/utils/metaCredentials';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { MapPin, Plus, Trash2, Loader2, Target, FolderKanban, User, Zap, ChevronsUpDown, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  const [adSetOpen, setAdSetOpen] = useState(false);
  const [adSetSort, setAdSetSort] = useState<'name' | 'status'>('status');

  // Form state
  const [formBoardId, setFormBoardId] = useState('');
  const [formStageId, setFormStageId] = useState('');
  const [formAcolhedor, setFormAcolhedor] = useState('');
  const [formAdSetId, setFormAdSetId] = useState('');
  const [formRadiusKm, setFormRadiusKm] = useState(10);

  const funnelBoards = boards.filter(b => b.board_type === 'funnel');

  const selectedBoard = funnelBoards.find(b => b.id === formBoardId);

  const statusOrder = (s?: string) => s === 'ACTIVE' ? 0 : (s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') ? 1 : 2;

  const sortedAdSets = useMemo(() => {
    return [...adSets].sort((a, b) => {
      if (adSetSort === 'status') {
        const diff = statusOrder(a.effective_status) - statusOrder(b.effective_status);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [adSets, adSetSort]);

  const fetchAdSets = async () => {
    setLoadingAdSets(true);
    try {
      const { accessToken, adAccountId } = await getMetaCredentials();
      if (!accessToken || !adAccountId) {
        toast.error('Conecte sua conta Meta primeiro');
        return;
      }
      const formattedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const { data, error } = await cloudFunctions.invoke('list-meta-adsets', {
        body: { accessToken, adAccountId: formattedAdAccountId, limit: 100 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      console.log('Meta AdSets response:', data);
      setAdSets(data?.adsets || []);
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
              <div className="flex items-center justify-between mb-1">
                <Label>Conjunto de Anúncios (Ad Set) *</Label>
                <div className="flex gap-1">
                  <Button variant={adSetSort === 'status' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setAdSetSort('status')}>Status</Button>
                  <Button variant={adSetSort === 'name' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setAdSetSort('name')}>Nome</Button>
                </div>
              </div>
              {loadingAdSets ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando ad sets...
                </div>
              ) : (
                <Popover open={adSetOpen} onOpenChange={setAdSetOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={adSetOpen} className="w-full justify-between font-normal">
                      {formAdSetId ? (() => {
                        const sel = adSets.find(a => a.id === formAdSetId);
                        if (!sel) return 'Selecione o ad set';
                        const icon = sel.effective_status === 'ACTIVE' ? '🟢' : (sel.effective_status === 'PAUSED' || sel.effective_status === 'CAMPAIGN_PAUSED' || sel.effective_status === 'ADSET_PAUSED') ? '⏸️' : '⚪';
                        return `${icon} ${sel.name}`;
                      })() : 'Selecione o ad set'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[460px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar ad set..." />
                      <CommandList className="max-h-[300px]">
                        <CommandEmpty>Nenhum ad set encontrado.</CommandEmpty>
                        <CommandGroup>
                          {sortedAdSets.map(a => {
                            const icon = a.effective_status === 'ACTIVE' ? '🟢' : (a.effective_status === 'PAUSED' || a.effective_status === 'CAMPAIGN_PAUSED' || a.effective_status === 'ADSET_PAUSED') ? '⏸️' : '⚪';
                            return (
                              <CommandItem
                                key={a.id}
                                value={`${a.name} ${a.campaign_name || ''}`}
                                onSelect={() => { setFormAdSetId(a.id); setAdSetOpen(false); }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", formAdSetId === a.id ? "opacity-100" : "opacity-0")} />
                                <span className="truncate">{icon} {a.name} {a.campaign_name ? `(${a.campaign_name})` : ''}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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
