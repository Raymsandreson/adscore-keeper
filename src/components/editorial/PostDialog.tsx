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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, X, Link as LinkIcon, FileIcon, Plus, Trash2, ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./PlatformIcon";
import { PostChecklist } from "./PostChecklist";
import type { Post, Platform, ContentType, PostTag, PostFile, ChecklistItem, ChecklistItemStatus, ChecklistStatusConfig } from "@/types/editorial";
import { platformConfig, contentTypeConfig, defaultTags, defaultChecklistStatusConfig } from "@/types/editorial";

interface PostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: Post | null;
  onSave: (post: Partial<Post>) => void;
  defaultPlatform?: Platform;
  availableTags?: PostTag[];
  checklistStatusConfig?: Record<ChecklistItemStatus, ChecklistStatusConfig>;
  onAddTag?: (label: string, color: string) => PostTag;
  onUpdateTag?: (id: string, updates: Partial<PostTag>) => void;
  onDeleteTag?: (id: string) => void;
}

interface FormData {
  title: string;
  description: string;
  platform: Platform;
  content_type: ContentType;
  scheduled_date: Date;
  scheduled_time: string;
  assigned_to: string;
  hashtags: string[];
  notes: string;
  links: string[];
  tags: PostTag[];
  checklist: ChecklistItem[];
}

export function PostDialog({ 
  open, 
  onOpenChange, 
  post, 
  onSave, 
  defaultPlatform,
  availableTags: externalTags,
  checklistStatusConfig = defaultChecklistStatusConfig,
  onAddTag: externalAddTag,
  onUpdateTag: externalUpdateTag,
  onDeleteTag: externalDeleteTag,
}: PostDialogProps) {
  const [formData, setFormData] = useState<FormData>({
    title: "",
    description: "",
    platform: defaultPlatform || "instagram",
    content_type: "image",
    scheduled_date: new Date(),
    scheduled_time: "10:00",
    assigned_to: "",
    hashtags: [],
    notes: "",
    links: [],
    tags: [],
    checklist: [],
  });

  const [hashtagInput, setHashtagInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [localTags, setLocalTags] = useState<PostTag[]>(defaultTags);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [isChecklistOpen, setIsChecklistOpen] = useState(true);

  // Use external tags if provided, otherwise use local state
  const availableTags = externalTags || localTags;
  const setAvailableTags = externalTags ? undefined : setLocalTags;

  useEffect(() => {
    if (post) {
      setFormData({
        title: post.title || "",
        description: post.description || "",
        platform: post.platform || defaultPlatform || "instagram",
        content_type: post.content_type || "image",
        scheduled_date: post.scheduled_date || new Date(),
        scheduled_time: post.scheduled_time || "10:00",
        assigned_to: post.assigned_to || "",
        hashtags: post.hashtags || [],
        notes: post.notes || "",
        links: post.links || [],
        tags: post.tags || [],
        checklist: post.checklist || [],
      });
    } else {
      setFormData({
        title: "",
        description: "",
        platform: defaultPlatform || "instagram",
        content_type: "image",
        scheduled_date: new Date(),
        scheduled_time: "10:00",
        assigned_to: "",
        hashtags: [],
        notes: "",
        links: [],
        tags: [],
        checklist: [],
      });
    }
    setHashtagInput("");
    setLinkInput("");
  }, [post, open, defaultPlatform]);

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

  const handleAddLink = () => {
    if (linkInput.trim()) {
      setFormData(prev => ({
        ...prev,
        links: [...prev.links, linkInput.trim()],
      }));
      setLinkInput("");
    }
  };

  const handleRemoveLink = (index: number) => {
    setFormData(prev => ({
      ...prev,
      links: prev.links.filter((_, i) => i !== index),
    }));
  };

  const handleToggleTag = (tag: PostTag) => {
    setFormData(prev => {
      const exists = prev.tags.some(t => t.id === tag.id);
      if (exists) {
        return { ...prev, tags: prev.tags.filter(t => t.id !== tag.id) };
      } else {
        return { ...prev, tags: [...prev.tags, tag] };
      }
    });
  };

  const handleAddNewTag = () => {
    if (newTagLabel.trim()) {
      const colors = ["bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-green-500", "bg-yellow-500", "bg-red-500", "bg-cyan-500"];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      
      if (externalAddTag) {
        const newTag = externalAddTag(newTagLabel.trim(), randomColor);
        setFormData(prev => ({ ...prev, tags: [...prev.tags, newTag] }));
      } else {
        const newTag: PostTag = {
          id: String(Date.now()),
          label: newTagLabel.trim(),
          color: randomColor,
        };
        setLocalTags(prev => [...prev, newTag]);
        setFormData(prev => ({ ...prev, tags: [...prev.tags, newTag] }));
      }
      setNewTagLabel("");
    }
  };

  const handleDeleteTag = (tagId: string) => {
    if (externalDeleteTag) {
      externalDeleteTag(tagId);
    } else {
      setLocalTags(prev => prev.filter(t => t.id !== tagId));
    }
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t.id !== tagId),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const platforms: Platform[] = ["instagram", "tiktok", "facebook", "kwai", "youtube"];
  const contentTypes: ContentType[] = ["image", "video", "carousel", "reels", "story", "shorts", "live"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {post?.id ? "Editar Atividade" : "Nova Atividade"}
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
                placeholder="Título da atividade"
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
              placeholder="Descreva o conteúdo..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Plataforma</Label>
              <Select
                value={formData.platform}
                onValueChange={(value: Platform) => 
                  setFormData(prev => ({ ...prev, platform: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map(platform => (
                    <SelectItem key={platform} value={platform}>
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={platform} className="h-4 w-4" />
                        {platformConfig[platform].label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipo de Conteúdo</Label>
              <Select
                value={formData.content_type}
                onValueChange={(value: ContentType) => 
                  setFormData(prev => ({ ...prev, content_type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {contentTypeConfig[type]}
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

          {/* Tags Section */}
          <div className="space-y-2">
            <Label>Etiquetas</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {availableTags.map(tag => {
                const isSelected = formData.tags.some(t => t.id === tag.id);
                return (
                  <div key={tag.id} className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleToggleTag(tag)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-white transition-all",
                        tag.color,
                        isSelected ? "ring-2 ring-offset-2 ring-primary" : "opacity-60 hover:opacity-100"
                      )}
                    >
                      {tag.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTag(tag.id)}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTagLabel}
                onChange={(e) => setNewTagLabel(e.target.value)}
                placeholder="Nova etiqueta..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddNewTag())}
              />
              <Button type="button" size="sm" variant="outline" onClick={handleAddNewTag}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Links Section */}
          <div className="space-y-2">
            <Label>Links</Label>
            <div className="space-y-2 mb-2">
              {formData.links.map((link, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                  <LinkIcon className="h-4 w-4 text-muted-foreground" />
                  <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm text-primary flex-1 truncate hover:underline">
                    {link}
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleRemoveLink(index)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddLink())}
              />
              <Button type="button" size="sm" variant="outline" onClick={handleAddLink}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Hashtags */}
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

          {/* Checklist Section */}
          <Collapsible open={isChecklistOpen} onOpenChange={setIsChecklistOpen}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                type="button"
                className="w-full flex items-center justify-between p-2 h-auto"
              >
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" />
                  <Label className="cursor-pointer">Checklist de Atividades</Label>
                  {formData.checklist.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({formData.checklist.filter(i => i.status === "completed").length}/{formData.checklist.length})
                    </span>
                  )}
                </div>
                <ChevronDown className={cn("h-4 w-4 transition-transform", isChecklistOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <PostChecklist
                checklist={formData.checklist}
                onChange={(checklist) => setFormData(prev => ({ ...prev, checklist }))}
                checklistStatusConfig={checklistStatusConfig}
              />
            </CollapsibleContent>
          </Collapsible>

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
              {post?.id ? "Salvar Alterações" : "Criar Atividade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
