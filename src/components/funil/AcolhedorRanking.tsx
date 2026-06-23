import { Acolhedor, fmt, fmtPct } from "@/lib/data";
import { Eyebrow, FunilCard, FUNIL_THEME } from "./shared";

export function AcolhedorRanking({ acolhedores }: { acolhedores: Acolhedor[] }) {
  const total = acolhedores.reduce((s, a) => s + a.count, 0) || 1;
  const max = Math.max(...acolhedores.map((a) => a.count), 1);
  const sorted = [...acolhedores].sort((a, b) => b.count - a.count);

  return (
    <FunilCard className="p-6">
      <Eyebrow>operação</Eyebrow>
      <div className="flex items-baseline justify-between mt-1">
        <h3
          className="text-xl"
          style={{ fontFamily: '"Newsreader", serif', color: FUNIL_THEME.textPrimary, fontWeight: 500 }}
        >
          Chegadas por acolhedor
        </h3>
        <span className="text-xs tabular-nums" style={{ color: FUNIL_THEME.textTertiary }}>
          {fmt.format(total)} no período
        </span>
      </div>

      <ol className="mt-5 space-y-2.5">
        {sorted.map((a, i) => {
          const pct = (a.count / total) * 100;
          const w = (a.count / max) * 100;
          return (
            <li
              key={a.nome}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: "auto 1fr 1.2fr auto auto" }}
            >
              <span
                className="text-xs tabular-nums w-5 text-right"
                style={{ color: FUNIL_THEME.textTertiary }}
              >
                {i + 1}
              </span>
              <span className="text-sm truncate" style={{ color: FUNIL_THEME.textPrimary }}>
                {a.nome}
              </span>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, ${a.cor}, ${a.cor}aa)`,
                  }}
                />
              </div>
              <span
                className="text-xs tabular-nums w-12 text-right"
                style={{ color: FUNIL_THEME.textSecondary }}
              >
                {fmtPct(pct, 1)}%
              </span>
              <span
                className="text-sm tabular-nums w-14 text-right font-medium"
                style={{ color: FUNIL_THEME.textPrimary }}
              >
                {fmt.format(a.count)}
              </span>
            </li>
          );
        })}
      </ol>
    </FunilCard>
  );
}
