import { Fragment, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarDays, ChevronLeft, ChevronRight, Gavel, Stethoscope, Timer,
  CircleDot, Lightbulb, Loader2, LayoutList, Filter, UserX, CheckSquare,
  Trash2, ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { useEventosDaJanela } from '@/hooks/useEventosDaJanela';
import { FAMILIAS, type FamiliaCaso } from '@/lib/casoSequencia';
import {
  CATEGORIAS, CATEGORIA_LABEL, aplicarFiltrosDeEvento, contarPorCategoria,
  diaAnterior, diaSeguinte, diasDoIntervalo, janelaDaVespera,
  type CategoriaEvento, type EventoAgenda,
} from '@/lib/eventAgenda';

type Aba = 'todos' | CategoriaEvento;
type ModoData = 'vespera' | 'periodo';

const ICONE: Record<CategoriaEvento, typeof Gavel> = {
  audiencia: Gavel,
  pericia: Stethoscope,
  prazo: Timer,
  outros: CircleDot,
};

/** Cor por categoria — a mesma da aba, do ícone e da tarja da linha. */
const COR: Record<CategoriaEvento, string> = {
  audiencia: 'text-blue-600 dark:text-blue-400',
  pericia: 'text-emerald-600 dark:text-emerald-400',
  prazo: 'text-amber-600 dark:text-amber-400',
  outros: 'text-slate-500 dark:text-slate-400',
};

const TARJA: Record<CategoriaEvento, string> = {
  audiencia: 'bg-blue-500',
  pericia: 'bg-emerald-500',
  prazo: 'bg-amber-500',
  outros: 'bg-slate-400',
};

const PRIORIDADE_ESTILO: Record<string, string> = {
  urgente: 'bg-destructive/15 text-destructive border-destructive/40',
  alta: 'bg-destructive/10 text-destructive border-destructive/30',
  normal: 'bg-warning/15 text-warning border-warning/40',
  baixa: 'bg-success/15 text-success border-success/40',
};

const PRIORIDADE_LABEL: Record<string, string> = {
  urgente: 'URGENTE',
  alta: 'ALTA',
  normal: 'MÉDIA',
  baixa: 'BAIXA',
};

const AREA_LABEL: Record<string, string> = {
  trabalhista: 'Trabalhista',
  previdenciario: 'Previdenciário',
  civel: 'Cível',
  outro: 'Outra',
};

const DICAS = [
  'Confira os detalhes e o local do evento',
  'Separe os documentos que vão ser usados',
  'Antecipe petições e alinhe a estratégia',
  'Avise o cliente com um dia de antecedência',
];

/** Atalhos do seletor de período, em dias a partir de amanhã. */
const ATALHOS: { rotulo: string; dias: number }[] = [
  { rotulo: 'Próximos 7 dias', dias: 7 },
  { rotulo: 'Próximos 15 dias', dias: 15 },
  { rotulo: 'Próximos 30 dias', dias: 30 },
];

const hojeIso = () => format(new Date(), 'yyyy-MM-dd');

function somarDias(iso: string, n: number): string {
  let cursor = iso;
  for (let i = 0; i < Math.abs(n); i++) cursor = n > 0 ? diaSeguinte(cursor) : diaAnterior(cursor);
  return cursor;
}

function dataPorExtenso(iso: string): string {
  try { return format(parseISO(iso), "dd/MM/yyyy (EEEE)", { locale: ptBR }); } catch { return iso; }
}

function diaCurto(iso: string): string {
  try { return format(parseISO(iso), "dd/MM (EEEE)", { locale: ptBR }); } catch { return iso; }
}

/**
 * Como a janela se apresenta: um dia por extenso, ou o intervalo quando a
 * véspera cobre o fim de semana ("22/08 (sábado) a 24/08 (segunda-feira)").
 */
function rotuloDaJanela(dias: string[]): string {
  if (dias.length === 0) return '';
  if (dias.length === 1) return dataPorExtenso(dias[0]);
  return `${diaCurto(dias[0])} a ${diaCurto(dias[dias.length - 1])}`;
}

/** Filtros que a página de Atividades já tem e que valem aqui dentro. */
export interface FiltrosDaPagina {
  /** UUIDs do CLOUD, como a barra de filtros guarda. O remap acontece aqui. */
  assessores: string[];
  assessoresNomes?: string[];
  leadIds: string[];
  caseIds: string[];
  busca: string;
}

/**
 * Agenda de eventos do dia seguinte.
 *
 * A tela mostra o que acontece em D+1 enquanto o seletor fica em D — foi o
 * pedido literal do escritório: "uma atividade que tem perícia pro dia 12.08
 * aparece na aba de perícias do dia 11.08, para a pessoa saber as prioridades".
 * Por isso o seletor diz "Véspera" e o cabeçalho da tabela repete a data real do
 * evento: sem isso a tela mostra uma data e o título fala de outra.
 *
 * Fim de semana: a janela vai de D+1 até o próximo dia ÚTIL, inclusive. Na sexta
 * mostra sábado, domingo E segunda — a segunda precisa de véspera, e sexta é a
 * véspera útil dela. Os dias pulados entram na janela em vez de serem saltados
 * porque prazo cai em fim de semana (3 dos 81 vivos), embora audiência não caia
 * (0 das 555). Feriado não é considerado: ver `janelaDaVespera`.
 *
 * O modo PERÍODO (ago/2026) atende quem precisa de horizonte maior que a
 * véspera; a véspera continua sendo como a tela abre, porque é o pedido
 * original. Nos dois modos o que se escolhe é a data do EVENTO.
 */
export function EventsAgenda({ onAbrirAtividade, filtros, onLimparFiltros, onExcluirLote, onPassarPara, compacto }: {
  /** Abre a ficha da atividade em painel, por cima da tela (nunca redireciona). */
  onAbrirAtividade?: (atividadeId: string) => void;
  /** Filtros herdados da barra da página. */
  filtros?: FiltrosDaPagina;
  onLimparFiltros?: () => void;
  /** Ações em lote sobre as atividades marcadas. */
  onExcluirLote?: (ids: string[]) => void;
  onPassarPara?: (ids: string[]) => void;
  /**
   * Coluna estreita: a agenda divide a tela com a ficha aberta.
   *
   * Com a ficha aberta a página reserva 36rem para esta visão, e uma tabela de
   * sete colunas mais o painel de dicas não cabe nisso — o número do processo
   * quebrava letra a letra e Data/Atividade/Prioridade saíam da área visível.
   * Aqui a mesma informação vira uma linha por evento, sem tabela e sem dicas.
   */
  compacto?: boolean;
}) {
  const [modo, setModo] = useState<ModoData>('vespera');
  const [vespera, setVespera] = useState<string>(hojeIso);
  const [de, setDe] = useState<string>(() => somarDias(hojeIso(), 1));
  const [ate, setAte] = useState<string>(() => somarDias(hojeIso(), 7));
  const [aba, setAba] = useState<Aba>('todos');
  const [familias, setFamilias] = useState<FamiliaCaso[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const janela = useMemo(
    () => (modo === 'vespera' ? janelaDaVespera(vespera) : diasDoIntervalo(de, ate)),
    [modo, vespera, de, ate],
  );
  const { eventos, isLoading, error } = useEventosDaJanela(janela);

  // O filtro de assessor da página guarda UUID do Cloud; `lead_activities`
  // guarda o do Externo. O mesmo remap que `useLeadActivities` faz no fetch.
  const [assessoresExt, setAssessoresExt] = useState<string[]>([]);
  const chaveAssessores = (filtros?.assessores || []).join(',');
  useEffect(() => {
    let vivo = true;
    const ids = chaveAssessores ? chaveAssessores.split(',') : [];
    if (ids.length === 0) { setAssessoresExt([]); return; }
    (async () => {
      const mapeados = await Promise.all(ids.map(id => remapToExternal(id)));
      if (vivo) setAssessoresExt(mapeados.filter(Boolean) as string[]);
    })();
    return () => { vivo = false; };
  }, [chaveAssessores]);

  const filtrados = useMemo(
    () => aplicarFiltrosDeEvento(eventos, {
      assessores: assessoresExt,
      familias,
      areas,
      leadIds: filtros?.leadIds || [],
      caseIds: filtros?.caseIds || [],
      busca: filtros?.busca || '',
    }),
    [eventos, assessoresExt, familias, areas, filtros?.leadIds, filtros?.caseIds, filtros?.busca],
  );

  const contagem = useMemo(() => contarPorCategoria(filtrados), [filtrados]);
  const visiveis = useMemo(
    () => (aba === 'todos' ? filtrados : filtrados.filter(e => e.categoria === aba)),
    [filtrados, aba],
  );
  const escondidos = eventos.length - filtrados.length;
  const semDono = useMemo(
    () => (assessoresExt.length > 0 ? visiveis.filter(e => e.semResponsavel).length : 0),
    [visiveis, assessoresExt],
  );

  // Áreas que aparecem de fato na janela — filtro que oferece opção vazia mente.
  const areasNaJanela = useMemo(() => {
    const set = new Set<string>();
    eventos.forEach(e => { if (e.area) set.add(e.area); });
    return [...set].sort();
  }, [eventos]);

  const marcaveis = useMemo(() => visiveis.filter(e => e.atividadeId), [visiveis]);
  const idsMarcados = useMemo(
    () => [...new Set(marcaveis.filter(e => marcados.has(e.chave)).map(e => e.atividadeId!))],
    [marcaveis, marcados],
  );
  const podeSelecionar = Boolean(onExcluirLote || onPassarPara);

  // Marcação some quando a janela ou o filtro muda: manter linha marcada que
  // saiu da tela viraria ação em lote sobre o que a pessoa não está vendo.
  const chaveJanela = janela.join(',');
  useEffect(() => { setMarcados(new Set()); }, [chaveJanela, aba, chaveAssessores, familias, areas]);

  const alternarMarcado = (chave: string) => setMarcados(atual => {
    const proximo = new Set(atual);
    if (proximo.has(chave)) proximo.delete(chave); else proximo.add(chave);
    return proximo;
  });

  const abas: { id: Aba; rotulo: string; total: number }[] = [
    { id: 'todos', rotulo: 'Todos', total: filtrados.length },
    ...CATEGORIAS.map(c => ({ id: c as Aba, rotulo: CATEGORIA_LABEL[c], total: contagem[c] })),
  ];

  const aplicarAtalho = (dias: number) => {
    setModo('periodo');
    setDe(somarDias(hojeIso(), 1));
    setAte(somarDias(hojeIso(), dias));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Cabeçalho: abas + navegação de dia */}
      <div className="shrink-0 border-b bg-card">
        <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
          <span className="text-sm font-semibold flex items-center gap-1.5 mr-1">
            <LayoutList className="h-4 w-4" />
            Eventos
          </span>

          <div className="flex items-center gap-0.5 flex-wrap">
            {abas.map(({ id, rotulo, total }) => {
              const Icone = id === 'todos' ? LayoutList : ICONE[id as CategoriaEvento];
              const ativa = aba === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAba(id)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border',
                    ativa
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'border-transparent text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icone className={cn('h-3.5 w-3.5', !ativa && id !== 'todos' && COR[id as CategoriaEvento])} />
                  {rotulo}
                  <span className={cn(
                    'rounded-full px-1.5 text-[10px] font-bold',
                    ativa ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
                  )}>
                    {total}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 ml-auto flex-wrap justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {modo === 'vespera' ? 'Véspera' : 'Período'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Quando</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { setModo('vespera'); setVespera(hojeIso()); }}>
                  Véspera — o que acontece amanhã
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {ATALHOS.map(a => (
                  <DropdownMenuItem key={a.dias} onClick={() => aplicarAtalho(a.dias)}>
                    {a.rotulo}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => setModo('periodo')}>
                  Período personalizado…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {modo === 'vespera' ? (
              <>
                <Button variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => setVespera(d => diaAnterior(d))} title="Dia anterior">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Input
                  type="date"
                  value={vespera}
                  onChange={e => e.target.value && setVespera(e.target.value)}
                  className="h-7 w-[9.5rem] text-xs"
                />
                <Button variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => setVespera(d => diaSeguinte(d))} title="Próximo dia">
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                {vespera !== hojeIso() && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setVespera(hojeIso())}>
                    Hoje
                  </Button>
                )}
              </>
            ) : (
              <>
                <Input type="date" value={de} onChange={e => e.target.value && setDe(e.target.value)}
                  className="h-7 w-[8.5rem] text-xs" title="Primeiro dia do período" />
                <span className="text-[10px] text-muted-foreground">até</span>
                <Input type="date" value={ate} onChange={e => e.target.value && setAte(e.target.value)}
                  className="h-7 w-[8.5rem] text-xs" title="Último dia do período" />
              </>
            )}
          </div>
        </div>

        {/* Filtros próprios da agenda + o que veio da barra da página */}
        <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={familias.length > 0 ? 'default' : 'outline'} size="sm" className="h-7 text-xs gap-1">
                <Filter className="h-3.5 w-3.5" />
                Caso/Prev
                {familias.length > 0 && (
                  <span className="rounded-full bg-primary-foreground/25 px-1.5 text-[10px] font-bold">{familias.length}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Sequência do caso</DropdownMenuLabel>
              {FAMILIAS.map(f => (
                <DropdownMenuCheckboxItem
                  key={f.valor}
                  checked={familias.includes(f.valor)}
                  onCheckedChange={c => setFamilias(atual =>
                    c ? [...atual, f.valor] : atual.filter(v => v !== f.valor))}
                  onSelect={e => e.preventDefault()}
                >
                  {f.rotulo}
                </DropdownMenuCheckboxItem>
              ))}
              {familias.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFamilias([])}>Limpar</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {areasNaJanela.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={areas.length > 0 ? 'default' : 'outline'} size="sm" className="h-7 text-xs gap-1">
                  Área
                  {areas.length > 0 && (
                    <span className="rounded-full bg-primary-foreground/25 px-1.5 text-[10px] font-bold">{areas.length}</span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Área do evento</DropdownMenuLabel>
                {areasNaJanela.map(a => (
                  <DropdownMenuCheckboxItem
                    key={a}
                    checked={areas.includes(a)}
                    onCheckedChange={c => setAreas(atual => c ? [...atual, a] : atual.filter(v => v !== a))}
                    onSelect={e => e.preventDefault()}
                  >
                    {AREA_LABEL[a] || a}
                  </DropdownMenuCheckboxItem>
                ))}
                {areas.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setAreas([])}>Limpar</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Só filtro da página que realmente age aqui vira selo — selo de
              filtro que não filtra foi exatamente a queixa desta tela. */}
          {(filtros?.assessores.length || 0) > 0 && (
            <Badge variant="secondary" className="h-7 gap-1 text-[11px] font-normal px-2">
              Assessor: {filtros?.assessoresNomes?.length
                ? filtros.assessoresNomes.slice(0, 2).join(', ') + (filtros.assessoresNomes.length > 2 ? ` +${filtros.assessoresNomes.length - 2}` : '')
                : `${filtros?.assessores.length} selecionado(s)`}
            </Badge>
          )}
          {(filtros?.busca || '').trim() && (
            <Badge variant="secondary" className="h-7 gap-1 text-[11px] font-normal px-2">
              Busca: "{filtros?.busca.trim()}"
            </Badge>
          )}
          {((filtros?.leadIds.length || 0) + (filtros?.caseIds.length || 0)) > 0 && (
            <Badge variant="secondary" className="h-7 gap-1 text-[11px] font-normal px-2">
              Cliente/caso: {(filtros?.leadIds.length || 0) + (filtros?.caseIds.length || 0)}
            </Badge>
          )}
          {escondidos > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {escondidos} evento{escondidos !== 1 ? 's' : ''} fora do filtro
              {onLimparFiltros && (
                <Button variant="link" size="sm" className="h-5 px-1 text-[11px]" onClick={onLimparFiltros}>
                  limpar
                </Button>
              )}
            </span>
          )}
        </div>

        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          {modo === 'vespera' ? (
            <>
              Mostra o que acontece <strong>no dia seguinte</strong> à data escolhida — para preparar na véspera.
              {janela.length > 1 && (
                <> Como o dia seguinte cai no fim de semana, a janela vai até{' '}
                  <strong>{diaCurto(janela[janela.length - 1])}</strong>: o próximo dia útil também
                  precisa de véspera.</>
              )}
            </>
          ) : (
            <>Mostra os eventos com data entre <strong>{diaCurto(janela[0] || de)}</strong> e{' '}
              <strong>{diaCurto(janela[janela.length - 1] || ate)}</strong> ({janela.length} dia
              {janela.length !== 1 ? 's' : ''}).</>
          )}
          {semDono > 0 && (
            <> {semDono} deste{semDono !== 1 ? 's' : ''} não tem responsável e aparece{semDono !== 1 ? 'm' : ''} mesmo
              com o filtro de assessor — evento sem dono não pode sumir da tela de todo mundo.</>
          )}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Tabela */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="shrink-0 px-3 py-2 border-b bg-muted/30 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm font-semibold truncate">
              {aba === 'todos' ? 'Eventos' : CATEGORIA_LABEL[aba as CategoriaEvento]} em {rotuloDaJanela(janela)}
            </p>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando os eventos de {rotuloDaJanela(janela)}...
              </div>
            ) : error ? (
              <div className="px-3 py-10 text-center text-xs text-destructive">
                Não deu para carregar os eventos: {(error as any)?.message || 'erro desconhecido'}
              </div>
            ) : visiveis.length === 0 ? (
              <div className="px-3 py-12 text-center space-y-1">
                <p className="text-xs text-muted-foreground">
                  Nenhum evento em {rotuloDaJanela(janela)}.
                </p>
                {escondidos > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {escondidos} evento{escondidos !== 1 ? 's estão' : ' está'} escondido{escondidos !== 1 ? 's' : ''} pelos filtros.
                  </p>
                )}
              </div>
            ) : compacto ? (
              <ul className="divide-y">
                {visiveis.map((evento, i) => {
                  const novoDia = janela.length > 1 && (i === 0 || visiveis[i - 1].dataEvento !== evento.dataEvento);
                  return (
                    <Fragment key={evento.chave}>
                      {novoDia && (
                        <li className="bg-muted/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {diaCurto(evento.dataEvento)}
                        </li>
                      )}
                      <CartaoEvento
                        evento={evento}
                        onAbrirAtividade={onAbrirAtividade}
                        selecionavel={podeSelecionar}
                        marcado={marcados.has(evento.chave)}
                        onMarcar={() => alternarMarcado(evento.chave)}
                      />
                    </Fragment>
                  );
                })}
              </ul>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    {podeSelecionar && (
                      <th className="pl-3 pr-1 py-1.5 w-8">
                        <Checkbox
                          checked={marcaveis.length > 0 && marcaveis.every(e => marcados.has(e.chave))}
                          onCheckedChange={c => setMarcados(c
                            ? new Set(marcaveis.map(e => e.chave))
                            : new Set())}
                          aria-label="Marcar todos"
                        />
                      </th>
                    )}
                    <th className="px-3 py-1.5 font-medium">Processo / caso</th>
                    <th className="px-2 py-1.5 font-medium">Cliente</th>
                    <th className="px-2 py-1.5 font-medium">Evento</th>
                    <th className="px-2 py-1.5 font-medium whitespace-nowrap">Data do evento</th>
                    <th className="px-2 py-1.5 font-medium">Atividade</th>
                    <th className="px-3 py-1.5 font-medium">Prioridade</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visiveis.map((evento, i) => {
                    // Em período longo a data vira cabeçalho: sem isso a pessoa
                    // lê 40 linhas seguidas sem saber onde um dia termina.
                    const novoDia = janela.length > 1 && (i === 0 || visiveis[i - 1].dataEvento !== evento.dataEvento);
                    return (
                      <Fragment key={evento.chave}>
                        {novoDia && (
                          <tr className="bg-muted/40">
                            <td colSpan={podeSelecionar ? 7 : 6} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {diaCurto(evento.dataEvento)}
                            </td>
                          </tr>
                        )}
                        <LinhaEvento
                          evento={evento}
                          onAbrirAtividade={onAbrirAtividade}
                          selecionavel={podeSelecionar}
                          marcado={marcados.has(evento.chave)}
                          onMarcar={() => alternarMarcado(evento.chave)}
                        />
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ScrollArea>

          {/* Ações em lote sobre as atividades marcadas */}
          {idsMarcados.length > 0 && (
            <div className="shrink-0 border-t bg-card px-3 py-2 flex items-center gap-2 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
              <span className="text-xs font-medium flex-1 min-w-0">
                <CheckSquare className="h-3.5 w-3.5 inline mr-1" />
                {idsMarcados.length} atividade{idsMarcados.length !== 1 ? 's' : ''} marcada{idsMarcados.length !== 1 ? 's' : ''}
              </span>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMarcados(new Set())}>
                Cancelar
              </Button>
              {onExcluirLote && (
                <Button
                  variant="outline" size="sm"
                  className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onExcluirLote(idsMarcados)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </Button>
              )}
              {onPassarPara && (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => onPassarPara(idsMarcados)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Passar para...
                </Button>
              )}
            </div>
          )}

          {/* Rodapé: contagem + legenda das cores */}
          <div className="shrink-0 border-t px-3 py-1.5 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
            <span>
              {visiveis.length} evento{visiveis.length !== 1 ? 's' : ''} encontrado{visiveis.length !== 1 ? 's' : ''}
            </span>
            <span className={cn('items-center gap-3 ml-auto', compacto ? 'hidden' : 'hidden sm:flex')}>
              {CATEGORIAS.map(c => {
                const Icone = ICONE[c];
                return (
                  <span key={c} className="flex items-center gap-1">
                    <Icone className={cn('h-3 w-3', COR[c])} />
                    {CATEGORIA_LABEL[c]}
                  </span>
                );
              })}
            </span>
          </div>
        </div>

        {/* Dicas — fica ao lado, nunca por cima da tabela */}
        <aside className={cn('w-56 shrink-0 border-l bg-muted/20 flex-col', compacto ? 'hidden' : 'hidden lg:flex')}>
          <div className="px-3 py-2 border-b flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dicas</span>
          </div>
          <ul className="p-3 space-y-2">
            {DICAS.map(dica => (
              <li key={dica} className="text-[11px] text-muted-foreground leading-snug flex gap-1.5">
                <span className="text-primary shrink-0">•</span>
                <span>{dica}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function LinhaEvento({ evento, onAbrirAtividade, selecionavel, marcado, onMarcar }: {
  evento: EventoAgenda;
  onAbrirAtividade?: (atividadeId: string) => void;
  selecionavel?: boolean;
  marcado?: boolean;
  onMarcar?: () => void;
}) {
  const Icone = ICONE[evento.categoria];
  const clicavel = !!(evento.atividadeId && onAbrirAtividade);
  const prioridade = evento.prioridade ? PRIORIDADE_LABEL[evento.prioridade] || evento.prioridade.toUpperCase() : null;
  // Há grupo cujo nome é só o código do caso ("CASO 347"): repetir isso ao lado
  // do badge não informa nada. Nesse caso a coluna Cliente fica vazia.
  const mesmoTexto = (a?: string | null, b?: string | null) =>
    (a || '').replace(/\s+/g, ' ').trim().toLowerCase() === (b || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const cliente = mesmoTexto(evento.cliente, evento.casoBadge) ? null : evento.cliente;

  return (
    <tr
      className={cn('align-top transition-colors', clicavel && 'cursor-pointer hover:bg-muted/50', marcado && 'bg-primary/5')}
      onClick={clicavel ? () => onAbrirAtividade!(evento.atividadeId!) : undefined}
      title={clicavel ? 'Abrir a atividade' : undefined}
    >
      {selecionavel && (
        <td className="pl-3 pr-1 py-2" onClick={e => e.stopPropagation()}>
          {evento.atividadeId
            ? <Checkbox checked={!!marcado} onCheckedChange={() => onMarcar?.()} aria-label="Marcar atividade" />
            : null}
        </td>
      )}
      <td className="px-3 py-2">
        <div className="flex items-start gap-1.5">
          <span className={cn('mt-1 h-3 w-1 rounded-full shrink-0', TARJA[evento.categoria])} />
          <div className="min-w-0">
            {/* O código do caso é como a equipe conversa ("PREV 704"); o número
                do processo vem embaixo, e some quando não existe. */}
            {evento.casoBadge && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold">
                {evento.casoBadge}
              </Badge>
            )}
            {evento.processo
              ? <span className="block font-mono text-[10px] leading-tight truncate max-w-[16rem] text-muted-foreground" title={evento.processo}>{evento.processo}</span>
              : !evento.casoBadge && (
                // Nem processo, nem caso, nem cliente: existe assim no banco.
                // Dizer isso é melhor que um travessão, que parece falha de tela.
                <span className="italic text-muted-foreground" title="Atividade sem processo, caso ou cliente vinculado">
                  sem vínculo
                </span>
              )}
          </div>
        </div>
      </td>
      <td className="px-2 py-2">
        {cliente
          ? <span title={evento.clienteBruto || undefined}>{cliente}</span>
          : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-start gap-1.5">
          <Icone className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', COR[evento.categoria])} />
          <div className="min-w-0">
            <span className="leading-tight">{evento.evento}</span>
            {evento.situacao && (
              <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-4 border-destructive/40 text-destructive uppercase">
                {evento.situacao}
              </Badge>
            )}
            {evento.local && (
              <span className="block text-[10px] text-muted-foreground truncate">{evento.local}</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        {format(parseISO(evento.dataEvento), 'dd/MM/yyyy')}
        {evento.horaEvento
          ? <span className="font-medium"> {evento.horaEvento}</span>
          : <span className="block text-[10px] text-muted-foreground">sem horário</span>}
      </td>
      <td className="px-2 py-2">
        {evento.atividade
          ? (
            <div className="min-w-0">
              <span className="leading-tight">{evento.atividade}</span>
              {evento.responsaveisNomes.length > 0 && (
                <span className="block text-[10px] text-muted-foreground truncate">
                  {evento.responsaveisNomes.slice(0, 2).join(', ')}
                  {evento.responsaveisNomes.length > 2 ? ` +${evento.responsaveisNomes.length - 2}` : ''}
                </span>
              )}
            </div>
          )
          : (
            <span className="text-muted-foreground flex items-center gap-1">
              sem atividade
              {evento.semResponsavel && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 gap-0.5 border-amber-500/40 text-amber-600 dark:text-amber-400">
                  <UserX className="h-2.5 w-2.5" /> sem dono
                </Badge>
              )}
            </span>
          )}
      </td>
      <td className="px-3 py-2">
        {prioridade
          ? (
            <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 h-4 font-bold', PRIORIDADE_ESTILO[evento.prioridade || ''] || '')}>
              {prioridade}
            </Badge>
          )
          : <span className="text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}

/**
 * O mesmo evento em uma linha, para quando a agenda divide a tela com a ficha.
 *
 * A ordem do que aparece segue a pergunta que a pessoa faz na véspera: de qual
 * caso é, o que é e quando, e só então qual atividade dá conta disso.
 */
function CartaoEvento({ evento, onAbrirAtividade, selecionavel, marcado, onMarcar }: {
  evento: EventoAgenda;
  onAbrirAtividade?: (atividadeId: string) => void;
  selecionavel?: boolean;
  marcado?: boolean;
  onMarcar?: () => void;
}) {
  const Icone = ICONE[evento.categoria];
  const clicavel = !!(evento.atividadeId && onAbrirAtividade);
  const prioridade = evento.prioridade ? PRIORIDADE_LABEL[evento.prioridade] || evento.prioridade.toUpperCase() : null;
  const identificacao = evento.cliente || evento.processo;

  return (
    <li
      className={cn('flex gap-2 px-3 py-2 transition-colors', clicavel && 'cursor-pointer hover:bg-muted/50', marcado && 'bg-primary/5')}
      onClick={clicavel ? () => onAbrirAtividade!(evento.atividadeId!) : undefined}
      title={clicavel ? 'Abrir a atividade' : undefined}
    >
      {selecionavel && (
        <span className="pt-0.5" onClick={e => e.stopPropagation()}>
          {evento.atividadeId
            ? <Checkbox checked={!!marcado} onCheckedChange={() => onMarcar?.()} aria-label="Marcar atividade" />
            : <span className="block w-4" />}
        </span>
      )}
      <span className={cn('mt-1 h-3 w-1 rounded-full shrink-0', TARJA[evento.categoria])} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-start gap-1.5">
          {evento.casoBadge && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-semibold shrink-0">
              {evento.casoBadge}
            </Badge>
          )}
          <Icone className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', COR[evento.categoria])} />
          <span className="text-xs leading-tight min-w-0 flex-1">{evento.evento}</span>
          <span className="text-[11px] tabular-nums shrink-0 text-muted-foreground">
            {format(parseISO(evento.dataEvento), 'dd/MM')}
            {evento.horaEvento && <strong className="text-foreground"> {evento.horaEvento}</strong>}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground truncate" title={evento.clienteBruto || evento.processo || undefined}>
          {identificacao || <span className="italic">sem vínculo</span>}
        </p>

        <div className="flex items-start gap-1.5">
          <span className="text-[11px] min-w-0 flex-1 truncate">
            {evento.atividade || <span className="text-muted-foreground">sem atividade</span>}
            {evento.responsaveisNomes.length > 0 && (
              <span className="text-muted-foreground"> · {evento.responsaveisNomes[0]}
                {evento.responsaveisNomes.length > 1 ? ` +${evento.responsaveisNomes.length - 1}` : ''}</span>
            )}
          </span>
          {evento.situacao && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 border-destructive/40 text-destructive uppercase">
              {evento.situacao}
            </Badge>
          )}
          {!evento.atividade && evento.semResponsavel && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 gap-0.5 shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400">
              <UserX className="h-2.5 w-2.5" /> sem dono
            </Badge>
          )}
          {prioridade && (
            <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 h-4 font-bold shrink-0', PRIORIDADE_ESTILO[evento.prioridade || ''] || '')}>
              {prioridade}
            </Badge>
          )}
        </div>
      </div>
    </li>
  );
}
