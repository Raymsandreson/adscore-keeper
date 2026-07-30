// =============================================================================
// Lista os processos por trás de um número da tabela de marcos:
//   modo 'acumulado' → já passaram pelo marco (coluna "Até hoje")
//   modo 'atual'     → o marco é o estado mais recente (coluna "Atualmente")
// Abre por cima do formulário de metas; fechar devolve ao cadastro.
// =============================================================================
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { MarcoProcesso } from '@/hooks/useTeamProcessGoals';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

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
  const navigate = useNavigate();
  const [rows, setRows] = useState<MarcoProcesso[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
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
                  className="flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!r.case_id}
                  onClick={() => { if (r.case_id) { onClose(); navigate(`/cases/${r.case_id}`); } }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="break-words text-sm font-medium">
                      {r.lead_name || r.title || 'Sem nome'}
                    </span>
                    {r.case_id && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
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
  );
}
