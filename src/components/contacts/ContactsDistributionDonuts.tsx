/**
 * Distribuição dos contatos filtrados: Relacionamento Conosco e Profissão.
 *
 * A lista já respondia "quem são" — mas não "de que tipo é essa gente", que é
 * a pergunta de quem acabou de filtrar uma cidade e quer decidir o que fazer
 * com ela. As roscas leem os MESMOS contatos que estão na lista (nada vai ao
 * banco de novo) e cada fatia é atalho: relacionamento abre o painel daquele
 * status; profissão filtra a lista ali mesmo.
 *
 * Um contato com mais de um relacionamento conta em cada fatia — por isso a
 * soma da rosca pode passar do total de contatos, e o rodapé avisa quando isso
 * acontece.
 */
import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Briefcase, ChevronDown, ChevronUp, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { classificationLabel } from '@/hooks/useContactClassifications';
import { ContactsCreationTrendBars } from './ContactsCreationTrendBars';

/** Contato do jeito que a rosca precisa — a lista passa o registro inteiro. */
interface DonutContact {
  id: string;
  created_at: string;
  lead_id?: string | null;
  classifications?: string[] | null;
  classification?: string | null;
  profession?: string | null;
}

interface Props {
  contacts: DonutContact[];
  /** Cores cadastradas em Classificações (`bg-*-500`). */
  classificationConfig: Record<string, { label: string; color: string }>;
  /** Fatia do relacionamento: abre o painel daquele status. */
  onSelectClassification: (name: string) => void;
  /** Fatia da profissão: filtra a lista. `null` = "sem profissão". */
  onSelectProfession: (profession: string | null) => void;
  /** Profissão em foco no momento (destaca a fatia). `undefined` = nenhuma. */
  selectedProfession?: string | null;
  /** A lista veio cortada pela paginação — o gráfico de 7 dias avisa quando isso o afeta. */
  partialList?: boolean;
  className?: string;
}

/** `bg-rose-500` → hex. Recharts pinta em SVG, não aceita classe do Tailwind. */
const COLOR_HEX: Record<string, string> = {
  'bg-red-500': '#ef4444',
  'bg-orange-500': '#f97316',
  'bg-amber-500': '#f59e0b',
  'bg-yellow-500': '#eab308',
  'bg-lime-500': '#84cc16',
  'bg-green-500': '#22c55e',
  'bg-emerald-500': '#10b981',
  'bg-teal-500': '#14b8a6',
  'bg-cyan-500': '#06b6d4',
  'bg-sky-500': '#0ea5e9',
  'bg-blue-500': '#3b82f6',
  'bg-indigo-500': '#6366f1',
  'bg-violet-500': '#8b5cf6',
  'bg-purple-500': '#a855f7',
  'bg-fuchsia-500': '#d946ef',
  'bg-pink-500': '#ec4899',
  'bg-rose-500': '#f43f5e',
  'bg-slate-500': '#64748b',
};

/** Profissão não tem cor cadastrada — a paleta roda na ordem da contagem. */
const PROFESSION_PALETTE = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#06b6d4',
  '#ec4899', '#eab308', '#14b8a6', '#f43f5e', '#6366f1',
];

const OTHERS_KEY = '__others__';
const NONE_KEY = '__none__';
const TOP_PROFESSIONS = 8;

interface Slice {
  key: string;
  label: string;
  count: number;
  color: string;
  /** Fatia agregada ("Outras") não abre nada. */
  clickable: boolean;
}

function Donut({
  title,
  icon: Icon,
  slices,
  total,
  emptyLabel,
  activeKey,
  onSlice,
  footer,
}: {
  title: string;
  icon: React.ElementType;
  slices: Slice[];
  total: number;
  emptyLabel: string;
  activeKey?: string | null;
  onSlice: (slice: Slice) => void;
  footer?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 min-w-0">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{title}</span>
        <span className="ml-auto shrink-0 tabular-nums">{slices.length}</span>
      </div>

      {slices.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{emptyLabel}</p>
      ) : (
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-[132px] w-[132px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={38}
                  outerRadius={62}
                  paddingAngle={1}
                  stroke="none"
                  isAnimationActive={false}
                  onClick={(entry: any) => {
                    const slice = (entry?.payload?.payload || entry?.payload) as Slice | undefined;
                    if (slice?.clickable) onSlice(slice);
                  }}
                >
                  {slices.map((s) => (
                    <Cell
                      key={s.key}
                      fill={s.color}
                      opacity={activeKey && activeKey !== s.key ? 0.35 : 1}
                      className={s.clickable ? 'cursor-pointer' : undefined}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | string, name: string) => [
                    `${value} (${total ? Math.round((Number(value) / total) * 100) : 0}%)`,
                    name,
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-base font-semibold tabular-nums leading-none">{total}</span>
              <span className="text-[10px] text-muted-foreground">contatos</span>
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-0.5 max-h-[132px] overflow-y-auto pr-1">
            {slices.map((s) => {
              const active = activeKey === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={!s.clickable}
                  onClick={() => onSlice(s)}
                  title={
                    s.clickable
                      ? `${s.label}: ${s.count} contato${s.count === 1 ? '' : 's'}`
                      : 'Fatia somada — refine os filtros para detalhar'
                  }
                  className={cn(
                    'w-full flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-left transition-colors',
                    s.clickable ? 'hover:bg-muted/60' : 'cursor-default opacity-70',
                    active && 'bg-primary/10 text-primary font-medium'
                  )}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="truncate min-w-0">{s.label}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{s.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {footer && <p className="text-[10px] text-muted-foreground mt-2">{footer}</p>}
    </div>
  );
}

export function ContactsDistributionDonuts({
  contacts,
  classificationConfig,
  onSelectClassification,
  onSelectProfession,
  selectedProfession,
  partialList,
  className,
}: Props) {
  const [open, setOpen] = useState(true);

  const { relationshipSlices, relationshipTotal, multiCount, professionSlices, professionTotal } = useMemo(() => {
    const relCount = new Map<string, number>();
    const profCount = new Map<string, number>();
    let multi = 0;

    for (const c of contacts) {
      const rels = c.classifications?.length ? c.classifications : (c.classification ? [c.classification] : []);
      if (rels.length > 1) multi += 1;
      for (const r of rels) relCount.set(r, (relCount.get(r) || 0) + 1);

      const prof = (c.profession || '').trim();
      const key = prof || NONE_KEY;
      profCount.set(key, (profCount.get(key) || 0) + 1);
    }

    const relSlices: Slice[] = Array.from(relCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], i) => ({
        key: name,
        label: classificationConfig[name]?.label || classificationLabel(name),
        count,
        color: COLOR_HEX[classificationConfig[name]?.color || ''] || PROFESSION_PALETTE[i % PROFESSION_PALETTE.length],
        clickable: true,
      }));

    const profSorted = Array.from(profCount.entries()).sort((a, b) => b[1] - a[1]);
    const top = profSorted.slice(0, TOP_PROFESSIONS);
    const rest = profSorted.slice(TOP_PROFESSIONS);
    const profSlices: Slice[] = top.map(([key, count], i) => ({
      key,
      label: key === NONE_KEY ? 'Sem profissão' : key,
      count,
      color: key === NONE_KEY ? '#94a3b8' : PROFESSION_PALETTE[i % PROFESSION_PALETTE.length],
      clickable: true,
    }));
    if (rest.length) {
      profSlices.push({
        key: OTHERS_KEY,
        label: `Outras (${rest.length})`,
        count: rest.reduce((sum, [, n]) => sum + n, 0),
        color: '#cbd5e1',
        clickable: false,
      });
    }

    return {
      relationshipSlices: relSlices,
      relationshipTotal: relSlices.reduce((s, r) => s + r.count, 0),
      multiCount: multi,
      professionSlices: profSlices,
      professionTotal: profSlices.reduce((s, r) => s + r.count, 0),
    };
  }, [contacts, classificationConfig]);

  return (
    <div className={cn('shrink-0', className)}>
      <div className="flex items-center gap-2 pb-1">
        <span className="text-xs font-medium text-muted-foreground">
          Distribuição dos {contacts.length} contato{contacts.length === 1 ? '' : 's'} em tela
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs ml-auto"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? 'Ocultar' : 'Ver'}
        </Button>
      </div>

      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          <Donut
            title="Relacionamento Conosco"
            icon={Users2}
            slices={relationshipSlices}
            total={relationshipTotal}
            emptyLabel="Nenhum contato classificado"
            onSlice={(s) => onSelectClassification(s.key)}
            footer={
              multiCount > 0
                ? `${multiCount} contato${multiCount === 1 ? '' : 's'} com mais de um relacionamento conta${multiCount === 1 ? '' : 'm'} em cada fatia. Clique para abrir o painel do status.`
                : 'Clique numa fatia para abrir o painel daquele relacionamento.'
            }
          />
          <Donut
            title="Profissão"
            icon={Briefcase}
            slices={professionSlices}
            total={professionTotal}
            emptyLabel="Nenhuma profissão cadastrada"
            activeKey={selectedProfession === undefined ? null : (selectedProfession ?? NONE_KEY)}
            onSlice={(s) => onSelectProfession(s.key === NONE_KEY ? null : s.key)}
            footer="Clique numa fatia para filtrar a lista por profissão."
          />
          <ContactsCreationTrendBars contacts={contacts} partialList={partialList} />
        </div>
      )}
    </div>
  );
}

export default ContactsDistributionDonuts;
