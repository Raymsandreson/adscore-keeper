import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChevronRight, ListChecks, Loader2 } from 'lucide-react';
import { WhatsAppLeadStageManager } from './WhatsAppLeadStageManager';
import { cn } from '@/lib/utils';

interface WhatsAppLeadStageDrawerProps {
  leadId: string;
  boardId: string;
  currentStageId: string | null;
  onStageChanged?: () => void;
}

interface StageSummary {
  stageName: string;
  checked: number;
  total: number;
}

/**
 * Faixa fina (trigger) no topo do chat que abre um Sheet lateral direito
 * contendo o WhatsAppLeadStageManager completo.
 *
 * Objetivo: liberar espaço vertical do chat sem perder funcionalidade.
 */
export function WhatsAppLeadStageDrawer({
  leadId,
  boardId,
  currentStageId,
  onStageChanged,
}: WhatsAppLeadStageDrawerProps) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<StageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Carrega resumo: nome da fase atual + progresso agregado dos checklists ativos
  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      setLoading(true);
      try {
        const [boardRes, instancesRes] = await Promise.all([
          supabase.from('kanban_boards').select('stages').eq('id', boardId).single(),
          supabase
            .from('lead_checklist_instances')
            .select('items, stage_id, is_readonly, checklist_template_id, created_at')
            .eq('lead_id', leadId)
            .eq('board_id', boardId)
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        const stages = (boardRes.data?.stages as any[]) || [];
        const stageName =
          stages.find((s) => s.id === currentStageId)?.name || 'Sem fase';

        // Dedupe em memória: por (stage_id, template_id) mantém só a mais recente não-readonly
        const activeMap = new Map<string, any>();
        for (const inst of instancesRes.data || []) {
          if (inst.is_readonly) continue;
          if (inst.stage_id !== currentStageId) continue;
          const key = `${inst.stage_id}::${inst.checklist_template_id}`;
          if (!activeMap.has(key)) activeMap.set(key, inst);
        }

        let checked = 0;
        let total = 0;
        for (const inst of activeMap.values()) {
          const items = (inst.items as any[]) || [];
          total += items.length;
          checked += items.filter((i) => i.checked).length;
        }

        setSummary({ stageName, checked, total });
      } catch (e) {
        console.error('[WhatsAppLeadStageDrawer] load summary failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [leadId, boardId, currentStageId]);

  return (
    <>
      {/* Faixa fina trigger */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-2 w-full text-left',
          'px-3 py-1.5 border-t border-b bg-muted/30 hover:bg-muted/60',
          'transition-colors text-xs'
        )}
      >
        <ListChecks className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
          Fase:
        </span>
        <span className="font-semibold text-foreground truncate flex-1">
          {loading ? '…' : summary?.stageName || '—'}
        </span>
        {summary && summary.total > 0 && (
          <span
            className={cn(
              'text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0',
              summary.checked === summary.total
                ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                : 'bg-primary/10 text-primary'
            )}
          >
            {summary.checked}/{summary.total}
          </span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {/* Drawer lateral */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:w-[420px] sm:max-w-[420px] p-0 flex flex-col"
        >
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4 text-primary" />
              Fases & Checklists
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <WhatsAppLeadStageManager
              leadId={leadId}
              boardId={boardId}
              currentStageId={currentStageId}
              onStageChanged={onStageChanged}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
