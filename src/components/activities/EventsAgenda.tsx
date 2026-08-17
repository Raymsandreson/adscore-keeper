import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarDays, ChevronLeft, ChevronRight, Gavel, Stethoscope, Timer,
  CircleDot, Lightbulb, Loader2, LayoutList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useEventosDaJanela } from '@/hooks/useEventosDaJanela';
import {
  CATEGORIAS, CATEGORIA_LABEL, contarPorCategoria, diaAnterior, diaSeguinte,
  janelaDaVespera, type CategoriaEvento, type EventoAgenda,
} from '@/lib/eventAgenda';

type Aba = 'todos' | CategoriaEvento;

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

const DICAS = [
  'Confira os detalhes e o local do evento',
  'Separe os documentos que vão ser usados',
  'Antecipe petições e alinhe a estratégia',
  'Avise o cliente com um dia de antecedência',
];

const hojeIso = () => format(new Date(), 'yyyy-MM-dd');

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
 */
export function EventsAgenda({ onAbrirAtividade }: {
  /** Abre a ficha da atividade em painel, por cima da tela (nunca redireciona). */
  onAbrirAtividade?: (atividadeId: string) => void;
}) {
  const [vespera, setVespera] = useState<string>(hojeIso);
  const [aba, setAba] = useState<Aba>('todos');

  const janela = useMemo(() => janelaDaVespera(vespera), [vespera]);
  const { eventos, isLoading, error } = useEventosDaJanela(janela);

  const contagem = useMemo(() => contarPorCategoria(eventos), [eventos]);
  const visiveis = useMemo(
    () => (aba === 'todos' ? eventos : eventos.filter(e => e.categoria === aba)),
    [eventos, aba],
  );

  const abas: { id: Aba; rotulo: string; total: number }[] = [
    { id: 'todos', rotulo: 'Todos', total: eventos.length },
    ...CATEGORIAS.map(c => ({ id: c as Aba, rotulo: CATEGORIA_LABEL[c], total: contagem[c] })),
  ];

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

          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Véspera</span>
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
          </div>
        </div>
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          Mostra o que acontece <strong>no dia seguinte</strong> à data escolhida — para preparar na véspera.
          {janela.length > 1 && (
            <> Como o dia seguinte cai no fim de semana, a janela vai até{' '}
              <strong>{diaCurto(janela[janela.length - 1])}</strong>: o próximo dia útil também
              precisa de véspera.</>
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
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Processo</th>
                    <th className="px-2 py-1.5 font-medium">Cliente</th>
                    <th className="px-2 py-1.5 font-medium">Evento</th>
                    <th className="px-2 py-1.5 font-medium whitespace-nowrap">Data do evento</th>
                    <th className="px-2 py-1.5 font-medium">Atividade</th>
                    <th className="px-3 py-1.5 font-medium">Prioridade</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visiveis.map(evento => (
                    <LinhaEvento key={evento.chave} evento={evento} onAbrirAtividade={onAbrirAtividade} />
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>

          <div className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {visiveis.length} evento{visiveis.length !== 1 ? 's' : ''} encontrado{visiveis.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Dicas — fica ao lado, nunca por cima da tabela */}
        <aside className="hidden lg:flex w-56 shrink-0 border-l bg-muted/20 flex-col">
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

function LinhaEvento({ evento, onAbrirAtividade }: {
  evento: EventoAgenda;
  onAbrirAtividade?: (atividadeId: string) => void;
}) {
  const Icone = ICONE[evento.categoria];
  const clicavel = !!(evento.atividadeId && onAbrirAtividade);
  const prioridade = evento.prioridade ? PRIORIDADE_LABEL[evento.prioridade] || evento.prioridade.toUpperCase() : null;

  return (
    <tr
      className={cn('align-top transition-colors', clicavel && 'cursor-pointer hover:bg-muted/50')}
      onClick={clicavel ? () => onAbrirAtividade!(evento.atividadeId!) : undefined}
      title={clicavel ? 'Abrir a atividade' : undefined}
    >
      <td className="px-3 py-2">
        <div className="flex items-start gap-1.5">
          <span className={cn('mt-1 h-3 w-1 rounded-full shrink-0', TARJA[evento.categoria])} />
          <span className="font-mono text-[11px] leading-tight break-all">{evento.processo || '—'}</span>
        </div>
      </td>
      <td className="px-2 py-2">{evento.cliente || <span className="text-muted-foreground">—</span>}</td>
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
              {evento.responsavel && (
                <span className="block text-[10px] text-muted-foreground truncate">{evento.responsavel}</span>
              )}
            </div>
          )
          : <span className="text-muted-foreground">sem atividade</span>}
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
