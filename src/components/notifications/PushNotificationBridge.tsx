import { lazy, Suspense, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare } from 'lucide-react';
import { TeamNotificationToast } from '@/components/chat/TeamNotificationToast';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';
import { abrirMovimentacaoSheet } from '@/lib/movimentacaoSheet';
import { enviarRespostaRapida } from '@/lib/whatsappQuickReply';

// Sugestão de IA e agente da conversa só carregam quando um aviso de WhatsApp
// aparece — a ponte fica montada no app inteiro, não pode arrastar o diálogo de
// IA para o bundle inicial.
const WhatsAppSuggestReplyButton = lazy(() =>
  import('@/components/notifications/WhatsAppToastActions').then((m) => ({ default: m.WhatsAppSuggestReplyButton }))
);
const WhatsAppToastAgentToggle = lazy(() =>
  import('@/components/notifications/WhatsAppToastActions').then((m) => ({ default: m.WhatsAppToastAgentToggle }))
);
const WhatsAppSugestaoAutomatica = lazy(() =>
  import('@/components/notifications/WhatsAppToastActions').then((m) => ({ default: m.WhatsAppSugestaoAutomatica }))
);

/**
 * Ponte entre o service worker de push e o app.
 *
 * Resolve dois buracos que vinham do mesmo lugar — o push-sw achar que conseguia
 * mexer nas abas sozinho:
 *
 *  1. CLIQUE NA NOTIFICAÇÃO. O SW mandava `client.navigate(url)`, que rejeita
 *     porque as páginas do app não são controladas por ele (escopo /push-sw/).
 *     Com o app aberto o clique só trazia a aba pra frente e nada abria. Agora o
 *     SW manda a URL por postMessage e quem decide o destino é aqui.
 *
 *  2. AVISO COM O SISTEMA ABERTO. No Windows o balão do Chrome cai direto na
 *     Central de Notificações e passa batido. O SW repassa o payload e o aviso
 *     aparece DENTRO do WhatsJUD, com o mesmo popup do chat de equipe.
 *
 * Mensagem de WhatsApp abre a conversa na folha (de cima pra baixo, sem sair da
 * página e sem descartar os popups). Qualquer outra URL de push (chat de
 * equipe, funil) navega normal — essas também estavam mortas pelo mesmo motivo.
 */

const MUTE_KEY = 'wa-push-toast-mute';

type MuteMap = Record<string, number>;

function readMutes(): MuteMap {
  try {
    const raw = localStorage.getItem(MUTE_KEY);
    return raw ? (JSON.parse(raw) as MuteMap) : {};
  } catch {
    return {};
  }
}

function isMuted(key: string): boolean {
  const until = readMutes()[key];
  return typeof until === 'number' && until > Date.now();
}

function muteConversation(key: string, minutes: number | null) {
  try {
    const mutes = readMutes();
    // `null` = até reativar. Uma data absurdamente longe evita um caso especial.
    mutes[key] = minutes === null ? Date.now() + 1000 * 60 * 60 * 24 * 365 : Date.now() + minutes * 60_000;
    localStorage.setItem(MUTE_KEY, JSON.stringify(mutes));
  } catch {
    /* silêncio é preferência, não pode quebrar nada */
  }
}

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  urgent?: boolean;
}

export type PushTarget =
  | { kind: 'whatsapp'; phone: string; instanceName: string | null }
  | { kind: 'movimentacao'; updateId: string; processId: string | null }
  | { kind: 'route'; to: string }
  | null;

/**
 * Decide o destino de uma URL de push. Mensagem de WhatsApp abre a conversa na
 * folha; movimentação processual abre o painel de baixo pra cima; o resto (chat
 * de equipe, funil) navega. URL quebrada não faz nada.
 */
export function parsePushTarget(rawUrl: string | undefined, origin: string): PushTarget {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return null;
  }

  const phone = url.searchParams.get('openChat');
  if (phone) {
    return { kind: 'whatsapp', phone, instanceName: url.searchParams.get('instance') };
  }

  // Movimentação processual: painel por cima da tela atual. Navegar para o
  // kanban do lead (o que a URL antiga fazia) tirava a pessoa de onde ela
  // estava e ainda escondia a movimentação que motivou o aviso.
  const updateId = url.searchParams.get('openUpdate');
  if (updateId) {
    return { kind: 'movimentacao', updateId, processId: url.searchParams.get('processo') };
  }

  return { kind: 'route', to: `${url.pathname}${url.search}` };
}

export function PushNotificationBridge() {
  const navigate = useNavigate();

  /** Leva a pessoa até o destino da notificação. */
  const openUrl = useCallback(
    (rawUrl: string | undefined, contactName?: string | null) => {
      const target = parsePushTarget(rawUrl, window.location.origin);
      if (!target) return;

      if (target.kind === 'whatsapp') {
        openWhatsAppChatSheet({
          phone: target.phone,
          instanceName: target.instanceName,
          contactName,
        });
        return;
      }

      if (target.kind === 'movimentacao') {
        abrirMovimentacaoSheet({ processId: target.processId, updateId: target.updateId });
        return;
      }

      navigate(target.to);
    },
    [navigate]
  );

  const showInAppToast = useCallback(
    (payload: PushPayload) => {
      const url = payload.url || '';
      // Só mensagem de WhatsApp. Chat de equipe e afins já têm popup próprio
      // vindo do realtime — repassar aqui viraria aviso em dobro.
      if (!url.includes('openChat=')) return;
      // Na inbox do WhatsApp a conversa já está na tela.
      if (window.location.pathname.startsWith('/whatsapp')) return;

      const key = payload.tag || url;
      if (isMuted(key)) return;

      // Conversa por trás do aviso: é o que permite responder, pedir a sugestão
      // da IA e mexer no agente sem abrir o chat.
      const target = parsePushTarget(url, window.location.origin);
      const conversa = target?.kind === 'whatsapp' ? target : null;
      const contato = payload.title || null;

      toast.custom(
        (toastId) => (
          <TeamNotificationToast
            toastId={toastId}
            icon={<MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
            title={payload.title || 'Mensagem nova'}
            context="WhatsApp"
            preview={payload.body || 'Nova mensagem'}
            onOpen={() => openUrl(url, payload.title)}
            onMuteForMinutes={(minutes) => muteConversation(key, minutes)}
            onReply={
              conversa
                ? (text) =>
                    enviarRespostaRapida({
                      phone: conversa.phone,
                      instanceName: conversa.instanceName,
                      message: text,
                    })
                : undefined
            }
            composerHint={
              conversa
                ? ({ setReply }) => (
                    <Suspense fallback={null}>
                      <WhatsAppSugestaoAutomatica
                        phone={conversa.phone}
                        instanceName={conversa.instanceName}
                        contactName={contato}
                        onApply={setReply}
                      />
                    </Suspense>
                  )
                : undefined
            }
            composerActions={
              conversa
                ? ({ setReply }) => (
                    <Suspense fallback={null}>
                      <WhatsAppSuggestReplyButton
                        phone={conversa.phone}
                        instanceName={conversa.instanceName}
                        contactName={contato}
                        onApply={setReply}
                      />
                    </Suspense>
                  )
                : undefined
            }
            footerActions={
              conversa?.instanceName ? (
                <Suspense fallback={null}>
                  <WhatsAppToastAgentToggle phone={conversa.phone} instanceName={conversa.instanceName} />
                </Suspense>
              ) : undefined
            }
            // Relógio do próprio popup: com resposta sendo digitada ou diálogo da
            // IA aberto, o do sonner fechava a janela no meio do trabalho.
            autoCloseMs={12_000}
          />
        ),
        { id: key, duration: Infinity, position: 'top-center' }
      );
    },
    [openUrl]
  );

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'push-notification-click') openUrl(data.url, data.title);
      else if (data.type === 'push-received') showInAppToast((data.payload || {}) as PushPayload);
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [openUrl, showInAppToast]);

  return null;
}
