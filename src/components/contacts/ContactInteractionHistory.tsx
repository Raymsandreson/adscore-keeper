import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare,
  Send,
  ExternalLink,
  Calendar,
  Clock,
  MessageCircle,
  Instagram,
  ArrowRight,
  Reply,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Comment {
  id: string;
  comment_text: string | null;
  created_at: string;
  post_url: string | null;
  comment_type: string;
  replied_at: string | null;
  funnel_stage: string | null;
}

interface DmEntry {
  id: string;
  dm_message: string;
  original_suggestion: string | null;
  was_edited: boolean | null;
  action_type: string;
  created_at: string;
}

interface ContactInteractionHistoryProps {
  instagramUsername: string | null;
}

export function ContactInteractionHistory({ instagramUsername }: ContactInteractionHistoryProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [dmHistory, setDmHistory] = useState<DmEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (instagramUsername) {
      fetchInteractionHistory();
    } else {
      setLoading(false);
    }
  }, [instagramUsername]);

  const fetchInteractionHistory = async () => {
    if (!instagramUsername) return;

    setLoading(true);
    try {
      const normalizedUsername = instagramUsername.replace('@', '').toLowerCase();
      const usernamesVariants = [normalizedUsername, `@${normalizedUsername}`];

      // Fetch comments
      const { data: commentsData, error: commentsError } = await supabase
        .from('instagram_comments')
        .select('id, comment_text, created_at, post_url, comment_type, replied_at, funnel_stage')
        .or(`author_username.ilike.${normalizedUsername},author_username.ilike.@${normalizedUsername}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (commentsError) throw commentsError;
      setComments(commentsData || []);

      // Fetch DM history
      const { data: dmData, error: dmError } = await supabase
        .from('dm_history')
        .select('id, dm_message, original_suggestion, was_edited, action_type, created_at')
        .or(`instagram_username.ilike.${normalizedUsername},instagram_username.ilike.@${normalizedUsername}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (dmError) throw dmError;
      setDmHistory(dmData || []);
    } catch (error) {
      console.error('Error fetching interaction history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCommentTypeConfig = (type: string) => {
    switch (type) {
      case 'received':
        return { label: 'Recebido', icon: MessageSquare, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' };
      case 'sent':
        return { label: 'Enviado', icon: Send, className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' };
      case 'reply_to_outbound':
        return { label: 'Resposta', icon: Reply, className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' };
      case 'mention':
        return { label: 'Menção', icon: Instagram, className: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' };
      default:
        return { label: type, icon: MessageCircle, className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' };
    }
  };

  const getActionTypeLabel = (type: string) => {
    switch (type) {
      case 'copied':
        return 'Copiado';
      case 'opened':
        return 'Aberto';
      case 'sent':
        return 'Enviado';
      default:
        return type;
    }
  };

  if (!instagramUsername) {
    return (
      <div className="text-center py-8">
        <Instagram className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">
          Instagram não cadastrado
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Adicione o username do Instagram para ver o histórico
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const totalInteractions = comments.length + dmHistory.length;

  if (totalInteractions === 0) {
    return (
      <div className="text-center py-8">
        <MessageCircle className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhuma interação registrada
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Comentários e DMs aparecerão aqui
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-2">
        <Badge variant="outline" className="gap-1">
          <MessageSquare className="h-3 w-3" />
          {comments.length} comentário{comments.length !== 1 ? 's' : ''}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Send className="h-3 w-3" />
          {dmHistory.length} DM{dmHistory.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all" className="text-xs">
            Todos ({totalInteractions})
          </TabsTrigger>
          <TabsTrigger value="comments" className="text-xs">
            Comentários ({comments.length})
          </TabsTrigger>
          <TabsTrigger value="dms" className="text-xs">
            DMs ({dmHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-3">
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {/* Merge and sort by date */}
            {[
              ...comments.map(c => ({ type: 'comment' as const, data: c, date: new Date(c.created_at) })),
              ...dmHistory.map(d => ({ type: 'dm' as const, data: d, date: new Date(d.created_at) }))
            ]
              .sort((a, b) => b.date.getTime() - a.date.getTime())
              .map((item) => (
                item.type === 'comment' 
                  ? <CommentCard key={`comment-${item.data.id}`} comment={item.data as Comment} getConfig={getCommentTypeConfig} />
                  : <DmCard key={`dm-${item.data.id}`} dm={item.data as DmEntry} getActionLabel={getActionTypeLabel} />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="comments" className="mt-3">
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} getConfig={getCommentTypeConfig} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="dms" className="mt-3">
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {dmHistory.map((dm) => (
              <DmCard key={dm.id} dm={dm} getActionLabel={getActionTypeLabel} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CommentCard({ 
  comment, 
  getConfig 
}: { 
  comment: Comment; 
  getConfig: (type: string) => { label: string; icon: any; className: string } 
}) {
  const config = getConfig(comment.comment_type);
  const Icon = config.icon;

  return (
    <div className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded ${config.className}`}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {config.label}
            </Badge>
            {comment.replied_at && (
              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300">
                Respondido
              </Badge>
            )}
          </div>
          <p className="text-sm line-clamp-2">{comment.comment_text || '(sem texto)'}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {format(new Date(comment.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            {comment.post_url && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 ml-auto"
                onClick={() => window.open(comment.post_url!, '_blank')}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DmCard({ 
  dm, 
  getActionLabel 
}: { 
  dm: DmEntry; 
  getActionLabel: (type: string) => string 
}) {
  return (
    <div className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-2">
        <div className="p-1.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
          <Send className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              DM {getActionLabel(dm.action_type)}
            </Badge>
            {dm.was_edited && (
              <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                Editado
              </Badge>
            )}
          </div>
          <p className="text-sm line-clamp-3">{dm.dm_message}</p>
          {dm.original_suggestion && dm.was_edited && (
            <div className="mt-2 p-2 rounded bg-muted/50 text-xs">
              <span className="text-muted-foreground">Sugestão original:</span>
              <p className="line-clamp-2 mt-1">{dm.original_suggestion}</p>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {format(new Date(dm.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
        </div>
      </div>
    </div>
  );
}
