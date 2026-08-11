/**
 * Cadastros por dia nos últimos 7 dias, separados entre com e sem lead.
 *
 * As roscas ao lado dizem "de que tipo é essa gente"; faltava o "quanto entrou
 * esta semana" — a pergunta de quem filtra por quem cadastrou (ou por cidade) e
 * quer medir ritmo. Cada barra é um dia; a parte azul é contato que já virou
 * lead, a cinza é contato parado no cadastro.
 *
 * A contagem lê os MESMOS contatos que estão na lista (respeita os filtros em
 * tela). O vínculo com lead vem de `contact_leads` — a mesma fonte do filtro
 * "Com Lead" — com `contacts.lead_id` (legado) como reforço, e só é consultado
 * para os contatos que caem na janela de 7 dias.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays } from 'lucide-react';
import { format, startOfDay, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db } from '@/integrations/supabase';
import { cn } from '@/lib/utils';

const DAYS = 7;
const WITH_LEAD = '#3b82f6';
const WITHOUT_LEAD = '#94a3b8';
/** `.in()` com lista gigante estoura a URL — vai em pedaços. */
const ID_CHUNK = 200;

/** Contato do jeito que o gráfico precisa — a lista passa o registro inteiro. */
export interface TrendContact {
  id: string;
  created_at: string;
  lead_id?: string | null;
}

interface Props {
  contacts: TrendContact[];
  /** A lista em tela é um recorte do total (paginação): avisa que dias antigos podem faltar. */
  partialList?: boolean;
  className?: string;
}

/** Chave do dia no fuso de quem olha — agrupar por UTC jogaria a madrugada pro dia errado. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ContactsCreationTrendBars({ contacts, partialList, className }: Props) {
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());

  const { windowContacts, windowStart, oldestLoaded } = useMemo(() => {
    const start = startOfDay(subDays(new Date(), DAYS - 1));
    let oldest: number | null = null;
    const inWindow: TrendContact[] = [];

    for (const c of contacts) {
      const ts = c.created_at ? new Date(c.created_at).getTime() : NaN;
      if (Number.isNaN(ts)) continue;
      if (oldest === null || ts < oldest) oldest = ts;
      if (ts >= start.getTime()) inWindow.push(c);
    }

    return { windowContacts: inWindow, windowStart: start, oldestLoaded: oldest };
  }, [contacts]);

  const windowKey = useMemo(
    () => windowContacts.map((c) => c.id).sort().join(','),
    [windowContacts]
  );

  // Vínculo com lead só dos contatos da janela — é um punhado, não a lista toda.
  useEffect(() => {
    if (!windowKey) {
      setLinkedIds(new Set());
      return;
    }
    const ids = windowKey.split(',');
    let cancelled = false;

    (async () => {
      try {
        const found = new Set<string>();
        for (let i = 0; i < ids.length; i += ID_CHUNK) {
          const { data } = await (db as any)
            .from('contact_leads')
            .select('contact_id')
            .in('contact_id', ids.slice(i, i + ID_CHUNK));
          for (const row of ((data || []) as { contact_id: string }[])) {
            if (row.contact_id) found.add(row.contact_id);
          }
        }
        if (!cancelled) setLinkedIds(found);
      } catch {
        console.warn('[ContactsCreationTrendBars] falha ao carregar vínculos de lead');
        if (!cancelled) setLinkedIds(new Set());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [windowKey]);

  const { data, total, withLead } = useMemo(() => {
    const buckets = new Map<string, { withLead: number; withoutLead: number }>();
    const base = startOfDay(new Date());
    const days: { key: string; label: string; full: string }[] = [];

    for (let i = DAYS - 1; i >= 0; i--) {
      const d = subDays(base, i);
      const key = dayKey(d);
      buckets.set(key, { withLead: 0, withoutLead: 0 });
      days.push({
        key,
        label: format(d, 'EEE dd/MM', { locale: ptBR }),
        full: format(d, "dd 'de' MMMM", { locale: ptBR }),
      });
    }

    for (const c of windowContacts) {
      const bucket = buckets.get(dayKey(new Date(c.created_at)));
      if (!bucket) continue;
      if (c.lead_id || linkedIds.has(c.id)) bucket.withLead += 1;
      else bucket.withoutLead += 1;
    }

    const rows = days.map((d) => {
      const b = buckets.get(d.key)!;
      return { ...d, comLead: b.withLead, semLead: b.withoutLead, total: b.withLead + b.withoutLead };
    });

    return {
      data: rows,
      total: rows.reduce((s, r) => s + r.total, 0),
      withLead: rows.reduce((s, r) => s + r.comLead, 0),
    };
  }, [windowContacts, linkedIds]);

  // A lista vem cortada pela paginação e o corte entrou na janela: os dias mais
  // antigos do gráfico podem ter mais cadastros do que o que está carregado.
  const cutHidesDays = !!partialList && oldestLoaded !== null && oldestLoaded > windowStart.getTime();

  return (
    <div className={cn('rounded-lg border bg-card p-3 min-w-0', className)}>
      <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Cadastros por dia (7 dias)</span>
        <span className="ml-auto shrink-0 tabular-nums">{total}</span>
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Nenhum contato cadastrado nos últimos 7 dias
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
              <BarChart data={data} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  width={22}
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  labelFormatter={(_label, payload) => payload?.[0]?.payload?.full || ''}
                  formatter={(value: number | string, name: string) => [value, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="comLead" name="Com lead" stackId="dia" fill={WITH_LEAD} isAnimationActive={false} />
                <Bar
                  dataKey="semLead"
                  name="Sem lead"
                  stackId="dia"
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
        {cutHidesDays
          ? `Só os ${contacts.length} contatos carregados entram na conta — os dias mais antigos podem estar incompletos.`
          : 'Cadastros dos contatos em tela. "Com lead" = já vinculado a um lead.'}
      </p>
    </div>
  );
}

export default ContactsCreationTrendBars;
