import { Kpis } from "@/lib/data";
import { AnimatedNumber, FunilCard, FUNIL_THEME } from "./shared";

function Cell({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  tone?: string;
}) {
  return (
    <div
      className="flex-1 px-5 py-5 md:py-6 relative"
      style={{
        background: highlight
          ? "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(79,70,229,0.06))"
          : undefined,
      }}
    >
      <div
        className="text-[11px] uppercase tracking-[0.12em]"
        style={{ color: FUNIL_THEME.textTertiary }}
      >
        {label}
      </div>
      <AnimatedNumber
        value={value}
        className="block mt-2 text-3xl md:text-[32px] font-semibold"
        style={{
          color: tone ?? FUNIL_THEME.textPrimary,
          fontFamily: '"IBM Plex Sans", sans-serif',
        }}
      />
    </div>
  );
}

export function KpiStrip({ kpis }: { kpis: Kpis }) {
  return (
    <FunilCard className="overflow-hidden">
      <div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
        style={{ gap: 0 }}
      >
        {[
          { label: "Total na base", value: kpis.totalBase },
          { label: "A ligar", value: kpis.aLigar, tone: FUNIL_THEME.alert },
          { label: "Chegadas hoje", value: kpis.chegadasHoje },
          { label: "Esta semana", value: kpis.chegadasSemana },
          { label: "Este mês", value: kpis.chegadasMes, highlight: true },
        ].map((c, i, arr) => (
          <div
            key={c.label}
            className={i < arr.length - 1 ? "lg:border-r" : ""}
            style={{
              borderColor: FUNIL_THEME.cardBorder,
            }}
          >
            <Cell {...c} />
          </div>
        ))}
      </div>
    </FunilCard>
  );
}
