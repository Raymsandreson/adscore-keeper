import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, User, Target, MessageSquare, Send, Phone, ArrowRightLeft, ListChecks, CheckCircle2, AlertTriangle, Trophy, Users, Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { startOfDay, endOfDay, format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export type MetricKey =
  | 'commentReplies' | 'dmsSent' | 'contactsCreated' | 'leadsCreated'
  | 'leadsClosed' | 'leadsProgressed' | 'callsMade' | 'stageChanges'
  | 'checklistItemsChecked' | 'activitiesCompleted' | 'activitiesOverdue';

interface MetricDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metricKey: MetricKey | null;
}

const METRIC_CONFIG: Record<MetricKey, { label: string; icon: React.ElementType; color: string }> = {
  commentReplies: { label: 'Respostas de Comentários', icon: MessageSquare, color: 'text-blue-500' },
  dmsSent: { label: 'DMs Enviadas', icon: Send, color: 'text-violet-500' },
  contactsCreated: { label: 'Contatos Criados', icon: Users, color: 'text-teal-500' },
  leadsCreated: { label: 'Leads Criados', icon: Target, color: 'text-indigo-500' },
  leadsClosed: { label: 'Leads Fechados', icon: Trophy, color: 'text-yellow-500' },
  leadsProgressed: { label: 'Leads com Progresso', icon: Briefcase, color: 'text-purple-500' },
  callsMade: { label: 'Ligações Realizadas', icon: Phone, color: 'text-green-500' },
  stageChanges: { label: 'Mudanças de Etapa', icon: ArrowRightLeft, color: 'text-amber-500' },
  checklistItemsChecked: { label: 'Passos Concluídos', icon: ListChecks, color: 'text-cyan-500' },
  activitiesCompleted: { label: 'Atividades Concluídas', icon: CheckCircle2, color: 'text-emerald-500' },
  activitiesOverdue: { label: 'Atividades Atrasadas', icon: AlertTriangle, color: 'text-red-500' },
};

interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  navigateTo?: string;
}

export function MetricDetailSheet({ open, onOpenChange, metricKey }: MetricDetailSheetProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !metricKey || !user) return;
    fetchItems(metricKey);
  }, [open, metricKey, user]);

  const fetchItems = async (key: MetricKey) => {
    if (!user) return;
    setLoading(true);
    setItems([]);

    const now = new Date();
    const startDate = startOfDay(now).toISOString();
    const endDate = endOfDay(now).toISOString();
    const userId = user.id;

    try {
      let result: ListItem[] = [];

      switch (key) {
        case 'contactsCreated': {
          const { data } = await supabase.from('contacts').select('id, full_name, instagram_username, phone, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(c => ({
            id: c.id,
            title: c.full_name,
            subtitle: c.instagram_username ? `@${c.instagram_username}` : c.phone || undefined,
            badge: format(new Date(c.created_at), 'HH:mm'),
          }));
          break;
        }

        case 'leadsCreated': {
          const { data } = await supabase.from('leads').select('id, lead_name, status, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(l => ({
            id: l.id,
            title: l.lead_name || 'Sem nome',
            subtitle: l.status || undefined,
            badge: format(new Date(l.created_at), 'HH:mm'),
            navigateTo: '/leads',
          }));
          break;
        }

        case 'leadsClosed': {
          const { data } = await supabase.from('leads').select('id, lead_name, status, created_at')
            .eq('created_by', userId).gte('created_at', startDate).lte('created_at', endDate)
            .in('status', ['converted', 'won', 'closed', 'fechado', 'done'])
            .order('created_at', { ascending: false });
          result = (data || []).map(l => ({
            id: l.id,
            title: l.lead_name || 'Sem nome',
            badge: '✓ Fechado',
            badgeVariant: 'default' as const,
            navigateTo: '/leads',
          }));
          break;
        }

        case 'commentReplies': {
          const { data } = await supabase.from('instagram_comments')
            .select('id, author_username, comment_text, replied_at')
            .eq('replied_by', userId)
            .gte('replied_at', startDate).lte('replied_at', endDate)
            .order('replied_at', { ascending: false });
          result = (data || []).map(c => ({
            id: c.id,
            title: `@${c.author_username || 'desconhecido'}`,
            subtitle: c.comment_text ? (c.comment_text.length > 60 ? c.comment_text.slice(0, 60) + '...' : c.comment_text) : undefined,
            badge: c.replied_at ? format(new Date(c.replied_at), 'HH:mm') : undefined,
          }));
          break;
        }

        case 'dmsSent': {
          const { data } = await supabase.from('dm_history')
            .select('id, instagram_username, dm_message, created_at')
            .eq('user_id', userId).eq('action_type', 'sent')
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          result = (data || []).map(d => ({
            id: d.id,
            title: `@${d.instagram_username}`,
            subtitle: d.dm_message ? (d.dm_message.length > 60 ? d.dm_message.slice(0, 60) + '...' : d.dm_message) : undefined,
            badge: format(new Date(d.created_at), 'HH:mm'),
          }));
          break;
        }

        case 'stageChanges': {
          const { data } = await supabase.from('lead_stage_history')
            .select('id, lead_id, from_stage, to_stage, changed_at')
            .eq('changed_by', userId)
            .gte('changed_at', startDate).lte('changed_at', endDate)
            .order('changed_at', { ascending: false });
          
          const leadIds = [...new Set((data || []).map(s => s.lead_id))];
          let leadNames: Record<string, string> = {};
          if (leadIds.length > 0) {
            const { data: leads } = await supabase.from('leads').select('id, lead_name').in('id', leadIds);
            leadNames = Object.fromEntries((leads || []).map(l => [l.id, l.lead_name || 'Sem nome']));
          }

          result = (data || []).map(s => ({
            id: s.id,
            title: leadNames[s.lead_id] || 'Lead',
            subtitle: `${s.from_stage || '?'} → ${s.to_stage || '?'}`,
            badge: s.changed_at ? format(new Date(s.changed_at), 'HH:mm') : undefined,
            navigateTo: '/leads',
          }));
          break;
        }

        case 'leadsProgressed': {
          const { data } = await supabase.from('lead_stage_history')
            .select('lead_id, changed_at')
            .eq('changed_by', userId)
            .gte('changed_at', startDate).lte('changed_at', endDate)
            .order('changed_at', { ascending: false });
          
          const uniqueLeadIds = [...new Set((data || []).map(s => s.lead_id))];
          if (uniqueLeadIds.length > 0) {
            const { data: leads } = await supabase.from('leads').select('id, lead_name, status').in('id', uniqueLeadIds);
            result = (leads || []).map(l => ({
              id: l.id,
              title: l.lead_name || 'Sem nome',
              subtitle: l.status || undefined,
              navigateTo: '/leads',
            }));
          }
          break;
        }

        case 'callsMade': {
          const { data } = await supabase.from('cat_lead_contacts')
            .select('id, cat_lead_id, contact_channel, contact_result, phone_used, created_at')
            .eq('contacted_by', userId)
            .in('contact_channel', ['phone', 'ligacao'])
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });

          // Fetch CAT lead names
          const catIds = [...new Set((data || []).map(c => c.cat_lead_id))];
          let catNames: Record<string, string> = {};
          if (catIds.length > 0) {
            const { data: cats } = await supabase.from('cat_leads').select('id, nome_completo').in('id', catIds);
            catNames = Object.fromEntries((cats || []).map(c => [c.id, c.nome_completo]));
          }

          result = (data || []).map(c => ({
            id: c.id,
            title: catNames[c.cat_lead_id] || 'Contato',
            subtitle: c.phone_used ? `📞 ${c.phone_used}` : undefined,
            badge: format(new Date(c.created_at), 'HH:mm'),
          }));
          break;
        }

        case 'checklistItemsChecked': {
          const { data } = await supabase.from('user_activity_log')
            .select('id, action_type, entity_type, entity_id, metadata, created_at')
            .eq('user_id', userId)
            .eq('action_type', 'checklist_item_checked')
            .gte('created_at', startDate).lte('created_at', endDate)
            .order('created_at', { ascending: false });
          
          result = (data || []).map(a => ({
            id: a.id,
            title: (a.metadata as any)?.item_label || (a.metadata as any)?.checklist_name || 'Passo',
            subtitle: (a.metadata as any)?.lead_name || undefined,
            badge: format(new Date(a.created_at), 'HH:mm'),
          }));
          break;
        }

        case 'activitiesCompleted': {
          const { data } = await supabase.from('lead_activities')
            .select('id, title, lead_name, completed_at')
            .eq('completed_by', userId).eq('status', 'concluida')
            .gte('completed_at', startDate).lte('completed_at', endDate)
            .order('completed_at', { ascending: false });

          result = (data || []).map(a => ({
            id: a.id,
            title: a.title || 'Atividade',
            subtitle: a.lead_name || undefined,
            badge: a.completed_at ? format(new Date(a.completed_at), 'HH:mm') : undefined,
          }));
          break;
        }

        case 'activitiesOverdue': {
          const { data } = await supabase.from('lead_activities')
            .select('id, title, lead_name, deadline')
            .eq('assigned_to', userId).eq('status', 'pendente')
            .lt('deadline', format(now, 'yyyy-MM-dd'))
            .not('deadline', 'is', null)
            .order('deadline', { ascending: true });

          result = (data || []).map(a => ({
            id: a.id,
            title: a.title || 'Atividade',
            subtitle: a.lead_name || undefined,
            badge: a.deadline || undefined,
            badgeVariant: 'destructive' as const,
          }));
          break;
        }
      }

      setItems(result);
    } catch (error) {
      console.error('Error fetching metric detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const config = metricKey ? METRIC_CONFIG[metricKey] : null;
  const Icon = config?.icon || Target;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {config && <Icon className={`h-5 w-5 ${config.color}`} />}
            {config?.label || 'Detalhes'}
            <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4 -mx-2 px-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Icon className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Nenhum item encontrado hoje</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-default animate-fade-in"
                  style={{ animationDelay: `${idx * 30}ms`, animationFillMode: 'backwards' }}
                  onClick={() => {
                    if (item.navigateTo) {
                      onOpenChange(false);
                      navigate(item.navigateTo);
                    }
                  }}
                >
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className={`h-4 w-4 ${config?.color || 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    {item.subtitle && (
                      <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                    )}
                  </div>
                  {item.badge && (
                    <Badge variant={item.badgeVariant || 'outline'} className="text-[10px] flex-shrink-0">
                      {item.badge}
                    </Badge>
                  )}
                  {item.navigateTo && (
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
