import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageCircle,
  Search,
  Loader2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Heart,
  Send,
  Bookmark,
  Play,
  Image as ImageIcon,
  User,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { usePostMetadata, PostMetadata } from '@/hooks/usePostMetadata';
import { cn } from '@/lib/utils';

interface PostGroup {
  postUrl: string;
  commentCount: number;
  firstCommentAt: string;
}

interface Comment {
  id: string;
  comment_id: string | null;
  comment_text: string | null;
  author_username: string | null;
  comment_type: string;
  created_at: string;
  parent_comment_id: string | null;
  post_url: string | null;
  replied_at: string | null;
  platform: string;
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

export function PostGroupedView() {
  const [postGroups, setPostGroups] = useState<PostGroup[]>([]);
  const [selectedPostUrl, setSelectedPostUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [metadataMap, setMetadataMap] = useState<Record<string, PostMetadata | null>>({});
  const [loadingMetadata, setLoadingMetadata] = useState<Set<string>>(new Set());
  const { fetchMetadata, getCachedMetadata } = usePostMetadata();

  // Fetch grouped posts
  const fetchPostGroups = useCallback(async () => {
    setIsLoadingPosts(true);
    try {
      // Get all distinct post_urls with counts
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('post_url, created_at')
        .not('post_url', 'is', null);

      if (error) throw error;

      // Group by normalized URL
      const groups: Record<string, { count: number; firstAt: string }> = {};
      for (const row of data || []) {
        if (!row.post_url) continue;
        const norm = normalizeUrl(row.post_url);
        if (!groups[norm]) {
          groups[norm] = { count: 0, firstAt: row.created_at };
        }
        groups[norm].count++;
        if (row.created_at < groups[norm].firstAt) {
          groups[norm].firstAt = row.created_at;
        }
      }

      const sorted = Object.entries(groups)
        .map(([url, g]) => ({
          postUrl: url,
          commentCount: g.count,
          firstCommentAt: g.firstAt,
        }))
        .sort((a, b) => new Date(b.firstCommentAt).getTime() - new Date(a.firstCommentAt).getTime());

      setPostGroups(sorted);

      // Auto-select first
      if (sorted.length > 0 && !selectedPostUrl) {
        setSelectedPostUrl(sorted[0].postUrl);
      }

      // Fetch metadata for visible posts (first 10)
      sorted.slice(0, 10).forEach(async (group) => {
        const cached = getCachedMetadata(group.postUrl);
        if (cached) {
          setMetadataMap(prev => ({ ...prev, [group.postUrl]: cached }));
        } else {
          setLoadingMetadata(prev => new Set(prev).add(group.postUrl));
          const meta = await fetchMetadata(group.postUrl);
          setMetadataMap(prev => ({ ...prev, [group.postUrl]: meta }));
          setLoadingMetadata(prev => {
            const next = new Set(prev);
            next.delete(group.postUrl);
            return next;
          });
        }
      });
    } catch (err) {
      console.error('Error fetching post groups:', err);
    } finally {
      setIsLoadingPosts(false);
    }
  }, []);

  // Fetch comments for selected post
  const fetchCommentsForPost = useCallback(async (postUrl: string) => {
    setIsLoadingComments(true);
    try {
      // Need to match any URL variation
      const norm = normalizeUrl(postUrl);
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('*')
        .not('post_url', 'is', null)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Filter by normalized URL
      const filtered = (data || []).filter(c => c.post_url && normalizeUrl(c.post_url) === norm);
      setComments(filtered);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setIsLoadingComments(false);
    }
  }, []);

  useEffect(() => {
    fetchPostGroups();
  }, [fetchPostGroups]);

  useEffect(() => {
    if (selectedPostUrl) {
      fetchCommentsForPost(selectedPostUrl);
      // Fetch metadata if not loaded
      if (!metadataMap[selectedPostUrl] && !loadingMetadata.has(selectedPostUrl)) {
        setLoadingMetadata(prev => new Set(prev).add(selectedPostUrl));
        fetchMetadata(selectedPostUrl).then(meta => {
          setMetadataMap(prev => ({ ...prev, [selectedPostUrl]: meta }));
          setLoadingMetadata(prev => {
            const next = new Set(prev);
            next.delete(selectedPostUrl);
            return next;
          });
        });
      }
    }
  }, [selectedPostUrl]);

  const selectedMeta = selectedPostUrl ? metadataMap[selectedPostUrl] : null;
  const selectedGroup = postGroups.find(g => g.postUrl === selectedPostUrl);
  const selectedIndex = postGroups.findIndex(g => g.postUrl === selectedPostUrl);

  const filteredComments = useMemo(() => {
    if (!searchTerm.trim()) return comments;
    const s = searchTerm.toLowerCase();
    return comments.filter(c =>
      c.comment_text?.toLowerCase().includes(s) ||
      c.author_username?.toLowerCase().includes(s)
    );
  }, [comments, searchTerm]);

  // Separate parent comments and replies
  const parentComments = filteredComments.filter(c => !c.parent_comment_id);
  const repliesMap = useMemo(() => {
    const map: Record<string, Comment[]> = {};
    filteredComments.filter(c => c.parent_comment_id).forEach(c => {
      const key = c.parent_comment_id!;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [filteredComments]);

  const goToPrev = () => {
    if (selectedIndex > 0) {
      setSelectedPostUrl(postGroups[selectedIndex - 1].postUrl);
    }
  };

  const goToNext = () => {
    if (selectedIndex < postGroups.length - 1) {
      setSelectedPostUrl(postGroups[selectedIndex + 1].postUrl);
    }
  };

  const extractShortcode = (url: string) => {
    const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : url.substring(0, 20);
  };

  if (isLoadingPosts) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (postGroups.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Nenhum post com comentários encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Post Carousel */}
      <div className="relative">
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-2 px-1">
            {postGroups.map((group) => {
              const meta = metadataMap[group.postUrl];
              const isSelected = group.postUrl === selectedPostUrl;
              const isMetaLoading = loadingMetadata.has(group.postUrl);

              return (
                <button
                  key={group.postUrl}
                  onClick={() => setSelectedPostUrl(group.postUrl)}
                  className={cn(
                    "flex-shrink-0 w-[140px] rounded-xl border-2 overflow-hidden transition-all hover:shadow-md",
                    isSelected
                      ? "border-primary shadow-lg ring-2 ring-primary/20"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  {/* Thumbnail */}
                  <div className="relative w-full h-[140px] bg-muted">
                    {isMetaLoading ? (
                      <Skeleton className="w-full h-full" />
                    ) : meta?.thumbnailUrl ? (
                      <img
                        src={meta.thumbnailUrl}
                        alt="Post"
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                      </div>
                    )}
                    {/* Video indicator */}
                    {(meta?.mediaType === 'video' || group.postUrl.includes('/reel')) && (
                      <div className="absolute top-2 right-2">
                        <Play className="h-5 w-5 text-white drop-shadow-md fill-white/80" />
                      </div>
                    )}
                    {/* Comment count badge */}
                    <div className="absolute bottom-2 right-2">
                      <Badge variant="secondary" className="text-xs shadow-sm">
                        <MessageCircle className="h-3 w-3 mr-1" />
                        {group.commentCount}
                      </Badge>
                    </div>
                  </div>
                  {/* Info */}
                  <div className="p-2 text-left">
                    <p className="text-xs font-medium truncate">
                      {meta?.ownerUsername ? `@${meta.ownerUsername}` : extractShortcode(group.postUrl)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(group.firstCommentAt), "dd/MM/yy", { locale: ptBR })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Selected Post Detail */}
      {selectedPostUrl && (
        <Card className="overflow-hidden">
          {/* Post Header - Instagram style */}
          <div className="border-b">
            <div className="flex items-center gap-4 p-4">
              {/* Navigation */}
              <Button
                variant="ghost"
                size="icon"
                onClick={goToPrev}
                disabled={selectedIndex <= 0}
                className="shrink-0"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>

              {/* Post Preview */}
              <div className="flex-1 flex gap-4 min-h-[200px]">
                {/* Thumbnail */}
                <div className="relative w-[200px] h-[200px] rounded-lg overflow-hidden bg-muted shrink-0">
                  {loadingMetadata.has(selectedPostUrl) ? (
                    <Skeleton className="w-full h-full" />
                  ) : selectedMeta?.thumbnailUrl ? (
                    <img
                      src={selectedMeta.thumbnailUrl}
                      alt="Post"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                  {(selectedMeta?.mediaType === 'video' || selectedPostUrl.includes('/reel')) && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-black/40 rounded-full p-3">
                        <Play className="h-8 w-8 text-white fill-white" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Post Info */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-primary/80 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <span className="font-semibold text-sm">
                      {selectedMeta?.ownerUsername || 'Autor desconhecido'}
                    </span>
                    <a
                      href={selectedPostUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>

                  {/* Caption */}
                  {selectedMeta?.caption && (
                    <div className="text-sm text-muted-foreground flex-1 overflow-y-auto max-h-[120px] pr-2">
                      <span className="font-semibold text-foreground mr-1">
                        {selectedMeta.ownerUsername}
                      </span>
                      {selectedMeta.caption.length > 200
                        ? selectedMeta.caption.substring(0, 200) + '...'
                        : selectedMeta.caption}
                    </div>
                  )}

                  {/* Engagement row */}
                  <div className="flex items-center gap-4 mt-auto pt-2">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MessageCircle className="h-4 w-4" />
                      <span className="font-medium">{selectedGroup?.commentCount || 0} comentários</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {selectedIndex + 1} de {postGroups.length}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <Button
                variant="ghost"
                size="icon"
                onClick={goToNext}
                disabled={selectedIndex >= postGroups.length - 1}
                className="shrink-0"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Comments Section */}
          <CardContent className="p-4 space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar nos comentários..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Comments List */}
            {isLoadingComments ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredComments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Nenhum comentário encontrado
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-1 pr-3">
                  {parentComments.map((comment) => {
                    const replies = repliesMap[comment.comment_id || ''] || [];
                    return (
                      <div key={comment.id}>
                        <CommentRow comment={comment} />
                        {replies.length > 0 && (
                          <div className="ml-10 border-l-2 border-muted pl-3 space-y-1">
                            {replies.map(reply => (
                              <CommentRow key={reply.id} comment={reply} isReply />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CommentRow({ comment, isReply }: { comment: Comment; isReply?: boolean }) {
  return (
    <div className={cn(
      "flex gap-3 py-2 px-1 rounded-md hover:bg-muted/50 transition-colors",
      isReply && "py-1.5"
    )}>
      <div className={cn(
        "shrink-0 rounded-full bg-muted flex items-center justify-center",
        isReply ? "w-6 h-6" : "w-8 h-8"
      )}>
        <User className={cn("text-muted-foreground", isReply ? "h-3 w-3" : "h-4 w-4")} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={cn("font-semibold", isReply ? "text-xs" : "text-sm")}>
            {comment.author_username || 'anônimo'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
          </span>
          {comment.comment_type === 'sent' && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
              enviado
            </Badge>
          )}
          {comment.replied_at && (
            <Badge variant="default" className="text-[10px] px-1 py-0 h-4">
              respondido
            </Badge>
          )}
        </div>
        <p className={cn("text-muted-foreground break-words", isReply ? "text-xs" : "text-sm")}>
          {comment.comment_text || '(sem texto)'}
        </p>
      </div>
    </div>
  );
}
