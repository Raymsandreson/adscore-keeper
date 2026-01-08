import { useEffect, useState } from "react";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Instagram, Facebook } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Post } from "./EditorialCalendar";

interface PostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Post | null;
  onSave: (post: Partial<Post>) => void;
}

const contentTypes = [
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "carousel", label: "Carrossel" },
  { value: "reels", label: "Reels" },
  { value: "story", label: "Story" },
];

export function PostDialog({ open, onOpenChange, post, onSave }: PostDialogProps) {
  const [formData, setFormData] = useState<{
    title: string;
    description: string;
    platform: "instagram" | "facebook";
    content_type: "image" | "video" | "carousel" | "reels" | "story";
    scheduled_date: Date;
    scheduled_time: string;
    assigned_to: string;
    hashtags: string[];
    notes: string;
  }>({
    title: "",
    description: "",
    platform: "instagram",
    content_type: "image",
    scheduled_date: new Date(),
    scheduled_time: "10:00",
    assigned_to: "",
    hashtags: [],
    notes: "",
  });

  const [hashtagInput, setHashtagInput] = useState("");

  useEffect(() => {
    if (post) {
      setFormData({
        title: post.title || "",
        description: post.description || "",
        platform: post.platform || "instagram",
        content_type: post.content_type || "image",
        scheduled_date: post.scheduled_date || new Date(),
        scheduled_time: post.scheduled_time || "10:00",
        assigned_to: post.assigned_to || "",
        hashtags: post.hashtags || [],
        notes: post.notes || "",
      });
    } else {
      setFormData({
        title: "",
        description: "",
        platform: "instagram",
        content_type: "image",
        scheduled_date: new Date(),
        scheduled_time: "10:00",
        assigned_to: "",
        hashtags: [],
        notes: "",
      });
    }
    setHashtagInput("");
  }, [post, open]);

  const handleAddHashtag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const tag = hashtagInput.trim().replace(/^#/, "");
      if (tag && !formData.hashtags.includes(tag)) {
        setFormData(prev => ({
          ...prev,
          hashtags: [...prev.hashtags, tag],
        }));
      }
      setHashtagInput("");
    }
  };

  const handleRemoveHashtag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      hashtags: prev.hashtags.filter(t => t !== tag),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {post?.id ? "Editar Post" : "Novo Post"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Título do post"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assigned_to">Responsável</Label>
              <Input
                id="assigned_to"
                value={formData.assigned_to}
                onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value }))}
                placeholder="Nome do responsável"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Descreva o conteúdo do post..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Plataforma</Label>
              <Select
                value={formData.platform}
                onValueChange={(value: "instagram" | "facebook") => 
                  setFormData(prev => ({ ...prev, platform: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram">
                    <div className="flex items-center gap-2">
                      <Instagram className="h-4 w-4 text-pink-500" />
                      Instagram
                    </div>
                  </SelectItem>
                  <SelectItem value="facebook">
                    <div className="flex items-center gap-2">
                      <Facebook className="h-4 w-4 text-blue-500" />
                      Facebook
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipo de Conteúdo</Label>
              <Select
                value={formData.content_type}
                onValueChange={(value: "image" | "video" | "carousel" | "reels" | "story") => 
                  setFormData(prev => ({ ...prev, content_type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data de Publicação</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.scheduled_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.scheduled_date ? (
                      format(formData.scheduled_date, "PPP", { locale: ptBR })
                    ) : (
                      "Selecione a data"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.scheduled_date}
                    onSelect={(date) => date && setFormData(prev => ({ ...prev, scheduled_date: date }))}
                    locale={ptBR}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="time">Horário</Label>
              <Input
                id="time"
                type="time"
                value={formData.scheduled_time}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduled_time: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hashtags">Hashtags</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {formData.hashtags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary rounded-full text-sm"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveHashtag(tag)}
                    className="hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <Input
              id="hashtags"
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={handleAddHashtag}
              placeholder="Digite e pressione Enter para adicionar"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Observações adicionais..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">
              {post?.id ? "Salvar Alterações" : "Criar Post"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
