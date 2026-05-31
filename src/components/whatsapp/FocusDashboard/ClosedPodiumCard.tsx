import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClosedLeadItem } from '@/hooks/useFocusDashboardData';

interface ClosedPodiumCardProps {
  closedLeads: ClosedLeadItem[];
  onClick?: () => void;
}

const PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export function ClosedPodiumCard({ closedLeads, onClick }: ClosedPodiumCardProps) {
  const counts = new Map<string, number>();
  closedLeads.forEach((l) => {
    const k = (l.acolhedor || '').trim() || 'Sem acolhedor';
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const arr = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  const tone = arr.length > 0
    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/40'
    : 'bg-muted/40 border-border';

  // Empty state — compacto, só ícone
  if (arr.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Pódio de fechados"
        className={cn(
          'flex flex-col items-center justify-center px-2 py-1 rounded-md border transition-colors hover:brightness-95 cursor-pointer text-muted-foreground',
          tone
        )}
      >
        <Trophy className="h-3.5 w-3.5 opacity-60" />
        <span className="text-[9px] mt-0.5 opacity-70">sem pódio</span>
      </button>
    );
  }

  const top3 = arr.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean) as [string, number][];
  const heights: Record<string, string> = {};
  const medals: Record<string, string> = {};
  if (top3[0]) { heights[top3[0][0]] = 'h-8'; medals[top3[0][0]] = '🥇'; }
  if (top3[1]) { heights[top3[1][0]] = 'h-6'; medals[top3[1][0]] = '🥈'; }
  if (top3[2]) { heights[top3[2][0]] = 'h-4'; medals[top3[2][0]] = '🥉'; }

  return (
    <button
      type="button"
      onClick={onClick}
      title={arr.map(([n, c]) => `${n}: ${c}`).join('\n')}
      className={cn(
        'flex items-end gap-0.5 px-1.5 py-1 rounded-md border transition-colors hover:brightness-95 cursor-pointer',
        tone
      )}
    >
      {podiumOrder.map(([name, n]) => {
        const colorIdx = arr.findIndex(([nm]) => nm === name);
        return (
          <div key={name} className="flex flex-col items-center w-9">
            <div className="text-[10px] leading-none">{medals[name]}</div>
            <div className="text-[9px] truncate w-full text-center font-medium text-foreground" title={name}>
              {name.split(' ')[0]}
            </div>
            <div
              className={cn(heights[name], 'w-full rounded-t-sm flex items-center justify-center text-white text-[9px] font-bold')}
              style={{ background: PALETTE[colorIdx % PALETTE.length] }}
            >
              {n}
            </div>
          </div>
        );
      })}
    </button>
  );
}
