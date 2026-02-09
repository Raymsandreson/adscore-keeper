import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Send, RefreshCw, Sparkles, Copy, Check, MessageCircle, FileText, AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Comment {
  id: string;
  comment_id?: string;
  comment_text: string | null;
  author_username: string | null;
  post_url: string | null;
}

interface AIReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comment: Comment | null;
  accessToken?: string;
  onReplyPosted?: () => void;
  isThirdPartyPost?: boolean;
}

const TONES = [
  { value: "friendly", label: "Amigável", emoji: "😊" },
  { value: "professional", label: "Profissional", emoji: "💼" },
  { value: "empathetic", label: "Empático", emoji: "🤗" },
  { value: "sales", label: "Comercial", emoji: "🎯" },
  { value: "casual", label: "Casual", emoji: "✌️" },
];

export const AIReplyDialog = ({ open, onOpenChange, comment, accessToken, onReplyPosted, isThirdPartyPost = false }: AIReplyDialogProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [selectedTone, setSelectedTone] = useState("friendly");
  const [generatedReply, setGeneratedReply] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [editedReply, setEditedReply] = useState("");
  const [dmSuggestion, setDmSuggestion] = useState<string | null>(null);
  const [editedDm, setEditedDm] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedDm, setCopiedDm] = useState(false);
  const [markedAsDone, setMarkedAsDone] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

  const generateReply = async () => {
    if (!comment?.comment_text) return;

    setIsGenerating(true);
    setGeneratedReply("");
    setAlternatives([]);
    setDmSuggestion(null);
    setMarkedAsDone(false);

    try {
      const { data, error } = await supabase.functions.invoke("generate-ai-reply", {
        body: {
          comment: comment.comment_text,
          authorUsername: comment.author_username?.replace("@", ""),
          postContext: null,
          tone: selectedTone,
          customPrompt: customPrompt.trim() || null,
          generateDM: true,
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
        return;
      }

      setGeneratedReply(data.reply);
      setEditedReply(data.reply);
      setAlternatives(data.alternatives || []);
      setDmSuggestion(data.dmSuggestion || null);
      setEditedDm(data.dmSuggestion || "");
    } catch (error: any) {
      console.error("Error generating reply:", error);
      toast.error("Erro ao gerar resposta. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  const postReply = async () => {
    if (!editedReply.trim() || !comment) return;

    const commentIdToReply = (comment as any).comment_id;
    if (!commentIdToReply) {
      toast.error("Este comentário não pode receber respostas (registrado manualmente)");
      return;
    }

    setIsPosting(true);

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

      toast.success("Resposta postada no Instagram! 🎉");
      onOpenChange(false);
      onReplyPosted?.();
      resetState();
    } catch (error: any) {
      console.error("Error posting reply:", error);
      toast.error(error.message || "Erro ao postar resposta");
    } finally {
      setIsPosting(false);
    }
  };

  const markAsCommented = async () => {
    if (!comment) return;
    
    try {
      await supabase
        .from('instagram_comments')
        .update({ replied_at: new Date().toISOString(), replied_by: 'manual' })
        .eq('id', comment.id);
      
      setMarkedAsDone(true);
      toast.success("Marcado como comentado! ✅");
      onReplyPosted?.();
    } catch (error) {
      toast.error("Erro ao marcar como comentado");
    }
  };

  const selectAlternative = (alt: string) => {
    setEditedReply(alt);
  };

  const copyToClipboard = async (text: string, type: 'comment' | 'dm') => {
    await navigator.clipboard.writeText(text);
    if (type === 'comment') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopiedDm(true);
      setTimeout(() => setCopiedDm(false), 2000);
    }
    toast.success(type === 'comment' ? "Comentário copiado!" : "DM copiada!");
  };

  const resetState = () => {
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
    setDmSuggestion(null);
    setEditedDm("");
    setCustomPrompt("");
    setShowCustomPrompt(false);
    setMarkedAsDone(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  if (!comment) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {isThirdPartyPost ? "Gerar Comentário + DM" : "Responder com IA"}
          </DialogTitle>
          <DialogDescription>
            {isThirdPartyPost ? (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                Post de terceiro — copie e comente manualmente
              </span>
            ) : (
              <>
                Gere uma resposta inteligente para o comentário de{" "}
                <strong className="text-foreground">@{comment.author_username?.replace("@", "")}</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-y-auto">
          {/* Original Comment */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Comentário original:</span>
            </div>
            <p className="text-sm">{comment.comment_text}</p>
          </div>

          {/* Tone Selector */}
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
              {customPrompt ? "✓" : "Prompt"}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={generateReply}
              disabled={isGenerating}
              className="ml-auto"
            >
              {isGenerating ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {generatedReply ? "Regenerar" : "Gerar"}
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
                placeholder="Ex: 'Este post é sobre luto/tragédia, responda com empatia' ou 'Mencione nosso serviço de indenização'"
                rows={2}
                className="resize-none text-sm"
              />
              <p className="text-xs text-muted-foreground">
                💡 Use para dar contexto sobre o post ou instruções específicas.
              </p>
            </div>
          )}

          {/* Generated Reply - Comment */}
          {generatedReply && (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-blue-500" />
                  <label className="text-sm font-medium">Comentário sugerido:</label>
                </div>
                <Textarea
                  value={editedReply}
                  onChange={(e) => setEditedReply(e.target.value)}
                  rows={3}
                  className="resize-none"
                  placeholder="Edite a resposta se necessário..."
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{editedReply.length} caracteres</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(editedReply, 'comment')} className="h-7">
                    {copied ? (
                      <Check className="h-3 w-3 mr-1 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 mr-1" />
                    )}
                    {copied ? "Copiado!" : "Copiar"}
                  </Button>
                </div>
              </div>

              {/* Alternatives */}
              {alternatives.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Alternativas:</label>
                  <div className="space-y-2">
                    {alternatives.map((alt, index) => (
                      <button
                        key={index}
                        onClick={() => selectAlternative(alt)}
                        className={cn(
                          "w-full text-left p-2 text-sm rounded-md border transition-colors",
                          "hover:bg-muted/50 hover:border-primary/50",
                          editedReply === alt && "border-primary bg-primary/5"
                        )}
                      >
                        {alt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* DM Suggestion */}
              {dmSuggestion && (
                <div className="space-y-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-blue-500" />
                    <label className="text-sm font-medium">Mensagem para DM:</label>
                  </div>
                  <Textarea
                    value={editedDm}
                    onChange={(e) => setEditedDm(e.target.value)}
                    rows={3}
                    className="resize-none text-sm"
                    placeholder="Edite a DM se necessário..."
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{editedDm.length} caracteres</span>
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(editedDm, 'dm')} className="h-7">
                      {copiedDm ? (
                        <Check className="h-3 w-3 mr-1 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3 mr-1" />
                      )}
                      {copiedDm ? "Copiado!" : "Copiar DM"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          {isThirdPartyPost ? (
            <Button
              onClick={markAsCommented}
              disabled={!generatedReply || markedAsDone}
              variant={markedAsDone ? "outline" : "default"}
              className={markedAsDone ? "border-green-500 text-green-600" : ""}
            >
              {markedAsDone ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {markedAsDone ? "Comentado ✅" : "Marcar como Comentado"}
            </Button>
          ) : (
            <Button
              onClick={postReply}
              disabled={!editedReply.trim() || isPosting}
            >
              {isPosting ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Postar Resposta
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};