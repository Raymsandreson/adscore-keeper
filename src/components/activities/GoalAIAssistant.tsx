import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ProcessGoalEntry } from './ActivityProcessGoalsConfig';
import { PROCESS_METRIC_OPTIONS } from '@/hooks/useRoutineProcessGoals';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface GoalSuggestion {
  metric_key: string;
  target_value: number;
  board_id?: string | null;
  reasoning: string;
}

interface Inconsistency {
  issue: string;
  severity: 'warning' | 'error';
}

interface Props {
  userId: string;
  currentGoals: ProcessGoalEntry[];
  onApplySuggestions: (goals: ProcessGoalEntry[]) => void;
}

export function GoalAIAssistant({ userId, currentGoals, onApplySuggestions }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    analysis: string;
    inconsistencies: Inconsistency[];
    suggested_goals: GoalSuggestion[];
  } | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-goals', {
        body: { user_id: userId, current_goals: currentGoals },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data);
      setShowResult(true);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao analisar metas com IA');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!result) return;
    const newGoals: ProcessGoalEntry[] = result.suggested_goals.map(sg => ({
      metric_key: sg.metric_key,
      target_value: sg.target_value,
      board_id: sg.board_id || null,
    }));
    onApplySuggestions(newGoals);
    setShowResult(false);
    toast.success('✨ Metas aplicadas com sucesso!');
  };

  const getMetricLabel = (key: string) => {
    return PROCESS_METRIC_OPTIONS.find(m => m.value === key)?.label || key;
  };

  if (showResult && result) {
    return (
      <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-primary">Análise de Metas IA</span>
          </div>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowResult(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Analysis */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">{result.analysis}</p>

        {/* Inconsistencies */}
        {result.inconsistencies.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Inconsistências</p>
            {result.inconsistencies.map((inc, i) => (
              <div key={i} className={`flex items-start gap-1.5 text-[11px] rounded px-2 py-1 ${
                inc.severity === 'error' 
                  ? 'bg-destructive/10 text-destructive' 
                  : 'bg-amber-500/10 text-amber-700'
              }`}>
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{inc.issue}</span>
              </div>
            ))}
          </div>
        )}

        {/* Suggested goals */}
        {result.suggested_goals.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">💡 Metas Sugeridas</p>
            {result.suggested_goals.map((sg, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] bg-background/80 rounded px-2 py-1.5 border border-border/50">
                <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{getMetricLabel(sg.metric_key)}: </span>
                  <span className="text-primary font-bold">{sg.target_value}</span>
                  <p className="text-muted-foreground text-[10px] mt-0.5">{sg.reasoning}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="h-7 text-xs gap-1 flex-1" onClick={handleApply}>
            <CheckCircle2 className="h-3 w-3" />
            Aplicar Sugestões
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowResult(false)}>
            Ignorar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-[10px] gap-1 text-primary hover:text-primary/80"
      onClick={handleAnalyze}
      disabled={loading}
    >
      {loading ? (
        <><Loader2 className="h-3 w-3 animate-spin" />Analisando...</>
      ) : (
        <><Sparkles className="h-3 w-3" />Sugerir metas com IA</>
      )}
    </Button>
  );
}
