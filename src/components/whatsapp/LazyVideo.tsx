import { useState } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LazyVideoProps {
  src: string;
  mimeType?: string;
  className?: string;
  posterClassName?: string;
}

/**
 * Video que NÃO faz nenhum request até o usuário clicar em Play.
 * Substituição direta para <video controls preload="metadata"> — economiza
 * ~500KB-2MB de egress por vídeo que aparece na viewport mas nunca é tocado.
 */
export function LazyVideo({ src, mimeType, className, posterClassName }: LazyVideoProps) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <video
        controls
        autoPlay
        className={className}
        preload="metadata"
      >
        <source src={src} type={mimeType || 'video/mp4'} />
      </video>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      className={cn(
        'relative flex items-center justify-center bg-black/70 hover:bg-black/80 transition-colors rounded-lg group',
        posterClassName || className || 'w-[240px] h-[160px]',
      )}
      aria-label="Reproduzir vídeo"
    >
      <div className="flex flex-col items-center gap-1 text-white">
        <div className="w-12 h-12 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center">
          <Play className="h-6 w-6 fill-white ml-0.5" />
        </div>
        <span className="text-[10px] opacity-80">Toque para carregar</span>
      </div>
    </button>
  );
}
