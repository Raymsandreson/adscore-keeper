import { useMemo } from 'react';
import { CheckCircle2, Pencil, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export const CHURCHILL_QUOTES = [
  '"O sucesso é ir de fracasso em fracasso sem perder o entusiasmo." — Winston Churchill',
  '"Nunca, nunca, nunca desista." — Winston Churchill',
  '"Coragem é o que é preciso para se levantar e falar; coragem é também o que é preciso para se sentar e ouvir." — Winston Churchill',
  '"Continue avançando, mesmo no inferno." — Winston Churchill',
  '"A atitude é uma pequena coisa que faz uma grande diferença." — Winston Churchill',
  '"Você nunca chegará ao seu destino se parar e atirar pedras em cada cão que ladrar." — Winston Churchill',
  '"O pessimista vê dificuldade em cada oportunidade; o otimista vê oportunidade em cada dificuldade." — Winston Churchill',
];

export function randomChurchillQuote() {
  return CHURCHILL_QUOTES[Math.floor(Math.random() * CHURCHILL_QUOTES.length)];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onEdit: () => void;
  onDelete: () => void;
}

export function ActivityCreatedDialog({ open, onOpenChange, title, onEdit, onDelete }: Props) {
  const quote = useMemo(
    () => CHURCHILL_QUOTES[Math.floor(Math.random() * CHURCHILL_QUOTES.length)],
    [open]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md text-center">
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <DialogTitle className="text-xl">Atividade criada!</DialogTitle>
          <DialogDescription className="text-base font-medium text-foreground">
            {title}
          </DialogDescription>
          <p className="text-sm italic text-muted-foreground mt-2 px-2 leading-relaxed">
            {quote}
          </p>
        </div>
        <div className="flex gap-2 justify-center mt-4">
          <Button
            variant="outline"
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Excluir
          </Button>
          <Button
            onClick={() => {
              onEdit();
              onOpenChange(false);
            }}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Editar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
