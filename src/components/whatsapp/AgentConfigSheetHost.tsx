import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { subscribeToAgentConfigSheet } from '@/lib/agentConfigSheet';

/**
 * Painel lateral de configuração do agente, aberto de dentro da conversa.
 *
 * É a MESMA tela de Configurações → Agentes IA, não uma versão reduzida: prompt,
 * documento, follow-up (inclusive a 1ª mensagem proativa), automações, conversas
 * e o chat de teste. Ter uma segunda tela de agente seria duas configurações
 * para manter e dois lugares onde procurar o mesmo campo.
 *
 * Carregada sob demanda — a tela de agentes é pesada e quase ninguém abre.
 */
const WhatsAppCommandConfig = lazy(() =>
  import('@/components/whatsapp/WhatsAppCommandConfig').then((m) => ({ default: m.WhatsAppCommandConfig }))
);

export function AgentConfigSheetHost() {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToAgentConfigSheet(({ agentId: id }) => {
        setAgentId(id ?? null);
        setOpen(true);
      }),
    []
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        // Acima da pilha de avisos (z-120 do sonner): o painel pode ser aberto
        // pelo popup de notificação, e abrir atrás dele seria inútil.
        className="w-full sm:max-w-3xl z-[200] p-4"
        overlayClassName="z-[190]"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">Agentes IA</SheetTitle>
          <SheetDescription className="text-xs">
            Ajuste o agente sem sair da conversa. O que você salvar aqui vale em todo o sistema.
          </SheetDescription>
        </SheetHeader>

        {open && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            }
          >
            <WhatsAppCommandConfig focusAgentId={agentId} />
          </Suspense>
        )}
      </SheetContent>
    </Sheet>
  );
}
