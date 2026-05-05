import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Users, Bell, Video, Bot, Scale } from 'lucide-react';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { BoardGroupInstancesConfig } from './BoardGroupInstancesConfig';
import { FunnelZapsignDefaultsConfig } from './FunnelZapsignDefaultsConfig';
import { OnboardingMeetingConfig } from './OnboardingMeetingConfig';
import { OnboardingPostCloseConfig } from './OnboardingPostCloseConfig';
import { OnboardingCaseConfig } from './OnboardingCaseConfig';

const TABS = ['documentos', 'grupo', 'atendimento', 'caso', 'reuniao', 'notificacoes'] as const;
type TabKey = (typeof TABS)[number];

interface OnboardingConfigProps {
  /** Allows the "Editar agente" button on the Atendimento tab to switch to the Agentes tab in the parent. */
  onOpenAgents?: (agentId?: string) => void;
}

export function OnboardingConfig({ onOpenAgents }: OnboardingConfigProps = {}) {
  const [tab, setTab] = useState<TabKey>('documentos');
  const listRef = useRef<HTMLDivElement>(null);

  const { boards, loading: loadingBoards } = useKanbanBoards();
  const funnels = useMemo(() => boards.filter((b) => b.board_type === 'funnel'), [boards]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');

  useEffect(() => {
    if (!selectedBoardId && funnels.length > 0) setSelectedBoardId(funnels[0].id);
  }, [funnels, selectedBoardId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-state="active"]`);
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [tab]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure tudo o que acontece automaticamente quando um lead vira caso. As configurações são por funil.
      </p>

      <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
        <Label className="text-xs font-medium">Funil</Label>
        <Select value={selectedBoardId} onValueChange={setSelectedBoardId} disabled={loadingBoards}>
          <SelectTrigger>
            <SelectValue placeholder={loadingBoards ? 'Carregando funis…' : 'Escolha um funil'} />
          </SelectTrigger>
          <SelectContent>
            {funnels.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
        <div className="sticky top-0 z-10 -mx-4 px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
          <TabsList
            ref={listRef as any}
            className="w-full sm:w-auto inline-flex sm:grid sm:grid-cols-6 h-auto p-1 bg-muted/50 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 sm:snap-none scroll-smooth"
          >
            <TabsTrigger value="documentos" className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-fuchsia-500/10 data-[state=active]:text-fuchsia-600 dark:data-[state=active]:text-fuchsia-400">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Documentos</span>
            </TabsTrigger>
            <TabsTrigger value="grupo" className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-violet-500/10 data-[state=active]:text-violet-600 dark:data-[state=active]:text-violet-400">
              <Users className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Grupo</span>
            </TabsTrigger>
            <TabsTrigger value="atendimento" className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400">
              <Bot className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Atendimento</span>
            </TabsTrigger>
            <TabsTrigger value="reuniao" className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-600 dark:data-[state=active]:text-sky-400">
              <Video className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Reunião</span>
            </TabsTrigger>
            <TabsTrigger value="notificacoes" className="snap-center sm:snap-align-none flex items-center gap-2 py-2 px-3 whitespace-nowrap data-[state=active]:bg-yellow-500/10 data-[state=active]:text-yellow-600 dark:data-[state=active]:text-yellow-400">
              <Bell className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Notificações</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="mt-4">
          {tab === 'documentos' && (
            <FunnelZapsignDefaultsConfig boardId={selectedBoardId} hideBoardSelector section="documentos" />
          )}
          {tab === 'grupo' && (
            <div className="space-y-6">
              <FunnelZapsignDefaultsConfig boardId={selectedBoardId} hideBoardSelector section="grupo" hideSaveButton />
              <BoardGroupInstancesConfig boardId={selectedBoardId} hideBoardSelector />
            </div>
          )}
          {tab === 'atendimento' && selectedBoardId && (
            <OnboardingPostCloseConfig boardId={selectedBoardId} onOpenAgents={onOpenAgents} />
          )}
          {tab === 'reuniao' && selectedBoardId && (
            <OnboardingMeetingConfig boardId={selectedBoardId} />
          )}
          {tab === 'notificacoes' && (
            <FunnelZapsignDefaultsConfig boardId={selectedBoardId} hideBoardSelector section="notificacoes" />
          )}
        </div>
      </Tabs>
    </div>
  );
}
