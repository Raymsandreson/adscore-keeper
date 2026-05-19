import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import type { SyntheticEvent } from 'react';

interface MediaLightboxProps {
  url: string | null;
  title?: string;
  onClose: () => void;
}

export function MediaLightbox({ url, title = 'Visualização', onClose }: MediaLightboxProps) {
  if (!url || typeof document === 'undefined') return null;

  const isPdf = /\.pdf($|\?)/i.test(url);
  const stopEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return createPortal(
    <div
      data-media-lightbox="true"
      className="fixed inset-0 z-[1000] bg-background/95 flex items-center justify-center p-4 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 bg-card/80 hover:bg-card text-foreground border border-border rounded-full p-2 shadow-lg"
        title="Fechar"
        aria-label="Fechar visualização"
      >
        <X className="h-5 w-5" />
      </button>
      <a
        href={url}
        download
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onClick={stopEvent}
        className="absolute top-4 right-16 bg-card/80 hover:bg-card text-foreground border border-border rounded-full p-2 shadow-lg"
        title="Baixar"
        aria-label="Baixar arquivo"
      >
        <Download className="h-5 w-5" />
      </a>
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
          className="max-w-[95vw] max-h-[95vh] object-contain"
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={stopEvent}
        />
      )}
    </div>,
    document.body,
  );
}