import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ListChecks, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
}

interface ChecklistInstance {
  lead_id: string;
  checklist_template_id: string;
  items: ChecklistItem[];
  is_readonly: boolean;
}

interface TemplateInfo {
  id: string;
  name: string;
  items: { id: string; label: string }[];
}

// Filter: which items must be checked
export interface ChecklistFilterRule {
  templateId: string;
  itemId: string;
}

interface ChecklistFilterProps {
  boardId: string | null;
  leadIds: string[];
  onFilteredLeadIds: (ids: Set<string> | null) => void; // null = no filter active
}

export function ChecklistFilter({ boardId, leadIds, onFilteredLeadIds }: ChecklistFilterProps) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [instances, setInstances] = useState<ChecklistInstance[]>([]);
  const [rules, setRules] = useState<ChecklistFilterRule[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load templates linked to this board and all instances
  useEffect(() => {
    if (!boardId || leadIds.length === 0) {
      setTemplates([]);
      setInstances([]);
      setLoaded(true);
      return;
    }

    const load = async () => {
      // Get stage links for this board
      const { data: links } = await supabase
        .from('checklist_stage_links')
        .select('checklist_template_id')
        .eq('board_id', boardId);

      const templateIds = [...new Set((links || []).map(l => l.checklist_template_id))];
      if (templateIds.length === 0) {
        setTemplates([]);
        setInstances([]);
        setLoaded(true);
        return;
      }

      // Get template details
      const { data: templateData } = await supabase
        .from('checklist_templates')
        .select('id, name, items')
        .in('id', templateIds)
        .order('name');

      setTemplates((templateData || []).map(t => ({
        id: t.id,
        name: t.name,
        items: ((t.items as unknown as { id: string; label: string }[]) || []),
      })));

      // Get all instances for these leads on this board (active ones only)
      const { data: instanceData } = await supabase
        .from('lead_checklist_instances')
        .select('lead_id, checklist_template_id, items, is_readonly')
        .eq('board_id', boardId)
        .eq('is_readonly', false)
        .in('lead_id', leadIds.slice(0, 500));

      setInstances((instanceData || []).map(i => ({
        ...i,
        items: (i.items as unknown as ChecklistItem[]) || [],
      })));

      setLoaded(true);
    };

    load();
  }, [boardId, leadIds.join(',')]);

  // Stable lead IDs string for dependency
  const leadIdsKey = leadIds.join(',');

  // Apply filter whenever rules or instances change
  useEffect(() => {
    if (rules.length === 0) {
      onFilteredLeadIds(null);
      return;
    }

    const matchingLeadIds = new Set<string>();

    // For each lead, check if all rules match
    leadIds.forEach(leadId => {
      const leadInstances = instances.filter(i => i.lead_id === leadId);
      
      const allRulesMatch = rules.every(rule => {
        const instance = leadInstances.find(i => i.checklist_template_id === rule.templateId);
        if (!instance) {
          // No instance = item unchecked → doesn't match
          return false;
        }
        const item = instance.items.find(i => i.id === rule.itemId);
        return item?.checked === true;
      });

      if (allRulesMatch) {
        matchingLeadIds.add(leadId);
      }
    });

    onFilteredLeadIds(matchingLeadIds);
  }, [rules, instances, leadIdsKey]);

  const toggleRule = (templateId: string, itemId: string) => {
    setRules(prev => {
      const existing = prev.find(r => r.templateId === templateId && r.itemId === itemId);
      if (!existing) {
        // Add rule: must be checked
        return [...prev, { templateId, itemId }];
      }
      // Remove rule
      return prev.filter(r => !(r.templateId === templateId && r.itemId === itemId));
    });
  };

  const isActive = (templateId: string, itemId: string): boolean => {
    return rules.some(r => r.templateId === templateId && r.itemId === itemId);
  };

  const clearAll = () => {
    setRules([]);
  };

  if (!loaded || templates.length === 0) return null;

  const activeCount = rules.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ListChecks className="h-4 w-4" />
          Filtrar Checklist
          {activeCount > 0 && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Filtrar por Checklist</span>
          </div>
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAll}>
              <X className="h-3 w-3 mr-1" />
              Limpar
            </Button>
          )}
        </div>
        <p className="px-3 pt-2 text-[10px] text-muted-foreground">
          Clique para filtrar leads com o item ✅ preenchido
        </p>
        <div className="p-2 max-h-[300px] overflow-y-auto space-y-3">
          {templates.map(template => (
            <div key={template.id} className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground px-1">
                {template.name}
              </p>
              {template.items.map(item => {
                const active = isActive(template.id, item.id);
                return (
                  <button
                    key={item.id}
                    className={cn(
                      "flex items-center gap-2 w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors",
                      active && "bg-muted/30"
                    )}
                    onClick={() => toggleRule(template.id, item.id)}
                  >
                    <span className={cn(
                      "flex items-center justify-center w-4 h-4 rounded border text-[10px] font-bold flex-shrink-0",
                      active ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground/30"
                    )}>
                      {active ? '✓' : ''}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
