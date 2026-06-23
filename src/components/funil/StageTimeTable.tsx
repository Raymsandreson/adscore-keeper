import { TimeLead, fmt } from "@/lib/data";
import { Eyebrow, FunilCard, FUNIL_THEME } from "./shared";

export function StageTimeTable({
  titulo,
  eyebrow,
  cor,
  leads,
  total,
}: {
  titulo: string;
  eyebrow: string;
  cor: string;
  leads: TimeLead[];
  total: number;
}) {
  return (
    <FunilCard className="p-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="flex items-baseline justify-between mt-1">
        <h3
          className="text-xl flex items-center gap-2"
          style={{ fontFamily: '"Newsreader", serif', color: FUNIL_THEME.textPrimary, fontWeight: 500 }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: cor }} />
          {titulo}
        </h3>
        <span className="text-xs tabular-nums" style={{ color: FUNIL_THEME.textTertiary }}>
          {fmt.format(total)} no total
        </span>
      </div>

      <ul className="mt-4 divide-y" style={{ borderColor: FUNIL_THEME.cardBorder }}>
        {leads.map((l, i) => (
          <li
            key={`${l.nome}-${i}`}
            className="flex items-center justify-between py-2.5 text-sm gap-3"
            style={{ borderTop: i === 0 ? "none" : `1px solid ${FUNIL_THEME.cardBorder}` }}
          >
            <span className="truncate" style={{ color: FUNIL_THEME.textPrimary }}>
              {l.nome}
            </span>
            <span
              className="text-xs shrink-0 px-2 py-0.5 rounded-full"
              style={{
                color: l.acolhedor ? FUNIL_THEME.textSecondary : FUNIL_THEME.textTertiary,
                background: l.acolhedor ? "rgba(99,102,241,0.10)" : "rgba(255,255,255,0.03)",
                fontStyle: l.acolhedor ? "normal" : "italic",
              }}
            >
              {l.acolhedor ?? "sem acolhedor"}
            </span>
          </li>
        ))}
      </ul>
    </FunilCard>
  );
}
