import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X, ListChecks } from 'lucide-react';
import { useChecklists, ChecklistStageLink, ChecklistTemplate } from '@/hooks/useChecklists';
import { KanbanStage } from '@/hooks/useKanbanBoards';

interface ChecklistStageLinkingProps {
  boardId: string;
  stages: KanbanStage[];
}

export function ChecklistStageLinking({ boardId, stages }: ChecklistStageLinkingProps) {
  const {
    templates,
    fetchTemplates,
    fetchStageLinks,
    linkChecklistToStage,
    unlinkChecklistFromStage,
  } = useChecklists();

  const [links, setLinks] = useState<ChecklistStageLink[]>([]);
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTemplates();
    loadLinks();
  }, [boardId]);

  const loadLinks = async () => {
    setLoading(true);
    const data = await fetchStageLinks(boardId);
    setLinks(data);
    setLoading(false);
  };

  const handleLink = async () => {
    if (!selectedStage || !selectedTemplate) return;
    await linkChecklistToStage(selectedTemplate, boardId, selectedStage);
    await loadLinks();
    setSelectedTemplate('');
  };

  const handleUnlink = async (linkId: string) => {
    await unlinkChecklistFromStage(linkId);
    await loadLinks();
  };

  const getStageName = (stageId: string) => {
    return stages.find(s => s.id === stageId)?.name || stageId;
  };

  const getStageColor = (stageId: string) => {
    return stages.find(s => s.id === stageId)?.color || '#3b82f6';
  };

  const getTemplateName = (templateId: string) => {
    return templates.find(t => t.id === templateId)?.name || 'Checklist';
  };

  const getTemplate = (templateId: string) => {
    return templates.find(t => t.id === templateId);
  };

  // Group links by stage
  const linksByStage = links.reduce<Record<string, ChecklistStageLink[]>>((acc, link) => {
    if (!acc[link.stage_id]) acc[link.stage_id] = [];
    acc[link.stage_id].push(link);
    return acc;
  }, {});

  return (
    <div>
      <Label className="flex items-center gap-2">
        <ListChecks className="h-4 w-4" />
        Checklists por Etapa
      </Label>
      <p className="text-xs text-muted-foreground mb-2">
        Vincule checklists às etapas do funil
      </p>

      {links.length > 0 && (
        <ScrollArea className="max-h-[120px] border rounded-md p-2 mb-2">
          {Object.entries(linksByStage).map(([stageId, stageLinks]) => (
            <div key={stageId} className="mb-2 last:mb-0">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getStageColor(stageId) }} />
                <span className="text-xs font-medium">{getStageName(stageId)}</span>
              </div>
              {stageLinks.map(link => {
                const tmpl = getTemplate(link.checklist_template_id);
                return (
                  <div key={link.id} className="flex items-center justify-between pl-4 py-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">{getTemplateName(link.checklist_template_id)}</span>
                      {tmpl?.is_mandatory && (
                        <Badge variant="destructive" className="text-[9px] h-3 px-1">Obrig.</Badge>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleUnlink(link.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ))}
        </ScrollArea>
      )}

      <div className="flex gap-2">
        <Select value={selectedStage} onValueChange={setSelectedStage}>
          <SelectTrigger className="flex-1 h-8 text-xs">
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            {stages.map(s => (
              <SelectItem key={s.id} value={s.id}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
          <SelectTrigger className="flex-1 h-8 text-xs">
            <SelectValue placeholder="Checklist" />
          </SelectTrigger>
          <SelectContent>
            {templates.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" className="h-8" onClick={handleLink} disabled={!selectedStage || !selectedTemplate}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
