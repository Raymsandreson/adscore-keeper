import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  MessageSquare, Send, UserPlus, Target, Phone,
  ArrowRightLeft, CheckCircle2, Clock, Loader2,
} from 'lucide-react';
import type { UserProductivity } from '@/hooks/useTeamProductivity';

interface MemberProductivitySheetProps {
  member: (UserProductivity & { displayName: string }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateRange: { start: Date; end: Date };
}

interface DetailItem {
  id: string;
  time: string;
  description: string;
  extra?: string;
}

export function MemberProductivitySheet({ member, open, onOpenChange, dateRange }: MemberProductivitySheetProps) {
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<DetailItem[]>([]);
  const [dms, setDms] = useState<DetailItem[]>([]);
  const [contacts, setContacts] = useState<DetailItem[]>([]);
  const [leads, setLeads] = useState<DetailItem[]>([]);
  const [calls, setCalls] = useState<DetailItem[]>([]);
  const [stageChanges, setStageChanges] = useState<DetailItem[]>([]);
  const [closedCases, setClosedCases] = useState<DetailItem[]>([]);
  const [sessions, setSessions] = useState<DetailItem[]>([]);

  useEffect(() => {
    if (!member || !open) return;
    fetchDetails();
  }, [member, open]);

  const fetchDetails = async () => {
    if (!member) return;
    setLoading(true);
    const startDate = dateRange.start.toISOString();
    const endDate = dateRange.end.toISOString();
    const userId = member.userId;

    try {
      const [
        commentsRes, dmsRes, contactsRes, leadsRes, callsRes, stageRes, sessionsRes
      ] = await Promise.all([
        // Comments replied by this user
        supabase.from('instagram_comments')
          .select('id, author_username, comment_text, replied_at, post_url')
          .eq('replied_by', userId)
          .gte('replied_at', startDate).lte('replied_at', endDate)
          .order('replied_at', { ascending: false }),
        // DMs sent by this user
        supabase.from('dm_history')
          .select('id, instagram_username, dm_message, action_type, created_at')
          .eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        // Contacts created by this user
        supabase.from('contacts')
          .select('id, full_name, instagram_username, created_at')
          .eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        // Leads created by this user
        supabase.from('leads')
          .select('id, lead_name, status, created_at')
          .eq('created_by', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        // Calls made by this user
        supabase.from('cat_lead_contacts')
          .select('id, contact_channel, contact_result, notes, created_at, cat_lead_id')
          .eq('contacted_by', userId)
          .in('contact_channel', ['phone', 'ligacao'])
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        // Stage changes (global - no user field, show all)
        supabase.from('lead_stage_history')
          .select('id, lead_id, from_stage, to_stage, changed_at')
          .gte('changed_at', startDate).lte('changed_at', endDate)
          .order('changed_at', { ascending: false })
          .limit(50),
        // Sessions for this user
        supabase.from('user_sessions')
          .select('id, started_at, ended_at, duration_seconds, end_reason')
          .eq('user_id', userId)
          .gte('started_at', startDate).lte('started_at', endDate)
          .order('started_at', { ascending: false }),
      ]);

      // Map comments
      setComments((commentsRes.data || []).map(c => ({
        id: c.id,
        time: c.replied_at ? format(new Date(c.replied_at), "HH:mm", { locale: ptBR }) : '',
        description: `@${c.author_username || 'desconhecido'}`,
        extra: c.comment_text?.slice(0, 80) || '',
      })));

      // Map DMs
      setDms((dmsRes.data || []).map(d => ({
        id: d.id,
        time: format(new Date(d.created_at), "HH:mm", { locale: ptBR }),
        description: `@${d.instagram_username}`,
        extra: `${d.action_type === 'sent' ? 'Enviada' : 'Recebida'}: ${d.dm_message?.slice(0, 60) || ''}`,
      })));

      // Map contacts
      setContacts((contactsRes.data || []).map(c => ({
        id: c.id,
        time: format(new Date(c.created_at), "HH:mm", { locale: ptBR }),
        description: c.full_name,
        extra: c.instagram_username ? `@${c.instagram_username}` : '',
      })));

      // Map leads
      const allLeads = leadsRes.data || [];
      setLeads(allLeads.map(l => ({
        id: l.id,
        time: format(new Date(l.created_at), "HH:mm", { locale: ptBR }),
        description: l.lead_name || 'Sem nome',
        extra: l.status || '',
      })));

      // Closed cases
      setClosedCases(allLeads.filter(l => l.status === 'converted' || l.status === 'won' || l.status === 'closed').map(l => ({
        id: l.id,
        time: format(new Date(l.created_at), "HH:mm", { locale: ptBR }),
        description: l.lead_name || 'Sem nome',
        extra: l.status || '',
      })));

      // Map calls
      setCalls((callsRes.data || []).map(c => ({
        id: c.id,
        time: format(new Date(c.created_at), "HH:mm", { locale: ptBR }),
        description: c.contact_result || 'Ligação',
        extra: c.notes?.slice(0, 60) || '',
      })));

      // Map stage changes
      setStageChanges((stageRes.data || []).map(s => ({
        id: s.id,
        time: format(new Date(s.changed_at), "HH:mm", { locale: ptBR }),
        description: `${s.from_stage || '?'} → ${s.to_stage || '?'}`,
        extra: `Lead: ${s.lead_id?.slice(0, 8)}...`,
      })));

      // Map sessions
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
        };
      }));
    } catch (err) {
      console.error('Error fetching member details:', err);
    } finally {
      setLoading(false);
    }
  };

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
        {items.map(item => (
          <div key={item.id} className="flex items-start gap-3 p-2.5 rounded-lg border bg-card text-sm">
            <div className="shrink-0 mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{item.description}</span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{item.time}</span>
              </div>
              {item.extra && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.extra}</p>}
            </div>
          </div>
        ))}
      </div>
    )
  );

  if (!member) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg">{member.displayName}</SheetTitle>
          <SheetDescription>{member.email}</SheetDescription>
        </SheetHeader>

        {/* Summary row */}
        <div className="grid grid-cols-4 gap-2 mt-4 mb-4">
          <div className="text-center p-2 rounded-lg bg-blue-50">
            <p className="text-lg font-bold text-blue-700">{member.commentReplies}</p>
            <p className="text-[10px] text-muted-foreground">Comentários</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-violet-50">
            <p className="text-lg font-bold text-violet-700">{member.dmsSent}</p>
            <p className="text-[10px] text-muted-foreground">DMs</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-teal-50">
            <p className="text-lg font-bold text-teal-700">{member.contactsCreated}</p>
            <p className="text-[10px] text-muted-foreground">Contatos</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-indigo-50">
            <p className="text-lg font-bold text-indigo-700">{member.leadsCreated}</p>
            <p className="text-[10px] text-muted-foreground">Leads</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-green-50">
            <p className="text-lg font-bold text-green-700">{member.callsMade}</p>
            <p className="text-[10px] text-muted-foreground">Ligações</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-amber-50">
            <p className="text-lg font-bold text-amber-700">{member.stageChanges}</p>
            <p className="text-[10px] text-muted-foreground">Etapas</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-rose-50">
            <p className="text-lg font-bold text-rose-700">{member.leadsClosed}</p>
            <p className="text-[10px] text-muted-foreground">Fechados</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-orange-50">
            <p className="text-lg font-bold text-orange-700">{formatMinutesToHours(member.sessionMinutes)}</p>
            <p className="text-[10px] text-muted-foreground">Tempo</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="comments" className="flex-1">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="comments" className="text-xs">Comentários</TabsTrigger>
              <TabsTrigger value="dms" className="text-xs">DMs</TabsTrigger>
              <TabsTrigger value="contacts" className="text-xs">Contatos</TabsTrigger>
              <TabsTrigger value="leads" className="text-xs">Leads</TabsTrigger>
            </TabsList>
            <TabsList className="grid grid-cols-4 w-full mt-1">
              <TabsTrigger value="calls" className="text-xs">Ligações</TabsTrigger>
              <TabsTrigger value="stages" className="text-xs">Etapas</TabsTrigger>
              <TabsTrigger value="closed" className="text-xs">Fechados</TabsTrigger>
              <TabsTrigger value="sessions" className="text-xs">Sessões</TabsTrigger>
            </TabsList>

            <ScrollArea className="h-[calc(100vh-380px)] mt-3">
              <TabsContent value="comments" className="mt-0">
                {renderList(comments, <MessageSquare className="h-4 w-4 text-blue-600" />, 'Nenhum comentário no período')}
              </TabsContent>
              <TabsContent value="dms" className="mt-0">
                {renderList(dms, <Send className="h-4 w-4 text-violet-600" />, 'Nenhuma DM no período')}
              </TabsContent>
              <TabsContent value="contacts" className="mt-0">
                {renderList(contacts, <UserPlus className="h-4 w-4 text-teal-600" />, 'Nenhum contato no período')}
              </TabsContent>
              <TabsContent value="leads" className="mt-0">
                {renderList(leads, <Target className="h-4 w-4 text-indigo-600" />, 'Nenhum lead no período')}
              </TabsContent>
              <TabsContent value="calls" className="mt-0">
                {renderList(calls, <Phone className="h-4 w-4 text-green-600" />, 'Nenhuma ligação no período')}
              </TabsContent>
              <TabsContent value="stages" className="mt-0">
                {renderList(stageChanges, <ArrowRightLeft className="h-4 w-4 text-amber-600" />, 'Nenhuma mudança de etapa')}
              </TabsContent>
              <TabsContent value="closed" className="mt-0">
                {renderList(closedCases, <CheckCircle2 className="h-4 w-4 text-rose-600" />, 'Nenhum caso fechado')}
              </TabsContent>
              <TabsContent value="sessions" className="mt-0">
                {renderList(sessions, <Clock className="h-4 w-4 text-orange-600" />, 'Nenhuma sessão no período')}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
