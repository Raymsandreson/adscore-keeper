import { useCallback, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ObserverPerson { user_id: string; full_name: string }

/**
 * Passei a atividade que era minha para outra pessoa?
 * Nesse caso vale perguntar se quero continuar acompanhando como OBSERVADOR —
 * é o observer_ids que faz a atividade aparecer no funil de Feedback e receber
 * os popups (feedback, situação, reagendamento).
 *
 * Só pergunta quando as quatro condições valem:
 *  - eu era responsável (principal ou co) na atividade carregada;
 *  - depois da edição não sou mais responsável nem co-responsável;
 *  - existe um novo responsável (esvaziar o campo não é transferência);
 *  - ainda não estou na lista de observadores.
 */
export function shouldAskKeepAsObserver(params: {
  myUserId: string | null | undefined;
  /** Responsáveis (Cloud UUID) da atividade como ela foi carregada. */
  previousResponsibles: string[];
  formAssignedTo: string;
  formCoAssignees: { user_id: string }[];
  formObservers: { user_id: string }[];
}): boolean {
  const uid = params.myUserId;
  if (!uid) return false;
  if (!params.previousResponsibles.includes(uid)) return false;
  if (!params.formAssignedTo || params.formAssignedTo === uid) return false;
  if (params.formCoAssignees.some(c => c.user_id === uid)) return false;
  if (params.formObservers.some(o => o.user_id === uid)) return false;
  return true;
}

/**
 * Diálogo "quer ficar como observador?" com espera assíncrona: `ask(nome)` devolve
 * uma Promise<boolean> que só resolve quando o usuário decide, então o save fica
 * parado no meio do fluxo sem precisar duplicar o payload.
 */
export function useKeepAsObserverPrompt() {
  const [open, setOpen] = useState(false);
  const [assigneeName, setAssigneeName] = useState('');
  const resolveRef = useRef<((keep: boolean) => void) | null>(null);

  const ask = useCallback((newAssigneeName: string) => new Promise<boolean>((resolve) => {
    resolveRef.current = resolve;
    setAssigneeName(newAssigneeName || 'outra pessoa');
    setOpen(true);
  }), []);

  const decide = useCallback((keep: boolean) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(keep);
  }, []);

  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) decide(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Continuar acompanhando?</AlertDialogTitle>
          <AlertDialogDescription>
            Você passou esta atividade para {assigneeName}. Quer ficar como observador
            para receber o feedback e os avisos dela (sem ser cobrado pela execução)?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => decide(false)}>Não, pode seguir sem mim</AlertDialogCancel>
          <AlertDialogAction onClick={() => decide(true)}>Sim, quero acompanhar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { ask, dialog };
}
