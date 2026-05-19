import { createPortal } from 'react-dom';
import { Download, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';

interface MediaLightboxProps {
  url: string | null;
  title?: string;
  onClose: () => void;
}

const ZOOM_STEP = 0.5;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

export function MediaLightbox({ url, title = 'Visualização', onClose }: MediaLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);

  // reset state when url changes / closes
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [url]);

  // ESC to close, wheel to zoom
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [url, onClose]);

  if (!url || typeof document === 'undefined') return null;

  const isPdf = /\.pdf($|\?)/i.test(url);
  const stopEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const clampZoom = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

  const zoomIn = () => setZoom((z) => clampZoom(z + ZOOM_STEP));
  const zoomOut = () =>
    setZoom((z) => {
      const next = clampZoom(z - ZOOM_STEP);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  const resetZoom = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (isPdf) return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => {
      const next = clampZoom(z + delta);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const onImgPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    e.stopPropagation();
    movedRef.current = false;
    if (zoom > 1) {
      draggingRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
  };
  const onImgPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - draggingRef.current.x;
    const dy = e.clientY - draggingRef.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    setOffset({ x: draggingRef.current.ox + dx, y: draggingRef.current.oy + dy });
  };
  const onImgPointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    draggingRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };
  const onImgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) return;
    // click on image toggles zoom step
    setZoom((z) => {
      if (z >= MAX_ZOOM) {
        setOffset({ x: 0, y: 0 });
        return 1;
      }
      return clampZoom(z + ZOOM_STEP);
    });
  };

  return createPortal(
    <div
      data-media-lightbox="true"
      className="fixed inset-0 z-[1000] bg-background/95 flex items-center justify-center p-4 animate-in fade-in overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={stopEvent}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onWheel={onWheel}
    >
      <div
        className="absolute top-4 right-4 flex items-center gap-2"
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={stopEvent}
      >
        {!isPdf && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); zoomOut(); }}
              disabled={zoom <= MIN_ZOOM}
              className="bg-card/80 hover:bg-card disabled:opacity-40 text-foreground border border-border rounded-full p-2 shadow-lg"
              title="Diminuir zoom"
              aria-label="Diminuir zoom"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="bg-card/80 text-foreground border border-border rounded-full px-3 py-1 text-xs font-medium shadow-lg min-w-[3.5rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); zoomIn(); }}
              disabled={zoom >= MAX_ZOOM}
              className="bg-card/80 hover:bg-card disabled:opacity-40 text-foreground border border-border rounded-full p-2 shadow-lg"
              title="Aumentar zoom"
              aria-label="Aumentar zoom"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resetZoom(); }}
              disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
              className="bg-card/80 hover:bg-card disabled:opacity-40 text-foreground border border-border rounded-full p-2 shadow-lg"
              title="Restaurar zoom"
              aria-label="Restaurar zoom"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
          </>
        )}
        <a
          href={url}
          download
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={stopEvent}
          className="bg-card/80 hover:bg-card text-foreground border border-border rounded-full p-2 shadow-lg"
          title="Baixar"
          aria-label="Baixar arquivo"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          type="button"
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="bg-card/80 hover:bg-card text-foreground border border-border rounded-full p-2 shadow-lg"
          title="Fechar"
          aria-label="Fechar visualização"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {isPdf ? (
        <iframe
          src={url}
          title={title}
          className="w-[95vw] h-[95vh] bg-card rounded border border-border"
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={stopEvent}
        />
      ) : (
        <img
          src={url}
          alt={title}
          draggable={false}
          className="max-w-[95vw] max-h-[95vh] object-contain select-none transition-transform duration-100 will-change-transform"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: zoom >= MAX_ZOOM ? 'zoom-out' : zoom > 1 ? 'grab' : 'zoom-in',
          }}
          onPointerDown={onImgPointerDown}
          onPointerMove={onImgPointerMove}
          onPointerUp={onImgPointerUp}
          onPointerCancel={onImgPointerUp}
          onClick={onImgClick}
        />
      )}
    </div>,
    document.body,
  );
}
