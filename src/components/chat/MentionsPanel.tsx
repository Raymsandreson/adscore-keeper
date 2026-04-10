import { useEffect, useState } from 'react';
import { useMyMentions } from '@/hooks/useTeamChat';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AtSign, Loader2, CheckCheck, Users, ClipboardList, Briefcase, Workflow, ArrowRight, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { TeamDirectChatPanel } from './TeamDirectChatPanel';
import { subscribeToTeamChatConversation, type TeamChatOpenIntent } from '@/lib/teamChatPanelEvents';

interface MentionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const entityIcons: Record<string, React.ReactNode> = {
  lead: <Briefcase className="h-3.5 w-3.5" />,
  activity: <ClipboardList className="h-3.5 w-3.5" />,
  contact: <Users className="h-3.5 w-3.5" />,
  workflow: <Workflow className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
};

const entityLabels: Record<string, string> = {
  lead: 'Lead',
  activity: 'Atividade',
  contact: 'Contato',
  workflow: 'Fluxo',
  whatsapp: 'WhatsApp',
};

const entityColors: Record<string, string> = {
  lead: 'bg-blue-500/10 text-blue-600',
  activity: 'bg-emerald-500/10 text-emerald-600',
  contact: 'bg-purple-500/10 text-purple-600',
  workflow: 'bg-orange-500/10 text-orange-600',
  whatsapp: 'bg-green-500/10 text-green-600',
};

export function MentionsPanel({ open, onOpenChange }: MentionsPanelProps) {
  const { mentions, loading, markAsRead, markAllAsRead } = useMyMentions();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'mentions' | 'chat'>('mentions');
  const [chatIntent, setChatIntent] = useState<TeamChatOpenIntent | null>(null);

  useEffect(() => {
    return subscribeToTeamChatConversation((intent) => {
      setChatIntent(intent);
      setActiveTab('chat');
      onOpenChange(true);
    });
  }, [onOpenChange]);

  const handleMentionClick = async (mention: typeof mentions[0]) => {
    if (!mention.is_read) {
      toast.info('Clique em "Dar ciência" antes de abrir a menção.');
      return;
    }

    try {
      let entityExists = true;
      if (mention.entity_type === 'activity') {
        const { data } = await supabase.from('lead_activities').select('id').eq('id', mention.entity_id).maybeSingle();
        entityExists = !!data;
      } else if (mention.entity_type === 'lead') {
        const { data } = await supabase.from('leads').select('id').eq('id', mention.entity_id).maybeSingle();
        entityExists = !!data;
      } else if (mention.entity_type === 'contact') {
        const { data } = await supabase.from('contacts').select('id').eq('id', mention.entity_id).maybeSingle();
        entityExists = !!data;
      }
      if (!entityExists) {
        const label = mention.entity_type === 'activity' ? 'Atividade' : mention.entity_type === 'lead' ? 'Lead' : 'Contato';
        toast.error(`${label} foi excluído(a) e não existe mais.`);
        return;
      }
    } catch (e) {
      console.error('Error validating entity:', e);
    }

    onOpenChange(false);

    const msgParam = `&highlightMsg=${mention.message_id}`;
    switch (mention.entity_type) {
      case 'lead': {
        let boardParam = '';
        try {
          const { data: lead } = await supabase
            .from('leads')
            .select('board_id')
            .eq('id', mention.entity_id)
            .maybeSingle();
          if (lead?.board_id) {
            boardParam = `board=${lead.board_id}&`;
          }
        } catch (e) {
          console.error('Error fetching lead board:', e);
        }
        navigate(`/leads?${boardParam}openLead=${mention.entity_id}${msgParam}`);
        break;
      }
      case 'activity':
        navigate(`/?openActivity=${mention.entity_id}${msgParam}`);
        break;
      case 'contact':
        navigate(`/leads?openContact=${mention.entity_id}${msgParam}`);
        break;
      case 'workflow':
        navigate(`/workflow?openBoard=${mention.entity_id}${msgParam}`);
        break;
      case 'whatsapp':
        navigate(`/whatsapp?openChat=${encodeURIComponent(mention.entity_id)}`);
        break;
    }
  };

  const unreadCount = mentions.filter(m => !m.is_read).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                {activeTab === 'mentions' ? (
                  <AtSign className="h-4 w-4 text-primary" />
                ) : (
                  <MessageCircle className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">
                  {activeTab === 'mentions' ? 'Menções' : 'Chat da Equipe'}
                </div>
                <div className="text-[10px] text-muted-foreground font-normal">
                  {activeTab === 'mentions'
                    ? (unreadCount > 0 ? `${unreadCount} não lida${unreadCount > 1 ? 's' : ''}` : 'Todas lidas')
                    : 'Conversas diretas e em grupo'
                  }
                </div>
              </div>
              {activeTab === 'mentions' && unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllAsRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1" /> Todas
                </Button>
              )}
            </SheetTitle>
          </SheetHeader>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 p-0.5 bg-muted/60 rounded-lg">
            <button
              onClick={() => setActiveTab('mentions')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                activeTab === 'mentions'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <AtSign className="h-3.5 w-3.5" />
              Menções
              {unreadCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                activeTab === 'chat'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </button>
          </div>
        </div>

        {/* Content */}
        {activeTab === 'chat' ? (
          <div className="flex-1 min-h-0">
            <TeamDirectChatPanel
              intent={chatIntent}
              onIntentHandled={() => setChatIntent(null)}
            />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : mentions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-xs text-center gap-2 px-6">
                <AtSign className="h-8 w-8 opacity-30" />
                <p>Nenhuma menção ainda.<br/>Quando alguém marcar você com <span className="font-medium text-primary">@seu_nome</span>, aparecerá aqui.</p>
              </div>
            ) : (
              <div className="divide-y">
                {mentions.map(mention => (
                  <button
                    key={mention.id}
                    onClick={() => handleMentionClick(mention)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors",
                      !mention.is_read && "bg-primary/5"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5", entityColors[mention.entity_type] || 'bg-muted')}>
                        {entityIcons[mention.entity_type] || <AtSign className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold truncate">
                            {mention.message?.sender_name || 'Alguém'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">mencionou você</span>
                          {!mention.is_read && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-[12px] text-muted-foreground line-clamp-2 mb-1">
                          {mention.message?.content}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", entityColors[mention.entity_type])}>
                            {entityIcons[mention.entity_type]}
                            <span className="ml-1">{entityLabels[mention.entity_type] || mention.entity_type}</span>
                          </Badge>
                          {mention.entity_name && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{mention.entity_name}</span>
                          )}
                          <div className="ml-auto flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(mention.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                            {!mention.is_read ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[10px]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(mention.id);
                                }}
                              >
                                Dar ciência
                              </Button>
                            ) : (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">
                                Ciente
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-2" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
