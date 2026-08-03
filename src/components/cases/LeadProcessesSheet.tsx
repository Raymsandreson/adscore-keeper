// =============================================================================
// Painel lateral com os processos vinculados a um caso/lead.
// Usado pela coluna "Processos" da auditoria de grupos (Contatos & Transmissão).
// Clicar num item abre a ficha completa (ProcessDetailSheet) por cima.
// =============================================================================
import { Suspense, lazy, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

// Mesmo padrão do TeamMarcoProcessosSheet: a ficha é pesada, entra sob demanda.
const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));

/** Campos leves da lista — o registro inteiro (com escavador_raw) só ao abrir a ficha. */
const LIST_FIELDS =
  'id, title, process_number, process_type, status, tribunal, situacao, workflow_name, created_at';

export interface LeadProcessesTarget {
  leadId: string;
  leadName?: string | null;
  caseNumber?: string | null;
  groupName?: string | null;
}

interface ProcessRow {
  id: string;
  title: string | null;
  process_number: string | null;
  process_type: string | null;
  status: string | null;
  tribunal: string | null;
  situacao: string | null;
  workflow_name: string | null;
  created_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  em_andamento: 'Em Andamento',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
};

const STATUS_CLASS: Record<string, string> = {
  em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  concluido: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  arquivado: 'bg-muted text-muted-foreground',
};

export function LeadProcessesSheet({ target, onClose }: {
  target: LeadProcessesTarget | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProcessRow[]>([]);
  const [loading, setLoading] = useState(false);
  /** Linha completa de lead_processes — o ProcessDetailSheet espera o registro inteiro. */
  const [openProcess, setOpenProcess] = useState<Record<string, unknown> | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const leadId = target?.leadId || null;

  useEffect(() => {
    if (!leadId) { setRows([]); return; }
    let cancelado = false;
    setLoading(true);
    (async () => {
      try {
        await ensureExternalSession();
        // Índice idx_lead_processes_lead_id_active cobre (lead_id) WHERE deleted_at IS NULL.
        const { data, error } = await externalSupabase
          .from('lead_processes')
          .select(LIST_FIELDS)
          .eq('lead_id', leadId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (!cancelado) setRows((data || []) as unknown as ProcessRow[]);
      } catch (e) {
        if (!cancelado) toast.error(e instanceof Error ? e.message : 'Erro ao listar processos');
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [leadId]);

  /** Abre a ficha completa do processo por cima da lista. */
  const abrirProcesso = async (processId: string) => {
    setOpeningId(processId);
    try {
      await ensureExternalSession();
      const { data, error } = await externalSupabase
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
      <Sheet open={!!target} onOpenChange={open => !open && onClose()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-base">
              Processos do caso {target?.caseNumber || ''}
            </SheetTitle>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {(target?.leadName || target?.groupName) && (
                <span className="text-xs text-muted-foreground">
                  {target?.leadName || target?.groupName}
                </span>
              )}
              {!loading && (
                <span className="text-xs text-muted-foreground">
                  · {rows.length} {rows.length === 1 ? 'processo' : 'processos'}
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
              Nenhum processo vinculado a este caso.
            </p>
          ) : (
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {rows.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className="flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/50"
                    onClick={() => abrirProcesso(r.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-words text-sm font-medium">
                        {r.title || r.process_number || 'Processo sem título'}
                      </span>
                      {openingId === r.id
                        ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                        : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </div>
                    {r.process_number && (
                      <span className="break-all font-mono text-[11px] text-muted-foreground">
                        {r.process_number}
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${STATUS_CLASS[r.status || ''] || 'bg-muted text-muted-foreground'}`}
                      >
                        {STATUS_LABEL[r.status || ''] || r.status || 'Sem status'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {r.process_type === 'administrativo' ? 'Administrativo' : 'Judicial'}
                      </Badge>
                      {r.workflow_name && (
                        <Badge variant="outline" className="text-[10px]">{r.workflow_name}</Badge>
                      )}
                    </div>
                    {(r.tribunal || r.situacao) && (
                      <span className="text-[11px] text-muted-foreground">
                        {[r.tribunal, r.situacao].filter(Boolean).join(' · ')}
                      </span>
                    )}
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
