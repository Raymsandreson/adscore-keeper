import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { ListChecks } from 'lucide-react';

interface Props {
  leadId: string;
  onClick: () => void;
}

interface ChecklistInstanceRow {
  id: string;
  items: any;
  is_readonly: boolean;
}

/**
 * Compact progress bar shown above the chat header.
 * Aggregates all non-readonly checklist items of the lead and shows % completed.
 * Click opens the lead side panel (where phases / objectives / steps live).
 */
export function WhatsAppLeadProgressBar({ leadId, onClick }: Props) {
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('lead_checklist_instances')
      .select('id, items, is_readonly')
      .eq('lead_id', leadId);

    const rows = (data as ChecklistInstanceRow[] | null) || [];
    let d = 0, t = 0;
    for (const r of rows) {
      if (r.is_readonly) continue;
      const items = Array.isArray(r.items) ? r.items : [];
      t += items.length;
      d += items.filter((i: any) => i?.checked).length;
    }
    setDone(d);
    setTotal(t);
  }, [leadId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`lead-progress-${leadId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_checklist_instances', filter: `lead_id=eq.${leadId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [leadId, load]);

  if (total === 0) return null;

  const pct = Math.round((done / total) * 100);
  const isComplete = pct === 100;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 bg-card border-b hover:bg-accent/40 transition-colors"
      title="Clique para ver fases, objetivos e passos"
    >
      <ListChecks className="h-3.5 w-3.5 text-primary shrink-0" />
      <span className="text-[10px] font-medium text-muted-foreground shrink-0">
        Progresso
      </span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isComplete ? 'bg-green-500' : 'bg-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn(
        'text-[10px] font-semibold tabular-nums shrink-0',
        isComplete ? 'text-green-600' : 'text-primary'
      )}>
        {pct}% · {done}/{total}
      </span>
    </button>
  );
}
