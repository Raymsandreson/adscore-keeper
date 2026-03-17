import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Bot, MessageSquare } from 'lucide-react';

export function MemberAssistantSettings() {
  const [isActive, setIsActive] = useState(true);
  const [instanceName, setInstanceName] = useState('');
  const [configId, setConfigId] = useState<string | null>(null);
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [configRes, instRes] = await Promise.all([
      supabase.from('member_assistant_config').select('*').limit(1).maybeSingle(),
      supabase.from('whatsapp_instances').select('instance_name').order('instance_name'),
    ]);
    setInstances(instRes.data || []);
    if (configRes.data) {
      setConfigId(configRes.data.id);
      setIsActive(configRes.data.is_active ?? true);
      setInstanceName(configRes.data.instance_name || '');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        is_active: isActive,
        instance_name: instanceName || null,
        updated_at: new Date().toISOString(),
      };

      if (configId) {
        const { error } = await supabase.from('member_assistant_config').update(payload).eq('id', configId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('member_assistant_config').insert(payload).select('id').single();
        if (error) throw error;
        setConfigId(data.id);
      }
      toast.success('Configurações do assistente salvas!');
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-5 w-5" />
              Assistente IA para Membros
            </CardTitle>
            <CardDescription>
              Membros da equipe podem enviar mensagens pelo WhatsApp para interagir com a IA
            </CardDescription>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-3 bg-muted/50">
          <div className="flex items-start gap-2">
            <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Quando ativo, o sistema identifica automaticamente mensagens recebidas de números cadastrados nos perfis dos membros da equipe.</p>
              <p>O membro pode pedir: <strong>resumo do dia</strong>, <strong>tarefas atrasadas</strong>, <strong>criar atividade</strong>, <strong>consultar leads</strong>, <strong>metas</strong> e conversar livremente com o assistente.</p>
              <p>⚠️ Certifique-se de que os membros têm o número de WhatsApp cadastrado no perfil.</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Instância que responde aos membros</Label>
          <Select value={instanceName || '__any__'} onValueChange={(v) => setInstanceName(v === '__any__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Qualquer instância ativa..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Qualquer instância</SelectItem>
              {instances.map((inst) => (
                <SelectItem key={inst.instance_name} value={inst.instance_name}>
                  {inst.instance_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Se definido, apenas mensagens recebidas nesta instância ativarão o assistente para membros.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
