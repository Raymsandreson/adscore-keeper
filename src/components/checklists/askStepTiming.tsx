import { createRoot } from 'react-dom/client';

// Pergunta, ao marcar um passo, se ele foi dado AGORA ou se é registro de algo
// que já tinha acontecido antes. Retorna true quando é retroativo — o passo
// fica no histórico, mas não conta como progresso da semana no ranking do
// telão. Fechar sem escolher (clique fora) conta como "agora" (comportamento
// que já existia antes do flag).
//
// Imperativo (createRoot em vez de estado React) de propósito: é chamado de
// 4 pontos diferentes (hook e componentes) e não pode depender de provider.
export function askStepTiming(count = 1): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const done = (retroactive: boolean) => {
      // unmount fora do ciclo de render atual pra evitar warning do React.
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(retroactive);
    };

    const plural = count > 1;
    root.render(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
        onClick={() => done(false)}
      >
        <div
          className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-sm font-semibold">
            {plural ? `Quando esses ${count} passos aconteceram?` : 'Quando esse passo aconteceu?'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Passo antigo fica no histórico, mas não conta como progresso de hoje no ranking.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              autoFocus
              className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => done(false)}
            >
              {plural ? 'Foram dados agora' : 'Foi dado agora'}
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => done(true)}
            >
              {plural ? 'Já tinham acontecido antes' : 'Já tinha acontecido antes'}
            </button>
          </div>
        </div>
      </div>
    );
  });
}
