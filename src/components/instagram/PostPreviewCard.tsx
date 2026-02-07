import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ExternalLink,
  Image,
  Video,
  ChevronDown,
  ChevronUp,
  Heart,
  MessageCircle,
  Eye,
  User,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface PostPreviewCardProps {
  postUrl: string;
  caption?: string;
  thumbnailUrl?: string;
  mediaType?: 'image' | 'video';
  likesCount?: number;
  commentsCount?: number;
  viewsCount?: number;
  postOwner?: string;
  compact?: boolean;
}

export function PostPreviewCard({
  postUrl,
  caption,
  thumbnailUrl,
  mediaType = 'image',
  likesCount,
  commentsCount,
  viewsCount,
  postOwner,
  compact = false,
}: PostPreviewCardProps) {
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const MediaIcon = mediaType === 'video' ? Video : Image;
  const hasCaption = caption && caption.length > 0;
  const isLongCaption = caption && caption.length > 120;

  // Extract shortcode from URL for display
  const extractShortcode = (url: string) => {
    const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : null;
  };

  const shortcode = extractShortcode(postUrl);

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-fuchsia-500/5 to-rose-500/5 border border-fuchsia-500/20">
        {/* Thumbnail */}
        <a 
          href={postUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex-shrink-0"
        >
          <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-gradient-to-br from-fuchsia-500/20 to-rose-500/20 flex items-center justify-center">
            {thumbnailUrl && !imageError ? (
              <img
                src={thumbnailUrl}
                alt="Post"
                className="w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <MediaIcon className="h-5 w-5 text-fuchsia-500" />
            )}
          </div>
        </a>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white border-0 text-[10px] h-4">
              Postagem
            </Badge>
            {postOwner && (
              <span className="text-xs font-medium truncate">@{postOwner}</span>
            )}
            {!postOwner && shortcode && (
              <span className="text-xs text-muted-foreground truncate">{shortcode}</span>
            )}
          </div>
          {hasCaption && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {caption}
            </p>
          )}
          {!hasCaption && commentsCount !== undefined && commentsCount > 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MessageCircle className="h-3 w-3" />
              {commentsCount.toLocaleString('pt-BR')} comentários
            </p>
          )}
        </div>
        
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => window.open(postUrl, '_blank')}
        >
          <ExternalLink className="h-3 w-3" />
          Abrir
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-gradient-to-br from-fuchsia-500/5 via-rose-500/5 to-orange-500/5 overflow-hidden">
      <div className="flex gap-4 p-4">
        {/* Thumbnail */}
        <a 
          href={postUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex-shrink-0 group"
        >
          <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-muted">
            {thumbnailUrl && !imageError ? (
              <img
                src={thumbnailUrl}
                alt="Post thumbnail"
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <MediaIcon className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            {/* Media type badge */}
            <div className="absolute top-1 right-1">
              <Badge variant="secondary" className="h-5 px-1">
                <MediaIcon className="h-3 w-3" />
              </Badge>
            </div>
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <ExternalLink className="h-5 w-5 text-white" />
            </div>
          </div>
        </a>
        
        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white border-0">
                <Image className="h-3 w-3 mr-1" />
                Postagem
              </Badge>
              {postOwner && (
                <span className="text-sm font-medium flex items-center gap-1">
                  <User className="h-3 w-3 text-muted-foreground" />
                  @{postOwner}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => window.open(postUrl, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
              Abrir
            </Button>
          </div>
          
          {/* Caption */}
          {hasCaption && (
            <div 
              className={`cursor-pointer group ${isLongCaption ? 'hover:bg-muted/30 rounded p-1 -m-1' : ''}`}
              onClick={() => isLongCaption && setIsCaptionExpanded(!isCaptionExpanded)}
            >
              <p className={`text-sm text-muted-foreground transition-all ${isCaptionExpanded ? '' : 'line-clamp-2'}`}>
                {caption}
              </p>
              {isLongCaption && (
                <button className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1">
                  {isCaptionExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Ver menos
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Ver legenda completa
                    </>
                  )}
                </button>
              )}
            </div>
          )}
          
          {/* Metrics */}
          {(likesCount !== undefined || commentsCount !== undefined || viewsCount !== undefined) && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {likesCount !== undefined && likesCount > 0 && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" />
                  {likesCount.toLocaleString('pt-BR')}
                </span>
              )}
              {commentsCount !== undefined && commentsCount > 0 && (
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {commentsCount.toLocaleString('pt-BR')}
                </span>
              )}
              {viewsCount !== undefined && viewsCount > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {viewsCount.toLocaleString('pt-BR')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PostPreviewCardSkeleton() {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex gap-4">
        <Skeleton className="w-20 h-20 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-4">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}
