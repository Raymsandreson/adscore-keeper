import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ListChecks } from 'lucide-react';
import { LeadFunnelProgressBar } from '@/components/activities/LeadFunnelProgressBar';
import { subscribeToPopPassos, type PopPassosIntent } from '@/lib/popPassosIntent';

/**
 * Host do intent `pop-passos:open` — montado uma vez no App.
 *
 * Faz duas coisas, nessa ordem:
 * 1. PERGUNTA (quando `perguntar`): "já foi dado algum passo deste POP?". É o
 *    lembrete que faltava na criação da atividade — sem ele o POP ficava parado
 *    na fase errada até alguém lembrar de marcar.
 * 2. ABRE a aba lateral dos passos, que é a MESMA da barra de progresso
 *    (`LeadFunnelProgressBar` em modo 'somente-passos'): mesma marcação, mesmo
 *    log, mesmas regras de passo-pergunta e checklist. Nada de formulário
 *    reduzido paralelo.
 */
export function PopPassosAoCriarHost() {
  const [intent, setIntent] = useState<PopPassosIntent | null>(null);
  const [fase, setFase] = useState<'pergunta' | 'passos'>('pergunta');

  useEffect(() => subscribeToPopPassos((novo) => {
    setIntent(novo);
    setFase(novo.perguntar ? 'pergunta' : 'passos');
  }), []);

  if (!intent) return null;

  const fechar = () => setIntent(null);

  if (fase === 'pergunta') {
    return (
      <Dialog open onOpenChange={(aberto) => { if (!aberto) fechar(); }}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col gap-3">
            <DialogTitle className="text-base">Algum passo do POP já foi dado?</DialogTitle>
            <DialogDescription className="text-sm">
              {intent.atividadeTitulo
                ? <>A atividade <span className="font-medium text-foreground">{intent.atividadeTitulo}</span> segue um POP. </>
                : <>Esta atividade segue um POP. </>}
              Se parte do trabalho já foi feita, marque agora — senão o POP fica parado
              numa fase que o processo já passou.
            </DialogDescription>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={fechar}>Ainda não</Button>
              <Button onClick={() => setFase('passos')}>
                <ListChecks className="mr-2 h-4 w-4" /> Sim — marcar agora
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <LeadFunnelProgressBar
      key={intent.nonce}
      leadId={intent.leadId}
      boardId={intent.boardId}
      activityId={intent.activityId || null}
      processId={intent.processId || null}
      modo="somente-passos"
      onFecharPainel={fechar}
    />
  );
}
