import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

interface Instance {
  id: string;
  instance_name: string;
  owner_phone: string | null;
}

interface Board {
  id: string;
  name: string;
}

export function BoardGroupInstancesConfig() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string>('');
  const [linkedInstances, setLinkedInstances] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedBoard) fetchLinked();
  }, [selectedBoard]);

  const fetchData = async () => {
    setLoading(true);
    const boardsRes = await (supabase as any).from('kanban_boards').select('id, name').order('display_order');
    const instancesRes = await (supabase as any).from('whatsapp_instances').select('id, instance_name, owner_phone').eq('is_active', true);
    setBoards((boardsRes.data as any[]) || []);
    setInstances((instancesRes.data as any[]) || []);
    if (boardsRes.data && boardsRes.data.length > 0) {
      setSelectedBoard(boardsRes.data[0].id);
    }
    setLoading(false);
  };

  const fetchLinked = async () => {
    const { data } = await (supabase as any)
      .from('board_group_instances')
      .select('instance_id')
      .eq('board_id', selectedBoard);
    setLinkedInstances((data || []).map((d: any) => d.instance_id));
  };

  const toggleInstance = async (instanceId: string) => {
    setSaving(true);
    try {
      if (linkedInstances.includes(instanceId)) {
        await (supabase as any)
          .from('board_group_instances')
          .delete()
          .eq('board_id', selectedBoard)
          .eq('instance_id', instanceId);
        setLinkedInstances(prev => prev.filter(id => id !== instanceId));
      } else {
        await (supabase as any)
          .from('board_group_instances')
          .insert({ board_id: selectedBoard, instance_id: instanceId });
        setLinkedInstances(prev => [...prev, instanceId]);
      }
      toast.success('Configuração atualizada');
    } catch (e: any) {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-sm">Instâncias para Criação de Grupo</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Configure quais instâncias do WhatsApp serão automaticamente adicionadas aos grupos criados para leads de cada funil.
      </p>

      <Select value={selectedBoard} onValueChange={setSelectedBoard}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecione um funil" />
        </SelectTrigger>
        <SelectContent>
          {boards.map(b => (
            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedBoard && (
        <div className="space-y-2 mt-3">
          {instances.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma instância ativa encontrada.</p>
          ) : (
            instances.map(inst => (
              <label key={inst.id} className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors">
                <Checkbox
                  checked={linkedInstances.includes(inst.id)}
                  onCheckedChange={() => toggleInstance(inst.id)}
                  disabled={saving}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inst.instance_name}</p>
                  {inst.owner_phone && (
                    <p className="text-[11px] text-muted-foreground">{inst.owner_phone}</p>
                  )}
                </div>
                {linkedInstances.includes(inst.id) && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">Incluída</Badge>
                )}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
