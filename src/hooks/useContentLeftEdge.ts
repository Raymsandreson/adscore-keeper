import { useEffect, useState } from 'react';
import { contentLeftEdge } from '@/lib/contentEdge';

/**
 * Borda esquerda da área livre, reativa: o menu lateral troca de largura
 * (16rem ↔ 3rem no modo ícone) e some no mobile, então quem fica ancorado nela
 * precisa remedir — senão o flutuante volta a cobrir os itens do menu quando
 * ele reexpande. (skill: ui-sem-sobreposicao)
 *
 * `enabled=false` desliga a medição enquanto o flutuante está escondido.
 */
export function useContentLeftEdge(enabled = true): number {
  const [edge, setEdge] = useState(() => contentLeftEdge());

  useEffect(() => {
    if (!enabled) return;
    const update = () => setEdge(contentLeftEdge());
    update();

    const sidebar = document.querySelector('[data-sidebar="sidebar"]:not([data-mobile])');
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (sidebar && observer) observer.observe(sidebar);
    window.addEventListener('resize', update);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [enabled]);

  return edge;
}
