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
 * Na própria /whatsapp o drawer não entra: ali a conversa abre na inbox, pelos
 * parâmetros `?openChat=&instance=` que a página já sabia consumir.
 */
const DashboardChatPreview = lazy(() =>
  import('@/components/whatsapp/DashboardChatPreview').then((m) => ({ default: m.DashboardChatPreview }))
);

interface OpenChat {
  phone: string;
  contactName: string | null;
  instanceName: string | null;
}

export function WhatsAppChatSheetHost() {
  const [chat, setChat] = useState<OpenChat | null>(null);
  const [, setSearchParams] = useSearchParams();

  useEffect(
    () =>
      subscribeToWhatsAppChatSheet(({ phone, instanceName, contactName }) => {
        if (window.location.pathname.startsWith('/whatsapp')) {
          const params = new URLSearchParams(window.location.search);
          params.set('openChat', phone);
          if (instanceName) params.set('instance', instanceName);
          else params.delete('instance');
          setSearchParams(params, { replace: true });
          setChat(null);
          return;
        }

        setChat({ phone, contactName: contactName ?? null, instanceName: instanceName ?? null });
      }),
    [setSearchParams]
  );

  if (!chat) return null;

  return (
    <Suspense fallback={null}>
      <DashboardChatPreview
        open
        onOpenChange={(open) => { if (!open) setChat(null); }}
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
