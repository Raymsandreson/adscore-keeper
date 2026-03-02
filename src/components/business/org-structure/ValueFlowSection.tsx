import { ReactNode } from 'react';

interface ValueFlowSectionProps {
  color: 'green' | 'blue' | 'amber';
  number: number;
  title: string;
  subtitle: string;
  children: ReactNode;
}

const colorMap = {
  green: {
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-500',
  },
  blue: {
    border: 'border-l-blue-500',
    bg: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    badge: 'bg-blue-500',
  },
  amber: {
    border: 'border-l-amber-500',
    bg: 'bg-amber-500/10',
    text: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500',
  },
};

export function ValueFlowSection({ color, number, title, subtitle, children }: ValueFlowSectionProps) {
  const c = colorMap[color];

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 p-4 rounded-lg border-l-4 ${c.border} ${c.bg}`}>
        <div className={`w-8 h-8 rounded-full ${c.badge} text-white flex items-center justify-center text-sm font-bold`}>
          {number}
        </div>
        <div>
          <h2 className={`text-lg font-bold ${c.text}`}>{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4 pl-2">
        {children}
      </div>
    </div>
  );
}
