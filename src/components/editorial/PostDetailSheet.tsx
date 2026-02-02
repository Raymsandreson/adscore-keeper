import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Calendar, 
  Clock, 
  User, 
  Hash,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Pencil,
  Trash2,
  TrendingUp,
  Link as LinkIcon,
  ExternalLink
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./PlatformIcon";
import type { Post, PostStatus } from "@/types/editorial";
import { statusConfig as defaultStatusConfig, contentTypeConfig, platformConfig } from "@/types/editorial";

interface StatusConfig {
  label: string;
  className: string;
}

interface PostDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Post | null;
  onEdit: () => void;
  onDelete: (id: string) => void;
  statusConfig?: Record<PostStatus, StatusConfig>;
}

export function PostDetailSheet({ 
  open, 
  onOpenChange, 
  post, 
  onEdit, 
  onDelete,
  statusConfig: externalStatusConfig 
}: PostDetailSheetProps) {
  if (!post) return null;

  const statusConfig = externalStatusConfig || defaultStatusConfig;
  if (!post) return null;

  const hasEngagement = post.engagement_likes || post.engagement_comments || post.engagement_shares || post.engagement_reach;

  const engagementRate = hasEngagement && post.engagement_reach
    ? (((post.engagement_likes || 0) + (post.engagement_comments || 0) + (post.engagement_shares || 0)) / post.engagement_reach * 100).toFixed(2)
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <PlatformIcon platform={post.platform} className="h-5 w-5" />
            <SheetTitle className="text-left">{post.title}</SheetTitle>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Type and Platform */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">
              {contentTypeConfig[post.content_type] || post.content_type}
            </Badge>
            {platformConfig[post.platform] && (
              <Badge variant="outline" className={platformConfig[post.platform].bgColor}>
                {platformConfig[post.platform].label}
              </Badge>
            )}
          </div>

          {/* Tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.tags.map(tag => (
                <span
                  key={tag.id}
                  className={cn("px-2 py-1 rounded-full text-xs text-white", tag.color)}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          {post.description && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Descrição</h4>
              <p className="text-sm">{post.description}</p>
            </div>
          )}

          <Separator />

          {/* Schedule Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Data</p>
                <p className="text-sm font-medium">
                  {format(post.scheduled_date, "dd 'de' MMMM, yyyy", { locale: ptBR })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Horário</p>
                <p className="text-sm font-medium">{post.scheduled_time}</p>
              </div>
            </div>
          </div>

          {post.assigned_to && (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Responsável</p>
                <p className="text-sm font-medium">{post.assigned_to}</p>
              </div>
            </div>
          )}

          {/* Links */}
          {post.links && post.links.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Links</span>
              </div>
              <div className="space-y-1">
                {post.links.map((link, index) => (
                  <a
                    key={index}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg text-sm text-primary hover:bg-muted transition-colors"
                  >
                    <span className="truncate flex-1">{link}</span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Hashtags */}
          {post.hashtags && post.hashtags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Hashtags</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {post.hashtags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-primary/20 text-primary rounded-full text-xs"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {post.notes && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Observações</h4>
              <p className="text-sm p-3 bg-muted/50 rounded-lg">{post.notes}</p>
            </div>
          )}

          {/* Engagement Metrics (only for published posts) */}
          {hasEngagement && (
            <>
              <Separator />
              <div className="space-y-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Métricas de Engajamento
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Eye className="h-4 w-4" />
                      <span className="text-xs">Alcance</span>
                    </div>
                    <p className="text-xl font-bold mt-1">
                      {(post.engagement_reach || 0).toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Heart className="h-4 w-4" />
                      <span className="text-xs">Curtidas</span>
                    </div>
                    <p className="text-xl font-bold mt-1">
                      {(post.engagement_likes || 0).toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MessageCircle className="h-4 w-4" />
                      <span className="text-xs">Comentários</span>
                    </div>
                    <p className="text-xl font-bold mt-1">
                      {(post.engagement_comments || 0).toLocaleString()}
                    </p>
                  </div>

                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Share2 className="h-4 w-4" />
                      <span className="text-xs">Compartilhamentos</span>
                    </div>
                    <p className="text-xl font-bold mt-1">
                      {(post.engagement_shares || 0).toLocaleString()}
                    </p>
                  </div>
                </div>

                {engagementRate && (
                  <div className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20">
                    <p className="text-sm text-muted-foreground">Taxa de Engajamento</p>
                    <p className="text-2xl font-bold text-primary">{engagementRate}%</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <SheetFooter className="mt-8 flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(post.id)}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Excluir
          </Button>
          <Button onClick={onEdit} className="gap-2 flex-1">
            <Pencil className="h-4 w-4" />
            Editar Atividade
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
