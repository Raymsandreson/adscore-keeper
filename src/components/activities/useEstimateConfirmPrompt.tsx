import { useCallback, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ESTIMATE_OPTIONS, formatEstimate } from '@/hooks/useActivityTimeEstimate';

export interface EstimateConfirmResult {
  /** false = o assessor desistiu; o save NÃO deve seguir. */
  confirmed: boolean;
  /** Previsão escolhida (min). null = assumiu "sem previsão" de propósito. */
  minutes: number | null;
}

export interface EstimateConfirmRequest {
  /** Valor que já está no formulário (sugerido ou escolhido). */
  current: number | null;
  /** Rótulo do tipo, para a pessoa entender de onde veio a sugestão. */
  typeLabel?: string | null;
  /** Quantas execuções cronometradas sustentam a sugestão (0 = sem histórico). */
  samples?: number;
}

/**
 * "Quanto tempo isso vai levar?" — confirmação obrigatória da previsão na hora
 * de salvar. A sugestão automática acerta o caso comum, mas quem vai executar é
 * quem sabe se ESTA atividade foge da média; sem a parada, a previsão sugerida
 * viraria número que ninguém leu e o comparativo gasto x previsto perderia valor.
 *
 * `ask()` devolve uma Promise que só resolve quando a pessoa decide, então o save
 * fica parado no meio do fluxo sem precisar duplicar o payload (mesmo desenho do
 * `useKeepAsObserverPrompt`).
 */
export function useEstimateConfirmPrompt() {
  const [open, setOpen] = useState(false);
  const [req, setReq] = useState<EstimateConfirmRequest>({ current: null });
  const [choice, setChoice] = useState<number | null>(null);
  const resolveRef = useRef<((r: EstimateConfirmResult) => void) | null>(null);

  const ask = useCallback((request: EstimateConfirmRequest) => new Promise<EstimateConfirmResult>((resolve) => {
    resolveRef.current = resolve;
    setReq(request);
    setChoice(request.current);
    setOpen(true);
  }), []);

  const decide = useCallback((confirmed: boolean, minutes: number | null) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.({ confirmed, minutes });
  }, []);

  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) decide(false, null); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Quanto tempo isso vai levar?</AlertDialogTitle>
          <AlertDialogDescription>
            {req.samples && req.samples > 0
              ? <>Sugerido a partir das {req.samples} execuções cronometradas de{' '}
                  <strong>{req.typeLabel || 'atividades deste tipo'}</strong>. Ajuste se esta aqui foge da média.</>
              : <>Ainda não há histórico cronometrado suficiente para{' '}
                  <strong>{req.typeLabel || 'este tipo'}</strong>. Confirme sua estimativa.</>}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-wrap gap-1.5 py-1">
          {ESTIMATE_OPTIONS.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setChoice(m)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-xs border transition-colors',
                choice === m
                  ? 'bg-primary text-primary-foreground border-primary font-semibold'
                  : 'border-border hover:bg-accent',
              )}
            >
              {formatEstimate(m)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setChoice(null)}
            className={cn(
              'px-2.5 py-1.5 rounded-md text-xs border transition-colors',
              choice === null
                ? 'bg-primary text-primary-foreground border-primary font-semibold'
                : 'border-border hover:bg-accent text-muted-foreground',
            )}
          >
            Sem previsão
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          O cronômetro avisa ao se aproximar e mostra o excedente quando passa. Dá para
          mudar depois, na própria atividade ou no relógio.
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => decide(false, null)}>Voltar ao formulário</AlertDialogCancel>
          {/* Botão comum (não AlertDialogAction): o texto muda com a escolha e o
              fechamento é feito no decide, junto com a resolução da Promise. */}
          <Button onClick={() => decide(true, choice)}>
            {choice ? `Confirmar ${formatEstimate(choice)}` : 'Salvar sem previsão'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { ask, dialog };
}
