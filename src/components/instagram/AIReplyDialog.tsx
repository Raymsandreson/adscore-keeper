import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Send, RefreshCw, Sparkles, Copy, Check, MessageCircle, FileText } from "lucide-react";
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
}

const TONES = [
  { value: "friendly", label: "Amigável", emoji: "😊" },
  { value: "professional", label: "Profissional", emoji: "💼" },
  { value: "empathetic", label: "Empático", emoji: "🤗" },
  { value: "sales", label: "Comercial", emoji: "🎯" },
  { value: "casual", label: "Casual", emoji: "✌️" },
];

export const AIReplyDialog = ({ open, onOpenChange, comment, accessToken, onReplyPosted }: AIReplyDialogProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [selectedTone, setSelectedTone] = useState("friendly");
  const [generatedReply, setGeneratedReply] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [editedReply, setEditedReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

  const generateReply = async () => {
    if (!comment?.comment_text) return;

    setIsGenerating(true);
    setGeneratedReply("");
    setAlternatives([]);

    try {
      const { data, error } = await supabase.functions.invoke("generate-ai-reply", {
        body: {
          comment: comment.comment_text,
          authorUsername: comment.author_username?.replace("@", ""),
          postContext: null,
          tone: selectedTone,
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
        return;
      }

      setGeneratedReply(data.reply);
      setEditedReply(data.reply);
      setAlternatives(data.alternatives || []);
    } catch (error: any) {
      console.error("Error generating reply:", error);
      toast.error("Erro ao gerar resposta. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  const postReply = async () => {
    if (!editedReply.trim() || !comment) return;

    // Check if we have a comment_id (from Instagram API) to reply to
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
      
      // Reset state
      setGeneratedReply("");
      setEditedReply("");
      setAlternatives([]);
    } catch (error: any) {
      console.error("Error posting reply:", error);
      toast.error(error.message || "Erro ao postar resposta");
    } finally {
      setIsPosting(false);
    }
  };

  const selectAlternative = (alt: string) => {
    setEditedReply(alt);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(editedReply);
    setCopied(true);
    toast.success("Resposta copiada!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    onOpenChange(false);
    setGeneratedReply("");
    setEditedReply("");
    setAlternatives([]);
    setCustomPrompt("");
    setShowCustomPrompt(false);
  };

  if (!comment) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Responder com IA
          </DialogTitle>
          <DialogDescription>
            Gere uma resposta inteligente para o comentário de{" "}
            <strong className="text-foreground">@{comment.author_username?.replace("@", "")}</strong>
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

          {/* Generated Reply */}
          {generatedReply && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Resposta sugerida:</label>
                <Textarea
                  value={editedReply}
                  onChange={(e) => setEditedReply(e.target.value)}
                  rows={3}
                  className="resize-none"
                  placeholder="Edite a resposta se necessário..."
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{editedReply.length} caracteres</span>
                  <Button variant="ghost" size="sm" onClick={copyToClipboard} className="h-7">
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
            </>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
