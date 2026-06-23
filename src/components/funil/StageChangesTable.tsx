import { Mudanca, fmt, fmtPct } from "@/lib/data";
import { Eyebrow, FunilCard, FUNIL_THEME } from "./shared";

function destTone(para: string) {
  if (para === "no_response") return FUNIL_THEME.alert;
  if (para === "closed") return FUNIL_THEME.warning;
  if (para === "Desqualificado") return "#5b6172";
  return FUNIL_THEME.positive;
}

export function StageChangesTable({
  mudancas,
  total,
}: {
  mudancas: Mudanca[];
  total: number;
}) {
  const ordered = [...mudancas].sort((a, b) => b.casos - a.casos);

  return (
    <FunilCard className="p-6">
      <Eyebrow>histórico</Eyebrow>
      <div className="flex items-baseline justify-between mt-1">
        <h3
          className="text-xl"
          style={{ fontFamily: '"Newsreader", serif', color: FUNIL_THEME.textPrimary, fontWeight: 500 }}
        >
          Mudanças de etapa
        </h3>
        <span className="text-xs tabular-nums" style={{ color: FUNIL_THEME.textTertiary }}>
          {fmt.format(total)} transições
        </span>
      </div>

      <ul className="mt-4 space-y-1.5">
        {ordered.map((m, i) => {
          const pct = total > 0 ? (m.casos / total) * 100 : 0;
          const tone = destTone(m.para);
          return (
            <li
              key={`${m.de}-${m.para}-${i}`}
              className="grid items-center gap-3 px-2 py-2 rounded-md"
              style={{ gridTemplateColumns: "1fr auto 1fr auto auto", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}
            >
              <span className="text-sm truncate" style={{ color: FUNIL_THEME.textPrimary }}>
                {m.de}
              </span>
              <span className="text-xs" style={{ color: FUNIL_THEME.textTertiary }}>
                →
              </span>
              <span className="text-sm truncate" style={{ color: tone, fontStyle: m.para === "no_response" ? "italic" : "normal" }}>
                {m.para}
              </span>
              <span
                className="text-xs tabular-nums w-12 text-right"
                style={{ color: FUNIL_THEME.textSecondary }}
              >
                {fmtPct(pct, 1)}%
              </span>
              <span
                className="text-sm tabular-nums w-12 text-right font-medium"
                style={{ color: FUNIL_THEME.textPrimary }}
              >
                {fmt.format(m.casos)}
              </span>
            </li>
          );
        })}
      </ul>
    </FunilCard>
  );
}
