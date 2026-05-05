import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileSignature, Users, Bell } from 'lucide-react';
import { BoardGroupInstancesConfig } from './BoardGroupInstancesConfig';
import { FunnelZapsignDefaultsConfig } from './FunnelZapsignDefaultsConfig';

export function OnboardingConfig() {
  const [tab, setTab] = useState('procuracao');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure tudo o que acontece automaticamente quando um lead vira caso. As configurações são por funil.
      </p>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full grid grid-cols-3 h-auto p-1 bg-muted/50 sticky top-0 z-10">
          <TabsTrigger
            value="procuracao"
            className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 py-2.5 px-2 data-[state=active]:bg-fuchsia-500/10 data-[state=active]:text-fuchsia-600 dark:data-[state=active]:text-fuchsia-400"
          >
            <FileSignature className="h-4 w-4 shrink-0" />
            <span className="text-xs sm:text-sm font-medium">Procuração</span>
          </TabsTrigger>
          <TabsTrigger
            value="grupo"
            className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 py-2.5 px-2 data-[state=active]:bg-violet-500/10 data-[state=active]:text-violet-600 dark:data-[state=active]:text-violet-400"
          >
            <Users className="h-4 w-4 shrink-0" />
            <span className="text-xs sm:text-sm font-medium">Grupo</span>
          </TabsTrigger>
          <TabsTrigger
            value="notificacoes"
            className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 py-2.5 px-2 data-[state=active]:bg-yellow-500/10 data-[state=active]:text-yellow-600 dark:data-[state=active]:text-yellow-400"
          >
            <Bell className="h-4 w-4 shrink-0" />
            <span className="text-xs sm:text-sm font-medium">Notificações</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="procuracao" className="mt-4">
          <FunnelZapsignDefaultsConfig />
        </TabsContent>

        <TabsContent value="grupo" className="mt-4">
          <BoardGroupInstancesConfig />
        </TabsContent>

        <TabsContent value="notificacoes" className="mt-4">
          <div className="border rounded-lg p-8 text-center bg-muted/20">
            <Bell className="h-10 w-10 text-yellow-500 mx-auto mb-3 opacity-60" />
            <p className="text-sm text-muted-foreground">
              Em breve — alertas e mensagens automáticas pós-assinatura serão centralizados aqui.
              <br />
              Por enquanto, use os toggles dentro de <strong>Procuração</strong>.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
