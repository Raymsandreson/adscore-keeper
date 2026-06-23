import { Etapa, fmt, fmtPct } from "@/lib/data";
import { Eyebrow, FunilCard, FUNIL_THEME } from "./shared";

// escala perceptual: sqrt para etapas pequenas ficarem visíveis
function perceptualWidth(count: number, max: number) {
  if (max <= 0) return 0;
  const r = count / max;
  return Math.max(2, Math.sqrt(r) * 100);
}

export function FunnelBars({ etapas }: { etapas: Etapa[] }) {
  const total = etapas.reduce((s, e) => s + e.count, 0) || 1;
  const max = Math.max(...etapas.map((e) => e.count), 1);

  return (
    <FunilCard className="p-6">
      <Eyebrow>distribuição</Eyebrow>
      <h3
        className="mt-1 text-xl"
        style={{
          fontFamily: '"Newsreader", serif',
          color: FUNIL_THEME.textPrimary,
          fontWeight: 500,
        }}
      >
        Distribuição por etapa
      </h3>

      <div className="mt-5 space-y-3.5">
        {etapas.map((e) => {
          const pct = (e.count / total) * 100;
          const w = perceptualWidth(e.count, max);
          return (
            <div
              key={e.key}
              className="grid items-center gap-3 px-2 py-1.5 rounded-lg transition-colors"
              style={{
                gridTemplateColumns: "1.1fr 1.4fr auto auto",
              }}
              onMouseEnter={(ev) =>
                (ev.currentTarget.style.background = "rgba(255,255,255,0.028)")
              }
              onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: e.cor }}
                />
                <span
                  className="text-sm truncate"
                  style={{ color: FUNIL_THEME.textPrimary }}
                >
                  {e.nome}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.04)" }}
                role="meter"
                aria-label={`${e.nome}: ${e.count} leads, ${fmtPct(pct, 1)} por cento`}
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, ${e.cor}, ${e.cor}cc)`,
                  }}
                />
              </div>
              <div
                className="text-xs text-right tabular-nums w-12"
                style={{ color: FUNIL_THEME.textSecondary }}
              >
                {fmtPct(pct, 1)}%
              </div>
              <div
                className="text-sm text-right tabular-nums w-14 font-medium"
                style={{ color: FUNIL_THEME.textPrimary }}
              >
                {fmt.format(e.count)}
              </div>
            </div>
          );
        })}
      </div>
    </FunilCard>
  );
}
