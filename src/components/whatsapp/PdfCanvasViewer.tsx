// =============================================================================
// Visualizador de PDF que NÃO depende do navegador.
//
// Por que existe (Raym, 30/08/2026 — peça 1078 "CERTIDÃO DE REGULARIDADE DA
// SUSEP" na aba Documentos do processo): no Android o Chrome e o WebView não
// têm visualizador de PDF embutido. Um `<iframe src="....pdf">` — que é o que
// o MediaLightbox usava — vira um retângulo cinza com "PDF / 1078.pdf / Abrir".
// O painel abria certo; o miolo é que ficava vazio. E o botão "Abrir" daquele
// stub é do sistema: leva a pessoa PRA FORA do app, exatamente o que a regra de
// interface proíbe.
//
// A solução é estrutural: desenhamos as páginas nós mesmos, em canvas, com o
// pdf.js. Mesmo comportamento em Android, iOS e desktop, e ninguém sai da tela.
//
// Cuidados que estão aqui de propósito:
// - o pdf.js só é baixado quando alguém abre um PDF (import dinâmico), então o
//   bundle inicial do app não engorda;
// - peça de autos tem centenas de páginas: só renderiza a página que está perto
//   da viewport e libera o canvas de quem saiu — senão a aba morre de memória
//   (uma página A4 em 2x já são ~5 MB de bitmap);
// - se qualquer coisa falhar (worker bloqueado, PDF corrompido), avisamos o
//   chamador para ele voltar ao iframe em vez de deixar tela preta.
// =============================================================================
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

// Build LEGACY de propósito. O build moderno do pdf.js usa APIs de JS recém
// saídas do forno (`Map.getOrInsertComputed` na v6, por exemplo) que nem o
// Chrome de hoje tem — verificado aqui: as três páginas do PDF de teste ficavam
// em branco, com TypeError no console. O legacy é transpilado e roda no WebView
// do Android, que é justamente o aparelho que motivou este componente.

/** Zoom sobre a largura do painel (1 = página ocupa a largura toda). */
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASSO = 0.5;
/** Quanto antes/depois da viewport uma página começa a ser desenhada. */
const MARGEM_RENDER = '600px';
/** Teto do bitmap: acima disso o canvas fica caro sem ganho visível. */
const DPR_MAX = 2;

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsCarregando: Promise<Pdfjs> | null = null;

/**
 * O pdf.js usa `Promise.withResolvers`, que WebView antigo de Android não tem.
 * Sem isto o visualizador quebraria justamente no aparelho que motivou este
 * componente.
 */
function garantirWithResolvers() {
  const P = Promise as unknown as { withResolvers?: unknown };
  if (typeof P.withResolvers === 'function') return;
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

function carregarPdfjs(): Promise<Pdfjs> {
  if (!pdfjsCarregando) {
    pdfjsCarregando = (async () => {
      garantirWithResolvers();
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })().catch((e) => {
      // não guarda a promessa quebrada: a próxima abertura tenta de novo
      pdfjsCarregando = null;
      throw e;
    });
  }
  return pdfjsCarregando;
}

interface PdfCanvasViewerProps {
  url: string;
  /** Chamado quando não dá para renderizar aqui — o chamador cai no iframe. */
  onFalha?: (motivo: string) => void;
}

export function PdfCanvasViewer({ url, onFalha }: PdfCanvasViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [larguraPainel, setLarguraPainel] = useState(0);
  /** Proporção (altura/largura) da primeira página — serve de esqueleto. */
  const [proporcao, setProporcao] = useState(1.414);

  // Largura disponível: é ela que define o "cabe na tela" das páginas.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const medir = () => setLarguraPainel(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelado = false;
    // No pdf.js v6 quem derruba o worker é a tarefa de carregamento, não o
    // documento — é ela que precisa ser guardada para o cleanup.
    let tarefa: PDFDocumentLoadingTask | null = null;
    setCarregando(true);
    setDoc(null);
    setZoom(1);
    (async () => {
      try {
        const pdfjs = await carregarPdfjs();
        tarefa = pdfjs.getDocument({ url });
        const documento = await tarefa.promise;
        if (cancelado) return;
        const primeira = await documento.getPage(1);
        const vp = primeira.getViewport({ scale: 1 });
        if (cancelado) return;
        setProporcao(vp.height / vp.width);
        setDoc(documento);
        setCarregando(false);
      } catch (e) {
        if (cancelado) return;
        setCarregando(false);
        onFalha?.(String((e as Error)?.message || e));
      }
    })();
    return () => {
      cancelado = true;
      if (tarefa) void tarefa.destroy();
    };
    // onFalha vem do pai e não deve reabrir o documento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const maisZoom = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_PASSO)), []);
  const menosZoom = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_PASSO)), []);

  const larguraPagina = Math.max(0, Math.floor(larguraPainel * zoom) - (zoom > 1 ? 0 : 16));

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-auto overscroll-contain bg-muted"
        // deixa o gesto de arrastar rolar o documento em vez de virar seleção
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {carregando && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando o documento…
          </div>
        )}
        {doc && larguraPagina > 0 && (
          <div className="flex w-fit min-w-full flex-col items-center gap-2 p-2">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PaginaPdf
                key={`${url}#${i + 1}#${larguraPagina}`}
                doc={doc}
                numero={i + 1}
                largura={larguraPagina}
                alturaEstimada={Math.round(larguraPagina * proporcao)}
                raiz={scrollRef.current}
              />
            ))}
          </div>
        )}
      </div>

      {doc && (
        <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-border bg-card/95 px-1 py-1 shadow-lg">
          <button
            type="button"
            onClick={menosZoom}
            disabled={zoom <= ZOOM_MIN}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            title="Diminuir zoom"
            aria-label="Diminuir zoom"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[2.75rem] text-center text-[11px] font-medium tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={maisZoom}
            disabled={zoom >= ZOOM_MAX}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            title="Aumentar zoom"
            aria-label="Aumentar zoom"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

interface PaginaPdfProps {
  doc: PDFDocumentProxy;
  numero: number;
  largura: number;
  alturaEstimada: number;
  raiz: HTMLElement | null;
}

/**
 * Uma página. Enquanto está longe da viewport é só um retângulo com a altura
 * estimada — nada de bitmap na memória. Ao chegar perto, desenha; ao sair,
 * devolve a memória.
 */
function PaginaPdf({ doc, numero, largura, alturaEstimada, raiz }: PaginaPdfProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tarefaRef = useRef<{ cancel: () => void } | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [altura, setAltura] = useState(alturaEstimada);
  const [pronta, setPronta] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entradas) => setVisivel(entradas.some(e => e.isIntersecting)),
      { root: raiz ?? null, rootMargin: MARGEM_RENDER },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [raiz]);

  useEffect(() => {
    if (!visivel) return;
    let cancelado = false;
    (async () => {
      try {
        const page = await doc.getPage(numero);
        if (cancelado) return;
        const base = page.getViewport({ scale: 1 });
        const escala = largura / base.width;
        const viewport = page.getViewport({ scale: escala });
        const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setAltura(Math.floor(viewport.height));
        const tarefa = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        tarefaRef.current = tarefa;
        await tarefa.promise;
        if (!cancelado) setPronta(true);
      } catch {
        // página que não desenha não derruba o documento inteiro: fica o
        // esqueleto e o resto do acervo continua legível
      }
    })();
    return () => {
      cancelado = true;
      tarefaRef.current?.cancel();
      tarefaRef.current = null;
    };
  }, [visivel, doc, numero, largura]);

  // Saiu de perto da viewport: zera o bitmap (é isto que segura a memória em
  // peça de 400 páginas).
  useEffect(() => {
    if (visivel) return;
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    setPronta(false);
  }, [visivel]);

  return (
    <div
      ref={hostRef}
      className="relative w-full shrink-0"
      style={{ height: altura, width: largura }}
      data-pagina={numero}
    >
      {!pronta && (
        <div className="absolute inset-0 flex items-center justify-center rounded-sm border border-border bg-background/60 text-[10px] text-muted-foreground">
          página {numero}
        </div>
      )}
      <canvas ref={canvasRef} className="block rounded-sm bg-white shadow-sm" />
    </div>
  );
}
