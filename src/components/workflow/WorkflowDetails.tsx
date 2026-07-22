import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ClipboardList,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  Flag,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { CHECKLIST_TYPES } from '@/hooks/useChecklists';
import { resolveTarget, type WorkflowGraph } from '@/hooks/useWorkflowGraph';

/**
 * Aba "Detalhes": desdobra fase → objetivo → passo mostrando, por passo, o que
 * não cabe no mapa: checklist de documentos/requisitos, tipo de atividade,
 * roteamento ("mover para" / "finalizar") e respostas configuradas.
 */

interface Props {
  graph: WorkflowGraph;
}

const checklistMeta = (type?: string) =>
  CHECKLIST_TYPES.find(t => t.value === type) || CHECKLIST_TYPES[CHECKLIST_TYPES.length - 1];

export function WorkflowDetails({ graph }: Props) {
  const { types: activityTypes } = useActivityTypes();
  const activityByKey = useMemo(
    () => new Map(activityTypes.map(t => [t.key, t])),
    [activityTypes]
  );

  if (graph.stages.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-16">
        Este fluxo ainda não tem fases configuradas.
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {graph.stages.map((stage, si) => (
        <div key={stage.id} className="rounded-lg border overflow-hidden">
          {/* Cabeçalho da fase */}
          <div
            className="flex items-center gap-2 px-4 py-2.5 border-l-4"
            style={{ borderLeftColor: stage.color, backgroundColor: `${stage.color}12` }}
          >
            <span
              className="flex-shrink-0 h-6 w-6 rounded-full text-[11px] font-bold flex items-center justify-center text-white"
              style={{ backgroundColor: stage.color }}
            >
              {si + 1}
            </span>
            <span className="font-semibold text-sm">{stage.name}</span>
            <span className="text-[11px] text-muted-foreground ml-auto">
              {stage.objectives.length} objetivo(s)
            </span>
          </div>

          {/* Objetivos */}
          <div className="divide-y">
            {stage.objectives.length === 0 && (
              <p className="text-xs text-muted-foreground italic px-4 py-3">
                Nenhum objetivo configurado nesta fase.
              </p>
            )}

            {stage.objectives.map(obj => (
              <div key={obj.templateId} className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span className="text-[13px] font-medium">{obj.name}</span>
                  {obj.isMandatory && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                      obrigatório
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {obj.steps.length} passo(s)
                  </span>
                </div>

                {/* Passos */}
                {obj.steps.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic ml-5">Sem passos.</p>
                ) : (
                  <ol className="ml-5 space-y-2">
                    {obj.steps.map((step, sti) => {
                      const activity = step.activityType ? activityByKey.get(step.activityType) : undefined;
                      const target = resolveTarget(graph, step.nextStageId);
                      return (
                        <li
                          key={step.id}
                          className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5"
                        >
                          {/* linha principal */}
                          <div className="flex items-start gap-2">
                            <span className="flex-shrink-0 h-4 w-4 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[9px] font-bold flex items-center justify-center mt-0.5">
                              {sti + 1}
                            </span>
                            <span className="text-[12px] font-medium flex-1">{step.label}</span>
                            {activity && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 gap-1"
                                style={{ borderColor: activity.color }}
                              >
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: activity.color }}
                                />
                                {activity.label}
                              </Badge>
                            )}
                          </div>

                          {step.description && (
                            <p className="text-[11px] text-muted-foreground ml-6">{step.description}</p>
                          )}

                          {/* Checklist do passo */}
                          {step.docChecklist && step.docChecklist.length > 0 && (
                            <div className="ml-6 space-y-1">
                              <div className="flex items-center gap-1.5 text-[10px] font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                                <ClipboardList className="h-3 w-3" />
                                {checklistMeta(step.docChecklist[0].type).label}
                              </div>
                              <ul className="space-y-0.5">
                                {step.docChecklist.map(item => (
                                  <li key={item.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="h-1 w-1 rounded-full bg-muted-foreground/60 flex-shrink-0" />
                                    {item.label}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Respostas configuradas (pergunta com ramificação) */}
                          {step.answers && step.answers.length > 0 ? (
                            <div className="ml-6 space-y-1">
                              <div className="flex items-center gap-1.5 text-[10px] font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide">
                                <HelpCircle className="h-3 w-3" />
                                Respostas
                              </div>
                              {step.answers.map(ans => {
                                const at = resolveTarget(graph, ans.nextStageId);
                                return (
                                  <div key={ans.id} className="flex items-center gap-1.5 text-[11px]">
                                    <span className="text-foreground">{ans.label}</span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    {at ? (
                                      <span
                                        className="inline-flex items-center gap-1 font-medium"
                                        style={{ color: at.color }}
                                      >
                                        {at.isFinalize ? <Flag className="h-3 w-3" /> : (
                                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: at.color }} />
                                        )}
                                        {at.name}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground italic">permanece na fase</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            /* Roteamento direto do passo */
                            target && (
                              <div className="ml-6 flex items-center gap-1.5 text-[11px]">
                                {target.isFinalize ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
                                    <Flag className="h-3 w-3" /> Ao concluir: Finalizar fluxo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-medium" style={{ color: target.color }}>
                                    <ArrowRight className="h-3 w-3" />
                                    Ao concluir: mover para {target.name}
                                  </span>
                                )}
                              </div>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
        <CheckCircle2 className="h-3 w-3" />
        Para alterar checklists, roteamento ou passos, use o botão “Editar”.
      </div>
    </div>
  );
}
