import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Bot, Plus, Trash2, Smartphone, Shield, MessageSquare, Sparkles } from 'lucide-react';

interface CommandConfig {
  id: string;
  instance_name: string;
  authorized_phone: string;
  user_id: string;
  user_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface Instance {
  id: string;
  instance_name: string;
}

interface Profile {
  user_id: string;
  full_name: string | null;
}

export function WhatsAppCommandConfig() {
  const [configs, setConfigs] = useState<CommandConfig[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Form state
  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [configsRes, instancesRes, profilesRes] = await Promise.all([
      supabase.from('whatsapp_command_config').select('*').order('created_at', { ascending: false }),
      supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true),
      supabase.from('profiles').select('user_id, full_name').order('full_name'),
    ]);
    setConfigs((configsRes.data as any[]) || []);
    setInstances(instancesRes.data || []);
    setProfiles((profilesRes.data || []).filter((p: any) => p.full_name));
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!selectedInstance || !selectedUser || !phone.trim()) {
      toast.error('Preencha todos os campos');
      return;
    }

    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (normalizedPhone.length < 10) {
      toast.error('Telefone inválido');
      return;
    }

    const profile = profiles.find(p => p.user_id === selectedUser);
    setAdding(true);

    const { error } = await supabase.from('whatsapp_command_config').insert({
      instance_name: selectedInstance,
      authorized_phone: normalizedPhone,
      user_id: selectedUser,
      user_name: profile?.full_name || null,
    } as any);

    setAdding(false);
    if (error) {
      if (error.code === '23505') {
        toast.error('Este telefone já está configurado para esta instância');
      } else {
        toast.error('Erro ao adicionar: ' + error.message);
      }
      return;
    }

    toast.success('Número autorizado adicionado!');
    setPhone('');
    setSelectedInstance('');
    setSelectedUser('');
    loadData();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from('whatsapp_command_config').update({ is_active: !isActive } as any).eq('id', id);
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, is_active: !isActive } : c));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('whatsapp_command_config').delete().eq('id', id);
    setConfigs(prev => prev.filter(c => c.id !== id));
    toast.success('Removido');
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Info card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Como funciona</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Configure números de telefone autorizados a enviar comandos para o Chat IA via WhatsApp. 
                Quando uma mensagem chegar de um número autorizado na instância selecionada, 
                ela será processada como um comando — criando atividades, leads, buscando informações e mais. 
                A resposta da IA será enviada de volta pelo WhatsApp.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add new */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Adicionar Número Autorizado
          </CardTitle>
          <CardDescription>
            Vincule um número de telefone a uma instância WhatsApp e um usuário do sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Instância WhatsApp</Label>
              <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {instances.map(inst => (
                    <SelectItem key={inst.id} value={inst.instance_name}>
                      {inst.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Usuário (Assessor)</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Telefone (com DDD)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="5511999999999"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleAdd} disabled={adding} size="sm" className="shrink-0">
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Números Autorizados ({configs.length})
        </h3>

        {configs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum número configurado ainda</p>
              <p className="text-xs text-muted-foreground mt-1">
                Adicione um número acima para começar a enviar comandos via WhatsApp
              </p>
            </CardContent>
          </Card>
        ) : (
          configs.map(config => (
            <Card key={config.id} className={!config.is_active ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{config.user_name || 'Usuário'}</span>
                      <Badge variant="outline" className="text-[10px] h-5">
                        <Smartphone className="h-3 w-3 mr-1" />
                        {config.authorized_phone}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Instância: <span className="font-medium">{config.instance_name}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      checked={config.is_active}
                      onCheckedChange={() => handleToggle(config.id, config.is_active)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(config.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
