import { useState, useRef, type KeyboardEvent, type ReactNode, type TouchEvent } from 'react';
import { Loader2, Send, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TeamNotificationToastProps {
  toastId: string | number;
  icon: ReactNode;
  title: string;
  context?: string;
  preview: string;
  onOpen: () => void | Promise<void>;
  onMuteForMinutes: (minutes: number | null) => void;
  onReply?: (reply: string) => Promise<void>;
}

const MUTE_OPTIONS = [
  { label: '15 minutos', minutes: 15 },
  { label: '30 minutos', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: 'Até eu reativar', minutes: null as number | null },
];

export function TeamNotificationToast({
  toastId,
  icon,
  title,
  context,
  preview,
  onOpen,
  onMuteForMinutes,
  onReply,
}: TeamNotificationToastProps) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  // Swipe-to-dismiss state
  const touchStartX = useRef<number | null>(null);
  const swipeOffset = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    if (containerRef.current) {
      containerRef.current.style.transition = 'none';
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    swipeOffset.current = dx;
    if (containerRef.current) {
      containerRef.current.style.transform = `translateX(${dx}px)`;
      containerRef.current.style.opacity = `${Math.max(0, 1 - Math.abs(dx) / 250)}`;
    }
  };

  const handleTouchEnd = () => {
    if (Math.abs(swipeOffset.current) > 100) {
      // Dismiss
      if (containerRef.current) {
        const dir = swipeOffset.current > 0 ? '100%' : '-100%';
        containerRef.current.style.transition = 'transform 200ms ease, opacity 200ms ease';
        containerRef.current.style.transform = `translateX(${dir})`;
        containerRef.current.style.opacity = '0';
      }
      setTimeout(() => toast.dismiss(toastId), 200);
    } else {
      // Snap back
      if (containerRef.current) {
        containerRef.current.style.transition = 'transform 200ms ease, opacity 200ms ease';
        containerRef.current.style.transform = 'translateX(0)';
        containerRef.current.style.opacity = '1';
      }
    }
    touchStartX.current = null;
    swipeOffset.current = 0;
  };

  const handleOpen = async () => {
    await onOpen();
    toast.dismiss(toastId);
  };

  const handleReply = async () => {
    if (!onReply || !reply.trim() || sending) return;

    try {
      setSending(true);
      await onReply(reply.trim());
      toast.success('Resposta enviada');
      toast.dismiss(toastId);
    } catch (error) {
      console.error('[TeamNotificationToast] Failed to send reply:', error);
      toast.error('Não foi possível enviar a resposta');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleReply();
    }
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-background p-3 shadow-xl"
    >
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="flex w-full items-start gap-3 text-left"
      >
        <div className="mt-0.5 shrink-0 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {context && (
            <p className="truncate text-xs text-muted-foreground">{context}</p>
          )}
          <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{preview}</p>
        </div>
      </button>

      {onReply && (
        <div className="mt-3 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <Input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Responder por aqui..."
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            className="h-8 shrink-0"
            onClick={() => void handleReply()}
            disabled={!reply.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1">
              <Clock className="h-3.5 w-3.5" />
              Silenciar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[200]">
            {MUTE_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.label}
                onClick={() => {
                  onMuteForMinutes(opt.minutes);
                  toast.dismiss(toastId);
                }}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void handleOpen()}>
          Abrir chat
        </Button>
      </div>
    </div>
  );
}