import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ExternalLink,
  MessageCircle,
  Heart,
  Eye,
  UserPlus,
  Loader2,
  ChevronDown,
  ChevronUp,
  Hash,
  Image,
  Video,
  Sparkles,
  Tag,
  Link2,
  Target,
} from 'lucide-react';
import { useState } from 'react';
import { InstagramProfileHoverCard } from './InstagramProfileHoverCard';
import { CreateLeadFromSearchDialog } from './CreateLeadFromSearchDialog';

interface CommentData {
  id: string;
  text: string;
  ownerUsername: string;
  timestamp: string;
}

interface SearchResult {
  postId: string;
  postUrl: string;
  username: string;
  userUrl: string;
  caption: string;
  postedDate: string | null;
  location: string | null;
  mediaType: string;
  thumbnailUrl: string;
  mediaUrls: string[];
  hashtags: string[];
  mentions: string[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  isAd: boolean;
  searchKeyword: string;
  scrapedAt: string;
  comments?: CommentData[];
  matchingComments?: CommentData[];
}

interface CaseSearchResultCardProps {
  result: SearchResult;
  commentKeywords: string[];
  isLoadingComments: boolean;
  onFetchComments: () => void;
  onCreateLead?: (comment?: CommentData) => void;
}

// Componente para ações de cada comentário
function CommentActions({ 
  comment, 
  onCreateLead 
}: { 
  comment: CommentData; 
  onCreateLead: (comment: CommentData) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 ml-auto">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs justify-start gap-1.5"
        onClick={() => window.open(`https://instagram.com/direct/t/${comment.ownerUsername}`, '_blank')}
      >
        <MessageCircle className="h-3 w-3" />
        Responder (Instagram)
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs justify-start gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950"
      >
        <Target className="h-3 w-3" />
        Prospect
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs justify-start gap-1.5 text-pink-600 border-pink-200 hover:bg-pink-50 dark:text-pink-400 dark:border-pink-800 dark:hover:bg-pink-950"
      >
        <Sparkles className="h-3 w-3" />
        Responder IA
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs justify-start gap-1.5"
        onClick={() => onCreateLead(comment)}
      >
        <Link2 className="h-3 w-3" />
        Vincular Lead
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs justify-start gap-1.5"
      >
        <Tag className="h-3 w-3" />
        Classificar
      </Button>
    </div>
  );
}

// Componente para exibir cada comentário individual
function CommentItem({
  comment,
  commentKeywords,
  onCreateLead,
}: {
  comment: CommentData;
  commentKeywords: string[];
  onCreateLead: (comment: CommentData) => void;
}) {
  const highlightKeywords = (text: string) => {
    let highlightedText = text;
    commentKeywords.forEach(kw => {
      const regex = new RegExp(`(${kw})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">$1</mark>');
    });
    return highlightedText;
  };

  return (
    <div className="bg-muted/50 rounded-lg p-3 text-sm border">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          {/* Header do comentário */}
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="text-xs bg-gradient-to-r from-pink-500 to-purple-500 text-white">
              instagram
            </Badge>
            <InstagramProfileHoverCard username={comment.ownerUsername} className="font-medium text-xs hover:text-primary" />
            <span className="text-xs text-muted-foreground ml-auto">
              {comment.timestamp ? new Date(comment.timestamp).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              }) : ''}
            </span>
          </div>
          
          {/* Texto do comentário */}
          <p
            className="text-muted-foreground text-sm mb-2"
            dangerouslySetInnerHTML={{ __html: highlightKeywords(comment.text) }}
          />
          
          {/* Link para ver post */}
          <a
            href={`https://instagram.com/${comment.ownerUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Ver perfil
          </a>
        </div>
        
        {/* Ações do comentário */}
        <CommentActions comment={comment} onCreateLead={onCreateLead} />
      </div>
    </div>
  );
}

export function CaseSearchResultCard({
  result,
  commentKeywords,
  isLoadingComments,
  onFetchComments,
}: CaseSearchResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const [showLeadDialog, setShowLeadDialog] = useState(false);
  const [selectedComment, setSelectedComment] = useState<CommentData | undefined>();

  const MediaIcon = result.mediaType === 'video' ? Video : Image;
  
  // Combinar comentários com match e todos os comentários
  const allComments = result.comments || [];
  const matchingComments = result.matchingComments || [];
  const hasComments = allComments.length > 0 || matchingComments.length > 0;
  const displayComments = showAllComments ? allComments : matchingComments;

  const handleCreateLead = (comment?: CommentData) => {
    setSelectedComment(comment);
    setShowLeadDialog(true);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex gap-4">
            {/* Thumbnail */}
            <div className="flex-shrink-0">
              <a href={result.postUrl} target="_blank" rel="noopener noreferrer">
                <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-muted">
                  {result.thumbnailUrl ? (
                    <img
                      src={result.thumbnailUrl}
                      alt="Post thumbnail"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MediaIcon className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute top-1 right-1">
                    <Badge variant="secondary" className="text-xs px-1">
                      <MediaIcon className="h-3 w-3" />
                    </Badge>
                  </div>
                </div>
              </a>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <InstagramProfileHoverCard username={result.username} className="font-medium text-sm hover:text-primary" />
                  <Badge variant="outline" className="text-xs">
                    <Hash className="h-3 w-3 mr-0.5" />
                    {result.searchKeyword}
                  </Badge>
                  {result.isAd && (
                    <Badge variant="destructive" className="text-xs">Anúncio</Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(result.postUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>

              {/* Caption */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {result.caption || 'Sem legenda'}
              </p>

              {/* Metrics */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" />
                  {result.likesCount.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {result.commentsCount.toLocaleString()}
                </span>
                {result.viewsCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {result.viewsCount.toLocaleString()}
                  </span>
                )}
                {result.location && (
                  <span className="truncate max-w-[150px]">
                    📍 {result.location}
                  </span>
                )}
              </div>

              {/* Hashtags */}
              {result.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {result.hashtags.slice(0, 5).map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                  {result.hashtags.length > 5 && (
                    <Badge variant="outline" className="text-xs">
                      +{result.hashtags.length - 5}
                    </Badge>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onFetchComments}
                  disabled={isLoadingComments || !!result.comments}
                >
                  {isLoadingComments ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <MessageCircle className="h-4 w-4 mr-1" />
                  )}
                  {result.comments ? 'Comentários carregados' : 'Buscar Comentários'}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleCreateLead()}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  Criar Lead
                </Button>
              </div>

              {/* Expandable Comments Section */}
              {hasComments && (
                <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between mt-2 bg-muted/50">
                      <span className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4" />
                        {matchingComments.length > 0 ? (
                          <>
                            <Sparkles className="h-4 w-4 text-yellow-500" />
                            {matchingComments.length} comentários com palavras-chave
                          </>
                        ) : (
                          <>{allComments.length} comentários carregados</>
                        )}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-3 space-y-3">
                      {/* Toggle para ver todos ou só matches */}
                      {matchingComments.length > 0 && allComments.length > matchingComments.length && (
                        <div className="flex items-center gap-2 text-xs">
                          <Button
                            variant={!showAllComments ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setShowAllComments(false)}
                          >
                            Com palavras-chave ({matchingComments.length})
                          </Button>
                          <Button
                            variant={showAllComments ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setShowAllComments(true)}
                          >
                            Todos ({allComments.length})
                          </Button>
                        </div>
                      )}
                      
                      <ScrollArea className="max-h-[400px]">
                        <div className="space-y-3 pr-2">
                          {displayComments.map(comment => (
                            <CommentItem
                              key={comment.id}
                              comment={comment}
                              commentKeywords={commentKeywords}
                              onCreateLead={handleCreateLead}
                            />
                          ))}
                          {displayComments.length === 0 && allComments.length > 0 && (
                            <p className="text-xs text-muted-foreground italic text-center py-4">
                              Nenhum comentário com as palavras-chave selecionadas.
                              <Button
                                variant="link"
                                size="sm"
                                className="text-xs p-0 h-auto ml-1"
                                onClick={() => setShowAllComments(true)}
                              >
                                Ver todos os {allComments.length} comentários
                              </Button>
                            </p>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Status message when no matches */}
              {result.comments && !hasComments && (
                <p className="text-xs text-muted-foreground italic">
                  {result.comments.length} comentários carregados, nenhum disponível para exibição
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lead Creation Dialog */}
      <CreateLeadFromSearchDialog
        open={showLeadDialog}
        onOpenChange={setShowLeadDialog}
        postData={{
          postId: result.postId,
          postUrl: result.postUrl,
          username: result.username,
          caption: result.caption,
          location: result.location,
        }}
        comment={selectedComment}
      />
    </>
  );
}