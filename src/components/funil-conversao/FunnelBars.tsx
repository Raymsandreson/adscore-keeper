import { fmt, fmtPct } from '@/lib/funilFormat';
import type { EtapaDist } from '@/lib/funilData';

// Escala perceptual: dá visibilidade pras etapas pequenas.
// raiz quarta achata as diferenças e o min 4% garante que nada some.
function perceptualWidth(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const raw = Math.pow(value / max, 0.5); // raiz quadrada
  const pct = raw * 100;
  return Math.max(pct, value > 0 ? 4 : 0);
}

export function FunnelBars({ distribuicao }: { distribuicao: EtapaDist[] }) {
  const total = distribuicao.reduce((s, e) => s + e.count, 0) || 1;
  const max = Math.max(...distribuicao.map((e) => e.count), 1);

  return (
    <section
      className="rounded-[18px] border border-white/[.07] bg-[#14151d] p-6"
      aria-label="Distribuição por etapa"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <p
            className="text-[12px] text-[#a6a8f0]"
            style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
          >
            Etapas atuais
          </p>
          <h3
            className="mt-0.5 text-[20px] text-[#f4f5fa]"
            style={{ fontFamily: 'Newsreader, serif', fontWeight: 500 }}
          >
            Distribuição por etapa
          </h3>
        </div>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[#6b7080]">
          {fmt(total)} leads
        </span>
      </div>

      <ul className="flex flex-col">
        {distribuicao.map((e) => {
          const pct = (e.count / total) * 100;
          const w = perceptualWidth(e.count, max);
          return (
            <li
              key={e.id}
              className="grid grid-cols-[140px_1fr_auto] items-center gap-4 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-white/[.028] sm:grid-cols-[180px_1fr_auto]"
              aria-label={`${e.nome}: ${fmt(e.count)} leads, ${fmtPct(pct)}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: e.cor, boxShadow: `0 0 0 3px ${e.cor}22` }}
                  aria-hidden
                />
                <span className="truncate text-[13px] text-[#f4f5fa]">{e.nome}</span>
              </div>

              <div className="relative h-2 overflow-hidden rounded-full bg-white/[.04]">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, ${e.cor} 0%, ${e.cor}cc 100%)`,
                    boxShadow: `0 0 12px ${e.cor}40`,
                  }}
                />
              </div>

              <div className="flex items-baseline gap-3 justify-self-end">
                <span
                  className="text-[12.5px] text-[#8b90a3]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmtPct(pct)}
                </span>
                <span
                  className="w-12 text-right text-[13.5px] font-medium text-[#f4f5fa]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmt(e.count)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
