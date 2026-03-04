import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ConfirmDialogDateFieldsProps {
  confirmNewActivity: any;
  setConfirmNewActivity: (fn: (prev: any) => any) => void;
}

export function ConfirmDialogDateFields({ confirmNewActivity, setConfirmNewActivity }: ConfirmDialogDateFieldsProps) {
  const [deadlineCount, setDeadlineCount] = useState<number | null>(null);
  const [notifCount, setNotifCount] = useState<number | null>(null);

  const assignedTo = confirmNewActivity?.assigned_to;
  const deadline = confirmNewActivity?.deadline;
  const notificationDate = confirmNewActivity?.notification_date;

  useEffect(() => {
    if (!assignedTo || !deadline) { setDeadlineCount(null); return; }
    const dateOnly = deadline.slice(0, 10);
    if (!dateOnly || dateOnly.length < 10) return;
    supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', assignedTo)
      .eq('deadline', dateOnly)
      .neq('status', 'concluida')
      .then(({ count }) => setDeadlineCount(count ?? 0));
  }, [assignedTo, deadline]);

  useEffect(() => {
    if (!assignedTo || !notificationDate) { setNotifCount(null); return; }
    const dateOnly = notificationDate.slice(0, 10);
    if (!dateOnly || dateOnly.length < 10) return;
    supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', assignedTo)
      .eq('notification_date', dateOnly)
      .neq('status', 'concluida')
      .then(({ count }) => setNotifCount(count ?? 0));
  }, [assignedTo, notificationDate]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="text-xs font-medium text-foreground cursor-help">📅 Prazo (execução) *</label>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                Data em que a atividade deve ser realizada/executada
              </TooltipContent>
            </Tooltip>
            {deadlineCount !== null && (
              <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${deadlineCount > 0 ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/30' : 'border-emerald-400 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'}`}>
                {deadlineCount} atv
              </Badge>
            )}
          </div>
          <Input
            type="datetime-local"
            value={deadline || ''}
            onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, deadline: e.target.value } : prev)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="text-xs font-medium text-foreground cursor-help">🔔 Notificação (aviso)</label>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                Data para enviar mensagem/aviso ao cliente ou beneficiário
              </TooltipContent>
            </Tooltip>
            {notifCount !== null && (
              <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${notifCount > 0 ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/30' : 'border-emerald-400 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'}`}>
                {notifCount} atv
              </Badge>
            )}
          </div>
          <Input
            type="datetime-local"
            value={notificationDate || ''}
            onChange={(e) => setConfirmNewActivity((prev: any) => prev ? { ...prev, notification_date: e.target.value } : prev)}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
