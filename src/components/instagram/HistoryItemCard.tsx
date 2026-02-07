import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Link2,
  Hash,
  Clock,
  ExternalLink,
  MessageCircle,
  Trash2,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePostMetadata } from '@/hooks/usePostMetadata';
import type { Json } from '@/integrations/supabase/types';

interface HistoryItem {
  id: string;
  search_type?: 'hashtag' | 'post';
  post_urls?: string[];
  keywords?: string[];
  results?: Json | null;
  results_count?: number | null;
  status?: string | null;
  created_at: string;
  cost_brl?: number | null;
}

interface HistoryItemCardProps {
  item: HistoryItem;
  onViewComments: (item: HistoryItem) => void;
  onLoadResults: (item: HistoryItem) => void;
  onResume: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  isResuming: boolean;
}

export function HistoryItemCard({
  item,
  onViewComments,
  onLoadResults,
  onResume,
  onDelete,
  isResuming,
}: HistoryItemCardProps) {
  const isPostExtraction = item.search_type === 'post';
  const { fetchMetadata, getCachedMetadata } = usePostMetadata();
  const [postMeta, setPostMeta] = useState<{
    thumbnailUrl?: string;
    caption?: string;
    ownerUsername?: string;
  } | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);

  // Fetch metadata for post extractions
  useEffect(() => {
    if (!isPostExtraction || !item.post_urls?.[0]) return;

    // Check cache first
    const cached = getCachedMetadata(item.post_urls[0]);
    if (cached) {
      setPostMeta({
        thumbnailUrl: cached.thumbnailUrl || undefined,
        caption: cached.caption,
        ownerUsername: cached.ownerUsername,
      });
      return;
    }

    // Fetch from API
    const doFetch = async () => {
      setIsLoadingMeta(true);
      try {
        const meta = await fetchMetadata(item.post_urls![0]);
        if (meta) {
          setPostMeta({
            thumbnailUrl: meta.thumbnailUrl || undefined,
            caption: meta.caption,
            ownerUsername: meta.ownerUsername,
          });
        }
      } finally {
        setIsLoadingMeta(false);
      }
    };

    doFetch();
  }, [isPostExtraction, item.post_urls, fetchMetadata, getCachedMetadata]);

  const extractShortcode = (url: string) => {
    const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : url.substring(0, 20) + '...';
  };

  return (
    <div className="border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        {/* Thumbnail preview for post extractions */}
        {isPostExtraction && (
          <a
            href={item.post_urls?.[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0"
          >
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gradient-to-br from-fuchsia-500/20 to-rose-500/20 flex items-center justify-center">
              {isLoadingMeta ? (
                <Skeleton className="w-full h-full" />
              ) : postMeta?.thumbnailUrl ? (
                <img
                  src={postMeta.thumbnailUrl}
                  alt="Post"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement!.querySelector('.fallback-icon')?.classList.remove('hidden');
                  }}
                />
              ) : (
                <Link2 className="h-6 w-6 text-fuchsia-500" />
              )}
              <Link2 className="h-6 w-6 text-fuchsia-500 hidden fallback-icon" />
            </div>
          </a>
        )}

        <div className="flex-1 min-w-0">
          {/* Type indicator + content */}
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={isPostExtraction ? 'outline' : 'secondary'} className="text-xs gap-1">
              {isPostExtraction ? <Link2 className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
              {isPostExtraction ? 'Post' : 'Hashtag'}
            </Badge>
            {postMeta?.ownerUsername && (
              <span className="text-xs font-medium">@{postMeta.ownerUsername}</span>
            )}
          </div>

          {/* Caption preview for post extractions */}
          {postMeta?.caption && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
              {postMeta.caption}
            </p>
          )}

          <div className="flex flex-wrap gap-1 mb-1">
            {isPostExtraction ? (
              // Show post URLs for post extractions
              item.post_urls?.slice(0, 2).map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {extractShortcode(url)}
                </a>
              ))
            ) : (
              // Show keywords for hashtag searches
              item.keywords?.map((kw, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {kw}
                </Badge>
              ))
            )}
            {isPostExtraction && (item.post_urls?.length || 0) > 2 && (
              <Badge variant="outline" className="text-xs">
                +{(item.post_urls?.length || 0) - 2}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}
            <span>•</span>
            <span>{item.results_count || 0} {isPostExtraction ? 'comentários' : 'posts'}</span>
            {item.cost_brl && item.cost_brl > 0 && (
              <>
                <span>•</span>
                <span className="text-primary font-medium">
                  R$ {item.cost_brl.toFixed(2)}
                </span>
              </>
            )}
            <span>•</span>
            <Badge
              variant={item.status === 'completed' ? 'default' : item.status === 'running' ? 'secondary' : 'destructive'}
              className="text-xs"
            >
              {item.status === 'completed' ? 'Concluída' : item.status === 'running' ? 'Em andamento' : 'Falhou'}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end">
        {!isPostExtraction && item.status === 'completed' && item.results_count && item.results_count > 0 ? (
          <Button
            variant="default"
            size="sm"
            onClick={() => onLoadResults(item)}
            className="gap-1"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir
          </Button>
        ) : !isPostExtraction && item.status === 'running' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResume(item)}
            disabled={isResuming}
            className="gap-1"
          >
            {isResuming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Retomando...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Retomar
              </>
            )}
          </Button>
        ) : isPostExtraction && item.status === 'completed' && item.results_count && item.results_count > 0 ? (
          <Button
            variant="default"
            size="sm"
            onClick={() => onViewComments(item)}
            className="gap-1"
          >
            <MessageCircle className="h-4 w-4" />
            Ver Comentários
          </Button>
        ) : isPostExtraction && item.post_urls?.[0] ? (
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href={item.post_urls[0]}
              target="_blank"
              rel="noopener noreferrer"
              className="gap-1"
            >
              <ExternalLink className="h-4 w-4" />
              Ver Post
            </a>
          </Button>
        ) : !isPostExtraction && (
          <Badge variant="destructive" className="text-xs">
            Sem resultados
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.id)}
          disabled={isResuming}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
