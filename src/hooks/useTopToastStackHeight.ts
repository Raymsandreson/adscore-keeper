import { useEffect, useState } from 'react';

/**
 * Borda inferior (em px, a partir do topo da viewport) da pilha de popups de
 * notificação do sonner ancorada no topo (position: top-center).
 *
 * Usado pelo drawer de conversa aberto por notificação: ele desce do topo mas
 * COMEÇA abaixo dos popups, para nenhum aviso cobrir o conteúdo da conversa.
 * Sem popup na tela devolve 0 e o drawer encosta no topo.
 *
 * Medição por polling curto enquanto `enabled`: os toasts entram e saem por
 * conta própria (timeout, X, swipe) e não emitem evento — observar o DOM a
 * cada 400ms é mais simples e barato que MutationObserver na árvore toda.
 */
export function useTopToastStackHeight(enabled: boolean) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setHeight(0);
      return;
    }

    const measure = () => {
      let bottom = 0;
      document
        .querySelectorAll<HTMLElement>('[data-sonner-toast][data-y-position="top"]')
        .forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0) bottom = Math.max(bottom, rect.bottom);
        });
      setHeight(bottom);
    };

    measure();
    const id = window.setInterval(measure, 400);
    return () => window.clearInterval(id);
  }, [enabled]);

  return height;
}
