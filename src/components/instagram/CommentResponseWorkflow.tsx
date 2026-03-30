import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Bot, 
  Send, 
  RefreshCw, 
  Sparkles, 
  UserPlus, 
  MessageCircle,
  CheckCircle2,
  ArrowRight,
  Zap,
  Trophy,
  Target,
  ExternalLink,
  Play,
  SkipForward,
  Users,
  Settings,
  Reply,
  Image as ImageIcon,
  Copy,
  Check,
  AlertTriangle,
  RotateCcw,
  Pencil,
  Save,
  MapPin,
  FileText,
  Maximize2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InstagramProfileHoverCard } from "./InstagramProfileHoverCard";
import { PostPreviewCard, PostPreviewCardSkeleton } from "./PostPreviewCard";
import { usePostMetadata } from "@/hooks/usePostMetadata";
import { CommentCardBadges } from "./CommentCardBadges";
import { CommentCardSettingsDialog } from "./CommentCardSettingsDialog";
import { PostDmContactRegistration } from "./PostDmContactRegistration";
import { WorkflowTimer } from "./WorkflowTimer";
import { WorkflowReportDialog, type WorkflowAction } from "./WorkflowReportDialog";
import { useCommentContactInfo } from "@/hooks/useCommentContactInfo";
import { useCommentCardSettings } from "@/hooks/useCommentCardSettings";
import { useAuthContext } from "@/contexts/AuthContext";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Comment {
  id: string;
  comment_id?: string;
  comment_text: string | null;
  author_username: string | null;
  author_id?: string | null;
  post_url: string | null;
  post_id?: string | null;
  parent_comment_id?: string | null;
  platform: string;
  created_at: string;
  replied_at?: string | null;
  comment_type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}

// Helper function to detect if comment is from a third-party post
const isThirdPartyPost = (comment: Comment | null | undefined): boolean => {
  if (!comment) return false;
  
  // Check by comment_type
  if (comment.comment_type && ['outbound_manual', 'outbound_n8n', 'outbound_export'].includes(comment.comment_type)) {
    return true;
  }
  
  // Check by metadata.is_outbound (set by Apify import)
  if (comment.metadata?.is_outbound === true) {
    return true;
  }
  
  return false;
};

interface ParentComment {
  id: string;
  comment_text: string | null;
  author_username: string | null;
}

interface CommentResponseWorkflowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comments: Comment[];
  accessToken?: string;
  onCommentReplied?: (commentId: string) => void;
  onLeadCreated?: (username: string) => void;
  onRefresh?: () => void;
}

const TONES = [
  { value: "friendly", label: "Amigável", emoji: "😊" },
  { value: "professional", label: "Profissional", emoji: "💼" },
  { value: "empathetic", label: "Empático", emoji: "🤗" },
  { value: "sales", label: "Comercial", emoji: "🎯" },
  { value: "casual", label: "Casual", emoji: "✌️" },
];

type WorkflowStep = 'idle' | 'generating' | 'ready_to_reply' | 'replying' | 'replied' | 'suggesting_actions';

interface SuggestedAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  action: () => void;
  variant?: 'default' | 'outline' | 'secondary';
  highlight?: boolean;
  isCompleted?: boolean;
}

export const CommentResponseWorkflow = ({ 
  open, 
  onOpenChange, 
  comments, 
  accessToken,
  onCommentReplied,
  onLeadCreated,
  onRefresh
}: CommentResponseWorkflowProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('idle');
  const [selectedTone, setSelectedTone] = useState("friendly");
  const [generatedReply, setGeneratedReply] = useState("");
  const [editedReply, setEditedReply] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [dmSuggestion, setDmSuggestion] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [isFollowRequested, setIsFollowRequested] = useState<boolean>(false);
  const [hasLead, setHasLead] = useState<boolean | null>(null);
  const [linkedLeadId, setLinkedLeadId] = useState<string | null>(null);
  const [repliedComments, setRepliedComments] = useState<Set<string>>(new Set());
  const [showCardSettings, setShowCardSettings] = useState(false);
  const [parentComment, setParentComment] = useState<ParentComment | null>(null);
  
  const [showDMDialog, setShowDMDialog] = useState(false);
  // Store the comment that was just replied to, so we don't lose it when unrepliedComments recalculates
  const [justRepliedComment, setJustRepliedComment] = useState<Comment | null>(null);
  const [editedDmSuggestion, setEditedDmSuggestion] = useState<string>("");
  const [isMarkingAsFollowing, setIsMarkingAsFollowing] = useState(false);
  const [isMarkingAsRequested, setIsMarkingAsRequested] = useState(false);
  const [showEditAuthorId, setShowEditAuthorId] = useState(false);
  const [editedAuthorId, setEditedAuthorId] = useState("");
  const [isSavingAuthorId, setIsSavingAuthorId] = useState(false);
  const [showContactRegistration, setShowContactRegistration] = useState(false);
  // Track locally updated author_ids so we don't need to wait for parent refresh
  const [localAuthorIdUpdates, setLocalAuthorIdUpdates] = useState<Record<string, string>>({});
  // Custom prompt for AI context
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  
  // Filters for post type and relationships
  const [postTypeFilter, setPostTypeFilter] = useState<'all' | 'own' | 'third_party'>('all');
  const [relationshipFilter, setRelationshipFilter] = useState<string[]>([]);
  const [contactsWithRelationships, setContactsWithRelationships] = useState<Record<string, string[]>>({});
  
  // Timer and report tracking
  const [workflowStartTime, setWorkflowStartTime] = useState<Date | null>(null);
  const [workflowEndTime, setWorkflowEndTime] = useState<Date | null>(null);
  const [workflowActions, setWorkflowActions] = useState<WorkflowAction[]>([]);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const actionIdCounter = useRef(0);

  // Play completion notification (sound + vibration)
  const playCompletionNotification = useCallback(() => {
    // Play success sound using Web Audio API
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a pleasant completion sound (ascending notes)
      const playNote = (frequency: number, startTime: number, duration: number) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      playNote(523.25, now, 0.15);        // C5
      playNote(659.25, now + 0.15, 0.15); // E5
      playNote(783.99, now + 0.3, 0.3);   // G5
    } catch (e) {
      console.log('Audio not supported');
    }
    
    // Vibrate if supported
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100, 50, 200]); // Short-short-long pattern
    }
    
    toast.success("🎉 Fluxo concluído com sucesso!", {
      description: "Todos os comentários foram processados"
    });
  }, []);

  // Card settings
  const { config: cardConfig, updateField: updateCardField, resetToDefaults: resetCardSettings } = useCommentCardSettings();
  
  // Auth context for user_id
  const { user } = useAuthContext();
  
  // Activity logger for productivity tracking
  const { logActivity } = useActivityLogger();
  
  // Post metadata for preview
  const { fetchMetadata, getCachedMetadata } = usePostMetadata();
  const [postMetadata, setPostMetadata] = useState<any>(null);
  const [isMetadataFetching, setIsMetadataFetching] = useState(false);
  
  // Get usernames for contact info lookup
  const commentUsernames = useMemo(() => {
    return comments
      .filter(c => c.author_username)
      .map(c => c.author_username!)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [comments]);
  
  const { getContactData, refetchUsername } = useCommentContactInfo(commentUsernames);

  // Fetch relationships for all comment usernames
  useEffect(() => {
    const fetchRelationships = async () => {
      if (commentUsernames.length === 0) return;
      
      // Get contacts with their relationships
      const { data: contacts } = await supabase
        .from('contacts')
        .select(`
          instagram_username,
          contact_relationships!contact_relationships_contact_id_fkey(
            relationship_type
          )
        `)
        .or(commentUsernames.map(u => `instagram_username.ilike.${u.replace('@', '')}`).join(','));
      
      if (contacts) {
        const relationshipMap: Record<string, string[]> = {};
        contacts.forEach((contact: any) => {
          const username = contact.instagram_username?.toLowerCase().replace('@', '');
          if (username && contact.contact_relationships?.length > 0) {
            relationshipMap[username] = contact.contact_relationships.map((r: any) => r.relationship_type);
          }
        });
        setContactsWithRelationships(relationshipMap);
      }
    };
    
    fetchRelationships();
  }, [commentUsernames]);

  // Get unreplied comments that have a comment_id (can be replied to via API)
  // Apply filters for post type and relationships
  const unrepliedComments = useMemo(() => {
    return comments.filter(c => {
      // Basic filter: must have comment_id and not be replied
      if (!c.comment_id || c.replied_at || repliedComments.has(c.id)) {
        return false;
      }
      
      // Post type filter
      const isThirdParty = isThirdPartyPost(c);
      if (postTypeFilter === 'own' && isThirdParty) return false;
      if (postTypeFilter === 'third_party' && !isThirdParty) return false;
      
      // Relationship filter (only applies to third-party posts)
      if (relationshipFilter.length > 0 && isThirdParty) {
        const username = c.author_username?.toLowerCase().replace('@', '');
        if (!username) return false;
        
        const userRelationships = contactsWithRelationships[username] || [];
        const hasMatchingRelationship = relationshipFilter.some(r => userRelationships.includes(r));
        if (!hasMatchingRelationship) return false;
      }
      
      return true;
    });
  }, [comments, repliedComments, postTypeFilter, relationshipFilter, contactsWithRelationships]);

  // Use justRepliedComment during suggesting_actions step, otherwise use the current unreplied comment
  const baseComment = workflowStep === 'suggesting_actions' && justRepliedComment 
    ? justRepliedComment 
    : unrepliedComments[currentIndex];
  
  // Apply local author_id updates if available
  const currentComment = baseComment ? {
    ...baseComment,
    author_id: localAuthorIdUpdates[baseComment.id] || baseComment.author_id
  } : baseComment;
  
  const totalComments = unrepliedComments.length;
  const progress = totalComments > 0 ? ((repliedComments.size) / (repliedComments.size + totalComments)) * 100 : 100;

  // Start timer when workflow opens
  useEffect(() => {
    if (open && !workflowStartTime && unrepliedComments.length > 0) {
      setWorkflowStartTime(new Date());
      setIsTimerRunning(true);
      setWorkflowActions([]);
      setWorkflowEndTime(null);
    }
  }, [open, workflowStartTime, unrepliedComments.length]);

  // Track action helper
  const trackAction = useCallback((type: WorkflowAction['type'], username: string, details?: string) => {
    actionIdCounter.current += 1;
    setWorkflowActions(prev => [...prev, {
      id: `action-${actionIdCounter.current}`,
      type,
      username,
      timestamp: new Date(),
      details
    }]);
  }, []);

  // Fetch post metadata for preview
  useEffect(() => {
    if (currentComment?.post_url) {
      const cached = getCachedMetadata(currentComment.post_url);
      if (cached) {
        setPostMetadata(cached);
        setIsMetadataFetching(false);
      } else {
        setIsMetadataFetching(true);
        setPostMetadata(null);
        fetchMetadata(currentComment.post_url).then(meta => {
          setPostMetadata(meta);
          setIsMetadataFetching(false);
        });
      }
    } else {
      setPostMetadata(null);
      setIsMetadataFetching(false);
    }
  }, [currentComment?.post_url]);

  // Check if user is following and if lead exists
  useEffect(() => {
    if (currentComment?.author_username) {
      checkUserStatus(currentComment.author_username);
    }
    // Fetch parent comment if exists
    if (currentComment?.parent_comment_id) {
      fetchParentComment(currentComment.parent_comment_id);
    } else {
      setParentComment(null);
    }
  }, [currentComment?.author_username, currentComment?.parent_comment_id]);

  const fetchParentComment = async (parentId: string) => {
    const { data } = await supabase
      .from('instagram_comments')
      .select('id, comment_text, author_username')
      .eq('comment_id', parentId)
      .limit(1)
      .maybeSingle();
    
    setParentComment(data);
  };

  const checkUserStatus = async (username: string) => {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    
    // Check if contact exists and get follower status
    const { data: contact } = await supabase
      .from('contacts')
      .select('follower_status, id, follow_requested_at')
      .or(`instagram_username.ilike.${normalizedUsername},instagram_username.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();
    
    setIsFollowing(contact?.follower_status === 'following' || contact?.follower_status === 'mutual');
    setIsFollowRequested(!!contact?.follow_requested_at && contact?.follower_status !== 'following' && contact?.follower_status !== 'mutual');
    
    // Check if lead exists directly
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .or(`instagram_username.ilike.${normalizedUsername},lead_name.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();
    
    // Also check if contact has linked leads via contact_leads junction table
    let linkedLeadId: string | null = null;
    if (contact?.id) {
      const { data: linkedLeads } = await supabase
        .from('contact_leads')
        .select('lead_id')
        .eq('contact_id', contact.id)
        .limit(1);
      if (linkedLeads && linkedLeads.length > 0) {
        linkedLeadId = linkedLeads[0].lead_id;
      }
    }
    
    const foundLeadId = lead?.id || linkedLeadId;
    setHasLead(!!foundLeadId);
    setLinkedLeadId(foundLeadId || null);
  };

  const generateReply = async () => {
    if (!currentComment?.comment_text) return;

    setWorkflowStep('generating');
    setGeneratedReply("");
    setAlternatives([]);
    setDmSuggestion(null);

    try {
      // Build post context from the post URL if available
      let postContext = null;
      if (currentComment.post_url) {
        // Extract basic context from URL
        postContext = `Post do Instagram: ${currentComment.post_url}`;
      }

      // Build parent comment context
      let parentCommentContext = null;
      if (parentComment) {
        parentCommentContext = {
          author: parentComment.author_username?.replace("@", "") || "usuário",
          text: parentComment.comment_text || ""
        };
      }

      const { data, error } = await cloudFunctions.invoke("generate-ai-reply", {
        body: {
          comment: currentComment.comment_text,
          authorUsername: currentComment.author_username?.replace("@", ""),
          postContext,
          parentComment: parentCommentContext,
          tone: selectedTone,
          generateDM: true,
          customPrompt: customPrompt.trim() || null,
        },
      });

      if (error) throw error;

      if (data.error) {
        if (data.error.includes("Rate limit")) {
          toast.error("Limite de requisições atingido. Tente novamente em alguns segundos.");
        } else if (data.error.includes("Payment required")) {
          toast.error("Créditos insuficientes. Adicione créditos ao workspace.");
        } else {
          throw new Error(data.error);
        }
        setWorkflowStep('idle');
        return;
      }

      setGeneratedReply(data.reply);
      setEditedReply(data.reply);
      setAlternatives(data.alternatives || []);
      setDmSuggestion(data.dmSuggestion || null);
      setWorkflowStep('ready_to_reply');
    } catch (error: any) {
      console.error("Error generating reply:", error);
      toast.error("Erro ao gerar resposta. Tente novamente.");
      setWorkflowStep('idle');
    }
  };

  const postReply = async () => {
    if (!editedReply.trim() || !currentComment) return;

    const commentIdToReply = currentComment.comment_id;
    if (!commentIdToReply) {
      toast.error("Este comentário não pode receber respostas");
      return;
    }

    // Save reference to the current comment BEFORE marking as replied
    // This prevents losing the reference when unrepliedComments recalculates
    setJustRepliedComment(currentComment);
    setWorkflowStep('replying');

    try {
      const { data, error } = await cloudFunctions.invoke("post-instagram-reply", {
        body: {
          commentId: commentIdToReply,
          message: editedReply.trim(),
          accessToken,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || "Erro ao postar resposta");
      }

      // Mark as replied in database
      await supabase
        .from('instagram_comments')
        .update({ replied_at: new Date().toISOString(), replied_by: user?.id || null })
        .eq('id', currentComment.id);

      setRepliedComments(prev => new Set([...prev, currentComment.id]));
      onCommentReplied?.(currentComment.id);
      
      // Track the reply action
      trackAction('reply', currentComment.author_username || 'unknown');
      
      // Log to activity tracker for productivity
      logActivity({
        actionType: 'comment_reply',
        entityType: 'comment',
        entityId: currentComment.id,
        metadata: { username: currentComment.author_username }
      });
      
      toast.success("Resposta postada! 🎉");
      setWorkflowStep('suggesting_actions');
    } catch (error: any) {
      console.error("Error posting reply:", error);
      toast.error(error.message || "Erro ao postar resposta");
      setJustRepliedComment(null);
      setWorkflowStep('ready_to_reply');
    }
  };

  const createLead = async () => {
    if (!currentComment?.author_username) return;
    
    const username = currentComment.author_username.replace('@', '').toLowerCase();
    
    try {
      const { error } = await supabase
        .from('leads')
        .insert({
          lead_name: `@${username}`,
          source: currentComment.platform,
          status: 'comment',
          instagram_comment_id: currentComment.id,
          instagram_username: username,
          notes: `Capturado via workflow - Comentou: "${currentComment.comment_text?.slice(0, 100)}..."`,
        });

      if (error) throw error;

      toast.success(`@${username} adicionado como lead!`);
      setHasLead(true);
      onLeadCreated?.(username);
      trackAction('lead', username);
    } catch (error) {
      console.error('Error creating lead:', error);
      toast.error('Erro ao criar lead');
    }
  };

  const markAsFollowing = async () => {
    if (!currentComment?.author_username) return;
    
    const username = currentComment.author_username.replace('@', '').toLowerCase();
    setIsMarkingAsFollowing(true);
    
    try {
      // Check if contact exists
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .or(`instagram_username.ilike.${username},instagram_username.ilike.@${username}`)
        .limit(1)
        .maybeSingle();
      
      if (existingContact) {
        // Update existing contact
        await supabase
          .from('contacts')
          .update({ follower_status: 'following' })
          .eq('id', existingContact.id);
      } else {
        // Create new contact with following status
        await supabase
          .from('contacts')
          .insert({
            instagram_username: username,
            full_name: `@${username}`,
            follower_status: 'following'
          });
      }
      
      setIsFollowing(true);
      toast.success(`Marcado como seguindo @${username}`);
      refetchUsername(currentComment.author_username);
      trackAction('follow', username);
    } catch (error) {
      console.error('Error marking as following:', error);
      toast.error('Erro ao marcar como seguindo');
    } finally {
      setIsMarkingAsFollowing(false);
    }
  };

  const markAsRequested = async () => {
    if (!currentComment?.author_username) return;
    
    const username = currentComment.author_username.replace('@', '').toLowerCase();
    setIsMarkingAsRequested(true);
    
    try {
      // Check if contact exists
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .or(`instagram_username.ilike.${username},instagram_username.ilike.@${username}`)
        .limit(1)
        .maybeSingle();
      
      const now = new Date().toISOString();
      
      if (existingContact) {
        // Update existing contact
        await supabase
          .from('contacts')
          .update({ follow_requested_at: now })
          .eq('id', existingContact.id);
      } else {
        // Create new contact with follow_requested_at
        await supabase
          .from('contacts')
          .insert({
            instagram_username: username,
            full_name: `@${username}`,
            follow_requested_at: now
          });
      }
      
      setIsFollowRequested(true);
      toast.success(`Solicitação registrada para @${username}`);
      refetchUsername(currentComment.author_username);
    } catch (error) {
      console.error('Error marking as requested:', error);
      toast.error('Erro ao registrar solicitação');
    } finally {
      setIsMarkingAsRequested(false);
    }
  };

  const saveAuthorId = async () => {
    if (!currentComment || !editedAuthorId.trim()) return;
    
    // Validate: should be numeric only
    const cleanId = editedAuthorId.trim();
    if (!/^\d+$/.test(cleanId)) {
      toast.error("O ID deve conter apenas números");
      return;
    }
    
    setIsSavingAuthorId(true);
    
    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({ author_id: cleanId })
        .eq('id', currentComment.id);
      
      if (error) throw error;
      
      // Update local state immediately
      setLocalAuthorIdUpdates(prev => ({
        ...prev,
        [currentComment.id]: cleanId
      }));
      
      toast.success("ID do autor atualizado!");
      setShowEditAuthorId(false);
      setEditedAuthorId("");
      onRefresh?.();
    } catch (error) {
      console.error('Error saving author_id:', error);
      toast.error('Erro ao salvar ID do autor');
    } finally {
      setIsSavingAuthorId(false);
    }
  };

  const openInstagramProfile = () => {
    const username = currentComment?.author_username?.replace('@', '');
    if (username) {
      window.open(`https://instagram.com/${username}`, '_blank');
    }
  };

  // Validate author_id format - Instagram IDs are numeric strings, typically 15-20 digits
  const validateAuthorId = (authorId: string | null | undefined): { valid: boolean; warning: string | null } => {
    if (!authorId) {
      return { valid: false, warning: "ID não disponível" };
    }
    
    const cleanId = authorId.trim();
    
    // Must be numeric only
    if (!/^\d+$/.test(cleanId)) {
      return { valid: false, warning: "ID contém caracteres inválidos" };
    }
    
    // Instagram user IDs are typically 15-20 digits, but can be shorter for older accounts
    // Warn if too short (less than 10 digits) or too long (more than 25 digits)
    if (cleanId.length < 10) {
      return { valid: true, warning: "ID parece muito curto - pode estar incorreto" };
    }
    
    if (cleanId.length > 25) {
      return { valid: false, warning: "ID parece muito longo - verifique o formato" };
    }
    
    return { valid: true, warning: null };
  };

  const authorIdValidation = useMemo(() => {
    return validateAuthorId(currentComment?.author_id);
  }, [currentComment?.author_id]);

  // Save DM to history
  const saveDmToHistory = async (actionType: 'copied' | 'copied_and_opened' | 'opened_only') => {
    if (!currentComment?.author_username || !user?.id) return;
    
    const username = currentComment.author_username.replace('@', '').toLowerCase();
    const messageToSave = editedDmSuggestion || dmSuggestion || '';
    
    if (!messageToSave && actionType !== 'opened_only') return;
    
    try {
      await supabase.from('dm_history').insert({
        user_id: user.id,
        comment_id: currentComment.id,
        instagram_username: username,
        author_id: currentComment.author_id,
        dm_message: messageToSave || 'Aberto sem mensagem',
        original_suggestion: dmSuggestion,
        was_edited: editedDmSuggestion !== dmSuggestion && !!dmSuggestion,
        action_type: actionType
      });
      
      // Track DM action
      trackAction('dm', username);
      
      // Log to activity tracker
      logActivity({
        actionType: actionType === 'opened_only' ? 'dm_sent' : 'dm_copied',
        entityType: 'dm',
        metadata: { username }
      });
    } catch (error) {
      console.error('Error saving DM to history:', error);
      // Don't show error toast - this is a background operation
    }
  };

  const openInstagramDM = () => {
    const validation = validateAuthorId(currentComment?.author_id);
    
    if (!currentComment?.author_id || !validation.valid) {
      // Fallback to profile if author_id is not valid
      const username = currentComment?.author_username?.replace('@', '');
      if (username) {
        if (validation.warning) {
          toast.warning(`${validation.warning}. Abrindo perfil...`);
        } else {
          toast.info("ID do usuário não disponível. Abrindo perfil...");
        }
        window.open(`https://instagram.com/${username}`, '_blank');
      }
      return;
    }
    
    // Show warning but still open if there's a soft warning
    if (validation.warning) {
      toast.warning(validation.warning);
    }
    
    // Encode the ID properly for URL safety
    const encodedId = encodeURIComponent(currentComment.author_id.trim());
    window.open(`https://instagram.com/direct/t/${encodedId}`, '_blank');
  };

  const goToNextComment = () => {
    setWorkflowStep('idle');
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
    setDmSuggestion(null);
    setEditedDmSuggestion("");
    setShowDMDialog(false);
    setJustRepliedComment(null); // Clear the just replied comment
    
    // Since we already added the current comment to repliedComments, unrepliedComments has shrunk
    // We need to check if there are more comments at the current index (which is now pointing to the next one)
    if (unrepliedComments.length > 0) {
      // Stay at current index since the list shifted
      setCurrentIndex(Math.min(currentIndex, unrepliedComments.length - 1));
    } else {
      // All done! Stop timer and show report
      setWorkflowEndTime(new Date());
      setIsTimerRunning(false);
      playCompletionNotification();
      setShowReportDialog(true);
    }
  };

  const skipComment = () => {
    // Track skip action
    if (currentComment?.author_username) {
      trackAction('skip', currentComment.author_username);
    }
    
    setJustRepliedComment(null);
    
    if (currentIndex < unrepliedComments.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setWorkflowStep('idle');
      setGeneratedReply("");
      setEditedReply("");
      setAlternatives([]);
    } else {
      // Last comment skipped, show report
      setWorkflowEndTime(new Date());
      setIsTimerRunning(false);
      playCompletionNotification();
      setShowReportDialog(true);
    }
  };

  const getSuggestedActions = useCallback((): SuggestedAction[] => {
    const actions: SuggestedAction[] = [];

    // Show follow action - green if already following
    if (isFollowing === true) {
      actions.push({
        id: 'follow',
        icon: <CheckCircle2 className="h-4 w-4" />,
        label: 'Já está seguindo',
        description: 'Você já segue este perfil',
        action: openInstagramProfile,
        variant: 'outline',
        highlight: false,
        isCompleted: true
      });
    } else if (isFollowRequested) {
      // Show "awaiting" state - request was sent
      actions.push({
        id: 'follow_requested',
        icon: <RefreshCw className="h-4 w-4" />,
        label: 'Solicitação enviada',
        description: 'Aguardando aprovação do follow',
        action: openInstagramProfile,
        variant: 'outline',
        highlight: false,
        isCompleted: true
      });
      // Also allow marking as following if they accepted
      actions.push({
        id: 'mark_following',
        icon: isMarkingAsFollowing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />,
        label: 'Marcar que aceitou',
        description: 'Confirmar que o follow foi aceito',
        action: markAsFollowing,
        variant: 'outline',
        highlight: false
      });
    } else {
      // Add action to open profile and follow
      actions.push({
        id: 'follow',
        icon: <UserPlus className="h-4 w-4" />,
        label: 'Seguir no Instagram',
        description: 'Abrir perfil para seguir',
        action: openInstagramProfile,
        variant: 'default',
        highlight: true
      });
      // Mark as follow requested (pending)
      actions.push({
        id: 'mark_requested',
        icon: isMarkingAsRequested ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />,
        label: 'Solicitei seguir',
        description: 'Registrar que enviei solicitação',
        action: markAsRequested,
        variant: 'outline',
        highlight: false
      });
      // Mark as already following
      actions.push({
        id: 'mark_following',
        icon: isMarkingAsFollowing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />,
        label: 'Marcar que já sigo',
        description: 'Registrar que você já segue este perfil',
        action: markAsFollowing,
        variant: 'outline',
        highlight: false
      });
    }

    // If no lead, suggest creating one; otherwise show as completed
    if (hasLead === false) {
      actions.push({
        id: 'create_lead',
        icon: <Target className="h-4 w-4" />,
        label: 'Criar Lead',
        description: 'Adicionar ao seu funil',
        action: createLead,
        variant: 'default',
        highlight: true
      });
    } else if (hasLead === true && linkedLeadId) {
      actions.push({
        id: 'lead_linked',
        icon: <CheckCircle2 className="h-4 w-4" />,
        label: 'Lead vinculado',
        description: 'Clique para ver detalhes do lead',
        action: () => {
          window.open(`/leads?leadId=${linkedLeadId}`, '_blank');
        },
        variant: 'outline',
        highlight: false,
        isCompleted: true
      });
    }

    // Always suggest DM - with suggestion if available
    // Show warning if author_id is missing or invalid
    const dmValidation = validateAuthorId(currentComment?.author_id);
    const hasDMWarning = !dmValidation.valid || dmValidation.warning !== null;
    
    let dmDescription = dmSuggestion ? 'Mensagem sugerida pela IA disponível' : 'Continuar conversa no Direct';
    if (!dmValidation.valid) {
      dmDescription = dmValidation.warning || 'ID não disponível - abrirá o perfil';
    } else if (dmValidation.warning) {
      dmDescription = dmValidation.warning;
    }
    
    actions.push({
      id: 'dm',
      icon: hasDMWarning ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <MessageCircle className="h-4 w-4" />,
      label: dmSuggestion ? 'Enviar DM (com sugestão)' : (hasDMWarning ? 'Enviar DM ⚠️' : 'Enviar DM'),
      description: dmDescription,
      action: async () => {
        if (dmSuggestion) {
          setEditedDmSuggestion(dmSuggestion);
          setShowDMDialog(true);
        } else {
          await saveDmToHistory('opened_only');
          openInstagramDM();
        }
      },
      variant: 'outline',
      highlight: !!dmSuggestion
    });

    // Always suggest registering contact - key for capilaridade
    actions.push({
      id: 'register_contact',
      icon: <MapPin className="h-4 w-4" />,
      label: 'Cadastrar Contato',
      description: 'Registrar cidade, estado e tipo (parceiro, indicação)',
      action: () => setShowContactRegistration(true),
      variant: 'outline',
      highlight: false
    });

    // Next comment action (always last)
    // When in suggesting_actions step, unrepliedComments has already shrunk by 1 (the just replied comment was removed)
    // So remaining = unrepliedComments.length is the correct count
    const remainingComments = unrepliedComments.length;
    if (remainingComments > 0) {
      actions.push({
        id: 'next',
        icon: <ArrowRight className="h-4 w-4" />,
        label: `Próximo (${remainingComments} restante${remainingComments > 1 ? 's' : ''})`,
        description: 'Responder o próximo comentário',
        action: goToNextComment,
        variant: 'default',
        highlight: true
      });
    } else {
      actions.push({
        id: 'finish',
        icon: <Trophy className="h-4 w-4" />,
        label: 'Concluir! 🎉',
        description: 'Todos os comentários respondidos',
        action: () => {
          setJustRepliedComment(null);
          setWorkflowEndTime(new Date());
          setIsTimerRunning(false);
          setShowReportDialog(true);
        },
        variant: 'default',
        highlight: true
      });
    }

    return actions;
  }, [isFollowing, isFollowRequested, hasLead, unrepliedComments.length, dmSuggestion, currentComment?.author_id, isMarkingAsFollowing, isMarkingAsRequested]);

  const handleClose = () => {
    onOpenChange(false);
    setCurrentIndex(0);
    setWorkflowStep('idle');
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
    setJustRepliedComment(null);
    setEditedDmSuggestion("");
    // Reset timer state
    setWorkflowStartTime(null);
    setWorkflowEndTime(null);
    setIsTimerRunning(false);
    setWorkflowActions([]);
  };
  
  // Handle closing after viewing report
  const handleCloseAfterReport = () => {
    setShowReportDialog(false);
    toast.success("🏆 Parabéns! Você zerou os comentários!");
    handleClose();
    onRefresh?.();
  };

  // Track contact registration
  const handleContactRegistered = () => {
    if (currentComment?.author_username) {
      trackAction('contact_registered', currentComment.author_username);
    }
    refetchUsername(currentComment?.author_username);
    onRefresh?.();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Modo Fluxo de Respostas
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>Responda comentários em ritmo acelerado</span>
            <div className="flex items-center gap-2">
              {/* Timer */}
              <WorkflowTimer isRunning={isTimerRunning} startTime={workflowStartTime} />
              
              {/* Report Button - show when there are actions */}
              {workflowActions.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setWorkflowEndTime(new Date());
                    setShowReportDialog(true);
                  }}
                  title="Ver relatório parcial"
                >
                  <FileText className="h-4 w-4" />
                </Button>
              )}
              
              {/* Open in new tab */}
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 w-7 p-0"
                onClick={() => {
                  window.open('/workflow', '_blank');
                  onOpenChange(false);
                }}
                title="Abrir em nova aba"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 w-7 p-0"
                onClick={() => setShowCardSettings(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Badge variant="secondary" className="gap-1">
                <Users className="h-3 w-3" />
                {repliedComments.size}/{repliedComments.size + totalComments} respondidos
              </Badge>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center pb-2 border-b">
          <span className="text-xs text-muted-foreground">Filtros:</span>
          
          {/* Post Type Filter */}
          <div className="flex gap-1">
            <Button
              variant={postTypeFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setPostTypeFilter('all');
                setCurrentIndex(0);
              }}
            >
              Todos
            </Button>
            <Button
              variant={postTypeFilter === 'own' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setPostTypeFilter('own');
                setRelationshipFilter([]);
                setCurrentIndex(0);
              }}
            >
              🏠 Próprios
            </Button>
            <Button
              variant={postTypeFilter === 'third_party' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setPostTypeFilter('third_party');
                setCurrentIndex(0);
              }}
            >
              🌐 Terceiros
            </Button>
          </div>
          
          {/* Relationship Filter - Only show when third_party filter is active */}
          {postTypeFilter === 'third_party' && (
            <div className="flex flex-wrap gap-1 items-center ml-2 pl-2 border-l">
              <span className="text-xs text-muted-foreground">Vínculos:</span>
              {['Primo', 'Amigo(a)', 'Irmão(ã)', 'Colega de trabalho', 'Indicação', 'Parceiro'].map(rel => (
                <Button
                  key={rel}
                  variant={relationshipFilter.includes(rel) ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => {
                    setRelationshipFilter(prev => 
                      prev.includes(rel) 
                        ? prev.filter(r => r !== rel)
                        : [...prev, rel]
                    );
                    setCurrentIndex(0);
                  }}
                >
                  {rel}
                </Button>
              ))}
              {relationshipFilter.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2 text-muted-foreground"
                  onClick={() => {
                    setRelationshipFilter([]);
                    setCurrentIndex(0);
                  }}
                >
                  Limpar
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-medium">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {totalComments === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
            <Trophy className="h-16 w-16 text-yellow-500 mb-4" />
            <h3 className="text-xl font-bold mb-2">Parabéns! 🎉</h3>
            <p className="text-muted-foreground mb-4">
              Você respondeu todos os comentários pendentes!
            </p>
            <Button onClick={handleClose}>
              Fechar
            </Button>
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {/* Current Comment */}
              {currentComment && (
                <div className="space-y-3">
                  {/* Third-party post warning */}
                  {isThirdPartyPost(currentComment) && (
                    <div className="p-3 rounded-lg border border-amber-500/50 bg-amber-500/10">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400 text-xs">
                              Post de Terceiro
                            </Badge>
                          </div>
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            <strong>Atenção:</strong> Este comentário foi feito em uma postagem de outra conta. 
                            Não é possível responder diretamente via API. 
                            <a 
                              href={currentComment.post_url || '#'} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="underline font-medium hover:no-underline ml-1"
                            >
                              Acesse a postagem original
                            </a> para interagir.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Post Preview */}
                  {currentComment.post_url && (
                    isMetadataFetching ? (
                      <PostPreviewCardSkeleton />
                    ) : postMetadata ? (
                      <PostPreviewCard
                        postUrl={currentComment.post_url}
                        caption={postMetadata.caption}
                        thumbnailUrl={postMetadata.thumbnailUrl}
                        mediaType={postMetadata.mediaType}
                        postOwner={postMetadata.ownerUsername}
                        compact
                      />
                    ) : (
                      <a
                        href={currentComment.post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border bg-card overflow-hidden flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 text-sm">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {isThirdPartyPost(currentComment) 
                              ? 'Postagem de Terceiro' 
                              : 'Postagem Original (Própria)'}
                          </span>
                        </div>
                        <span className="text-xs text-primary flex items-center gap-1">
                          Abrir <ExternalLink className="h-3 w-3" />
                        </span>
                      </a>
                    )
                  )}
                  
                  {/* Parent Comment (if replying to a comment) */}
                  {parentComment && (
                    <div className="p-3 rounded-lg border border-dashed bg-muted/30">
                      <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground">
                        <Reply className="h-3.5 w-3.5" />
                        <span>Respondendo ao comentário de</span>
                        {parentComment.author_username && (
                          <span className="font-medium text-foreground">
                            @{parentComment.author_username.replace('@', '')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground italic">
                        "{parentComment.comment_text?.slice(0, 150)}{(parentComment.comment_text?.length || 0) > 150 ? '...' : ''}"
                      </p>
                    </div>
                  )}
                  
                  {/* Current Comment Card */}
                  <div className="p-4 rounded-lg border bg-muted/50">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="secondary" className={
                        currentComment.platform === 'instagram' 
                          ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' 
                          : 'bg-blue-500 text-white'
                      }>
                        {currentComment.platform}
                      </Badge>
                      {currentComment.author_username && (
                        <InstagramProfileHoverCard 
                          username={currentComment.author_username}
                          className="font-medium"
                        />
                      )}
                      {parentComment && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Reply className="h-3 w-3" />
                          Resposta
                        </Badge>
                      )}
                    </div>
                    
                    {/* Contact context badges - interactive */}
                    <div className="mb-3">
                      <CommentCardBadges 
                        contactData={getContactData(currentComment.author_username)}
                        config={cardConfig}
                        compact={false}
                        interactive={true}
                        authorUsername={currentComment.author_username}
                        commentText={currentComment.comment_text}
                        onDataChanged={() => { refetchUsername(currentComment.author_username); onRefresh?.(); }}
                      />
                    </div>
                    <p className="text-sm">{currentComment.comment_text}</p>
                    
                    {/* Author ID info with validation */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {currentComment.author_id ? (
                        <>
                          <span className={cn(
                            "text-xs font-mono flex items-center gap-1",
                            authorIdValidation.warning ? "text-amber-600" : "text-muted-foreground"
                          )}>
                            {authorIdValidation.warning && (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {!authorIdValidation.warning && authorIdValidation.valid && (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            )}
                            ID: {currentComment.author_id}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => {
                                setEditedAuthorId(currentComment.author_id || "");
                                setShowEditAuthorId(true);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </span>
                          {authorIdValidation.warning && (
                            <span className="text-xs text-amber-600">
                              ({authorIdValidation.warning})
                            </span>
                          )}
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs gap-1 text-amber-600"
                          onClick={() => {
                            setEditedAuthorId("");
                            setShowEditAuthorId(true);
                          }}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          ID ausente - Corrigir
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Workflow Steps */}
              {workflowStep === 'idle' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium">Tom:</label>
                    <Select value={selectedTone} onValueChange={setSelectedTone}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TONES.map((tone) => (
                          <SelectItem key={tone.value} value={tone.value}>
                            <span className="flex items-center gap-2">
                              <span>{tone.emoji}</span>
                              <span>{tone.label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setShowCustomPrompt(!showCustomPrompt)}
                      className={cn(
                        "gap-1 text-xs",
                        customPrompt && "text-primary"
                      )}
                    >
                      <FileText className="h-3 w-3" />
                      {customPrompt ? "Prompt ativo" : "Prompt"}
                    </Button>
                  </div>
                  
                  {/* Custom Prompt Field */}
                  {showCustomPrompt && (
                    <div className="space-y-2 p-3 rounded-lg bg-muted/50 border">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium flex items-center gap-1">
                          <Bot className="h-3 w-3" />
                          Instruções para a IA
                        </Label>
                        {customPrompt && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-5 text-xs"
                            onClick={() => setCustomPrompt("")}
                          >
                            Limpar
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="Ex: 'Este post é sobre acidentes, responda com empatia e ofereça ajuda jurídica' ou 'Mencione que temos escritório em SP'"
                        rows={2}
                        className="resize-none text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        💡 Dica: Use para dar contexto adicional sobre o post ou instruções específicas de como responder.
                      </p>
                    </div>
                  )}
                  
                </div>
              )}

              {workflowStep === 'generating' && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                  <span className="ml-3">Gerando resposta inteligente...</span>
                </div>
              )}

              {(workflowStep === 'ready_to_reply' || workflowStep === 'replying') && (
                <div className="space-y-3">
                  {/* AI Reply Section Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Bot className="h-4 w-4 text-primary" />
                      <span>Resposta {generatedReply ? 'gerada pela IA' : 'para enviar'}</span>
                    </div>
                    {generatedReply && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          setEditedReply(generatedReply);
                        }}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restaurar original
                      </Button>
                    )}
                  </div>
                  
                  <Textarea
                    value={editedReply}
                    onChange={(e) => setEditedReply(e.target.value)}
                    rows={4}
                    className="resize-none text-sm"
                    placeholder="Digite ou edite sua resposta aqui..."
                    autoFocus
                  />
                  
                  {alternatives.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Alternativas sugeridas:</label>
                      <div className="flex flex-wrap gap-2">
                        {alternatives.map((alt, index) => (
                          <button
                            key={index}
                            onClick={() => setEditedReply(alt)}
                            className={cn(
                              "text-left px-3 py-2 text-xs rounded-md border transition-colors",
                              "hover:bg-muted/50 hover:border-primary/50",
                              editedReply === alt && "border-primary bg-primary/5"
                            )}
                          >
                            {alt.slice(0, 50)}...
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Suggested Actions after reply */}
              {workflowStep === 'suggesting_actions' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Resposta enviada!</span>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      Próximos passos sugeridos:
                    </p>
                    <div className="grid gap-2">
                      {getSuggestedActions().map((action) => (
                        <Button
                          key={action.id}
                          variant={action.variant}
                          className={cn(
                            "justify-start h-auto py-3 px-4",
                            action.highlight && "bg-primary/10 border-primary/30 hover:bg-primary/20",
                            action.isCompleted && "bg-green-50 border-green-200 hover:bg-green-100 dark:bg-green-950/30 dark:border-green-800 dark:hover:bg-green-900/30"
                          )}
                          onClick={action.action}
                        >
                          <div className="flex items-center gap-3 w-full">
                            <div className={cn(
                              "p-2 rounded-full",
                              action.highlight ? "bg-primary/20" : "bg-muted",
                              action.isCompleted && "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400"
                            )}>
                              {action.icon}
                            </div>
                            <div className="flex-1 text-left">
                              <div className="font-medium">{action.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {action.description}
                              </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Fixed Action Buttons at Bottom */}
        {totalComments > 0 && currentComment && workflowStep !== 'generating' && workflowStep !== 'suggesting_actions' && (
          <div className="pt-3 border-t mt-3">
            {workflowStep === 'idle' && (
              <div className="space-y-3">
                {/* Quick Emoji Replies */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Rápida:</span>
                  <div className="flex gap-1 flex-wrap">
                    {['❤️', '💙', '🙏', '👏', '🔥', '💪', '😊', '👍', '✨'].map((emoji) => (
                      <Button
                        key={emoji}
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 text-base hover:scale-110 transition-transform"
                        onClick={() => {
                          setEditedReply(emoji);
                          setWorkflowStep('ready_to_reply');
                        }}
                      >
                        {emoji}
                      </Button>
                    ))}
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button onClick={generateReply} className="flex-1 gap-2">
                    <Sparkles className="h-4 w-4" />
                    Gerar Resposta com IA
                  </Button>
                  <Button variant="outline" onClick={skipComment}>
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            
{(workflowStep === 'ready_to_reply' || workflowStep === 'replying') && (
              <div className="space-y-2">
                {/* Third-party post warning in reply section */}
                {currentComment?.comment_type && ['outbound_manual', 'outbound_n8n', 'outbound_export'].includes(currentComment.comment_type) && (
                  <div className="p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Resposta direta indisponível para posts de terceiros. 
                      <a 
                        href={currentComment.post_url || '#'} 
                        target="_blank"
                        rel="noopener noreferrer" 
                        className="underline ml-1 font-medium"
                      >
                        Comentar na postagem →
                      </a>
                    </span>
                  </div>
                )}
                
                <div className="flex gap-2">
                  {currentComment?.comment_type && ['outbound_manual', 'outbound_n8n', 'outbound_export'].includes(currentComment.comment_type) ? (
                    <Button 
                      onClick={() => window.open(currentComment.post_url || '#', '_blank')} 
                      className="flex-1 gap-2"
                      variant="outline"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Abrir Post para Comentar
                    </Button>
                  ) : (
                    <Button 
                      onClick={postReply} 
                      className="flex-1 gap-2"
                      disabled={workflowStep === 'replying' || !editedReply.trim()}
                    >
                      {workflowStep === 'replying' ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Postar no Instagram
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setWorkflowStep('idle')}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
      
      {/* Card Settings Dialog */}
      <CommentCardSettingsDialog
        open={showCardSettings}
        onOpenChange={setShowCardSettings}
        config={cardConfig}
        onUpdateField={updateCardField}
        onReset={resetCardSettings}
      />
      
      {/* DM Suggestion Dialog */}
      <Dialog open={showDMDialog} onOpenChange={setShowDMDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              Mensagem para DM
            </DialogTitle>
            <DialogDescription>
              Sugestão de mensagem gerada pela IA para enviar no Direct
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 pt-2">
            {/* DM Suggestion - Editable */}
            <div className="space-y-2">
              <Textarea
                value={editedDmSuggestion}
                onChange={(e) => setEditedDmSuggestion(e.target.value)}
                rows={5}
                className="resize-none"
                placeholder="Edite a mensagem de DM..."
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{editedDmSuggestion.length} caracteres</span>
                {editedDmSuggestion !== dmSuggestion && dmSuggestion && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => setEditedDmSuggestion(dmSuggestion)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restaurar original
                  </Button>
                )}
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={async () => {
                  if (editedDmSuggestion) {
                    navigator.clipboard.writeText(editedDmSuggestion);
                    toast.success("Mensagem copiada!");
                    await saveDmToHistory('copied');
                  }
                }}
              >
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={async () => {
                  if (editedDmSuggestion) {
                    navigator.clipboard.writeText(editedDmSuggestion);
                    toast.success("Mensagem copiada! Abrindo DM...");
                    await saveDmToHistory('copied_and_opened');
                  }
                  openInstagramDM();
                  setShowDMDialog(false);
                }}
              >
                <Send className="h-4 w-4" />
                Copiar e Abrir DM
              </Button>
            </div>
            
            {/* Note about author_id with edit option - show if invalid or has warning */}
            {(!authorIdValidation.valid || authorIdValidation.warning) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex-1">
                    {authorIdValidation.warning || "ID do usuário não disponível. O link abrirá o perfil ao invés do Direct."}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => {
                      setEditedAuthorId(currentComment?.author_id || "");
                      setShowEditAuthorId(true);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                    Corrigir
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Edit Author ID Dialog */}
      <Dialog open={showEditAuthorId} onOpenChange={setShowEditAuthorId}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Corrigir ID do Autor
            </DialogTitle>
            <DialogDescription>
              Insira o ID numérico correto do perfil do Instagram para este comentário
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="author-id">ID do Usuário (numérico)</Label>
              <Input
                id="author-id"
                value={editedAuthorId}
                onChange={(e) => setEditedAuthorId(e.target.value.replace(/\D/g, ''))}
                placeholder="Ex: 117638302956677"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                O ID pode ser encontrado no link do Direct: instagram.com/direct/t/<strong>ID_AQUI</strong>
              </p>
            </div>
            
            {currentComment?.author_id && (
              <div className="p-2 rounded-md bg-muted/50 border">
                <p className="text-xs text-muted-foreground">
                  ID atual: <span className="font-mono">{currentComment.author_id}</span>
                </p>
              </div>
            )}
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowEditAuthorId(false)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={saveAuthorId}
                disabled={!editedAuthorId.trim() || isSavingAuthorId}
              >
                {isSavingAuthorId ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post-DM Contact Registration */}
      {currentComment?.author_username && (
        <PostDmContactRegistration
          open={showContactRegistration}
          onOpenChange={setShowContactRegistration}
          instagramUsername={currentComment.author_username}
          onContactSaved={handleContactRegistered}
        />
      )}
      
      {/* Workflow Report Dialog */}
      <WorkflowReportDialog
        open={showReportDialog}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseAfterReport();
          } else {
            setShowReportDialog(open);
          }
        }}
        actions={workflowActions}
        startTime={workflowStartTime}
        endTime={workflowEndTime}
        totalComments={repliedComments.size + totalComments}
        repliedCount={repliedComments.size}
      />
    </Dialog>
  );
};
