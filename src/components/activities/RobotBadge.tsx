import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isRobotActivity, robotActivityLabel, type ActivityRobotFields } from '@/lib/activityRobot';

interface RobotBadgeProps {
  activity: ActivityRobotFields | null | undefined;
  /** 'icon' = só o robô (listas apertadas). 'full' = robô + palavra "Robô". */
  variant?: 'icon' | 'full';
  className?: string;
}

/**
 * Símbolo do robô na atividade: aparece só quando o banco diz que um robô a
 * criou (ver `src/lib/activityRobot.ts`). Inline, nunca sobreposto ao título —
 * o texto da atividade continua 100% legível.
 */
export function RobotBadge({ activity, variant = 'icon', className }: RobotBadgeProps) {
  if (!isRobotActivity(activity)) return null;
  const label = robotActivityLabel(activity) || 'Criada automaticamente por robô';
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium',
        'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
        className,
      )}
    >
      <Bot className="h-3 w-3 shrink-0" />
      {variant === 'full' && <span>Robô</span>}
    </span>
  );
}

export default RobotBadge;
