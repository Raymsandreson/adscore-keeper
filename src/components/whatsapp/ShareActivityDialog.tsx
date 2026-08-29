/**
 * "Compartilhar ATV" do menu de anexo — o lugar do "Evento" do app do
 * WhatsApp: escolhe uma atividade do lead vinculado e envia o resumo dela
 * como mensagem de texto na conversa (sem action nova no backend).
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { db } from '@/integrations/supabase';
import { AttachSendTarget, sendWhatsAppText } from '@/lib/whatsappAttachSend';

interface ActivityOption {
  id: string;
  title: string | null;
  activity_type: string | null;
  status: string | null;
  deadline: string | null;
  created_at: string;
  assigned_to_name: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

function buildActivityMessage(a: ActivityOption): string {
  const lines = [`📋 *${a.title || 'Atividade'}*`];
  const meta: string[] = [];
  if (a.activity_type) meta.push(a.activity_type);
  if (a.status) meta.push(STATUS_LABEL[a.status] || a.status);
  if (meta.length) lines.push(meta.join(' • '));
  if (a.deadline) {
    try {
      lines.push(`Prazo: ${format(new Date(a.deadline), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`);
    } catch {
      lines.push(`Prazo: ${a.deadline}`);
    }
  }
  if (a.assigned_to_name) lines.push(`Responsável: ${a.assigned_to_name}`);
  return lines.join('\n');
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AttachSendTarget;
  onSent?: (info: { messageText: string; messageType: 'text' }) => void;
}

export function ShareActivityDialog({ open, onOpenChange, target, onSent }: Props) {
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSendingId(null);
      return;
    }
    if (!target.leadId) {
      setActivities([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (db as any)
      .from('lead_activities')
      .select('id, title, activity_type, status, deadline, created_at, assigned_to_name')
      .eq('lead_id', target.leadId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data, error }: { data: ActivityOption[] | null; error: unknown }) => {
        if (cancelled) return;
        if (error) {
          console.error('[ShareActivityDialog] carga falhou', error);
          toast.error('Erro ao carregar atividades');
          setActivities([]);
        } else {
          setActivities(data || []);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target.leadId]);

  const handleShare = async (a: ActivityOption) => {
    if (sendingId) return;
    setSendingId(a.id);
    try {
      const message = buildActivityMessage(a);
      await sendWhatsAppText(target, message);
      toast.success('Atividade compartilhada!');
      onSent?.({ messageText: message, messageType: 'text' });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[ShareActivityDialog] envio falhou', e);
      toast.error('Erro ao compartilhar atividade: ' + (e?.message || 'Erro desconhecido'));
    } finally {
      setSendingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> Compartilhar atividade
          </DialogTitle>
        </DialogHeader>
        {!target.leadId ? (
          <p className="py-4 text-sm text-muted-foreground">
            Esta conversa ainda não tem lead vinculado — vincule um lead pra compartilhar as atividades dele.
          </p>
        ) : loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando atividades...
          </div>
        ) : activities.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nenhuma atividade encontrada pra este lead.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
            {activities.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={!!sendingId}
                onClick={() => handleShare(a)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
              >
                {sendingId === a.id ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.title || '(sem título)'}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[a.status ? STATUS_LABEL[a.status] || a.status : null,
                      a.deadline ? format(new Date(a.deadline), 'dd/MM/yyyy', { locale: ptBR }) : null,
                      a.assigned_to_name]
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
