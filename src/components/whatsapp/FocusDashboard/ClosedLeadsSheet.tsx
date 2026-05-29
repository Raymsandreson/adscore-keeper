import { useEffect, useRef, useState } from 'react';
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
                  <div
                    key={lead.id}
                    className={`group relative p-2 pr-3 rounded-lg border transition-colors overflow-hidden ${
                      hasOverdueActivity
                        ? 'border-destructive/40 bg-destructive/10 hover:bg-destructive/15'
                        : 'bg-card hover:bg-accent/50'
                    }`}
                    title={hasOverdueActivity ? 'Lead com atividade atrasada' : undefined}
                  >
                    <div className="min-w-0 overflow-hidden group-hover:pr-28 transition-[padding]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <User className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span
                          className={`font-medium text-sm truncate min-w-0 flex-1 ${hasOverdueActivity ? 'text-destructive' : ''}`}
                          title={lead.lead_name || 'Sem nome'}
                        >
                          {lead.lead_name || 'Sem nome'}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                        {lead.lead_phone && <span>📞 {lead.lead_phone}</span>}
                        {lead.acolhedor && <span>· {lead.acolhedor}</span>}
                        {lead.became_client_date && (
                          <span>· {format(new Date(lead.became_client_date + 'T00:00:00'), 'dd/MM', { locale: ptBR })}</span>
                        )}
                      </div>
                    </div>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity bg-card/95 pl-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0 shadow-sm"
                        title="Abrir lead"
                        onClick={() => handleOpenLead(lead.id)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0 shadow-sm disabled:opacity-40"
                        title={chatTitle}
                        disabled={!chatTarget}
                        onClick={() => chatTarget && setChatPreview({ phone: chatTarget, name: lead.lead_name })}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`h-8 w-8 p-0 shadow-sm ${activityBtnClass}`}
                            title={`${pending.length} pendente(s) · ${done.length} concluída(s)`}
                          >
                            <ListChecks className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-72 p-2">
                          <div className="text-xs font-medium mb-1">Atividades</div>
                          {acts.length === 0 ? (
                            <div className="text-xs text-muted-foreground py-2 text-center">Nenhuma atividade.</div>
                          ) : (
                            <ScrollArea className="max-h-72">
                              <div className="space-y-1 pr-2">
                                {pending.map((a) => {
                                  const isOverdue = !!a.deadline && a.deadline < todayStr;
                                  return (
                                    <div
                                      key={a.id}
                                      className={`text-[11px] px-2 py-1 rounded border ${
                                        isOverdue
                                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                          : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                      }`}
                                    >
                                      <div className="font-medium truncate" title={a.title || ''}>{a.title || 'Sem título'}</div>
                                      {a.deadline && (
                                        <div className="opacity-70">
                                          {format(new Date(a.deadline + 'T00:00:00'), 'dd/MM', { locale: ptBR })}
                                          {isOverdue ? ' · atrasada' : ''}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {done.map((a) => (
                                  <div
                                    key={a.id}
                                    className="text-[11px] px-2 py-1 rounded border border-muted bg-muted/40 text-muted-foreground flex items-center gap-1.5"
                                  >
                                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                                    <span className="truncate line-through" title={a.title || ''}>{a.title || 'Sem título'}</span>
                                  </div>
                                ))}
                              </div>
                            </ScrollArea>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
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

