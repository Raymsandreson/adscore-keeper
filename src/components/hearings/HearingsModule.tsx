import { useMemo, useState } from 'react';
import { addMonths, format, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHearings, type Hearing, type HearingCategory, type HearingStatus } from '@/hooks/useHearings';
import { CATEGORY_LABELS, STATUS_LABELS, HEARING_TYPES } from './hearingStyles';
import { HearingWeekView } from './HearingWeekView';
import { HearingMonthView } from './HearingMonthView';
import { HearingDayView } from './HearingDayView';
import { HearingListView } from './HearingListView';
import { HearingFormDialog } from './HearingFormDialog';

export default function HearingsModule() {
  const { data: hearings = [], isLoading } = useHearings();
  const [view, setView] = useState<'semana' | 'mes' | 'dia' | 'lista'>('semana');
  const [referenceDate, setReferenceDate] = useState(new Date());
  const [dayDate, setDayDate] = useState(new Date());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Hearing | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hearings.filter((h) => {
      if (typeFilter !== 'all' && h.hearing_type !== typeFilter) return false;
      if (statusFilter !== 'all' && h.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && h.category !== categoryFilter) return false;
      if (q) {
        const blob = [h.process_number, h.case_ref, h.notes, h.hearing_type, h.location]
          .filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [hearings, search, typeFilter, statusFilter, categoryFilter]);

  const openCreate = (dateISO?: string) => {
    setEditing(null);
    setDefaultDate(dateISO);
    setDialogOpen(true);
  };
  const openEdit = (h: Hearing) => {
    setEditing(h);
    setDefaultDate(undefined);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header / filtros */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:justify-between">
        <div className="flex flex-1 flex-wrap gap-2 items-center">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por processo, caso, observações..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {HEARING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => openCreate()} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova audiência
        </Button>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as any)} className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="semana" className="gap-1"><CalendarDays className="h-4 w-4" /> Semana</TabsTrigger>
            <TabsTrigger value="mes" className="gap-1"><CalendarDays className="h-4 w-4" /> Mês</TabsTrigger>
            <TabsTrigger value="dia" className="gap-1"><CalendarDays className="h-4 w-4" /> Dia</TabsTrigger>
            <TabsTrigger value="lista" className="gap-1"><List className="h-4 w-4" /> Lista</TabsTrigger>
          </TabsList>

          {(view === 'semana' || view === 'mes') && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setReferenceDate(subMonths(referenceDate, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-semibold capitalize min-w-[140px] text-center">
                {format(referenceDate, "MMMM 'de' yyyy", { locale: ptBR })}
              </div>
              <Button variant="outline" size="icon" onClick={() => setReferenceDate(addMonths(referenceDate, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReferenceDate(new Date())}>Hoje</Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Carregando audiências...</div>
        ) : (
          <>
            <TabsContent value="semana">
              <HearingWeekView
                hearings={filtered}
                referenceDate={referenceDate}
                onSelect={openEdit}
                onAdd={openCreate}
              />
            </TabsContent>
            <TabsContent value="mes">
              <HearingMonthView
                hearings={filtered}
                referenceDate={referenceDate}
                onSelect={openEdit}
                onAdd={openCreate}
              />
            </TabsContent>
            <TabsContent value="dia">
              <HearingDayView
                hearings={filtered}
                date={dayDate}
                onChangeDate={setDayDate}
                onSelect={openEdit}
                onAdd={openCreate}
              />
            </TabsContent>
            <TabsContent value="lista">
              <HearingListView hearings={filtered} onSelect={openEdit} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <HearingFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        hearing={editing}
        defaultDate={defaultDate}
      />
    </div>
  );
}
