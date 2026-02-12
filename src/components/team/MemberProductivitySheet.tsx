import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  MessageSquare, Send, UserPlus, Target, Phone,
  ArrowRightLeft, CheckCircle2, Clock, Loader2, ExternalLink, XCircle,
} from 'lucide-react';
import type { UserProductivity } from '@/hooks/useTeamProductivity';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';

interface MemberProductivitySheetProps {
  member: (UserProductivity & { displayName: string }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateRange: { start: Date; end: Date };
}

type EntityNav = 'lead' | 'contact' | 'comment' | 'none';

interface DetailItem {
  id: string;
  time: string;
  description: string;
  extra?: string;
  entityType: EntityNav;
  entityId?: string;
}

export function MemberProductivitySheet({ member, open, onOpenChange, dateRange }: MemberProductivitySheetProps) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('comments');
  const [comments, setComments] = useState<DetailItem[]>([]);
  const [dms, setDms] = useState<DetailItem[]>([]);
  const [contacts, setContacts] = useState<DetailItem[]>([]);
  const [leads, setLeads] = useState<DetailItem[]>([]);
  const [calls, setCalls] = useState<DetailItem[]>([]);
  const [stageChanges, setStageChanges] = useState<DetailItem[]>([]);
  const [closedCases, setClosedCases] = useState<DetailItem[]>([]);
  const [refusedCases, setRefusedCases] = useState<DetailItem[]>([]);
  const [sessions, setSessions] = useState<DetailItem[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);

  const handleNavigate = async (item: DetailItem) => {
    if (item.entityType === 'none' || !item.entityId) return;

    if (item.entityType === 'lead' || item.entityType === 'comment') {
      // For leads, stage changes, closed, refused, calls - fetch lead and open sheet
      const entityId = item.entityId;
      const { data } = await supabase.from('leads').select('*').eq('id', entityId).maybeSingle();
      if (data) {
        setSelectedLead(data as Lead);
        setLeadSheetOpen(true);
      }
    } else if (item.entityType === 'contact') {
      const { data } = await supabase.from('contacts').select('*').eq('id', item.entityId).maybeSingle();
      if (data) {
        setSelectedContact(data as Contact);
        setContactSheetOpen(true);
      }
    }
  };

  const handleLeadSave = async (leadId: string, updates: Partial<Lead>) => {
    await supabase.from('leads').update(updates).eq('id', leadId);
    setLeadSheetOpen(false);
    setSelectedLead(null);
  };

  const fetchDetails = async () => {
    if (!member) return;
    setLoading(true);
    const startDate = startOfDay(dateRange.start).toISOString();
    const endDate = endOfDay(dateRange.end).toISOString();
    const userId = member.userId;

    try {
      const [
        commentsRes, dmsRes, contactsRes, leadsRes, callsRes, stageRes, sessionsRes
      ] = await Promise.all([
        supabase.from('instagram_comments')
          .select('id, author_username, comment_text, replied_at, post_url')
          .eq('replied_by', userId)
          .gte('replied_at', startDate).lte('replied_at', endDate)
          .order('replied_at', { ascending: false }),
        supabase.from('dm_history')
          .select('id, instagram_username, dm_message, action_type, created_at, comment_id')
          .eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase.from('contacts')
          .select('id, full_name, instagram_username, created_at')
          .eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase.from('leads')
          .select('id, lead_name, status, created_at')
          .eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase.from('cat_lead_contacts')
          .select('id, contact_channel, contact_result, notes, created_at, cat_lead_id')
          .eq('contacted_by', userId)
          .in('contact_channel', ['phone', 'ligacao'])
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase.from('lead_stage_history')
          .select('id, lead_id, from_stage, to_stage, changed_at')
          .gte('changed_at', startDate).lte('changed_at', endDate)
          .order('changed_at', { ascending: false })
          .limit(50),
        supabase.from('user_sessions')
          .select('id, started_at, ended_at, duration_seconds, end_reason')
          .eq('user_id', userId)
          .gte('started_at', startDate).lte('started_at', endDate)
          .order('started_at', { ascending: false }),
      ]);

      setComments((commentsRes.data || []).map(c => ({
        id: c.id,
        time: c.replied_at ? format(new Date(c.replied_at), "HH:mm", { locale: ptBR }) : '',
        description: `@${c.author_username || 'desconhecido'}`,
        extra: c.comment_text?.slice(0, 80) || '',
        entityType: 'comment' as EntityNav,
        entityId: c.id,
      })));

      setDms((dmsRes.data || []).map(d => ({
        id: d.id,
        time: format(new Date(d.created_at), "HH:mm", { locale: ptBR }),
        description: `@${d.instagram_username}`,
        extra: `${d.action_type === 'sent' ? 'Enviada' : 'Recebida'}: ${d.dm_message?.slice(0, 60) || ''}`,
        entityType: 'comment' as EntityNav,
        entityId: d.comment_id || d.id,
      })));

      setContacts((contactsRes.data || []).map(c => ({
        id: c.id,
        time: format(new Date(c.created_at), "HH:mm", { locale: ptBR }),
        description: c.full_name,
        extra: c.instagram_username ? `@${c.instagram_username}` : '',
        entityType: 'contact' as EntityNav,
        entityId: c.id,
      })));

      const allLeads = leadsRes.data || [];
      setLeads(allLeads.map(l => ({
        id: l.id,
        time: format(new Date(l.created_at), "HH:mm", { locale: ptBR }),
        description: l.lead_name || 'Sem nome',
        extra: l.status || '',
        entityType: 'lead' as EntityNav,
        entityId: l.id,
      })));

      setClosedCases(allLeads.filter(l => ['converted', 'won', 'closed', 'fechado', 'done'].includes(l.status || '')).map(l => ({
        id: l.id,
        time: format(new Date(l.created_at), "HH:mm", { locale: ptBR }),
        description: l.lead_name || 'Sem nome',
        extra: l.status || '',
        entityType: 'lead' as EntityNav,
        entityId: l.id,
      })));

      setRefusedCases(allLeads.filter(l => ['recusado', 'refused', 'lost'].includes(l.status || '')).map(l => ({
        id: l.id,
        time: format(new Date(l.created_at), "HH:mm", { locale: ptBR }),
        description: l.lead_name || 'Sem nome',
        extra: l.status || '',
        entityType: 'lead' as EntityNav,
        entityId: l.id,
      })));

      setCalls((callsRes.data || []).map(c => ({
        id: c.id,
        time: format(new Date(c.created_at), "HH:mm", { locale: ptBR }),
        description: c.contact_result || 'Ligação',
        extra: c.notes?.slice(0, 60) || '',
        entityType: 'lead' as EntityNav,
        entityId: c.cat_lead_id,
      })));

      setStageChanges((stageRes.data || []).map(s => ({
        id: s.id,
        time: format(new Date(s.changed_at), "HH:mm", { locale: ptBR }),
        description: `${s.from_stage || '?'} → ${s.to_stage || '?'}`,
        extra: `Lead: ${s.lead_id?.slice(0, 8)}...`,
        entityType: 'lead' as EntityNav,
        entityId: s.lead_id,
      })));

      setSessions((sessionsRes.data || []).map(s => {
        const dur = s.duration_seconds;
        const hours = dur ? Math.floor(dur / 3600) : 0;
        const mins = dur ? Math.floor((dur % 3600) / 60) : 0;
        const durStr = dur ? (hours > 0 ? `${hours}h ${mins}min` : `${mins}min`) : 'Ativa';
        return {
          id: s.id,
          time: format(new Date(s.started_at), "HH:mm", { locale: ptBR }),
          description: `${format(new Date(s.started_at), "HH:mm")} - ${s.ended_at ? format(new Date(s.ended_at), "HH:mm") : 'agora'}`,
          extra: `Duração: ${durStr} | ${s.end_reason || 'ativa'}`,
          entityType: 'none' as EntityNav,
        };
      }));
    } catch (err) {
      console.error('Error fetching member details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && member) {
      fetchDetails();
    }
  }, [open, member, dateRange.start, dateRange.end]);

  const formatMinutesToHours = (totalMinutes: number) => {
    if (!totalMinutes) return '0min';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
  };

  const renderList = (items: DetailItem[], icon: React.ReactNode, emptyMsg: string) => (
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground text-center py-4">{emptyMsg}</p>
    ) : (
      <div className="space-y-2">
        {items.map(item => {
          const isClickable = item.entityType !== 'none' && !!item.entityId;
          return (
            <div
              key={item.id}
              className={`flex items-start gap-3 p-2.5 rounded-lg border bg-card text-sm transition-colors ${isClickable ? 'cursor-pointer hover:bg-accent/50' : ''}`}
              onClick={isClickable ? () => handleNavigate(item) : undefined}
            >
              <div className="shrink-0 mt-0.5">{icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.description}</span>
                  {isClickable && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">{item.time}</span>
                </div>
                {item.extra && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.extra}</p>}
              </div>
            </div>
          );
        })}
      </div>
    )
  );

  if (!member) return null;

  const summaryCards: { key: string; value: string | number; label: string; bg: string; text: string }[] = [
    { key: 'comments', value: member.commentReplies, label: 'Comentários', bg: 'bg-blue-50', text: 'text-blue-700' },
    { key: 'dms', value: member.dmsSent, label: 'DMs', bg: 'bg-violet-50', text: 'text-violet-700' },
    { key: 'contacts', value: member.contactsCreated, label: 'Contatos', bg: 'bg-teal-50', text: 'text-teal-700' },
    { key: 'leads', value: member.leadsCreated, label: 'Leads', bg: 'bg-indigo-50', text: 'text-indigo-700' },
    { key: 'calls', value: member.callsMade, label: 'Ligações', bg: 'bg-green-50', text: 'text-green-700' },
    { key: 'stages', value: member.stageChanges, label: 'Etapas', bg: 'bg-amber-50', text: 'text-amber-700' },
    { key: 'closed', value: member.leadsClosed, label: 'Fechados', bg: 'bg-rose-50', text: 'text-rose-700' },
    { key: 'refused', value: refusedCases.length, label: 'Recusados', bg: 'bg-gray-50', text: 'text-gray-700' },
    { key: 'sessions', value: formatMinutesToHours(member.sessionMinutes), label: 'Tempo', bg: 'bg-orange-50', text: 'text-orange-700' },
  ];

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">{member.displayName}</SheetTitle>
          <SheetDescription>{member.email}</SheetDescription>
        </SheetHeader>

        {/* Clickable summary cards - clicking switches the detail list below */}
        <div className="grid grid-cols-4 gap-2 mt-4 mb-4">
          {summaryCards.map(card => (
            <div
              key={card.key}
              className={`text-center p-2 rounded-lg cursor-pointer transition-all ${card.bg} ${activeTab === card.key ? 'ring-2 ring-primary shadow-sm scale-[1.02]' : 'hover:opacity-80'}`}
              onClick={() => setActiveTab(card.key)}
            >
              <p className={`text-lg font-bold ${card.text}`}>{card.value}</p>
              <p className="text-[10px] text-muted-foreground">{card.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-320px)]">
            {activeTab === 'comments' && renderList(comments, <MessageSquare className="h-4 w-4 text-blue-600" />, 'Nenhum comentário no período')}
            {activeTab === 'dms' && renderList(dms, <Send className="h-4 w-4 text-violet-600" />, 'Nenhuma DM no período')}
            {activeTab === 'contacts' && renderList(contacts, <UserPlus className="h-4 w-4 text-teal-600" />, 'Nenhum contato no período')}
            {activeTab === 'leads' && renderList(leads, <Target className="h-4 w-4 text-indigo-600" />, 'Nenhum lead no período')}
            {activeTab === 'calls' && renderList(calls, <Phone className="h-4 w-4 text-green-600" />, 'Nenhuma ligação no período')}
            {activeTab === 'stages' && renderList(stageChanges, <ArrowRightLeft className="h-4 w-4 text-amber-600" />, 'Nenhuma mudança de etapa')}
            {activeTab === 'closed' && renderList(closedCases, <CheckCircle2 className="h-4 w-4 text-rose-600" />, 'Nenhum caso fechado')}
            {activeTab === 'refused' && renderList(refusedCases, <XCircle className="h-4 w-4 text-gray-600" />, 'Nenhum caso recusado')}
            {activeTab === 'sessions' && renderList(sessions, <Clock className="h-4 w-4 text-orange-600" />, 'Nenhuma sessão no período')}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>

    {/* Lead detail - left side sheet */}
    <LeadEditDialog
      open={leadSheetOpen}
      onOpenChange={(v) => { setLeadSheetOpen(v); if (!v) setSelectedLead(null); }}
      lead={selectedLead}
      onSave={handleLeadSave}
      mode="dialog"
    />

    {/* Contact detail - left side sheet */}
    <ContactDetailSheet
      contact={selectedContact}
      open={contactSheetOpen}
      onOpenChange={(v) => { setContactSheetOpen(v); if (!v) setSelectedContact(null); }}
      onContactUpdated={() => { setContactSheetOpen(false); setSelectedContact(null); }}
      mode="dialog"
    />
    </>
  );
}
