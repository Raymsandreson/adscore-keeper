// =============================================================================
// Regressão: o documento não rolava no celular.
//
// Sintoma (Raym, 03/09/2026 — aba Documentos do processo 0000417-95.2022.5.08.0110,
// peça "Ata da Audiência"): a peça abria e aparecia inteira, mas o dedo não movia
// a página nem pra cima nem pra baixo.
//
// Causa: o MediaLightbox é portalado pro `document.body`, ou seja, FORA do
// conteúdo do Sheet de onde foi aberto. O Radix trava a rolagem com o
// react-remove-scroll, que põe um `touchmove` NÃO-passivo no document e dá
// `preventDefault()` em todo toque que não esteja dentro do painel dele. O
// visualizador nunca está — então todo `touchmove` dentro dele morria.
//
// Este teste dispara o toque de verdade e olha o `defaultPrevented`. Sem o
// cadeado próprio do visualizador (RemoveScroll), o primeiro caso volta a
// falhar.
// =============================================================================
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MediaLightbox } from '../MediaLightbox';

// O visualizador real baixa o pdf.js; aqui só precisamos de uma área rolável
// com as mesmas características de layout (overflow-y próprio).
vi.mock('../PdfCanvasViewer', () => ({
  PdfCanvasViewer: () => (
    <div data-testid="rolagem-do-pdf" style={{ overflowY: 'auto', height: '300px' }}>
      página 1
    </div>
  ),
}));

/** Toque sintético: o jsdom não tem TouchEvent, e o react-remove-scroll só lê
 *  `touches` / `changedTouches`. */
function toque(tipo: string, x: number, y: number) {
  const evento = new Event(tipo, { bubbles: true, cancelable: true });
  const ponto = { clientX: x, clientY: y };
  Object.defineProperty(evento, 'touches', { value: [ponto] });
  Object.defineProperty(evento, 'changedTouches', { value: [ponto] });
  return evento;
}

/** jsdom não faz layout: sem isto nada é "rolável" e o teste mediria o vazio. */
function fingirQueRola(el: HTMLElement, alturaDoConteudo: number, alturaVisivel: number) {
  Object.defineProperty(el, 'scrollHeight', { value: alturaDoConteudo, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: alturaVisivel, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
}

function abrirPecaDentroDeUmSheet() {
  return render(
    <Sheet open>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Documentos</SheetTitle>
        </SheetHeader>
        <MediaLightbox url="https://exemplo.test/ata-da-audiencia.pdf" title="Ata da Audiência" onClose={() => {}} />
      </SheetContent>
    </Sheet>,
  );
}

/** Arrasta o dedo sobre `alvo` e devolve se o navegador ainda teria rolado. */
function arrastar(alvo: HTMLElement) {
  act(() => {
    alvo.dispatchEvent(toque('touchstart', 10, 200));
  });
  const movimento = toque('touchmove', 10, 100);
  act(() => {
    alvo.dispatchEvent(movimento);
  });
  return !movimento.defaultPrevented;
}

describe('MediaLightbox aberto de dentro de um Sheet', () => {
  afterEach(cleanup);

  it('deixa o documento rolar com o dedo', () => {
    const { getByTestId } = abrirPecaDentroDeUmSheet();
    const rolagem = getByTestId('rolagem-do-pdf');
    fingirQueRola(rolagem, 4000, 300);

    expect(arrastar(rolagem)).toBe(true);
  });

  it('mantém o fundo travado: arrastar fora do documento não rola nada', () => {
    abrirPecaDentroDeUmSheet();
    const fundo = document.querySelector('[data-media-lightbox="true"]') as HTMLElement;
    expect(fundo).toBeTruthy();

    expect(arrastar(fundo)).toBe(false);
  });
});
