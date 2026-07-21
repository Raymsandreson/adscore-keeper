import { useEffect, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { getTimeOffConflicts, describeTimeOff, type TimeOffEntry } from '@/lib/timeOff';

/**
 * Aviso inline no formulário de atividade: aparece quando o prazo escolhido
 * cai dentro de férias/compensação/folga registrada (aba Férias da equipe)
 * de algum dos responsáveis. O bloqueio de fato acontece no salvar
 * (useLeadActivities); aqui é só o alerta antecipado.
 */
export function TimeOffAssigneeWarning({ assignedIds, deadline }: {
  assignedIds: (string | null | undefined)[];
  deadline: string | null | undefined;
}) {
  const [conflicts, setConflicts] = useState<TimeOffEntry[]>([]);
  const idsKey = assignedIds.filter(Boolean).join(',');
  const day = (deadline || '').slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    if (!idsKey || !day) { setConflicts([]); return; }
    const t = setTimeout(async () => {
      const found = await getTimeOffConflicts(idsKey.split(','), day);
      if (!cancelled) setConflicts(found);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [idsKey, day]);

  if (conflicts.length === 0) return null;

  return (
    <div className="mt-1 flex items-start gap-1.5 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-1.5">
      <CalendarOff className="h-3 w-3 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      <p className="text-[10px] text-red-700 dark:text-red-300 leading-tight">
        {conflicts.map(c => `${c.user_name || 'Responsável'} estará em ${describeTimeOff(c)}`).join('; ')}.
        {' '}O sistema não vai deixar salvar com esse prazo — escolha outra data ou outro responsável.
      </p>
    </div>
  );
}
