import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageCircle, 
  Send, 
  Inbox, 
  Plus,
  RefreshCw,
  ExternalLink,
  Clock,
  User,
  Reply
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Comment {
  id: string;
  platform: string;
  comment_type: string;
  post_id: string | null;
  post_url: string | null;
  comment_text: string | null;
  author_username: string | null;
  created_at: string;
}

interface CommentsTrackerProps {
  pageId?: string;
  accessToken?: string;
  isConnected: boolean;
}

export const CommentsTracker = ({ pageId, accessToken, isConnected }: CommentsTrackerProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('received');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [stats, setStats] = useState({ received: 0, sent: 0 });

  // Form state for manual comment logging
  const [newComment, setNewComment] = useState({
    post_url: '',
    comment_text: '',
    author_username: '',
    platform: 'instagram'
  });

  useEffect(() => {
    fetchComments();
    fetchStats();
  }, []);

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Count received today
      const { count: receivedCount } = await supabase
        .from('instagram_comments')
        .select('*', { count: 'exact', head: true })
        .eq('comment_type', 'received')
        .gte('created_at', today);

      // Count sent today
      const { count: sentCount } = await supabase
        .from('instagram_comments')
        .select('*', { count: 'exact', head: true })
        .eq('comment_type', 'sent')
        .gte('created_at', today);

      setStats({
        received: receivedCount || 0,
        sent: sentCount || 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleLogComment = async (type: 'received' | 'sent') => {
    if (!newComment.comment_text.trim()) {
      toast.error('Digite o texto do comentário');
      return;
    }

    try {
      const { error } = await supabase
        .from('instagram_comments')
        .insert({
          comment_type: type,
          platform: newComment.platform,
          post_url: newComment.post_url || null,
          comment_text: newComment.comment_text,
          author_username: newComment.author_username || null,
        });

      if (error) throw error;

      toast.success(`Comentário ${type === 'sent' ? 'enviado' : 'recebido'} registrado!`);
      setIsDialogOpen(false);
      setNewComment({ post_url: '', comment_text: '', author_username: '', platform: 'instagram' });
      fetchComments();
      fetchStats();

      // Update daily stats
      await updateDailyStats(type);
    } catch (error) {
      console.error('Error logging comment:', error);
      toast.error('Erro ao registrar comentário');
    }
  };

  const updateDailyStats = async (type: 'received' | 'sent') => {
    const today = new Date().toISOString().split('T')[0];
    const column = type === 'sent' ? 'comments_sent' : 'comments_received';

    try {
      // Try to update existing record
      const { data: existing } = await supabase
        .from('engagement_daily_stats')
        .select('*')
        .eq('stat_date', today)
        .eq('platform', newComment.platform)
        .single();

      if (existing) {
        await supabase
          .from('engagement_daily_stats')
          .update({ [column]: (existing[column] || 0) + 1 })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('engagement_daily_stats')
          .insert({
            stat_date: today,
            platform: newComment.platform,
            [column]: 1
          });
      }

      // Also update engagement goals
      const { data: goals } = await supabase
        .from('engagement_goals')
        .select('*')
        .eq('is_active', true)
        .eq('goal_type', type === 'sent' ? 'comments_sent' : 'comments_received');

      if (goals) {
        for (const goal of goals) {
          if (goal.platform === 'all' || goal.platform === newComment.platform) {
            await supabase
              .from('engagement_goals')
              .update({ current_value: goal.current_value + 1 })
              .eq('id', goal.id);
          }
        }
      }
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  };

  const filteredComments = comments.filter(c => c.comment_type === activeTab);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500 rounded-lg">
                <Inbox className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-blue-600 dark:text-blue-400">Recebidos Hoje</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats.received}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-500 rounded-lg">
                <Send className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-green-600 dark:text-green-400">Enviados Hoje</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-300">{stats.sent}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-500 rounded-lg">
                <MessageCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-purple-600 dark:text-purple-400">Total Registrados</p>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{comments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 border-orange-200 dark:border-orange-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-orange-500 rounded-lg">
                <Reply className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-orange-600 dark:text-orange-400">Taxa Resposta</p>
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                  {stats.received > 0 ? Math.round((stats.sent / stats.received) * 100) : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comments List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                Histórico de Comentários
              </CardTitle>
              <CardDescription>
                Acompanhe todos os comentários enviados e recebidos
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => { fetchComments(); fetchStats(); }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Atualizar
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Registrar
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Registrar Comentário</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Plataforma</label>
                        <select
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={newComment.platform}
                          onChange={(e) => setNewComment({ ...newComment, platform: e.target.value })}
                        >
                          <option value="instagram">Instagram</option>
                          <option value="facebook">Facebook</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Usuário</label>
                        <Input
                          placeholder="@username"
                          value={newComment.author_username}
                          onChange={(e) => setNewComment({ ...newComment, author_username: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Link do Post (opcional)</label>
                      <Input
                        placeholder="https://instagram.com/p/..."
                        value={newComment.post_url}
                        onChange={(e) => setNewComment({ ...newComment, post_url: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Texto do Comentário</label>
                      <Textarea
                        placeholder="Digite o comentário..."
                        value={newComment.comment_text}
                        onChange={(e) => setNewComment({ ...newComment, comment_text: e.target.value })}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter className="flex gap-2">
                    <Button variant="outline" onClick={() => handleLogComment('received')}>
                      <Inbox className="h-4 w-4 mr-2" />
                      Recebido
                    </Button>
                    <Button onClick={() => handleLogComment('sent')}>
                      <Send className="h-4 w-4 mr-2" />
                      Enviado
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'received' | 'sent')}>
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="received" className="gap-2">
                <Inbox className="h-4 w-4" />
                Recebidos
              </TabsTrigger>
              <TabsTrigger value="sent" className="gap-2">
                <Send className="h-4 w-4" />
                Enviados
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
                </div>
              ) : filteredComments.length === 0 ? (
                <div className="py-12 text-center">
                  <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Nenhum comentário {activeTab === 'received' ? 'recebido' : 'enviado'} registrado
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {filteredComments.map((comment) => (
                      <div
                        key={comment.id}
                        className="p-4 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="secondary" className={
                                comment.platform === 'instagram' 
                                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' 
                                  : 'bg-blue-500 text-white'
                              }>
                                {comment.platform}
                              </Badge>
                              {comment.author_username && (
                                <span className="text-sm font-medium flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {comment.author_username}
                                </span>
                              )}
                            </div>
                            <p className="text-sm">{comment.comment_text}</p>
                            {comment.post_url && (
                              <a
                                href={comment.post_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Ver post
                              </a>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
