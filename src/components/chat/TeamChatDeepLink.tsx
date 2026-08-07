import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { openTeamChatConversation } from '@/lib/teamChatPanelEvents';

export const TEAM_CHAT_PARAM = 'openTeamChat';

/**
 * Abre a conversa do chat interno quando a URL traz `?openTeamChat=<id>`.
 *
 * É o que faz o toque na notificação do celular cair na conversa certa: o
 * push-sw navega o app até esta URL, e aqui o intent global (o mesmo usado pelos
 * toasts) abre o painel na aba de chat. Antes o push mandava `url: '/'` e a
 * pessoa caía na home tendo que procurar a mensagem na mão.
 *
 * O parâmetro é removido depois de consumido para um refresh não reabrir sozinho.
 */
export function TeamChatDeepLink() {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const conversationId = searchParams.get(TEAM_CHAT_PARAM);
    if (!conversationId) return;

    openTeamChatConversation({ conversationId, focusComposer: true });

    const next = new URLSearchParams(searchParams);
    next.delete(TEAM_CHAT_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return null;
}
