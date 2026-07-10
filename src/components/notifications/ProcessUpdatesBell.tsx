import { useMemo, useState } from 'react';
import { Bell, CheckCheck, Gavel, CalendarClock, Stethoscope, Timer, FileText, CircleDot } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useProcessUpdates, type UpdateCategoria, type ProcessUpdate } from '@/hooks/useProcessUpdates';

interface CategoriaStyle {
  label: string;
  icon: typeof Gavel;
  badge: string;
  dot: string;
  destaque?: boolean;
}

const CATEGORIAS: Record<UpdateCategoria, CategoriaStyle> = {
  decisao_merito: {
    label: 'Decisão de mérito',
    icon: Gavel,
    badge: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-700',
    dot: 'bg-purple-500',
    destaque: true,
  },
  audiencia: {
    label: 'Audiência',
    icon: CalendarClock,
    badge: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300 dark:border-green-700',
    dot: 'bg-green-500',
    destaque: true,
  },
  pericia: {
    label: 'Perícia',
    icon: Stethoscope,
    badge: 'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-700',
    dot: 'bg-cyan-500',
    destaque: true,
  },
  prazo: {
    label: 'Prazo / intimação',
    icon: Timer,
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-700',
    dot: 'bg-yellow-500',
  },
  despacho: {
    label: 'Despacho',
    icon: FileText,
    badge: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-700',
    dot: 'bg-blue-500',
  },
  movimentacao: {
    label: 'Movimentação',
    icon: CircleDot,
    badge: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted-foreground/50',
  },
};

const FILTER_ORDER: Array<UpdateCategoria | 'todas'> = [
  'todas', 'decisao_merito', 'audiencia', 'pericia', 'prazo', 'despacho', 'movimentacao',
];

function UpdateRow({ update, unread }: { update: ProcessUpdate; unread: boolean }) {
  const style = CATEGORIAS[update.categoria] || CATEGORIAS.movimentacao;
  const Icon = style.icon;
  const dataMov = update.data_movimentacao
    ? format(parseISO(update.data_movimentacao), "dd/MM/yyyy", { locale: ptBR })
    : null;

  return (
    <div
      className={cn(
        'px-3 py-2.5 border-b last:border-b-0 flex gap-2.5',
        unread && 'bg-accent/40',
        style.destaque && 'border-l-2',
        style.destaque && update.categoria === 'decisao_merito' && 'border-l-purple-500',
        style.destaque && update.categoria === 'audiencia' && 'border-l-green-500',
        style.destaque && update.categoria === 'pericia' && 'border-l-cyan-500',
      )}
    >
      <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', style.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1 font-medium', style.badge)}>
            <Icon className="h-3 w-3" />
            {style.label}
          </Badge>
          {dataMov && <span className="text-[10px] text-muted-foreground">{dataMov}</span>}
        </div>
        <p className="text-xs font-medium mt-1 truncate">
          {update.processo_titulo || update.numero_cnj || 'Processo'}
        </p>
        {update.numero_cnj && update.processo_titulo && (
          <p className="text-[10px] text-muted-foreground font-mono truncate">{update.numero_cnj}</p>
        )}
        {update.descricao && (
          <p className={cn(
            'text-[11px] mt-0.5 line-clamp-2',
            update.categoria === 'movimentacao' ? 'text-muted-foreground/70' : 'text-muted-foreground',
          )}>
            {update.descricao}
          </p>
        )}
      </div>
    </div>
  );
}

export function ProcessUpdatesBell({ compact = false }: { compact?: boolean }) {
  const { updates, loading, unreadCount, lastSeen, markAllRead } = useProcessUpdates();
  const [filtro, setFiltro] = useState<UpdateCategoria | 'todas'>('todas');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => (filtro === 'todas' ? updates : updates.filter((u) => u.categoria === filtro)),
    [updates, filtro],
  );

  const countByCategoria = useMemo(() => {
    const acc = {} as Record<string, number>;
    for (const u of updates) acc[u.categoria] = (acc[u.categoria] || 0) + 1;
    return acc;
  }, [updates]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Atualizações processuais"
          title="Atualizações processuais"
          className={cn('relative shrink-0', compact ? 'h-8 w-8' : 'h-10 w-10')}
        >
          <Bell className={cn(compact ? 'h-4 w-4' : 'h-5 w-5', unreadCount > 0 && 'text-primary')} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[92vw] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Atualizações processuais</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar lidas
            </Button>
          )}
        </div>
        <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto">
          {FILTER_ORDER.map((cat) => {
            const active = filtro === cat;
            const label = cat === 'todas' ? 'Todas' : CATEGORIAS[cat].label;
            const count = cat === 'todas' ? updates.length : (countByCategoria[cat] || 0);
            if (cat !== 'todas' && count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setFiltro(cat)}
                className={cn(
                  'text-[11px] px-2 py-1 rounded-full border whitespace-nowrap transition-colors',
                  active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
                )}
              >
                {label} {count > 0 && <span className="opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>
        <ScrollArea className="h-[400px]">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhuma atualização{filtro !== 'todas' ? ' nessa categoria' : ''}.
            </p>
          ) : (
            filtered.map((u) => (
              <UpdateRow key={u.id} update={u} unread={!lastSeen || u.created_at > lastSeen} />
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
