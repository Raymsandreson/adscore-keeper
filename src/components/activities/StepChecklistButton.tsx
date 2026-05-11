import { useState } from 'react';
import { ClipboardList, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { DocChecklistItem } from '@/hooks/useChecklists';

interface Props {
  stepLabel: string;
  items: DocChecklistItem[];
}

/**
 * Botão compacto que mostra o checklist do passo atual da atividade.
 * Read-only — para edição use a tela do Funil de Vendas.
 */
export function StepChecklistButton({ stepLabel, items }: Props) {
  const [open, setOpen] = useState(false);

  if (!items || items.length === 0) return null;

  const checkedCount = items.filter(i => i.checked).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[11px] gap-1.5 px-2 border-orange-200 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20 hover:bg-orange-100 dark:hover:bg-orange-950/40 text-orange-700 dark:text-orange-300"
        onClick={() => setOpen(o => !o)}
      >
        <ClipboardList className="h-3 w-3" />
        Checklist do passo ({checkedCount}/{items.length})
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </Button>
      <CollapsibleContent>
        <div className="mt-1.5 border rounded-md bg-muted/30 p-2 space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{stepLabel}</p>
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-1.5 text-xs">
              <span
                className={cn(
                  'mt-0.5 inline-flex items-center justify-center h-3.5 w-3.5 rounded border flex-shrink-0',
                  it.checked
                    ? 'bg-success border-success text-success-foreground'
                    : 'border-muted-foreground/40',
                )}
              >
                {it.checked && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className={cn(it.checked && 'line-through text-muted-foreground')}>{it.label}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
