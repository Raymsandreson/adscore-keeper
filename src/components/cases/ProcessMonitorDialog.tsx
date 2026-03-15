import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BellRing, Plus, Trash2, Loader2, Phone, Clock } from 'lucide-react';

interface ProcessMonitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processId: string;
  processNumber: string;
  processTitle: string;
}

interface Monitor {
  id: string;
  phone: string;
  is_active: boolean;
  notify_via_audio: boolean;
  last_checked_at: string | null;
  last_notified_at: string | null;
  last_movement_count: number;
  contact_id: string | null;
}

export function ProcessMonitorDialog({ open, onOpenChange, processId, processNumber, processTitle }: ProcessMonitorDialogProps) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchMonitors = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('process_movement_monitors')
      .select('*')
      .eq('process_id', processId)
      .order('created_at', { ascending: true });
    setMonitors((data || []) as Monitor[]);
    setLoading(false);
  }, [processId]);

  useEffect(() => {
    if (open) fetchMonitors();
  }, [open, fetchMonitors]);

  const addMonitor = async () => {
    if (!newPhone.trim()) return;
    const phone = newPhone.replace(/\D/g, '');
    if (phone.length < 10) {
      toast.error('Número inválido');
      return;
    }
    setAdding(true);
    try {
      // Get current movement count
      const { data: proc } = await supabase
        .from('lead_processes')
        .select('movimentacoes')
        .eq('id', processId)
        .single();
      
      const movCount = Array.isArray((proc as any)?.movimentacoes) ? ((proc as any).movimentacoes as any[]).length : 0;

      const { error } = await supabase.from('process_movement_monitors').insert({
        process_id: processId,
        phone: phone,
        is_active: true,
        last_movement_count: movCount,
      } as any);

      if (error) {
        if (error.code === '23505') {
          toast.error('Este número já está monitorando este processo');
        } else {
          throw error;
        }
      } else {
        toast.success('Monitor adicionado com sucesso');
        setNewPhone('');
        fetchMonitors();
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao adicionar monitor');
    } finally {
      setAdding(false);
    }
  };

  const toggleMonitor = async (id: string, isActive: boolean) => {
    await supabase
      .from('process_movement_monitors')
      .update({ is_active: !isActive })
      .eq('id', id);
    fetchMonitors();
  };

  const toggleAudio = async (id: string, current: boolean) => {
    await supabase
      .from('process_movement_monitors')
      .update({ notify_via_audio: !current })
      .eq('id', id);
    fetchMonitors();
  };

  const removeMonitor = async (id: string) => {
    await supabase.from('process_movement_monitors').delete().eq('id', id);
    toast.success('Monitor removido');
    fetchMonitors();
  };

  const formatPhone = (phone: string) => {
    if (phone.length === 11) return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
    if (phone.length === 13) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    return phone;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <BellRing className="h-4 w-4 text-emerald-500" />
            Notificações de Movimentação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <p><strong>Processo:</strong> {processNumber}</p>
            {processTitle && <p><strong>Título:</strong> {processTitle}</p>}
          </div>

          <p className="text-xs text-muted-foreground">
            Adicione números de WhatsApp para receber notificações automáticas quando houver novas movimentações neste processo.
          </p>

          {/* Add new monitor */}
          <div className="flex gap-2">
            <Input
              className="h-8 text-xs flex-1"
              placeholder="Número WhatsApp (ex: 5511999998888)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMonitor()}
            />
            <Button size="sm" className="h-8 text-xs" onClick={addMonitor} disabled={adding}>
              {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            </Button>
          </div>

          {/* Monitors list */}
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : monitors.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              Nenhum destinatário cadastrado.
            </p>
          ) : (
            <div className="space-y-2 max-h-[250px] overflow-y-auto">
              {monitors.map((m) => (
                <div key={m.id} className="border rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-medium">{formatPhone(m.phone)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={m.is_active}
                        onCheckedChange={() => toggleMonitor(m.id, m.is_active)}
                        className="scale-75"
                      />
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => removeMonitor(m.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <Badge variant={m.is_active ? 'default' : 'secondary'} className="text-[9px] h-4">
                      {m.is_active ? 'Ativo' : 'Pausado'}
                    </Badge>
                    {m.last_checked_at && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        Última verificação: {new Date(m.last_checked_at).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
            💡 O sistema verifica automaticamente novas movimentações no Escavador e envia uma mensagem no WhatsApp com o resumo das novidades.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
