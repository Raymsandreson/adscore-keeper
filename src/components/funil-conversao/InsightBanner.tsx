import { CountUp, fmt, fmtPct } from '@/lib/funilFormat';
import type { PeriodoDataset } from '@/lib/funilData';
import { AlertCircle } from 'lucide-react';

export function InsightBanner({ data }: { data: PeriodoDataset }) {
  const { noResponseTotal, total } = data.mudancas;
  const pct = total > 0 ? (noResponseTotal / total) * 100 : 0;

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-[#f0a3a0]/20 bg-[#14151d] px-6 py-5"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(240,163,160,.06)' }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(80% 120% at 0% 50%, rgba(240,163,160,.10), transparent 60%)' }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0a3a0]/12 text-[#f0a3a0]">
            <AlertCircle className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-[15px] text-[#f4f5fa]">
              <span className="font-medium text-[#f0a3a0]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtPct(pct)}
              </span>{' '}
              das mudanças de etapa foram para{' '}
              <span style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}>no_response</span>
            </p>
            <p className="mt-1 text-[12.5px] text-[#8b90a3]">
              {fmt(noResponseTotal)} de {fmt(total)} transições no período — ponto de atenção no acompanhamento.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0">
          <div
            className="text-[44px] leading-none font-medium text-[#f0a3a0]"
            style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'IBM Plex Sans, sans-serif' }}
          >
            <CountUp value={noResponseTotal} />
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#6b7080]">sem resposta</div>
        </div>
      </div>
    </div>
  );
}
