import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ExternalLink,
  Trash2,
  Link2,
  Newspaper,
  MessageCircle,
  User,
  Calendar,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  FileText,
  Download,
  Loader2,
  Check,
} from 'lucide-react';
import { ShareMenu } from '@/components/ShareMenu';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ExternalPost } from '@/hooks/useExternalPosts';

interface ExternalPostCardProps {
  post: ExternalPost;
  onDelete: () => void;
  onLinkLead: () => void;
  onAddNewsLink: (link: string) => void;
  onRemoveNewsLink: (link: string) => void;
  onUpdateNotes: (notes: string) => void;
  onFetchComments: () => Promise<any>;
}

export function ExternalPostCard({
  post,
  onDelete,
  onLinkLead,
  onAddNewsLink,
  onRemoveNewsLink,
  onUpdateNotes,
  onFetchComments,
}: ExternalPostCardProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [newNewsLink, setNewNewsLink] = useState('');
  const [notes, setNotes] = useState(post.notes || '');
  const [notesChanged, setNotesChanged] = useState(false);
  const [isFetchingComments, setIsFetchingComments] = useState(false);

  const platformColors: Record<string, string> = {
    instagram: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
    facebook: 'bg-blue-600/10 text-blue-600 border-blue-600/30',
    tiktok: 'bg-black/10 text-black border-black/30 dark:bg-white/10 dark:text-white dark:border-white/30',
    other: 'bg-muted text-muted-foreground',
  };

  const handleAddNewsLink = () => {
    if (newNewsLink.trim()) {
      onAddNewsLink(newNewsLink.trim());
      setNewNewsLink('');
    }
  };

  const handleSaveNotes = () => {
    onUpdateNotes(notes);
    setNotesChanged(false);
  };

  const handleFetchComments = async () => {
    setIsFetchingComments(true);
    try {
      await onFetchComments();
    } finally {
      setIsFetchingComments(false);
    }
  };

  const getShortUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname.slice(0, 30) + (urlObj.pathname.length > 30 ? '...' : '');
    } catch {
      return url.slice(0, 50) + (url.length > 50 ? '...' : '');
    }
  };

  return (
    <>
      <div className="border rounded-lg p-4 hover:bg-muted/30 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="outline" className={platformColors[post.platform] || platformColors.other}>
                {post.platform}
              </Badge>
              {post.author_username && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <User className="h-3 w-3" />
                  @{post.author_username}
                </span>
              )}
              {post.lead && (
                <Badge variant="default" className="bg-green-600">
                  <Link2 className="h-3 w-3 mr-1" />
                  {post.lead.lead_name || 'Lead vinculado'}
                </Badge>
              )}
            </div>

            {/* URL */}
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1 mb-2"
            >
              <ExternalLink className="h-3 w-3" />
              {getShortUrl(post.url)}
            </a>

            {/* Title/Description */}
            {(post.title || post.description) && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {post.title || post.description}
              </p>
            )}

            {/* Meta Info */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Adicionado {format(new Date(post.created_at), "dd/MM/yyyy", { locale: ptBR })}
              </div>
              {post.comments_count !== null && (
                <div className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {post.comments_count} comentários
                </div>
              )}
              {post.last_fetched_at && (
                <div className="flex items-center gap-1">
                  <Download className="h-3 w-3" />
                  Última busca: {format(new Date(post.last_fetched_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                </div>
              )}
              {post.news_links && post.news_links.length > 0 && (
                <div className="flex items-center gap-1">
                  <Newspaper className="h-3 w-3" />
                  {post.news_links.length} notícia(s)
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 shrink-0">
            <ShareMenu entityType="post" entityId={post.id} entityName={post.title || post.author_username || 'Postagem'} size="sm" variant="outline" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleFetchComments}
              disabled={isFetchingComments}
            >
              {isFetchingComments ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onLinkLead}
            >
              <Link2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Expandable Section */}
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full mt-3">
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-2" />
                  Menos detalhes
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-2" />
                  Mais detalhes
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            {/* News Links */}
            <div>
              <label className="text-sm font-medium mb-2 flex items-center gap-2">
                <Newspaper className="h-4 w-4" />
                Links de Notícias
              </label>
              <div className="space-y-2">
                {post.news_links?.map((link, index) => (
                  <div key={index} className="flex items-center gap-2 bg-muted/50 rounded p-2">
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-sm text-primary hover:underline truncate"
                    >
                      {link}
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveNewsLink(link)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    placeholder="Adicionar link de notícia..."
                    value={newNewsLink}
                    onChange={(e) => setNewNewsLink(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddNewsLink()}
                  />
                  <Button size="sm" onClick={handleAddNewsLink}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm font-medium mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Notas
              </label>
              <div className="flex flex-col gap-2">
                <Textarea
                  placeholder="Adicione notas sobre este post..."
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setNotesChanged(true);
                  }}
                  rows={3}
                />
                {notesChanged && (
                  <Button size="sm" onClick={handleSaveNotes} className="self-end">
                    <Check className="h-4 w-4 mr-1" />
                    Salvar
                  </Button>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover post externo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá o post da lista, mas os comentários já importados permanecerão no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
