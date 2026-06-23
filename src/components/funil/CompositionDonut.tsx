import { Etapa, fmt, fmtPct } from "@/lib/data";
import { Eyebrow, FunilCard, FUNIL_THEME } from "./shared";

export function CompositionDonut({ etapas }: { etapas: Etapa[] }) {
  const total = etapas.reduce((s, e) => s + e.count, 0) || 1;

  let acc = 0;
  const stops: string[] = [];
  etapas.forEach((e) => {
    const start = (acc / total) * 360;
    acc += e.count;
    const end = (acc / total) * 360;
    stops.push(`${e.cor} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`);
  });
  const conic = `conic-gradient(${stops.join(", ")})`;

  return (
    <FunilCard className="p-6">
      <Eyebrow>composição</Eyebrow>
      <h3
        className="mt-1 text-xl"
        style={{
          fontFamily: '"Newsreader", serif',
          color: FUNIL_THEME.textPrimary,
          fontWeight: 500,
        }}
      >
        Composição da base
      </h3>

      <div className="mt-5 flex items-center gap-6">
        <div
          className="relative shrink-0"
          style={{ width: 160, height: 160 }}
          role="img"
          aria-label={`Donut com distribuição de ${total} leads`}
        >
          <div
            className="absolute inset-0 rounded-full transition-all duration-500"
            style={{ background: conic }}
          />
          <div
            className="absolute rounded-full flex flex-col items-center justify-center"
            style={{
              inset: 22,
              background: FUNIL_THEME.cardBg,
              border: `1px solid ${FUNIL_THEME.cardBorder}`,
            }}
          >
            <div className="text-2xl font-semibold tabular-nums" style={{ color: FUNIL_THEME.textPrimary }}>
              {fmt.format(total)}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: FUNIL_THEME.textTertiary }}>
              total
            </div>
          </div>
        </div>

        <ul className="flex-1 space-y-1.5 min-w-0">
          {etapas.map((e) => {
            const pct = (e.count / total) * 100;
            return (
              <li key={e.key} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: e.cor }} />
                <span className="truncate" style={{ color: FUNIL_THEME.textPrimary }}>
                  {e.nome}
                </span>
                <span className="ml-auto tabular-nums" style={{ color: FUNIL_THEME.textSecondary }}>
                  {fmtPct(pct, 1)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </FunilCard>
  );
}
