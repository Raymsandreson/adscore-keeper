import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { subscribeToWhatsAppChatSheet } from '@/lib/whatsappChatSheet';

/**
 * A sessão inteira do WhatsApp numa folha que sobe de baixo pra cima.
 *
 * Monta o próprio WhatsAppInbox — não uma versão reduzida — pra que tudo que
 * existe na página (áudio, mídia, pendências, lead, ZapSign, chat de equipe,
 * busca) esteja ali sem duplicar fiação. É o que abre quando a pessoa clica na
 * notificação do sistema: a conversa aparece por cima da página em que ela já
 * estava, em vez de arrancá-la do que estava fazendo.
 *
 * A conversa é apontada pelos MESMOS parâmetros de URL que a página usa
 * (`?openChat=…&instance=…`) — o deep link do Inbox já sabe consumi-los e os
 * apaga em seguida.
 *
 * Lazy de propósito: o Inbox é o componente mais pesado do app e não pode
 * entrar no bundle de quem nunca abriu a folha.
 */
const WhatsAppInbox = lazy(() =>
  import('@/components/whatsapp/WhatsAppInbox').then((m) => ({ default: m.WhatsAppInbox }))
);

const SHEET_HEIGHT = '92dvh';
// O Inbox calcula a própria altura com `calc(100dvh - var(--app-header-offset))`.
// Dando a sobra da folha nessa variável ele se encaixa sem nenhuma alteração lá.
const SHEET_STYLE = { '--app-header-offset': '8dvh' } as CSSProperties;

export function WhatsAppChatSheetHost() {
  const [open, setOpen] = useState(false);
  const [, setSearchParams] = useSearchParams();

  const applyDeepLinkParams = useCallback(
    (phone: string, instanceName?: string | null) => {
      const params = new URLSearchParams(window.location.search);
      params.set('openChat', phone);
      if (instanceName) params.set('instance', instanceName);
      else params.delete('instance');
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  useEffect(
    () =>
      subscribeToWhatsAppChatSheet(({ phone, instanceName }) => {
        applyDeepLinkParams(phone, instanceName);
        // Na própria página do WhatsApp não faz sentido empilhar uma folha por
        // cima da inbox: quem consome o deep link ali é a página.
        if (window.location.pathname.startsWith('/whatsapp')) {
          setOpen(false);
          return;
        }
        setOpen(true);
      }),
    [applyDeepLinkParams]
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="p-0 overflow-hidden rounded-t-2xl border-t"
        style={{ ...SHEET_STYLE, height: SHEET_HEIGHT }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Conversa do WhatsApp</SheetTitle>
        </SheetHeader>
        {/* Só monta com a folha aberta — o Radix desmonta ao fechar, então o
            chunk do Inbox é baixado no primeiro uso e nunca antes. */}
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <WhatsAppInbox />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
