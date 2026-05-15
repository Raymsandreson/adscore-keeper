import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface FocusActionCardProps {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  ctaLabel: string;
  ctaTone: 'orange' | 'olive' | 'red';
  onClick?: () => void;
  extra?: ReactNode;
}

const TONES = {
  orange: { card: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200/60 dark:border-orange-900/40', cta: 'bg-orange-600 hover:bg-orange-700 text-white' },
  olive:  { card: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-900/40', cta: 'bg-stone-700 hover:bg-stone-800 text-white' },
  red:    { card: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-900/40', cta: 'bg-rose-700 hover:bg-rose-800 text-white' },
};

export function FocusActionCard({ icon, title, badge, value, unit, hint, ctaLabel, ctaTone, onClick, extra }: FocusActionCardProps) {
  const t = TONES[ctaTone];
  return (
    <Card className={cn('p-3 border flex flex-col gap-2', t.card)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
          {icon}
          {title}
        </div>
        {badge}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      {extra}
      <Button size="sm" className={cn('w-full h-8 text-xs mt-auto', t.cta)} onClick={onClick}>
        {ctaLabel} →
      </Button>
    </Card>
  );
}
