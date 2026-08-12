/**
 * Cadastros por período (5 últimos dias / semanas / meses / anos), separados
 * entre com e sem lead.
 *
 * As roscas ao lado dizem "de que tipo é essa gente"; faltava o "quanto entrou",
 * a pergunta de quem filtra por quem cadastrou (ou por cidade) e quer medir
 * ritmo. Cada barra é um período; a parte azul é contato que já virou lead, a
 * cinza é contato parado no cadastro.
 *
 * Por que a conta vem do banco e não da lista em tela (como as roscas): a lista
 * carrega no máximo 1000 contatos. Em "dia" isso quase sempre cobre a janela,
 * mas julho/2026 sozinho teve 8.632 cadastros — contar no browser mostraria um
 * mês pela metade sem avisar. A RPC `contacts_creation_series` recebe os mesmos
 * filtros da tela e devolve 5 linhas prontas.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db } from '@/integrations/supabase';
import { cn } from '@/lib/utils';

const BUCKETS = 5;
const WITH_LEAD = '#3b82f6';
const WITHOUT_LEAD = '#94a3b8';

type Period = 'day' | 'week' | 'month' | 'year';

const PERIODS: { value: Period; label: string; title: string }[] = [
  { value: 'day', label: 'Dia', title: 'Últimos 5 dias' },
  { value: 'week', label: 'Semana', title: 'Últimas 5 semanas' },
  { value: 'month', label: 'Mês', title: 'Últimos 5 meses' },
  { value: 'year', label: 'Ano', title: 'Últimos 5 anos' },
];

/** Filtros da tela, do jeito que a RPC espera (mesmos nomes do `fetchContacts`). */
export interface CreationSeriesFilters {
  state?: string;
  city?: string;
  actionSource?: string;
  createdBy?: string;
  /** Vazio = todos; `['none']` = sem classificação. */
  classifications?: string[];
  /** Com vários: 'any' = qualquer um, 'all' = todos ao mesmo tempo. */
  classificationMode?: 'any' | 'all';
  groupFilter?: 'all' | 'with_group' | 'without_group';
  leadLinked?: 'all' | 'linked' | 'not_linked';
  /** `null` = "sem profissão"; `undefined` = não filtrado. */
  profession?: string | null;
  search?: string;
}

interface Props {
  filters: CreationSeriesFilters;
  className?: string;
}

interface Row {
  label: string;
  full: string;
  comLead: number;
  semLead: number;
  total: number;
}

/** Rótulo curto — eixo apertado não comporta "quarta 05/08" em 5 barras. */
function labelFor(period: Period, start: Date) {
  if (period === 'day') return format(start, 'dd/MM', { locale: ptBR });
  if (period === 'week') return format(start, "'sem' dd/MM", { locale: ptBR });
  if (period === 'month') return format(start, 'MMM/yy', { locale: ptBR });
  return format(start, 'yyyy', { locale: ptBR });
}

/** Rótulo por extenso do tooltip. */
function fullLabelFor(period: Period, start: Date) {
  if (period === 'day') return format(start, "EEEE, dd 'de' MMMM", { locale: ptBR });
  if (period === 'week') return `Semana de ${format(start, "dd 'de' MMMM", { locale: ptBR })}`;
  if (period === 'month') return format(start, "MMMM 'de' yyyy", { locale: ptBR });
  return format(start, 'yyyy', { locale: ptBR });
}

export function ContactsCreationTrendBars({ filters, className }: Props) {
  const [period, setPeriod] = useState<Period>('day');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const {
    state, city, actionSource, createdBy, classifications, classificationMode,
    groupFilter, leadLinked, profession, search,
  } = filters;

  // Array novo a cada render do pai quebraria o useEffect; a chave estável é a
  // lista serializada.
  const classificationKey = (classifications || []).join('|');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { data, error } = await (db as any).rpc('contacts_creation_series', {
          p_bucket: period,
          p_buckets: BUCKETS,
          p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
          p_state: state && state !== 'all' ? state : null,
          p_city: city && city !== 'all' ? city : null,
          p_source: actionSource && actionSource !== 'all' ? actionSource : null,
          p_created_by: createdBy && createdBy !== 'all' ? createdBy : null,
          p_classifications: classifications && classifications.length > 0 ? classifications : null,
          p_classification_mode: classificationMode === 'all' ? 'all' : 'any',
          p_group: groupFilter && groupFilter !== 'all' ? groupFilter : null,
          p_lead_linked: leadLinked && leadLinked !== 'all' ? leadLinked : null,
          p_profession: profession === undefined ? null : (profession === null ? '__none__' : profession),
          p_search: search?.trim() || null,
        });
        if (error) throw error;
        if (cancelled) return;

        setRows(((data || []) as any[]).map((r) => {
          const start = new Date(r.bucket_start);
          const total = Number(r.total) || 0;
          const comLead = Number(r.with_lead) || 0;
          return {
            label: labelFor(period, start),
            full: fullLabelFor(period, start),
            comLead,
            semLead: total - comLead,
            total,
          };
        }));
        setFailed(false);
      } catch (err) {
        console.warn('[ContactsCreationTrendBars] falha ao carregar a série de cadastros', err);
        if (!cancelled) {
          setRows([]);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [period, state, city, actionSource, createdBy, classificationKey, classificationMode, groupFilter, leadLinked, profession, search]);

  const { total, withLead } = useMemo(() => ({
    total: rows.reduce((s, r) => s + r.total, 0),
    withLead: rows.reduce((s, r) => s + r.comLead, 0),
  }), [rows]);

  const periodTitle = PERIODS.find((p) => p.value === period)?.title ?? '';

  return (
    <div className={cn('rounded-lg border bg-card p-3 min-w-0', className)}>
      <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Cadastros por período</span>
        {loading ? (
          <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <span className="ml-auto shrink-0 tabular-nums">{total}</span>
        )}
      </div>

      <div className="flex items-center gap-0.5 mb-2 rounded-md bg-muted/60 p-0.5">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            title={p.title}
            onClick={() => setPeriod(p.value)}
            className={cn(
              'flex-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              period === p.value
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Não consegui carregar a série de cadastros
        </p>
      ) : total === 0 && !loading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Nenhum contato cadastrado no período
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-1">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: WITH_LEAD }} />
              Com lead <span className="tabular-nums">{withLead}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: WITHOUT_LEAD }} />
              Sem lead <span className="tabular-nums">{total - withLead}</span>
            </span>
          </div>

          <div className="h-[132px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  width={30}
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  labelFormatter={(_label, payload) => payload?.[0]?.payload?.full || ''}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="comLead" name="Com lead" stackId="p" fill={WITH_LEAD} isAnimationActive={false} />
                <Bar
                  dataKey="semLead"
                  name="Sem lead"
                  stackId="p"
                  fill={WITHOUT_LEAD}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="total"
                    position="top"
                    fontSize={9}
                    formatter={(v: number) => (v > 0 ? v : '')}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <p className="text-[10px] text-muted-foreground mt-2">
        {periodTitle}, com os filtros da tela. "Com lead" = já vinculado a um lead.
      </p>
    </div>
  );
}

export default ContactsCreationTrendBars;
