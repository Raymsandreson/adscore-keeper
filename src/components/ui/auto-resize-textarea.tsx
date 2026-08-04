import * as React from 'react';
import { cn } from '@/lib/utils';

interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Altura máxima em px antes de virar rolagem interna. */
  maxHeight?: number;
}

/**
 * Campo de mensagem que cresce junto com o texto.
 *
 * Nasceu de uma queixa real: nos chats internos o campo era `<Input>` de uma
 * linha só, então quem escrevia um texto longo só enxergava o final dele.
 * Visualmente igual ao Input do design system quando tem uma linha, para não
 * mudar a cara dos rodapés já existentes.
 */
export const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ className, value, maxHeight = 160, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    React.useImperativeHandle(ref, () => innerRef.current!);

    React.useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = 'auto';
      const next = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }, [value, maxHeight]);

    return (
      <textarea
        ref={innerRef}
        value={value}
        rows={1}
        className={cn(
          'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug',
          'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);
AutoResizeTextarea.displayName = 'AutoResizeTextarea';
