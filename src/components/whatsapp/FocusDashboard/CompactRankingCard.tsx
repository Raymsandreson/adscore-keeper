import { useEffect } from 'react';
import { Trophy, Users, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMyTeamRanking } from '@/hooks/useMyTeamRanking';
import { cn } from '@/lib/utils';

/**
 * Card compacto de ranking — aparece pra todos. Permite escolher time específico
 * ou ver agregado de todos os times.
 */
export function CompactRankingCard() {
  const { ranking, myPosition, myTeams, selectedTeamId, selectTeam, loading, fetchRanking } = useMyTeamRanking();

  useEffect(() => {
    fetchRanking();
  }, [fetchRanking]);

  const me = ranking.find(r => r.isCurrentUser);
  const total = ranking.length;
  const posLabel = myPosition ? `${myPosition}º` : '—';
  const top5 = ranking.slice(0, 5);

  const currentTeam = myTeams.find(t => t.teamId === selectedTeamId);
  const teamLabel = selectedTeamId === 'all' || !selectedTeamId
    ? 'Todos os times'
    : currentTeam?.teamName || 'Time';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex flex-col items-start justify-center gap-0.5 px-2.5 py-1.5 rounded-md border min-w-[78px] transition-colors',
            'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200/60 dark:border-yellow-900/40 text-yellow-800 dark:text-yellow-300',
            'hover:brightness-95 cursor-pointer'
          )}
        >
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
            <Trophy className="h-3 w-3" />
            Ranking
          </span>
          <span className="text-base font-bold tabular-nums leading-none">
            {posLabel}{total > 0 && <span className="opacity-60">/{total}</span>}
          </span>
          <span className="text-[10px] opacity-70 leading-none">
            {me ? `${me.totalPoints} pts` : 'hoje'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Trophy className="h-3 w-3" /> Top · hoje
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border bg-background hover:bg-muted transition-colors max-w-[150px]"
                title="Trocar time"
              >
                <Users className="h-3 w-3 shrink-0" />
                <span className="truncate">{teamLabel}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-auto">
              <DropdownMenuItem
                onClick={() => selectTeam('all')}
                className={cn('text-xs', selectedTeamId === 'all' && 'bg-primary/10 font-semibold')}
              >
                <Users className="h-3.5 w-3.5 mr-2" /> Todos os times
              </DropdownMenuItem>
              {myTeams.map(t => (
                <DropdownMenuItem
                  key={t.teamId}
                  onClick={() => selectTeam(t.teamId)}
                  className={cn('text-xs', selectedTeamId === t.teamId && 'bg-primary/10 font-semibold')}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full mr-2 shrink-0"
                    style={{ backgroundColor: t.teamColor }}
                  />
                  <span className="truncate">{t.teamName}</span>
                </DropdownMenuItem>
              ))}
              {myTeams.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-1.5">Nenhum time cadastrado</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {loading && <div className="text-xs text-muted-foreground px-1 py-2">Carregando…</div>}
        {!loading && top5.length === 0 && (
          <div className="text-xs text-muted-foreground px-1 py-2">Sem dados ainda</div>
        )}
        <div className="flex flex-col gap-0.5">
          {top5.map((e, idx) => (
            <div
              key={e.userId}
              className={cn(
                'flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs',
                e.isCurrentUser ? 'bg-primary/10 font-semibold' : 'hover:bg-muted/50'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn(
                  'w-4 text-center font-bold tabular-nums',
                  idx === 0 && 'text-yellow-600',
                  idx === 1 && 'text-gray-500',
                  idx === 2 && 'text-orange-600',
                )}>
                  {idx + 1}
                </span>
                <span className="truncate">{e.userName || 'Sem nome'}{e.isCurrentUser && ' (você)'}</span>
              </div>
              <span className="tabular-nums text-muted-foreground">{e.totalPoints}</span>
            </div>
          ))}
        </div>
        {me && myPosition && myPosition > 5 && (
          <>
            <div className="h-px bg-border my-1" />
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs bg-primary/10 font-semibold">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-4 text-center font-bold tabular-nums">{myPosition}</span>
                <span className="truncate">{me.userName || 'Você'} (você)</span>
              </div>
              <span className="tabular-nums text-muted-foreground">{me.totalPoints}</span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
