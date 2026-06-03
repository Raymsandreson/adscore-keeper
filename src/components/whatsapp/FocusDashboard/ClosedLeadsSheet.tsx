import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trophy, MessageCircle, User, FileText, ListChecks, CheckCircle2, UsersRound, Phone, CalendarCheck, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db } from '@/integrations/supabase';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import { toast } from '@/hooks/use-toast';
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
            <span className={`truncate max-w-full ${lead.acolhedor ? 'text-foreground font-medium' : 'italic text-muted-foreground/70'}`}>
              · 👤 {lead.acolhedor || 'Sem acolhedor'}
            </span>
            {lead.closed_at ? (
              <span>· {new Date(lead.closed_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            ) : lead.became_client_date && (
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
  const [chatPreview, setChatPreview] = useState<{ phone: string; name: string | null; instanceName: string | null } | null>(null);

  // Descobre a instância que conversa com esse telefone (chave de identidade no WhatsApp).
  // Tenta variantes do número (com/sem 9º dígito) porque o banco pode ter qualquer forma.
  useEffect(() => {
    if (!chatPreview || chatPreview.instanceName) return;
    const phone = chatPreview.phone;
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return;
    const variants = new Set<string>([phone, digits]);
    // BR: alterna 9º dígito após DDD (posições 4 e 5)
    if (/^55\d{10,11}$/.test(digits)) {
      if (digits.length === 13 && digits[4] === '9') {
        variants.add(digits.slice(0, 4) + digits.slice(5));
      } else if (digits.length === 12) {
        variants.add(digits.slice(0, 4) + '9' + digits.slice(4));
      }
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (db as any)
          .from('whatsapp_messages')
          .select('instance_name, created_at')
          .in('phone', Array.from(variants))
          .not('instance_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        const inst = (data as any)?.instance_name ?? null;
        if (inst) setChatPreview((cur) => (cur && cur.phone === phone ? { ...cur, instanceName: inst } : cur));
      } catch {/* ignore */}
    })();
    return () => { cancelled = true; };
  }, [chatPreview?.phone]);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  type PeriodKey = 'manha' | 'tarde' | 'noite' | 'madrugada' | 'semHora';
  const [periodFilter, setPeriodFilter] = useState<PeriodKey | null>(null);
  const [acolhedorFilter, setAcolhedorFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPeriodFilter(null);
      setAcolhedorFilter(null);
    }
  }, [open]);

  const getPeriod = (l: ClosedLeadItem): PeriodKey => {
    if (!l.closed_at) return 'semHora';
    const hourStr = new Date(l.closed_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
    const h = parseInt(hourStr, 10);
    if (h < 7) return 'madrugada';
    if (h < 12) return 'manha';
    if (h < 18) return 'tarde';
    return 'noite';
  };
  const getAcolhedor = (l: ClosedLeadItem) => (l.acolhedor || '').trim() || 'Sem acolhedor';

  const sorted = [...closedLeads].sort((a, b) => {
    const da = a.closed_at || (a.became_client_date ? a.became_client_date + 'T00:00:00' : '');
    const db = b.closed_at || (b.became_client_date ? b.became_client_date + 'T00:00:00' : '');
    return db.localeCompare(da);
  });

  const filtered = sorted.filter((l) => {
    if (periodFilter && getPeriod(l) !== periodFilter) return false;
    if (acolhedorFilter && getAcolhedor(l) !== acolhedorFilter) return false;
    return true;
  });
  const hasFilter = !!periodFilter || !!acolhedorFilter;


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

          <SheetHeader className="px-4 py-3 border-b shrink-0 space-y-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-emerald-600" />
              Fechados · {periodLabel}
              <span className="text-xs font-normal text-muted-foreground">({hasFilter ? `${filtered.length}/${sorted.length}` : sorted.length})</span>
            </SheetTitle>
            <SheetDescription className="text-xs">
              Leads que viraram cliente no período. Use os atalhos pra abrir o lead ou a conversa.
            </SheetDescription>
            {(() => {
              const buckets = { madrugada: 0, manha: 0, tarde: 0, noite: 0, semHora: 0 };
              sorted.forEach((l) => {
                if (!l.closed_at) { buckets.semHora++; return; }
                const hourStr = new Date(l.closed_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
                const h = parseInt(hourStr, 10);
                if (h < 7) buckets.madrugada++;
                else if (h < 12) buckets.manha++;
                else if (h < 18) buckets.tarde++;
                else buckets.noite++;
              });
              const cells: { label: string; emoji: string; count: number; cls: string }[] = [
                { label: 'Manhã', emoji: '🌅', count: buckets.manha, cls: 'bg-amber-400/20 border-amber-500/40 text-amber-700 dark:text-amber-300' },
                { label: 'Tarde', emoji: '☀️', count: buckets.tarde, cls: 'bg-orange-500/20 border-orange-500/40 text-orange-700 dark:text-orange-300' },
                { label: 'Noite', emoji: '🌙', count: buckets.noite, cls: 'bg-indigo-500/20 border-indigo-500/40 text-indigo-700 dark:text-indigo-300' },
                { label: 'Madrug.', emoji: '🌌', count: buckets.madrugada, cls: 'bg-slate-500/20 border-slate-500/40 text-slate-700 dark:text-slate-300' },
              ];
              if (buckets.semHora > 0) {
                cells.push({ label: 'S/ hora', emoji: '❓', count: buckets.semHora, cls: 'bg-muted border-border text-muted-foreground' });
              }
              const cols = cells.length === 5 ? 'grid-cols-5' : 'grid-cols-4';
              const cellKeys: PeriodKey[] = ['manha', 'tarde', 'noite', 'madrugada', 'semHora'];
              return (
                <div className={`grid ${cols} gap-1.5 pt-1`}>
                  {cells.map((c, i) => {
                    const key = cellKeys[i];
                    const isSelected = periodFilter === key;
                    const dim = periodFilter && !isSelected;
                    return (
                      <button
                        type="button"
                        key={c.label}
                        onClick={() => setPeriodFilter(isSelected ? null : key)}
                        className={`rounded-md border px-1.5 py-1 text-center transition-all hover:brightness-110 ${c.cls} ${dim ? 'opacity-40' : ''} ${isSelected ? 'ring-2 ring-primary scale-[1.02]' : ''}`}
                        title={c.label === 'S/ hora' ? 'Fechados sem hora registrada' : `Filtrar por ${c.label}`}
                      >
                        <div className="text-[10px] font-medium leading-tight">{c.emoji} {c.label}</div>
                        <div className="text-base font-bold leading-tight">{c.count}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {(() => {
              const counts = new Map<string, number>();
              sorted.forEach((l) => {
                const k = getAcolhedor(l);
                counts.set(k, (counts.get(k) || 0) + 1);
              });
              const arr = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
              if (arr.length === 0) return null;
              const total = arr.reduce((s, [, n]) => s + n, 0);
              const palette = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
              let acc = 0;
              const stops = arr.map(([name, n], i) => {
                const start = (acc / total) * 100;
                acc += n;
                const end = (acc / total) * 100;
                return `${palette[i % palette.length]} ${start}% ${end}%`;
              }).join(', ');
              const top3 = arr.slice(0, 3);
              // Podium order: 2nd, 1st, 3rd
              const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean) as [string, number][];
              const heights = new Map<string, string>();
              if (top3[0]) heights.set(top3[0][0], 'h-16');
              if (top3[1]) heights.set(top3[1][0], 'h-12');
              if (top3[2]) heights.set(top3[2][0], 'h-9');
              const medals = new Map<string, string>();
              if (top3[0]) medals.set(top3[0][0], '🥇');
              if (top3[1]) medals.set(top3[1][0], '🥈');
              if (top3[2]) medals.set(top3[2][0], '🥉');
              const rest = arr.slice(3);
              return (
                <div className="pt-2 flex gap-3 items-center">
                  {/* Pizza */}
                  <div className="relative flex-shrink-0">
                    <div
                      className="w-20 h-20 rounded-full border border-border"
                      style={{ background: `conic-gradient(${stops})` }}
                      title={`Total: ${total} fechado${total > 1 ? 's' : ''}`}
                    />
                    <div className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-background flex items-center justify-center text-sm font-bold">
                      {total}
                    </div>
                  </div>
                  {/* Pódio */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-end justify-center gap-1.5 h-20">
                      {podiumOrder.map(([name, n]) => {
                        const colorIdx = arr.findIndex(([nm]) => nm === name);
                        const isSelected = acolhedorFilter === name;
                        const dim = acolhedorFilter && !isSelected;
                        return (
                          <button
                            type="button"
                            key={name}
                            onClick={() => setAcolhedorFilter(isSelected ? null : name)}
                            className={`flex flex-col items-center flex-1 min-w-0 max-w-[80px] transition-all hover:brightness-110 ${dim ? 'opacity-40' : ''} ${isSelected ? 'scale-[1.05]' : ''}`}
                            title={`Filtrar por ${name}`}
                          >
                            <div className="text-base leading-none mb-0.5">{medals.get(name)}</div>
                            <div className="text-[10px] truncate w-full text-center font-medium" title={name}>{name}</div>
                            <div
                              className={`${heights.get(name)} w-full rounded-t-md flex items-center justify-center text-white text-xs font-bold mt-0.5 ${isSelected ? 'ring-2 ring-primary' : ''}`}
                              style={{ background: palette[colorIdx % palette.length] }}
                            >
                              {n}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {rest.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 justify-center">
                        {rest.map(([name, n]) => {
                          const colorIdx = arr.findIndex(([nm]) => nm === name);
                          const isSelected = acolhedorFilter === name;
                          const dim = acolhedorFilter && !isSelected;
                          return (
                            <button
                              type="button"
                              key={name}
                              onClick={() => setAcolhedorFilter(isSelected ? null : name)}
                              className={`inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-all hover:text-foreground ${dim ? 'opacity-40' : ''} ${isSelected ? 'text-foreground font-semibold' : ''}`}
                              title={`Filtrar por ${name}: ${n}`}
                            >
                              <span className="w-2 h-2 rounded-sm" style={{ background: palette[colorIdx % palette.length] }} />
                              <span className="truncate max-w-[80px]">{name}</span>
                              <span className="font-semibold">{n}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {hasFilter && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-muted-foreground truncate">
                  Filtros:{' '}
                  {periodFilter && <span className="font-medium text-foreground">{periodFilter === 'semHora' ? 'S/ hora' : periodFilter.charAt(0).toUpperCase() + periodFilter.slice(1)}</span>}
                  {periodFilter && acolhedorFilter && ' · '}
                  {acolhedorFilter && <span className="font-medium text-foreground">{acolhedorFilter}</span>}
                  {' · '}
                  <span>{filtered.length} de {sorted.length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setPeriodFilter(null); setAcolhedorFilter(null); }}
                  className="text-[11px] font-medium text-primary hover:underline shrink-0"
                >
                  Limpar filtros
                </button>
              </div>
            )}

          </SheetHeader>



          <ScrollArea className="flex-1 min-w-0 overflow-x-hidden">
            <div className="p-2 min-w-0 max-w-full overflow-x-hidden">
              {filtered.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  {hasFilter ? 'Nenhum lead corresponde aos filtros aplicados.' : 'Nenhum lead fechado neste período.'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((lead) => {
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
                        onOpenChat={(phone, name) => setChatPreview({ phone, name, instanceName: null })}
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

