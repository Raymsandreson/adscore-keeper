import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Phone, Save } from 'lucide-react';
import { toast } from 'sonner';

interface InstanceAdConfig {
  id: string;
  instance_name: string;
  owner_phone: string | null;
  receive_leads: boolean;
  ad_account_id: string | null;
  ad_account_name: string | null;
}

export function WhatsAppAdLinkSettings() {
  const [instances, setInstances] = useState<InstanceAdConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchInstances = async () => {
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, owner_phone, receive_leads, ad_account_id, ad_account_name')
      .eq('is_active', true)
      .order('instance_name');

    if (!error && data) {
      setInstances(data as InstanceAdConfig[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const handleToggleReceiveLeads = async (instanceId: string, value: boolean) => {
    setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, receive_leads: value } : i));
  };

  const handleFieldChange = (instanceId: string, field: keyof InstanceAdConfig, value: string) => {
    setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, [field]: value } : i));
  };

  const handleSave = async (instance: InstanceAdConfig) => {
    setSaving(instance.id);
    try {
      const { error } = await supabase
        .from('whatsapp_instances')
        .update({
          receive_leads: instance.receive_leads,
          ad_account_id: instance.ad_account_id || null,
          ad_account_name: instance.ad_account_name || null,
        } as any)
        .eq('id', instance.id);

      if (error) throw error;
      toast.success(`Configuração de "${instance.instance_name}" salva!`);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar configuração');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="text-center text-sm text-muted-foreground py-8">Carregando instâncias...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          Vincular Instâncias aos Anúncios
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Marque quais números estão configurados para receber leads dos anúncios do Meta Ads.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {instances.map(instance => (
          <div key={instance.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{instance.instance_name}</span>
                {instance.owner_phone && (
                  <Badge variant="outline" className="text-xs">{instance.owner_phone}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`receive-${instance.id}`} className="text-xs text-muted-foreground">
                  Recebe Leads
                </Label>
                <Switch
                  id={`receive-${instance.id}`}
                  checked={instance.receive_leads}
                  onCheckedChange={(v) => handleToggleReceiveLeads(instance.id, v)}
                />
              </div>
            </div>

            {instance.receive_leads && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div className="space-y-1">
                  <Label className="text-xs">ID da Conta de Anúncio</Label>
                  <Input
                    placeholder="act_123456789"
                    value={instance.ad_account_id || ''}
                    onChange={(e) => handleFieldChange(instance.id, 'ad_account_id', e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nome da Conta</Label>
                  <Input
                    placeholder="Nome identificador"
                    value={instance.ad_account_name || ''}
                    onChange={(e) => handleFieldChange(instance.id, 'ad_account_name', e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSave(instance)}
                disabled={saving === instance.id}
                className="h-7 text-xs"
              >
                <Save className="h-3 w-3 mr-1" />
                {saving === instance.id ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        ))}

        {instances.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma instância configurada. Adicione instâncias na configuração do WhatsApp.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
