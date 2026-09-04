import { Loader2, Reply, MessageCircleReply, Phone, Quote, Copy, Sparkles, Forward, AlertTriangle, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Barra de ações de UMA mensagem do chat interno da equipe.
 *
 * O chat interno é a mesma função em todo o sistema (conversa direta, grupo,
 * ficha de lead/atividade/caso/processo/POP e conversa do WhatsApp): o
 * repertório e a ordem das ações saem daqui, não de cada painel. Ação que não
 * faz sentido no contexto simplesmente não recebe o callback e some da barra.
 */
export interface ChatMessageActionsProps {
  /** Mensagem do próprio usuário — só nelas aparece o "alertar de novo". */
  isMe: boolean;
  /** Responder citando a mensagem no mesmo chat (vira reply_to_id). */
  onReply?: () => void;
  /** Responder no privado: abre a conversa direta com quem escreveu. */
  onPrivateReply?: () => void;
  /** Título do "responder no privado" (traz o nome de quem escreveu). */
  privateReplyTitle?: string;
  /**
   * Ligar por voz para quem escreveu. A chamada abre no card global
   * (CallOverlay), por cima da ficha — ninguém sai da tela onde estava.
   */
  onCall?: () => void;
  /** Título do "ligar" (traz o nome de quem escreveu). */
  callTitle?: string;
  /** Citar o texto no rascunho ("> …"), sem vínculo de resposta. */
  onQuote?: () => void;
  onCopy?: () => void;
  /** Sugerir resposta a esta mensagem com IA. */
  onAI?: () => void;
  onForward?: () => void;
  /** Reenviar como urgente: alerta o destinatário de novo. */
  onAlertAgain?: () => void;
  onCreateActivity?: () => void;
  /** Mostra o spinner no botão de atividade enquanto a IA monta o rascunho. */
  creatingActivity?: boolean;
  /**
   * `inside` = barra dentro da bolha (painéis estreitos: ficha, WhatsApp);
   * `outside` = ao lado da bolha, como no Chat da Equipe.
   */
  placement?: 'inside' | 'outside';
  className?: string;
}

export function ChatMessageActions({
  isMe,
  onReply,
  onPrivateReply,
  privateReplyTitle,
  onCall,
  callTitle,
  onQuote,
  onCopy,
  onAI,
  onForward,
  onAlertAgain,
  onCreateActivity,
  creatingActivity,
  placement = 'outside',
  className,
}: ChatMessageActionsProps) {
  const inside = placement === 'inside';

  // Ordem única em todo o sistema — quem usa o chat encontra o botão no mesmo
  // lugar, seja na ficha, no WhatsApp ou no Chat da Equipe.
  const actions = [
    isMe && onAlertAgain && {
      key: 'alert',
      icon: AlertTriangle,
      label: 'Alertar',
      title: 'Reenviar como urgente (alerta o destinatário de novo)',
      tone: 'danger' as const,
      run: onAlertAgain,
    },
    onReply && {
      key: 'reply',
      icon: Reply,
      label: 'Responder',
      title: 'Responder esta mensagem',
      run: onReply,
    },
    onPrivateReply && {
      key: 'private',
      icon: MessageCircleReply,
      label: 'No privado',
      title: privateReplyTitle || 'Responder no privado (abre a conversa direta com quem escreveu)',
      run: onPrivateReply,
    },
    onCall && {
      key: 'call',
      icon: Phone,
      label: 'Ligar',
      title: callTitle || 'Ligar por voz para quem escreveu',
      run: onCall,
    },
    onQuote && {
      key: 'quote',
      icon: Quote,
      label: 'Citar',
      title: 'Citar o texto desta mensagem no rascunho',
      run: onQuote,
    },
    onCopy && {
      key: 'copy',
      icon: Copy,
      label: 'Copiar',
      title: 'Copiar o texto da mensagem',
      run: onCopy,
    },
    onAI && {
      key: 'ai',
      icon: Sparkles,
      label: 'IA',
      title: 'Sugerir resposta a esta mensagem com IA',
      tone: 'primary' as const,
      run: onAI,
    },
    onForward && {
      key: 'forward',
      icon: Forward,
      label: 'Encaminhar',
      title: 'Encaminhar para outra pessoa ou grupo',
      run: onForward,
    },
    onCreateActivity && {
      key: 'activity',
      icon: creatingActivity ? Loader2 : ClipboardList,
      label: 'Atividade',
      title: 'Criar atividade a partir desta mensagem (a IA preenche, você revisa)',
      busy: creatingActivity,
      run: onCreateActivity,
    },
  ].filter(Boolean) as {
    key: string;
    icon: typeof Reply;
    label: string;
    title: string;
    tone?: 'danger' | 'primary';
    busy?: boolean;
    run: () => void;
  }[];

  if (actions.length === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center transition-opacity',
        inside
          ? 'flex-wrap gap-0.5 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        className
      )}
    >
      {actions.map(({ key, icon: Icon, label, title, tone, busy, run }) => (
        <button
          key={key}
          type="button"
          title={title}
          aria-label={label}
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); run(); }}
          className={cn(
            'rounded transition-colors disabled:opacity-60',
            inside
              ? 'p-1 hover:bg-black/10 dark:hover:bg-white/10'
              : 'p-1 hover:bg-accent',
            tone === 'danger'
              ? 'text-destructive'
              : tone === 'primary'
                ? 'text-primary'
                : inside && isMe
                  ? 'text-primary-foreground/80'
                  : 'text-muted-foreground'
          )}
        >
          <Icon className={cn(inside ? 'h-3 w-3' : 'h-3.5 w-3.5', busy && 'animate-spin')} />
        </button>
      ))}
    </div>
  );
}
