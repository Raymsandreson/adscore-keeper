import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageSquarePlus, Loader2 } from "lucide-react";

interface InstagramAccount {
  id: string;
  instagram_id: string;
  account_name: string;
}

interface OutboundCommentDialogProps {
  accounts: InstagramAccount[];
  onSuccess?: () => void;
}

export const OutboundCommentDialog = ({ accounts, onSuccess }: OutboundCommentDialogProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    accountId: "",
    targetUsername: "",
    postUrl: "",
    commentText: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.accountId || !formData.targetUsername || !formData.commentText) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsLoading(true);

    try {
      const selectedAccount = accounts.find(a => a.id === formData.accountId);
      
      // Try n8n webhook first for automated flow
      const n8nWebhookUrl = "https://webhooks.prudenciosolucoes.com.br/webhook/outbound-comment";
      
      try {
        await fetch(n8nWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "no-cors",
          body: JSON.stringify({
            account_id: selectedAccount?.instagram_id,
            account_name: selectedAccount?.account_name,
            target_username: formData.targetUsername,
            comment_text: formData.commentText,
            post_url: formData.postUrl || "",
          }),
        });
        
        toast.success("Comentário enviado para automação n8n!");
      } catch (n8nError) {
        console.warn("n8n webhook failed, falling back to direct insert:", n8nError);
        
        // Fallback to direct database insert
        const { error } = await supabase.from("instagram_comments").insert({
          ad_account_id: selectedAccount?.instagram_id,
          author_username: selectedAccount?.account_name?.replace("@", ""),
          comment_text: formData.commentText,
          comment_type: "outbound_manual",
          post_url: formData.postUrl || null,
          prospect_name: formData.targetUsername,
          platform: "instagram",
          metadata: {
            target_username: formData.targetUsername,
            registered_manually: true,
            registered_at: new Date().toISOString(),
          },
        });

        if (error) throw error;
        toast.success("Comentário outbound registrado!");
      }

      setFormData({ accountId: "", targetUsername: "", postUrl: "", commentText: "" });
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error("Erro ao registrar comentário:", error);
      toast.error("Erro ao registrar comentário");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          Registrar Comentário Outbound
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Comentário em Post de Terceiros</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account">Conta utilizada *</Label>
            <Select
              value={formData.accountId}
              onValueChange={(value) => setFormData(prev => ({ ...prev, accountId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetUsername">@ do dono do post *</Label>
            <Input
              id="targetUsername"
              placeholder="@usuario"
              value={formData.targetUsername}
              onChange={(e) => setFormData(prev => ({ ...prev, targetUsername: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="postUrl">URL do post (opcional)</Label>
            <Input
              id="postUrl"
              placeholder="https://instagram.com/p/..."
              value={formData.postUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, postUrl: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="commentText">Texto do comentário *</Label>
            <Textarea
              id="commentText"
              placeholder="O que você comentou..."
              value={formData.commentText}
              onChange={(e) => setFormData(prev => ({ ...prev, commentText: e.target.value }))}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
