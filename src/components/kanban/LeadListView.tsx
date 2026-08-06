// Visualização em LISTA do board de acolhimento — alternável com o kanban pelo
// toggle no header do UnifiedKanbanManager. Compartilha o MESMO estado de
// filtro/busca do kanban (recebido por props); dados, ordenação, paginação e
// contagens vêm do servidor via useLeadListView (view lead_list_view).
// Desktop: tabela com header sticky. Mobile (<768px): blocos de 2 linhas com
// bottom sheet de ordenação/filtros e seleção por long-press.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { differenceInDays, differenceInHours } from 'date-fns';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock,
  Download,
  Eye,
  Loader2,
  MessageCircle,
  MoreVertical,
  SlidersHorizontal,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShareMenu } from '@/components/ShareMenu';
import { StageLabelSelect } from '@/components/kanban/StageLabelSelect';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAcolhedores } from '@/hooks/useAcolhedores';
import { useStageLabelMappings } from '@/hooks/useStageLabelMappings';
import { LeadDistanceSuffix, LeadRegionThumb } from '@/components/leads/LeadRegionThumb';
import type { KanbanBoard } from '@/hooks/useKanbanBoards';
import type { LeadFilters } from '@/components/kanban/LeadAdvancedFilters';
import {
  useLeadListView,
  PAGE_SIZE,
  type LeadListRow,
  type ListSort,
  type ListSortKey,
  type QuickChips,
} from '@/hooks/useLeadListView';

// Mesmos rótulos/cores das colunas fixas do kanban (DynamicKanbanBoard).
const FIXED_STATUS: Record<string, { label: string; color: string }> = {
  closed: { label: 'Fechado', color: '#22c55e' },
  refused: { label: 'Recusado', color: '#ef4444' },
  inviavel: { label: 'Inviável', color: '#f59e0b' },
  cancelled: { label: 'Cancelado', color: '#a855f7' },
};

const SORT_LABELS: Record<ListSortKey, string> = {
  vitima: 'Vítima',
  empresa: 'Empresa',
  local: 'Local',
  estagio: 'Estágio',
  tempo_estagio: 'Tempo no estágio',
  data_acidente: 'Data do acidente',
  acolhedor: 'Acolhedor',
};

interface LeadListViewProps {
  board: KanbanBoard;
  searchQuery: string;
  acolhedorFilter: string;
  advancedFilters: LeadFilters;
  checklistFilteredIds: Set<string> | null;
  chips: QuickChips;
  onChipsChange: (chips: QuickChips) => void;
  sort: ListSort;
  onSortChange: (sort: ListSort) => void;
  onOpenLead: (leadId: string) => void;
  onMoveToStage: (leadId: string, stageId: string) => Promise<void>;
  onAssignAcolhedor: (leadId: string, acolhedor: string) => Promise<void>;
  onDeleteLead: (leadId: string) => Promise<void> | void;
}

function formatTempo(enteredIso: string): string {
  const totalHours = Math.max(0, differenceInHours(new Date(), new Date(enteredIso)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function agingDays(enteredIso: string): number {
  return Math.max(0, differenceInDays(new Date(), new Date(enteredIso)));
}

function agingClass(days: number): string {
  if (days >= 90) return 'text-red-600 font-medium';
  if (days >= 30) return 'text-amber-600';
  return 'text-muted-foreground';
}

function formatAccidentDate(date: string | null): string {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(csvEscape).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Executa fn para cada id com concorrência limitada; retorna {ok, fail}. */
async function runWithPool(
  ids: string[],
  fn: (id: string) => Promise<void>,
  concurrency = 3,
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        await fn(id);
        ok++;
      } catch (err) {
        console.error('[LeadListView] ação em massa falhou para', id, err);
        fail++;
      }
    }
  });
  await Promise.all(workers);
  return { ok, fail };
}

export function LeadListView({
  board,
  searchQuery,
  acolhedorFilter,
  advancedFilters,
  checklistFilteredIds,
  chips,
  onChipsChange,
  sort,
  onSortChange,
  onOpenLead,
  onMoveToStage,
  onAssignAcolhedor,
  onDeleteLead,
}: LeadListViewProps) {
  const isMobile = useIsMobile();
  const [page, setPage] = useState(0);
  const { resolve, ativos } = useAcolhedores();
  const { data: labelData } = useStageLabelMappings(board.id);

  const {
    rows,
    totalCount,
    stale90Count,
    loading,
    error,
    refresh,
    fetchAllFilteredIds,
    fetchAllFilteredRows,
  } = useLeadListView({
    boardId: board.id,
    searchQuery,
    acolhedorFilter,
    advancedFilters,
    checklistFilteredIds,
    chips,
    sort,
    page,
  });

  // Filtros/ordenação mudaram -> volta para a primeira página.
  const filterResetKey = JSON.stringify([
    board.id,
    searchQuery,
    acolhedorFilter,
    advancedFilters,
    chips,
    sort,
    checklistFilteredIds?.size ?? -1,
  ]);
  const prevResetKey = useRef(filterResetKey);
  useEffect(() => {
    if (prevResetKey.current !== filterResetKey) {
      prevResetKey.current = filterResetKey;
      setPage(0);
    }
  }, [filterResetKey]);

  // Mobile: acumula páginas ("carregar mais").
  const [accRows, setAccRows] = useState<LeadListRow[]>([]);
  useEffect(() => {
    if (!isMobile) return;
    setAccRows(prev => {
      if (page === 0) return rows;
      const seen = new Set(prev.map(r => r.id));
      return [...prev, ...rows.filter(r => !seen.has(r.id))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, isMobile]);
  const visibleRows = isMobile ? accRows : rows;

  // ---- Seleção múltipla -------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false); // mobile long-press

  useEffect(() => {
    // Mudou o conjunto filtrado: seleção anterior deixa de fazer sentido.
    setSelected(new Set());
    setAllFiltered(false);
    setSelectionMode(false);
  }, [filterResetKey]);

  const selectionCount = allFiltered ? totalCount : selected.size;

  const toggleRow = useCallback((id: string) => {
    setAllFiltered(false);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pageAllSelected =
    visibleRows.length > 0 && visibleRows.every(r => allFiltered || selected.has(r.id));

  const togglePage = useCallback(() => {
    setAllFiltered(false);
    setSelected(prev => {
      const next = new Set(prev);
      const all = visibleRows.every(r => next.has(r.id));
      visibleRows.forEach(r => (all ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }, [visibleRows]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAllFiltered(false);
    setSelectionMode(false);
  }, []);

  // ---- Ações em massa ---------------------------------------------------
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);

  const resolveSelectedIds = useCallback(async (): Promise<string[]> => {
    if (allFiltered) return fetchAllFilteredIds();
    return Array.from(selected);
  }, [allFiltered, selected, fetchAllFilteredIds]);

  const runBulk = useCallback(
    async (label: string, fn: (id: string) => Promise<void>) => {
      setBulkBusy(true);
      try {
        const ids = await resolveSelectedIds();
        setBulkProgress(`${label} (${ids.length} leads)…`);
        const { ok, fail } = await runWithPool(ids, fn);
        if (fail > 0) toast.warning(`${label}: ${ok} ok, ${fail} falharam`);
        else toast.success(`${label}: ${ok} leads atualizados`);
        clearSelection();
        refresh();
      } catch (err: any) {
        toast.error(`${label} falhou: ${err?.message || 'erro'}`);
      } finally {
        setBulkBusy(false);
        setBulkProgress('');
      }
    },
    [resolveSelectedIds, clearSelection, refresh],
  );

  const bulkMoveToStage = useCallback(
    (stageId: string) => {
      const stage = board.stages.find(s => s.id === stageId);
      setConfirmAction({
        title: 'Mover leads de estágio',
        description: `Mover ${selectionCount} lead(s) para "${stage?.name || stageId}"? Isso registra histórico, checklists e sincroniza a etiqueta do WhatsApp, como no kanban.`,
        run: () => runBulk('Mover para estágio', id => onMoveToStage(id, stageId)),
      });
    },
    [board.stages, selectionCount, runBulk, onMoveToStage],
  );

  const bulkAssignAcolhedor = useCallback(
    (nome: string) => {
      setConfirmAction({
        title: 'Atribuir acolhedor',
        description: `Atribuir "${nome}" a ${selectionCount} lead(s)?`,
        run: () => runBulk('Atribuir acolhedor', id => onAssignAcolhedor(id, nome)),
      });
    },
    [selectionCount, runBulk, onAssignAcolhedor],
  );

  const labelOptions = useMemo(
    () => (labelData?.stages || []).filter(s => s.synced && s.instances.length > 0),
    [labelData],
  );

  const bulkApplyLabel = useCallback(
    (stageId: string) => {
      const mapping = labelOptions.find(s => s.stage_id === stageId);
      const labelName = mapping?.instances[0]?.label_name || mapping?.stage_name || stageId;
      setConfirmAction({
        title: 'Aplicar etiqueta',
        description: `Aplicar a etiqueta "${labelName}" a ${selectionCount} lead(s)? O lead é movido para a etapa correspondente e a etiqueta é sincronizada no WhatsApp.`,
        run: () => runBulk('Aplicar etiqueta', id => onMoveToStage(id, stageId)),
      });
    },
    [labelOptions, selectionCount, runBulk, onMoveToStage],
  );

  const stageBadgeOf = useCallback(
    (row: LeadListRow): { label: string; color: string } => {
      if (row.lead_status && FIXED_STATUS[row.lead_status]) return FIXED_STATUS[row.lead_status];
      const stage = board.stages.find(s => s.id === row.status);
      return { label: stage?.name || row.status || '—', color: stage?.color || '#64748b' };
    },
    [board.stages],
  );

  const exportCsv = useCallback(async () => {
    setBulkBusy(true);
    setBulkProgress('Exportando CSV…');
    try {
      let data = await fetchAllFilteredRows();
      if (!allFiltered && selected.size > 0) {
        data = data.filter(r => selected.has(r.id));
      }
      const header = [
        'Vítima/Código',
        'Empresa',
        'Local',
        'Estágio',
        'Tempo no estágio',
        'Entrada no estágio',
        'Data do acidente',
        'Acolhedor',
        'Telefone',
        'Nº do caso',
        'Nome do lead',
      ];
      const lines = data.map(r => {
        const badge = stageBadgeOf(r);
        return [
          r.victim_name_trim || (r.lead_number ? `LEAD${r.lead_number}` : r.lead_name || ''),
          r.display_company || '',
          [r.display_city, r.display_state].filter(Boolean).join('/'),
          badge.label,
          formatTempo(r.stage_entered_at),
          new Date(r.stage_entered_at).toLocaleString('pt-BR'),
          formatAccidentDate(r.accident_date),
          r.acolhedor_trim || '',
          r.lead_phone || '',
          r.case_number || '',
          r.lead_name || '',
        ];
      });
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv([header, ...lines], `acolhimento_lista_${date}.csv`);
      toast.success(`CSV exportado (${lines.length} leads)`);
    } catch (err: any) {
      toast.error(`Exportação falhou: ${err?.message || 'erro'}`);
    } finally {
      setBulkBusy(false);
      setBulkProgress('');
    }
  }, [fetchAllFilteredRows, allFiltered, selected, stageBadgeOf]);

  // ---- Long-press (mobile) ---------------------------------------------
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const handleTouchStart = useCallback(
    (id: string) => {
      longPressFired.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        setSelectionMode(true);
        toggleRow(id);
        if (navigator.vibrate) navigator.vibrate(10);
      }, 500);
    },
    [toggleRow],
  );

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // ---- Renderização auxiliar -------------------------------------------
  const renderAvatar = useCallback(
    (row: LeadListRow, sizeClass: string) => {
      const info = resolve(row.acolhedor);
      if (!info) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-center gap-0.5">
                <Avatar className={sizeClass}>
                  <AvatarFallback className="bg-muted text-muted-foreground">
                    <User className="h-4 w-4" aria-hidden />
                  </AvatarFallback>
                </Avatar>
                <Badge variant="outline" className="text-[9px] px-1 py-0 leading-3 text-muted-foreground">
                  sem dono
                </Badge>
              </div>
            </TooltipTrigger>
            <TooltipContent>Sem acolhedor atribuído</TooltipContent>
          </Tooltip>
        );
      }
      const nome = info.acolhedor?.nome_canonico || row.acolhedor || '';
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Avatar className={sizeClass}>
              {info.fotoUrl && <AvatarImage src={info.fotoUrl} alt={nome} className="object-cover" />}
              <AvatarFallback
                className="text-[10px] text-white"
                style={{ backgroundColor: info.bgColor }}
              >
                {info.initials}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{nome}</TooltipContent>
        </Tooltip>
      );
    },
    [resolve],
  );

  const renderVictim = useCallback((row: LeadListRow, className = '') => {
    if (row.victim_name_trim) {
      return <span className={`font-semibold ${className}`}>{row.victim_name_trim}</span>;
    }
    const code = row.lead_number ? `LEAD${row.lead_number}` : row.lead_name || '—';
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <span className="italic text-muted-foreground">{code}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Vítima não identificada" />
          </TooltipTrigger>
          <TooltipContent>Vítima não identificada</TooltipContent>
        </Tooltip>
      </span>
    );
  }, []);

  const renderStageBadge = useCallback(
    (row: LeadListRow) => {
      const { label, color } = stageBadgeOf(row);
      return (
        <Badge
          variant="outline"
          className="font-normal whitespace-nowrap"
          style={{ backgroundColor: `${color}15`, borderColor: `${color}50`, color }}
        >
          <span
            className="mr-1 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          {label}
        </Badge>
      );
    },
    [stageBadgeOf],
  );

  const renderTempo = useCallback((row: LeadListRow) => {
    const days = agingDays(row.stage_entered_at);
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap ${agingClass(days)}`}>
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {formatTempo(row.stage_entered_at)}
        {days >= 90 && <AlertTriangle className="h-3.5 w-3.5" aria-label="Parado há mais de 90 dias" />}
      </span>
    );
  }, []);

  const renderRowMenu = useCallback(
    (row: LeadListRow) => (
      <div
        className="flex items-center justify-end gap-0.5"
        data-no-row-click
        onClick={e => e.stopPropagation()}
      >
        <ShareMenu
          entityType="lead"
          entityId={row.id}
          entityName={row.victim_name_trim || row.lead_name || undefined}
          size="icon"
          variant="ghost"
        />
        <StageLabelSelect
          leadId={row.id}
          boardId={board.id}
          currentStageId={row.status}
          variant="card"
          onStageChanged={() => refresh()}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais ações">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpenLead(row.id)}>
              <Eye className="h-4 w-4 mr-2" /> Visualizar
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Mover para fase</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {board.stages.map(stage => (
                  <DropdownMenuItem
                    key={stage.id}
                    disabled={stage.id === row.status}
                    onClick={() => onMoveToStage(row.id, stage.id).then(refresh)}
                  >
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: stage.color || '#3b82f6' }}
                      aria-hidden
                    />
                    {stage.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {row.lead_phone && (
              <DropdownMenuItem
                onClick={() =>
                  window.open(`https://wa.me/${row.lead_phone!.replace(/\D/g, '')}`, '_blank')
                }
              >
                <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600 focus:text-red-600"
              onClick={() =>
                setConfirmAction({
                  title: 'Remover lead',
                  description: `Remover "${row.victim_name_trim || row.lead_name || 'lead'}" do board? Ele vai para os arquivados (soft delete).`,
                  run: async () => {
                    await onDeleteLead(row.id);
                    refresh();
                  },
                })
              }
            >
              <Trash2 className="h-4 w-4 mr-2" /> Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
    [board.id, board.stages, onOpenLead, onMoveToStage, onDeleteLead, refresh],
  );

  const chipDefs: Array<{ key: keyof QuickChips; label: string }> = [
    { key: 'semAcolhedor', label: 'Sem acolhedor' },
    { key: 'parado90', label: 'Parado +90 dias' },
    { key: 'semVitima', label: 'Sem vítima identificada' },
  ];

  const chipsBar = (
    <div className="flex items-center gap-2 overflow-x-auto py-0.5">
      {chipDefs.map(({ key, label }) => (
        <Button
          key={key}
          size="sm"
          variant={chips[key] ? 'default' : 'outline'}
          className="h-8 rounded-full whitespace-nowrap"
          aria-pressed={chips[key]}
          onClick={() => onChipsChange({ ...chips, [key]: !chips[key] })}
        >
          {label}
        </Button>
      ))}
    </div>
  );

  const countsHeader = (
    <div className="text-sm text-muted-foreground" aria-live="polite">
      <span className="font-medium text-foreground">{totalCount} leads</span>
      {' · '}
      <span className={stale90Count > 0 ? 'text-red-600 font-medium' : ''}>
        {stale90Count} parados +90d
      </span>
      {loading && <Loader2 className="inline h-3.5 w-3.5 ml-2 animate-spin" aria-label="Carregando" />}
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const ariaSortFor = (key: ListSortKey): 'ascending' | 'descending' | 'none' =>
    sort.key !== key ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';

  const toggleSort = (key: ListSortKey) => {
    if (sort.key === key) onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else onSortChange({ key, dir: key === 'tempo_estagio' ? 'desc' : 'asc' });
  };

  const sortIcon = (key: ListSortKey) =>
    sort.key !== key ? (
      <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
    ) : sort.dir === 'asc' ? (
      <ArrowUp className="h-3 w-3" aria-hidden />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden />
    );

  const sortableHead = (key: ListSortKey, label: string, extraClass = '') => (
    <th scope="col" aria-sort={ariaSortFor(key)} className={`px-3 py-2 text-left font-medium ${extraClass}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => toggleSort(key)}
      >
        {label} {sortIcon(key)}
      </button>
    </th>
  );

  // ---- Barra de ações em massa -----------------------------------------
  const bulkBar = selectionCount > 0 && (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur p-2 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span className="text-sm font-medium whitespace-nowrap">
          {selectionCount} selecionado{selectionCount > 1 ? 's' : ''}
          {allFiltered ? ' (todos os filtrados)' : ''}
        </span>
        <Button variant="ghost" size="sm" className="h-8" onClick={clearSelection} disabled={bulkBusy}>
          <X className="h-3.5 w-3.5 mr-1" /> Limpar
        </Button>

        <Select onValueChange={bulkMoveToStage} disabled={bulkBusy} value="">
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Mover para estágio…" />
          </SelectTrigger>
          <SelectContent>
            {board.stages.map(stage => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={bulkAssignAcolhedor} disabled={bulkBusy || ativos.length === 0} value="">
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Atribuir acolhedor…" />
          </SelectTrigger>
          <SelectContent>
            {ativos.map(a => (
              <SelectItem key={a.id} value={a.nome_canonico}>
                {a.nome_canonico}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={bulkApplyLabel} disabled={bulkBusy || labelOptions.length === 0} value="">
          <SelectTrigger className="h-8 w-[170px]">
            <SelectValue placeholder="Aplicar etiqueta…" />
          </SelectTrigger>
          <SelectContent>
            {labelOptions.map(s => (
              <SelectItem key={s.stage_id} value={s.stage_id}>
                {s.instances[0]?.label_name || s.stage_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={bulkBusy}>
          <Download className="h-3.5 w-3.5 mr-1" /> Exportar CSV
        </Button>

        {bulkBusy && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {bulkProgress}
          </span>
        )}
      </div>
    </div>
  );

  const confirmDialog = (
    <AlertDialog open={!!confirmAction} onOpenChange={open => !open && setConfirmAction(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const action = confirmAction;
              setConfirmAction(null);
              action?.run();
            }}
          >
            Confirmar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (error) {
    return (
      <div className="rounded-md border p-6 text-center space-y-2">
        <p className="text-sm text-red-600">Erro ao carregar a lista: {error}</p>
        <p className="text-xs text-muted-foreground">
          Se a mensagem citar "lead_list_view", a migration da lista ainda não foi aplicada no banco.
        </p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  // ======================= MOBILE =======================
  if (isMobile) {
    return (
      <div className="space-y-2 pb-24">
        <div className="sticky top-0 z-20 -mx-1 bg-background px-1 py-2 space-y-2 border-b">
          <div className="flex items-center justify-between gap-2">
            {countsHeader}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <SlidersHorizontal className="h-4 w-4 mr-1" /> Ordenar/Filtrar
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Ordenação e filtros</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 py-3">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Ordenar por</p>
                    {(Object.keys(SORT_LABELS) as ListSortKey[]).map(key => (
                      <button
                        key={key}
                        type="button"
                        className={`flex w-full min-h-[44px] items-center justify-between rounded-md border px-3 text-sm ${
                          sort.key === key ? 'border-primary bg-primary/5 font-medium' : ''
                        }`}
                        onClick={() => toggleSort(key)}
                      >
                        {SORT_LABELS[key]}
                        {sort.key === key &&
                          (sort.dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />)}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Filtros rápidos</p>
                    {chipsBar}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
          {selectionMode && (
            <div className="flex items-center justify-between text-sm">
              <span>{selectionCount} selecionado(s)</span>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Cancelar seleção
              </Button>
            </div>
          )}
        </div>

        <div role="list" aria-label="Leads do board em lista">
          {visibleRows.map(row => {
            const isSelected = allFiltered || selected.has(row.id);
            return (
              <div
                key={row.id}
                role="listitem"
                className={`flex min-h-[72px] items-center gap-2 border-b px-2 py-2 ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
                onTouchStart={() => handleTouchStart(row.id)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
                onContextMenu={e => e.preventDefault()}
                onClick={() => {
                  if (longPressFired.current) {
                    longPressFired.current = false;
                    return;
                  }
                  if (selectionMode) toggleRow(row.id);
                  else onOpenLead(row.id);
                }}
              >
                {selectionMode && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleRow(row.id)}
                    aria-label={`Selecionar ${row.victim_name_trim || row.lead_name || 'lead'}`}
                    className="h-5 w-5"
                    data-no-row-click
                    onClick={e => e.stopPropagation()}
                  />
                )}
                <div className="shrink-0">{renderAvatar(row, 'h-7 w-7')}</div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    {renderVictim(row, 'truncate text-sm')}
                    {renderStageBadge(row)}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {[row.display_company || '—', [row.display_city, row.display_state].filter(Boolean).join('/') || '—'].join(' · ')}
                    </span>
                    <span className="shrink-0">{renderTempo(row)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {visibleRows.length === 0 && !loading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum lead com os filtros atuais.</p>
        )}
        {visibleRows.length < totalCount && (
          <Button
            variant="outline"
            className="w-full min-h-[44px]"
            disabled={loading}
            onClick={() => setPage(p => p + 1)}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Carregar mais (${visibleRows.length} de ${totalCount})`}
          </Button>
        )}

        {bulkBar}
        {confirmDialog}
      </div>
    );
  }

  // ======================= DESKTOP =======================
  return (
    <div className="space-y-2 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {countsHeader}
        {chipsBar}
      </div>

      {pageAllSelected && !allFiltered && totalCount > visibleRows.length && (
        <div className="rounded-md bg-muted py-1.5 text-center text-xs">
          Os {visibleRows.length} desta página estão selecionados.{' '}
          <button
            type="button"
            className="font-medium text-primary underline"
            onClick={() => {
              setAllFiltered(true);
              setSelected(new Set());
            }}
          >
            Selecionar todos os {totalCount} filtrados
          </button>
        </div>
      )}

      <div className="max-h-[calc(100vh-300px)] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Leads do board {board.name} em lista, ordenados por {SORT_LABELS[sort.key]}
          </caption>
          <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th scope="col" className="w-10 px-2 py-2">
                <Checkbox
                  checked={pageAllSelected && visibleRows.length > 0}
                  onCheckedChange={togglePage}
                  aria-label="Selecionar todos da página"
                />
              </th>
              {sortableHead('acolhedor', 'Acolhedor', 'w-16')}
              {sortableHead('vitima', 'Vítima')}
              {sortableHead('empresa', 'Empresa')}
              {sortableHead('local', 'Local')}
              {sortableHead('estagio', 'Estágio')}
              {sortableHead('tempo_estagio', 'Tempo no estágio')}
              {sortableHead('data_acidente', 'Data do acidente')}
              <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const isSelected = allFiltered || selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  tabIndex={0}
                  aria-label={`Lead ${row.victim_name_trim || row.lead_name || row.id}`}
                  className={`cursor-pointer border-b outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/70 ${
                    isSelected ? 'bg-primary/5' : ''
                  }`}
                  onClick={e => {
                    const target = e.target as HTMLElement;
                    if (target.closest('button, a, [role="menuitem"], [data-no-row-click]')) return;
                    onOpenLead(row.id);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenLead(row.id);
                    }
                  }}
                >
                  <td className="px-2 py-2" data-no-row-click onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRow(row.id)}
                      aria-label={`Selecionar ${row.victim_name_trim || row.lead_name || 'lead'}`}
                    />
                  </td>
                  <td className="px-3 py-2">{renderAvatar(row, 'h-8 w-8')}</td>
                  <td className="px-3 py-2">{renderVictim(row)}</td>
                  <td className="px-3 py-2">{row.display_company || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.display_city || row.display_state ? (
                      <span className="inline-flex items-center gap-1.5">
                        {/* A view não expõe lead_lat/lng nem visit_*: aqui a posição
                            sai do centroide do município, o que basta para a silhueta. */}
                        <LeadRegionThumb
                          lead={{ city: row.display_city, state: row.display_state }}
                          size={20}
                          fallbackIcon={false}
                        />
                        <span>{[row.display_city, row.display_state].filter(Boolean).join('/')}</span>
                        <LeadDistanceSuffix
                          lead={{ city: row.display_city, state: row.display_state }}
                          className="text-muted-foreground"
                        />
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">{renderStageBadge(row)}</td>
                  <td className="px-3 py-2">{renderTempo(row)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatAccidentDate(row.accident_date)}</td>
                  <td className="px-2 py-2">{renderRowMenu(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleRows.length === 0 && !loading && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum lead com os filtros atuais.
          </p>
        )}
        {loading && visibleRows.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {totalCount === 0
            ? '0 leads'
            : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} de ${totalCount}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            Anterior
          </Button>
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => setPage(p => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>

      {bulkBar}
      {confirmDialog}
    </div>
  );
}
