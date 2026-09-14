import { useMemo, useEffect } from 'react';
import { CheckCircle2, Pencil, Trash2, X, ListChecks } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { abrirPassosDoPop } from '@/lib/popPassosIntent';

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
  /**
   * POP que mede a atividade recém-criada. Quando vem preenchido, o diálogo
   * PERGUNTA se algum passo já foi dado e abre a aba lateral dos passos — sem
   * isso o POP ficava parado na fase errada até alguém lembrar de marcar
   * (pedido do usuário, 14/09/2026). Null em atividade sem POP.
   */
  pop?: { leadId: string; boardId: string; processId?: string | null; activityId?: string | null } | null;
}

export function ActivityCreatedDialog({ open, onOpenChange, title, onEdit, onDelete, pop = null }: Props) {
  const quote = useMemo(
    () => CHURCHILL_QUOTES[Math.floor(Math.random() * CHURCHILL_QUOTES.length)],
    [open]
  );

  useEffect(() => {
    if (!open) return;
    // Com pergunta de POP na tela o diálogo NÃO se fecha sozinho: fechar em 5s
    // seria o mesmo que não ter perguntado.
    if (pop) return;
    const t = setTimeout(() => onOpenChange(false), 5000);
    return () => clearTimeout(t);
  }, [open, onOpenChange, pop]);

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

        {/* Lembrete do POP: parte do trabalho costuma já ter sido feita antes de
            a atividade nascer (ligação, protocolo, documento anexado). */}
        {pop && (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-left">
            <p className="text-sm font-medium">Algum passo do POP já foi dado?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Marque agora o que já foi feito — senão o POP fica parado numa fase que o processo já passou.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  abrirPassosDoPop({
                    leadId: pop.leadId,
                    boardId: pop.boardId,
                    processId: pop.processId ?? null,
                    activityId: pop.activityId ?? null,
                    perguntar: false,
                    atividadeTitulo: title,
                  });
                  onOpenChange(false);
                }}
              >
                <ListChecks className="h-4 w-4 mr-2" />
                Sim — marcar agora
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Ainda não
              </Button>
            </div>
          </div>
        )}
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
