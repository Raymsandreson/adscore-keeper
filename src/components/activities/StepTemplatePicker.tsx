import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
  variations: TemplateVariation[];
  currentValue: string;
  onApply: (content: string) => void;
}

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]+>/g, '').trim();
}

/**
 * Chip discreto acima de uma caixa de texto da atividade.
 * - 0 variações: nada (componente retorna null pelo pai).
 * - 1 variação: chip "Aplicar modelo".
 * - 2+: chip "X modelos ▾" abrindo dropdown com nome + preview.
 *
 * Confirma antes de sobrescrever conteúdo já digitado.
 */
export function StepTemplatePicker({ variations, currentValue, onApply }: Props) {
  const [pending, setPending] = useState<TemplateVariation | null>(null);

  if (!variations || variations.length === 0) return null;

  const hasContent = stripHtml(currentValue).length > 0;

  const handlePick = (v: TemplateVariation) => {
    if (hasContent) {
      setPending(v);
    } else {
      onApply(v.content);
    }
  };

  const confirm = () => {
    if (pending) {
      onApply(pending.content);
      setPending(null);
    }
  };

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1 mt-0.5 mb-1 flex-wrap">
          {variations.map((v, i) => (
            <Tooltip key={v.id || i}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2 border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-300 max-w-[180px]"
                  onClick={() => handlePick(v)}
                >
                  <Sparkles className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{v.name || `Modelo ${i + 1}`}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-sm whitespace-pre-wrap text-xs">
                {stripHtml(v.content).slice(0, 400) || '(sem conteúdo)'}
                {stripHtml(v.content).length > 400 ? '…' : ''}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir conteúdo?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe texto neste campo. Aplicar o modelo <strong>{pending?.name}</strong> vai substituir o conteúdo atual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Substituir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
