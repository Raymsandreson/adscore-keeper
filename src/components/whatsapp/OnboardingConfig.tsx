import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileSignature, Users, Bell } from 'lucide-react';
import { BoardGroupInstancesConfig } from './BoardGroupInstancesConfig';
import { FunnelZapsignDefaultsConfig } from './FunnelZapsignDefaultsConfig';

const TABS = ['procuracao', 'grupo', 'notificacoes'] as const;
type TabKey = (typeof TABS)[number];

export function OnboardingConfig() {
  const [tab, setTab] = useState<TabKey>('procuracao');
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollEndTimer = useRef<number | null>(null);

  // Center the active tab trigger in the TabsList
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-state="active"]`);
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [tab]);

  // When tab changes (via click), scroll the content carousel to the matching panel
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const idx = TABS.indexOf(tab);
    const target = container.children[idx] as HTMLElement | undefined;
    if (!target) return;
    isProgrammaticScroll.current = true;
    container.scrollTo({ left: target.offsetLeft, behavior: 'smooth' });
    // Release the lock once the scroll likely settled
    window.setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 500);
  }, [tab]);

  // When the user swipes the content, detect snap settle and update the tab
  const handleScroll = () => {
    if (isProgrammaticScroll.current) return;
    const container = contentRef.current;
    if (!container) return;
    if (scrollEndTimer.current) window.clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = window.setTimeout(() => {
      const width = container.clientWidth;
      if (width === 0) return;
      const idx = Math.round(container.scrollLeft / width);
      const next = TABS[Math.max(0, Math.min(TABS.length - 1, idx))];
      if (next && next !== tab) setTab(next);
    }, 120);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure tudo o que acontece automaticamente quando um lead vira caso. As configurações são por funil.
      </p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
        <div className="sticky top-0 z-10 -mx-4 px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
          <TabsList
            ref={listRef as any}
            className="w-full sm:w-auto inline-flex sm:grid sm:grid-cols-3 h-auto p-1 bg-muted/50 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 sm:snap-none scroll-smooth"
          >
            <TabsTrigger
              value="procuracao"
              className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-fuchsia-500/10 data-[state=active]:text-fuchsia-600 dark:data-[state=active]:text-fuchsia-400"
            >
              <FileSignature className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Procuração</span>
            </TabsTrigger>
            <TabsTrigger
              value="grupo"
              className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-violet-500/10 data-[state=active]:text-violet-600 dark:data-[state=active]:text-violet-400"
            >
              <Users className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Grupo</span>
            </TabsTrigger>
            <TabsTrigger
              value="notificacoes"
              className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-yellow-500/10 data-[state=active]:text-yellow-600 dark:data-[state=active]:text-yellow-400"
            >
              <Bell className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Notificações</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Swipeable content carousel — all panels rendered, snap-x to keep them aligned */}
        <div
          ref={contentRef}
          onScroll={handleScroll}
          className="mt-4 flex overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth -mx-4 px-4 sm:mx-0 sm:px-0"
        >
          <div className="snap-center shrink-0 w-full pr-4 sm:pr-0">
            <FunnelZapsignDefaultsConfig />
          </div>
          <div className="snap-center shrink-0 w-full pr-4 sm:pr-0">
            <BoardGroupInstancesConfig />
          </div>
          <div className="snap-center shrink-0 w-full pr-4 sm:pr-0">
            <div className="border rounded-lg p-8 text-center bg-muted/20">
              <Bell className="h-10 w-10 text-yellow-500 mx-auto mb-3 opacity-60" />
              <p className="text-sm text-muted-foreground">
                Em breve — alertas e mensagens automáticas pós-assinatura serão centralizados aqui.
                <br />
                Por enquanto, use os toggles dentro de <strong>Procuração</strong>.
              </p>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
