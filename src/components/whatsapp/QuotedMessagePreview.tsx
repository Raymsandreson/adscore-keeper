import {
  BarChart2, FileText, Image as ImageIcon, Loader2, MapPin, Mic, Sticker, User, Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QuotedKind, QuotedMessageInfo } from '@/lib/whatsappQuotedMessage';

const ICONES: Partial<Record<QuotedKind, typeof FileText>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  voice: Mic,
  document: FileText,
  sticker: Sticker,
  location: MapPin,
  contact: User,
  poll: BarChart2,
};

interface Props {
  quoted: QuotedMessageInfo;
  /** Nome de quem escreveu a mensagem citada, já resolvido pelo chat. */
  autor: string | null;
  /** Bolha verde (mensagem nossa) pede contraste próprio. */
  outbound: boolean;
  /** Ausente = citação sem alvo clicável (mensagem original nunca foi salva aqui). */
  onClick?: () => void;
  carregando?: boolean;
}

/**
 * O bloco de citação que o WhatsApp mostra no topo da bolha quando a mensagem
 * é resposta a outra — e que aqui também é o atalho para PULAR até a original
 * (era isso que faltava: sem ele, uma resposta "." aparecia sem contexto e sem
 * nada para clicar).
 */
export function QuotedMessagePreview({ quoted, autor, outbound, onClick, carregando }: Props) {
  const Icone = ICONES[quoted.kind];
  const previa = quoted.text || quoted.label || 'Mensagem';
  const clicavel = !!onClick && !carregando;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clicavel}
      title={clicavel ? 'Ir até a mensagem citada' : 'Mensagem citada'}
      className={cn(
        'w-full text-left flex gap-2 rounded-lg overflow-hidden mb-1.5 pr-2 py-1 transition-colors',
        outbound ? 'bg-white/15' : 'bg-muted/70',
        clicavel && (outbound ? 'hover:bg-white/25 cursor-pointer' : 'hover:bg-muted cursor-pointer'),
        !clicavel && 'cursor-default',
      )}
    >
      <span className={cn('w-1 shrink-0 self-stretch rounded-full', outbound ? 'bg-white/70' : 'bg-primary')} />
      <span className="min-w-0 flex-1 py-0.5">
        <span className={cn('block text-[11px] font-semibold truncate', outbound ? 'text-white/90' : 'text-primary')}>
          {autor || 'Mensagem citada'}
        </span>
        <span className={cn('flex items-center gap-1 text-[11px] leading-snug', outbound ? 'text-white/80' : 'text-muted-foreground')}>
          {carregando
            ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            : Icone && <Icone className="h-3 w-3 shrink-0" />}
          <span className="line-clamp-2 break-words">
            {quoted.text && quoted.label ? `${quoted.label}: ${quoted.text}` : previa}
          </span>
        </span>
      </span>
    </button>
  );
}
