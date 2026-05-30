import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Trophy, MessageCircle, User, FileText, ListChecks, CheckCircle2, UsersRound, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db } from '@/integrations/supabase';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import type { Lead } from '@/hooks/useLeads';
import type { ClosedLeadItem, ClosedLeadActivity } from '@/hooks/useFocusDashboardData';

interface MiniContact { id: string; full_name: string; phone: string | null; }


interface LeadRowProps {
  lead: ClosedLeadItem;
  acts: ClosedLeadActivity[];
  pending: ClosedLeadActivity[];
  done: ClosedLeadActivity[];
  todayStr: string;
  hasOverdueActivity: boolean;
  chatTitle: string;
  onOpenLead: () => void;
  onOpenChat: (phone: string, name: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function InlineAction({
  onClick,
  className,
  label,
  icon,
  disabled,
}: {
  onClick: () => void;
  className: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onClick();
      }}
      className={`w-full min-w-0 h-7 flex items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {icon}
      <span className="truncate min-w-0">{label}</span>
    </button>
  );
}

function LeadRow({
  lead, acts, pending, done, todayStr, hasOverdueActivity,
  chatTitle, onOpenLead, onOpenChat, isOpen, onToggle,
}: LeadRowProps) {
  const [actsOpen, setActsOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [contacts, setContacts] = useState<MiniContact[] | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const open = isOpen;

  const groupJid = lead.whatsapp_group_jid || null;
  const leadPhone = lead.lead_phone || null;

  useEffect(() => {
    if (!chatMenuOpen || contacts !== null) return;
    let cancelled = false;
    setLoadingContacts(true);
    (async () => {
      try {
        const { data: linkData } = await supabase
          .from('contact_leads' as any)
          .select('contact_id')
          .eq('lead_id', lead.id);
        const linkIds = ((linkData || []) as any[]).map((l) => l.contact_id);
        const { data: legacyData } = await externalSupabase
          .from('contacts')
          .select('id')
          .eq('lead_id', lead.id);
        const legacyIds = (legacyData || []).map((c: any) => c.id);
        const allIds = Array.from(new Set([...linkIds, ...legacyIds]));
        if (allIds.length === 0) {
          if (!cancelled) setContacts([]);
          return;
        }
        const { data } = await externalSupabase
          .from('contacts')
          .select('id, full_name, phone')
          .in('id', allIds);
        if (!cancelled) setContacts((data || []) as MiniContact[]);
      } catch (e) {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setLoadingContacts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chatMenuOpen, contacts, lead.id]);

  const hasAnyChat = !!groupJid || !!leadPhone || (contacts?.some((c) => c.phone) ?? true);

  const overdueCount = pending.filter((a) => a.deadline && a.deadline < todayStr).length;
  const activityClass = pending.length === 0
    ? 'bg-muted/60 hover:bg-muted text-muted-foreground'
    : overdueCount > 0
      ? 'bg-destructive/15 hover:bg-destructive/25 text-destructive'
      : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-400';


  return (
    <div
      className={`min-w-0 max-w-full rounded-lg border overflow-hidden transition-colors ${
        hasOverdueActivity
          ? 'border-destructive/40 bg-destructive/10'
          : pending.length === 0
            ? 'border-yellow-400/60 bg-yellow-300/20 dark:bg-yellow-500/10'
            : 'bg-card border-border'
      } ${open ? 'ring-1 ring-primary/30' : ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full min-w-0 max-w-full p-2 text-left overflow-hidden"
        aria-expanded={open}
      >
        <div className="min-w-0 max-w-full overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <User className="h-3 w-3 text-muted-foreground shrink-0" />
            <span
              className={`font-medium text-sm truncate min-w-0 flex-1 ${hasOverdueActivity ? 'text-destructive' : ''}`}
              title={lead.lead_name || 'Sem nome'}
            >
              {lead.lead_name || 'Sem nome'}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap pr-1 min-w-0 max-w-full overflow-hidden">
            {lead.lead_phone && <span className="truncate max-w-full">📞 {lead.lead_phone}</span>}
            {lead.acolhedor && <span className="truncate max-w-full">· {lead.acolhedor}</span>}
            {lead.became_client_date && (
              <span>· {format(new Date(lead.became_client_date + 'T00:00:00'), 'dd/MM', { locale: ptBR })}</span>
            )}
          </div>
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-3 gap-1 px-2 pb-2 pt-1 border-t border-border/40 w-1/2 max-w-[260px] mr-auto overflow-hidden">
            <InlineAction
              onClick={onOpenLead}
              label="Lead"
              icon={<FileText className="h-3 w-3 shrink-0" />}
              className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400"
            />
            <Popover open={chatMenuOpen} onOpenChange={setChatMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setChatMenuOpen(true); }}
                  disabled={!hasAnyChat}
                  title={chatTitle}
                  className="w-full min-w-0 h-7 flex items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="h-3 w-3 shrink-0" />
                  <span className="truncate">Chat</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs font-medium mb-1">Abrir conversa</div>
                <div className="space-y-1">
                  {groupJid && (
                    <button
                      type="button"
                      onClick={() => { setChatMenuOpen(false); onOpenChat(groupJid, lead.lead_name); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted text-left"
                    >
                      <UsersRound className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate">Grupo do lead</span>
                    </button>
                  )}
                  {leadPhone && (
                    <button
                      type="button"
                      onClick={() => { setChatMenuOpen(false); onOpenChat(leadPhone, lead.lead_name); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted text-left"
                    >
                      <Phone className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                      <span className="truncate">{lead.lead_name || 'Lead'} · {leadPhone}</span>
                    </button>
                  )}
                  {loadingContacts && (
                    <div className="text-[11px] text-muted-foreground px-2 py-1">Carregando contatos…</div>
                  )}
                  {contacts?.filter((c) => c.phone && c.phone !== leadPhone).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setChatMenuOpen(false); onOpenChat(c.phone!, c.full_name); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted text-left"
                    >
                      <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.full_name} · {c.phone}</span>
                    </button>
                  ))}
                  {!loadingContacts && !groupJid && !leadPhone && (contacts?.length ?? 0) === 0 && (
                    <div className="text-[11px] text-muted-foreground px-2 py-2 text-center">Nenhum chat disponível.</div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={actsOpen} onOpenChange={setActsOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActsOpen(true); }}
                  title={chatTitle}
                  className={`w-full min-w-0 h-7 flex items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors ${activityClass}`}
                >
                  <ListChecks className="h-3 w-3 shrink-0" />
                  <span className="truncate">Atvs{pending.length > 0 ? `·${pending.length}` : ''}</span>
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
                                : 'border-primary/40 bg-primary/10 text-primary'
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
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);



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
          className="!max-w-none !w-full sm:!w-[560px] sm:!max-w-[calc(100vw_-_24px)] p-0 flex flex-col overflow-hidden"
        >

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

          <ScrollArea className="flex-1 min-w-0 overflow-x-hidden">
            <div className="p-2 min-w-0 max-w-full overflow-x-hidden">
              {sorted.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Nenhum lead fechado neste período.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sorted.map((lead) => {
                    const hasOverdueActivity = !!lead.has_overdue_activity;
                    const chatTitle = lead.whatsapp_group_jid
                      ? 'Abrir conversa do grupo ou contatos'
                      : lead.lead_phone
                        ? 'Abrir conversa do contato'
                        : 'Escolher contato';
                    const acts = lead.activities ?? [];
                    const todayStr = format(new Date(), 'yyyy-MM-dd');
                    const pending = acts.filter((a) => a.status === 'pendente');
                    const done = acts.filter((a) => a.status !== 'pendente');

                    return (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        acts={acts}
                        pending={pending}
                        done={done}
                        todayStr={todayStr}
                        hasOverdueActivity={hasOverdueActivity}
                        chatTitle={chatTitle}
                        onOpenLead={() => handleOpenLead(lead.id)}
                        onOpenChat={(phone, name) => setChatPreview({ phone, name })}
                        isOpen={openLeadId === lead.id}
                        onToggle={() => setOpenLeadId((cur) => (cur === lead.id ? null : lead.id))}
                      />
                    );
                  })}
                </div>
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

