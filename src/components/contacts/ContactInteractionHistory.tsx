import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  Plus,
  X,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

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
  dm_response: string | null;
}

interface ContactInteractionHistoryProps {
  instagramUsername: string | null;
}

export function ContactInteractionHistory({ instagramUsername }: ContactInteractionHistoryProps) {
  const { user } = useAuthContext();
  const [comments, setComments] = useState<Comment[]>([]);
  const [dmHistory, setDmHistory] = useState<DmEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddComment, setShowAddComment] = useState(false);
  const [showAddDm, setShowAddDm] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentType, setNewCommentType] = useState('sent');
  const [newCommentPostUrl, setNewCommentPostUrl] = useState('');
  const [newDmMessage, setNewDmMessage] = useState('');
  const [saving, setSaving] = useState(false);

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
        .select('id, dm_message, original_suggestion, was_edited, action_type, created_at, dm_response')
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

  const handleAddComment = async () => {
    if (!newCommentText.trim() || !instagramUsername) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const isSentComment = newCommentType === 'sent';
      const { error } = await supabase.from('instagram_comments').insert({
        author_username: normalizedUsername,
        comment_text: newCommentText.trim(),
        comment_type: newCommentType,
        post_url: newCommentPostUrl.trim() || null,
        created_at: nowIso,
        replied_by: isSentComment ? user?.id ?? null : null,
        replied_at: isSentComment ? nowIso : null,
      } as any);
      if (error) throw error;
      toast.success('Comentário registrado!');
      setNewCommentText('');
      setNewCommentPostUrl('');
      setShowAddComment(false);
      fetchInteractionHistory();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao registrar comentário');
    } finally {
      setSaving(false);
    }
  };

  const handleAddDm = async () => {
    if (!newDmMessage.trim() || !instagramUsername) return;
    setSaving(true);
    try {
      const normalizedUsername = instagramUsername.replace('@', '').toLowerCase();
      const { error } = await supabase.from('dm_history').insert({
        instagram_username: normalizedUsername,
        dm_message: newDmMessage.trim(),
        action_type: 'copied',
        user_id: user?.id,
      });
      if (error) throw error;
      toast.success('DM registrada!');
      setNewDmMessage('');
      setShowAddDm(false);
      fetchInteractionHistory();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao registrar DM');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      const { error } = await supabase.from('instagram_comments').delete().eq('id', id);
      if (error) throw error;
      setComments(prev => prev.filter(c => c.id !== id));
      toast.success('Comentário excluído!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao excluir comentário');
    }
  };

  const handleDeleteDm = async (id: string) => {
    try {
      const { error } = await supabase.from('dm_history').delete().eq('id', id);
      if (error) throw error;
      setDmHistory(prev => prev.filter(d => d.id !== id));
      toast.success('DM excluída!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao excluir DM');
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
      case 'received':
        return 'Recebida';
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

  const addButtons = (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setShowAddComment(true); setShowAddDm(false); }}>
        <Plus className="h-3 w-3" /> Comentário
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setShowAddDm(true); setShowAddComment(false); }}>
        <Plus className="h-3 w-3" /> DM
      </Button>
    </div>
  );

  const addCommentForm = showAddComment && (
    <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Novo Comentário</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAddComment(false)}><X className="h-3 w-3" /></Button>
      </div>
      <Select value={newCommentType} onValueChange={setNewCommentType}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="received">Recebido</SelectItem>
          <SelectItem value="sent">Enviado</SelectItem>
          <SelectItem value="mention">Menção</SelectItem>
        </SelectContent>
      </Select>
      <Textarea placeholder="Texto do comentário..." value={newCommentText} onChange={e => setNewCommentText(e.target.value)} className="text-xs min-h-[60px]" />
      <Input placeholder="URL do post (opcional)" value={newCommentPostUrl} onChange={e => setNewCommentPostUrl(e.target.value)} className="h-8 text-xs" />
      <Button size="sm" className="h-7 text-xs w-full" onClick={handleAddComment} disabled={!newCommentText.trim() || saving}>
        {saving ? 'Salvando...' : 'Registrar Comentário'}
      </Button>
    </div>
  );

  const addDmForm = showAddDm && (
    <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Nova DM</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAddDm(false)}><X className="h-3 w-3" /></Button>
      </div>
      <Textarea placeholder="Mensagem da DM..." value={newDmMessage} onChange={e => setNewDmMessage(e.target.value)} className="text-xs min-h-[60px]" />
      <Button size="sm" className="h-7 text-xs w-full" onClick={handleAddDm} disabled={!newDmMessage.trim() || saving}>
        {saving ? 'Salvando...' : 'Registrar DM'}
      </Button>
    </div>
  );

  if (totalInteractions === 0) {
    return (
      <div className="space-y-4">
        {addButtons}
        {addCommentForm}
        {addDmForm}
        <div className="text-center py-8">
          <MessageCircle className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma interação registrada</p>
          <p className="text-xs text-muted-foreground mt-1">Adicione comentários e DMs acima</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + Add buttons */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
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
        {addButtons}
      </div>

      {addCommentForm}
      {addDmForm}

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
                  ? <CommentCard key={`comment-${item.data.id}`} comment={item.data as Comment} getConfig={getCommentTypeConfig} onDelete={handleDeleteComment} />
                  : <DmCard key={`dm-${item.data.id}`} dm={item.data as DmEntry} getActionLabel={getActionTypeLabel} onDelete={handleDeleteDm} instagramUsername={instagramUsername!} onRefresh={fetchInteractionHistory} />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="comments" className="mt-3">
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} getConfig={getCommentTypeConfig} onDelete={handleDeleteComment} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="dms" className="mt-3">
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {dmHistory.map((dm) => (
              <DmCard key={dm.id} dm={dm} getActionLabel={getActionTypeLabel} onDelete={handleDeleteDm} instagramUsername={instagramUsername!} onRefresh={fetchInteractionHistory} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CommentCard({ 
  comment, 
  getConfig,
  onDelete
}: { 
  comment: Comment; 
  getConfig: (type: string) => { label: string; icon: any; className: string };
  onDelete: (id: string) => void;
}) {
  const config = getConfig(comment.comment_type);
  const Icon = config.icon;

  return (
    <div className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors group">
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
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
              onClick={() => onDelete(comment.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
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
  getActionLabel,
  onDelete,
  instagramUsername,
  onRefresh,
}: { 
  dm: DmEntry; 
  getActionLabel: (type: string) => string;
  onDelete: (id: string) => void;
  instagramUsername: string;
  onRefresh: () => void;
}) {
  const [showResponseInput, setShowResponseInput] = useState(false);
  const [responseText, setResponseText] = useState(dm.dm_response || '');
  const [savingResponse, setSavingResponse] = useState(false);

  const handleSaveResponse = async () => {
    if (!responseText.trim()) return;
    setSavingResponse(true);
    try {
      const normalizedUsername = instagramUsername.replace('@', '').toLowerCase();
      // Save response on original DM
      const { error: updateError } = await supabase
        .from('dm_history')
        .update({ dm_response: responseText.trim() } as any)
        .eq('id', dm.id);
      if (updateError) {
        console.error('Update error:', updateError);
      }
      // Create a new DM entry as "received" so it counts in the DM total
      const { error } = await supabase.from('dm_history').insert({
        instagram_username: normalizedUsername,
        dm_message: responseText.trim(),
        action_type: 'received',
      } as any);
      if (error) throw error;
      toast.success('Resposta registrada como DM recebida!');
      setShowResponseInput(false);
      onRefresh();
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar resposta');
    } finally {
      setSavingResponse(false);
    }
  };

  return (
    <div className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors group">
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
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
              onClick={() => onDelete(dm.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-sm line-clamp-3">{dm.dm_message}</p>
          {dm.original_suggestion && dm.was_edited && (
            <div className="mt-2 p-2 rounded bg-muted/50 text-xs">
              <span className="text-muted-foreground">Sugestão original:</span>
              <p className="line-clamp-2 mt-1">{dm.original_suggestion}</p>
            </div>
          )}
          {/* DM Response */}
          {dm.dm_response && !showResponseInput && (
            <div className="mt-2 p-2 rounded bg-muted/50 text-xs border-l-2 border-primary">
              <span className="text-muted-foreground font-medium">Resposta do contato:</span>
              <p className="mt-1">{dm.dm_response}</p>
              <Button variant="ghost" size="sm" className="h-5 text-xs mt-1 px-1" onClick={() => setShowResponseInput(true)}>
                Editar
              </Button>
            </div>
          )}
          {!dm.dm_response && !showResponseInput && (
            <Button variant="ghost" size="sm" className="h-6 text-xs mt-1 gap-1 text-muted-foreground" onClick={() => setShowResponseInput(true)}>
              <Reply className="h-3 w-3" /> Registrar resposta
            </Button>
          )}
          {showResponseInput && (
            <div className="mt-2 space-y-1.5">
              <Textarea
                placeholder="O que o contato respondeu..."
                value={responseText}
                onChange={e => setResponseText(e.target.value)}
                className="text-xs min-h-[50px]"
              />
              <div className="flex gap-1">
                <Button size="sm" className="h-6 text-xs" onClick={handleSaveResponse} disabled={!responseText.trim() || savingResponse}>
                  {savingResponse ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setShowResponseInput(false); setResponseText(dm.dm_response || ''); }}>
                  Cancelar
                </Button>
              </div>
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
