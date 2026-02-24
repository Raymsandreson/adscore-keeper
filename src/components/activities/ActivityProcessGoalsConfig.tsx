import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Target, ChevronDown, ChevronUp } from 'lucide-react';
import { GOAL_CATEGORIES, PROCESS_METRIC_OPTIONS, type GoalCategory, type MetricOption } from '@/hooks/useRoutineProcessGoals';
import { cn } from '@/lib/utils';

export interface ProcessGoalEntry {
  metric_key: string;
  target_value: number;
  board_id: string | null;
}

interface Board {
  id: string;
  name: string;
}

interface Props {
  activityType: string;
  goals: ProcessGoalEntry[];
  boards: Board[];
  onChange: (goals: ProcessGoalEntry[]) => void;
}

export function ActivityProcessGoalsConfig({ activityType, goals, boards, onChange }: Props) {
  const [expanded, setExpanded] = useState(goals.length > 0);

  const usedMetrics = new Set(goals.map(g => g.metric_key));

  const getGoalsForCategory = (category: GoalCategory) => {
    const categoryMetricKeys = GOAL_CATEGORIES.find(c => c.key === category)?.metrics.map(m => m.value) || [];
    return goals
      .map((g, idx) => ({ ...g, originalIdx: idx }))
      .filter(g => categoryMetricKeys.includes(g.metric_key));
  };

  const addGoal = (category: GoalCategory) => {
    const categoryMetrics = GOAL_CATEGORIES.find(c => c.key === category)?.metrics || [];
    const available = categoryMetrics.find(m => !usedMetrics.has(m.value));
    if (!available) return;
    onChange([...goals, { metric_key: available.value, target_value: 0, board_id: null }]);
    setExpanded(true);
  };

  const removeGoal = (idx: number) => {
    onChange(goals.filter((_, i) => i !== idx));
  };

  const updateGoal = (idx: number, patch: Partial<ProcessGoalEntry>) => {
    onChange(goals.map((g, i) => i === idx ? { ...g, ...patch } : g));
  };

  const getAvailableMetricsForCategory = (category: GoalCategory, currentMetricKey?: string) => {
    const categoryMetrics = GOAL_CATEGORIES.find(c => c.key === category)?.metrics || [];
    return categoryMetrics.filter(m => !usedMetrics.has(m.value) || m.value === currentMetricKey);
  };

  const totalGoals = goals.length;

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
