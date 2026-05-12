import { useState } from 'react';
import { Sparkles, ChevronDown, Pencil, Trash2, Plus, Eye, Check } from 'lucide-react';
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

interface Props {
  fieldLabel: string;
  variations: TemplateVariation[];
  currentValue: string;
  onApply: (content: string) => void;
  // Contexto do passo (para confirmação de vínculo)
  stepLabel?: string | null;
  phaseLabel?: string | null;
  objectiveLabel?: string | null;
  canPersist: boolean; // só permite salvar/editar/remover se houver passo
  onPersist: (next: TemplateVariation[]) => Promise<boolean>;
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
            <SheetHeader className="px-4 py-3 border-b space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-left">
                  <SheetTitle className="text-sm truncate">Modelos · {fieldLabel}</SheetTitle>
                  {(phaseLabel || objectiveLabel || stepLabel) && (
                    <SheetDescription asChild>
                      <div className="text-[11px] space-y-0.5 mt-1">
                        {phaseLabel && (
                          <div className="truncate"><span className="text-muted-foreground">Fase:</span> <span className="font-medium text-foreground">{phaseLabel}</span></div>
                        )}
                        {objectiveLabel && (
                          <div className="truncate"><span className="text-muted-foreground">Objetivo:</span> <span className="font-medium text-foreground">{objectiveLabel}</span></div>
                        )}
                        {stepLabel && (
                          <div className="truncate"><span className="text-muted-foreground">Passo:</span> <span className="font-medium text-foreground">{stepLabel}</span></div>
                        )}
                      </div>
                    </SheetDescription>
                  )}
                </div>
                {!creating && !editing && (
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 shrink-0" onClick={startCreate}>
                    <Plus className="h-3 w-3" /> Novo
                  </Button>
                )}
              </div>
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
