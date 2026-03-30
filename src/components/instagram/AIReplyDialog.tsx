import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, RefreshCw, Sparkles, Copy, Check, MessageCircle, FileText, AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/contexts/AuthContext";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  const { user } = useAuthContext();
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTone, setSelectedTone] = useState("casual");
  const [generatedReply, setGeneratedReply] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [editedReply, setEditedReply] = useState("");
  const [dmSuggestion, setDmSuggestion] = useState<string | null>(null);
  const [editedDm, setEditedDm] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedDm, setCopiedDm] = useState(false);
  const [markedComment, setMarkedComment] = useState(false);
  const [markedDm, setMarkedDm] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

  const generateReply = async () => {
    if (!comment?.comment_text) return;

    setIsGenerating(true);
    setGeneratedReply("");
    setAlternatives([]);
    setDmSuggestion(null);
    setMarkedComment(false);
    setMarkedDm(false);

    try {
      const { data, error } = await cloudFunctions.invoke("generate-ai-reply", {
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

  // Helper to find lead ID by instagram username (direct or through contacts)
  const findLeadByUsername = async (username: string): Promise<string | null> => {
    // 1. Direct lookup on leads table
    const { data: directLead } = await supabase
      .from('leads')
      .select('id')
      .eq('instagram_username', username)
      .maybeSingle();
    if (directLead) return directLead.id;

    // 2. Lookup through contacts → contact_leads
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('instagram_username', username)
      .maybeSingle();
    if (contact) {
      const { data: contactLead } = await supabase
        .from('contact_leads')
        .select('lead_id')
        .eq('contact_id', contact.id)
        .limit(1)
        .maybeSingle();
      if (contactLead) return contactLead.lead_id;
    }

    return null;
  };

  const markAsCommented = async () => {
    if (!comment) return;
    
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const username = (comment.author_username?.replace('@', '') || '').toLowerCase();

      // Try to update existing instagram_comments record (mark as replied)
      const { data: existingComment } = await supabase
        .from('instagram_comments')
        .select('id')
        .eq('id', comment.id)
        .maybeSingle();

      if (existingComment) {
        await supabase
          .from('instagram_comments')
          .update({ replied_at: new Date().toISOString(), replied_by: currentUser?.id || null })
          .eq('id', comment.id);
      }

      // Always insert a "sent" outbound comment record so it appears in contact history
      if (editedReply.trim()) {
        await supabase
          .from('instagram_comments')
          .insert({
            comment_text: editedReply.trim(),
            author_username: username,
            post_url: comment.post_url || '',
            comment_type: 'sent',
            replied_at: new Date().toISOString(),
            replied_by: currentUser?.id || null,
            is_from_post_owner: true,
          } as any);
      }

      // Find linked lead and add followup
      if (username) {
        const leadId = await findLeadByUsername(username);
        if (leadId) {
          await supabase.from('lead_followups').insert({
            lead_id: leadId,
            followup_type: 'instagram_comment',
            notes: `Comentário feito no post: ${comment.post_url || 'N/A'}\n\nTexto: ${editedReply.slice(0, 500)}`,
            outcome: 'done',
          });
        }
      }
      
      setMarkedComment(true);
      toast.success("Comentário registrado! ✅");
      onReplyPosted?.();
    } catch (error) {
      console.error('Error marking as commented:', error);
      toast.error("Erro ao marcar como comentado");
    }
  };

  const markDmSent = async () => {
    if (!comment) return;

    const username = (comment.author_username?.replace('@', '') || '').toLowerCase();
    
    try {
      // Log to dm_history (without comment_id FK if comment doesn't exist in instagram_comments)
      const dmInsert: any = {
        user_id: user?.id,
        instagram_username: username,
        dm_message: editedDm.trim(),
        original_suggestion: dmSuggestion || '',
        was_edited: editedDm.trim() !== (dmSuggestion || '').trim(),
        action_type: 'sent',
        author_id: (comment as any).author_id || null,
      };

      // Only set comment_id if it exists in instagram_comments
      const { data: existingComment } = await supabase
        .from('instagram_comments')
        .select('id')
        .eq('id', comment.id)
        .maybeSingle();
      
      if (existingComment) {
        dmInsert.comment_id = comment.id;
      }

      await supabase.from('dm_history').insert(dmInsert);

      // Find linked lead and add followup
      if (username) {
        const leadId = await findLeadByUsername(username);
        if (leadId) {
          await supabase.from('lead_followups').insert({
            lead_id: leadId,
            followup_type: 'instagram_dm',
            notes: `DM enviada via Instagram para @${username}\n\nTexto: ${editedDm.slice(0, 500)}`,
            outcome: 'done',
          });
        }
      }

      setMarkedDm(true);
      toast.success("DM registrada no histórico! 📩");
      onReplyPosted?.();
    } catch (error) {
      console.error('Error marking DM as sent:', error);
      toast.error("Erro ao registrar DM");
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
    setMarkedComment(false);
    setMarkedDm(false);
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
            Gerar Comentário + DM
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              Post de terceiro — copie e interaja manualmente no Instagram
            </span>
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

          {/* Generated Reply - Comment Section */}
          {generatedReply && (
            <>
              {/* Instagram-style comment thread preview */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-blue-500" />
                  <label className="text-sm font-medium">Comentário:</label>
                  {markedComment && (
                    <Badge variant="outline" className="border-green-500 text-green-600 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Enviado
                    </Badge>
                  )}
                </div>

                {/* Instagram-style thread */}
                <div className="rounded-lg border overflow-hidden">
                  {/* Original comment */}
                  <div className="p-3 bg-muted/30">
                    <div className="flex items-start gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {(comment.author_username || '?')[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold">{comment.author_username || 'usuário'}</span>
                        <p className="text-sm mt-0.5">{comment.comment_text}</p>
                        <span className="text-[11px] text-muted-foreground mt-1 block">Comentário original</span>
                      </div>
                    </div>
                  </div>

                  {/* Our reply - indented like Instagram */}
                  <div className={cn(
                    "p-3 pl-12 border-t",
                    markedComment ? "bg-green-50/50 dark:bg-green-950/20" : "bg-background"
                  )}>
                    <div className="flex items-start gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                        V
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-primary">Você</span>
                        {markedComment ? (
                          <p className="text-sm mt-0.5">{editedReply}</p>
                        ) : (
                          <Textarea
                            value={editedReply}
                            onChange={(e) => setEditedReply(e.target.value)}
                            rows={2}
                            className="resize-none mt-1 text-sm"
                            placeholder="Edite o comentário..."
                          />
                        )}
                      </div>
                    </div>
                    {!markedComment && (
                      <div className="flex items-center justify-end gap-2 mt-2">
                        <span className="text-[11px] text-muted-foreground mr-auto">{editedReply.length} chars</span>
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(editedReply, 'comment')} className="h-7 text-xs">
                          {copied ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Copy className="h-3 w-3 mr-1" />}
                          {copied ? "Copiado!" : "Copiar"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={markAsCommented}
                          className="h-7 text-xs"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Marcar Comentado
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Alternatives */}
              {!markedComment && alternatives.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Alternativas:</label>
                  <div className="space-y-1.5">
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

              {/* DM Section - Instagram DM style */}
              {dmSuggestion && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-blue-500" />
                    <label className="text-sm font-medium">Direct Message:</label>
                    {markedDm && (
                      <Badge variant="outline" className="border-green-500 text-green-600 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Enviada
                      </Badge>
                    )}
                  </div>

                  {/* Instagram DM bubble style */}
                  <div className="rounded-lg border overflow-hidden bg-muted/10">
                    <div className="p-2 border-b bg-muted/30 flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500 flex items-center justify-center text-white text-[10px] font-bold">
                        {(comment.author_username || '?')[0]?.toUpperCase()}
                      </div>
                      <span className="text-xs font-medium">{comment.author_username || 'usuário'}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">Direct</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {/* Our DM message - right-aligned like Instagram */}
                      <div className="flex justify-end">
                        <div className={cn(
                          "max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2",
                          markedDm 
                            ? "bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100" 
                            : "bg-primary text-primary-foreground"
                        )}>
                          {markedDm ? (
                            <p className="text-sm">{editedDm}</p>
                          ) : (
                            <Textarea
                              value={editedDm}
                              onChange={(e) => setEditedDm(e.target.value)}
                              rows={2}
                              className="resize-none text-sm bg-transparent border-none p-0 text-primary-foreground placeholder:text-primary-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0"
                              placeholder="Edite a DM..."
                            />
                          )}
                        </div>
                      </div>
                      {markedDm && (
                        <div className="flex justify-end">
                          <span className="text-[10px] text-muted-foreground">Enviada ✓✓</span>
                        </div>
                      )}
                    </div>
                    {!markedDm && (
                      <div className="p-2 border-t flex items-center justify-end gap-2">
                        <span className="text-[11px] text-muted-foreground mr-auto">{editedDm.length} chars</span>
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(editedDm, 'dm')} className="h-7 text-xs">
                          {copiedDm ? <Check className="h-3 w-3 mr-1 text-green-500" /> : <Copy className="h-3 w-3 mr-1" />}
                          {copiedDm ? "Copiado!" : "Copiar DM"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={markDmSent}
                          disabled={!editedDm.trim()}
                          className="h-7 text-xs"
                        >
                          <Mail className="h-3 w-3 mr-1" />
                          Marcar DM Enviada
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {markedComment || markedDm ? "Fechar" : "Cancelar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
