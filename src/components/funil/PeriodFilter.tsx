import { Periodo, PERIODO_LABEL } from "@/lib/data";
import { FUNIL_THEME } from "./shared";

const ORDER: Periodo[] = ["hoje", "semana", "mes"];

export function PeriodFilter({
  value,
  onChange,
}: {
  value: Periodo;
  onChange: (p: Periodo) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filtro de período"
      className="inline-flex rounded-full p-1"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${FUNIL_THEME.cardBorder}`,
      }}
    >
      {ORDER.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            className="px-4 py-1.5 text-sm rounded-full transition-colors focus:outline-none focus-visible:ring-2"
            style={{
              color: active ? "#fff" : FUNIL_THEME.textSecondary,
              background: active
                ? `linear-gradient(135deg, ${FUNIL_THEME.accent}, ${FUNIL_THEME.accentDeep})`
                : "transparent",
              fontWeight: active ? 600 : 500,
              boxShadow: active ? "0 6px 18px -6px rgba(99,102,241,0.6)" : "none",
            }}
          >
            {PERIODO_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

export function ReadOnlyPill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${FUNIL_THEME.cardBorder}`,
        color: FUNIL_THEME.textSecondary,
      }}
    >
      <span>👁</span>
      <span>somente leitura</span>
    </span>
  );
}
