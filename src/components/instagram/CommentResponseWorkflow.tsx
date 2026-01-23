import { useState, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
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
  Settings
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InstagramProfileHoverCard } from "./InstagramProfileHoverCard";
import { CommentCardBadges } from "./CommentCardBadges";
import { CommentCardSettingsDialog } from "./CommentCardSettingsDialog";
import { useCommentContactInfo } from "@/hooks/useCommentContactInfo";
import { useCommentCardSettings } from "@/hooks/useCommentCardSettings";

interface Comment {
  id: string;
  comment_id?: string;
  comment_text: string | null;
  author_username: string | null;
  post_url: string | null;
  platform: string;
  created_at: string;
  replied_at?: string | null;
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
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [hasLead, setHasLead] = useState<boolean | null>(null);
  const [repliedComments, setRepliedComments] = useState<Set<string>>(new Set());
  const [showCardSettings, setShowCardSettings] = useState(false);
  
  // Card settings
  const { config: cardConfig, updateField: updateCardField, resetToDefaults: resetCardSettings } = useCommentCardSettings();
  
  // Get usernames for contact info lookup
  const commentUsernames = useMemo(() => {
    return comments
      .filter(c => c.author_username)
      .map(c => c.author_username!)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [comments]);
  
  const { getContactData } = useCommentContactInfo(commentUsernames);

  // Get unreplied comments that have a comment_id (can be replied to via API)
  const unrepliedComments = useMemo(() => {
    return comments.filter(c => 
      c.comment_id && 
      !c.replied_at && 
      !repliedComments.has(c.id)
    );
  }, [comments, repliedComments]);

  const currentComment = unrepliedComments[currentIndex];
  const totalComments = unrepliedComments.length;
  const progress = totalComments > 0 ? ((repliedComments.size) / (repliedComments.size + totalComments)) * 100 : 100;

  // Check if user is following and if lead exists
  useEffect(() => {
    if (currentComment?.author_username) {
      checkUserStatus(currentComment.author_username);
    }
  }, [currentComment?.author_username]);

  const checkUserStatus = async (username: string) => {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    
    // Check if contact exists and get follower status
    const { data: contact } = await supabase
      .from('contacts')
      .select('follower_status, id')
      .or(`instagram_username.ilike.${normalizedUsername},instagram_username.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();
    
    setIsFollowing(contact?.follower_status === 'following' || contact?.follower_status === 'mutual');
    
    // Check if lead exists
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .or(`instagram_username.ilike.${normalizedUsername},lead_name.ilike.@${normalizedUsername}`)
      .limit(1)
      .maybeSingle();
    
    setHasLead(!!lead);
  };

  const generateReply = async () => {
    if (!currentComment?.comment_text) return;

    setWorkflowStep('generating');
    setGeneratedReply("");
    setAlternatives([]);

    try {
      const { data, error } = await supabase.functions.invoke("generate-ai-reply", {
        body: {
          comment: currentComment.comment_text,
          authorUsername: currentComment.author_username?.replace("@", ""),
          postContext: null,
          tone: selectedTone,
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

    setWorkflowStep('replying');

    try {
      const { data, error } = await supabase.functions.invoke("post-instagram-reply", {
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
        .update({ replied_at: new Date().toISOString() })
        .eq('id', currentComment.id);

      setRepliedComments(prev => new Set([...prev, currentComment.id]));
      onCommentReplied?.(currentComment.id);
      
      toast.success("Resposta postada! 🎉");
      setWorkflowStep('suggesting_actions');
    } catch (error: any) {
      console.error("Error posting reply:", error);
      toast.error(error.message || "Erro ao postar resposta");
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
    } catch (error) {
      console.error('Error creating lead:', error);
      toast.error('Erro ao criar lead');
    }
  };

  const openInstagramProfile = () => {
    const username = currentComment?.author_username?.replace('@', '');
    if (username) {
      window.open(`https://instagram.com/${username}`, '_blank');
    }
  };

  const openInstagramDM = () => {
    const username = currentComment?.author_username?.replace('@', '');
    if (username) {
      window.open(`https://instagram.com/direct/t/${username}`, '_blank');
    }
  };

  const goToNextComment = () => {
    setWorkflowStep('idle');
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
    
    if (currentIndex < unrepliedComments.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // All done!
      toast.success("🎉 Todos os comentários foram respondidos!");
      onOpenChange(false);
      onRefresh?.();
    }
  };

  const skipComment = () => {
    if (currentIndex < unrepliedComments.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setWorkflowStep('idle');
      setGeneratedReply("");
      setEditedReply("");
      setAlternatives([]);
    } else {
      toast.info("Não há mais comentários para responder");
      onOpenChange(false);
    }
  };

  const getSuggestedActions = useCallback((): SuggestedAction[] => {
    const actions: SuggestedAction[] = [];

    // If not following, suggest to follow
    if (isFollowing === false) {
      actions.push({
        id: 'follow',
        icon: <UserPlus className="h-4 w-4" />,
        label: 'Seguir no Instagram',
        description: 'Abrir perfil para seguir',
        action: openInstagramProfile,
        variant: 'default',
        highlight: true
      });
    }

    // If no lead, suggest creating one
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
    }

    // Always suggest DM
    actions.push({
      id: 'dm',
      icon: <MessageCircle className="h-4 w-4" />,
      label: 'Enviar DM',
      description: 'Continuar conversa no Direct',
      action: openInstagramDM,
      variant: 'outline'
    });

    // Next comment action (always last)
    const remainingComments = unrepliedComments.length - currentIndex - 1;
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
          toast.success("🏆 Parabéns! Você zerou os comentários!");
          onOpenChange(false);
          onRefresh?.();
        },
        variant: 'default',
        highlight: true
      });
    }

    return actions;
  }, [isFollowing, hasLead, currentIndex, unrepliedComments.length]);

  const handleClose = () => {
    onOpenChange(false);
    setCurrentIndex(0);
    setWorkflowStep('idle');
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Modo Fluxo de Respostas
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>Responda comentários em ritmo acelerado</span>
            <div className="flex items-center gap-2">
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
                  </div>
                  
                  {/* Contact context badges */}
                  <div className="mb-3">
                    <CommentCardBadges 
                      contactData={getContactData(currentComment.author_username)}
                      config={cardConfig}
                      compact={false}
                    />
                  </div>
                  <p className="text-sm">{currentComment.comment_text}</p>
                  {currentComment.post_url && (
                    <a
                      href={currentComment.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
                    >
                      Ver post <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
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

              {workflowStep === 'generating' && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                  <span className="ml-3">Gerando resposta inteligente...</span>
                </div>
              )}

              {(workflowStep === 'ready_to_reply' || workflowStep === 'replying') && (
                <div className="space-y-3">
                  <Textarea
                    value={editedReply}
                    onChange={(e) => setEditedReply(e.target.value)}
                    rows={3}
                    className="resize-none"
                    placeholder="Edite a resposta se necessário..."
                  />
                  
                  {alternatives.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Alternativas:</label>
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

                  <div className="flex gap-2">
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
                    <Button variant="outline" onClick={() => setWorkflowStep('idle')}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
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
                            action.highlight && "bg-primary/10 border-primary/30 hover:bg-primary/20"
                          )}
                          onClick={action.action}
                        >
                          <div className="flex items-center gap-3 w-full">
                            <div className={cn(
                              "p-2 rounded-full",
                              action.highlight ? "bg-primary/20" : "bg-muted"
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
      </DialogContent>
      
      {/* Card Settings Dialog */}
      <CommentCardSettingsDialog
        open={showCardSettings}
        onOpenChange={setShowCardSettings}
        config={cardConfig}
        onUpdateField={updateCardField}
        onReset={resetCardSettings}
      />
    </Dialog>
  );
};
