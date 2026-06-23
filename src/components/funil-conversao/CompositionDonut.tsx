import { CountUp, fmt, fmtPct } from '@/lib/funilFormat';
import type { EtapaDist } from '@/lib/funilData';

export function CompositionDonut({ distribuicao }: { distribuicao: EtapaDist[] }) {
  const total = distribuicao.reduce((s, e) => s + e.count, 0) || 1;

  // Constrói o conic-gradient acumulado
  let acc = 0;
  const segments = distribuicao.map((e) => {
    const startPct = (acc / total) * 100;
    acc += e.count;
    const endPct = (acc / total) * 100;
    return { ...e, startPct, endPct, pct: (e.count / total) * 100 };
  });

  const gradient = segments
    .map((s) => `${s.cor} ${s.startPct}% ${s.endPct}%`)
    .join(', ');

  return (
    <section
      className="rounded-[18px] border border-white/[.07] bg-[#14151d] p-6"
      aria-label="Composição da base"
    >
      <div className="mb-5">
        <p
          className="text-[12px] text-[#a6a8f0]"
          style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
        >
          Visão geral
        </p>
        <h3
          className="mt-0.5 text-[20px] text-[#f4f5fa]"
          style={{ fontFamily: 'Newsreader, serif', fontWeight: 500 }}
        >
          Composição da base
        </h3>
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-7">
        {/* Donut */}
        <div
          className="relative shrink-0"
          role="img"
          aria-label={`Donut: ${segments.map((s) => `${s.nome} ${fmtPct(s.pct)}`).join(', ')}`}
        >
          <div
            className="h-[180px] w-[180px] rounded-full transition-[background] duration-500"
            style={{ background: `conic-gradient(${gradient})` }}
          />
          <div
            className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full bg-[#14151d]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.04)' }}
          >
            <span
              className="text-[26px] leading-none font-medium text-[#f4f5fa]"
              style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'IBM Plex Sans, sans-serif' }}
            >
              <CountUp value={total} />
            </span>
            <span className="mt-1 text-[10.5px] uppercase tracking-[0.14em] text-[#6b7080]">
              total de leads
            </span>
          </div>
        </div>

        {/* Legenda */}
        <ul className="flex w-full flex-col gap-1.5">
          {segments.map((s) => (
            <li
              key={s.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-white/[.028]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.cor }}
                  aria-hidden
                />
                <span className="truncate text-[12.5px] text-[#f4f5fa]">{s.nome}</span>
              </div>
              <span
                className="text-[12px] text-[#8b90a3]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmtPct(s.pct)} <span className="ml-1 text-[#6b7080]">· {fmt(s.count)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
