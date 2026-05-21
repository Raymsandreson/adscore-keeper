import * as React from "react";
import { cn } from "@/lib/utils";

interface ResizableSideProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Largura inicial em pixels (também usada como reset ao desmontar) */
  defaultWidth: number;
  /** Largura mínima permitida ao arrastar */
  minWidth?: number;
  /** Largura máxima permitida ao arrastar */
  maxWidth?: number;
  /** Lado em que a alça aparece. "right" = sidebar à esquerda (padrão); "left" = sidebar à direita */
  side?: "right" | "left";
  children: React.ReactNode;
}

/**
 * Painel lateral com alça de redimensionar (drag handle).
 * - Estado puramente local: ao desmontar (sair da página), o tamanho volta ao default.
 * - Sem localStorage / sem persistência (por design).
 */
export const ResizableSide = React.forwardRef<HTMLDivElement, ResizableSideProps>(
  (
    { defaultWidth, minWidth = 200, maxWidth = 800, side = "right", className, style, children, ...rest },
    ref
  ) => {
    const [width, setWidth] = React.useState<number>(defaultWidth);
    const draggingRef = React.useRef(false);
    const startXRef = React.useRef(0);
    const startWRef = React.useRef(defaultWidth);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWRef.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const signed = side === "right" ? delta : -delta;
      const next = Math.min(maxWidth, Math.max(minWidth, startWRef.current + signed));
      setWidth(next);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const onDoubleClick = () => setWidth(defaultWidth);

    return (
      <div
        ref={ref}
        className={cn("relative shrink-0", className)}
        style={{ width, ...style }}
        {...rest}
      >
        {children}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar painel (duplo clique para resetar)"
          title="Arraste para redimensionar • duplo clique reseta"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          className={cn(
            "absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize",
            "hover:bg-primary/40 active:bg-primary/60 transition-colors",
            side === "right" ? "-right-0.5" : "-left-0.5"
          )}
        />
      </div>
    );
  }
);
ResizableSide.displayName = "ResizableSide";
