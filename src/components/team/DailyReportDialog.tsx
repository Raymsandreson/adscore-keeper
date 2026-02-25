import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  FileText, Copy, Download, Loader2, MessageSquare, Send, UserPlus,
  Target, Phone, ArrowRightLeft, CheckCircle2, Clock, Trophy,
  ListChecks, AlertTriangle, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MyProductivity, MyDailyGoals } from '@/hooks/useMyProductivity';

interface DailyReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  productivity: MyProductivity;
  goals: MyDailyGoals;
  goalProgress: number;
}

interface LeadMovement {
  id: string;
  lead_name: string;
  from_stage: string | null;
  to_stage: string | null;
  changed_at: string;
}

interface DetailEntry {
  id: string;
  label: string;
  sublabel?: string;
  time: string;
}

export function DailyReportDialog({
  open, onOpenChange, userId, userName, productivity, goals, goalProgress,
}: DailyReportDialogProps) {
  const [loading, setLoading] = useState(false);
  const [leadMovements, setLeadMovements] = useState<LeadMovement[]>([]);
  const [contactsCreated, setContactsCreated] = useState<DetailEntry[]>([]);
  const [leadsCreated, setLeadsCreated] = useState<DetailEntry[]>([]);
  const [dmsSent, setDmsSent] = useState<DetailEntry[]>([]);
  const [commentReplies, setCommentReplies] = useState<DetailEntry[]>([]);
  const [activitiesCompleted, setActivitiesCompleted] = useState<DetailEntry[]>([]);
  const [callsMade, setCallsMade] = useState<DetailEntry[]>([]);

  useEffect(() => {
    if (!open || !userId) return;
    fetchReportData();
  }, [open, userId]);

  const fetchReportData = async () => {
    setLoading(true);
    const now = new Date();
    const startDate = startOfDay(now).toISOString();
    const endDate = endOfDay(now).toISOString();

    try {
      const [stageRes, contactsRes, leadsRes, dmsRes, commentsRes, activitiesRes, callsRes, callRecordsRes] = await Promise.all([
        supabase.from('lead_stage_history')
          .select('id, lead_id, from_stage, to_stage, changed_at')
          .eq('changed_by', userId)
          .gte('changed_at', startDate).lte('changed_at', endDate)
          .order('changed_at', { ascending: false }),
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
        supabase.from('dm_history')
          .select('id, instagram_username, dm_message, created_at')
          .eq('user_id', userId)
          .neq('action_type', 'received')
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase.from('instagram_comments')
          .select('id, author_username, comment_text, replied_at')
          .eq('replied_by', userId)
          .gte('replied_at', startDate).lte('replied_at', endDate)
          .order('replied_at', { ascending: false }),
        supabase.from('lead_activities')
          .select('id, title, lead_name, completed_at')
          .eq('completed_by', userId)
          .eq('status', 'concluida')
          .gte('completed_at', startDate).lte('completed_at', endDate)
          .order('completed_at', { ascending: false }),
        supabase.from('cat_lead_contacts')
          .select('id, contact_result, notes, created_at')
          .eq('contacted_by', userId)
          .in('contact_channel', ['phone', 'ligacao'])
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
        supabase.from('call_records')
          .select('id, contact_name, call_result, notes, created_at')
          .eq('user_id', userId)
          .gte('created_at', startDate).lte('created_at', endDate)
          .order('created_at', { ascending: false }),
      ]);

      // Lead movements - fetch lead names
      const stageData = stageRes.data || [];
      const leadIds = [...new Set(stageData.map(s => s.lead_id).filter(Boolean))];
      let leadNameMap = new Map<string, string>();
      if (leadIds.length > 0) {
        const { data: names } = await supabase.from('leads').select('id, lead_name').in('id', leadIds);
        (names || []).forEach(l => leadNameMap.set(l.id, l.lead_name || 'Sem nome'));
      }

      setLeadMovements(stageData.map(s => ({
        id: s.id,
        lead_name: leadNameMap.get(s.lead_id) || s.lead_id?.slice(0, 8) || '?',
        from_stage: s.from_stage,
        to_stage: s.to_stage,
        changed_at: s.changed_at,
      })));

      setContactsCreated((contactsRes.data || []).map(c => ({
        id: c.id,
        label: c.full_name,
        sublabel: c.instagram_username ? `@${c.instagram_username}` : undefined,
        time: format(new Date(c.created_at), 'HH:mm', { locale: ptBR }),
      })));

      setLeadsCreated((leadsRes.data || []).map(l => ({
        id: l.id,
        label: l.lead_name || 'Sem nome',
        sublabel: l.status || undefined,
        time: format(new Date(l.created_at), 'HH:mm', { locale: ptBR }),
      })));

      setDmsSent((dmsRes.data || []).map(d => ({
        id: d.id,
        label: `@${d.instagram_username}`,
        sublabel: d.dm_message?.slice(0, 60) || undefined,
        time: format(new Date(d.created_at), 'HH:mm', { locale: ptBR }),
      })));

      setCommentReplies((commentsRes.data || []).map(c => ({
        id: c.id,
        label: `@${c.author_username || 'desconhecido'}`,
        sublabel: c.comment_text?.slice(0, 60) || undefined,
        time: c.replied_at ? format(new Date(c.replied_at), 'HH:mm', { locale: ptBR }) : '',
      })));

      const allCalls: DetailEntry[] = [
        ...(callsRes.data || []).map(c => ({
          id: c.id,
          label: c.contact_result || 'Ligação',
          sublabel: c.notes?.slice(0, 60) || undefined,
          time: format(new Date(c.created_at), 'HH:mm', { locale: ptBR }),
        })),
        ...(callRecordsRes.data || []).map(c => ({
          id: c.id,
          label: c.contact_name || 'Ligação',
          sublabel: `${c.call_result || ''} ${c.notes?.slice(0, 40) || ''}`.trim() || undefined,
          time: format(new Date(c.created_at), 'HH:mm', { locale: ptBR }),
        })),
      ];
      setCallsMade(allCalls);

      setActivitiesCompleted((activitiesRes.data || []).map(a => ({
        id: a.id,
        label: a.title || 'Atividade',
        sublabel: a.lead_name || undefined,
        time: a.completed_at ? format(new Date(a.completed_at), 'HH:mm', { locale: ptBR }) : '',
      })));
    } catch (err) {
      console.error('Error fetching report data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatMinutes = (mins: number) => {
    if (!mins) return '0min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  const metricPercent = (current: number, target: number) => {
    if (!target) return 100;
    return Math.round((current / target) * 100);
  };

  const generateTextReport = () => {
    const today = format(new Date(), "dd/MM/yyyy (EEEE)", { locale: ptBR });
    const lines: string[] = [];

    lines.push(`📊 RELATÓRIO DIÁRIO — ${today}`);
    lines.push(`👤 ${userName}`);
    lines.push(`🎯 Meta geral: ${goalProgress}%`);
    lines.push('');
    lines.push('═══ RESUMO DAS MÉTRICAS ═══');
    lines.push(`💬 Comentários: ${productivity.commentReplies}/${goals.target_replies} (${metricPercent(productivity.commentReplies, goals.target_replies)}%)`);
    lines.push(`📩 DMs enviadas: ${productivity.dmsSent}/${goals.target_dms} (${metricPercent(productivity.dmsSent, goals.target_dms)}%)`);
    lines.push(`👥 Contatos criados: ${productivity.contactsCreated}/${goals.target_contacts} (${metricPercent(productivity.contactsCreated, goals.target_contacts)}%)`);
    lines.push(`🎯 Leads criados: ${productivity.leadsCreated}/${goals.target_leads} (${metricPercent(productivity.leadsCreated, goals.target_leads)}%)`);
    lines.push(`📞 Ligações: ${productivity.callsMade}/${goals.target_calls} (${metricPercent(productivity.callsMade, goals.target_calls)}%)`);
    lines.push(`🔄 Etapas movidas: ${productivity.stageChanges}/${goals.target_stage_changes} (${metricPercent(productivity.stageChanges, goals.target_stage_changes)}%)`);
    lines.push(`📋 Passos checklist: ${productivity.checklistItemsChecked}/${goals.target_checklist_items} (${metricPercent(productivity.checklistItemsChecked, goals.target_checklist_items)}%)`);
    lines.push(`✅ Atividades concluídas: ${productivity.activitiesCompleted}/${goals.target_activities} (${metricPercent(productivity.activitiesCompleted, goals.target_activities)}%)`);
    lines.push(`⚠️ Atividades atrasadas: ${productivity.activitiesOverdue}`);
    lines.push(`🏆 Fechados: ${productivity.leadsClosed}/${goals.target_leads_closed}`);
    lines.push(`📊 Leads progredidos: ${productivity.leadsProgressed}`);
    lines.push(`⏱️ Tempo online: ${formatMinutes(productivity.sessionMinutes)}/${formatMinutes(goals.target_session_minutes)}`);

    if (leadMovements.length > 0) {
      lines.push('');
      lines.push(`═══ LEADS MOVIMENTADOS (${leadMovements.length}) ═══`);
      leadMovements.forEach(m => {
        lines.push(`  • ${m.lead_name}: ${m.from_stage || '?'} → ${m.to_stage || '?'} (${format(new Date(m.changed_at), 'HH:mm')})`);
      });
    }

    if (leadsCreated.length > 0) {
      lines.push('');
      lines.push(`═══ LEADS CRIADOS (${leadsCreated.length}) ═══`);
      leadsCreated.forEach(l => lines.push(`  • ${l.label} (${l.time})`));
    }

    if (contactsCreated.length > 0) {
      lines.push('');
      lines.push(`═══ CONTATOS CRIADOS (${contactsCreated.length}) ═══`);
      contactsCreated.forEach(c => lines.push(`  • ${c.label}${c.sublabel ? ` - ${c.sublabel}` : ''} (${c.time})`));
    }

    if (commentReplies.length > 0) {
      lines.push('');
      lines.push(`═══ COMENTÁRIOS (${commentReplies.length}) ═══`);
      commentReplies.forEach(c => lines.push(`  • ${c.label}: ${c.sublabel || ''} (${c.time})`));
    }

    if (dmsSent.length > 0) {
      lines.push('');
      lines.push(`═══ DMs ENVIADAS (${dmsSent.length}) ═══`);
      dmsSent.forEach(d => lines.push(`  • ${d.label}: ${d.sublabel || ''} (${d.time})`));
    }

    if (callsMade.length > 0) {
      lines.push('');
      lines.push(`═══ LIGAÇÕES (${callsMade.length}) ═══`);
      callsMade.forEach(c => lines.push(`  • ${c.label}${c.sublabel ? ` - ${c.sublabel}` : ''} (${c.time})`));
    }

    if (activitiesCompleted.length > 0) {
      lines.push('');
      lines.push(`═══ ATIVIDADES CONCLUÍDAS (${activitiesCompleted.length}) ═══`);
      activitiesCompleted.forEach(a => lines.push(`  • ${a.label}${a.sublabel ? ` (${a.sublabel})` : ''} (${a.time})`));
    }

    return lines.join('\n');
  };

  const copyToClipboard = () => {
    const text = generateTextReport();
    navigator.clipboard.writeText(text);
    toast.success('Relatório copiado!');
  };

  const metrics = [
    { icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Comentários', current: productivity.commentReplies, target: goals.target_replies },
    { icon: Send, color: 'text-violet-600', bg: 'bg-violet-50', label: 'DMs', current: productivity.dmsSent, target: goals.target_dms },
    { icon: UserPlus, color: 'text-teal-600', bg: 'bg-teal-50', label: 'Contatos', current: productivity.contactsCreated, target: goals.target_contacts },
    { icon: Target, color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Leads', current: productivity.leadsCreated, target: goals.target_leads },
    { icon: Phone, color: 'text-green-600', bg: 'bg-green-50', label: 'Ligações', current: productivity.callsMade, target: goals.target_calls },
    { icon: ArrowRightLeft, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Etapas', current: productivity.stageChanges, target: goals.target_stage_changes },
    { icon: ListChecks, color: 'text-cyan-600', bg: 'bg-cyan-50', label: 'Passos', current: productivity.checklistItemsChecked, target: goals.target_checklist_items },
    { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Ativ. Concl.', current: productivity.activitiesCompleted, target: goals.target_activities },
    { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', label: 'Atrasadas', current: productivity.activitiesOverdue, target: 0 },
    { icon: Trophy, color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Fechados', current: productivity.leadsClosed, target: goals.target_leads_closed },
    { icon: Briefcase, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Progredidos', current: productivity.leadsProgressed, target: 0 },
    { icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50', label: 'Tempo', current: productivity.sessionMinutes, target: goals.target_session_minutes, isMins: true },
  ];

  const renderDetailList = (items: DetailEntry[], icon: React.ReactNode, title: string) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {icon}
          <h4 className="text-sm font-semibold">{title} ({items.length})</h4>
        </div>
        <div className="space-y-1">
          {items.map(item => (
            <div key={item.id} className="flex items-start gap-2 p-2 rounded-md border bg-card text-xs">
              <div className="flex-1 min-w-0">
                <span className="font-medium">{item.label}</span>
                {item.sublabel && <span className="text-muted-foreground ml-1">— {item.sublabel}</span>}
              </div>
              <span className="text-muted-foreground shrink-0">{item.time}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Relatório Diário
          </SheetTitle>
          <SheetDescription>
            {userName} — {format(new Date(), "dd/MM/yyyy (EEEE)", { locale: ptBR })}
          </SheetDescription>
        </SheetHeader>

        {/* Action buttons */}
        <div className="flex gap-2 mt-3 mb-4">
          <Button size="sm" variant="outline" onClick={copyToClipboard} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            Copiar Relatório
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="space-y-5 pr-2">
              {/* Goal progress header */}
              <div className={`text-center p-3 rounded-lg border ${goalProgress >= 100 ? 'bg-green-50 border-green-200' : goalProgress >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-2xl font-bold">{goalProgress}%</p>
                <p className="text-xs text-muted-foreground">Meta geral do dia</p>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-3 gap-2">
                {metrics.map(m => {
                  const pct = m.target > 0 ? metricPercent(m.current, m.target) : null;
                  const Icon = m.icon;
                  return (
                    <div key={m.label} className={`text-center p-2 rounded-lg ${m.bg}`}>
                      <Icon className={`h-3.5 w-3.5 mx-auto mb-0.5 ${m.color}`} />
                      <p className={`text-sm font-bold ${m.color}`}>
                        {m.isMins ? formatMinutes(m.current) : m.current}
                        {m.target > 0 && <span className="text-[10px] font-normal text-muted-foreground">/{m.isMins ? formatMinutes(m.target) : m.target}</span>}
                      </p>
                      <p className="text-[9px] text-muted-foreground">{m.label}</p>
                      {pct !== null && (
                        <Badge variant={pct >= 100 ? 'default' : 'secondary'} className="text-[9px] px-1 h-4 mt-0.5">
                          {pct}%
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Lead movements */}
              {leadMovements.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                    <h4 className="text-sm font-semibold">Leads Movimentados ({leadMovements.length})</h4>
                  </div>
                  <div className="space-y-1">
                    {leadMovements.map(m => (
                      <div key={m.id} className="flex items-center gap-2 p-2 rounded-md border bg-card text-xs">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate">{m.lead_name}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Badge variant="outline" className="text-[9px] h-4 px-1">{m.from_stage || '?'}</Badge>
                            <span className="text-muted-foreground">→</span>
                            <Badge variant="secondary" className="text-[9px] h-4 px-1">{m.to_stage || '?'}</Badge>
                          </div>
                        </div>
                        <span className="text-muted-foreground shrink-0">{format(new Date(m.changed_at), 'HH:mm')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {renderDetailList(leadsCreated, <Target className="h-4 w-4 text-indigo-600" />, 'Leads Criados')}
              {renderDetailList(contactsCreated, <UserPlus className="h-4 w-4 text-teal-600" />, 'Contatos Criados')}
              {renderDetailList(commentReplies, <MessageSquare className="h-4 w-4 text-blue-600" />, 'Comentários')}
              {renderDetailList(dmsSent, <Send className="h-4 w-4 text-violet-600" />, 'DMs Enviadas')}
              {renderDetailList(callsMade, <Phone className="h-4 w-4 text-green-600" />, 'Ligações')}
              {renderDetailList(activitiesCompleted, <CheckCircle2 className="h-4 w-4 text-emerald-600" />, 'Atividades Concluídas')}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
