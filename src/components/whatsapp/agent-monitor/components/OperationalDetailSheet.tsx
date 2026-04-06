import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FileSignature, Users, Briefcase, Scale } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay, format, parseISO } from 'date-fns';

export type OperationalMetricType = 'signed_docs' | 'groups' | 'cases' | 'processes';

interface Props {
  open: boolean;
  onClose: () => void;
  metricType: OperationalMetricType;
  dateRange: { from: Date; to: Date };
}

const config: Record<OperationalMetricType, { title: string; icon: typeof FileSignature; color: string }> = {
  signed_docs: { title: 'Documentos Assinados', icon: FileSignature, color: 'text-violet-500' },
  groups: { title: 'Grupos Criados', icon: Users, color: 'text-cyan-500' },
  cases: { title: 'Casos Criados', icon: Briefcase, color: 'text-amber-600' },
  processes: { title: 'Processos Criados', icon: Scale, color: 'text-indigo-500' },
};

export function OperationalDetailSheet({ open, onClose, metricType, dateRange }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    const fetchDetails = async () => {
      setLoading(true);
      const start = startOfDay(dateRange.from).toISOString();
      const end = endOfDay(dateRange.to).toISOString();

      try {
        if (metricType === 'signed_docs') {
          const { data } = await supabase
            .from('zapsign_documents')
            .select('id, document_name, status, signer_name, signer_status, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        } else if (metricType === 'groups') {
          const { data } = await supabase
            .from('leads')
            .select('id, lead_name, whatsapp_group_id, created_at')
            .not('whatsapp_group_id', 'is', null)
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        } else if (metricType === 'cases') {
          const { data } = await supabase
            .from('legal_cases')
            .select('id, case_number, title, status, acolhedor, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        } else if (metricType === 'processes') {
          const { data } = await supabase
            .from('case_process_tracking')
            .select('id, cliente, caso, tipo, acolhedor, status_processo, numero_processo, created_at')
            .gte('created_at', start).lte('created_at', end)
            .order('created_at', { ascending: false });
          setItems(data || []);
        }
      } catch (err) {
        console.error('Error fetching operational details:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [open, metricType, dateRange]);

  const { title, icon: Icon, color } = config[metricType];

  const statusBadge = (status: string | null) => {
    if (!status) return null;
    const map: Record<string, string> = {
      signed: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      em_andamento: 'bg-blue-100 text-blue-700',
      new: 'bg-gray-100 text-gray-600',
    };
    return <Badge className={`text-[9px] ${map[status] || 'bg-muted text-muted-foreground'}`}>{status}</Badge>;
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${color}`} />
            {title}
            <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Nenhum registro no período</div>
        ) : (
          <ScrollArea className="h-[calc(100vh-120px)] mt-4">
            <div className="space-y-2 pr-2">
              {metricType === 'signed_docs' && items.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.document_name || 'Documento'}</p>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.signer_name || '—'}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                  {item.signer_status && item.signer_status !== item.status && (
                    <div className="text-[10px] text-muted-foreground">Assinante: {item.signer_status}</div>
                  )}
                </div>
              ))}

              {metricType === 'groups' && items.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium truncate">{item.lead_name || 'Lead'}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">{item.whatsapp_group_id}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                </div>
              ))}

              {metricType === 'cases' && items.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.case_number} — {item.title || ''}</p>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.acolhedor || '—'}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                </div>
              ))}

              {metricType === 'processes' && items.map(item => (
                <div key={item.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{item.caso || item.cliente || 'Processo'}</p>
                    {statusBadge(item.status_processo)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.tipo || '—'} {item.acolhedor ? `• ${item.acolhedor}` : ''}</span>
                    <span>{format(parseISO(item.created_at), 'HH:mm')}</span>
                  </div>
                  {item.numero_processo && (
                    <p className="text-[10px] text-muted-foreground truncate">Nº {item.numero_processo}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
