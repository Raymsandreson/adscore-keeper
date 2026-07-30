// =============================================================================
// Lista os processos por trás de um número da tabela de marcos:
//   modo 'acumulado' → já passaram pelo marco (coluna "Até hoje")
//   modo 'atual'     → o marco é o estado mais recente (coluna "Atualmente")
// Abre por cima do formulário de metas; fechar devolve ao cadastro.
// =============================================================================
import { Suspense, lazy, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { db, ensureExternalSession } from '@/integrations/supabase';
import type { MarcoProcesso } from '@/hooks/useTeamProcessGoals';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

// Mesmo padrão do StageFunnelChart: a ficha do processo é pesada, entra sob demanda.
const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));

export interface MarcoDrill {
  teamId: string;
  marco: MarcoTipo;
  marcoLabel: string;
  modo: 'acumulado' | 'atual';
  esperado: number;
}

export function TeamMarcoProcessosSheet({ drill, onClose, fetchMarcoProcessos }: {
  drill: MarcoDrill | null;
  onClose: () => void;
  /** Vem do useTeamProcessGoals do pai — instanciar o hook aqui refaria todo o fetch. */
  fetchMarcoProcessos: (teamId: string, marco: string, modo: 'acumulado' | 'atual') => Promise<MarcoProcesso[]>;
}) {
  const [rows, setRows] = useState<MarcoProcesso[]>([]);
  const [loading, setLoading] = useState(false);
  /** Linha completa de lead_processes — o ProcessDetailSheet espera o registro inteiro. */
  const [openProcess, setOpenProcess] = useState<Record<string, unknown> | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!drill) { setRows([]); return; }
    let cancelado = false;
    setLoading(true);
    fetchMarcoProcessos(drill.teamId, drill.marco, drill.modo)
      .then(data => { if (!cancelado) setRows(data); })
      .catch(e => {
        if (!cancelado) toast.error(e instanceof Error ? e.message : 'Erro ao listar processos');
      })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [drill, fetchMarcoProcessos]);

  /** Abre a ficha completa do processo por cima da lista (sheet de baixo pra cima). */
  const abrirProcesso = async (processId: string) => {
    setOpeningId(processId);
    try {
      await ensureExternalSession();
      const { data, error } = await db
        .from('lead_processes')
        .select('*')
        .eq('id', processId)
        .maybeSingle();
      if (error) throw error;
      if (!data) { toast.error('Processo não encontrado'); return; }
      setOpenProcess(data as Record<string, unknown>);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir o processo');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <>
    <Sheet open={!!drill} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">{drill?.marcoLabel}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={drill?.modo === 'atual' ? 'secondary' : 'outline'} className="text-[10px]">
              {drill?.modo === 'atual' ? 'Atualmente neste marco' : 'Já passaram pelo marco'}
            </Badge>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? 'processo' : 'processos'}
              </span>
            )}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nenhum processo neste marco.
          </p>
        ) : (
          <ScrollArea className="flex-1">
            <div className="divide-y">
              {rows.map(r => (
                <button
                  key={r.process_id}
                  type="button"
                  className="flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => abrirProcesso(r.process_id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="break-words text-sm font-medium">
                      {r.title || r.lead_name || 'Processo sem título'}
                    </span>
                    {openingId === r.process_id
                      ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                  {r.lead_name && r.title && (
                    <span className="break-words text-[11px] text-muted-foreground">{r.lead_name}</span>
                  )}
                  {r.process_number && (
                    <span className="break-all font-mono text-[11px] text-muted-foreground">
                      {r.process_number}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {r.data_movimentacao && (
                      <span>{format(new Date(r.data_movimentacao), 'dd/MM/yyyy')}</span>
                    )}
                    <span>{r.responsavel || 'Sem responsável'}</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>

    {/* Ficha do processo: irmã do sheet da lista, não filha — evita disputa de foco
        entre dois Dialogs do Radix aninhados. */}
    <Suspense fallback={null}>
      {openProcess && (
        <ProcessDetailSheet
          open={!!openProcess}
          onOpenChange={open => { if (!open) setOpenProcess(null); }}
          process={openProcess}
          mode="sheet"
        />
      )}
    </Suspense>
    </>
  );
}
