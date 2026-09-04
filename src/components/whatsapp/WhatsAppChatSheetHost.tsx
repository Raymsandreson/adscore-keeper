import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { subscribeToWhatsAppChatSheet } from '@/lib/whatsappChatSheet';

/**
 * Abre a conversa apontada por uma notificação, de qualquer página do sistema.
 *
 * Usa o MESMO drawer que o resto do app (DashboardChatPreview): é o caminho
 * principal para tratar pendência, então não é uma versão capada da conversa —
 * tem histórico da equipe, resposta com IA, mídia, virar atividade, ZapSign.
 * Ter um segundo drawer só para a notificação seria duas conversas diferentes
 * para manter e dois visuais para a mesma coisa.
 *
 * Na própria /whatsapp o drawer não entra para NOTIFICAÇÃO: ali a conversa
 * abre na inbox, pelos parâmetros `?openChat=&instance=` que a página já sabia
 * consumir. Clique de lista (menções, relatório) manda `forceSheet` e abre o
 * painel do mesmo jeito — quem clicou de dentro de um painel aberto por cima
 * da inbox não quer a conversa trocando atrás dele.
 */
const DashboardChatPreview = lazy(() =>
  import('@/components/whatsapp/DashboardChatPreview').then((m) => ({ default: m.DashboardChatPreview }))
);

interface OpenChat {
  phone: string;
  contactName: string | null;
  instanceName: string | null;
  direction: 'top' | 'bottom';
}

export function WhatsAppChatSheetHost() {
  const [chat, setChat] = useState<OpenChat | null>(null);
  const [, setSearchParams] = useSearchParams();

  useEffect(
    () =>
      subscribeToWhatsAppChatSheet(({ phone, instanceName, contactName, direction, forceSheet }) => {
        if (!forceSheet && window.location.pathname.startsWith('/whatsapp')) {
          const params = new URLSearchParams(window.location.search);
          params.set('openChat', phone);
          if (instanceName) params.set('instance', instanceName);
          else params.delete('instance');
          setSearchParams(params, { replace: true });
          setChat(null);
          return;
        }

        setChat({
          phone,
          contactName: contactName ?? null,
          instanceName: instanceName ?? null,
          direction: direction ?? 'top',
        });
      }),
    [setSearchParams]
  );

  if (!chat) return null;

  return (
    <Suspense fallback={null}>
      <DashboardChatPreview
        open
        onOpenChange={(open) => { if (!open) setChat(null); }}
        // Notificação entra de cima pra baixo: mantém a pilha de popups
        // (top-center) à vista ACIMA do painel — o drawer começa abaixo dos
        // toasts (ver useTopToastStackHeight), então nenhum aviso cobre a
        // conversa e nenhum se perde. Clique em lista (menções) pede 'bottom',
        // o painel de baixo pra cima que é o padrão do sistema.
        direction={chat.direction}
        phone={chat.phone}
        contactName={chat.contactName}
        instanceName={chat.instanceName}
        // Metadados de SLA do cabeçalho: quem abre pela notificação não os tem,
        // e eles não travam nenhuma função — mesma escolha dos outros callers.
        hasLead={false}
        hasContact={false}
        wasResponded={false}
        responseTimeMinutes={null}
      />
    </Suspense>
  );
}
