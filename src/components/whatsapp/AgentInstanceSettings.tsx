import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

interface Instance {
  id: string;
  instance_name: string;
  owner_name: string | null;
  is_active: boolean;
}

interface Setting {
  id: string;
  instance_id: string;
  is_enabled: boolean;
}

interface Props {
  agentId: string;
}

export function AgentInstanceSettings({ agentId }: Props) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [agentId]);

  const fetchData = async () => {
    setLoading(true);
    const [instRes, settRes] = await Promise.all([
      supabase.from('whatsapp_instances').select('id, instance_name, owner_name, is_active').eq('is_active', true).order('instance_name'),
      supabase.from('agent_instance_settings').select('id, instance_id, is_enabled').eq('agent_id', agentId),
    ]);
    setInstances((instRes.data || []) as Instance[]);
    setSettings((settRes.data || []) as Setting[]);
    setLoading(false);
  };

  const handleToggle = async (instanceId: string, currentEnabled: boolean) => {
    setToggling(instanceId);
    try {
      const existing = settings.find(s => s.instance_id === instanceId);
      if (existing) {
        const { error } = await supabase
          .from('agent_instance_settings')
          .update({ is_enabled: !currentEnabled } as any)
          .eq('id', existing.id);
        if (error) throw error;
        setSettings(prev => prev.map(s => s.id === existing.id ? { ...s, is_enabled: !currentEnabled } : s));
      } else {
        const { data, error } = await supabase
          .from('agent_instance_settings')
          .insert({ agent_id: agentId, instance_id: instanceId, is_enabled: true } as any)
          .select('id, instance_id, is_enabled')
          .single();
        if (error) throw error;
        setSettings(prev => [...prev, data as Setting]);
      }
      toast.success('Configuração atualizada');
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || ''));
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (instances.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-3">Nenhuma instância ativa</p>;
  }

  return (
    <div className="space-y-1.5">
      {instances.map(inst => {
        const setting = settings.find(s => s.instance_id === inst.id);
        const isEnabled = setting?.is_enabled ?? false;
        return (
          <div key={inst.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50">
            <div className="flex items-center gap-2 min-w-0">
              <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{inst.instance_name}</p>
                {inst.owner_name && (
                  <p className="text-[10px] text-muted-foreground truncate">{inst.owner_name}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isEnabled && <Badge variant="default" className="text-[9px] h-4 px-1 bg-emerald-600">Ativo</Badge>}
              {toggling === inst.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Switch
                  checked={isEnabled}
                  onCheckedChange={() => handleToggle(inst.id, isEnabled)}
                  className="scale-75"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
