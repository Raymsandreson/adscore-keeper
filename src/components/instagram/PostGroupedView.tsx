import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageCircle,
  Search,
  Loader2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Play,
  Image as ImageIcon,
  User,
  Bot,
  Sparkles,
  Tag,
  CheckCircle2,
  Briefcase,
  UserPlus,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { usePostMetadata, PostMetadata } from '@/hooks/usePostMetadata';
import { cn } from '@/lib/utils';
import { AIReplyDialog } from './AIReplyDialog';
import { QuickLinkLeadPopover } from './QuickLinkLeadPopover';
import { CommentClassificationDialog } from './CommentClassificationDialog';
import { ProfessionBadgePopover } from './ProfessionBadgePopover';
import { PostDmContactRegistration } from './PostDmContactRegistration';
import { CommentContactBadges } from './CommentContactBadges';
import { useCommentContactInfo, type CommentContactData } from '@/hooks/useCommentContactInfo';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { Lead } from '@/hooks/useLeads';

interface PostGroup {
  postUrl: string;
  commentCount: number;
  firstCommentAt: string;
}

interface Comment {
  id: string;
  comment_id: string | null;
  comment_text: string | null;
  author_username: string | null;
  comment_type: string;
  created_at: string;
  parent_comment_id: string | null;
  post_url: string | null;
  replied_at: string | null;
  platform: string;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname.replace(/\/$/, '');
    path = path.replace(/\/reels\//i, '/reel/');
    return `${parsed.origin}${path}`;
  } catch {
    return url.replace(/\?.*$/, '').replace(/\/$/, '');
  }
}

export function PostGroupedView() {
  const [postGroups, setPostGroups] = useState<PostGroup[]>([]);
  const [selectedPostUrl, setSelectedPostUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [metadataMap, setMetadataMap] = useState<Record<string, PostMetadata | null>>({});
  const [loadingMetadata, setLoadingMetadata] = useState<Set<string>>(new Set());
  const { fetchMetadata, getCachedMetadata } = usePostMetadata();

  // Collect unique usernames for contact info
  const commentUsernames = useMemo(() => {
    return comments
      .filter(c => c.author_username)
      .map(c => c.author_username!);
  }, [comments]);

  const { getContactData, refetch: refetchContacts } = useCommentContactInfo(commentUsernames);

  // Dialog states
  const [showAIReplyDialog, setShowAIReplyDialog] = useState(false);
  const [replyingToComment, setReplyingToComment] = useState<Comment | null>(null);
  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [classifyingComment, setClassifyingComment] = useState<Comment | null>(null);
  const [showContactRegistration, setShowContactRegistration] = useState(false);
  const [registeringUsername, setRegisteringUsername] = useState<string>('');
  const [accessToken, setAccessToken] = useState<string | undefined>();
  const [detailContact, setDetailContact] = useState<any>(null);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [isLeadEditOpen, setIsLeadEditOpen] = useState(false);

  // Fetch access token for AI replies
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('instagram_accounts')
        .select('access_token')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (data?.access_token) setAccessToken(data.access_token);
    })();
  }, []);

  // Fetch grouped posts
  const fetchPostGroups = useCallback(async () => {
    setIsLoadingPosts(true);
    try {
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('post_url, created_at')
        .not('post_url', 'is', null);

      if (error) throw error;

      const groups: Record<string, { count: number; firstAt: string }> = {};
      for (const row of data || []) {
        if (!row.post_url) continue;
        const norm = normalizeUrl(row.post_url);
        if (!groups[norm]) {
          groups[norm] = { count: 0, firstAt: row.created_at };
        }
        groups[norm].count++;
        if (row.created_at < groups[norm].firstAt) {
          groups[norm].firstAt = row.created_at;
        }
      }

      const sorted = Object.entries(groups)
        .map(([url, g]) => ({
          postUrl: url,
          commentCount: g.count,
          firstCommentAt: g.firstAt,
        }))
        .sort((a, b) => new Date(b.firstCommentAt).getTime() - new Date(a.firstCommentAt).getTime());

      setPostGroups(sorted);

      if (sorted.length > 0 && !selectedPostUrl) {
        setSelectedPostUrl(sorted[0].postUrl);
      }

      sorted.slice(0, 10).forEach(async (group) => {
        const cached = getCachedMetadata(group.postUrl);
        if (cached) {
          setMetadataMap(prev => ({ ...prev, [group.postUrl]: cached }));
        } else {
          setLoadingMetadata(prev => new Set(prev).add(group.postUrl));
          const meta = await fetchMetadata(group.postUrl);
          setMetadataMap(prev => ({ ...prev, [group.postUrl]: meta }));
          setLoadingMetadata(prev => {
            const next = new Set(prev);
            next.delete(group.postUrl);
            return next;
          });
        }
      });
    } catch (err) {
      console.error('Error fetching post groups:', err);
    } finally {
      setIsLoadingPosts(false);
    }
  }, []);

  const fetchCommentsForPost = useCallback(async (postUrl: string) => {
    setIsLoadingComments(true);
    try {
      const shortcodeMatch = postUrl.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      const shortcode = shortcodeMatch ? shortcodeMatch[2] : null;

      let query = supabase
        .from('instagram_comments')
        .select('*')
        .not('post_url', 'is', null)
        .order('created_at', { ascending: true });

      if (shortcode) {
        query = query.ilike('post_url', `%${shortcode}%`);
      } else {
        query = query.eq('post_url', postUrl);
      }

      const { data, error } = await query.limit(2000);
      if (error) throw error;
      setComments(data || []);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setIsLoadingComments(false);
    }
  }, []);

  useEffect(() => {
    fetchPostGroups();
  }, [fetchPostGroups]);

  useEffect(() => {
    if (selectedPostUrl) {
      fetchCommentsForPost(selectedPostUrl);
      if (!metadataMap[selectedPostUrl] && !loadingMetadata.has(selectedPostUrl)) {
        setLoadingMetadata(prev => new Set(prev).add(selectedPostUrl));
        fetchMetadata(selectedPostUrl).then(meta => {
          setMetadataMap(prev => ({ ...prev, [selectedPostUrl]: meta }));
          setLoadingMetadata(prev => {
            const next = new Set(prev);
            next.delete(selectedPostUrl);
            return next;
          });
        });
      }
    }
  }, [selectedPostUrl]);

  const selectedMeta = selectedPostUrl ? metadataMap[selectedPostUrl] : null;
  const selectedGroup = postGroups.find(g => g.postUrl === selectedPostUrl);
  const selectedIndex = postGroups.findIndex(g => g.postUrl === selectedPostUrl);

  const filteredComments = useMemo(() => {
    if (!searchTerm.trim()) return comments;
    const s = searchTerm.toLowerCase();
    return comments.filter(c =>
      c.comment_text?.toLowerCase().includes(s) ||
      c.author_username?.toLowerCase().includes(s)
    );
  }, [comments, searchTerm]);

  const parentComments = filteredComments.filter(c => !c.parent_comment_id);
  const repliesMap = useMemo(() => {
    const map: Record<string, Comment[]> = {};
    filteredComments.filter(c => c.parent_comment_id).forEach(c => {
      const key = c.parent_comment_id!;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [filteredComments]);

  const goToPrev = () => {
    if (selectedIndex > 0) setSelectedPostUrl(postGroups[selectedIndex - 1].postUrl);
  };
  const goToNext = () => {
    if (selectedIndex < postGroups.length - 1) setSelectedPostUrl(postGroups[selectedIndex + 1].postUrl);
  };

  const extractShortcode = (url: string) => {
    const match = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : url.substring(0, 20);
  };

  const handleAIReply = (comment: Comment) => {
    setReplyingToComment(comment);
    setShowAIReplyDialog(true);
  };

  const handleClassify = (comment: Comment) => {
    setClassifyingComment(comment);
    setShowClassificationDialog(true);
  };

  const handleRegisterContact = (username: string) => {
    setRegisteringUsername(username);
    setShowContactRegistration(true);
  };

  const handleOpenContact = (contactData: CommentContactData) => {
    if (contactData.contact) {
      setDetailContact(contactData.contact);
      setIsDetailSheetOpen(true);
    }
  };

  const handleOpenLead = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setEditingLead(data as Lead);
        setIsLeadEditOpen(true);
      }
    } catch (err) {
      console.error('Error fetching lead:', err);
    }
  };

  const handleSaveLead = async (leadId: string, updates: Partial<Lead>) => {
    const { error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', leadId);
    if (error) throw error;
    refetchContacts();
  };

  if (isLoadingPosts) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (postGroups.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Nenhum post com comentários encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Post Carousel */}
      <div className="relative">
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-2 px-1">
            {postGroups.map((group) => {
              const meta = metadataMap[group.postUrl];
              const isSelected = group.postUrl === selectedPostUrl;
              const isMetaLoading = loadingMetadata.has(group.postUrl);

              return (
                <button
                  key={group.postUrl}
                  onClick={() => setSelectedPostUrl(group.postUrl)}
                  className={cn(
                    "flex-shrink-0 w-[140px] rounded-xl border-2 overflow-hidden transition-all hover:shadow-md",
                    isSelected
                      ? "border-primary shadow-lg ring-2 ring-primary/20"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <div className="relative w-full h-[140px] bg-muted">
                    {isMetaLoading ? (
                      <Skeleton className="w-full h-full" />
                    ) : meta?.thumbnailUrl ? (
                      <img src={meta.thumbnailUrl} alt="Post" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                      </div>
                    )}
                    {(meta?.mediaType === 'video' || group.postUrl.includes('/reel')) && (
                      <div className="absolute top-2 right-2">
                        <Play className="h-5 w-5 text-white drop-shadow-md fill-white/80" />
                      </div>
                    )}
                    <div className="absolute bottom-2 right-2">
                      <Badge variant="secondary" className="text-xs shadow-sm">
                        <MessageCircle className="h-3 w-3 mr-1" />
                        {group.commentCount}
                      </Badge>
                    </div>
                  </div>
                  <div className="p-2 text-left">
                    <p className="text-xs font-medium truncate">
                      {meta?.ownerUsername ? `@${meta.ownerUsername}` : extractShortcode(group.postUrl)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(group.firstCommentAt), "dd/MM/yy", { locale: ptBR })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Selected Post Detail */}
      {selectedPostUrl && (
        <Card className="overflow-hidden">
          <div className="border-b">
            <div className="flex items-center gap-4 p-4">
              <Button variant="ghost" size="icon" onClick={goToPrev} disabled={selectedIndex <= 0} className="shrink-0">
                <ChevronLeft className="h-5 w-5" />
              </Button>

              <div className="flex-1 flex gap-4 min-h-[200px]">
                <div className="relative w-[200px] h-[200px] rounded-lg overflow-hidden bg-muted shrink-0">
                  {loadingMetadata.has(selectedPostUrl) ? (
                    <Skeleton className="w-full h-full" />
                  ) : selectedMeta?.thumbnailUrl ? (
                    <img src={selectedMeta.thumbnailUrl} alt="Post" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                  {(selectedMeta?.mediaType === 'video' || selectedPostUrl.includes('/reel')) && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-black/40 rounded-full p-3">
                        <Play className="h-8 w-8 text-white fill-white" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-primary/80 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <span className="font-semibold text-sm">
                      {selectedMeta?.ownerUsername || 'Autor desconhecido'}
                    </span>
                    <a href={selectedPostUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-muted-foreground hover:text-primary">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>

                  {selectedMeta?.caption && (
                    <div className="text-sm text-muted-foreground flex-1 overflow-y-auto max-h-[120px] pr-2">
                      <span className="font-semibold text-foreground mr-1">{selectedMeta.ownerUsername}</span>
                      {selectedMeta.caption.length > 200 ? selectedMeta.caption.substring(0, 200) + '...' : selectedMeta.caption}
                    </div>
                  )}

                  <div className="flex items-center gap-4 mt-auto pt-2">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MessageCircle className="h-4 w-4" />
                      <span className="font-medium">{selectedGroup?.commentCount || 0} comentários</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {selectedIndex + 1} de {postGroups.length}
                    </Badge>
                  </div>
                </div>
              </div>

              <Button variant="ghost" size="icon" onClick={goToNext} disabled={selectedIndex >= postGroups.length - 1} className="shrink-0">
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar nos comentários..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>

            {isLoadingComments ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredComments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Nenhum comentário encontrado</div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-1 pr-3">
                  {parentComments.map((comment) => {
                    const replies = repliesMap[comment.comment_id || ''] || [];
                    return (
                      <div key={comment.id}>
                        <CommentRow
                          comment={comment}
                          contactData={getContactData(comment.author_username)}
                          onAIReply={handleAIReply}
                          onClassify={handleClassify}
                          onRegisterContact={handleRegisterContact}
                          onOpenContact={handleOpenContact}
                          onOpenLead={handleOpenLead}
                          onDataChanged={refetchContacts}
                        />
                        {replies.length > 0 && (
                          <div className="ml-10 border-l-2 border-muted pl-3 space-y-1">
                            {replies.map(reply => (
                              <CommentRow
                                key={reply.id}
                                comment={reply}
                                contactData={getContactData(reply.author_username)}
                                isReply
                                onAIReply={handleAIReply}
                                onClassify={handleClassify}
                                onRegisterContact={handleRegisterContact}
                                onOpenContact={handleOpenContact}
                                onOpenLead={handleOpenLead}
                                onDataChanged={refetchContacts}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Reply Dialog */}
      <AIReplyDialog
        open={showAIReplyDialog}
        onOpenChange={setShowAIReplyDialog}
        comment={replyingToComment}
        accessToken={accessToken}
        onReplyPosted={() => {
          if (selectedPostUrl) fetchCommentsForPost(selectedPostUrl);
        }}
      />

      {/* Classification Dialog */}
      <CommentClassificationDialog
        open={showClassificationDialog}
        onOpenChange={setShowClassificationDialog}
        comment={classifyingComment ? {
          id: classifyingComment.id,
          author_username: classifyingComment.author_username,
          comment_text: classifyingComment.comment_text,
          post_url: classifyingComment.post_url,
          platform: classifyingComment.platform,
        } : null}
        onClassificationsApplied={refetchContacts}
        onLeadLinked={refetchContacts}
      />

      {/* Contact Registration Dialog */}
      <PostDmContactRegistration
        open={showContactRegistration}
        onOpenChange={setShowContactRegistration}
        instagramUsername={registeringUsername}
        onContactSaved={refetchContacts}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={detailContact}
        open={isDetailSheetOpen}
        onOpenChange={setIsDetailSheetOpen}
        onContactUpdated={refetchContacts}
      />

      {/* Lead Edit Sheet */}
      <LeadEditDialog
        open={isLeadEditOpen}
        onOpenChange={setIsLeadEditOpen}
        lead={editingLead}
        onSave={handleSaveLead}
        mode="sheet"
      />
    </div>
  );
}

interface CommentRowProps {
  comment: Comment;
  contactData: CommentContactData;
  isReply?: boolean;
  onAIReply: (comment: Comment) => void;
  onClassify: (comment: Comment) => void;
  onRegisterContact: (username: string) => void;
  onOpenContact: (contactData: CommentContactData) => void;
  onOpenLead: (leadId: string) => void;
  onDataChanged: () => void;
}

function CommentRow({ comment, contactData, isReply, onAIReply, onClassify, onRegisterContact, onOpenContact, onOpenLead, onDataChanged }: CommentRowProps) {
  const isReceived = comment.comment_type === 'received';
  const hasContact = !!contactData.contact;
  const hasLead = contactData.linkedLeads.length > 0;
  const hasClassification = (contactData.contact?.classifications?.length || 0) > 0;
  const isReplied = !!comment.replied_at;

  return (
    <div className={cn(
      "flex gap-3 py-3 px-2 rounded-md hover:bg-muted/50 transition-colors",
      isReply && "py-2",
      isReplied && "bg-green-50/50 dark:bg-green-950/10"
    )}>
      <div className={cn(
        "shrink-0 rounded-full flex items-center justify-center",
        hasContact ? "bg-primary/10" : "bg-muted",
        isReply ? "w-6 h-6" : "w-8 h-8",
        hasContact && !isReply && "cursor-pointer hover:bg-primary/20 transition-colors"
      )}
        onClick={hasContact && !isReply ? () => onOpenContact(contactData) : undefined}
      >
        <User className={cn(hasContact ? "text-primary" : "text-muted-foreground", isReply ? "h-3 w-3" : "h-4 w-4")} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={cn(
                "font-semibold",
                isReply ? "text-xs" : "text-sm",
                hasContact && !isReply && "cursor-pointer text-primary hover:underline"
              )}
              onClick={hasContact && !isReply ? () => onOpenContact(contactData) : undefined}
            >
              {comment.author_username || 'anônimo'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
            </span>
            {comment.comment_type === 'sent' && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">enviado</Badge>
            )}
            {isReplied && (
              <Badge className="text-[10px] px-1 py-0 h-4 bg-green-600 hover:bg-green-600 text-white">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                respondido
              </Badge>
            )}
          </div>

          {/* Action buttons */}
          {isReceived && !isReply && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "h-7 text-xs",
                  isReplied
                    ? "border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50"
                    : "bg-gradient-to-r from-primary/10 to-accent/10 border-primary/30 hover:border-primary/50"
                )}
                onClick={() => onAIReply(comment)}
              >
                <Bot className="h-3 w-3 mr-1" />
                <Sparkles className="h-3 w-3 mr-1" />
                {isReplied ? "Respondido ✓" : "Responder IA"}
              </Button>

              {comment.author_username && (
                <QuickLinkLeadPopover
                  authorUsername={comment.author_username}
                  onLeadLinked={onDataChanged}
                  hasLinkedLead={hasLead}
                />
              )}

              {comment.author_username && (
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    hasClassification && "border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50"
                  )}
                  onClick={() => onClassify(comment)}
                >
                  <Tag className="h-3 w-3 mr-1" />
                  {hasClassification ? "Classificado ✓" : "Classificar"}
                </Button>
              )}

              {comment.author_username && (
                <ProfessionBadgePopover
                  authorUsername={comment.author_username}
                  interactive
                  compact
                  onDataChanged={onDataChanged}
                />
              )}

              {comment.author_username && (
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    hasContact && "border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50"
                  )}
                  onClick={() => onRegisterContact(comment.author_username!)}
                >
                  <UserPlus className="h-3 w-3 mr-1" />
                  {hasContact ? "Contato ✓" : "Contato"}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Contact badges - shows linked leads, classifications, profession, relationships */}
        {comment.author_username && !isReply && (
          <div className="mt-1">
            <CommentContactBadges
              contactData={contactData}
              username={comment.author_username}
              onLeadStatusChanged={onDataChanged}
              onOpenLead={onOpenLead}
            />
          </div>
        )}

        <p className={cn("text-muted-foreground break-words mt-0.5", isReply ? "text-xs" : "text-sm")}>
          {comment.comment_text || '(sem texto)'}
        </p>
      </div>
    </div>
  );
}
