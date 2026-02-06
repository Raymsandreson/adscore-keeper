import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import {
  Link2,
  Loader2,
  MessageCircle,
  ExternalLink,
  Download,
  User,
  Heart,
  Calendar,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CommentTextWithMentions } from './CommentTextWithMentions';

interface CommentResult {
  comment_id: string;
  comment_text: string;
  author_username: string;
  author_id?: string;
  created_at: string;
  post_url: string;
  metadata?: {
    likes_count?: number;
    post_owner?: string;
    post_caption?: string;
  };
}

interface PostInfo {
  id: string;
  url: string;
  caption?: string;
  ownerUsername?: string;
  likesCount?: number;
  commentsCount?: number;
  timestamp?: string;
}

export function PostCommentsFetcher() {
  const [postUrl, setPostUrl] = useState('');
  const [postUrls, setPostUrls] = useState<string[]>([]);
  const [maxComments, setMaxComments] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [comments, setComments] = useState<CommentResult[]>([]);
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [savedCount, setSavedCount] = useState(0);

  const addPostUrl = () => {
    if (!postUrl.trim()) {
      toast.error('Digite uma URL de post');
      return;
    }
    
    // Validar formato da URL
    if (!postUrl.includes('instagram.com')) {
      toast.error('URL inválida. Use uma URL do Instagram');
      return;
    }

    if (postUrls.includes(postUrl.trim())) {
      toast.error('Este post já foi adicionado');
      return;
    }

    setPostUrls(prev => [...prev, postUrl.trim()]);
    setPostUrl('');
  };

  const removePostUrl = (url: string) => {
    setPostUrls(prev => prev.filter(u => u !== url));
  };

  const handleFetchComments = async () => {
    if (postUrls.length === 0) {
      toast.error('Adicione pelo menos uma URL de post');
      return;
    }

    setIsLoading(true);
    setComments([]);
    setPosts([]);
    setSavedCount(0);

    try {
      const { data, error } = await supabase.functions.invoke('fetch-post-super-scraper', {
        body: {
          postUrls,
          maxComments,
          saveToDatabase: true,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setComments(data.comments || []);
        setPosts(data.posts || []);
        setSavedCount(data.savedToDatabase || 0);
        
        if (data.comments?.length > 0) {
          toast.success(`Encontrados ${data.comments.length} comentários de ${data.postsProcessed} posts`);
        } else {
          toast.info('Nenhum comentário encontrado');
        }
      } else {
        throw new Error(data?.error || 'Erro ao buscar comentários');
      }
    } catch (error) {
      console.error('Fetch error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao buscar comentários');
    } finally {
      setIsLoading(false);
    }
  };

  const extractShortcode = (url: string) => {
    const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : url.substring(0, 30) + '...';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Buscar Comentários por Post
        </CardTitle>
        <CardDescription>
          Extraia comentários de posts específicos do Instagram usando URLs diretas
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Post URL */}
        <div className="space-y-2">
          <Label>URL do Post</Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://www.instagram.com/p/ABC123/ ou /reel/XYZ789/"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPostUrl()}
              className="flex-1"
            />
            <Button onClick={addPostUrl} variant="secondary">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Cole a URL completa do post ou reel do Instagram
          </p>
        </div>

        {/* List of URLs */}
        {postUrls.length > 0 && (
          <div className="space-y-2">
            <Label>Posts para buscar ({postUrls.length})</Label>
            <div className="flex flex-wrap gap-2">
              {postUrls.map((url, index) => (
                <Badge key={index} variant="secondary" className="gap-2 py-1.5 px-3">
                  <Link2 className="h-3 w-3" />
                  {extractShortcode(url)}
                  <button
                    onClick={() => removePostUrl(url)}
                    className="ml-1 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Max Comments Slider */}
        <div className="space-y-2">
          <Label className="flex items-center justify-between">
            <span>Máximo de Comentários por Post</span>
            <Badge variant="outline">{maxComments}</Badge>
          </Label>
          <Slider
            value={[maxComments]}
            onValueChange={([value]) => setMaxComments(value)}
            min={10}
            max={100}
            step={10}
            className="py-2"
          />
          <p className="text-xs text-muted-foreground">
            Limite máximo: 100 comentários por post (limitação do actor)
          </p>
        </div>

        {/* Fetch Button */}
        <Button 
          onClick={handleFetchComments} 
          disabled={isLoading || postUrls.length === 0}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Buscando comentários...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Buscar Comentários ({postUrls.length} {postUrls.length === 1 ? 'post' : 'posts'})
            </>
          )}
        </Button>

        {/* Results */}
        {(comments.length > 0 || posts.length > 0) && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <MessageCircle className="h-4 w-4" />
                <span>{comments.length} comentários</span>
              </div>
              {savedCount > 0 && (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{savedCount} salvos</span>
                </div>
              )}
            </div>

            {/* Posts Info */}
            {posts.length > 0 && (
              <div className="space-y-2">
                <Label>Posts Processados</Label>
                <div className="grid gap-2">
                  {posts.map((post) => (
                    <div
                      key={post.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="font-medium">@{post.ownerUsername}</span>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {post.caption?.substring(0, 50)}...
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Heart className="h-3 w-3" />
                          {post.likesCount?.toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {post.commentsCount?.toLocaleString()}
                        </span>
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments List */}
            <div className="space-y-2">
              <Label>Comentários Extraídos</Label>
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-2">
                  {comments.map((comment, index) => (
                    <div
                      key={comment.comment_id || index}
                      className="p-3 bg-card border rounded-lg space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://instagram.com/${comment.author_username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sm hover:text-primary flex items-center gap-1"
                          >
                            @{comment.author_username}
                            <ExternalLink className="h-3 w-3 opacity-50" />
                          </a>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {comment.metadata?.likes_count ? (
                            <span className="flex items-center gap-1">
                              <Heart className="h-3 w-3" />
                              {comment.metadata.likes_count}
                            </span>
                          ) : null}
                          {comment.created_at && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(comment.created_at), "dd/MM/yy", { locale: ptBR })}
                            </span>
                          )}
                        </div>
                      </div>
                      <CommentTextWithMentions 
                        text={comment.comment_text} 
                        className="text-sm"
                      />
                      {comment.metadata?.post_owner && (
                        <p className="text-xs text-muted-foreground">
                          Post de @{comment.metadata.post_owner}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && comments.length === 0 && postUrls.length > 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Clique em "Buscar Comentários" para extrair os comentários</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
