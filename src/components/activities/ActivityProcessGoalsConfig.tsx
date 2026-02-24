import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Target, ChevronDown, ChevronUp, Calculator } from 'lucide-react';
import { GOAL_CATEGORIES, PROCESS_METRIC_OPTIONS, type GoalCategory, type MetricOption } from '@/hooks/useRoutineProcessGoals';
import { cn } from '@/lib/utils';

export interface ProcessGoalEntry {
  metric_key: string;
  target_value: number;
  board_id: string | null;
  stage_id?: string | null;
  checklist_template_id?: string | null;
}

interface Board {
  id: string;
  name: string;
  stages?: { id: string; name: string }[];
}

interface ChecklistTemplate {
  id: string;
  name: string;
  items: { id: string; label: string }[];
}

interface ChecklistStageLink {
  checklist_template_id: string;
  board_id: string;
  stage_id: string;
}

interface Props {
  activityType: string;
  goals: ProcessGoalEntry[];
  boards: Board[];
  onChange: (goals: ProcessGoalEntry[]) => void;
  checklistTemplates?: ChecklistTemplate[];
  checklistStageLinks?: ChecklistStageLink[];
}

export function ActivityProcessGoalsConfig({ activityType, goals, boards, onChange, checklistTemplates = [], checklistStageLinks = [] }: Props) {
  const [expanded, setExpanded] = useState(goals.length > 0);

  const usedMetrics = new Set(goals.map(g => {
    if (g.metric_key === 'stages') return `stages_${g.board_id}_${g.stage_id}`;
    if (g.metric_key === 'objectives') return `objectives_${g.board_id}_${g.checklist_template_id}`;
    return g.metric_key;
  }));

  // Get objectives linked to a specific board
  const getObjectivesForBoard = (boardId: string | null) => {
    if (!boardId) return [];
    const linkedTemplateIds = new Set(
      checklistStageLinks.filter(l => l.board_id === boardId).map(l => l.checklist_template_id)
    );
    return checklistTemplates.filter(t => linkedTemplateIds.has(t.id));
  };

  // Auto-calculate steps total from objectives goals
  const autoStepsTotal = useMemo(() => {
    const objectiveGoals = goals.filter(g => g.metric_key === 'objectives');
    let total = 0;
    for (const og of objectiveGoals) {
      const template = checklistTemplates.find(t => t.id === og.checklist_template_id);
      if (template) {
        total += (template.items?.length || 0) * og.target_value;
      }
    }
    return total;
  }, [goals, checklistTemplates]);

  const getGoalsForCategory = (category: GoalCategory) => {
    const categoryMetricKeys = GOAL_CATEGORIES.find(c => c.key === category)?.metrics.map(m => m.value) || [];
    return goals
      .map((g, idx) => ({ ...g, originalIdx: idx }))
      .filter(g => categoryMetricKeys.includes(g.metric_key));
  };

  const addGoal = (category: GoalCategory) => {
    if (category === 'progress') {
      // Default to adding a stage goal
      onChange([...goals, { metric_key: 'stages', target_value: 0, board_id: null, stage_id: null }]);
      setExpanded(true);
      return;
    }
    const categoryMetrics = GOAL_CATEGORIES.find(c => c.key === category)?.metrics || [];
    const available = categoryMetrics.find(m => !usedMetrics.has(m.value));
    if (!available) return;
    onChange([...goals, { metric_key: available.value, target_value: 0, board_id: null }]);
    setExpanded(true);
  };

  const addProgressGoal = (type: 'stages' | 'objectives') => {
    onChange([...goals, { 
      metric_key: type, 
      target_value: 0, 
      board_id: null, 
      stage_id: type === 'stages' ? null : undefined,
      checklist_template_id: type === 'objectives' ? null : undefined,
    }]);
    setExpanded(true);
  };

  const removeGoal = (idx: number) => {
    onChange(goals.filter((_, i) => i !== idx));
  };

  const updateGoal = (idx: number, patch: Partial<ProcessGoalEntry>) => {
    onChange(goals.map((g, i) => i === idx ? { ...g, ...patch } : g));
  };

  const getAvailableMetricsForCategory = (category: GoalCategory, currentMetricKey?: string) => {
    if (category === 'progress') return GOAL_CATEGORIES.find(c => c.key === 'progress')?.metrics || [];
    const categoryMetrics = GOAL_CATEGORIES.find(c => c.key === category)?.metrics || [];
    return categoryMetrics.filter(m => !usedMetrics.has(m.value) || m.value === currentMetricKey);
  };

  const totalGoals = goals.length;

  const renderProgressGoal = (goal: ProcessGoalEntry & { originalIdx: number }) => {
    const selectedBoard = boards.find(b => b.id === goal.board_id);

    if (goal.metric_key === 'stages') {
      return (
        <div key={goal.originalIdx} className="flex items-center gap-1.5 flex-wrap pl-3">
          <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">Etapa:</span>
          <Select
            value={goal.board_id || ''}
            onValueChange={v => updateGoal(goal.originalIdx, { board_id: v, stage_id: null })}
          >
            <SelectTrigger className="h-7 text-xs w-[120px]">
              <SelectValue placeholder="Funil" />
            </SelectTrigger>
            <SelectContent>
              {boards.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {goal.board_id && selectedBoard?.stages && (
            <Select
              value={goal.stage_id || ''}
              onValueChange={v => updateGoal(goal.originalIdx, { stage_id: v })}
            >
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue placeholder="Etapa" />
              </SelectTrigger>
              <SelectContent>
                {selectedBoard.stages.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Input
            type="number"
            min={0}
            value={goal.target_value || ''}
            onChange={e => updateGoal(goal.originalIdx, { target_value: parseInt(e.target.value) || 0 })}
            placeholder="Qtd"
            className="h-7 text-xs w-[60px]"
          />

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => removeGoal(goal.originalIdx)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    if (goal.metric_key === 'objectives') {
      const availableObjectives = getObjectivesForBoard(goal.board_id);
      const selectedTemplate = checklistTemplates.find(t => t.id === goal.checklist_template_id);

      return (
        <div key={goal.originalIdx} className="flex items-center gap-1.5 flex-wrap pl-3">
          <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">Objetivo:</span>
          <Select
            value={goal.board_id || ''}
            onValueChange={v => updateGoal(goal.originalIdx, { board_id: v, checklist_template_id: null })}
          >
            <SelectTrigger className="h-7 text-xs w-[120px]">
              <SelectValue placeholder="Funil" />
            </SelectTrigger>
            <SelectContent>
              {boards.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {goal.board_id && (
            <Select
              value={goal.checklist_template_id || ''}
              onValueChange={v => updateGoal(goal.originalIdx, { checklist_template_id: v })}
            >
              <SelectTrigger className="h-7 text-xs w-[140px]">
                <SelectValue placeholder="Objetivo" />
              </SelectTrigger>
              <SelectContent>
                {availableObjectives.map(obj => (
                  <SelectItem key={obj.id} value={obj.id}>
                    {obj.name} ({obj.items?.length || 0} passos)
                  </SelectItem>
                ))}
                {availableObjectives.length === 0 && (
                  <div className="text-[10px] text-muted-foreground p-2">
                    Nenhum checklist vinculado a este funil
                  </div>
                )}
              </SelectContent>
            </Select>
          )}

          <Input
            type="number"
            min={0}
            value={goal.target_value || ''}
            onChange={e => updateGoal(goal.originalIdx, { target_value: parseInt(e.target.value) || 0 })}
            placeholder="Leads"
            className="h-7 text-xs w-[60px]"
          />

          {selectedTemplate && goal.target_value > 0 && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Calculator className="h-2.5 w-2.5" />
              {(selectedTemplate.items?.length || 0) * goal.target_value} passos
            </span>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => removeGoal(goal.originalIdx)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="mt-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-2.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[11px] font-bold text-primary uppercase tracking-wide hover:text-primary/80 transition-colors w-full"
      >
        <Target className="h-3.5 w-3.5" />
        <span className="bg-primary/10 px-2 py-0.5 rounded-full">
          🎯 Metas ({totalGoals})
        </span>
        {totalGoals === 0 && (
          <span className="text-[10px] font-normal normal-case text-muted-foreground ml-1">
            — clique para definir
          </span>
        )}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {GOAL_CATEGORIES.map(cat => {
            const categoryGoals = getGoalsForCategory(cat.key);

            if (cat.key === 'progress') {
              const stageGoals = categoryGoals.filter(g => g.metric_key === 'stages');
              const objectiveGoals = categoryGoals.filter(g => g.metric_key === 'objectives');

              return (
                <div key={cat.key} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]">{cat.icon}</span>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {cat.label} ({categoryGoals.length})
                    </span>
                  </div>

                  {/* Stage goals */}
                  {stageGoals.length > 0 && (
                    <div className="space-y-1">
                      {stageGoals.map(goal => renderProgressGoal(goal))}
                    </div>
                  )}

                  {/* Objective goals */}
                  {objectiveGoals.length > 0 && (
                    <div className="space-y-1">
                      {objectiveGoals.map(goal => renderProgressGoal(goal))}
                    </div>
                  )}

                  {/* Auto-calculated steps summary */}
                  {autoStepsTotal > 0 && (
                    <div className="flex items-center gap-1.5 pl-3 py-1 bg-accent/50 rounded text-[10px] text-muted-foreground">
                      <Calculator className="h-3 w-3" />
                      <span className="font-medium">Meta de passos (auto):</span>
                      <span className="font-bold text-foreground">{autoStepsTotal} passos</span>
                      <span className="text-[9px]">
                        (soma de objetivos × passos de cada)
                      </span>
                    </div>
                  )}

                  {/* Add buttons for progress */}
                  <div className="flex gap-1 pl-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] gap-1 text-muted-foreground"
                      onClick={() => addProgressGoal('stages')}
                    >
                      <Plus className="h-3 w-3" />
                      + Etapa
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] gap-1 text-muted-foreground"
                      onClick={() => addProgressGoal('objectives')}
                    >
                      <Plus className="h-3 w-3" />
                      + Objetivo
                    </Button>
                  </div>
                </div>
              );
            }

            // Action & Result categories (unchanged logic)
            const availableMetrics = getAvailableMetricsForCategory(cat.key);
            const allCategoryMetrics = cat.metrics;
            const hasRoom = availableMetrics.length > categoryGoals.length || categoryGoals.length < allCategoryMetrics.length;

            return (
              <div key={cat.key} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]">{cat.icon}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {cat.label} ({categoryGoals.length})
                  </span>
                </div>

                {categoryGoals.map(goal => (
                  <div key={goal.originalIdx} className="flex items-center gap-1.5 flex-wrap pl-3">
                    <Select
                      value={goal.metric_key}
                      onValueChange={v => updateGoal(goal.originalIdx, { metric_key: v })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {cat.metrics.map(m => (
                          <SelectItem
                            key={m.value}
                            value={m.value}
                            disabled={usedMetrics.has(m.value) && goal.metric_key !== m.value}
                          >
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      type="number"
                      min={0}
                      value={goal.target_value || ''}
                      onChange={e => updateGoal(goal.originalIdx, { target_value: parseInt(e.target.value) || 0 })}
                      placeholder="Meta"
                      className="h-7 text-xs w-[70px]"
                    />

                    <Select
                      value={goal.board_id || 'all'}
                      onValueChange={v => updateGoal(goal.originalIdx, { board_id: v === 'all' ? null : v })}
                    >
                      <SelectTrigger className="h-7 text-xs w-[130px]">
                        <SelectValue placeholder="Funil" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os funis</SelectItem>
                        {boards.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeGoal(goal.originalIdx)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}

                {hasRoom && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-muted-foreground pl-3"
                    onClick={() => addGoal(cat.key)}
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar {cat.label.toLowerCase().replace('metas de ', '')}
                  </Button>
                )}
              </div>
            );
          })}

          {totalGoals === 0 && (
            <p className="text-[10px] text-muted-foreground italic">
              Nenhuma meta definida. Clique em "Adicionar" para vincular metas a este tipo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
