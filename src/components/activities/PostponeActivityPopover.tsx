import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendarClock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildPostponeOptions, minPostponeDate } from '@/lib/postponeDates';

interface PostponeActivityPopoverProps {
  /** Grava o novo prazo. Recebe `yyyy-MM-dd`; o popover fecha quando resolve. */
  onPostpone: (dateStr: string) => Promise<void> | void;
  disabled?: boolean;
  /** Prazo atual (`yyyy-MM-dd`), só para mostrar de onde a atividade está saindo. */
  currentDeadline?: string | null;
  className?: string;
  /** Texto do botão. Em lote vira "Adiar 12". */
  label?: string;
  /** Linha de aviso do topo. Em lote diz o que fica de fora (concluídas). */
  hint?: string;
}

/**
 * "Adiar" — troca o prazo da atividade e pronto: não conclui, não cria filha e
 * não passa pelo pop-up de previsão de tempo (que, se fechado, descartava a
 * edição em silêncio). Era o caminho que faltava: sem ele, adiar dependia de
 * Prazo + Salvar, e a equipe acabava usando "Concluir + próxima" para isso,
 * concluindo a atividade no dia velho e deixando um clone na data nova.
 *
 * Prazo e data de notificação andam juntos aqui de propósito: quem adia quer a
 * atividade inteira no dia novo, não o aviso num dia e a execução em outro.
 */
export function PostponeActivityPopover({
  onPostpone,
  disabled,
  currentDeadline,
  className,
  label = 'Adiar',
  hint,
}: PostponeActivityPopoverProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customDate, setCustomDate] = useState('');

  const options = buildPostponeOptions();
  const minDate = minPostponeDate();

  const aplicar = async (dateStr: string) => {
    if (!dateStr || saving) return;
    setSaving(true);
    try {
      await onPostpone(dateStr);
      setOpen(false);
      setCustomDate('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (!saving) setOpen(o); }}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          className={cn('h-8 text-xs gap-1', className)}
          title="Adiar: só troca o prazo, sem concluir nem criar outra atividade"
        >
          <CalendarClock className="h-3.5 w-3.5" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-1 pb-1.5 text-[11px] text-muted-foreground">
          {hint || (
            <>Só muda o prazo — a atividade <strong>não</strong> é concluída e nenhuma cópia é criada.</>
          )}
        </p>

        <div className="flex flex-col gap-1">
          {options.map(o => (
            <Button
              key={o.key}
              variant="ghost"
              size="sm"
              disabled={saving}
              className="h-8 justify-between text-xs font-normal"
              onClick={() => aplicar(o.dateStr)}
            >
              <span>{o.label}</span>
              <span className="text-muted-foreground">{o.when}</span>
            </Button>
          ))}
        </div>

        <div className="mt-2 border-t pt-2">
          <span className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground">Outra data</span>
          <div className="mt-1 flex items-center gap-1.5">
            <Input
              type="date"
              min={minDate}
              value={customDate}
              disabled={saving}
              onChange={e => setCustomDate(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              disabled={saving || !customDate}
              className="h-8 text-xs shrink-0"
              onClick={() => aplicar(customDate)}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Adiar'}
            </Button>
          </div>
        </div>

        {currentDeadline && (
          <p className="mt-2 px-1 text-[10px] text-muted-foreground">
            Prazo atual: {currentDeadline.slice(8, 10)}/{currentDeadline.slice(5, 7)}/{currentDeadline.slice(0, 4)}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
