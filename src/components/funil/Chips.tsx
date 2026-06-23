import { FUNIL_THEME } from "./shared";
import { fmt } from "@/lib/data";

export function Chips({
  noWhatsApp,
  inviavel,
  totalMudancas,
}: {
  noWhatsApp: number;
  inviavel: number;
  totalMudancas: number;
}) {
  const base = {
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${FUNIL_THEME.cardBorder}`,
    color: FUNIL_THEME.textSecondary,
  };
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs" style={base}>
        No WhatsApp <strong style={{ color: FUNIL_THEME.textPrimary, fontVariantNumeric: "tabular-nums" }}>{fmt.format(noWhatsApp)}</strong>
      </span>
      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs" style={base}>
        Inviável <strong style={{ color: FUNIL_THEME.textPrimary, fontVariantNumeric: "tabular-nums" }}>{fmt.format(inviavel)}</strong>
      </span>
      <span
        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        style={{
          background: "rgba(99,102,241,0.1)",
          border: "1px solid rgba(99,102,241,0.25)",
          color: "#c7c9f7",
        }}
      >
        ⚖ <strong style={{ fontVariantNumeric: "tabular-nums" }}>{fmt.format(totalMudancas)}</strong> mudanças de etapa no período
      </span>
    </div>
  );
}
