import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MODULE_DEFINITIONS, AccessLevel } from '@/hooks/useModulePermissions';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Shield, Loader2, Sparkles } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { supabase as supabaseClient } from '@/integrations/supabase/client';

interface AccessProfile {
  id: string;
  name: string;
  description: string | null;
  module_permissions: Array<{ module_key: string; access_level: string }>;
  whatsapp_instance_ids: string[];
  is_active: boolean;
}

interface WhatsAppInstance {
  id: string;
  instance_name: string;
}

export function AccessProfilesManager() {
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccessProfile | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modules, setModules] = useState<Record<string, AccessLevel>>(() => {
    const init: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach(m => { init[m.key] = 'none'; });
    return init;
  });
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [profilesRes, instancesRes] = await Promise.all([
      supabase.from('access_profiles').select('*').eq('is_active', true).order('name'),
      supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true).order('instance_name'),
    ]);
    setProfiles((profilesRes.data || []) as unknown as AccessProfile[]);
    setInstances((instancesRes.data || []) as WhatsAppInstance[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetForm = () => {
    setName('');
    setDescription('');
    const init: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach(m => { init[m.key] = 'none'; });
    setModules(init);
    setSelectedInstances([]);
    setEditing(null);
  };

  const openEdit = (profile: AccessProfile) => {
    setEditing(profile);
    setName(profile.name);
    setDescription(profile.description || '');
    const mods: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach(m => { mods[m.key] = 'none'; });
    (profile.module_permissions || []).forEach((p: any) => {
      mods[p.module_key] = p.access_level as AccessLevel;
    });
    setModules(mods);
    setSelectedInstances(profile.whatsapp_instance_ids || []);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Informe o nome do perfil');
      return;
    }

    const modulePerms = Object.entries(modules)
      .filter(([, level]) => level !== 'none')
      .map(([module_key, access_level]) => ({ module_key, access_level }));

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      module_permissions: modulePerms,
      whatsapp_instance_ids: selectedInstances,
    };

    try {
      if (editing) {
        const { error } = await supabase
          .from('access_profiles')
          .update(payload as any)
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Perfil atualizado!');
      } else {
        const { error } = await supabase
          .from('access_profiles')
          .insert(payload as any);
        if (error) throw error;
        toast.success('Perfil criado!');
      }
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar perfil');
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('access_profiles')
      .update({ is_active: false } as any)
      .eq('id', id);
    if (error) {
      toast.error('Erro ao remover perfil');
    } else {
      toast.success('Perfil removido');
      fetchData();
    }
  };

  const getAccessLabel = (level: string) => {
    switch (level) {
      case 'view': return 'Ver';
      case 'edit': return 'Editar';
      default: return level;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Perfis de Acesso</h3>
          <p className="text-sm text-muted-foreground">Templates pré-definidos para convidar membros rapidamente</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Novo Perfil
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar Perfil' : 'Novo Perfil de Acesso'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Nome</Label>
                  <Input placeholder="Ex: Comercial, Tráfego" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Input placeholder="Breve descrição" value={description} onChange={e => setDescription(e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-3 block">Módulos</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MODULE_DEFINITIONS.map(mod => (
                    <div key={mod.key} className="flex items-center justify-between rounded-md border px-3 py-2 bg-background">
                      <span className="text-sm">{mod.label}</span>
                      <Select
                        value={modules[mod.key] || 'none'}
                        onValueChange={(v) => setModules(prev => ({ ...prev, [mod.key]: v as AccessLevel }))}
                      >
                        <SelectTrigger className="w-24 h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem acesso</SelectItem>
                          <SelectItem value="view">Ver</SelectItem>
                          <SelectItem value="edit">Editar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {instances.length > 0 && (
                <div>
                  <Label className="text-sm font-semibold mb-3 block">Instâncias WhatsApp</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {instances.map(inst => (
                      <label key={inst.id} className="flex items-center gap-2 rounded-md border px-3 py-2 bg-background cursor-pointer hover:bg-muted/50">
                        <Checkbox
                          checked={selectedInstances.includes(inst.id)}
                          onCheckedChange={(checked) => {
                            setSelectedInstances(prev =>
                              checked ? [...prev, inst.id] : prev.filter(id => id !== inst.id)
                            );
                          }}
                        />
                        <span className="text-sm">{inst.instance_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
                <Button onClick={handleSave}>{editing ? 'Salvar' : 'Criar Perfil'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhum perfil criado. Crie templates como "Comercial", "Tráfego", etc.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map(profile => {
            const activeModules = (profile.module_permissions || []).filter((p: any) => p.access_level !== 'none');
            const instanceCount = (profile.whatsapp_instance_ids || []).length;
            return (
              <Card key={profile.id} className="relative group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{profile.name}</CardTitle>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(profile)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(profile.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {profile.description && (
                    <CardDescription className="text-xs">{profile.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {activeModules.map((p: any) => (
                      <Badge key={p.module_key} variant="secondary" className="text-[10px]">
                        {MODULE_DEFINITIONS.find(m => m.key === p.module_key)?.label || p.module_key}
                        <span className="ml-1 opacity-60">({getAccessLabel(p.access_level)})</span>
                      </Badge>
                    ))}
                    {instanceCount > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {instanceCount} instância{instanceCount > 1 ? 's' : ''} WA
                      </Badge>
                    )}
                    {activeModules.length === 0 && instanceCount === 0 && (
                      <span className="text-xs text-muted-foreground">Sem permissões configuradas</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
