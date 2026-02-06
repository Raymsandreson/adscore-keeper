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
  Clock,
  Image,
  Bot,
  Sparkles,
  Tag,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CommentTextWithMentions } from './CommentTextWithMentions';
import { CommentCardBadges } from './CommentCardBadges';
import { InstagramProfileHoverCard } from './InstagramProfileHoverCard';
import { QuickLinkLeadPopover } from './QuickLinkLeadPopover';
import { CommentClassificationDialog } from './CommentClassificationDialog';
import { AIReplyDialog } from './AIReplyDialog';
import { ReplyStatusBadge } from './ReplyStatusBadge';
import { useCommentContactInfo } from '@/hooks/useCommentContactInfo';
import { useCommentCardSettings } from '@/hooks/useCommentCardSettings';

interface CommentResult {
  id?: string;
  comment_id: string;
  comment_text: string;
  author_username: string;
  author_id?: string;
  created_at: string;
  post_url: string;
  replied_at?: string | null;
  metadata?: {
    likes_count?: number;
    post_owner?: string;
    post_caption?: string;
    manual_reply?: boolean;
    manual_reply_text?: string;
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
  const [maxComments, setMaxComments] = useState(500);
  const [isLoading, setIsLoading] = useState(false);
  const [comments, setComments] = useState<CommentResult[]>([]);
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  
  // Dialog states
  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [classifyingComment, setClassifyingComment] = useState<CommentResult | null>(null);
  const [showAIReplyDialog, setShowAIReplyDialog] = useState(false);
  const [replyingToComment, setReplyingToComment] = useState<CommentResult | null>(null);
  
  // Hooks for contact info and card settings
  const usernames = comments.map(c => c.author_username).filter(Boolean);
  const { getContactData, refetch: refetchContactData, refetchUsername } = useCommentContactInfo(usernames);
  const { config: cardConfig } = useCommentCardSettings();

  const addPostUrl = () => {
    if (!postUrl.trim()) {
      toast.error('Digite uma URL de post');
      return;
    }
    
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

  const openClassificationDialog = (comment: CommentResult) => {
    setClassifyingComment(comment);
    setShowClassificationDialog(true);
  };

  return (
    <>
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
              min={50}
              max={2000}
              step={50}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50</span>
              <span>500</span>
              <span>1000</span>
              <span>1500</span>
              <span>2000</span>
            </div>
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
              <div className="flex items-center gap-4 text-sm p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MessageCircle className="h-4 w-4" />
                  <span className="font-medium">{comments.length}</span> comentários
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
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border"
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

              {/* Comments List - Same layout as CommentsTracker */}
              <div className="space-y-2">
                <Label>Comentários Extraídos</Label>
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-3">
                    {comments.map((comment, index) => (
                      <div
                        key={comment.comment_id || index}
                        className="p-4 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            {/* Platform badge and username */}
                            <div className="flex items-center gap-2 mb-2">
                              <Badge 
                                variant="secondary" 
                                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                              >
                                Instagram
                              </Badge>
                              {comment.author_username && (
                                <InstagramProfileHoverCard 
                                  username={comment.author_username}
                                  className="text-sm font-medium"
                                />
                              )}
                            </div>
                            
                            {/* Contact badges with actions */}
                            <div className="mb-2">
                              <CommentCardBadges 
                                contactData={getContactData(comment.author_username)}
                                config={cardConfig}
                                compact={false}
                                interactive={true}
                                authorUsername={comment.author_username}
                                commentText={comment.comment_text}
                                onDataChanged={() => refetchUsername(comment.author_username)}
                              />
                            </div>
                            
                            {/* Comment text */}
                            <CommentTextWithMentions 
                              text={comment.comment_text} 
                              className="text-sm"
                            />
                            
                            {/* Post link */}
                            {comment.post_url && (
                              <a
                                href={comment.post_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 mt-2 group"
                              >
                                <Image className="h-3 w-3" />
                                Ver post
                                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                            )}
                          </div>
                          
                          {/* Right side actions */}
                          <div className="flex flex-col items-end gap-2">
                            {/* Date */}
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            </div>
                            
                            {/* Reply status */}
                            <ReplyStatusBadge 
                              repliedAt={comment.replied_at || null}
                              metadata={comment.metadata as { manual_reply?: boolean; manual_reply_text?: string } | null}
                            />
                            
                            {/* AI Reply button */}
                            {comment.comment_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-300 hover:border-purple-400"
                                onClick={() => {
                                  setReplyingToComment(comment);
                                  setShowAIReplyDialog(true);
                                }}
                              >
                                <Bot className="h-3 w-3 mr-1 text-purple-500" />
                                <Sparkles className="h-3 w-3 mr-1 text-pink-500" />
                                Responder IA
                              </Button>
                            )}
                            
                            {/* Quick link lead */}
                            {comment.author_username && (
                              <QuickLinkLeadPopover 
                                authorUsername={comment.author_username}
                                onLeadLinked={refetchContactData}
                              />
                            )}
                            
                            {/* Classification button */}
                            {comment.author_username && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => openClassificationDialog(comment)}
                              >
                                <Tag className="h-3 w-3 mr-1" />
                                Classificar
                              </Button>
                            )}
                          </div>
                        </div>
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
      
      {/* Classification Dialog */}
      <CommentClassificationDialog
        open={showClassificationDialog}
        onOpenChange={setShowClassificationDialog}
        comment={classifyingComment ? {
          id: classifyingComment.comment_id,
          author_username: classifyingComment.author_username,
          comment_text: classifyingComment.comment_text,
          post_url: classifyingComment.post_url,
          platform: 'instagram',
        } : null}
        onClassificationsApplied={() => {
          refetchContactData();
        }}
        onLeadLinked={refetchContactData}
      />
      
      {/* AI Reply Dialog */}
      <AIReplyDialog
        open={showAIReplyDialog}
        onOpenChange={setShowAIReplyDialog}
        comment={replyingToComment ? {
          id: replyingToComment.comment_id,
          comment_id: replyingToComment.comment_id,
          comment_text: replyingToComment.comment_text,
          author_username: replyingToComment.author_username,
          post_url: replyingToComment.post_url,
        } : null}
        onReplyPosted={() => {
          toast.success('Resposta enviada!');
        }}
      />
    </>
  );
}
