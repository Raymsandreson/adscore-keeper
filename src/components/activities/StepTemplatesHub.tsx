import { useMemo, useState } from 'react';
import { Sparkles, ChevronDown, Pencil, Trash2, Plus, Eye, Check, CircleCheck, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { TemplateVariation } from '@/hooks/useChecklists';

interface StepOption {
  stepId: string;
  stepLabel: string;
  phaseId: string;
  phaseLabel: string | null;
  objectiveLabel: string | null;
  checked: boolean;
}

interface Props {
  fieldLabel: string;
  variations: TemplateVariation[];
  currentValue: string;
  onApply: (content: string) => void;
  // Contexto do passo (para confirmação de vínculo)
  stepLabel?: string | null;
  phaseLabel?: string | null;
  objectiveLabel?: string | null;
  canPersist: boolean;
  onPersist: (next: TemplateVariation[]) => Promise<boolean>;
  // Lista de passos para troca dentro do hub
  allSteps?: StepOption[];
  activeStepId?: string | null;
  onSelectStep?: (id: string | null) => void;
}

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]+>/g, '').trim();
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Hub de modelos de mensagem do campo de uma atividade.
 * Sempre visível acima da caixa, independente de existirem modelos.
 *
 * Funções:
 * - Pré-visualizar (clicando no item) com botão "Aplicar"
 * - Editar nome/conteúdo de modelo existente
 * - Remover modelo
 * - Cadastrar novo modelo direto da atividade
 *   → confirma se quer vincular ao passo atual do fluxo/funil
 */
export function StepTemplatesHub({
  fieldLabel,
  variations,
  currentValue,
  onApply,
  stepLabel,
  phaseLabel,
  objectiveLabel,
  canPersist,
  onPersist,
  allSteps = [],
  activeStepId = null,
  onSelectStep,
}: Props) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<TemplateVariation | null>(null);
  const [editing, setEditing] = useState<TemplateVariation | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [pendingApply, setPendingApply] = useState<TemplateVariation | null>(null);

  const hasContent = stripHtml(currentValue).length > 0;
  const count = variations.length;

  // Agrupa passos por fase para o picker
  const phases = useMemo(() => {
    const map = new Map<string, { phaseId: string; phaseLabel: string | null; steps: StepOption[] }>();
    for (const s of allSteps) {
      const key = s.phaseId || '_';
      if (!map.has(key)) map.set(key, { phaseId: s.phaseId, phaseLabel: s.phaseLabel, steps: [] });
      map.get(key)!.steps.push(s);
    }
    return Array.from(map.values());
  }, [allSteps]);

  const totalSteps = allSteps.length;
  const completedSteps = allSteps.filter(s => s.checked).length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setDraftName('');
    setDraftContent('');
  };

  const startEdit = (v: TemplateVariation) => {
    setEditing(v);
    setCreating(false);
    setDraftName(v.name || '');
    setDraftContent(v.content || '');
  };

  const cancelDraft = () => {
    setEditing(null);
    setCreating(false);
    setDraftName('');
    setDraftContent('');
  };

  const submitDraft = async () => {
    const content = draftContent.trim();
    if (!content) return;
    const name = draftName.trim() || `Modelo ${variations.length + 1}`;
    let next: TemplateVariation[];
    if (creating) {
      next = [...variations, { id: uid(), name, content }];
    } else if (editing) {
      next = variations.map(v => v.id === editing.id ? { ...v, name, content } : v);
    } else {
      return;
    }
    if (!canPersist) {
      cancelDraft();
      return;
    }
    const ok = await onPersist(next);
    if (ok) {
      cancelDraft();
    }
  };

  const removeVariation = async (v: TemplateVariation) => {
    if (!canPersist) return;
    const next = variations.filter(x => x.id !== v.id);
    await onPersist(next);
  };

  const handlePick = (v: TemplateVariation) => {
    if (hasContent) setPendingApply(v);
    else { onApply(v.content); setOpen(false); }
  };

  return (
    <>
      <div className="flex items-center gap-1 mt-0.5 mb-1">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] gap-1 px-2 border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-300"
            >
              <Sparkles className="h-2.5 w-2.5" />
              {count === 0 ? 'Modelos do passo' : `${count} ${count === 1 ? 'modelo' : 'modelos'} do passo`}
              <ChevronDown className="h-2.5 w-2.5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
            <SheetHeader className="px-4 py-3 border-b space-y-2">
              <div className="flex items-center justify-between gap-2">
                <SheetTitle className="text-sm truncate">Modelos · {fieldLabel}</SheetTitle>
                {!creating && !editing && (
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 shrink-0" onClick={startCreate}>
                    <Plus className="h-3 w-3" /> Novo
                  </Button>
                )}
              </div>

              {/* Barra de progresso do fluxo */}
              {totalSteps > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Progresso do fluxo</span>
                    <span className="font-medium tabular-nums text-foreground">{completedSteps}/{totalSteps} · {progressPct}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}

              {/* Picker de passo agrupado por fase */}
              {phases.length > 0 && onSelectStep && (
                <SheetDescription asChild>
                  <div className="max-h-44 overflow-y-auto pr-1 -mr-1 space-y-1.5">
                    {phases.map(ph => (
                      <div key={ph.phaseId} className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold px-0.5">
                          {ph.phaseLabel || 'Fase'}
                        </div>
                        {ph.steps.map(s => {
                          const isActive = s.stepId === activeStepId;
                          return (
                            <button
                              key={s.stepId}
                              type="button"
                              onClick={() => onSelectStep(s.stepId)}
                              className={cn(
                                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] transition-colors',
                                isActive
                                  ? 'bg-primary/10 border border-primary/40 text-foreground'
                                  : 'hover:bg-muted/60 border border-transparent'
                              )}
                            >
                              {s.checked ? (
                                <CircleCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              ) : (
                                <Circle className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className={cn('truncate font-medium', s.checked && 'line-through text-muted-foreground')}>
                                  {s.stepLabel}
                                </div>
                                {s.objectiveLabel && (
                                  <div className="truncate text-[10px] text-muted-foreground">{s.objectiveLabel}</div>
                                )}
                              </div>
                              {isActive && <span className="text-[9px] text-primary font-semibold shrink-0">atual</span>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </SheetDescription>
              )}

              {/* Fallback se não houver allSteps (compat) */}
              {phases.length === 0 && (phaseLabel || objectiveLabel || stepLabel) && (
                <SheetDescription asChild>
                  <div className="text-[11px] space-y-0.5">
                    {phaseLabel && (<div className="truncate"><span className="text-muted-foreground">Fase:</span> <span className="font-medium text-foreground">{phaseLabel}</span></div>)}
                    {objectiveLabel && (<div className="truncate"><span className="text-muted-foreground">Objetivo:</span> <span className="font-medium text-foreground">{objectiveLabel}</span></div>)}
                    {stepLabel && (<div className="truncate"><span className="text-muted-foreground">Passo:</span> <span className="font-medium text-foreground">{stepLabel}</span></div>)}
                  </div>
                </SheetDescription>
              )}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto">
              {(creating || editing) ? (
                <div className="p-4 space-y-2">
                  <Input
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    placeholder="Nome do modelo (ex: Padrão, Formal, Curta...)"
                    className="h-9 text-sm"
                    autoFocus
                  />
                  <RichTextEditor
                    value={draftContent}
                    onChange={setDraftContent}
                    placeholder="Conteúdo do modelo. Pode usar variáveis como {{lead_name}}."
                    minHeight="220px"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancelDraft}>
                      Cancelar
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={submitDraft} disabled={!draftContent.trim()}>
                      <Check className="h-3 w-3 mr-1" />
                      {creating ? 'Criar' : 'Salvar alterações'}
                    </Button>
                  </div>
                </div>
              ) : variations.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Nenhum modelo cadastrado para este passo.<br />
                  Clique em <strong>Novo</strong> para criar.
                </div>
              ) : (
                <ul className="divide-y">
                  {variations.map((v, i) => (
                    <li key={v.id || i} className="px-4 py-3 hover:bg-muted/40">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="flex-1 text-left min-w-0"
                          onClick={() => setPreviewing(v)}
                          title="Pré-visualizar"
                        >
                          <div className="text-sm font-medium truncate">{v.name || `Variação ${i + 1}`}</div>
                          <div className="text-xs text-muted-foreground line-clamp-3 whitespace-normal">
                            {stripHtml(v.content).slice(0, 200)}
                            {v.content.length > 200 ? '…' : ''}
                          </div>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPreviewing(v)} title="Pré-visualizar">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {canPersist && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(v)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeVariation(v)} title="Remover">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Pré-visualização */}
      <AlertDialog open={!!previewing} onOpenChange={(o) => !o && setPreviewing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{previewing?.name || 'Modelo'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div
                className="text-xs max-h-[50vh] overflow-y-auto border rounded-md p-3 bg-muted/30 prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: previewing?.content || '' }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (previewing) handlePick(previewing); setPreviewing(null); }}>
              Aplicar no campo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirma sobrescrita */}
      <AlertDialog open={!!pendingApply} onOpenChange={(o) => !o && setPendingApply(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir conteúdo?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe texto neste campo. Aplicar <strong>{pendingApply?.name}</strong> vai substituir o conteúdo atual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingApply) { onApply(pendingApply.content); setOpen(false); } setPendingApply(null); }}>
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
