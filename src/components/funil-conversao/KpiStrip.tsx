import { CountUp } from '@/lib/funilFormat';
import type { PeriodoDataset } from '@/lib/funilData';

interface Col {
  label: string;
  value: number;
  tone?: 'danger' | 'highlight' | 'default';
}

export function KpiStrip({ data }: { data: PeriodoDataset }) {
  const cols: Col[] = [
    { label: 'Total na base', value: data.kpis.totalBase },
    { label: 'A ligar', value: data.kpis.aLigar, tone: 'danger' },
    { label: 'Chegadas hoje', value: data.kpis.chegadasHoje },
    { label: 'Esta semana', value: data.kpis.estaSemana },
    { label: 'Este mês', value: data.kpis.esteMes, tone: 'highlight' },
  ];

  return (
    <div className="rounded-[18px] border border-white/[.07] bg-[#14151d] overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {cols.map((c, i) => {
          const isHighlight = c.tone === 'highlight';
          return (
            <div
              key={c.label}
              className={[
                'relative px-6 py-6',
                i > 0 ? 'lg:border-l border-white/[.05]' : '',
                (i % 2 === 1) ? 'border-l border-white/[.05] lg:border-l' : '',
                'md:border-l first:border-l-0',
                isHighlight ? 'bg-[radial-gradient(120%_140%_at_50%_0%,rgba(99,102,241,.18),transparent_60%)]' : '',
              ].join(' ')}
            >
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#6b7080]">
                {c.label}
              </div>
              <div
                className={[
                  'mt-2 text-[30px] leading-none font-medium',
                  c.tone === 'danger' ? 'text-[#f0a3a0]' : 'text-[#f4f5fa]',
                ].join(' ')}
                style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'IBM Plex Sans, sans-serif' }}
              >
                <CountUp value={c.value} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
