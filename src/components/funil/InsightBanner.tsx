import { AnimatedNumber, FunilCard, FUNIL_THEME } from "./shared";
import { fmt, fmtPct } from "@/lib/data";

export function InsightBanner({
  noResponse,
  total,
}: {
  noResponse: number;
  total: number;
}) {
  const pct = total > 0 ? (noResponse / total) * 100 : 0;
  return (
    <FunilCard
      className="px-6 py-5 flex items-center gap-6 justify-between"
      style={{
        background:
          "linear-gradient(135deg, rgba(240,163,160,0.10), rgba(240,163,160,0.04))",
        borderColor: "rgba(240,163,160,0.28)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="text-base md:text-lg"
          style={{ color: FUNIL_THEME.textPrimary, fontFamily: '"Newsreader", serif' }}
        >
          <strong style={{ color: FUNIL_THEME.alert, fontVariantNumeric: "tabular-nums" }}>
            {fmtPct(pct, 0)}%
          </strong>{" "}
          das mudanças de etapa foram para <em>no_response</em>
        </div>
        <p className="mt-1 text-sm" style={{ color: FUNIL_THEME.textSecondary }}>
          {fmt.format(noResponse)} de {fmt.format(total)} transições no período — ponto de
          atenção no acompanhamento.
        </p>
      </div>
      <div className="text-right shrink-0">
        <AnimatedNumber
          value={noResponse}
          className="block text-4xl md:text-5xl font-semibold"
          // @ts-expect-error style passthrough
          style={{ color: FUNIL_THEME.alert, fontFamily: '"IBM Plex Sans", sans-serif' }}
        />
        <div className="text-xs uppercase tracking-[0.14em] mt-1" style={{ color: FUNIL_THEME.textTertiary }}>
          sem resposta
        </div>
      </div>
    </FunilCard>
  );
}
