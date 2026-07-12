import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Gavel, CalendarClock, Stethoscope, Timer, FileText, CircleDot,
  ExternalLink, ClipboardPlus, MessageCircle,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useProcessUpdates, type UpdateCategoria, type ProcessUpdate } from '@/hooks/useProcessUpdates';
import { useLeadActivities } from '@/hooks/useLeadActivities';

interface CategoriaStyle {
  label: string;
  icon: typeof Gavel;
  badge: string;
  dot: string;
  borda?: string;
}

const CATEGORIAS: Record<UpdateCategoria, CategoriaStyle> = {
  decisao_merito: {
    label: 'Decisão de mérito',
    icon: Gavel,
    badge: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-700',
    dot: 'bg-purple-500',
    borda: 'border-l-purple-500',
  },
  audiencia: {
    label: 'Audiência',
    icon: CalendarClock,
    badge: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300 dark:border-green-700',
    dot: 'bg-green-500',
    borda: 'border-l-green-500',
  },
  pericia: {
    label: 'Perícia',
    icon: Stethoscope,
    badge: 'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-700',
    dot: 'bg-cyan-500',
    borda: 'border-l-cyan-500',
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

const TIPO_ATV: Partial<Record<UpdateCategoria, string>> = {
  audiencia: 'audiencia',
  pericia: 'audiencia',
  prazo: 'prazo',
};

function fmtData(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
}

function buildClientMessage(u: ProcessUpdate): string {
  const style = CATEGORIAS[u.categoria] || CATEGORIAS.movimentacao;
  const linhas = [
    '⚖️ *Atualização no seu processo*',
    u.numero_cnj ? `📌 Processo: ${u.numero_cnj}` : null,
    u.processo_titulo ? `📁 ${u.processo_titulo}` : null,
    `🗂️ ${style.label}${u.data_movimentacao ? ` — ${fmtData(u.data_movimentacao)}` : ''}`,
    u.descricao ? `\n${u.descricao}` : null,
    '\nQualquer dúvida, estamos à disposição. 💚',
  ];
  return linhas.filter(Boolean).join('\n');
}

function UpdateRow({
  update, unread, onOpenProcess, onCreateActivity, onCopyMessage, onMarkRead,
}: {
  update: ProcessUpdate;
  unread: boolean;
  onOpenProcess: (u: ProcessUpdate) => void;
  onCreateActivity: (u: ProcessUpdate) => void;
  onCopyMessage: (u: ProcessUpdate) => void;
  onMarkRead: (u: ProcessUpdate) => void;
}) {
  const style = CATEGORIAS[update.categoria] || CATEGORIAS.movimentacao;
  const Icon = style.icon;
  const dataMov = fmtData(update.data_movimentacao);

  return (
    <div
      className={cn(
        'px-3 py-2.5 border-b last:border-b-0',
        unread && 'bg-accent/40',
        style.borda && 'border-l-2',
        style.borda,
      )}
      onClick={() => unread && onMarkRead(update)}
    >
      <div className="flex gap-2.5">
        <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', unread ? style.dot : 'bg-transparent border border-border')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1 font-medium', style.badge)}>
              <Icon className="h-3 w-3" />
              {style.label}
            </Badge>
            {dataMov && <span className="text-[10px] text-muted-foreground">{dataMov}</span>}
            {unread && <span className="text-[9px] font-semibold text-primary uppercase">novo</span>}
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
          <div className="flex gap-1 mt-1.5">
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
              onClick={(e) => { e.stopPropagation(); onOpenProcess(update); }}
            >
              <ExternalLink className="h-3 w-3" />
              Processo
            </Button>
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
              onClick={(e) => { e.stopPropagation(); onCreateActivity(update); }}
            >
              <ClipboardPlus className="h-3 w-3" />
              Criar atv
            </Button>
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
              onClick={(e) => { e.stopPropagation(); onCopyMessage(update); }}
            >
              <MessageCircle className="h-3 w-3" />
              Msg cliente
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProcessUpdatesBell({ compact = false }: { compact?: boolean }) {
  const { updates, loading, unreadCount, readIds, markRead, markAllRead } = useProcessUpdates();
  const { createActivity } = useLeadActivities();
  const navigate = useNavigate();
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

  const handleOpenProcess = (u: ProcessUpdate) => {
    markRead(u.id);
    setOpen(false);
    navigate(`/processes?openProcess=${u.process_id}`);
  };

  const handleCreateActivity = async (u: ProcessUpdate) => {
    const style = CATEGORIAS[u.categoria] || CATEGORIAS.movimentacao;
    try {
      const created = await createActivity({
        title: `${style.label} — ${u.processo_titulo || u.numero_cnj || 'processo'}`,
        description: [
          u.descricao,
          u.data_movimentacao ? `📌 Movimentação de ${fmtData(u.data_movimentacao)}.` : null,
          u.numero_cnj ? `⚖️ Processo ${u.numero_cnj}.` : null,
        ].filter(Boolean).join('\n\n'),
        activity_type: TIPO_ATV[u.categoria] || 'tarefa',
        priority: u.categoria === 'movimentacao' ? 'normal' : 'alta',
        process_id: u.process_id,
        process_title: u.processo_titulo || u.numero_cnj || null,
        lead_id: u.lead_id,
        case_id: u.case_id,
      });
      if (created) {
        markRead(u.id);
        toast.success('Atividade criada a partir da atualização');
      }
    } catch (err) {
      console.error('Error creating activity from update:', err);
    }
  };

  const handleCopyMessage = async (u: ProcessUpdate) => {
    const ok = await copyTextToClipboard(buildClientMessage(u));
    if (ok) {
      markRead(u.id);
      toast.success('Mensagem copiada — cole no WhatsApp do cliente ou grupo');
    } else {
      toast.error('Não foi possível copiar a mensagem');
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
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
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-[440px] sm:max-w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b space-y-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Atualizações processuais</SheetTitle>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 mr-6" onClick={markAllRead}>
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar lidas
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto shrink-0">
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
        <ScrollArea className="flex-1">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhuma atualização{filtro !== 'todas' ? ' nessa categoria' : ''}.
            </p>
          ) : (
            filtered.map((u) => (
              <UpdateRow
                key={u.id}
                update={u}
                unread={!readIds.has(u.id)}
                onOpenProcess={handleOpenProcess}
                onCreateActivity={handleCreateActivity}
                onCopyMessage={handleCopyMessage}
                onMarkRead={(upd) => markRead(upd.id)}
              />
            ))
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
