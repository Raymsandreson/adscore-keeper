import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/functionRouter';

/**
 * "Atualizar passos com IA" — concilia o POP com o que JÁ ACONTECEU no processo.
 *
 * Por que existe: processo que já está no TST com o POP parado na fase 2 obriga o
 * assessor a marcar 15 passos um a um, respondendo "foi hoje?" em cada um. Aqui a
 * IA lê as movimentações do tribunal + as atividades anteriores + o que a pessoa
 * escreve ("já foi feito acordo") e devolve a lista de passos a marcar, cada um
 * com a evidência e a data. A pessoa confere, desmarca o que não vale e confirma
 * uma vez só.
 *
 * Ranking do telão: passo marcado por aqui entra como RETROATIVO (não conta),
 * exceto quando a evidência é do próprio dia — decisão do usuário (07/08/2026).
 * Sem isso, "atualizar o POP" de um processo antigo viraria pontuação do dia.
 */

export interface PopCatchUpStep {
  instanceId: string;
  itemId: string;
  label: string;
  description?: string;
  phase: string;
  objective: string;
  checked: boolean;
  /** Passo travado por sub-item em aberto ou por ser passo-pergunta: fica de fora. */
  blockedReason?: string;
}

export interface PopCatchUpMark {
  instanceId: string;
  itemId: string;
  label: string;
  retroactive: boolean;
  evidencia: string;
  dataEvidencia: string;
}

interface Suggestion {
  step_id: string;
  evidencia: string;
  data_evidencia: string;
  confianca: string;
}

interface PopCatchUpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  processId?: string | null;
  steps: PopCatchUpStep[];
  context: {
    leadName?: string;
    workflowName?: string;
    currentPhase?: string;
  };
  onApply: (marks: PopCatchUpMark[]) => Promise<void>;
}

const stepKey = (s: { instanceId: string; itemId: string }) => `${s.instanceId}::${s.itemId}`;

export function PopCatchUpSheet({
  open,
  onOpenChange,
  leadId,
  processId,
  steps,
  context,
  onApply,
}: PopCatchUpSheetProps) {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumo, setResumo] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analisou, setAnalisou] = useState(false);

  const hoje = new Date().toISOString().slice(0, 10);

  const stepByKey = useMemo(() => {
    const map = new Map<string, PopCatchUpStep>();
    for (const s of steps) map.set(stepKey(s), s);
    return map;
  }, [steps]);

  const pendentes = useMemo(() => steps.filter(s => !s.checked && !s.blockedReason), [steps]);
  const travados = useMemo(() => steps.filter(s => !s.checked && s.blockedReason), [steps]);

  useEffect(() => {
    if (!open) {
      setSuggestions([]);
      setSelected(new Set());
      setResumo('');
      setError(null);
      setAnalisou(false);
    }
  }, [open]);

  const analisar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Movimentações do tribunal: do processo vinculado, ou de todos os
      // processos do lead quando a barra abre fora de um processo específico.
      let movements: { data?: string; tipo?: string; conteudo?: string }[] = [];
      let processNumber = '';
      let processTitle = '';
      try {
        let q = externalSupabase
          .from('lead_processes')
          .select('id, process_number, title, movimentacoes')
          .is('deleted_at', null);
        q = processId ? q.eq('id', processId) : q.eq('lead_id', leadId);
        const { data } = await q.limit(5);
        const rows = (data || []) as Array<{ process_number?: string; title?: string; movimentacoes?: unknown }>;
        if (rows[0]) {
          processNumber = rows[0].process_number || '';
          processTitle = rows[0].title || '';
        }
        movements = rows
          .flatMap(r => (Array.isArray(r.movimentacoes) ? r.movimentacoes : []))
          .map((m: any) => ({
            data: typeof m?.data === 'string' ? m.data.slice(0, 10) : undefined,
            tipo: m?.tipo || m?.classificacao_predita?.nome || undefined,
            conteudo: String(m?.conteudo || m?.texto || '').slice(0, 400),
          }))
          .filter(m => m.conteudo)
          .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
          .slice(0, 60);
      } catch (e) {
        console.warn('[PopCatchUpSheet] movimentações indisponíveis:', e);
      }

      // Atividades anteriores do caso: o que a equipe já registrou por escrito.
      let previous_activities: { date?: string; title?: string; what_was_done?: string; current_status?: string }[] = [];
      try {
        let q = externalSupabase
          .from('lead_activities')
          .select('title, what_was_done, current_status, created_at')
          .order('created_at', { ascending: false })
          .limit(10);
        q = processId ? q.eq('process_id', processId) : q.eq('lead_id', leadId);
        const { data } = await q;
        previous_activities = ((data || []) as any[]).map(a => ({
          date: a.created_at ? String(a.created_at).slice(0, 10) : undefined,
          title: a.title || undefined,
          what_was_done: stripHtml(a.what_was_done),
          current_status: stripHtml(a.current_status),
        }));
      } catch (e) {
        console.warn('[PopCatchUpSheet] atividades anteriores indisponíveis:', e);
      }

      const { data, error: fnErr } = await cloudFunctions.invoke('suggest-step-completion', {
        body: {
          instruction: instruction.trim() || undefined,
          today: hoje,
          context: {
            lead_name: context.leadName,
            process_number: processNumber,
            process_title: processTitle,
            workflow_name: context.workflowName,
            current_phase: context.currentPhase,
          },
          steps: steps.map(s => ({
            id: stepKey(s),
            label: s.label,
            description: s.description,
            phase: s.phase,
            objective: s.objective,
            checked: s.checked || !!s.blockedReason, // travado não é candidato
          })),
          movements,
          previous_activities,
        },
      });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao analisar o processo');

      const sugs = (data.suggestions || []) as Suggestion[];
      setSuggestions(sugs);
      setResumo(data.resumo || '');
      setSelected(new Set(sugs.map(s => s.step_id)));
      setAnalisou(true);
      if (sugs.length === 0) {
        toast.info('Nenhum passo com evidência suficiente. Descreva o que aconteceu no campo acima.');
      }
    } catch (e: any) {
      console.error('[PopCatchUpSheet] error:', e);
      setError(e?.message || 'Erro ao analisar');
    } finally {
      setLoading(false);
    }
  }, [instruction, steps, leadId, processId, context, hoje]);

  const aplicar = async () => {
    const marks: PopCatchUpMark[] = [];
    for (const s of suggestions) {
      if (!selected.has(s.step_id)) continue;
      const step = stepByKey.get(s.step_id);
      if (!step || step.checked) continue;
      marks.push({
        instanceId: step.instanceId,
        itemId: step.itemId,
        label: step.label,
        // Regra do ranking: só conta como trabalho do dia se a evidência for de hoje.
        retroactive: s.data_evidencia !== hoje,
        evidencia: s.evidencia,
        dataEvidencia: s.data_evidencia,
      });
    }
    if (marks.length === 0) {
      toast.info('Nenhum passo selecionado.');
      return;
    }
    setApplying(true);
    try {
      await onApply(marks);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selecionados = suggestions.filter(s => selected.has(s.step_id)).length;
  const doDia = suggestions.filter(s => selected.has(s.step_id) && s.data_evidencia === hoje).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Atualizar passos do POP
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            A IA lê as movimentações do processo e o que você escrever, e diz quais passos
            já podem ser marcados. Você confere antes de gravar.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              O que já aconteceu (opcional)
            </label>
            <Textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder='Ex.: "já foi feito acordo na audiência de 12/06, aguardando homologação"'
              className="text-sm min-h-[70px]"
            />
            <p className="text-[10px] text-muted-foreground">
              {pendentes.length} passo(s) em aberto neste POP
              {travados.length > 0 && ` · ${travados.length} fora da análise (checklist em aberto ou passo-pergunta)`}
            </p>
          </div>

          <Button
            type="button"
            onClick={analisar}
            disabled={loading || pendentes.length === 0}
            className="w-full h-9 text-sm"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {analisou ? 'Analisar de novo' : 'Analisar processo'}
          </Button>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {resumo && (
            <div className="rounded-md bg-muted/50 border p-2.5 text-xs leading-relaxed">
              {resumo}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Passos sugeridos ({suggestions.length})
                </span>
                <button
                  type="button"
                  className="text-[11px] text-primary hover:underline"
                  onClick={() => setSelected(prev =>
                    prev.size === suggestions.length ? new Set() : new Set(suggestions.map(s => s.step_id))
                  )}
                >
                  {selected.size === suggestions.length ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              </div>

              {suggestions.map(s => {
                const step = stepByKey.get(s.step_id);
                if (!step) return null;
                const isHoje = s.data_evidencia === hoje;
                return (
                  <div
                    key={s.step_id}
                    className={cn(
                      'rounded-md border p-2.5 transition-colors',
                      selected.has(s.step_id) ? 'border-primary/40 bg-primary/5' : 'border-border/60'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={selected.has(s.step_id)}
                        onCheckedChange={() => toggle(s.step_id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{step.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {step.phase} · {step.objective}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                          {s.evidencia}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {s.data_evidencia ? formatBR(s.data_evidencia) : 'sem data'}
                          </span>
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded',
                            s.confianca === 'alta' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                            s.confianca === 'media' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                            s.confianca === 'baixa' && 'bg-muted text-muted-foreground',
                          )}>
                            confiança {s.confianca}
                          </span>
                          {!isHoje && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              retroativo · não conta no telão
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {selecionados > 0
              ? `${selecionados} passo(s) · ${doDia} de hoje`
              : 'Nenhum passo selecionado'}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={aplicar} disabled={applying || selecionados === 0}>
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Marcar {selecionados > 0 ? selecionados : ''} passo(s)
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function stripHtml(v?: string | null): string | undefined {
  if (!v) return undefined;
  const txt = String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return txt ? txt.slice(0, 300) : undefined;
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
