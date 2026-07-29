/**
 * Histórico de revisões do POP/Funil — estilo "lei consolidada" do Planalto.
 *
 * Duas visões:
 *  - Linha do tempo: cada revisão com quem/quando/motivo e o diff expandível.
 *  - Versão anotada: o POP vigente com as alterações do período marcadas
 *    inline (antigo tachado → novo), como o texto compilado de uma lei;
 *    passos removidos aparecem tachados no lugar onde existiam.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { History, Sparkles, RotateCcw, ChevronDown, Loader2, User, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchWorkflowRevisions,
  formatDiffLines,
  type DiffEntry,
  type WorkflowRevisionRow,
  type WorkflowSnapshot,
} from '@/lib/workflowRevisions';

interface WorkflowHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string | null;
  boardName: string;
  typeLabel: string; // "POP" | "Funil de Vendas"
  onRestore: (revision: WorkflowRevisionRow) => void;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const ORIGIN_LABEL: Record<string, string> = {
  manual: 'Manual',
  ia: 'IA',
  baseline: 'Versão inicial',
  restore: 'Restauração',
};

function DiffEntryLine({ entry }: { entry: DiffEntry }) {
  const color =
    entry.action === 'adicionado' ? 'text-emerald-600 dark:text-emerald-400'
    : entry.action === 'removido' ? 'text-red-600 dark:text-red-400'
    : 'text-foreground';
  return (
    <div className={cn('text-xs leading-relaxed', color)}>
      {entry.action === 'removido' ? (
        <span className="line-through opacity-80">{formatDiffLines([entry])[0]}</span>
      ) : entry.action === 'alterado' || entry.action === 'renomeado' ? (
        <span>
          <span className="font-medium">{entry.kind === 'pop' ? 'POP' : `${entry.kind} "${entry.label}"`}</span>
          {entry.field ? <span className="text-muted-foreground"> · {entry.field}</span> : null}
          {entry.path ? <span className="text-muted-foreground"> ({entry.path})</span> : null}
          {(entry.before || entry.after) && (
            <span className="block pl-3">
              {entry.before && <s className="text-muted-foreground">{entry.before}</s>}
              {entry.before && entry.after && <span className="mx-1 text-muted-foreground">→</span>}
              {entry.after && <span>{entry.after}</span>}
            </span>
          )}
        </span>
      ) : (
        <span>{formatDiffLines([entry])[0]}</span>
      )}
    </div>
  );
}

/** Anotação = entrada de diff + a revisão que a introduziu. */
interface Annotation { entry: DiffEntry; rev: WorkflowRevisionRow }

function AnnotationTag({ ann }: { ann: Annotation }) {
  return (
    <span className="text-[11px] text-blue-600 dark:text-blue-400 whitespace-normal">
      {' '}(
      {ann.entry.action === 'adicionado' ? 'Incluído' : ann.entry.action === 'removido' ? 'Removido' : 'Alterado'}
      {' '}por {ann.rev.changed_by_name || 'não identificado'} em {fmtDate(ann.rev.created_at)}
      {ann.rev.change_reason ? ` — ${ann.rev.change_reason}` : ''}
      )
    </span>
  );
}

export function WorkflowHistorySheet({ open, onOpenChange, boardId, boardName, typeLabel, onRestore }: WorkflowHistorySheetProps) {
  const [revisions, setRevisions] = useState<WorkflowRevisionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [windowDays, setWindowDays] = useState<string>('30');

  useEffect(() => {
    if (!open || !boardId) return;
    setLoading(true);
    fetchWorkflowRevisions(boardId)
      .then(setRevisions)
      .catch(err => console.error('Erro ao carregar revisões:', err))
      .finally(() => setLoading(false));
  }, [open, boardId]);

  // Anotações do período escolhido, ancoradas por stepId / label+path
  const { current, stepAnns, removedByPath, popAnns, containerAnns } = useMemo(() => {
    const current: WorkflowSnapshot | null = revisions[0]?.snapshot || null;
    const days = parseInt(windowDays, 10);
    const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
    const inWindow = revisions.filter(r =>
      r.origin !== 'baseline' && new Date(r.created_at).getTime() >= cutoff && (r.change_summary?.length || 0) > 0,
    );
    const stepAnns = new Map<string, Annotation[]>();
    const removedByPath = new Map<string, Annotation[]>();
    const popAnns: Annotation[] = [];
    const containerAnns = new Map<string, Annotation[]>(); // fases/objetivos por `${kind}:${label}`
    // Da mais antiga pra mais nova: anotações ficam em ordem cronológica
    for (const rev of [...inWindow].reverse()) {
      for (const entry of rev.change_summary || []) {
        const ann = { entry, rev };
        if (entry.kind === 'pop') { popAnns.push(ann); continue; }
        if (entry.kind === 'passo' && entry.stepId) {
          if (entry.action === 'removido') {
            const list = removedByPath.get(entry.path) || [];
            list.push(ann);
            removedByPath.set(entry.path, list);
          } else {
            const list = stepAnns.get(entry.stepId) || [];
            list.push(ann);
            stepAnns.set(entry.stepId, list);
          }
          continue;
        }
        const key = `${entry.kind}:${entry.label}`;
        const list = containerAnns.get(key) || [];
        list.push(ann);
        containerAnns.set(key, list);
      }
    }
    return { current, stepAnns, removedByPath, popAnns, containerAnns };
  }, [revisions, windowDays]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Histórico — {boardName}
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="timeline" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-3 w-fit">
            <TabsTrigger value="timeline">Linha do tempo</TabsTrigger>
            <TabsTrigger value="anotada">Versão anotada</TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando revisões...
            </div>
          ) : revisions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-8 text-center">
              Nenhuma revisão registrada ainda. A primeira é criada automaticamente ao abrir o {typeLabel} para edição; as próximas, a cada alteração salva.
            </div>
          ) : (
            <>
              <TabsContent value="timeline" className="flex-1 overflow-y-auto px-6 py-4 space-y-3 mt-0 data-[state=inactive]:hidden">
                {revisions.map(rev => (
                  <div key={rev.id} className="border rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono">#{rev.revision_number}</Badge>
                      <Badge variant={rev.origin === 'ia' ? 'default' : 'secondary'} className="gap-1">
                        {rev.origin === 'ia' && <Sparkles className="h-3 w-3" />}
                        {ORIGIN_LABEL[rev.origin] || rev.origin}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{fmtDate(rev.created_at)}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="h-3 w-3" />{rev.changed_by_name || 'não identificado'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 text-xs gap-1"
                        title="Carrega esta versão no editor — nada é sobrescrito até você salvar"
                        onClick={() => onRestore(rev)}
                      >
                        <RotateCcw className="h-3 w-3" /> Restaurar
                      </Button>
                    </div>
                    {rev.change_reason && (
                      <p className="text-xs italic text-muted-foreground">"{rev.change_reason}"</p>
                    )}
                    {(rev.change_summary?.length || 0) > 0 ? (
                      <Collapsible>
                        <CollapsibleTrigger className="text-xs text-primary flex items-center gap-1 hover:underline">
                          <ChevronDown className="h-3 w-3" />
                          {rev.change_summary!.length} alteração(ões)
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-1.5 pl-4 space-y-1 border-l ml-1.5 mt-1">
                          {rev.change_summary!.map((e, i) => <DiffEntryLine key={i} entry={e} />)}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {rev.origin === 'baseline' ? 'Foto inicial do fluxo (registro automático).' : 'Sem resumo de alterações.'}
                      </p>
                    )}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="anotada" className="flex-1 overflow-y-auto px-6 py-4 mt-0 space-y-3 data-[state=inactive]:hidden">
                <div className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Alterações de:</span>
                  <Select value={windowDays} onValueChange={setWindowDays}>
                    <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">últimos 7 dias</SelectItem>
                      <SelectItem value="30">últimos 30 dias</SelectItem>
                      <SelectItem value="90">últimos 90 dias</SelectItem>
                      <SelectItem value="0">todo o histórico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {popAnns.length > 0 && (
                  <div className="border rounded-lg p-2 space-y-1">
                    {popAnns.map((a, i) => (
                      <div key={i} className="text-xs">
                        <DiffEntryLine entry={a.entry} />
                        <AnnotationTag ann={a} />
                      </div>
                    ))}
                  </div>
                )}

                {current && current.phases.map(phase => {
                  const phaseAnns = containerAnns.get(`fase:${phase.stageName}`) || [];
                  return (
                    <div key={phase.stageId} className="border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 font-medium text-sm flex items-center gap-2 flex-wrap" style={{ borderLeft: `3px solid ${phase.stageColor}` }}>
                        {phase.stageName}
                        {phaseAnns.map((a, i) => <AnnotationTag key={i} ann={a} />)}
                      </div>
                      <div className="px-3 pb-3 space-y-2">
                        {phase.objectives.map((obj, oi) => {
                          const objAnns = containerAnns.get(`objetivo:${obj.name}`) || [];
                          const objPath = `${phase.stageName} › ${obj.name}`;
                          const removedHere = removedByPath.get(objPath) || [];
                          return (
                            <div key={obj.templateId || oi} className="rounded border bg-muted/30 p-2">
                              <div className="text-xs font-medium flex items-center gap-1 flex-wrap">
                                {obj.name}
                                {objAnns.map((a, i) => <AnnotationTag key={i} ann={a} />)}
                              </div>
                              <ol className="mt-1.5 space-y-1.5">
                                {obj.items.map((step, si) => {
                                  const anns = stepAnns.get(step.id) || [];
                                  const added = anns.some(a => a.entry.action === 'adicionado');
                                  return (
                                    <li key={step.id} className="text-xs pl-2">
                                      <span className={cn(added && 'text-emerald-600 dark:text-emerald-400 font-medium')}>
                                        {si + 1}. {step.label}
                                      </span>
                                      {anns.map((a, i) => <AnnotationTag key={i} ann={a} />)}
                                      {anns.filter(a => (a.entry.action === 'alterado' || a.entry.action === 'renomeado') && (a.entry.before || a.entry.after)).map((a, i) => (
                                        <span key={`d${i}`} className="block pl-4 text-muted-foreground">
                                          {a.entry.field ? `${a.entry.field}: ` : ''}
                                          {a.entry.before && <s>{a.entry.before}</s>}
                                          {a.entry.before && a.entry.after && ' → '}
                                          {a.entry.after && <span className="text-foreground">{a.entry.after}</span>}
                                        </span>
                                      ))}
                                    </li>
                                  );
                                })}
                                {removedHere.map((a, i) => (
                                  <li key={`rm${i}`} className="text-xs pl-2 text-red-600 dark:text-red-400">
                                    <s>{a.entry.label}</s>
                                    <AnnotationTag ann={a} />
                                  </li>
                                ))}
                              </ol>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <p className="text-[11px] text-muted-foreground">
                  Como no texto compilado de uma lei: o conteúdo vigente aparece normal; o que mudou no período vem marcado — <s>antigo tachado</s> → novo, com autor, data e motivo.
                </p>
              </TabsContent>
            </>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
