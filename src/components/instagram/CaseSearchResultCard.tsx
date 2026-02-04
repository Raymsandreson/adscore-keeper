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
  User,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

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
  onCreateLead: (comment?: CommentData) => void;
}

export function CaseSearchResultCard({
  result,
  commentKeywords,
  isLoadingComments,
  onFetchComments,
  onCreateLead,
}: CaseSearchResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const highlightKeywords = (text: string) => {
    let highlightedText = text;
    commentKeywords.forEach(kw => {
      const regex = new RegExp(`(${kw})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">$1</mark>');
    });
    return highlightedText;
  };

  const MediaIcon = result.mediaType === 'video' ? Video : Image;

  return (
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
                <a
                  href={result.userUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sm hover:text-primary flex items-center gap-1"
                >
                  <User className="h-3 w-3" />
                  @{result.username}
                </a>
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
                onClick={() => onCreateLead()}
              >
                <UserPlus className="h-4 w-4 mr-1" />
                Criar Lead
              </Button>
            </div>

            {/* Matching Comments */}
            {result.matchingComments && result.matchingComments.length > 0 && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-yellow-500" />
                      {result.matchingComments.length} comentários com palavras-chave
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-[200px] mt-2">
                    <div className="space-y-2">
                      {result.matchingComments.map(comment => (
                        <div
                          key={comment.id}
                          className="bg-muted/50 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <a
                              href={`https://instagram.com/${comment.ownerUsername}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-xs hover:text-primary"
                            >
                              @{comment.ownerUsername}
                            </a>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onCreateLead(comment)}
                            >
                              <UserPlus className="h-3 w-3 mr-1" />
                              Lead
                            </Button>
                          </div>
                          <p
                            className="text-muted-foreground text-xs"
                            dangerouslySetInnerHTML={{ __html: highlightKeywords(comment.text) }}
                          />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* All Comments (if loaded but no matches) */}
            {result.comments && result.matchingComments?.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                {result.comments.length} comentários carregados, nenhum com as palavras-chave selecionadas
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
