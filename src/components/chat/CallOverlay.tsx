import { useEffect, useRef } from 'react';
import { useCall } from '@/contexts/CallContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase() || '?';
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Overlay global da ligação de voz do chat interno. Fica montado no layout
 * autenticado e só aparece quando há chamada (recebendo / discando / em curso).
 */
export function CallOverlay() {
  const {
    status, remoteName, muted, durationSec, remoteStream,
    acceptCall, rejectCall, hangup, toggleMute,
  } = useCall();

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch(() => { /* autoplay pode exigir gesto; ok */ });
    }
  }, [remoteStream]);

  if (status === 'idle') {
    return <audio ref={audioRef} autoPlay className="hidden" />;
  }

  const name = remoteName || 'Membro da equipe';
  const isIncoming = status === 'incoming';
  const isCalling = status === 'calling';
  const isConnected = status === 'connected';

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />
      <div className="fixed bottom-4 right-4 z-[100] w-72 rounded-2xl border bg-card shadow-2xl p-4 animate-in slide-in-from-bottom-4">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {isIncoming && <><PhoneIncoming className="h-3.5 w-3.5 text-primary" /> Ligação recebida</>}
            {isCalling && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chamando…</>}
            {isConnected && <><Phone className="h-3.5 w-3.5 text-green-600" /> Em chamada</>}
          </div>

          <Avatar className={cn('h-16 w-16', (isIncoming || isCalling) && 'animate-pulse')}>
            <AvatarFallback className="text-lg bg-primary/20 text-primary">{getInitials(name)}</AvatarFallback>
          </Avatar>

          <div>
            <p className="font-semibold leading-tight">{name}</p>
            <p className="text-sm font-mono text-muted-foreground mt-0.5">
              {isConnected ? fmt(durationSec) : isIncoming ? 'quer falar com você' : 'aguardando…'}
            </p>
            {isConnected && (
              <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-red-600">
                <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" /> gravando
              </p>
            )}
          </div>

          {isIncoming ? (
            <div className="flex items-center gap-6 mt-1">
              <button
                type="button"
                onClick={rejectCall}
                className="flex flex-col items-center gap-1"
                title="Recusar"
              >
                <span className="h-12 w-12 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center">
                  <PhoneOff className="h-5 w-5" />
                </span>
                <span className="text-[10px] text-muted-foreground">Recusar</span>
              </button>
              <button
                type="button"
                onClick={acceptCall}
                className="flex flex-col items-center gap-1"
                title="Atender"
              >
                <span className="h-12 w-12 rounded-full bg-green-600 text-white flex items-center justify-center animate-bounce">
                  <Phone className="h-5 w-5" />
                </span>
                <span className="text-[10px] text-muted-foreground">Atender</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 mt-1">
              {isConnected && (
                <Button
                  size="icon"
                  variant={muted ? 'destructive' : 'outline'}
                  onClick={toggleMute}
                  className="h-11 w-11 rounded-full"
                  title={muted ? 'Ativar microfone' : 'Silenciar'}
                >
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
              )}
              <Button
                size="icon"
                variant="destructive"
                onClick={hangup}
                className="h-11 w-11 rounded-full"
                title="Desligar"
              >
                <PhoneOff className="h-5 w-5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
