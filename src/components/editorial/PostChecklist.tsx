import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Check, Clock, AlertCircle, Edit, Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChecklistItem, ChecklistItemStatus, ChecklistStatusConfig } from "@/types/editorial";

interface PostChecklistProps {
  checklist: ChecklistItem[];
  onChange: (checklist: ChecklistItem[]) => void;
  checklistStatusConfig: Record<ChecklistItemStatus, ChecklistStatusConfig>;
  readOnly?: boolean;
}

const statusIcons: Record<ChecklistItemStatus, React.ReactNode> = {
  completed: <Check className="h-3 w-3" />,
  pending: <Clock className="h-3 w-3" />,
  delayed: <AlertCircle className="h-3 w-3" />,
  edited: <Edit className="h-3 w-3" />,
  awaiting_validation: <Loader className="h-3 w-3" />,
};

export function PostChecklist({ checklist, onChange, checklistStatusConfig, readOnly = false }: PostChecklistProps) {
  const [newItemLabel, setNewItemLabel] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<ChecklistItemStatus>("pending");

  const handleAddItem = (status?: ChecklistItemStatus) => {
    if (!newItemLabel.trim()) return;
    const newItem: ChecklistItem = {
      id: String(Date.now()),
      label: newItemLabel.trim(),
      status: status || selectedStatus,
    };
    onChange([...checklist, newItem]);
    setNewItemLabel("");
    setSelectedStatus("pending"); // Reset to default
  };

  const handleRemoveItem = (id: string) => {
    onChange(checklist.filter(item => item.id !== id));
  };

  const handleStatusChange = (id: string, status: ChecklistItemStatus) => {
    onChange(checklist.map(item => 
      item.id === id 
        ? { 
            ...item, 
            status, 
            completed_at: status === "completed" ? new Date() : undefined 
          } 
        : item
    ));
  };

  const handleToggleComplete = (id: string, checked: boolean) => {
    handleStatusChange(id, checked ? "completed" : "pending");
  };

  const completedCount = checklist.filter(item => item.status === "completed").length;
  const progress = checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Progress Bar */}
      {checklist.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-medium">{completedCount}/{checklist.length}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Checklist Items */}
      <div className="space-y-2">
        {checklist.map(item => {
          const config = checklistStatusConfig[item.status];
          return (
            <div 
              key={item.id} 
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg border transition-colors",
                item.status === "completed" && "bg-muted/50 opacity-75"
              )}
            >
              <Checkbox
                checked={item.status === "completed"}
                onCheckedChange={(checked) => handleToggleComplete(item.id, !!checked)}
                disabled={readOnly}
              />
              
              <span className={cn(
                "flex-1 text-sm",
                item.status === "completed" && "line-through text-muted-foreground"
              )}>
                {item.label}
              </span>

              {!readOnly && (
                <Select
                  value={item.status}
                  onValueChange={(value) => handleStatusChange(item.id, value as ChecklistItemStatus)}
                >
                  <SelectTrigger className="w-auto h-7 gap-1 text-xs border-0 bg-transparent">
                    <Badge 
                      variant="outline" 
                      className={cn("gap-1", config?.color, "text-white border-0")}
                    >
                      {statusIcons[item.status]}
                      {config?.label}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(checklistStatusConfig).map(([status, cfg]) => (
                      <SelectItem key={status} value={status}>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant="outline" 
                            className={cn("gap-1", cfg.color, "text-white border-0")}
                          >
                            {statusIcons[status as ChecklistItemStatus]}
                            {cfg.label}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveItem(item.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add New Item */}
      {!readOnly && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nova atividade..."
              value={newItemLabel}
              onChange={(e) => setNewItemLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
              className="flex-1"
            />
            <Button 
              onClick={() => handleAddItem()}
              size="sm"
              disabled={!newItemLabel.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Clickable status badges to add with specific status */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground self-center">Adicionar como:</span>
            {Object.entries(checklistStatusConfig).map(([status, config]) => (
              <Badge 
                key={status}
                variant="outline" 
                className={cn(
                  "gap-1 text-xs cursor-pointer transition-all hover:scale-105 hover:ring-2 hover:ring-primary/50", 
                  config.color, 
                  "text-white border-0",
                  selectedStatus === status && "ring-2 ring-primary ring-offset-1",
                  !newItemLabel.trim() && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => {
                  if (newItemLabel.trim()) {
                    handleAddItem(status as ChecklistItemStatus);
                  } else {
                    setSelectedStatus(status as ChecklistItemStatus);
                  }
                }}
              >
                {statusIcons[status as ChecklistItemStatus]}
                {config.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Status Legend */}
      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <span className="text-xs text-muted-foreground self-center">Legenda:</span>
        {Object.entries(checklistStatusConfig).map(([status, config]) => (
          <Badge 
            key={status}
            variant="outline" 
            className={cn("gap-1 text-xs", config.color, "text-white border-0")}
          >
            {statusIcons[status as ChecklistItemStatus]}
            {config.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}
