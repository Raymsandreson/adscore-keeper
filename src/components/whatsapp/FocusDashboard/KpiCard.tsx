import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  badge?: ReactNode;
  tone: 'blue' | 'green' | 'purple' | 'amber';
  progress?: number; // 0..1
  icon?: ReactNode;
  onClick?: () => void;
}

const TONES: Record<KpiCardProps['tone'], { bg: string; text: string; bar: string; ring: string }> = {
  blue:   { bg: 'bg-blue-50 dark:bg-blue-950/30',     text: 'text-blue-700 dark:text-blue-300',     bar: 'bg-blue-500',   ring: 'ring-blue-200 dark:ring-blue-900' },
  green:  { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500', ring: 'ring-emerald-200 dark:ring-emerald-900' },
  purple: { bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-300', bar: 'bg-violet-500', ring: 'ring-violet-200 dark:ring-violet-900' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-950/30',   text: 'text-amber-700 dark:text-amber-300',   bar: 'bg-amber-500',  ring: 'ring-amber-200 dark:ring-amber-900' },
};

export function KpiCard({ label, value, unit, hint, badge, tone, progress, icon, onClick }: KpiCardProps) {
  const t = TONES[tone];
  return (
    <Card
      className={cn(
        'p-3 border-0 transition-all',
        t.bg,
        onClick && 'cursor-pointer hover:ring-2 hover:scale-[1.01]',
        t.ring
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <div className={cn('flex items-center gap-1.5 text-xs font-semibold', t.text)}>
          {icon}
          {label}
        </div>
        {badge}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-3xl font-bold tabular-nums leading-none', t.text)}>{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-background/60 overflow-hidden">
          <div className={cn('h-full transition-all', t.bar)} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {hint && <div className="text-[11px] text-muted-foreground mt-1.5">{hint}</div>}
    </Card>
  );
}
