import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  MessageCircle,
  ExternalLink,
  Clock,
  Tag,
  Image,
  Search,
  History,
  Briefcase,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CommentTextWithMentions } from './CommentTextWithMentions';
import { CommentCardBadges } from './CommentCardBadges';
import { InstagramProfileHoverCard } from './InstagramProfileHoverCard';
import { QuickLinkLeadPopover } from './QuickLinkLeadPopover';
import { CommentClassificationDialog } from './CommentClassificationDialog';
import { ReplyStatusBadge } from './ReplyStatusBadge';
import { LeadHistorySheet } from './LeadHistorySheet';
import { PostPreviewCard } from './PostPreviewCard';
import { useCommentContactInfo } from '@/hooks/useCommentContactInfo';
import { useCommentCardSettings } from '@/hooks/useCommentCardSettings';
import { toast } from 'sonner';

interface HistoryComment {
  id?: string;
  comment_id?: string;
  comment_text?: string;
  text?: string;
  author_username?: string;
  ownerUsername?: string;
  created_at?: string;
  timestamp?: string;
  post_url?: string;
  replied_at?: string | null;
  metadata?: {
    likes_count?: number;
    post_owner?: string;
    post_caption?: string;
    post_thumbnail?: string;
    media_type?: 'image' | 'video';
    comments_count?: number;
    views_count?: number;
    manual_reply?: boolean;
    manual_reply_text?: string;
  };
}

interface PostMetadata {
  postUrl: string;
  caption?: string;
  thumbnailUrl?: string;
  mediaType?: 'image' | 'video';
  postOwner?: string;
  commentsCount?: number;
  viewsCount?: number;
}

interface HistoryCommentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postUrls: string[];
  comments: HistoryComment[];
  postMetadata?: PostMetadata;
}

export function HistoryCommentsDialog({
  open,
  onOpenChange,
  postUrls,
  comments,
  postMetadata,
}: HistoryCommentsDialogProps) {
  const [searchFilter, setSearchFilter] = useState('');
  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [classifyingComment, setClassifyingComment] = useState<HistoryComment | null>(null);
  const [showLeadHistory, setShowLeadHistory] = useState(false);
  const [selectedLead, setSelectedLead] = useState<{ id: string; lead_name: string | null; status: string | null; board_id: string | null } | null>(null);
  
  // Extract post info from first comment's metadata if not provided
  const derivedPostMetadata = useMemo(() => {
    if (postMetadata) return postMetadata;
    
    const firstCommentWithMeta = comments.find(c => c.metadata?.post_caption || c.metadata?.post_owner);
    if (!firstCommentWithMeta?.metadata) return null;
    
    return {
      postUrl: postUrls[0] || firstCommentWithMeta.post_url || '',
      caption: firstCommentWithMeta.metadata.post_caption,
      postOwner: firstCommentWithMeta.metadata.post_owner,
      thumbnailUrl: firstCommentWithMeta.metadata.post_thumbnail,
      mediaType: firstCommentWithMeta.metadata.media_type,
      commentsCount: comments.length,
    };
  }, [postMetadata, comments, postUrls]);

  // Normalize comments to consistent format
  const normalizedComments = useMemo(() => {
    return comments.map(c => ({
      id: c.id,
      comment_id: c.comment_id || c.id,
      comment_text: c.comment_text || c.text || '',
      author_username: c.author_username || c.ownerUsername || '',
      created_at: c.created_at || c.timestamp || '',
      post_url: c.post_url || '',
      replied_at: c.replied_at,
      metadata: c.metadata,
    }));
  }, [comments]);

  // Get usernames for contact info
  const usernames = normalizedComments.map(c => c.author_username).filter(Boolean);
  const { getContactData, refetch: refetchContactData, refetchUsername } = useCommentContactInfo(usernames);
  const { config: cardConfig } = useCommentCardSettings();

  // Filter comments
  const filteredComments = useMemo(() => {
    if (!searchFilter.trim()) return normalizedComments;
    
    const search = searchFilter.toLowerCase();
    return normalizedComments.filter(comment =>
      comment.comment_text?.toLowerCase().includes(search) ||
      comment.author_username?.toLowerCase().includes(search)
    );
  }, [normalizedComments, searchFilter]);

  const openClassificationDialog = (comment: typeof normalizedComments[0]) => {
    setClassifyingComment(comment);
    setShowClassificationDialog(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Comentários Extraídos ({comments.length})
            </DialogTitle>
          </DialogHeader>
          
          {/* Post Preview */}
          {derivedPostMetadata && (
            <PostPreviewCard
              postUrl={derivedPostMetadata.postUrl}
              caption={derivedPostMetadata.caption}
              thumbnailUrl={derivedPostMetadata.thumbnailUrl}
              mediaType={derivedPostMetadata.mediaType}
              postOwner={derivedPostMetadata.postOwner}
              commentsCount={derivedPostMetadata.commentsCount}
            />
          )}
          
          {/* Fallback: Simple post links if no metadata */}
          {!derivedPostMetadata && postUrls.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {postUrls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline bg-muted px-2 py-1 rounded"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ver Post {postUrls.length > 1 ? i + 1 : ''}
                </a>
              ))}
            </div>
          )}

          {/* Search Filter */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar nos comentários..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-10"
            />
            {searchFilter && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {filteredComments.length} encontrados
              </span>
            )}
          </div>
          
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="space-y-3 pr-4">
              {filteredComments.length > 0 ? (
                filteredComments.map((comment, index) => (
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
                            className="bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white"
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
                          
                          {/* Show linked leads with history button */}
                          {getContactData(comment.author_username).linkedLeads.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {getContactData(comment.author_username).linkedLeads.map((lead) => (
                                <Button
                                  key={lead.id}
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs gap-1 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-700"
                                  onClick={() => {
                                    setSelectedLead(lead);
                                    setShowLeadHistory(true);
                                  }}
                                >
                                  <Briefcase className="h-3 w-3" />
                                  <span className="max-w-[150px] truncate">
                                    {lead.lead_name || 'Lead'}
                                  </span>
                                  <History className="h-3 w-3" />
                                </Button>
                              ))}
                            </div>
                          )}
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
                        {comment.created_at && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </div>
                        )}
                        
                        {/* Reply status */}
                        <ReplyStatusBadge 
                          repliedAt={comment.replied_at || null}
                          metadata={comment.metadata as { manual_reply?: boolean; manual_reply_text?: string } | null}
                        />
                        
                        {/* Open post on Instagram + copy comment text to help find it */}
                        {comment.post_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50"
                            onClick={() => {
                              window.open(comment.post_url, '_blank');
                              
                              // Copy comment text to help find with Ctrl+F
                              // Use first 50 chars of comment for search
                              if (comment.comment_text) {
                                const searchText = comment.comment_text.slice(0, 50);
                                navigator.clipboard.writeText(searchText);
                                toast.info(
                                  <div className="space-y-1">
                                    <p className="font-medium">Texto copiado para busca:</p>
                                    <p className="text-xs text-muted-foreground">"{searchText.slice(0, 30)}..."</p>
                                    <p className="text-xs">Use Ctrl+F no Instagram para encontrar!</p>
                                  </div>
                                );
                              }
                            }}
                          >
                            <ExternalLink className="h-3 w-3 mr-1 text-amber-600" />
                            Ir para Post
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
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{searchFilter ? 'Nenhum comentário encontrado' : 'Nenhum comentário extraído'}</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      
      {/* Classification Dialog */}
      <CommentClassificationDialog
        open={showClassificationDialog}
        onOpenChange={setShowClassificationDialog}
        comment={classifyingComment ? {
          id: classifyingComment.comment_id || '',
          author_username: classifyingComment.author_username || '',
          comment_text: classifyingComment.comment_text || '',
          post_url: classifyingComment.post_url || '',
          platform: 'instagram',
        } : null}
        onClassificationsApplied={() => {
          refetchContactData();
        }}
        onLeadLinked={refetchContactData}
      />
      
      {/* Lead History Sheet */}
      <LeadHistorySheet
        open={showLeadHistory}
        onOpenChange={setShowLeadHistory}
        lead={selectedLead}
      />
    </>
  );
}
