import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Users, Briefcase, Scale, FileText, ExternalLink, MessageSquare, UsersRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { Lead } from '@/hooks/useLeads';
import type { GapItem, GapType } from '../hooks/useOperationalGaps';

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
  onOpenChat?: (phone: string, instanceName?: string, contactName?: string) => void;
}

export function GapDetailSheet({ open, onClose, gapType, items, onOpenChat }: Props) {
  const cfg = gapConfig[gapType];
  const Icon = cfg.icon;
  const navigate = useNavigate();
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [showLeadEdit, setShowLeadEdit] = useState(false);

  const handleOpenLead = async (leadId: string) => {
    if (!leadId) return;
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (data) {
      setEditingLead(data as Lead);
      setShowLeadEdit(true);
    }
  };

  const handleOpenChat = (phone: string, instanceName?: string, contactName?: string) => {
    if (!phone) return;
    onClose();
    if (onOpenChat) {
      onOpenChat(phone, instanceName, contactName);
    } else {
      const params = new URLSearchParams({ phone });
      if (instanceName) params.set('instance', instanceName);
      navigate(`/whatsapp?${params.toString()}`);
    }
  };

  return (
    <>
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
                  <div key={item.id} className="p-3 rounded-lg border bg-card space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate flex-1">{item.name}</p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                        {format(parseISO(item.created_at), 'dd/MM HH:mm')}
                      </span>
                    </div>
                    {item.acolhedor && (
                      <p className="text-xs text-muted-foreground">👑 {item.acolhedor}</p>
                    )}
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      {item.lead_id && (
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleOpenLead(item.lead_id!)}>
                          <ExternalLink className="h-3 w-3" /> Abrir Lead
                        </Button>
                      )}
                      {item.whatsapp_phone && (
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleOpenChat(item.whatsapp_phone!, undefined, item.name)}>
                          <MessageSquare className="h-3 w-3" /> Chat
                        </Button>
                      )}
                      {item.whatsapp_group_id && (
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 border-cyan-200/50 text-cyan-600" onClick={() => handleOpenChat(item.whatsapp_group_id!, undefined, item.name)}>
                          <UsersRound className="h-3 w-3" /> Grupo
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {editingLead && (
        <LeadEditDialog
          open={showLeadEdit}
          onOpenChange={(open) => {
            setShowLeadEdit(open);
            if (!open) setEditingLead(null);
          }}
          lead={editingLead}
          onSave={async (leadId, updates) => {
            await supabase.from('leads').update(updates).eq('id', leadId);
            setShowLeadEdit(false);
            setEditingLead(null);
          }}
          mode="sheet"
        />
      )}
    </>
  );
}
