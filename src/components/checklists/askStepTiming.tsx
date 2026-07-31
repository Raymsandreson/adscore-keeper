import { createRoot } from 'react-dom/client';

// Resposta da caixa de timing:
//   'now'    → passo executado HOJE (conta como progresso do dia no ranking)
//   'before' → passo executado em OUTRO DIA, só registrado agora (fica no
//              histórico, mas não conta no ranking do telão)
//   'cancel' → desistiu: a marcação NÃO deve ser aplicada
export type StepTiming = 'now' | 'before' | 'cancel';

// Pergunta, ao marcar um passo, se ele foi executado HOJE ou em outro dia — ou
// se foi engano ("Cancelar"). A janela é o DIA, não o instante: quem executou de
// manhã e marca à tarde responde "hoje". A pergunta antiga ("agora" x "já tinha
// acontecido antes") era lida ao pé da letra e mandava 83% dos passos do dia
// (31/07/2026) pro balde retroativo, zerando o critério de gente que trabalhou.
//
// IMPORTANTE pra quem chama: pergunte ANTES de salvar. 'cancel' significa que
// nada deve ser gravado (nem o checked, nem mudança de fase, nem status do POP).
// Fechar sem escolher (clique fora / Esc) também é 'cancel'.
//
// Imperativo (createRoot em vez de estado React) de propósito: é chamado de
// vários pontos diferentes (hook e componentes) e não pode depender de provider.
export function askStepTiming(count = 1): Promise<StepTiming> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const done = (timing: StepTiming) => {
      document.removeEventListener('keydown', onKeyDown);
      // unmount fora do ciclo de render atual pra evitar warning do React.
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(timing);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done('cancel');
    };
    document.addEventListener('keydown', onKeyDown);

    const plural = count > 1;
    root.render(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
        onClick={() => done('cancel')}
      >
        <div
          className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-sm font-semibold">
            {plural ? `Esses ${count} passos foram executados HOJE?` : 'Esse passo foi executado HOJE?'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vale o dia em que o trabalho foi feito, não a hora em que você está marcando —
            passo feito hoje de manhã ainda é "hoje". Passo de outro dia fica no histórico,
            mas não conta no ranking do telão.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              autoFocus
              className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => done('now')}
            >
              {plural ? 'Sim, foram hoje' : 'Sim, foi hoje'}
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => done('before')}
            >
              {plural ? 'Não, foram em outro dia' : 'Não, foi em outro dia'}
            </button>
            <button
              type="button"
              className="h-9 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => done('cancel')}
            >
              Cancelar (não marcar)
            </button>
          </div>
        </div>
      </div>
    );
  });
}
