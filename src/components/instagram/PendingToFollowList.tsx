import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  UserPlus, 
  ExternalLink, 
  Check, 
  Search, 
  MessageCircle,
  Clock,
  Users
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface PendingUser {
  username: string;
  commentsCount: number;
  lastCommentAt: string;
  isFollowing: boolean;
}

export const PendingToFollowList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const queryClient = useQueryClient();

  // Fetch comments and contacts to build the pending list
  const { data: pendingUsers, isLoading } = useQuery({
    queryKey: ['pending-to-follow'],
    queryFn: async () => {
      // Get all received comments with usernames
      const { data: comments, error: commentsError } = await supabase
        .from('instagram_comments')
        .select('author_username, created_at')
        .eq('comment_type', 'received')
        .not('author_username', 'is', null)
        .order('created_at', { ascending: false });

      if (commentsError) throw commentsError;

      // Get contacts with follower_status
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('instagram_username, follower_status');

      if (contactsError) throw contactsError;

      // Build a map of following status
      const followingMap = new Map<string, boolean>();
      contacts?.forEach(contact => {
        if (contact.instagram_username) {
          const isFollowing = contact.follower_status === 'following' || contact.follower_status === 'mutual';
          followingMap.set(contact.instagram_username.toLowerCase(), isFollowing);
        }
      });

      // Aggregate comments by username
      const userMap = new Map<string, { count: number; lastComment: string }>();
      comments?.forEach(comment => {
        if (comment.author_username) {
          const username = comment.author_username.toLowerCase();
          const existing = userMap.get(username);
          if (existing) {
            existing.count += 1;
            if (new Date(comment.created_at) > new Date(existing.lastComment)) {
              existing.lastComment = comment.created_at;
            }
          } else {
            userMap.set(username, { count: 1, lastComment: comment.created_at });
          }
        }
      });

      // Build pending users list
      const pending: PendingUser[] = [];
      userMap.forEach((value, username) => {
        const isFollowing = followingMap.get(username) || false;
        pending.push({
          username,
          commentsCount: value.count,
          lastCommentAt: value.lastComment,
          isFollowing
        });
      });

      // Sort by comments count (most engaged first), then by recent activity
      pending.sort((a, b) => {
        if (a.isFollowing !== b.isFollowing) return a.isFollowing ? 1 : -1;
        if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount;
        return new Date(b.lastCommentAt).getTime() - new Date(a.lastCommentAt).getTime();
      });

      return pending;
    }
  });

  // Mark as following mutation
  const markAsFollowingMutation = useMutation({
    mutationFn: async (username: string) => {
      // Check if contact exists
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .ilike('instagram_username', username)
        .maybeSingle();

      if (existing) {
        // Update existing contact
        const { error } = await supabase
          .from('contacts')
          .update({ follower_status: 'following' })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        // Create new contact
        const { error } = await supabase
          .from('contacts')
          .insert({
            full_name: `@${username}`,
            instagram_username: username,
            follower_status: 'following'
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, username) => {
      toast.success(`Marcado como seguindo @${username}`);
      queryClient.invalidateQueries({ queryKey: ['pending-to-follow'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error) => {
      toast.error('Erro ao marcar como seguindo');
      console.error(error);
    }
  });

  const openInstagramProfile = (username: string) => {
    window.open(`https://instagram.com/${username}`, '_blank');
  };

  const filteredUsers = useMemo(() => {
    if (!pendingUsers) return [];
    if (!searchTerm) return pendingUsers;
    return pendingUsers.filter(user => 
      user.username.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [pendingUsers, searchTerm]);

  const pendingCount = pendingUsers?.filter(u => !u.isFollowing).length || 0;
  const followingCount = pendingUsers?.filter(u => u.isFollowing).length || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-primary" />
            Pendentes para Seguir
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30">
              {pendingCount} pendentes
            </Badge>
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
              {followingCount} seguindo
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Pessoas que comentaram nos seus posts mas você ainda não segue
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por username..."
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
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    user.isFollowing 
                      ? 'bg-green-500/5 border-green-500/20' 
                      : 'bg-card hover:bg-muted/50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">@{user.username}</span>
                      {user.isFollowing && (
                        <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Seguindo
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
                  </div>
                  
                  <div className="flex items-center gap-2 ml-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openInstagramProfile(user.username)}
                      className="h-8"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      Perfil
                    </Button>
                    {!user.isFollowing && (
                      <Button
                        size="sm"
                        onClick={() => markAsFollowingMutation.mutate(user.username)}
                        disabled={markAsFollowingMutation.isPending}
                        className="h-8 bg-primary hover:bg-primary/90"
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        Seguir
                      </Button>
                    )}
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
