import { useState, useRef, type KeyboardEvent, type ReactNode, type TouchEvent } from 'react';
import { Loader2, Send, Clock, X, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
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
  count?: number;
  urgent?: boolean;
  /** Anexo da mensagem (para abrir/ver direto do popup) */
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  messageType?: string | null;
  onOpen: () => void | Promise<void>;
  onMuteForMinutes: (minutes: number | null) => void;
  onReply?: (reply: string) => Promise<void>;
  /** Chamado quando o usuário fecha o popup deliberadamente (X ou swipe) sem responder */
  onManualDismiss?: () => void;
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
  count,
  urgent,
  fileUrl,
  fileName,
  fileType,
  messageType,
  onOpen,
  onMuteForMinutes,
  onReply,
  onManualDismiss,
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
      onManualDismiss?.();
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
      className={`relative w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-background p-3 shadow-xl ${
        urgent ? 'border-destructive ring-2 ring-destructive/40' : 'border-border'
      }`}
    >
      <button
        type="button"
        onClick={() => {
          onManualDismiss?.();
          toast.dismiss(toastId);
        }}
        className="absolute top-1.5 right-1.5 p-1 rounded-md hover:bg-accent text-muted-foreground z-10"
        aria-label="Fechar notificação"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="flex w-full items-start gap-3 text-left pr-6"
      >
        <div className="mt-0.5 shrink-0 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            {(count ?? 0) > 1 && (
              <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {count}
              </span>
            )}
            {urgent && (
              <span className="shrink-0 h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center animate-pulse">
                🚨 URGENTE
              </span>
            )}
          </div>
          {context && (
            <p className="truncate text-xs text-muted-foreground">{context}</p>
          )}
          <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{preview}</p>
        </div>
      </button>

      {/* Anexo: abrir/ver direto do popup */}
      {fileUrl && (
        <div className="mt-2" onClick={(event) => event.stopPropagation()}>
          {messageType === 'image' ? (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <img src={fileUrl} alt={fileName || 'Imagem'} className="rounded-lg max-h-32 w-auto object-cover border border-border" />
            </a>
          ) : messageType === 'audio' ? (
            <audio controls preload="none" src={fileUrl} className="w-full h-9" />
          ) : (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 py-2 text-sm hover:bg-accent transition-colors"
            >
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate flex-1">{fileName || 'Abrir arquivo'}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          )}
        </div>
      )}

      {onReply && (
        <div className="mt-3 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <Input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Responder ou falar (microfone)..."
            className="h-8 text-sm"
          />
          <VoiceInputButton onResult={(text) => setReply(text)} append={false} />
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