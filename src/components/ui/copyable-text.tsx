import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CopyableTextProps {
  /** The text displayed */
  children: React.ReactNode;
  /** The value copied to clipboard (defaults to children if string) */
  copyValue?: string;
  /** Label shown in the toast, e.g. "Telefone" */
  label?: string;
  /** Extra classes on the wrapper */
  className?: string;
  /** If true, shows an inline copy icon on hover */
  showIcon?: boolean;
  /** HTML tag to render, defaults to span */
  as?: 'span' | 'p' | 'div';
  /** Truncate with ellipsis */
  truncate?: boolean;
  /** If true, prevents CallFace extension from detecting as phone number */
  noPhoneDetect?: boolean;
}

export function CopyableText({
  children,
  copyValue,
  label,
  className,
  showIcon = true,
  as: Tag = 'span',
  truncate = false,
  noPhoneDetect = false,
}: CopyableTextProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const value = copyValue || (typeof children === 'string' ? children : '');
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast.success(`${label || 'Texto'} copiado!`, { duration: 1500 });
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      toast.error('Erro ao copiar');
    });
  }, [copyValue, children, label]);

  return (
    <Tag
      onClick={handleCopy}
      title={`Clique para copiar${label ? ` ${label}` : ''}`}
      className={cn(
        'inline-flex items-center gap-1 cursor-pointer rounded px-0.5 -mx-0.5 transition-colors hover:bg-accent group/copy',
        truncate && 'truncate',
        className
      )}
    >
      <span className={cn(truncate && 'truncate')}>{children}</span>
      {showIcon && (
        copied ? (
          <Check className="h-3 w-3 text-green-500 shrink-0" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity shrink-0" />
        )
      )}
    </Tag>
  );
}
