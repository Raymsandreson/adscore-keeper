import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, ListChecks, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActivityTypes } from '@/hooks/useActivityTypes';

interface Props {
  teamId: string;
}

/**
 * Lets an admin pick which activity types are exclusive to a team.
 * A type with empty `team_ids` is global (visible to everyone).
 * Adding a team to a type's `team_ids` restricts it to those teams.
 */
export function TeamActivityTypesPicker({ teamId }: Props) {
  const { types, loading, updateType } = useActivityTypes();
  const [expanded, setExpanded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const linkedTypes = types.filter(t => (t.team_ids || []).includes(teamId));

  const toggleType = async (typeId: string, currentTeamIds: string[]) => {
    const isLinked = currentTeamIds.includes(teamId);
    const newIds = isLinked
      ? currentTeamIds.filter(id => id !== teamId)
      : [...currentTeamIds, teamId];
    setSavingKey(typeId);
    await updateType(typeId, { team_ids: newIds });
    setSavingKey(null);
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 mb-1"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <ListChecks className="h-3.5 w-3.5" />
          Tipos de atividade do time
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {linkedTypes.length}
          </Badge>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="space-y-2">
          {linkedTypes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {linkedTypes.map(t => (
                <Badge key={t.id} variant="outline" className="gap-1.5 text-[11px]">
                  <span className={cn('h-2 w-2 rounded-full', t.color)} />
                  {t.label}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Nenhum tipo exclusivo. Membros deste time veem apenas os tipos globais.
            </p>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 w-full">
                <ListChecks className="h-3.5 w-3.5" />
                Gerenciar tipos do time
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <p className="text-xs font-semibold px-2 py-1.5">
                Tipos exclusivos deste time
              </p>
              <p className="text-[10px] text-muted-foreground px-2 pb-2">
                Tipos sem nenhum time aparecem para todos.
              </p>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[280px]">
                  <div className="space-y-0.5 pr-2">
                    {types.map(t => {
                      const teamIds = t.team_ids || [];
                      const isLinked = teamIds.includes(teamId);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleType(t.id, teamIds)}
                          disabled={savingKey === t.id}
                          className={cn(
                            'flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-left hover:bg-muted transition-colors',
                            isLinked && 'bg-primary/5'
                          )}
                        >
                          <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', t.color)} />
                          <span className="flex-1 truncate">{t.label}</span>
                          {teamIds.length > 0 && !isLinked && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                              {teamIds.length} time{teamIds.length > 1 ? 's' : ''}
                            </Badge>
                          )}
                          {teamIds.length === 0 && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                              global
                            </Badge>
                          )}
                          {savingKey === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : isLinked ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
