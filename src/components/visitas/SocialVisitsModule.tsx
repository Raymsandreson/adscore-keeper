/**
 * Painel /visitas — visão geral do calendário das visitas com as assistentes
 * sociais.
 *
 * A busca é por janela de datas (índice em `visit_date`), então trocar de
 * semana/mês refaz a query em vez de carregar a agenda inteira.
 *
 * Clicar no card edita o agendamento ali mesmo; "abrir lead" empilha o lead em
 * painel lateral por cima da agenda, na aba Visitas — nada de redirecionar.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, List, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/integrations/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import type { Lead } from '@/hooks/useLeads';
import { SOCIAL_VISITS_KEY, useSocialVisits, type SocialVisit } from '@/hooks/useSocialVisits';
import { SocialVisitFormDialog } from './SocialVisitFormDialog';
import { SocialVisitListView } from './SocialVisitListView';
import { SocialVisitMonthView } from './SocialVisitMonthView';
import { SocialVisitWeekView } from './SocialVisitWeekView';
import { VISIT_STATUS_LABELS, VISIT_STATUS_ORDER, normalizeWorkerKey } from './visitStyles';

type ViewMode = 'semana' | 'mes' | 'lista';

const iso = (date: Date) => format(date, 'yyyy-MM-dd');

export default function SocialVisitsModule() {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('semana');
  const [referenceDate, setReferenceDate] = useState(new Date());
  const [search, setSearch] = useState('');
  const [workerFilter, setWorkerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SocialVisit | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();

  const [leadSheet, setLeadSheet] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(false);

  // Janela buscada no banco por visão aberta.
  const range = useMemo(() => {
    if (view === 'semana') {
      return {
        from: iso(startOfWeek(referenceDate, { weekStartsOn: 1 })),
        to: iso(endOfWeek(referenceDate, { weekStartsOn: 1 })),
      };
    }
    if (view === 'mes') {
      return {
        from: iso(startOfWeek(startOfMonth(referenceDate), { weekStartsOn: 1 })),
        to: iso(endOfWeek(endOfMonth(referenceDate), { weekStartsOn: 1 })),
      };
    }
    // Lista: histórico recente + agenda futura, sem varrer a tabela inteira.
    return { from: iso(addDays(new Date(), -90)), to: iso(addDays(new Date(), 365)) };
  }, [view, referenceDate]);

  const { data: visits = [], isLoading } = useSocialVisits(range);

  const workers = useMemo(() => {
    const map = new Map<string, string>();
    for (const visit of visits) {
      const key = normalizeWorkerKey(visit.social_worker_name);
      if (key && !map.has(key)) map.set(key, visit.social_worker_name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [visits]);

  const states = useMemo(
    () => [...new Set(visits.map((v) => v.state).filter(Boolean) as string[])].sort(),
    [visits],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visits.filter((visit) => {
      if (workerFilter !== 'all' && normalizeWorkerKey(visit.social_worker_name) !== workerFilter) return false;
      if (statusFilter !== 'all' && visit.status !== statusFilter) return false;
      if (stateFilter !== 'all' && visit.state !== stateFilter) return false;
      if (term) {
        const blob = [visit.lead_name, visit.social_worker_name, visit.city, visit.address, visit.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!blob.includes(term)) return false;
      }
      return true;
    });
  }, [visits, search, workerFilter, statusFilter, stateFilter]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const done = filtered.filter((v) => v.status === 'realizada').length;
    const canceled = filtered.filter((v) => v.status === 'cancelada').length;
    const people = new Set(filtered.map((v) => normalizeWorkerKey(v.social_worker_name)).filter(Boolean)).size;
    return { total, done, canceled, people };
  }, [filtered]);

  const openCreate = (dateISO?: string) => {
    setEditing(null);
    setDefaultDate(dateISO);
    setFormOpen(true);
  };

  const openEdit = (visit: SocialVisit) => {
    setEditing(visit);
    setDefaultDate(undefined);
    setFormOpen(true);
  };

  const openLead = async (leadId: string) => {
    setLoadingLead(true);
    try {
      const { data, error } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error('Lead não encontrado — pode ter sido arquivado.');
        return;
      }
      setLeadSheet(data as unknown as Lead);
    } catch (e: any) {
      toast.error('Erro ao abrir o lead: ' + (e?.message || 'desconhecido'));
    } finally {
      setLoadingLead(false);
    }
  };

  const periodLabel = view === 'semana'
    ? `${format(startOfWeek(referenceDate, { weekStartsOn: 1 }), 'dd/MM')} – ${format(endOfWeek(referenceDate, { weekStartsOn: 1 }), 'dd/MM/yyyy')}`
    : format(referenceDate, "MMMM 'de' yyyy", { locale: ptBR });

  const step = (direction: -1 | 1) => {
    setReferenceDate((current) =>
      view === 'semana' ? addDays(current, direction * 7)
        : direction === 1 ? addMonths(current, 1) : subMonths(current, 1),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:justify-between">
        <div>
          <h1 className="text-xl font-bold">Visitas das assistentes sociais</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? 'Carregando agenda...'
              : `${summary.total} visita(s) no período · ${summary.people} assistente(s) social(is) · ${summary.done} realizada(s)${summary.canceled ? ` · ${summary.canceled} cancelada(s)` : ''}`}
          </p>
        </div>
        <Button onClick={() => openCreate()} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" /> Agendar visita
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por lead, assistente social, cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={workerFilter} onValueChange={setWorkerFilter}>
          <SelectTrigger className="w-[210px]"><SelectValue placeholder="Assistente social" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as assistentes</SelectItem>
            {workers.map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {VISIT_STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>{VISIT_STATUS_LABELS[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[110px]"><SelectValue placeholder="UF" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda UF</SelectItem>
            {states.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)} className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="semana" className="gap-1"><CalendarRange className="h-4 w-4" /> Semana</TabsTrigger>
            <TabsTrigger value="mes" className="gap-1"><CalendarDays className="h-4 w-4" /> Mês</TabsTrigger>
            <TabsTrigger value="lista" className="gap-1"><List className="h-4 w-4" /> Lista</TabsTrigger>
          </TabsList>

          {view !== 'lista' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => step(-1)} title="Período anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-semibold capitalize min-w-[170px] text-center">{periodLabel}</div>
              <Button variant="outline" size="icon" onClick={() => step(1)} title="Próximo período">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReferenceDate(new Date())}>Hoje</Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Carregando visitas...</div>
        ) : (
          <>
            <TabsContent value="semana">
              <SocialVisitWeekView
                visits={filtered}
                referenceDate={referenceDate}
                onSelect={openEdit}
                onAdd={openCreate}
                onOpenLead={openLead}
              />
            </TabsContent>
            <TabsContent value="mes">
              <SocialVisitMonthView
                visits={filtered}
                referenceDate={referenceDate}
                onSelect={openEdit}
                onAdd={openCreate}
              />
            </TabsContent>
            <TabsContent value="lista">
              <SocialVisitListView visits={filtered} onSelect={openEdit} onOpenLead={openLead} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <SocialVisitFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        visit={editing}
        defaultDate={defaultDate}
      />

      {leadSheet && (
        <LeadEditDialog
          open={!!leadSheet}
          onOpenChange={(isOpen) => { if (!isOpen) setLeadSheet(null); }}
          lead={leadSheet}
          mode="sheet"
          initialTab="visitas"
          onSave={async (leadId, updates) => {
            const { error } = await db.from('leads').update(updates as any).eq('id', leadId);
            if (error) {
              toast.error('Erro ao salvar o lead: ' + error.message);
              return;
            }
            // O nome do lead vive como snapshot no card da visita.
            qc.invalidateQueries({ queryKey: [SOCIAL_VISITS_KEY] });
            setLeadSheet(null);
          }}
        />
      )}

      {loadingLead && (
        <div className="fixed bottom-4 right-4 rounded-md bg-card border px-3 py-2 text-xs text-muted-foreground shadow">
          Abrindo lead...
        </div>
      )}
    </div>
  );
}
