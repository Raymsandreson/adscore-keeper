import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { FileSignature, Users, Bell } from 'lucide-react';
import { BoardGroupInstancesConfig } from './BoardGroupInstancesConfig';
import { FunnelZapsignDefaultsConfig } from './FunnelZapsignDefaultsConfig';

export function OnboardingConfig() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure tudo o que acontece automaticamente quando um lead vira caso: geração da procuração,
        criação do grupo no WhatsApp e notificações pós-assinatura. As configurações são por funil.
      </p>

      <Accordion type="multiple" defaultValue={['procuracao']} className="space-y-3">
        <AccordionItem value="procuracao" className="border rounded-lg px-4 bg-card">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className="h-9 w-9 rounded-lg bg-fuchsia-500/10 flex items-center justify-center">
                <FileSignature className="h-5 w-5 text-fuchsia-500" />
              </div>
              <div>
                <div className="font-semibold text-sm">Procuração</div>
                <div className="text-xs text-muted-foreground">Modelo ZapSign, signatário, mensagem e anexos</div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-4">
            <FunnelZapsignDefaultsConfig />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="grupo" className="border rounded-lg px-4 bg-card">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <div className="font-semibold text-sm">Grupo do caso</div>
                <div className="text-xs text-muted-foreground">Instâncias, prefixo, sequência e campos no nome</div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-4">
            <BoardGroupInstancesConfig />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="notificacoes" className="border rounded-lg px-4 bg-card">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className="h-9 w-9 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Bell className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <div className="font-semibold text-sm">Notificações pós-assinatura</div>
                <div className="text-xs text-muted-foreground">Em breve — alertas e mensagens automáticas após o cliente assinar</div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-4">
            <p className="text-sm text-muted-foreground py-6 text-center">
              Configurações de notificação serão centralizadas aqui em breve. Por enquanto,
              os alertas pós-assinatura usam os toggles dentro de <strong>Procuração</strong>.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
