import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, X, Pencil, Check, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PostTag, PostStatus, ChecklistItemStatus, ChecklistStatusConfig } from "@/types/editorial";

interface StatusConfig {
  label: string;
  className: string;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusConfig: Record<PostStatus, StatusConfig>;
  tags: PostTag[];
  checklistStatusConfig: Record<ChecklistItemStatus, ChecklistStatusConfig>;
  onUpdateStatusLabel: (status: PostStatus, label: string) => void;
  onUpdateChecklistStatusLabel: (status: ChecklistItemStatus, label: string) => void;
  onAddTag: (label: string, color: string) => void;
  onUpdateTag: (id: string, updates: Partial<PostTag>) => void;
  onDeleteTag: (id: string) => void;
}

const statusKeys: PostStatus[] = ["draft", "scheduled", "published", "failed"];
const checklistStatusKeys: ChecklistItemStatus[] = ["completed", "pending", "delayed", "edited", "awaiting_validation"];
const availableColors = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-orange-500",
  "bg-green-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

export function SettingsDialog({
  open,
  onOpenChange,
  statusConfig,
  tags,
  checklistStatusConfig,
  onUpdateStatusLabel,
  onUpdateChecklistStatusLabel,
  onAddTag,
  onUpdateTag,
  onDeleteTag,
}: SettingsDialogProps) {
  const [editingStatus, setEditingStatus] = useState<PostStatus | null>(null);
  const [editingChecklistStatus, setEditingChecklistStatus] = useState<ChecklistItemStatus | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagColor, setNewTagColor] = useState("bg-blue-500");
  const [tempStatusLabel, setTempStatusLabel] = useState("");
  const [tempChecklistStatusLabel, setTempChecklistStatusLabel] = useState("");
  const [tempTagLabel, setTempTagLabel] = useState("");

  const handleStartEditStatus = (status: PostStatus) => {
    setEditingStatus(status);
    setTempStatusLabel(statusConfig[status].label);
  };

  const handleSaveStatus = () => {
    if (editingStatus && tempStatusLabel.trim()) {
      onUpdateStatusLabel(editingStatus, tempStatusLabel.trim());
    }
    setEditingStatus(null);
    setTempStatusLabel("");
  };

  const handleStartEditChecklistStatus = (status: ChecklistItemStatus) => {
    setEditingChecklistStatus(status);
    setTempChecklistStatusLabel(checklistStatusConfig[status].label);
  };

  const handleSaveChecklistStatus = () => {
    if (editingChecklistStatus && tempChecklistStatusLabel.trim()) {
      onUpdateChecklistStatusLabel(editingChecklistStatus, tempChecklistStatusLabel.trim());
    }
    setEditingChecklistStatus(null);
    setTempChecklistStatusLabel("");
  };

  const handleStartEditTag = (tag: PostTag) => {
    setEditingTag(tag.id);
    setTempTagLabel(tag.label);
  };

  const handleSaveTag = (id: string) => {
    if (tempTagLabel.trim()) {
      onUpdateTag(id, { label: tempTagLabel.trim() });
    }
    setEditingTag(null);
    setTempTagLabel("");
  };

  const handleAddTag = () => {
    if (newTagLabel.trim()) {
      onAddTag(newTagLabel.trim(), newTagColor);
      setNewTagLabel("");
      setNewTagColor("bg-blue-500");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurações do Calendário</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="status" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="checklist">Checklist</TabsTrigger>
            <TabsTrigger value="tags">Etiquetas</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Edite os nomes dos status de atividades
            </p>
            <div className="space-y-2">
              {statusKeys.map(status => (
                <div
                  key={status}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50"
                >
                  <span className={cn("w-3 h-3 rounded-full", 
                    status === "draft" && "bg-muted-foreground",
                    status === "scheduled" && "bg-blue-500",
                    status === "published" && "bg-green-500",
                    status === "failed" && "bg-red-500"
                  )} />
                  {editingStatus === status ? (
                    <>
                      <Input
                        value={tempStatusLabel}
                        onChange={(e) => setTempStatusLabel(e.target.value)}
                        className="flex-1 h-8"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleSaveStatus()}
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveStatus}>
                        <Check className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{statusConfig[status].label}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleStartEditStatus(status)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="checklist" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Edite os nomes dos status de checklist
            </p>
            <div className="space-y-2">
              {checklistStatusKeys.map(status => {
                const config = checklistStatusConfig[status];
                return (
                  <div
                    key={status}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border/50"
                  >
                    <span className={cn("w-3 h-3 rounded-full", config?.color)} />
                    {editingChecklistStatus === status ? (
                      <>
                        <Input
                          value={tempChecklistStatusLabel}
                          onChange={(e) => setTempChecklistStatusLabel(e.target.value)}
                          className="flex-1 h-8"
                          autoFocus
                          onKeyDown={(e) => e.key === "Enter" && handleSaveChecklistStatus()}
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveChecklistStatus}>
                          <Check className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm">{config?.label}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleStartEditChecklistStatus(status)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="tags" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Gerencie as etiquetas disponíveis
            </p>
            
            {/* Existing Tags */}
            <div className="space-y-2">
              {tags.map(tag => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/50"
                >
                  {editingTag === tag.id ? (
                    <>
                      <div className="flex gap-1">
                        {availableColors.map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => onUpdateTag(tag.id, { color })}
                            className={cn(
                              "w-5 h-5 rounded-full transition-all",
                              color,
                              tag.color === color && "ring-2 ring-offset-2 ring-primary"
                            )}
                          />
                        ))}
                      </div>
                      <Input
                        value={tempTagLabel}
                        onChange={(e) => setTempTagLabel(e.target.value)}
                        className="flex-1 h-8"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && handleSaveTag(tag.id)}
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleSaveTag(tag.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className={cn("w-4 h-4 rounded-full", tag.color)} />
                      <span className="flex-1 text-sm">{tag.label}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleStartEditTag(tag)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => onDeleteTag(tag.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Add New Tag */}
            <div className="pt-4 border-t border-border/50">
              <Label className="text-sm mb-2 block">Nova Etiqueta</Label>
              <div className="flex gap-2 mb-2">
                {availableColors.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewTagColor(color)}
                    className={cn(
                      "w-6 h-6 rounded-full transition-all",
                      color,
                      newTagColor === color && "ring-2 ring-offset-2 ring-primary"
                    )}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTagLabel}
                  onChange={(e) => setNewTagLabel(e.target.value)}
                  placeholder="Nome da etiqueta"
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                />
                <Button onClick={handleAddTag} disabled={!newTagLabel.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
