import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Loader2, Plus, RotateCcw, Lightbulb, Check } from 'lucide-react';
import { toast } from 'sonner';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/functionRouter';
import { stripHtmlToText } from './ActivityCallRecorder';

export interface NextStepsContext {
  step?: {
    step_label?: string;
    phase_label?: string;
    objective_label?: string;
    next_step?: string;
    checklist?: { label?: string; checked?: boolean }[];
  };
  activity?: {
    title?: string;
    type?: string;
    lead_name?: string;
    process_title?: string;
    current_status?: string;
    what_was_done?: string;
    next_steps?: string;
    notes?: string;
  };
}

interface Suggestion { title: string; detail: string; }

interface Props {
  context: NextStepsContext;
  /** Aplica a sugestão escolhida (texto puro) no campo "Próximo passo". */
  onApply: (text: string) => void;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
  activityId?: string | null;
}

export function ActivityNextStepsAgent({ context, onApply, leadId, caseId, processId, activityId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Contexto extra: histórico recente do processo (ajuda a sugerir o que falta).
      let previous_activities: any[] = [];
      try {
        if (processId || caseId || leadId) {
          let q = externalSupabase
            .from('lead_activities')
            .select('id, title, status, next_steps, created_at')
            .order('created_at', { ascending: false })
            .limit(6);
          if (processId) q = q.eq('process_id', processId);
          else if (caseId) q = q.eq('case_id', caseId);
          else q = q.eq('lead_id', leadId as string);
          if (activityId) q = q.neq('id', activityId);
          const { data } = await q;
          previous_activities = (data || []).map((a: any) => ({
            title: a.title,
            status: a.status,
            next_steps: stripHtmlToText(a.next_steps || ''),
            date: a.created_at ? String(a.created_at).slice(0, 10) : undefined,
          }));
        }
      } catch { /* contexto extra é opcional */ }

      const { data, error: fnErr } = await cloudFunctions.invoke('suggest-step-actions', {
        body: { step_context: context.step, activity: context.activity, previous_activities },
      });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao gerar sugestões');

      setSuggestions(data.suggestions || []);
      setApplied(new Set());
      if (!(data.suggestions || []).length) toast.info('Nenhuma sugestão gerada.');
    } catch (e: any) {
      console.error('[ActivityNextStepsAgent] error:', e);
      setError(e?.message || 'Erro ao gerar sugestões');
    } finally {
      setLoading(false);
    }
  }, [context, leadId, caseId, processId, activityId]);

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && suggestions.length === 0 && !loading) generate();
  };

  const apply = (s: Suggestion, idx: number) => {
    onApply(s.title);
    setApplied((prev) => new Set(prev).add(idx));
    toast.success('Adicionado ao "Próximo passo".');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-violet-700 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-900/20"
          title="Sugerir próximos passos com base no fluxo de trabalho"
        >
          <Sparkles className="h-3 w-3" /> Próximos passos
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-semibold">Próximos passos sugeridos</span>
        </div>

        {context.step?.step_label ? (
          <p className="text-[11px] text-muted-foreground">
            Passo atual: <span className="font-medium text-foreground">{context.step.step_label}</span>
            {context.step.objective_label ? ` · objetivo: ${context.step.objective_label}` : ''}
          </p>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Esta atividade não está vinculada a um passo de fluxo de trabalho — as sugestões usarão só o conteúdo da atividade.
          </p>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Gerando sugestões…
          </div>
        )}

        {!loading && error && <p className="text-xs text-destructive">{error}</p>}

        {!loading && !error && suggestions.length > 0 && (
          <ScrollArea className="max-h-72">
            <div className="space-y-1.5 pr-1">
              {suggestions.map((s, i) => (
                <div key={i} className="rounded-md border p-2 bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{s.title}</p>
                      {s.detail && <p className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</p>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => apply(s, i)}
                      disabled={applied.has(i)}
                      title='Adicionar ao "Próximo passo"'
                    >
                      {applied.has(i) ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Plus className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {!loading && (
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={generate}>
            <RotateCcw className="h-4 w-4" /> {suggestions.length ? 'Gerar novamente' : 'Gerar sugestões'}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
