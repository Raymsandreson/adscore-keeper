import { CountUp, fmt } from '@/lib/funilFormat';
import type { AcolhedorRow } from '@/lib/funilData';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AcolhedorRanking({ acolhedores }: { acolhedores: AcolhedorRow[] }) {
  const total = acolhedores.reduce((s, a) => s + a.count, 0);
  const max = Math.max(...acolhedores.map((a) => a.count), 1);

  return (
    <section
      className="rounded-[18px] border border-white/[.07] bg-[#14151d] p-6"
      aria-label="Chegadas por acolhedor"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <p
            className="text-[12px] text-[#a6a8f0]"
            style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
          >
            Ranking do período
          </p>
          <h3
            className="mt-0.5 text-[20px] text-[#f4f5fa]"
            style={{ fontFamily: 'Newsreader, serif', fontWeight: 500 }}
          >
            Chegadas por acolhedor
          </h3>
        </div>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[#6b7080]">
          total <CountUp value={total} className="ml-1 text-[#f4f5fa]" />
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {acolhedores.map((a) => {
          const w = (a.count / max) * 100;
          return (
            <li
              key={a.nome}
              className="grid grid-cols-[44px_120px_1fr_auto] items-center gap-4 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-white/[.028] sm:grid-cols-[44px_140px_1fr_auto]"
            >
              <div
                className="grid h-10 w-10 place-items-center rounded-[10px] text-[12px] font-semibold text-white"
                style={{
                  background: `linear-gradient(135deg, ${a.cor} 0%, ${a.cor}aa 100%)`,
                  boxShadow: `0 6px 18px -8px ${a.cor}80`,
                }}
                aria-hidden
              >
                {initials(a.nome)}
              </div>
              <span className="truncate text-[13.5px] text-[#f4f5fa]">{a.nome}</span>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[.04]">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${w}%`,
                    background: 'linear-gradient(90deg, #6366f1 0%, #4f46e5 100%)',
                    boxShadow: '0 0 10px rgba(99,102,241,.35)',
                  }}
                />
              </div>
              <span
                className="w-12 text-right text-[14px] font-medium text-[#f4f5fa]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(a.count)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
