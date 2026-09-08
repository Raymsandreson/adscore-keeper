/**
 * Linha do tempo da atividade: criação, repasses, situação, edições.
 *
 * Complementa o `ActivityChainPanel` (que mostra a SEQUÊNCIA de atividades do
 * "Concluir + próxima"). Aqui é a vida de UMA atividade: quem criou, e por
 * quantas mãos ela passou — "Luana passou para Gisele, Gisele passou para
 * José" —, com data e a situação em que ela estava em cada repasse.
 *
 * Fonte: `lead_activity_audit_log` no Externo (trigger `log_activity_audit`).
 * Leitura pura: esta tela não escreve nada. RLS da tabela é
 * `auth.uid() is not null`, atendida pela sessão anônima do `externalSupabase`
 * — sem sessão a lista chega vazia, não com erro (ver
 * `docs/sistema/identidade-de-usuario.md`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ArrowRightLeft,
  CheckCircle2,
  History,
  Info,
  Pencil,
  PlusCircle,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '@/integrations/supabase';
import { useSharedFetch } from '@/lib/sharedFetch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  ACTIVITY_STATUS_CLASS,
  actorText,
  auditCoverageNotice,
  buildActivityHistory,
  statusLabel,
  type ActivityAuditRow,
  type ActivityEventKind,
  type ActivityHistoryEvent,
  type NameResolver,
} from '@/lib/activityHistory';

/** Colunas que a linha do tempo usa — `select('*')` traria `lead_id`/`case_id` à toa. */
const AUDIT_COLUMNS =
  'id, action, actor_id, actor_name, actor_kind, activity_title, old_status, new_status, changes, created_at';

/** Teto de segurança: a atividade com mais eventos hoje tem 17 (medido 08/09/2026). */
const MAX_EVENTS = 200;

/**
 * `lead_activity_audit_log` existe no banco desde 18/07/2026 mas não está no
 * `types.ts` gerado (o arquivo só é regerado pelo Lovable). Sem o cast, o
 * supabase-js recusa a tabela com TS2769 + TS2589 — mesmo idioma já usado em
 * `useLeadActivities` para `activity_time_entries`. Só leitura passa por aqui.
 */
const auditDb = db as unknown as SupabaseClient;

/** Postgres 42P01 = undefined_table — banco sem a tabela não pode quebrar a ficha. */
const isMissingTable = (err: unknown) =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === '42P01';

export interface ActivityAuditResult {
  rows: ActivityAuditRow[];
  loading: boolean;
  unavailable: boolean;
  reload: () => void;
}

export function useActivityAuditTrail(activityId: string | null | undefined): ActivityAuditResult {
  const [rows, setRows] = useState<ActivityAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!activityId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await auditDb
        .from('lead_activity_audit_log')
        .select(AUDIT_COLUMNS)
        .eq('activity_id', activityId)
        .order('created_at', { ascending: true })
        .limit(MAX_EVENTS);

      if (cancelled) return;

      if (error) {
        if (isMissingTable(error)) {
          setUnavailable(true);
        } else {
          console.warn('[useActivityAuditTrail] falha ao carregar o histórico', error);
        }
        setRows([]);
        setLoading(false);
        return;
      }

      setUnavailable(false);
      setRows((data || []) as unknown as ActivityAuditRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activityId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, loading, unavailable, reload };
}

interface ExternalName { id: string; user_id: string | null; full_name: string | null }
const NO_NAMES: ExternalName[] = [];

/**
 * Nomes da equipe pelo UUID do Externo.
 *
 * Duas chaves de propósito: parte da equipe aparece no audit pelo `profiles.id`
 * e parte pelo `user_id` (são valores diferentes para o mesmo perfil — ver a
 * memória "Luana tem dois UUIDs"). Filtrar por `full_name` não nulo mantém a
 * query em ~52 linhas: `profiles` do Externo tem 6.123, o resto é perfil
 * descartável de sessão anônima.
 */
function useExternalTeamNames(): Map<string, string> {
  const { data } = useSharedFetch<ExternalName[]>(
    'external_profile_names',
    async () => {
      const { data, error } = await db
        .from('profiles')
        .select('id, user_id, full_name')
        .not('full_name', 'is', null);
      if (error) throw error;
      return (data as ExternalName[]) || NO_NAMES;
    },
    NO_NAMES,
  );

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const p of data) {
      if (!p.full_name) continue;
      if (p.id) map.set(p.id, p.full_name);
      if (p.user_id) map.set(p.user_id, p.full_name);
    }
    return map;
  }, [data]);
}

const EVENT_ICON: Record<ActivityEventKind, typeof History> = {
  created: PlusCircle,
  handoff: ArrowRightLeft,
  coassignees: Users,
  status: CheckCircle2,
  title: Pencil,
  edited: Pencil,
  deleted: Trash2,
  restored: RotateCcw,
};

const EVENT_TONE: Record<ActivityEventKind, string> = {
  created: 'border-primary/50 text-primary',
  handoff: 'border-blue-500/60 text-blue-600 dark:text-blue-400',
  coassignees: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  status: 'border-emerald-500/60 text-emerald-600 dark:text-emerald-400',
  title: 'border-muted-foreground/40 text-muted-foreground',
  edited: 'border-muted-foreground/40 text-muted-foreground',
  deleted: 'border-destructive/60 text-destructive',
  restored: 'border-amber-500/60 text-amber-600 dark:text-amber-400',
};

const fmt = (iso: string) => {
  try { return format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm"); } catch { return iso; }
};

interface ActivityMovementsPanelProps {
  activityId: string | null | undefined;
  /** `created_at` da atividade — diz se ela é anterior ao início do audit. */
  activityCreatedAt?: string | null;
  /** Resolvedor de nome do chamador (teamMembers do Cloud + remap). */
  resolveUserName?: NameResolver;
}

export function ActivityMovementsPanel({
  activityId,
  activityCreatedAt,
  resolveUserName,
}: ActivityMovementsPanelProps) {
  const { rows, loading, unavailable } = useActivityAuditTrail(activityId);
  const externalNames = useExternalTeamNames();

  const resolve = useCallback<NameResolver>(
    (uuid) => {
      if (!uuid) return null;
      return externalNames.get(uuid) || resolveUserName?.(uuid) || null;
    },
    [externalNames, resolveUserName],
  );

  const events = useMemo(() => buildActivityHistory(rows, resolve), [rows, resolve]);
  const handoffs = useMemo(() => events.filter((e) => e.kind === 'handoff'), [events]);
  const notice = auditCoverageNotice(activityCreatedAt, { hasHandoff: handoffs.length > 0 });

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (unavailable) {
    return (
      <p className="py-4 text-xs text-muted-foreground">
        O registro de movimentações ainda não existe neste banco (tabela{' '}
        <code className="text-[10px]">lead_activity_audit_log</code>).
      </p>
    );
  }

  return (
    <section className="space-y-3 py-1">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium">Movimentações</h3>
        {handoffs.length > 0 && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
            {handoffs.length} {handoffs.length === 1 ? 'repasse' : 'repasses'}
          </Badge>
        )}
      </header>

      {notice && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0 text-amber-600" />
          <span>{notice}</span>
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhuma movimentação registrada para esta atividade.
        </p>
      ) : (
        <ol className="relative space-y-2 pl-6">
          <span aria-hidden className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
          {events.map((event) => (
            <MovementItem key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

function MovementItem({ event }: { event: ActivityHistoryEvent }) {
  const Icon = EVENT_ICON[event.kind];
  const situacao = statusLabel(event.status);
  const quem = actorText(event.actor, event.actorKind);

  return (
    <li className="relative">
      <span
        aria-hidden
        className={cn(
          'absolute -left-6 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-background',
          EVENT_TONE[event.kind],
        )}
      >
        <Icon className="h-3 w-3" />
      </span>

      <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
        <p className="text-xs font-medium leading-snug">{event.text}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
          <span>{fmt(event.at)}</span>
          <span aria-hidden>·</span>
          <span
            className={cn(event.actor ? '' : 'italic')}
            title={
              event.actor
                ? undefined
                : event.actorKind === 'routine'
                  ? 'Alteração feita por rotina do servidor, que roda sem usuário logado'
                  : event.actorKind === 'ai'
                    ? 'Gerada pela IA'
                    : 'Alteração feita pelo app sem usuário identificado na sessão'
            }
          >
            por {quem}
          </span>
          {situacao && (
            <>
              <span aria-hidden>·</span>
              <Badge
                variant="secondary"
                className={cn(
                  'h-4 px-1.5 text-[9px] font-normal',
                  ACTIVITY_STATUS_CLASS[event.status || ''] || '',
                )}
              >
                {situacao}
              </Badge>
            </>
          )}
        </div>
        {event.detail && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{event.detail}</p>
        )}
      </div>
    </li>
  );
}

export default ActivityMovementsPanel;
