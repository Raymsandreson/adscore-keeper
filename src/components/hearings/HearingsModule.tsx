import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addMonths, format, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Gavel, LayoutList, List, Plus, RefreshCw, Search, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/functionRouter';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHearings, type Hearing, type HearingCategory, type HearingStatus } from '@/hooks/useHearings';
import { categoriaDaAudiencia } from '@/lib/eventAgenda';
import { cn } from '@/lib/utils';
import { CATEGORY_LABELS, STATUS_LABELS } from './hearingStyles';
import { HearingWeekView } from './HearingWeekView';
import { HearingMonthView } from './HearingMonthView';
import { HearingDayView } from './HearingDayView';
import { HearingListView } from './HearingListView';
import { HearingFormDialog } from './HearingFormDialog';

/** Que tipo de evento a tela está mostrando. */
type Lente = 'audiencia' | 'pericia' | 'todos';

const LENTE_LABEL: Record<Lente, string> = {
  audiencia: 'Audiências',
  pericia: 'Perícias',
  todos: 'Todos',
};

/**
 * Aceita /hearings?evento=pericia para quem quiser linkar direto na agenda de
 * perícias. Sem o parâmetro abre em Audiências, que é como a tela sempre abriu.
 */
function lenteInicial(): Lente {
  const v = new URLSearchParams(window.location.search).get('evento');
  return v === 'pericia' || v === 'todos' ? v : 'audiencia';
}

export default function HearingsModule() {
  const { data: hearings = [], isLoading } = useHearings();
  const [lente, setLente] = useState<Lente>(lenteInicial);
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
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();

  const syncFromSheet = async () => {
    setSyncing(true);
    try {
      const { data, error } = await cloudFunctions.invoke('sync-hearings-from-sheet', {
        body: { apply: true, confirm: 'SYNC' },
      });
      if (error || !data?.ok) throw error || new Error(data?.error || 'falha na sincronização');
      qc.invalidateQueries({ queryKey: ['hearings'] });
      const extra = data.db_only_future > 0
        ? ` — ${data.db_only_future} existe(m) só no sistema (não removidas)`
        : '';
      toast.success(`Planilha sincronizada: ${data.inserted} nova(s), ${data.updated} atualizada(s)${extra}`);
    } catch (e: any) {
      toast.error('Erro ao sincronizar: ' + (e?.message || 'desconhecido'));
    } finally {
      setSyncing(false);
    }
  };

  // Universo por lente, antes dos demais filtros: o contador tem que dizer
  // quantas perícias existem, não quantas sobraram do filtro de status.
  const contagem = useMemo(() => {
    let audiencia = 0;
    let pericia = 0;
    for (const h of hearings) {
      if (categoriaDaAudiencia(h.hearing_type) === 'pericia') pericia++;
      else audiencia++;
    }
    return { audiencia, pericia, todos: hearings.length };
  }, [hearings]);

  // Mesma regra da aba Eventos (`categoriaDaAudiencia`): perícia pelo radical +
  // "avaliação social". Tudo que não é perícia é audiência, inclusive as linhas
  // sem tipo — elas continuam visíveis em algum lugar.
  const noEscopoDaLente = useMemo(() => {
    if (lente === 'todos') return hearings;
    const querPericia = lente === 'pericia';
    return hearings.filter(h => (categoriaDaAudiencia(h.hearing_type) === 'pericia') === querPericia);
  }, [hearings, lente]);

  // As opções do filtro saem do DADO, não do catálogo do formulário.
  // Medido em 20/08/2026, com a lista fixa `HEARING_TYPES`: "Inicial" (122),
  // "UNA" (112), "Pericia" (3), "Homologação" (2), "Julgamento" e "Encerramento"
  // não eram opção — 241 dos 566 eventos ficavam fora do alcance do filtro. E
  // três opções do catálogo ("UNA Virtual", "UNA Presencial", "Inicial Virtual")
  // não existiam em linha nenhuma: escolher qualquer uma esvaziava o calendário
  // sem motivo. O catálogo continua valendo onde faz sentido — no formulário,
  // que precisa oferecer o nome certo pra linha nova.
  const tiposPresentes = useMemo(() => {
    const conta = new Map<string, number>();
    for (const h of noEscopoDaLente) {
      const t = (h.hearing_type || '').trim();
      if (t) conta.set(t, (conta.get(t) || 0) + 1);
    }
    return [...conta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
  }, [noEscopoDaLente]);

  // Trocar de lente pode tirar do ar o tipo escolhido ("Instrução" não existe em
  // perícia). Sem isto o filtro seguiria valendo, invisível, e a tela apareceria
  // vazia como se não houvesse evento.
  useEffect(() => {
    if (typeFilter !== 'all' && !tiposPresentes.some(([t]) => t === typeFilter)) setTypeFilter('all');
  }, [tiposPresentes, typeFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return noEscopoDaLente.filter((h) => {
      if (typeFilter !== 'all' && (h.hearing_type || '').trim() !== typeFilter) return false;
      if (statusFilter !== 'all' && h.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && h.category !== categoryFilter) return false;
      if (q) {
        const blob = [h.process_number, h.case_ref, h.notes, h.hearing_type, h.location]
          .filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [noEscopoDaLente, search, typeFilter, statusFilter, categoryFilter]);

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
      {/* Que evento a tela mostra. Fica antes de tudo porque muda o universo,
          não é mais um filtro: perícia e audiência são trabalhos diferentes. */}
      <div className="flex items-center gap-1 flex-wrap">
        {(['audiencia', 'pericia', 'todos'] as Lente[]).map((l) => {
          const Icone = l === 'audiencia' ? Gavel : l === 'pericia' ? Stethoscope : LayoutList;
          const ativa = lente === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLente(l)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border',
                ativa
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'border-transparent text-muted-foreground hover:bg-muted',
              )}
            >
              <Icone className="h-3.5 w-3.5" />
              {LENTE_LABEL[l]}
              <span className={cn(
                'rounded-full px-1.5 text-[10px] font-bold',
                ativa ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
              )}>
                {contagem[l]}
              </span>
            </button>
          );
        })}
      </div>

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
              {tiposPresentes.map(([t, n]) => (
                <SelectItem key={t} value={t}>{t} ({n})</SelectItem>
              ))}
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={syncFromSheet} disabled={syncing} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar planilha'}
          </Button>
          <Button onClick={() => openCreate()} className="gap-1.5">
            <Plus className="h-4 w-4" /> {lente === 'pericia' ? 'Nova perícia' : 'Nova audiência'}
          </Button>
        </div>
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
        // Criar a partir da agenda de perícias já nasce perícia: sem isto o
        // formulário abriria em "UNA Virtual"/cível e a linha sumiria da lente
        // em que a pessoa acabou de criá-la.
        defaultType={lente === 'pericia' ? 'Perícia Médica (INSS)' : undefined}
        defaultCategory={lente === 'pericia' ? 'previdenciario' : undefined}
      />
    </div>
  );
}
