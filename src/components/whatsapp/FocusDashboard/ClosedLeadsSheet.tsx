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

const ACTIONS_WIDTH = 142; // trilha visível com 3 losangos encaixados

interface SwipeableLeadRowProps {
  lead: ClosedLeadItem;
  acts: ClosedLeadActivity[];
  pending: ClosedLeadActivity[];
  done: ClosedLeadActivity[];
  todayStr: string;
  hasOverdueActivity: boolean;
  chatTarget: string | null | undefined;
  chatTitle: string;
  activityBtnClass: string;
  onOpenLead: () => void;
  onOpenChat: () => void;
}

function SwipeableLeadRow({
  lead, acts, pending, done, todayStr, hasOverdueActivity,
  chatTarget, chatTitle, activityBtnClass, onOpenLead, onOpenChat,
}: SwipeableLeadRowProps) {
  const offsetRef = useRef(0);
  const actionsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startOffset: number; moved: boolean; axis: 'x' | 'y' | null } | null>(null);
  const [actsOpen, setActsOpen] = useState(false);

  const setRevealOffset = (next: number, animated = false) => {
    const clamped = Math.max(0, Math.min(ACTIONS_WIDTH, next));
    const progress = clamped / ACTIONS_WIDTH;
    offsetRef.current = clamped;

    const rail = actionsRef.current;
    if (!rail) return;

    rail.style.transition = animated ? 'width 160ms ease, opacity 160ms ease' : 'none';
    rail.style.width = `${clamped}px`;
    rail.style.opacity = progress > 0 ? String(Math.max(0.22, progress)) : '0';
    rail.style.pointerEvents = clamped > ACTIONS_WIDTH * 0.72 ? 'auto' : 'none';
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offsetRef.current, moved: false, axis: null };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.axis) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'y') { dragRef.current = null; return; }
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      drag.moved = true;
    }
    if (drag.axis === 'x') {
      e.preventDefault();
      const next = Math.max(0, Math.min(ACTIONS_WIDTH, drag.startOffset - dx));
      setRevealOffset(next);
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setRevealOffset(offsetRef.current > ACTIONS_WIDTH / 3 ? ACTIONS_WIDTH : 0, true);
    }
  };

  const closeAndRun = (fn: () => void) => {
    setRevealOffset(0);
    fn();
  };

  return (
    <div className="relative rounded-lg overflow-hidden">
      {/* Trilha colorida revelada por baixo */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-3" style={{ width: ACTIONS_WIDTH }}>
        <button
          type="button"
          onClick={() => closeAndRun(onOpenLead)}
          className="h-10 w-10 rotate-45 flex items-center justify-center bg-primary/60 text-primary-foreground ring-1 ring-primary-foreground/20 backdrop-blur-sm transition-transform active:scale-95"
          title="Abrir lead"
          aria-label="Abrir lead"
        >
          <ExternalLink className="h-4 w-4 -rotate-45" />
        </button>
        <button
          type="button"
          disabled={!chatTarget}
          onClick={() => closeAndRun(onOpenChat)}
          className="-ml-3 h-10 w-10 rotate-45 flex items-center justify-center bg-success/60 text-success-foreground ring-1 ring-success-foreground/20 backdrop-blur-sm transition-transform active:scale-95 disabled:opacity-40"
          title={chatTitle}
          aria-label={chatTitle}
        >
          <MessageCircle className="h-4 w-4 -rotate-45" />
        </button>
        <Popover open={actsOpen} onOpenChange={setActsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`-ml-3 h-10 w-10 rotate-45 flex items-center justify-center ring-1 backdrop-blur-sm transition-transform active:scale-95 ${
                pending.length === 0 ? 'bg-muted/60 text-muted-foreground ring-border'
                  : activityBtnClass.includes('destructive') ? 'bg-destructive/60 text-destructive-foreground ring-destructive-foreground/20'
                  : 'bg-warning/60 text-warning-foreground ring-warning-foreground/20'
              }`}
              title={`${pending.length} pendente(s) · ${done.length} concluída(s)`}
              aria-label={`${pending.length} atividade(s) pendente(s)`}
            >
              <ListChecks className="h-4 w-4 -rotate-45" />
            </button>
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

      {/* Linha do lead que desliza */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ transform: `translateX(-${offset}px)`, transition: dragRef.current ? 'none' : 'transform 200ms ease' }}
        className={`relative p-2 border touch-pan-y select-none cursor-grab active:cursor-grabbing ${
          hasOverdueActivity
            ? 'border-destructive/40 bg-destructive/10'
            : 'bg-card'
        }`}
        title={hasOverdueActivity ? 'Lead com atividade atrasada · arraste pra esquerda' : 'Arraste pra esquerda pra revelar atalhos'}
      >
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <User className="h-3 w-3 text-muted-foreground shrink-0" />
            <span
              className={`font-medium text-sm truncate min-w-0 flex-1 ${hasOverdueActivity ? 'text-destructive' : ''}`}
              title={lead.lead_name || 'Sem nome'}
            >
              {lead.lead_name || 'Sem nome'}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap pr-1">
            {lead.lead_phone && <span>📞 {lead.lead_phone}</span>}
            {lead.acolhedor && <span>· {lead.acolhedor}</span>}
            {lead.became_client_date && (
              <span>· {format(new Date(lead.became_client_date + 'T00:00:00'), 'dd/MM', { locale: ptBR })}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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

