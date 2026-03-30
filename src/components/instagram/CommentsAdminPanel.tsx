import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  MessageCircle, 
  Trash2, 
  Reply, 
  ExternalLink,
  Search,
  RefreshCw,
  Filter,
  User,
  Calendar,
  Image as ImageIcon,
  Loader2,
  Send,
  CheckCircle,
  Clock
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ApifyCommentsFetcher } from './ApifyCommentsFetcher';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface InstagramComment {
  id: string;
  ad_account_id: string | null;
  author_username: string | null;
  comment_text: string | null;
  comment_type: string;
  created_at: string;
  post_url: string | null;
  post_id: string | null;
  comment_id: string | null;
  replied_at: string | null;
  replied_by: string | null;
  funnel_stage: string | null;
  platform: string;
  metadata: unknown;
}

interface InstagramAccount {
  id: string;
  instagram_id: string;
  account_name: string;
  profile_picture_url: string | null;
}

export function CommentsAdminPanel() {
  const [comments, setComments] = useState<InstagramComment[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [selectedComment, setSelectedComment] = useState<InstagramComment | null>(null);
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchComments();
  }, [typeFilter, accountFilter]);

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('instagram_accounts')
        .select('id, instagram_id, account_name, profile_picture_url')
        .eq('is_active', true)
        .order('account_name');

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('instagram_comments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (typeFilter !== 'all') {
        query = query.eq('comment_type', typeFilter);
      }

      if (accountFilter !== 'all') {
        query = query.eq('ad_account_id', accountFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
      toast.error('Erro ao carregar comentários');
    } finally {
      setIsLoading(false);
    }
  };

  const getAccountName = (adAccountId: string | null) => {
    if (!adAccountId) return 'Sem conta';
    const account = accounts.find(a => a.instagram_id === adAccountId);
    return account?.account_name || adAccountId;
  };

  const handleReply = async () => {
    if (!selectedComment || !replyText.trim()) return;

    setIsReplying(true);
    try {
      const { data, error } = await cloudFunctions.invoke('post-instagram-reply', {
        body: {
          commentId: selectedComment.comment_id,
          message: replyText,
          accessToken: 'USE_GLOBAL_TOKEN'
        }
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Erro ao enviar resposta');

      // Update local state
      await supabase
        .from('instagram_comments')
        .update({ 
          replied_at: new Date().toISOString(),
          replied_by: 'admin_panel'
        })
        .eq('id', selectedComment.id);

      toast.success('Resposta enviada com sucesso!');
      setReplyDialogOpen(false);
      setReplyText('');
      fetchComments();
    } catch (error: any) {
      console.error('Error replying:', error);
      toast.error(error?.message || 'Erro ao enviar resposta');
    } finally {
      setIsReplying(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedComment) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('instagram_comments')
        .delete()
        .eq('id', selectedComment.id);

      if (error) throw error;

      toast.success('Comentário removido do sistema');
      setDeleteDialogOpen(false);
      setSelectedComment(null);
      fetchComments();
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Erro ao deletar comentário');
    } finally {
      setIsDeleting(false);
    }
  };

  const getTypeBadge = (type: string) => {
    const styles: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
      received: { label: 'Recebido', variant: 'default' },
      sent: { label: 'Enviado', variant: 'secondary' },
      outbound_manual: { label: 'Outbound Manual', variant: 'outline' },
      outbound_n8n: { label: 'Outbound n8n', variant: 'outline' },
    };
    const style = styles[type] || { label: type, variant: 'secondary' };
    return <Badge variant={style.variant}>{style.label}</Badge>;
  };

  const filteredComments = comments.filter(comment => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      comment.author_username?.toLowerCase().includes(search) ||
      comment.comment_text?.toLowerCase().includes(search) ||
      comment.post_url?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              Painel de Comentários Instagram
            </CardTitle>
            <div className="flex items-center gap-2">
              <ApifyCommentsFetcher
                myUsername={accounts[0]?.account_name}
                onSuccess={fetchComments}
              />
              <Button variant="outline" size="sm" onClick={fetchComments} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Account Selector */}
          {accounts.length > 0 && (
            <div className="mb-6">
              <label className="text-sm font-medium mb-2 block">Conta Instagram</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={accountFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAccountFilter('all')}
                >
                  Todas as Contas
                </Button>
                {accounts.map((account) => (
                  <Button
                    key={account.id}
                    variant={accountFilter === account.instagram_id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAccountFilter(account.instagram_id)}
                    className="gap-2"
                  >
                    {account.profile_picture_url && (
                      <img 
                        src={account.profile_picture_url} 
                        alt={account.account_name}
                        className="h-4 w-4 rounded-full"
                      />
                    )}
                    @{account.account_name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por autor, texto ou URL..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filtrar por tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="received">Recebidos</SelectItem>
                <SelectItem value="sent">Enviados</SelectItem>
                <SelectItem value="outbound_manual">Outbound Manual</SelectItem>
                <SelectItem value="outbound_n8n">Outbound n8n</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{comments.length}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {comments.filter(c => c.comment_type === 'received').length}
              </div>
              <div className="text-xs text-muted-foreground">Recebidos</div>
            </div>
            <div className="bg-green-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">
                {comments.filter(c => c.replied_at).length}
              </div>
              <div className="text-xs text-muted-foreground">Respondidos</div>
            </div>
            <div className="bg-orange-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-orange-600">
                {comments.filter(c => c.comment_type === 'received' && !c.replied_at).length}
              </div>
              <div className="text-xs text-muted-foreground">Pendentes</div>
            </div>
          </div>

          {/* Comments List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredComments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum comentário encontrado</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-3">
                {filteredComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Post Preview */}
                      {comment.post_url && (
                        <a
                          href={comment.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 w-20 h-20 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 rounded-lg flex items-center justify-center hover:opacity-90 transition-opacity overflow-hidden group"
                        >
                          <div className="w-full h-full bg-muted/20 flex items-center justify-center">
                            <ImageIcon className="h-8 w-8 text-white group-hover:scale-110 transition-transform" />
                          </div>
                        </a>
                      )}

                      <div className="flex-1 min-w-0">
                        {/* Header with Author Profile Link */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <a
                            href={`https://instagram.com/${comment.author_username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity group"
                          >
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
                              <User className="h-4 w-4 text-white" />
                            </div>
                            <span className="font-medium group-hover:underline">
                              @{comment.author_username || 'Desconhecido'}
                            </span>
                            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                          {getTypeBadge(comment.comment_type)}
                          {comment.ad_account_id && accountFilter === 'all' && (
                            <Badge variant="secondary" className="text-xs">
                              {getAccountName(comment.ad_account_id)}
                            </Badge>
                          )}
                          {comment.replied_at && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Respondido
                            </Badge>
                          )}
                        </div>

                        {/* Comment Text */}
                        <p className="text-sm mb-3 whitespace-pre-wrap">
                          {comment.comment_text || 'Sem texto'}
                        </p>

                        {/* Meta Info */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(comment.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </div>
                          {comment.post_url && (
                            <a
                              href={comment.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <ImageIcon className="h-3 w-3" />
                              Ver post
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {comment.author_username && (
                            <a
                              href={`https://instagram.com/direct/t/${comment.author_username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-blue-500 hover:underline"
                            >
                              <Send className="h-3 w-3" />
                              Enviar DM
                            </a>
                          )}
                          {comment.replied_at && (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Respondido em {format(new Date(comment.replied_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 shrink-0">
                        {comment.comment_type === 'received' && comment.comment_id && !comment.replied_at && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedComment(comment);
                              setReplyDialogOpen(true);
                            }}
                          >
                            <Reply className="h-4 w-4 mr-1" />
                            Responder
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setSelectedComment(comment);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Reply Dialog */}
      <Dialog open={replyDialogOpen} onOpenChange={setReplyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Reply className="h-5 w-5" />
              Responder Comentário
            </DialogTitle>
          </DialogHeader>
          
          {selectedComment && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-sm font-medium mb-1">
                  @{selectedComment.author_username}
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedComment.comment_text}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Sua resposta:</label>
                <Textarea
                  placeholder="Digite sua resposta..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleReply} disabled={isReplying || !replyText.trim()}>
              {isReplying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Enviar Resposta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este comentário do sistema? 
              Esta ação não pode ser desfeita e o comentário não será removido do Instagram.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
