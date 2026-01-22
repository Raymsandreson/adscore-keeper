import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  MessageCircleReply, 
  ExternalLink, 
  Clock, 
  User,
  RefreshCw,
  Inbox
} from 'lucide-react';
import { InstagramProfileHoverCard } from './InstagramProfileHoverCard';

interface OutboundReply {
  id: string;
  author_username: string | null;
  comment_text: string | null;
  created_at: string;
  post_url: string | null;
  prospect_name: string | null;
  funnel_stage: string | null;
}

export function OutboundRepliesHistory() {
  const [replies, setReplies] = useState<OutboundReply[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReplies = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('id, author_username, comment_text, created_at, post_url, prospect_name, funnel_stage')
        .eq('comment_type', 'reply_to_outbound')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setReplies(data || []);
    } catch (error) {
      console.error('Erro ao buscar respostas:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReplies();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('outbound-replies-history')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'instagram_comments',
          filter: 'comment_type=eq.reply_to_outbound'
        },
        (payload) => {
          const newReply = payload.new as OutboundReply;
          setReplies(prev => [newReply, ...prev].slice(0, 50));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStageLabel = (stage: string | null) => {
    const stages: Record<string, { label: string; color: string }> = {
      comment: { label: 'Comentário', color: 'bg-blue-100 text-blue-700' },
      dm: { label: 'DM', color: 'bg-purple-100 text-purple-700' },
      whatsapp: { label: 'WhatsApp', color: 'bg-green-100 text-green-700' },
      visit_scheduled: { label: 'Visita Agendada', color: 'bg-orange-100 text-orange-700' },
      visit_done: { label: 'Visita Realizada', color: 'bg-amber-100 text-amber-700' },
      closed: { label: 'Fechado', color: 'bg-emerald-100 text-emerald-700' },
      post_sale: { label: 'Pós-venda', color: 'bg-teal-100 text-teal-700' },
    };
    return stages[stage || 'comment'] || stages.comment;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircleReply className="h-5 w-5 text-green-600" />
              Histórico de Respostas Outbound
            </CardTitle>
            <CardDescription>
              Prospects que responderam seus comentários em posts de terceiros
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchReplies}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {replies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              Nenhuma resposta outbound recebida ainda
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Quando prospects responderem seus comentários, aparecerão aqui
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {replies.map((reply) => {
                const stageInfo = getStageLabel(reply.funnel_stage);
                return (
                  <div
                    key={reply.id}
                    className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {reply.author_username ? (
                            <InstagramProfileHoverCard 
                              username={reply.author_username}
                              className="font-medium text-sm"
                            >
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                @{reply.author_username}
                              </span>
                            </InstagramProfileHoverCard>
                          ) : (
                            <span className="font-medium text-sm flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {reply.prospect_name || 'Usuário'}
                            </span>
                          )}
                          <Badge variant="secondary" className={`text-xs ${stageInfo.color}`}>
                            {stageInfo.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                            <MessageCircleReply className="h-3 w-3 mr-1" />
                            Resposta
                          </Badge>
                        </div>
                        
                        <p className="text-sm mt-2 text-foreground line-clamp-3">
                          {reply.comment_text || 'Sem texto'}
                        </p>
                        
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(reply.created_at), { 
                              addSuffix: true, 
                              locale: ptBR 
                            })}
                          </span>
                          <span>
                            {format(new Date(reply.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      </div>
                      
                      {reply.post_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => window.open(reply.post_url!, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}