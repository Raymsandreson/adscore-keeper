import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Image,
  Video,
  Loader2,
  Upload,
  FileText,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdBriefings } from "@/hooks/useAdBriefings";
import { toast } from "sonner";

interface CreateBriefingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId?: string;
  leadName?: string;
}

export function CreateBriefingDialog({ open, onOpenChange, leadId, leadName }: CreateBriefingDialogProps) {
  const { createBriefing } = useAdBriefings();
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [creativeType, setCreativeType] = useState<"image" | "video">("image");
  const [creativeUrl, setCreativeUrl] = useState("");
  const [headline, setHeadline] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");
  const [notes, setNotes] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      toast.error("Arquivo muito grande (máx 20MB)");
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const path = `briefings/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("ad-creatives")
        .upload(path, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("ad-creatives")
        .getPublicUrl(path);

      setCreativeUrl(publicUrl);
      setCreativeType(file.type.startsWith("video") ? "video" : "image");
      toast.success("Arquivo enviado!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar arquivo");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreate = async () => {
    if (!headline.trim() && !bodyText.trim() && !creativeUrl) {
      toast.error("Preencha pelo menos o criativo ou a copy");
      return;
    }

    setIsCreating(true);
    const success = await createBriefing({
      leadId,
      leadName,
      creativeUrl,
      creativeType,
      headline,
      bodyText,
      linkDescription,
      cta,
      notes,
    });

    setIsCreating(false);
    if (success) {
      onOpenChange(false);
      // Reset
      setCreativeUrl("");
      setHeadline("");
      setBodyText("");
      setLinkDescription("");
      setCta("LEARN_MORE");
      setNotes("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Novo Briefing de Criativo
          </DialogTitle>
          {leadName && (
            <p className="text-sm text-muted-foreground">
              Lead: <span className="font-medium text-foreground">{leadName}</span>
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Creative Type */}
          <div className="space-y-2">
            <Label>Tipo de Criativo</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreativeType("image")}
                className={cn(
                  "flex-1 p-3 rounded-lg border text-sm transition-all text-center",
                  creativeType === "image"
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <Image className="h-5 w-5 mx-auto mb-1" />
                Imagem
              </button>
              <button
                type="button"
                onClick={() => setCreativeType("video")}
                className={cn(
                  "flex-1 p-3 rounded-lg border text-sm transition-all text-center",
                  creativeType === "video"
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <Video className="h-5 w-5 mx-auto mb-1" />
                Vídeo
              </button>
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label>Upload do Criativo</Label>
            {creativeUrl ? (
              <div className="relative border rounded-lg overflow-hidden">
                {creativeType === "video" ? (
                  <video src={creativeUrl} controls className="w-full max-h-48 object-contain bg-muted" />
                ) : (
                  <img src={creativeUrl} alt="Preview" className="w-full max-h-48 object-contain bg-muted" />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6 bg-background/80"
                  onClick={() => setCreativeUrl("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer hover:bg-muted/50 transition-colors">
                {isUploading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Clique ou arraste para enviar
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {creativeType === "video" ? "MP4, MOV (máx 20MB)" : "JPG, PNG, WEBP (máx 20MB)"}
                    </p>
                  </>
                )}
                <input
                  type="file"
                  className="hidden"
                  accept={creativeType === "video" ? "video/*" : "image/*"}
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
              </label>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Ou cole a URL:</Label>
              <Input
                value={creativeUrl}
                onChange={(e) => setCreativeUrl(e.target.value)}
                placeholder="https://..."
                className="text-sm"
              />
            </div>
          </div>

          {/* Copy Fields */}
          <div className="space-y-2">
            <Label>Título do Anúncio</Label>
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Ex: Conheça seus direitos trabalhistas"
            />
          </div>

          <div className="space-y-2">
            <Label>Texto Principal (Copy)</Label>
            <Textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Texto que aparece no corpo do anúncio..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Descrição do Link (opcional)</Label>
            <Input
              value={linkDescription}
              onChange={(e) => setLinkDescription(e.target.value)}
              placeholder="Descrição que aparece abaixo do título"
            />
          </div>

          <div className="space-y-2">
            <Label>Botão de Ação (CTA)</Label>
            <Select value={cta} onValueChange={setCta}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LEARN_MORE">Saiba Mais</SelectItem>
                <SelectItem value="CONTACT_US">Fale Conosco</SelectItem>
                <SelectItem value="SEND_MESSAGE">Enviar Mensagem</SelectItem>
                <SelectItem value="SIGN_UP">Cadastre-se</SelectItem>
                <SelectItem value="CALL_NOW">Ligue Agora</SelectItem>
                <SelectItem value="GET_QUOTE">Obter Cotação</SelectItem>
                <SelectItem value="WATCH_MORE">Assistir Mais</SelectItem>
                <SelectItem value="APPLY_NOW">Inscreva-se</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instruções adicionais para o gestor de tráfego..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={isCreating} className="gap-2">
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar Briefing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
