import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  UserPlus, 
  ExternalLink, 
  Check, 
  Search, 
  MessageCircle,
  Clock,
  Users,
  Send,
  X,
  MapPin,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface PendingUser {
  username: string;
  commentsCount: number;
  lastCommentAt: string;
  lastCommentText: string;
  followerStatus: string;
  followRequestedAt: string | null;
  city: string | null;
  state: string | null;
  contactId: string | null;
}

type FilterTab = 'all' | 'pending' | 'requested' | 'following';

export const PendingToFollowList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');
  const [extractingLocation, setExtractingLocation] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch comments and contacts to build the pending list
  const { data: pendingUsers, isLoading } = useQuery({
    queryKey: ['pending-to-follow-extended'],
    queryFn: async () => {
      // Get all received comments with usernames
      const { data: comments, error: commentsError } = await supabase
        .from('instagram_comments')
        .select('author_username, comment_text, created_at')
        .eq('comment_type', 'received')
        .not('author_username', 'is', null)
        .order('created_at', { ascending: false });

      if (commentsError) throw commentsError;

      // Get contacts with follower_status and follow_requested_at
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id, instagram_username, follower_status, follow_requested_at, city, state');

      if (contactsError) throw contactsError;

      // Build a map of contact info by username
      const contactMap = new Map<string, {
        id: string;
        status: string;
        requestedAt: string | null;
        city: string | null;
        state: string | null;
      }>();
      
      contacts?.forEach(contact => {
        if (contact.instagram_username) {
          contactMap.set(contact.instagram_username.toLowerCase(), {
            id: contact.id,
            status: contact.follower_status || 'none',
            requestedAt: contact.follow_requested_at,
            city: contact.city,
            state: contact.state,
          });
        }
      });

      // Aggregate comments by username
      const userMap = new Map<string, { count: number; lastComment: string; lastCommentText: string }>();
      comments?.forEach(comment => {
        if (comment.author_username) {
          const username = comment.author_username.toLowerCase();
          const existing = userMap.get(username);
          if (existing) {
            existing.count += 1;
            if (new Date(comment.created_at) > new Date(existing.lastComment)) {
              existing.lastComment = comment.created_at;
              existing.lastCommentText = comment.comment_text || '';
            }
          } else {
            userMap.set(username, { 
              count: 1, 
              lastComment: comment.created_at,
              lastCommentText: comment.comment_text || ''
            });
          }
        }
      });

      // Build pending users list
      const pending: PendingUser[] = [];
      userMap.forEach((value, username) => {
        const contactInfo = contactMap.get(username);
        const status = contactInfo?.status || 'none';
        
        pending.push({
          username,
          commentsCount: value.count,
          lastCommentAt: value.lastComment,
          lastCommentText: value.lastCommentText,
          followerStatus: status,
          followRequestedAt: contactInfo?.requestedAt || null,
          city: contactInfo?.city || null,
          state: contactInfo?.state || null,
          contactId: contactInfo?.id || null,
        });
      });

      // Sort: pending first, then by comments count
      pending.sort((a, b) => {
        const statusOrder = { none: 0, requested: 1, following: 2, mutual: 3 };
        const aOrder = statusOrder[a.followerStatus as keyof typeof statusOrder] ?? 0;
        const bOrder = statusOrder[b.followerStatus as keyof typeof statusOrder] ?? 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount;
        return new Date(b.lastCommentAt).getTime() - new Date(a.lastCommentAt).getTime();
      });

      return pending;
    }
  });

  // Mark as follow requested
  const markAsRequestedMutation = useMutation({
    mutationFn: async (username: string) => {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .ilike('instagram_username', username)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('contacts')
          .update({ 
            follower_status: 'requested',
            follow_requested_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const { error } = await supabase
          .from('contacts')
          .insert({
            full_name: `@${username}`,
            instagram_username: username,
            follower_status: 'requested',
            follow_requested_at: new Date().toISOString(),
            created_by: currentUser?.id || null,
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, username) => {
      toast.success(`Pedido de follow enviado para @${username}`);
      queryClient.invalidateQueries({ queryKey: ['pending-to-follow-extended'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error) => {
      toast.error('Erro ao marcar pedido');
      console.error(error);
    }
  });

  // Mark as following (accepted)
  const markAsFollowingMutation = useMutation({
    mutationFn: async (username: string) => {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .ilike('instagram_username', username)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('contacts')
          .update({ follower_status: 'following' })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        const { error } = await supabase
          .from('contacts')
          .insert({
            full_name: `@${username}`,
            instagram_username: username,
            follower_status: 'following',
            created_by: currentUser?.id || null,
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, username) => {
      toast.success(`Marcado como seguindo @${username}`);
      queryClient.invalidateQueries({ queryKey: ['pending-to-follow-extended'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error) => {
      toast.error('Erro ao marcar como seguindo');
      console.error(error);
    }
  });

  // Cancel follow request
  const cancelRequestMutation = useMutation({
    mutationFn: async (username: string) => {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .ilike('instagram_username', username)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('contacts')
          .update({ 
            follower_status: 'none',
            follow_requested_at: null
          })
          .eq('id', existing.id);
        if (error) throw error;
      }
    },
    onSuccess: (_, username) => {
      toast.success(`Pedido cancelado para @${username}`);
      queryClient.invalidateQueries({ queryKey: ['pending-to-follow-extended'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error) => {
      toast.error('Erro ao cancelar pedido');
      console.error(error);
    }
  });

  // Extract location from comment using AI
  const extractLocation = async (user: PendingUser) => {
    if (!user.lastCommentText) {
      toast.error('Não há texto de comentário para analisar');
      return;
    }
    
    setExtractingLocation(user.username);
    try {
      const { data, error } = await cloudFunctions.invoke('extract-location', {
        body: { 
          commentText: user.lastCommentText,
          authorUsername: user.username
        }
      });

      if (error) throw error;

      if (data?.location?.city || data?.location?.state) {
        // Update contact with location
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .ilike('instagram_username', user.username)
          .maybeSingle();

        const locationUpdate = {
          city: data.location.city,
          state: data.location.state,
        };

        if (existing) {
          await supabase
            .from('contacts')
            .update(locationUpdate)
            .eq('id', existing.id);
        } else {
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          await supabase
            .from('contacts')
            .insert({
              full_name: `@${user.username}`,
              instagram_username: user.username,
              ...locationUpdate,
              created_by: currentUser?.id || null,
            });
        }

        toast.success(
          `Localização identificada: ${data.location.city || ''} ${data.location.state ? `- ${data.location.state}` : ''}`
        );
        queryClient.invalidateQueries({ queryKey: ['pending-to-follow-extended'] });
      } else {
        toast.info('Nenhuma localização encontrada no comentário');
      }
    } catch (error) {
      console.error('Error extracting location:', error);
      toast.error('Erro ao extrair localização');
    } finally {
      setExtractingLocation(null);
    }
  };

  const openInstagramProfile = (username: string) => {
    window.open(`https://instagram.com/${username}`, '_blank');
  };

  const openDmWithReminder = (username: string) => {
    const message = encodeURIComponent('Oi! Vi que você ainda não aceitou meu pedido de follow. Aceita lá para trocarmos uma ideia! 🙏');
    window.open(`https://instagram.com/direct/t/${username}`, '_blank');
    toast.info('Abriu DM - copie a mensagem de lembrete se necessário');
  };

  const filteredUsers = useMemo(() => {
    if (!pendingUsers) return [];
    
    let filtered = pendingUsers;
    
    // Apply tab filter
    switch (activeTab) {
      case 'pending':
        filtered = filtered.filter(u => u.followerStatus === 'none');
        break;
      case 'requested':
        filtered = filtered.filter(u => u.followerStatus === 'requested');
        break;
      case 'following':
        filtered = filtered.filter(u => u.followerStatus === 'following' || u.followerStatus === 'mutual');
        break;
    }
    
    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(u => 
        u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.city && u.city.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (u.state && u.state.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    
    return filtered;
  }, [pendingUsers, searchTerm, activeTab]);

  const counts = useMemo(() => {
    if (!pendingUsers) return { all: 0, pending: 0, requested: 0, following: 0 };
    return {
      all: pendingUsers.length,
      pending: pendingUsers.filter(u => u.followerStatus === 'none').length,
      requested: pendingUsers.filter(u => u.followerStatus === 'requested').length,
      following: pendingUsers.filter(u => u.followerStatus === 'following' || u.followerStatus === 'mutual').length,
    };
  }, [pendingUsers]);

  const getStatusBadge = (user: PendingUser) => {
    switch (user.followerStatus) {
      case 'following':
      case 'mutual':
        return (
          <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-xs">
            <Check className="h-3 w-3 mr-1" />
            Seguindo
          </Badge>
        );
      case 'requested':
        return (
          <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600 text-xs">
            <Clock className="h-3 w-3 mr-1" />
            Aguardando
            {user.followRequestedAt && (
              <span className="ml-1 opacity-75">
                ({formatDistanceToNow(new Date(user.followRequestedAt), { locale: ptBR, addSuffix: false })})
              </span>
            )}
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-primary" />
            Gestão de Follows
          </CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie pedidos de follow e identifique localização dos prospects
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all" className="text-xs">
              Todos ({counts.all})
            </TabsTrigger>
            <TabsTrigger value="pending" className="text-xs">
              Pendentes ({counts.pending})
            </TabsTrigger>
            <TabsTrigger value="requested" className="text-xs">
              Aguardando ({counts.requested})
            </TabsTrigger>
            <TabsTrigger value="following" className="text-xs">
              Seguindo ({counts.following})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por username, cidade ou estado..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="h-[400px] pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Users className="h-8 w-8 mb-2" />
              <p>Nenhum usuário encontrado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => (
                <div
                  key={user.username}
                  className={`p-3 rounded-lg border transition-colors ${
                    user.followerStatus === 'following' || user.followerStatus === 'mutual'
                      ? 'bg-green-500/5 border-green-500/20' 
                      : user.followerStatus === 'requested'
                      ? 'bg-yellow-500/5 border-yellow-500/20'
                      : 'bg-card hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">@{user.username}</span>
                        {getStatusBadge(user)}
                        {(user.city || user.state) && (
                          <Badge variant="outline" className="text-xs">
                            <MapPin className="h-3 w-3 mr-1" />
                            {user.city}{user.city && user.state ? ' - ' : ''}{user.state}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {user.commentsCount} comentário{user.commentsCount !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(user.lastCommentAt), "dd MMM", { locale: ptBR })}
                        </span>
                      </div>
                      {user.lastCommentText && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">
                          "{user.lastCommentText}"
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Extract location button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => extractLocation(user)}
                        disabled={extractingLocation === user.username}
                        className="h-8 px-2"
                        title="Identificar localização via IA"
                      >
                        {extractingLocation === user.username ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <MapPin className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      
                      {/* View profile */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openInstagramProfile(user.username)}
                        className="h-8 px-2"
                        title="Ver perfil"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      
                      {/* Actions based on status */}
                      {user.followerStatus === 'none' && (
                        <Button
                          size="sm"
                          onClick={() => markAsRequestedMutation.mutate(user.username)}
                          disabled={markAsRequestedMutation.isPending}
                          className="h-8 bg-primary hover:bg-primary/90"
                          title="Marcar que pediu follow"
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1" />
                          Pedir
                        </Button>
                      )}
                      
                      {user.followerStatus === 'requested' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDmWithReminder(user.username)}
                            className="h-8 px-2"
                            title="Enviar DM de lembrete"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => markAsFollowingMutation.mutate(user.username)}
                            disabled={markAsFollowingMutation.isPending}
                            className="h-8 px-2 text-green-600 border-green-500/30 hover:bg-green-500/10"
                            title="Marcar como aceito"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelRequestMutation.mutate(user.username)}
                            disabled={cancelRequestMutation.isPending}
                            className="h-8 px-2 text-destructive hover:bg-destructive/10"
                            title="Cancelar pedido"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
