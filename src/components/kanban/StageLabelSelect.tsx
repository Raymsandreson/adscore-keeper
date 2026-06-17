/**
 * Seletor de etiqueta UazAPI vinculada à etapa do Kanban.
 *
 * Duas variantes:
 *   - 'card'   → ícone Tag num Popover compacto, encaixa no canto do card
 *   - 'dialog' → Select full-width, encaixa no LeadEditDialog
 *
 * Ao mudar:
 *   1. dispara apply-stage-label (que aplica/remove no WA em todas as inst do contato)
 *   2. front também atualiza leads.status (move o card no Kanban)
 *   3. em erro, reverte a UI e mostra toast
 */
import { useState } from 'react';
import { Tag, Loader2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cloudFunctions } from '@/lib/functionRouter';
import { db } from '@/integrations/supabase';
import { useStageLabelMappings } from '@/hooks/useStageLabelMappings';

interface Props {
  leadId: string;
  boardId: string;
  currentStageId: string | null | undefined;
  variant?: 'card' | 'dialog';
  onStageChanged?: (newStageId: string) => void;
}

export function StageLabelSelect({ leadId, boardId, currentStageId, variant = 'card', onStageChanged }: Props) {
  const { data, isLoading } = useStageLabelMappings(boardId);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const stages = data?.stages || [];
  const current = stages.find((s) => s.stage_id === currentStageId);

  async function apply(newStageId: string) {
    if (!newStageId || newStageId === currentStageId || busy) return;
    setBusy(true);
    const oldStageId = currentStageId || null;
    try {
      // 1) Atualiza coluna localmente
      const { error: updErr } = await db.from('leads').update({ status: newStageId, updated_at: new Date().toISOString() } as any).eq('id', leadId);
      if (updErr) throw updErr;
      onStageChanged?.(newStageId);

      // 2) Dispara sincronização no WhatsApp
      const { data: resp, error } = await cloudFunctions.invoke<any>('apply-stage-label', {
        body: { lead_id: leadId, board_id: boardId, new_stage_id: newStageId, old_stage_id: oldStageId },
      });
      if (error || !resp?.success) {
        // Reverte
        await db.from('leads').update({ status: oldStageId } as any).eq('id', leadId);
        if (oldStageId) onStageChanged?.(oldStageId);
        const msg = resp?.error || error?.message || 'Falha desconhecida';
        toast.error(`Falha ao sincronizar etiqueta no WhatsApp. ${msg}`);
      } else {
        const okCount = (resp.results || []).filter((r: any) => r?.added?.ok).length;
        toast.success(`Etiqueta aplicada em ${okCount} instância(s) do WhatsApp`);
      }
      setOpen(false);
    } catch (e: any) {
      toast.error(`Erro: ${e?.message || 'inesperado'}`);
    } finally {
      setBusy(false);
    }
  }

  if (variant === 'dialog') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Tag className="h-3.5 w-3.5" /> Etiqueta WhatsApp (etapa)
          {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <Select disabled={isLoading || busy} value={currentStageId || ''} onValueChange={apply}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder={isLoading ? 'Carregando…' : 'Selecione a etapa/etiqueta'} />
          </SelectTrigger>
          <SelectContent>
            {stages.map((s) => (
              <SelectItem key={s.stage_id} value={s.stage_id}>
                <span className="flex items-center gap-2">
                  {s.synced ? <Check className="h-3 w-3 text-emerald-500" /> : <AlertCircle className="h-3 w-3 text-amber-500" />}
                  {s.stage_name}
                  {s.result_key && <span className="text-xs text-muted-foreground">(global)</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stages.length === 0 && !isLoading && (
          <p className="text-xs text-muted-foreground">Nenhuma etiqueta sincronizada. Use "Sincronizar etiquetas" nas configurações do board.</p>
        )}
      </div>
    );
  }

  // variant === 'card'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => e.stopPropagation()}
              data-no-card-click
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3 text-muted-foreground" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Etiqueta WhatsApp{current ? `: ${current.stage_name}` : ''}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-2" onClick={(e) => e.stopPropagation()} align="end">
        <div className="text-xs font-medium px-1 pb-1">Mudar etiqueta no WhatsApp</div>
        <div className="max-h-72 overflow-y-auto">
          {isLoading && <div className="text-xs text-muted-foreground p-2">Carregando…</div>}
          {!isLoading && stages.length === 0 && (
            <div className="text-xs text-muted-foreground p-2">Nenhuma etiqueta sincronizada neste board.</div>
          )}
          {stages.map((s) => {
            const isCurrent = s.stage_id === currentStageId;
            return (
              <button
                key={s.stage_id}
                disabled={busy || isCurrent}
                onClick={() => apply(s.stage_id)}
                className={`w-full text-left text-sm rounded px-2 py-1.5 flex items-center gap-2 hover:bg-muted/60 ${isCurrent ? 'bg-muted font-medium' : ''}`}
              >
                {s.synced ? <Check className="h-3 w-3 text-emerald-500 shrink-0" /> : <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />}
                <span className="flex-1 truncate">{s.stage_name}</span>
                {s.result_key && <span className="text-[10px] text-muted-foreground">global</span>}
                {isCurrent && <span className="text-[10px] text-emerald-600">atual</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
