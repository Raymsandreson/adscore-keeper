import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageCircle,
  ExternalLink,
  Clock,
  Tag,
  Image,
  Search,
  History,
  Briefcase,
  Loader2,
  User,
  Pencil,
  Bot,
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
import { AIReplyDialog } from './AIReplyDialog';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { 
  AdvancedSearchFilters, 
  AdvancedFilters, 
  emptyFilters, 
  hasActiveFilters, 
  applyAdvancedFilters 
} from './AdvancedSearchFilters';
import { useCommentContactInfo } from '@/hooks/useCommentContactInfo';
import { useCommentCardSettings } from '@/hooks/useCommentCardSettings';
import { usePostMetadata, PostMetadata as FetchedPostMetadata } from '@/hooks/usePostMetadata';
import { useLeads, Lead } from '@/hooks/useLeads';
import { Contact } from '@/hooks/useContacts';
import { supabase } from '@/integrations/supabase/client';
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
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(emptyFilters);
  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [classifyingComment, setClassifyingComment] = useState<HistoryComment | null>(null);
  const [showLeadHistory, setShowLeadHistory] = useState(false);
  const [selectedLead, setSelectedLead] = useState<{ id: string; lead_name: string | null; status: string | null; board_id: string | null } | null>(null);
  const [fetchedMetadata, setFetchedMetadata] = useState<FetchedPostMetadata | null>(null);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  
  // Edit states
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [showLeadEdit, setShowLeadEdit] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [showContactEdit, setShowContactEdit] = useState(false);
  const [fullContact, setFullContact] = useState<Contact | null>(null);
  const [fullLead, setFullLead] = useState<Lead | null>(null);
  const [showAIReplyDialog, setShowAIReplyDialog] = useState(false);
  const [aiReplyComment, setAiReplyComment] = useState<any>(null);
  
  const { fetchMetadata, getCachedMetadata } = usePostMetadata();
  const { updateLead, leads } = useLeads();
  
  // Fetch metadata from Instagram when dialog opens if not already available
  useEffect(() => {
    if (!open || !postUrls[0]) return;
    
    // Check if we already have metadata
    const existingMeta = postMetadata?.thumbnailUrl || postMetadata?.caption;
    if (existingMeta) return;
    
    // Check cache first
    const cached = getCachedMetadata(postUrls[0]);
    if (cached) {
      setFetchedMetadata(cached);
      return;
    }
    
    // Fetch from API
    const doFetch = async () => {
      setIsFetchingMeta(true);
      try {
        const meta = await fetchMetadata(postUrls[0]);
        if (meta) {
          setFetchedMetadata(meta);
        }
      } finally {
        setIsFetchingMeta(false);
      }
    };
    
    doFetch();
  }, [open, postUrls, postMetadata, fetchMetadata, getCachedMetadata]);
  
  // Build final metadata combining provided + fetched
  const derivedPostMetadata = useMemo(() => {
    const baseUrl = postUrls[0] || '';
    
    // Priority: provided props > fetched > from comments
    if (postMetadata?.thumbnailUrl || postMetadata?.caption) {
      return postMetadata;
    }
    
    if (fetchedMetadata) {
      return {
        postUrl: baseUrl,
        caption: fetchedMetadata.caption,
        thumbnailUrl: fetchedMetadata.thumbnailUrl || undefined,
        mediaType: fetchedMetadata.mediaType,
        postOwner: fetchedMetadata.ownerUsername,
        commentsCount: comments.length,
      };
    }
    
    // Try from first comment metadata
    const firstCommentWithMeta = comments.find(c => c.metadata?.post_caption || c.metadata?.post_owner);
    if (firstCommentWithMeta?.metadata) {
      return {
        postUrl: baseUrl || firstCommentWithMeta.post_url || '',
        caption: firstCommentWithMeta.metadata.post_caption,
        postOwner: firstCommentWithMeta.metadata.post_owner,
        thumbnailUrl: firstCommentWithMeta.metadata.post_thumbnail,
        mediaType: firstCommentWithMeta.metadata.media_type,
        commentsCount: comments.length,
      };
    }
    
    // Minimal fallback
    return baseUrl ? { postUrl: baseUrl, commentsCount: comments.length } : null;
  }, [postMetadata, fetchedMetadata, comments, postUrls]);

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

  // Filter comments with basic search + advanced filters
  const filteredComments = useMemo(() => {
    let results = normalizedComments;
    
    // Basic search filter
    if (searchFilter.trim()) {
      const search = searchFilter.toLowerCase();
      results = results.filter(comment =>
        comment.comment_text?.toLowerCase().includes(search) ||
        comment.author_username?.toLowerCase().includes(search)
      );
    }
    
    // Advanced filters
    if (hasActiveFilters(advancedFilters)) {
      results = results.filter(comment => {
        const textToSearch = `${comment.comment_text || ''} ${comment.author_username || ''}`;
        return applyAdvancedFilters(textToSearch, advancedFilters);
      });
    }
    
    return results;
  }, [normalizedComments, searchFilter, advancedFilters]);
  
  const totalActiveFilters = (searchFilter.trim() ? 1 : 0) + 
    [advancedFilters.allWords, advancedFilters.exactPhrase, advancedFilters.anyWords, advancedFilters.excludeWords].filter(Boolean).length;

  const openClassificationDialog = (comment: typeof normalizedComments[0]) => {
    setClassifyingComment(comment);
    setShowClassificationDialog(true);
  };
  
  // Fetch full contact when editing
  useEffect(() => {
    if (!editingContactId || !showContactEdit) return;
    
    const fetchContact = async () => {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', editingContactId)
        .single();
      
      if (data) {
        setFullContact(data as Contact);
      }
    };
    
    fetchContact();
  }, [editingContactId, showContactEdit]);
  
  // Fetch full lead when editing by ID
  useEffect(() => {
    if (!editingLeadId || !showLeadEdit || fullLead) return;
    
    const fetchLead = async () => {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', editingLeadId)
        .single();
      
      if (data) {
        setFullLead(data as Lead);
      }
    };
    
    fetchLead();
  }, [editingLeadId, showLeadEdit, fullLead]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
          {/* Fixed Header */}
          <div className="p-6 pb-4 border-b flex-shrink-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Comentários Extraídos ({comments.length})
              </DialogTitle>
            </DialogHeader>
            
            {/* Post Preview - Always show when we have URLs */}
            {postUrls.length > 0 && (
              <div className="mt-4">
                {isFetchingMeta ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-fuchsia-500/5 to-rose-500/5 border border-fuchsia-500/20">
                    <Skeleton className="w-12 h-12 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <PostPreviewCard
                    postUrl={derivedPostMetadata?.postUrl || postUrls[0]}
                    caption={derivedPostMetadata?.caption}
                    thumbnailUrl={derivedPostMetadata?.thumbnailUrl}
                    mediaType={derivedPostMetadata?.mediaType}
                    postOwner={derivedPostMetadata?.postOwner}
                    commentsCount={derivedPostMetadata?.commentsCount || comments.length}
                    viewsCount={derivedPostMetadata?.viewsCount}
                  />
                )}
              </div>
            )}

            {/* Search Filter */}
            <div className="space-y-2 mt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar nos comentários..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="pl-10"
                />
                {(searchFilter || hasActiveFilters(advancedFilters)) && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {filteredComments.length} encontrados
                  </span>
                )}
              </div>
              
              {/* Advanced Filters */}
              <AdvancedSearchFilters
                filters={advancedFilters}
                onFiltersChange={setAdvancedFilters}
                onClear={() => setAdvancedFilters(emptyFilters)}
              />
            </div>
          </div>
          
          {/* Scrollable Content - using native scroll */}
          <div className="flex-1 overflow-y-auto p-6 pt-4">
            <div className="space-y-3">
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
                          
                        {/* Show linked leads with edit button */}
                        {getContactData(comment.author_username).linkedLeads.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {getContactData(comment.author_username).linkedLeads.map((lead) => (
                              <div key={lead.id} className="flex items-center gap-0.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs gap-1 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-700"
                                  onClick={() => {
                                    setSelectedLead(lead);
                                    setShowLeadHistory(true);
                                  }}
                                >
                                  <Briefcase className="h-3 w-3" />
                                  <span className="max-w-[100px] truncate">
                                    {lead.lead_name || 'Lead'}
                                  </span>
                                  <History className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-500/20"
                                  onClick={() => {
                                    const fullLeadData = leads?.find(l => l.id === lead.id);
                                    if (fullLeadData) {
                                      setFullLead(fullLeadData);
                                      setShowLeadEdit(true);
                                    } else {
                                      setEditingLeadId(lead.id);
                                      setShowLeadEdit(true);
                                    }
                                  }}
                                  title="Editar Lead"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Show contact with edit button */}
                        {getContactData(comment.author_username).contact && (
                          <div className="flex items-center gap-1 mt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs gap-1 bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20 text-blue-700"
                              onClick={() => {
                                const contactInfo = getContactData(comment.author_username).contact;
                                if (contactInfo) {
                                  setEditingContactId(contactInfo.id);
                                  setShowContactEdit(true);
                                }
                              }}
                            >
                              <User className="h-3 w-3" />
                              <span className="max-w-[120px] truncate">
                                {getContactData(comment.author_username).contact?.full_name || comment.author_username}
                              </span>
                              <Pencil className="h-3 w-3" />
                            </Button>
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
                        
                        {/* AI Reply + DM button */}
                        {comment.author_username && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs bg-gradient-to-r from-violet-500/10 to-blue-500/10 border-violet-500/30 hover:border-violet-500/50"
                            onClick={() => {
                              setAiReplyComment({
                                id: comment.id || comment.comment_id || '',
                                comment_id: comment.comment_id,
                                comment_text: comment.comment_text,
                                author_username: comment.author_username,
                                post_url: comment.post_url,
                              });
                              setShowAIReplyDialog(true);
                            }}
                          >
                            <Bot className="h-3 w-3 mr-1 text-violet-600" />
                            IA Comentário + DM
                          </Button>
                        )}
                        
                        {/* Edit Lead button - shown when contact has linked leads */}
                        {comment.author_username && getContactData(comment.author_username).linkedLeads.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs bg-gradient-to-r from-emerald-500/10 to-green-500/10 border-emerald-500/30 hover:border-emerald-500/50"
                            onClick={async () => {
                              const linkedLeads = getContactData(comment.author_username).linkedLeads;
                              const firstLead = linkedLeads[0];
                              if (firstLead) {
                                // Try local first
                                const fullLeadData = leads?.find(l => l.id === firstLead.id);
                                if (fullLeadData) {
                                  setFullLead(fullLeadData);
                                  setShowLeadEdit(true);
                                } else {
                                  // Fetch from database
                                  const { data } = await supabase
                                    .from('leads')
                                    .select('*')
                                    .eq('id', firstLead.id)
                                    .single();
                                  if (data) {
                                    setFullLead(data as Lead);
                                    setShowLeadEdit(true);
                                  } else {
                                    toast.error('Lead não encontrado');
                                  }
                                }
                              }
                            }}
                          >
                            <Briefcase className="h-3 w-3 mr-1 text-emerald-600" />
                            Editar Lead
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
          </div>
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
      
      {/* Lead Edit Sheet (side panel) */}
      {fullLead && (
        <LeadEditDialog
          open={showLeadEdit}
          onOpenChange={(open) => {
            setShowLeadEdit(open);
            if (!open) {
              setFullLead(null);
              setEditingLeadId(null);
            }
          }}
          lead={fullLead}
          mode="sheet"
          onSave={async (leadId, updates) => {
            await updateLead(leadId, updates);
            refetchContactData();
          }}
        />
      )}
      
      {/* Contact Edit Sheet */}
      <ContactDetailSheet
        open={showContactEdit}
        onOpenChange={(open) => {
          setShowContactEdit(open);
          if (!open) {
            setFullContact(null);
            setEditingContactId(null);
          }
        }}
        contact={fullContact}
        onContactUpdated={refetchContactData}
      />
      
      {/* AI Reply + DM Dialog */}
      <AIReplyDialog
        open={showAIReplyDialog}
        onOpenChange={setShowAIReplyDialog}
        comment={aiReplyComment}
        isThirdPartyPost={true}
        onReplyPosted={() => {
          refetchContactData();
        }}
      />
    </>
  );
}
