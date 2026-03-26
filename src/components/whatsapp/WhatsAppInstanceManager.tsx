import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Smartphone, Wifi, WifiOff, Phone, Globe, Key, CheckCircle2, RefreshCw, Bot, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

interface Instance {
  id: string;
  instance_name: string;
  instance_token: string;
  base_url: string | null;
  owner_phone: string | null;
  is_active: boolean | null;
  is_paused: boolean;
  receive_leads: boolean | null;
  ad_account_id: string | null;
  ad_account_name: string | null;
  auto_identify_sender: boolean | null;
  default_agent_id: string | null;
  voice_id: string | null;
  voice_name: string | null;
  created_at: string;
}

interface AgentOption {
  id: string;
  name: string;
}

interface VoiceOption {
  id: string;
  name: string;
  type: 'preset' | 'custom';
}

interface FormData {
  instance_name: string;
  instance_token: string;
  base_url: string;
  owner_phone: string;
}

const emptyForm: FormData = {
  instance_name: '',
  instance_token: '',
  base_url: 'https://abraci.uazapi.com',
  owner_phone: '',
};

export function WhatsAppInstanceManager() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);

  const syncPhones = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-whatsapp-status');
      if (error) throw error;
      const results = data as Array<{ id: string; owner_phone: string | null }>;
      if (results?.length) {
        // Update local state with synced phones
        setInstances(prev => prev.map(inst => {
          const synced = results.find(r => r.id === inst.id);
          if (synced?.owner_phone && synced.owner_phone !== inst.owner_phone) {
            return { ...inst, owner_phone: synced.owner_phone };
          }
          return inst;
        }));
        toast.success('Números sincronizados da API!');
      }
    } catch (e: any) {
      toast.error('Erro ao sincronizar: ' + (e?.message || 'erro desconhecido'));
    } finally {
      setSyncing(false);
    }
  };

  const fetchInstances = useCallback(async () => {
    const [instancesRes, shortcutsRes] = await Promise.all([
      supabase.from('whatsapp_instances').select('*').order('instance_name'),
      supabase.from('wjia_command_shortcuts').select('id, shortcut_name').eq('is_active', true).order('display_order'),
    ]);
    if (!instancesRes.error && instancesRes.data) setInstances(instancesRes.data as Instance[]);
    if (!shortcutsRes.error && shortcutsRes.data) setAgents((shortcutsRes.data as any[]).map(s => ({ id: s.id, name: '#' + s.shortcut_name })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (inst: Instance) => {
    setEditingId(inst.id);
    setForm({
      instance_name: inst.instance_name,
      instance_token: inst.instance_token,
      base_url: inst.base_url || 'https://abraci.uazapi.com',
      owner_phone: inst.owner_phone || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.instance_name.trim() || !form.instance_token.trim()) {
      toast.error('Nome e Token são obrigatórios');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('whatsapp_instances')
          .update({
            instance_name: form.instance_name.trim(),
            instance_token: form.instance_token.trim(),
            base_url: form.base_url.trim() || null,
            owner_phone: form.owner_phone.trim() || null,
          } as any)
          .eq('id', editingId);
        if (error) throw error;
        toast.success('Instância atualizada!');
      } else {
        const { error } = await supabase
          .from('whatsapp_instances')
          .insert({
            instance_name: form.instance_name.trim(),
            instance_token: form.instance_token.trim(),
            base_url: form.base_url.trim() || null,
            owner_phone: form.owner_phone.trim() || null,
          });
        if (error) throw error;
        toast.success('Instância criada com sucesso!');
      }
      setDialogOpen(false);
      await fetchInstances();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Erro ao salvar instância');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from('whatsapp_instances')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success(`"${deleteTarget.instance_name}" removida`);
      setDeleteTarget(null);
      await fetchInstances();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao remover instância');
    }
  };

  const toggleActive = async (inst: Instance) => {
    const newActive = !inst.is_active;
    setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, is_active: newActive } : i));
    const { error } = await supabase
      .from('whatsapp_instances')
      .update({ is_active: newActive } as any)
      .eq('id', inst.id);
    if (error) {
      setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, is_active: !newActive } : i));
      toast.error('Erro ao alterar status');
    } else {
      toast.success(newActive ? 'Instância ativada' : 'Instância desativada');
    }
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Gerencie suas instâncias WhatsApp (UazAPI). Cada instância representa um número conectado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={syncPhones} variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Números'}
          </Button>
          <Button onClick={openCreate} size="sm" className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" />
            Nova Instância
          </Button>
        </div>
      </div>

      {instances.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Smartphone className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium mb-1">Nenhuma instância cadastrada</p>
            <p className="text-xs text-muted-foreground mb-4">Crie sua primeira instância para conectar um número WhatsApp.</p>
            <Button onClick={openCreate} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Criar Instância
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {instances.map(inst => (
            <Card key={inst.id} className={inst.is_active === false ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{inst.instance_name}</span>
                      {inst.is_active !== false ? (
                        <Badge variant="default" className="text-[10px] h-5 gap-1">
                          <Wifi className="h-3 w-3" /> Ativa
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                          <WifiOff className="h-3 w-3" /> Inativa
                        </Badge>
                      )}
                      {inst.is_paused && (
                        <Badge variant="destructive" className="text-[10px] h-5">Pausada</Badge>
                      )}
                      {inst.receive_leads && (
                        <Badge variant="outline" className="text-[10px] h-5">Recebe Leads</Badge>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {inst.owner_phone ? (
                          <span className="font-medium text-foreground">{inst.owner_phone.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4')}</span>
                        ) : (
                          <button
                            onClick={() => openEdit(inst)}
                            className="text-primary hover:underline italic"
                          >
                            Definir telefone
                          </button>
                        )}
                      </span>
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" /> {inst.base_url || 'https://abraci.uazapi.com'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Key className="h-3 w-3" /> {inst.instance_token.slice(0, 8)}...
                      </span>
                    </div>
                    {/* Default Agent Selector */}
                    {agents.length > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground shrink-0">Agente padrão:</span>
                        <Select
                          value={inst.default_agent_id || 'none'}
                          onValueChange={async (v) => {
                            const newVal = v === 'none' ? null : v;
                            setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, default_agent_id: newVal } : i));
                            const { error } = await supabase
                              .from('whatsapp_instances')
                              .update({ default_agent_id: newVal } as any)
                              .eq('id', inst.id);
                            if (error) {
                              toast.error('Erro ao salvar agente padrão');
                              setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, default_agent_id: inst.default_agent_id } : i));
                            } else {
                              const agentName = agents.find(a => a.id === newVal)?.name;
                              toast.success(newVal ? `🤖 Agente "${agentName}" definido como padrão` : 'Agente padrão removido');
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-48">
                            <SelectValue placeholder="Nenhum" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {agents.map(a => (
                              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`active-${inst.id}`} className="text-xs text-muted-foreground">Ativa</Label>
                      <Switch
                        id={`active-${inst.id}`}
                        checked={inst.is_active !== false}
                        onCheckedChange={() => toggleActive(inst)}
                      />
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(inst)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(inst)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Instância' : 'Nova Instância WhatsApp'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Atualize os dados da instância.' : 'Preencha os dados da sua instância UazAPI.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="inst-name">Nome da Instância *</Label>
              <Input
                id="inst-name"
                placeholder="Ex: Escritório Principal"
                value={form.instance_name}
                onChange={e => setForm(f => ({ ...f, instance_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inst-token">Token da Instância *</Label>
              <Input
                id="inst-token"
                placeholder="Cole o token gerado na UazAPI"
                value={form.instance_token}
                onChange={e => setForm(f => ({ ...f, instance_token: e.target.value }))}
                type="password"
              />
              <p className="text-[11px] text-muted-foreground">Encontrado no painel da UazAPI em Configurações → Token.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inst-url">URL Base</Label>
              <Input
                id="inst-url"
                placeholder="https://abraci.uazapi.com"
                value={form.base_url}
                onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">Padrão: https://abraci.uazapi.com</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inst-phone">Telefone do Dono</Label>
              <Input
                id="inst-phone"
                placeholder="5511999999999"
                value={form.owner_phone}
                onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">Número com DDI+DDD, sem espaços ou traços.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : (
                <><CheckCircle2 className="h-4 w-4" /> Criar Instância</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover instância?</AlertDialogTitle>
            <AlertDialogDescription>
              A instância "{deleteTarget?.instance_name}" será removida permanentemente. Todas as permissões e configurações associadas serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
