/**
 * Histórico de continuidade de uma atividade.
 *
 * Quem clica em "Concluir + próxima" está dizendo uma de duas coisas: (a) a
 * atividade não acabou de verdade, ainda falta etapa, ou (b) ela gerou um
 * desdobramento. Antes isso não deixava rastro: a próxima nascia como cópia
 * solta e ninguém conseguia caminhar da primeira até a última.
 *
 * Aqui a sequência inteira aparece em ordem, com a atividade aberta destacada,
 * e cada item abre a ficha AO LADO (skill `ui-sem-redirecionar`) — nunca
 * redireciona, nunca abre aba nova.
 *
 * Funciona mesmo sem lead/caso/processo vinculado: o vínculo é atividade →
 * atividade (`parent_activity_id` / `chain_root_id`), então atividade interna
 * também tem cadeia.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, CornerDownRight, PanelRightOpen, History, AlertTriangle } from 'lucide-react';

/** Colunas que a cadeia realmente usa — `select('*')` aqui seria peso à toa. */
const CHAIN_COLUMNS =
  'id, title, status, activity_type, created_at, completed_at, completed_by_name, ' +
  'assigned_to_name, deadline, feedback, next_steps, parent_activity_id, chain_root_id, ' +
  'lead_name, case_title, process_title, is_system';

export interface ChainActivity {
  id: string;
  title: string | null;
  status: string | null;
  activity_type: string | null;
  created_at: string;
  completed_at: string | null;
  completed_by_name: string | null;
  assigned_to_name: string | null;
  deadline: string | null;
  feedback: string | null;
  next_steps: string | null;
  parent_activity_id: string | null;
  chain_root_id: string | null;
  lead_name: string | null;
  case_title: string | null;
  process_title: string | null;
  is_system: boolean | null;
}

/** Atividade mínima que o hook precisa pra localizar a cadeia. */
export interface ChainAnchor {
  id: string;
  parent_activity_id?: string | null;
  chain_root_id?: string | null;
}

export interface ActivityChainResult {
  items: ChainActivity[];
  loading: boolean;
  /** Migration da cadeia ainda não aplicada neste banco (coluna inexistente). */
  unavailable: boolean;
  reload: () => void;
}

/** Postgres 42703 = undefined_column. Banco sem a migration não pode quebrar a ficha. */
const isMissingColumn = (err: unknown) =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === '42703';

/**
 * Carrega a cadeia inteira em UMA query, a partir da raiz — subir de pai em pai
 * seria N+1 dentro de um painel que abre junto com a ficha.
 */
export function useActivityChain(activity: ChainAnchor | null | undefined): ActivityChainResult {
  const [items, setItems] = useState<ChainActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [tick, setTick] = useState(0);

  const activityId = activity?.id ?? null;
  // A raiz é `chain_root_id` quando a atividade é um elo; quando ela é a
  // primeira da cadeia, a raiz é ela mesma.
  const rootId = activity?.chain_root_id || activityId;

  useEffect(() => {
    if (!activityId || !rootId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await externalSupabase
        .from('lead_activities')
        .select(CHAIN_COLUMNS)
        // A raiz não guarda chain_root_id (fica NULL) — por isso o `id.eq`.
        .or(`chain_root_id.eq.${rootId},id.eq.${rootId}`)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (error) {
        if (isMissingColumn(error)) {
          setUnavailable(true);
          setItems([]);
        } else {
          console.warn('[useActivityChain] falha ao carregar a cadeia', error);
          setItems([]);
        }
        setLoading(false);
        return;
      }

      setUnavailable(false);
      setItems((data || []) as unknown as ChainActivity[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activityId, rootId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Cadeia de 1 item = a própria atividade sozinha, sem continuidade nenhuma.
  // Não é histórico — some da aba pra não sugerir que existe sequência.
  const visible = useMemo(() => (items.length > 1 ? items : []), [items]);

  return { items: visible, loading, unavailable, reload };
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  reagendada: 'Reagendada',
};

const STATUS_CLASS: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  em_andamento: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  concluida: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  reagendada: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
};

const fmt = (iso: string | null) => {
  if (!iso) return null;
  try { return format(parseISO(iso), 'dd/MM/yyyy HH:mm'); } catch { return null; }
};

/** Primeiras linhas de um campo rico, sem HTML — só pra dar contexto no item. */
const excerpt = (value: string | null, max = 160) => {
  if (!value) return null;
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

interface ActivityChainPanelProps {
  /** Atividade aberta na ficha — vira o item destacado da cadeia. */
  currentActivityId: string | null;
  items: ChainActivity[];
  loading: boolean;
  unavailable: boolean;
  /** Abre a atividade clicada AO LADO, empilhada. Nunca redireciona. */
  onOpenActivity: (activityId: string) => void;
}

export function ActivityChainPanel({
  currentActivityId,
  items,
  loading,
  unavailable,
  onOpenActivity,
}: ActivityChainPanelProps) {
  if (loading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span>
          O histórico de continuidade ainda não está disponível neste banco — falta aplicar a
          migration <code className="text-[10px]">lead_activities_cadeia_continuidade</code>.
        </span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground">
        <History className="h-6 w-6 opacity-40" />
        <p className="max-w-xs">
          Esta atividade ainda não faz parte de uma sequência.
          <br />
          Ao usar <strong>“Concluir + próxima”</strong>, a atividade criada fica ligada a esta e
          as duas passam a aparecer aqui, em ordem.
        </p>
      </div>
    );
  }

  const currentIndex = items.findIndex((a) => a.id === currentActivityId);

  return (
    <div className="space-y-3 py-1">
      <p className="text-xs text-muted-foreground">
        {items.length} atividades nesta sequência
        {currentIndex >= 0 && ` — você está na ${currentIndex + 1}ª`}. Clique em qualquer uma para
        abrir a ficha aqui do lado.
      </p>

      <ol className="relative space-y-2 pl-6">
        {/* Linha do tempo vertical, atrás dos marcadores */}
        <span
          aria-hidden
          className="absolute left-[9px] top-2 bottom-2 w-px bg-border"
        />

        {items.map((item, i) => {
          const isCurrent = item.id === currentActivityId;
          const done = item.status === 'concluida';
          const statusKey = item.status || 'pendente';
          const created = fmt(item.created_at);
          const completed = fmt(item.completed_at);
          // Na atividade concluída, o que interessa pro próximo passo é o
          // feedback/próximo passo — é ali que está o "o que ainda falta".
          const note = excerpt(item.feedback) || excerpt(item.next_steps);
          const context = item.process_title || item.case_title || item.lead_name;

          return (
            <li key={item.id} className="relative">
              {/* Marcador na linha do tempo */}
              <span
                aria-hidden
                className={cn(
                  'absolute -left-6 top-3 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background',
                  done ? 'border-emerald-500 text-emerald-600' : 'border-muted-foreground/40 text-muted-foreground',
                  isCurrent && 'border-primary text-primary',
                )}
              >
                {done
                  ? <CheckCircle2 className="h-3 w-3" />
                  : <Circle className="h-2.5 w-2.5" />}
              </span>

              <button
                type="button"
                onClick={() => onOpenActivity(item.id)}
                disabled={isCurrent}
                title={isCurrent ? 'Você está nesta atividade' : 'Abrir esta atividade aqui do lado'}
                className={cn(
                  'group w-full rounded-md border p-2.5 text-left transition-colors',
                  isCurrent
                    ? 'border-primary/50 bg-primary/5 cursor-default'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50',
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-muted-foreground tabular-nums">
                    {i + 1}º
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium leading-snug break-words">
                        {item.title || 'Atividade sem assunto'}
                      </span>
                      <Badge className={cn('text-[9px] px-1.5 py-0 font-normal', STATUS_CLASS[statusKey])}>
                        {STATUS_LABEL[statusKey] || statusKey}
                      </Badge>
                      {isCurrent && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/50 text-primary">
                          você está aqui
                        </Badge>
                      )}
                    </div>

                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {completed
                        ? `Concluída em ${completed}${item.completed_by_name ? ` por ${item.completed_by_name}` : ''}`
                        : `Criada em ${created || '—'}${item.assigned_to_name ? ` · ${item.assigned_to_name}` : ''}`}
                    </p>

                    {context && (
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground/80" title={context}>
                        {context}
                      </p>
                    )}

                    {note && (
                      <p className="mt-1 flex gap-1 text-[10px] leading-snug text-muted-foreground">
                        <CornerDownRight className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                        <span>{note}</span>
                      </p>
                    )}
                  </div>

                  {!isCurrent && (
                    <PanelRightOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
