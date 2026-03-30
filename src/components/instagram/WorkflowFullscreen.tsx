import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  FileText,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeft
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
}

interface ParentComment {
  id: string;
  comment_text: string | null;
  author_username: string | null;
}

interface WorkflowFullscreenProps {
  comments: Comment[];
  accessToken?: string;
  onClose: () => void;
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

export const WorkflowFullscreen = ({ 
  comments, 
  accessToken,
  onClose,
  onRefresh
}: WorkflowFullscreenProps) => {
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
  const [justRepliedComment, setJustRepliedComment] = useState<Comment | null>(null);
  const [editedDmSuggestion, setEditedDmSuggestion] = useState<string>("");
  const [isMarkingAsFollowing, setIsMarkingAsFollowing] = useState(false);
  const [isMarkingAsRequested, setIsMarkingAsRequested] = useState(false);
  const [showEditAuthorId, setShowEditAuthorId] = useState(false);
  const [editedAuthorId, setEditedAuthorId] = useState("");
  const [isSavingAuthorId, setIsSavingAuthorId] = useState(false);
  const [showContactRegistration, setShowContactRegistration] = useState(false);
  const [localAuthorIdUpdates, setLocalAuthorIdUpdates] = useState<Record<string, string>>({});
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Timer and report tracking
  const [workflowStartTime, setWorkflowStartTime] = useState<Date | null>(null);
  const [workflowEndTime, setWorkflowEndTime] = useState<Date | null>(null);
  const [workflowActions, setWorkflowActions] = useState<WorkflowAction[]>([]);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const actionIdCounter = useRef(0);

  // Card settings
  const { config: cardConfig, updateField: updateCardField, resetToDefaults: resetCardSettings } = useCommentCardSettings();
  
  // Auth context
  const { user } = useAuthContext();
  
  // Activity logger
  const { logActivity } = useActivityLogger();
  
  // Post metadata for preview
  const { fetchMetadata, getCachedMetadata, isLoading: isLoadingMetadata } = usePostMetadata();
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

  // Get unreplied comments
  const unrepliedComments = useMemo(() => {
    return comments.filter(c => 
      c.comment_id && 
      !c.replied_at && 
      !repliedComments.has(c.id)
    );
  }, [comments, repliedComments]);

  // Current comment
  const baseComment = workflowStep === 'suggesting_actions' && justRepliedComment 
    ? justRepliedComment 
    : unrepliedComments[currentIndex];
  
  const currentComment = baseComment ? {
    ...baseComment,
    author_id: localAuthorIdUpdates[baseComment.id] || baseComment.author_id
  } : baseComment;
  
  const totalComments = unrepliedComments.length;
  const progress = totalComments > 0 ? ((repliedComments.size) / (repliedComments.size + totalComments)) * 100 : 100;

  // Start timer
  useEffect(() => {
    if (!workflowStartTime && unrepliedComments.length > 0) {
      setWorkflowStartTime(new Date());
      setIsTimerRunning(true);
      setWorkflowActions([]);
    }
  }, [workflowStartTime, unrepliedComments.length]);

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
    }
  }, [currentComment?.post_url]);

  // Check user status
  useEffect(() => {
    if (currentComment?.author_username) {
      checkUserStatus(currentComment.author_username);
    }
    if (currentComment?.parent_comment_id) {
      fetchParentComment(currentComment.parent_comment_id);
    }
  }, [currentComment?.author_username, currentComment?.parent_comment_id, currentIndex]);

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
    
    const { data: contact } = await supabase
      .from('contacts')
      .select('follower_status, id, follow_requested_at')
      .or(`instagram_username.ilike.${normalizedUsername},instagram_username.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();
    
    setIsFollowing(contact?.follower_status === 'following' || contact?.follower_status === 'mutual');
    setIsFollowRequested(!!contact?.follow_requested_at && contact?.follower_status !== 'following' && contact?.follower_status !== 'mutual');
    
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .or(`instagram_username.ilike.${normalizedUsername},lead_name.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();
    
    let linkedLeadIdFromContact: string | null = null;
    if (contact?.id) {
      const { data: linkedLeads } = await supabase
        .from('contact_leads')
        .select('lead_id')
        .eq('contact_id', contact.id)
        .limit(1);
      if (linkedLeads && linkedLeads.length > 0) {
        linkedLeadIdFromContact = linkedLeads[0].lead_id;
      }
    }
    
    const foundLeadId = lead?.id || linkedLeadIdFromContact;
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
      let postContext = null;
      if (currentComment.post_url) {
        postContext = `Post do Instagram: ${currentComment.post_url}`;
      }

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

      await supabase
        .from('instagram_comments')
        .update({ replied_at: new Date().toISOString(), replied_by: user?.id || null })
        .eq('id', currentComment.id);

      setRepliedComments(prev => new Set([...prev, currentComment.id]));
      
      trackAction('reply', currentComment.author_username || 'unknown');
      
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

  const skipComment = () => {
    if (currentComment) {
      trackAction('skip', currentComment.author_username || 'unknown');
    }
    
    setRepliedComments(prev => new Set([...prev, currentComment?.id || '']));
    moveToNextComment();
  };

  const moveToNextComment = () => {
    setWorkflowStep('idle');
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
    setDmSuggestion(null);
    setJustRepliedComment(null);
    setCustomPrompt("");
    setShowCustomPrompt(false);
    
    if (currentIndex >= unrepliedComments.length - 1) {
      if (unrepliedComments.length <= 1) {
        playCompletionNotification();
        setWorkflowEndTime(new Date());
        setIsTimerRunning(false);
        setShowReportDialog(true);
      }
    }
  };

  const playCompletionNotification = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
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
      playNote(523.25, now, 0.15);
      playNote(659.25, now + 0.15, 0.15);
      playNote(783.99, now + 0.3, 0.3);
    } catch (e) {
      console.log('Audio not supported');
    }
    
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100, 50, 200]);
    }
    
    toast.success("🎉 Fluxo concluído com sucesso!");
  }, []);

  const goToComment = (index: number) => {
    if (index >= 0 && index < unrepliedComments.length) {
      setCurrentIndex(index);
      setWorkflowStep('idle');
      setGeneratedReply("");
      setEditedReply("");
      setAlternatives([]);
    }
  };

  const getSuggestedActions = (): SuggestedAction[] => {
    const actions: SuggestedAction[] = [];
    
    if (!isFollowing && !isFollowRequested) {
      actions.push({
        id: 'follow',
        icon: <UserPlus className="h-4 w-4" />,
        label: 'Seguir no Instagram',
        description: 'Abra o perfil para seguir este usuário',
        action: () => {
          const username = currentComment?.author_username?.replace('@', '');
          if (username) {
            window.open(`https://instagram.com/${username}`, '_blank');
            trackAction('follow', username);
          }
        },
        variant: 'outline',
        highlight: true
      });
    }
    
    if (!hasLead) {
      actions.push({
        id: 'create_lead',
        icon: <Target className="h-4 w-4" />,
        label: 'Criar Lead',
        description: 'Adicione este contato como lead no CRM',
        action: async () => {
          if (!currentComment?.author_username) return;
          const username = currentComment.author_username.replace('@', '').toLowerCase();
          
          const { error } = await supabase
            .from('leads')
            .insert([{
              lead_name: `@${username}`,
              instagram_username: username,
              source: 'instagram_comment',
              instagram_comment_id: currentComment.id,
              status: 'novo'
            }]);
          
          if (error) {
            toast.error("Erro ao criar lead");
          } else {
            toast.success("Lead criado! ✨");
            setHasLead(true);
            trackAction('lead', username);
          }
        },
        variant: 'outline'
      });
    } else {
      actions.push({
        id: 'view_lead',
        icon: <Target className="h-4 w-4" />,
        label: 'Lead vinculado',
        description: 'Este contato já está no CRM',
        action: () => {
          if (linkedLeadId) {
            window.open(`/leads?leadId=${linkedLeadId}`, '_blank');
          }
        },
        variant: 'outline',
        isCompleted: true
      });
    }
    
    if (dmSuggestion) {
      actions.push({
        id: 'send_dm',
        icon: <MessageCircle className="h-4 w-4" />,
        label: 'Enviar DM',
        description: 'Copie a sugestão de mensagem e abra o Direct',
        action: () => {
          setEditedDmSuggestion(dmSuggestion);
          setShowDMDialog(true);
        },
        variant: 'outline'
      });
    }
    
    actions.push({
      id: 'next',
      icon: <ArrowRight className="h-4 w-4" />,
      label: 'Próximo Comentário',
      description: 'Avançar para o próximo comentário pendente',
      action: moveToNextComment,
      variant: 'default'
    });
    
    return actions;
  };

  const authorIdValidation = useMemo(() => {
    const authorId = currentComment?.author_id;
    if (!authorId) return { valid: false, warning: null };
    if (authorId.includes('-')) return { valid: false, warning: "ID em formato UUID - pode não funcionar para DM" };
    if (!/^\d+$/.test(authorId)) return { valid: false, warning: "ID contém caracteres não numéricos" };
    return { valid: true, warning: null };
  }, [currentComment?.author_id]);

  const openInstagramDM = () => {
    const authorId = currentComment?.author_id;
    const username = currentComment?.author_username?.replace('@', '');
    
    if (authorId && authorIdValidation.valid) {
      window.open(`https://instagram.com/direct/t/${authorId}`, '_blank');
    } else if (username) {
      window.open(`https://instagram.com/${username}`, '_blank');
    }
    
    if (currentComment?.author_username) {
      trackAction('dm', currentComment.author_username);
      logActivity({
        actionType: 'dm_sent',
        entityType: 'comment',
        entityId: currentComment.id,
        metadata: { username: currentComment.author_username }
      });
    }
  };

  const saveAuthorId = async () => {
    if (!currentComment || !editedAuthorId.trim()) return;
    
    setIsSavingAuthorId(true);
    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({ author_id: editedAuthorId.trim() })
        .eq('id', currentComment.id);
      
      if (error) throw error;
      
      setLocalAuthorIdUpdates(prev => ({
        ...prev,
        [currentComment.id]: editedAuthorId.trim()
      }));
      
      toast.success("ID atualizado!");
      setShowEditAuthorId(false);
    } catch (error) {
      toast.error("Erro ao salvar ID");
    } finally {
      setIsSavingAuthorId(false);
    }
  };

  const saveDmToHistory = async (actionType: 'copied' | 'copied_and_opened') => {
    if (!currentComment?.author_username) return;
    
    await supabase.from('dm_history').insert({
      user_id: user?.id,
      instagram_username: currentComment.author_username.replace('@', ''),
      dm_message: editedDmSuggestion,
      original_suggestion: dmSuggestion,
      was_edited: editedDmSuggestion !== dmSuggestion,
      action_type: actionType,
      comment_id: currentComment.id,
      author_id: currentComment.author_id
    });
  };

  const handleContactRegistered = () => {
    if (currentComment?.author_username) {
      trackAction('contact_registered', currentComment.author_username);
    }
    refetchUsername(currentComment?.author_username);
    onRefresh?.();
  };

  const handleCloseAfterReport = () => {
    setShowReportDialog(false);
    onClose();
  };

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <div className={cn(
        "border-r bg-muted/30 transition-all duration-300 flex flex-col",
        sidebarOpen ? "w-72" : "w-0 overflow-hidden"
      )}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Comentários Pendentes</h3>
          <Badge variant="secondary">{unrepliedComments.length}</Badge>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {unrepliedComments.map((comment, index) => {
              const isActive = index === currentIndex && workflowStep !== 'suggesting_actions';
              const contactData = getContactData(comment.author_username);
              
              return (
                <button
                  key={comment.id}
                  onClick={() => goToComment(index)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg transition-colors",
                    "hover:bg-muted/80",
                    isActive && "bg-primary/10 border border-primary/30"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      comment.platform === 'instagram' 
                        ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-purple-300' 
                        : ''
                    )}>
                      {comment.platform}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      @{comment.author_username?.replace('@', '')}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2 text-muted-foreground">
                    {comment.comment_text}
                  </p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {format(new Date(comment.created_at), "dd MMM, HH:mm", { locale: ptBR })}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b px-4 py-3 flex items-center justify-between bg-background">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="h-8 w-8 p-0"
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <span className="font-semibold">Modo Fluxo de Respostas</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <WorkflowTimer isRunning={isTimerRunning} startTime={workflowStartTime} />
            
            {workflowActions.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setWorkflowEndTime(new Date());
                  setShowReportDialog(true);
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                Relatório
              </Button>
            )}
            
            <Button variant="ghost" size="sm" onClick={() => setShowCardSettings(true)}>
              <Settings className="h-4 w-4" />
            </Button>
            
            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" />
              {repliedComments.size}/{repliedComments.size + totalComments} respondidos
            </Badge>
          </div>
        </header>

        {/* Progress */}
        <div className="px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-medium">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          {totalComments === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
              <Trophy className="h-16 w-16 text-yellow-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Parabéns! 🎉</h3>
              <p className="text-muted-foreground mb-4">
                Você respondeu todos os comentários pendentes!
              </p>
              <Button onClick={onClose}>
                Fechar
              </Button>
            </div>
          ) : currentComment && (
            <div className="max-w-3xl mx-auto space-y-4">
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
                      <span className="font-medium">Postagem Original</span>
                    </div>
                    <span className="text-xs text-primary flex items-center gap-1">
                      Abrir <ExternalLink className="h-3 w-3" />
                    </span>
                  </a>
                )
              )}
              
              {/* Parent Comment */}
              {parentComment && (
                <div className="p-3 rounded-lg border border-dashed bg-muted/30">
                  <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground">
                    <Reply className="h-3.5 w-3.5" />
                    <span>Respondendo ao comentário de</span>
                    <span className="font-medium text-foreground">
                      @{parentComment.author_username?.replace('@', '')}
                    </span>
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
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs gap-1"
                    onClick={() => {
                      const username = currentComment.author_username?.replace('@', '');
                      if (username) {
                        navigator.clipboard.writeText(`@${username}`);
                        toast.success('Username copiado!');
                      }
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                
                <p className="text-lg leading-relaxed mb-3">@{currentComment.author_username?.replace('@', '')} {currentComment.comment_text}</p>
                
                {/* Badges */}
                <CommentCardBadges
                  contactData={getContactData(currentComment.author_username)}
                  config={cardConfig}
                  interactive={true}
                  authorUsername={currentComment.author_username}
                  commentText={currentComment.comment_text}
                  onDataChanged={() => {
                    refetchUsername(currentComment.author_username);
                    onRefresh?.();
                  }}
                />
                
                {/* Author ID */}
                <div className="mt-2 flex items-center gap-2">
                  {authorIdValidation.valid ? (
                    <Badge variant="outline" className="text-xs font-mono gap-1 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
                      <CheckCircle2 className="h-3 w-3" />
                      ID: {currentComment.author_id?.slice(0, 12)}...
                    </Badge>
                  ) : (
                    <Badge 
                      variant="outline" 
                      className="text-xs font-mono gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 cursor-pointer"
                      onClick={() => {
                        setEditedAuthorId(currentComment.author_id || "");
                        setShowEditAuthorId(true);
                      }}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {currentComment.author_id ? 'ID inválido' : 'Sem ID'}
                      <Pencil className="h-3 w-3 ml-1" />
                    </Badge>
                  )}
                </div>
              </div>

              {/* AI Reply Section */}
              {workflowStep === 'idle' && (
                <div className="space-y-3 p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-sm font-medium">Tom:</label>
                    <Select value={selectedTone} onValueChange={setSelectedTone}>
                      <SelectTrigger className="w-[150px]">
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
                        placeholder="Ex: 'Este post é sobre acidentes, responda com empatia e ofereça ajuda jurídica'"
                        rows={2}
                        className="resize-none text-sm"
                      />
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
                <div className="space-y-3 p-4 rounded-lg border bg-card">
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

              {/* Suggested Actions */}
              {workflowStep === 'suggesting_actions' && (
                <div className="space-y-4 p-4 rounded-lg border bg-card">
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
                            action.isCompleted && "bg-green-50 border-green-200 hover:bg-green-100 dark:bg-green-950/30 dark:border-green-800"
                          )}
                          onClick={action.action}
                        >
                          <div className="flex items-center gap-3 w-full">
                            <div className={cn(
                              "p-2 rounded-full",
                              action.highlight ? "bg-primary/20" : "bg-muted",
                              action.isCompleted && "bg-green-100 text-green-600 dark:bg-green-900/50"
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
          )}
        </div>

        {/* Fixed Action Buttons */}
        {totalComments > 0 && currentComment && workflowStep !== 'generating' && workflowStep !== 'suggesting_actions' && (
          <div className="border-t p-4 bg-background">
            <div className="max-w-3xl mx-auto">
              {workflowStep === 'idle' && (
                <div className="space-y-3">
                  {/* Quick Emoji Replies */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Resposta rápida:</span>
                    <div className="flex gap-1 flex-wrap">
                      {['❤️', '💙', '🙏', '👏', '🔥', '💪', '😊', '👍', '✨'].map((emoji) => (
                        <Button
                          key={emoji}
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 p-0 text-lg hover:scale-110 transition-transform"
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
                    <Button onClick={generateReply} className="flex-1 gap-2" size="lg">
                      <Sparkles className="h-4 w-4" />
                      Gerar Resposta com IA
                    </Button>
                    <Button variant="outline" onClick={skipComment} size="lg">
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              
              {(workflowStep === 'ready_to_reply' || workflowStep === 'replying') && (
                <div className="flex gap-2">
                  <Button 
                    onClick={postReply} 
                    className="flex-1 gap-2"
                    size="lg"
                    disabled={workflowStep === 'replying' || !editedReply.trim()}
                  >
                    {workflowStep === 'replying' ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Postar no Instagram
                  </Button>
                  <Button variant="outline" onClick={() => setWorkflowStep('idle')} size="lg">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CommentCardSettingsDialog
        open={showCardSettings}
        onOpenChange={setShowCardSettings}
        config={cardConfig}
        onUpdateField={updateCardField}
        onReset={resetCardSettings}
      />
      
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
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditAuthorId} onOpenChange={setShowEditAuthorId}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Editar ID do Usuário
            </DialogTitle>
            <DialogDescription>
              Insira o ID numérico correto do perfil do Instagram
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
            
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowEditAuthorId(false)}>
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

      {currentComment?.author_username && (
        <PostDmContactRegistration
          open={showContactRegistration}
          onOpenChange={setShowContactRegistration}
          instagramUsername={currentComment.author_username}
          onContactSaved={handleContactRegistered}
        />
      )}
      
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
    </div>
  );
};
