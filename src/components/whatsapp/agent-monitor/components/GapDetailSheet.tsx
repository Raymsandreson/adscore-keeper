import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import type { GapItem, GapType } from '../hooks/useOperationalGaps';
import { AlertTriangle, Users, Briefcase, Scale, FileText } from 'lucide-react';

const gapConfig: Record<GapType, { title: string; icon: typeof AlertTriangle; color: string; desc: string }> = {
  closedWithoutGroup: { title: 'Fechados sem Grupo', icon: Users, color: 'text-red-500', desc: 'Leads fechados que ainda não possuem grupo de WhatsApp' },
  withGroupWithoutCase: { title: 'Com Grupo sem Caso', icon: Briefcase, color: 'text-amber-500', desc: 'Leads com grupo criado mas sem caso jurídico cadastrado' },
  casesWithoutProcess: { title: 'Casos sem Processo', icon: Scale, color: 'text-orange-500', desc: 'Casos criados que não possuem processos vinculados' },
  processesWithoutActivity: { title: 'Processos sem Atividade', icon: FileText, color: 'text-rose-500', desc: 'Processos sem nenhuma atividade registrada' },
};

interface Props {
  open: boolean;
  onClose: () => void;
  gapType: GapType;
  items: GapItem[];
}

export function GapDetailSheet({ open, onClose, gapType, items }: Props) {
  const cfg = gapConfig[gapType];
  const Icon = cfg.icon;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${cfg.color}`} />
            {cfg.title}
            <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{cfg.desc}</p>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-120px)] mt-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum item encontrado ✅</p>
          ) : (
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.acolhedor && (
                      <p className="text-xs text-muted-foreground">👑 {item.acolhedor}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                    {format(parseISO(item.created_at), 'dd/MM HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
