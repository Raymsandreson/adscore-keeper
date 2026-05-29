import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Trophy, MessageCircle, User, ExternalLink, ListChecks, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db } from '@/integrations/supabase';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import type { Lead } from '@/hooks/useLeads';
import type { ClosedLeadItem, ClosedLeadActivity } from '@/hooks/useFocusDashboardData';

const PANEL_MIN_WIDTH = 360;
const PANEL_DEFAULT_WIDTH = 560;
const PANEL_MAX_WIDTH = 920;

const getPanelMaxWidth = () => {
  if (typeof window === 'undefined') return PANEL_MAX_WIDTH;
  return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, window.innerWidth - 24));
};

const clampPanelWidth = (width: number) => Math.min(getPanelMaxWidth(), Math.max(PANEL_MIN_WIDTH, width));

interface ClosedLeadsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closedLeads: ClosedLeadItem[];
  periodLabel: string;
  onOpenChat: (phone: string) => void;
}

export function ClosedLeadsSheet({ open, onOpenChange, closedLeads, periodLabel, onOpenChat }: ClosedLeadsSheetProps) {
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [showLeadEdit, setShowLeadEdit] = useState(false);
  const [chatPreview, setChatPreview] = useState<{ phone: string; name: string | null } | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const stored = localStorage.getItem('closed_leads_sheet_width');
      if (stored) return clampPanelWidth(parseInt(stored, 10));
    } catch {
      // localStorage pode estar indisponível em alguns navegadores privados.
    }
    return clampPanelWidth(PANEL_DEFAULT_WIDTH);
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const panelWidthRef = useRef(panelWidth);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    const onResize = () => setPanelWidth((width) => clampPanelWidth(width));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sorted = [...closedLeads].sort((a, b) => {
    const da = a.became_client_date || '';
    const db = b.became_client_date || '';
    return db.localeCompare(da);
  });

  const handleOpenLead = async (leadId: string) => {
    const { data } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (data) {
      setEditingLead(data as Lead);
      setShowLeadEdit(true);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="!max-w-none p-0 flex flex-col overflow-hidden"
          style={{ width: panelWidth }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar aba de fechados"
            title="Arraste para aumentar ou diminuir • duplo clique reseta"
            onPointerDown={(e) => {
              dragRef.current = { startX: e.clientX, startW: panelWidth };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            onPointerMove={(e) => {
              const drag = dragRef.current;
              if (!drag) return;
              setPanelWidth(clampPanelWidth(drag.startW + (drag.startX - e.clientX)));
            }}
            onPointerUp={(e) => {
              dragRef.current = null;
              try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {
                // O navegador pode liberar o ponteiro antes do evento final.
              }
              document.body.style.cursor = '';
              document.body.style.userSelect = '';
              try { localStorage.setItem('closed_leads_sheet_width', String(Math.round(panelWidthRef.current))); } catch {
                // Persistência é opcional; a largura atual continua funcionando.
              }
            }}
            onDoubleClick={() => {
              const next = clampPanelWidth(PANEL_DEFAULT_WIDTH);
              setPanelWidth(next);
              try { localStorage.setItem('closed_leads_sheet_width', String(next)); } catch {
                // Persistência é opcional; a largura atual continua funcionando.
              }
            }}
            className="absolute left-0 top-0 bottom-0 z-30 w-2 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
          />
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-emerald-600" />
              Fechados · {periodLabel}
              <span className="text-xs font-normal text-muted-foreground">({sorted.length})</span>
            </SheetTitle>
            <SheetDescription className="text-xs">
              Leads que viraram cliente no período. Use os atalhos pra abrir o lead ou a conversa.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sorted.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Nenhum lead fechado neste período.
                </div>
              ) : (
                sorted.map((lead) => {
                  const hasOverdueActivity = !!lead.has_overdue_activity;
                  const chatTarget = lead.whatsapp_group_jid || lead.lead_phone;
                  const chatTitle = lead.whatsapp_group_jid
                    ? 'Abrir conversa do grupo'
                    : lead.lead_phone
                      ? 'Abrir conversa do contato'
                      : 'Sem grupo nem telefone';
                  const acts = lead.activities ?? [];
                  const todayStr = format(new Date(), 'yyyy-MM-dd');
                  const pending = acts.filter((a) => a.status === 'pendente');
                  const done = acts.filter((a) => a.status !== 'pendente');
                  const overdueCount = pending.filter((a) => a.deadline && a.deadline < todayStr).length;
                  const activityBtnClass = pending.length === 0
                    ? 'text-muted-foreground'
                    : overdueCount > 0
                      ? 'text-destructive border-destructive/40'
                      : 'text-sky-600 border-sky-500/40';

                  return (
                    <SwipeableLeadRow
                      key={lead.id}
                      lead={lead}
                      acts={acts}
                      pending={pending}
                      done={done}
                      todayStr={todayStr}
                      hasOverdueActivity={hasOverdueActivity}
                      chatTarget={chatTarget}
                      chatTitle={chatTitle}
                      activityBtnClass={activityBtnClass}
                      onOpenLead={() => handleOpenLead(lead.id)}
                      onOpenChat={() => chatTarget && setChatPreview({ phone: chatTarget, name: lead.lead_name })}
                    />
                  );
                })
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {editingLead && (
        <LeadEditDialog
          open={showLeadEdit}
          onOpenChange={(o) => {
            setShowLeadEdit(o);
            if (!o) setEditingLead(null);
          }}
          lead={editingLead}
          onSave={async (leadId, updates) => {
            await db.from('leads').update(updates).eq('id', leadId);
            setShowLeadEdit(false);
            setEditingLead(null);
          }}
          mode="sheet"
        />
      )}

      <DashboardChatPreview
        open={!!chatPreview}
        onOpenChange={(o) => !o && setChatPreview(null)}
        phone={chatPreview?.phone ?? null}
        contactName={chatPreview?.name ?? null}
        instanceName={null}
        hasLead={true}
        hasContact={false}
        wasResponded={true}
        responseTimeMinutes={null}
        onOpenChat={(phone) => {
          setChatPreview(null);
          onOpenChat(phone);
          onOpenChange(false);
        }}
      />
    </>
  );
}

