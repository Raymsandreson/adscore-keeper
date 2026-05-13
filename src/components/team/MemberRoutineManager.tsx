import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Loader2, Settings2, User, ChevronsUpDown, Check } from 'lucide-react';
import { ShareMenu } from '@/components/ShareMenu';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useTimeBlockSettings } from '@/hooks/useTimeBlockSettings';
import { TimeBlockSettingsDialog, TimeBlockConfig } from '@/components/activities/TimeBlockSettingsDialog';
import { RoutineCalendarGrid } from '@/components/activities/RoutineCalendarGrid';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useUserTeams } from '@/hooks/useUserTeams';
import { cn } from '@/lib/utils';

function MemberRoutineView({ userId, memberName }: { userId: string; memberName: string }) {
  const { configs, loading, saveSettings } = useTimeBlockSettings(userId);
  const { types: globalTypes } = useActivityTypes();
  const [editOpen, setEditOpen] = useState(false);
  const [localBlocks, setLocalBlocks] = useState<TimeBlockConfig[]>([]);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localBlocksRef = useRef<TimeBlockConfig[]>([]);
  localBlocksRef.current = localBlocks;

  // Sincroniza com DB só quando NÃO estamos editando localmente
  useEffect(() => {
    if (!dirtyRef.current) setLocalBlocks(configs);
  }, [configs]);

  const handleSave = (newConfigs: Parameters<typeof saveSettings>[0]) => saveSettings(newConfigs, userId);

  const scheduleSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await saveSettings(localBlocksRef.current, userId);
      dirtyRef.current = false;
    }, 700);
  };

  const onCreate = (b: TimeBlockConfig) => {
    dirtyRef.current = true;
    setLocalBlocks(prev => [...prev, b]);
    scheduleSave();
  };
  const onUpdate = (id: string, patch: Partial<TimeBlockConfig>) => {
    dirtyRef.current = true;
    setLocalBlocks(prev => prev.map(b => b.blockId === id ? { ...b, ...patch } : b));
    scheduleSave();
  };
  const onRemove = (id: string) => {
    dirtyRef.current = true;
    setLocalBlocks(prev => prev.filter(b => b.blockId !== id));
    scheduleSave();
  };

  const availableTypes = globalTypes.map(t => ({ key: t.key, label: t.label, color: t.color }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{memberName}</span>
        </div>
        <div className="flex items-center gap-1">
          <ShareMenu entityType="routine" entityId={userId} entityName={memberName} size="sm" variant="outline" />
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Editar Rotina
          </Button>
        </div>
      </div>

      {/* Calendário visual estilo Google Calendar — clicar/arrastar/estender */}
      <RoutineCalendarGrid
        blocks={localBlocks}
        availableTypes={availableTypes}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />

      {/* Resumo dos blocos — agrupado por tipo */}
      <div className="flex flex-wrap gap-2">
        {Array.from(new Set(configs.map(c => c.activityType))).map(key => {
          const typeBlocks = configs.filter(c => c.activityType === key);
          const c = typeBlocks[0];
          return (
            <Badge key={key} variant="outline" className="gap-1.5 text-xs">
              <span className={cn('h-2 w-2 rounded-full', c.color)} />
              {c.label}
              <span className="text-muted-foreground">
                {typeBlocks.length} bloco{typeBlocks.length > 1 ? 's' : ''}
              </span>
            </Badge>
          );
        })}
      </div>

      <TimeBlockSettingsDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        configs={configs}
        onSave={handleSave}
        targetUserId={userId}
      />
    </div>
  );
}

export function MemberRoutineManager() {
  const { members, loading } = useTeamMembers();
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedMember = members.find(m => m.user_id === selectedUserId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5" />
          Rotinas de Trabalho por Membro
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Visualize e edite os blocos de tempo da rotina semanal de cada colaborador.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            Selecionar membro:
          </label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="max-w-xs w-full justify-between font-normal">
                {selectedMember
                  ? (selectedMember.full_name || selectedMember.email || 'Sem nome')
                  : <span className="text-muted-foreground">Escolha um colaborador...</span>}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command
                filter={(value, search) => {
                  // value contains "name|email" lowercased
                  return value.includes(search.toLowerCase()) ? 1 : 0;
                }}
              >
                <CommandInput placeholder="Buscar por nome ou email..." />
                <CommandList>
                  <CommandEmpty>Nenhum membro encontrado.</CommandEmpty>
                  <CommandGroup>
                    {members.map(m => {
                      const name = m.full_name || m.email || 'Sem nome';
                      const value = `${name}|${m.email || ''}`.toLowerCase();
                      return (
                        <CommandItem
                          key={m.user_id}
                          value={value}
                          onSelect={() => setSelectedUserId(m.user_id)}
                        >
                          <Check className={cn('mr-2 h-4 w-4', selectedUserId === m.user_id ? 'opacity-100' : 'opacity-0')} />
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="truncate">{name}</span>
                            {m.email && m.email !== name && (
                              <span className="text-xs text-muted-foreground truncate">{m.email}</span>
                            )}
                            {m.role === 'admin' && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-auto">Admin</Badge>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {selectedUserId && selectedMember ? (
          <MemberRoutineView
            userId={selectedUserId}
            memberName={selectedMember.full_name || selectedMember.email || 'Colaborador'}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg bg-muted/5">
            <User className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Selecione um colaborador para ver e editar a rotina</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
