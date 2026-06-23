import { CountUp, fmt } from '@/lib/funilFormat';
import { ArrowRight } from 'lucide-react';
import type { StageChangeRow } from '@/lib/funilData';

interface Props {
  total: number;
  rows: StageChangeRow[];
}

export function StageChangesTable({ total, rows }: Props) {
  return (
    <section
      className="rounded-[18px] border border-white/[.07] bg-[#14151d] p-6"
      aria-label="Mudanças de etapa"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <p
            className="text-[12px] text-[#a6a8f0]"
            style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
          >
            Movimentações no período
          </p>
          <h3
            className="mt-0.5 text-[20px] text-[#f4f5fa]"
            style={{ fontFamily: 'Newsreader, serif', fontWeight: 500 }}
          >
            Mudanças de etapa
          </h3>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[#6b7080]">total</span>
          <CountUp
            value={total}
            className="text-[18px] font-medium text-[#f4f5fa]"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/[.05]">
        <div className="grid grid-cols-[1fr_28px_1fr_88px] items-center gap-3 border-b border-white/[.05] bg-white/[.015] px-4 py-2.5 text-[10.5px] uppercase tracking-[0.14em] text-[#6b7080]">
          <span>De</span>
          <span aria-hidden />
          <span>Para</span>
          <span className="text-right">Casos</span>
        </div>
        <ul>
          {rows.map((r, i) => (
            <li
              key={i}
              className="grid grid-cols-[1fr_28px_1fr_88px] items-center gap-3 border-b border-white/[.04] px-4 py-3 last:border-b-0 transition-colors duration-150 hover:bg-white/[.028]"
            >
              <span className="truncate text-[13px] text-[#f4f5fa]">{r.from}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#6366f1]" aria-hidden />
              <span
                className={[
                  'truncate text-[13px]',
                  r.to === 'no_response' ? 'text-[#f0a3a0]' : 'text-[#f4f5fa]',
                ].join(' ')}
                style={
                  r.to === 'no_response' || r.to === 'closed'
                    ? { fontFamily: 'Newsreader, serif', fontStyle: 'italic' }
                    : undefined
                }
              >
                {r.to}
              </span>
              <span
                className="text-right text-[14px] font-medium text-[#f4f5fa]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(r.casos)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
