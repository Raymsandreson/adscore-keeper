/**
 * Relatório em texto dos leads que sobraram do filtro (botão "Relatório" da
 * barra de filtros do funil).
 *
 * O recorte é buscado no servidor com os MESMOS filtros da tela — não com o
 * que o kanban tem em memória —, então o texto vale igual no kanban e na
 * lista, inclusive quando o filtro passa de uma página.
 */
import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Copy, Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { KanbanBoard } from '@/hooks/useKanbanBoards';
import type { LeadFilters } from '@/components/kanban/LeadAdvancedFilters';
import type { ListSort, QuickChips } from '@/hooks/useLeadListView';
import type { ProfileItem } from '@/hooks/useProfilesList';
import { gerarRelatorioLeadsFiltrados } from '@/lib/relatorioLeadsFiltrados';

interface LeadFilterReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Pick<KanbanBoard, 'id' | 'name' | 'stages'>;
  filters: LeadFilters;
  searchQuery: string;
  acolhedorFilter: string;
  checklistFilteredIds: Set<string> | null;
  chips: QuickChips;
  sort: ListSort;
  profiles: ProfileItem[];
}

export function LeadFilterReportDialog({
  open,
  onOpenChange,
  board,
  filters,
  searchQuery,
  acolhedorFilter,
  checklistFilteredIds,
  chips,
  sort,
  profiles,
}: LeadFilterReportDialogProps) {
  const [texto, setTexto] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // `filters`/`chips`/`sort` são objetos novos a cada render do pai: as chaves
  // serializadas abaixo é que dizem se a seleção mudou de verdade.
  const filtrosKey = JSON.stringify(filters);
  const chipsKey = JSON.stringify(chips);
  const sortKey = `${sort.key}.${sort.dir}`;
  const checklistKey = checklistFilteredIds?.size ?? -1;

  useEffect(() => {
    if (!open) return;
    let cancelado = false;

    const gerar = async () => {
      setLoading(true);
      setErro(null);
      try {
        const { texto: gerado, total: qtd } = await gerarRelatorioLeadsFiltrados({
          params: {
            boardId: board.id,
            searchQuery,
            acolhedorFilter,
            advancedFilters: filters,
            checklistFilteredIds,
            chips,
            sort,
            page: 0,
          },
          board,
          filtros: filters,
          searchQuery,
          acolhedorFilter,
          profiles,
        });
        if (cancelado) return;
        setTexto(gerado);
        setTotal(qtd);
      } catch (err: any) {
        if (cancelado) return;
        console.error('[LeadFilterReportDialog] falha ao gerar relatório:', err);
        setErro(err?.message || 'Erro ao gerar o relatório');
        setTexto('');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    gerar();
    return () => {
      cancelado = true;
    };
    // As chaves serializadas cobrem os objetos; incluir os próprios objetos
    // regeraria o relatório a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board.id, searchQuery, acolhedorFilter, filtrosKey, chipsKey, sortKey, checklistKey]);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('O navegador bloqueou a cópia — selecione o texto e copie à mão');
    }
  }, [texto]);

  const baixar = useCallback(() => {
    const blob = new Blob(['﻿' + texto], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (board.name || 'funil')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    a.href = url;
    a.download = `relatorio-${slug}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [texto, board.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Relatório dos leads filtrados
          </DialogTitle>
          <DialogDescription>
            {loading
              ? 'Buscando os leads que passam pelo filtro atual…'
              : erro
                ? 'Não foi possível gerar o relatório.'
                : `${total} ${total === 1 ? 'lead' : 'leads'} no recorte atual de ${board.name}.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Gerando relatório…
          </div>
        ) : erro ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {erro}
          </div>
        ) : (
          <ScrollArea className="h-[55vh] rounded-md border bg-muted/30">
            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">
              {texto}
            </pre>
          </ScrollArea>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" className="flex-1 gap-2" onClick={copiar} disabled={loading || !texto}>
            {copiado ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            {copiado ? 'Copiado!' : 'Copiar'}
          </Button>
          <Button variant="outline" className="flex-1 gap-2" onClick={baixar} disabled={loading || !texto}>
            <Download className="h-4 w-4" />
            Baixar .txt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
