import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Target, MessageCircle, X, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PostStats {
  post_url: string;
  total_comments: number;
  leads_count: number;
  contacts_count: number;
}

interface PostStatsFilterProps {
  onSelectPost: (postUrl: string | null) => void;
  selectedPost: string | null;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname.replace(/\/$/, '');
    path = path.replace(/\/reels\//i, '/reel/');
    return `${parsed.origin}${path}`;
  } catch {
    return url.replace(/\?.*$/, '').replace(/\/$/, '');
  }
}

function extractShortLabel(url: string): string {
  const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (match) {
    const type = match[1] === 'p' ? '@p' : '@reel';
    return type;
  }
  return 'post';
}

export function PostStatsFilter({ onSelectPost, selectedPost }: PostStatsFilterProps) {
  const [stats, setStats] = useState<PostStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPostStats();
  }, []);

  const fetchPostStats = async () => {
    setLoading(true);
    try {
      // Get all post_urls with comment counts
      const { data: commentData, error: commentError } = await supabase
        .from('instagram_comments')
        .select('post_url')
        .not('post_url', 'is', null)
        .eq('comment_type', 'received');

      if (commentError) throw commentError;

      // Group by normalized post_url
      const postMap = new Map<string, { original: string; count: number }>();
      (commentData || []).forEach(c => {
        if (!c.post_url) return;
        const normalized = normalizeUrl(c.post_url);
        const existing = postMap.get(normalized);
        if (existing) {
          existing.count++;
        } else {
          postMap.set(normalized, { original: c.post_url, count: 1 });
        }
      });

      // Get leads linked to comments (via instagram_comment_id)
      const { data: leadsData } = await supabase
        .from('leads')
        .select('id, instagram_comment_id')
        .not('instagram_comment_id', 'is', null);

      // Get comment ids and their post_urls for matching
      const leadCommentIds = (leadsData || []).map(l => l.instagram_comment_id).filter(Boolean);
      
      let commentPostMap = new Map<string, string>();
      if (leadCommentIds.length > 0) {
        const { data: commentPosts } = await supabase
          .from('instagram_comments')
          .select('id, post_url')
          .in('id', leadCommentIds as string[]);
        
        (commentPosts || []).forEach(cp => {
          if (cp.post_url) {
            commentPostMap.set(cp.id, normalizeUrl(cp.post_url));
          }
        });
      }

      // Count leads per post
      const leadsPerPost = new Map<string, number>();
      (leadsData || []).forEach(l => {
        if (l.instagram_comment_id) {
          const postUrl = commentPostMap.get(l.instagram_comment_id);
          if (postUrl) {
            leadsPerPost.set(postUrl, (leadsPerPost.get(postUrl) || 0) + 1);
          }
        }
      });

      // Get contacts linked via author_username matching
      const { data: allComments } = await supabase
        .from('instagram_comments')
        .select('author_username, post_url')
        .not('post_url', 'is', null)
        .not('author_username', 'is', null)
        .eq('comment_type', 'received');

      // Get all contacts with instagram_username
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('instagram_username')
        .not('instagram_username', 'is', null);

      const contactUsernames = new Set(
        (contactsData || []).map(c => 
          c.instagram_username?.replace('@', '').toLowerCase()
        ).filter(Boolean)
      );

      // Count contacts per post
      const contactsPerPost = new Map<string, Set<string>>();
      (allComments || []).forEach(c => {
        if (!c.post_url || !c.author_username) return;
        const normalized = normalizeUrl(c.post_url);
        const username = c.author_username.replace('@', '').toLowerCase();
        if (contactUsernames.has(username)) {
          if (!contactsPerPost.has(normalized)) {
            contactsPerPost.set(normalized, new Set());
          }
          contactsPerPost.get(normalized)!.add(username);
        }
      });

      // Build final stats
      const result: PostStats[] = [];
      postMap.forEach(({ original, count }, normalized) => {
        result.push({
          post_url: original,
          total_comments: count,
          leads_count: leadsPerPost.get(normalized) || 0,
          contacts_count: contactsPerPost.get(normalized)?.size || 0,
        });
      });

      // Sort by total comments desc
      result.sort((a, b) => b.total_comments - a.total_comments);
      setStats(result);
    } catch (err) {
      console.error('Error fetching post stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const totalLeads = useMemo(() => stats.reduce((s, p) => s + p.leads_count, 0), [stats]);
  const totalContacts = useMemo(() => stats.reduce((s, p) => s + p.contacts_count, 0), [stats]);

  if (loading) {
    return (
      <div className="flex gap-2 mb-4">
        <Skeleton className="h-20 w-32" />
        <Skeleton className="h-20 w-32" />
        <Skeleton className="h-20 w-32" />
      </div>
    );
  }

  if (stats.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" />
          Filtrar por Postagem
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{stats.length}</Badge>
        </h4>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3 text-blue-500" />
            {totalLeads} leads
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3 text-green-500" />
            {totalContacts} contatos
          </span>
        </div>
      </div>

      <ScrollArea className="w-full">
        <div className="flex gap-2 pb-2">
          {/* "All" option */}
          <button
            type="button"
            onClick={() => onSelectPost(null)}
            className={cn(
              "flex-shrink-0 flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg border text-xs transition-colors min-w-[80px]",
              !selectedPost
                ? "bg-primary/10 border-primary text-primary"
                : "bg-card hover:bg-accent/50 border-border text-muted-foreground"
            )}
          >
            <span className="font-medium">Todos</span>
            <span className="text-[10px]">{stats.reduce((s, p) => s + p.total_comments, 0)} com.</span>
          </button>

          {stats.map((post) => {
            const isSelected = selectedPost && normalizeUrl(selectedPost) === normalizeUrl(post.post_url);
            const label = extractShortLabel(post.post_url);
            return (
              <button
                key={post.post_url}
                type="button"
                onClick={() => onSelectPost(isSelected ? null : post.post_url)}
                className={cn(
                  "flex-shrink-0 flex flex-col gap-1 px-3 py-2 rounded-lg border text-xs transition-colors min-w-[100px]",
                  isSelected
                    ? "bg-primary/10 border-primary"
                    : "bg-card hover:bg-accent/50 border-border"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate max-w-[80px]">{label}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    <MessageCircle className="h-2.5 w-2.5 mr-0.5" />
                    {post.total_comments}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {post.leads_count > 0 && (
                    <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
                      <Target className="h-2.5 w-2.5" />
                      {post.leads_count}
                    </span>
                  )}
                  {post.contacts_count > 0 && (
                    <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                      <Users className="h-2.5 w-2.5" />
                      {post.contacts_count}
                    </span>
                  )}
                  {post.leads_count === 0 && post.contacts_count === 0 && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {selectedPost && (
        <div className="flex items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-lg text-xs">
          <MessageCircle className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Filtrando por:</span>
          <span className="font-medium truncate max-w-[300px]">{selectedPost}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-5 px-1.5"
            onClick={() => onSelectPost(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
