import { useState, useCallback, ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

interface ConfirmDeleteState {
  open: boolean;
  title: string;
  description: string;
  onConfirm: (() => void) | null;
}

export function useConfirmDelete() {
  const [state, setState] = useState<ConfirmDeleteState>({
    open: false,
    title: '',
    description: '',
    onConfirm: null,
  });

  const confirmDelete = useCallback(
    (title: string, description: string, onConfirm: () => void) => {
      setState({ open: true, title, description, onConfirm });
    },
    []
  );

  const ConfirmDeleteDialog = useCallback(
    () => (
      <AlertDialog
        open={state.open}
        onOpenChange={(open) => {
          if (!open) setState((s) => ({ ...s, open: false }));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                state.onConfirm?.();
                setState((s) => ({ ...s, open: false }));
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
    [state]
  );

  return { confirmDelete, ConfirmDeleteDialog };
}
