import { PeriodoData, fmt, fmtPct } from "@/lib/data";
import { Eyebrow, FunilCard, FUNIL_THEME } from "./shared";

export function DerivedIndicators({ data }: { data: PeriodoData }) {
  const total = data.etapas.reduce((s, e) => s + e.count, 0) || 1;
  const assinada = data.etapas.find((e) => e.key === "assinada")?.count ?? 0;
  const desq = data.etapas.find((e) => e.key === "desqualificado")?.count ?? 0;
  const ativos =
    (data.etapas.find((e) => e.key === "viabilidade")?.count ?? 0) +
    (data.etapas.find((e) => e.key === "aguardando")?.count ?? 0) +
    (data.etapas.find((e) => e.key === "enviada")?.count ?? 0) +
    assinada +
    (data.etapas.find((e) => e.key === "protocolo")?.count ?? 0);

  const items = [
    {
      label: "Procurações assinadas",
      value: assinada,
      pct: (assinada / total) * 100,
      tone: FUNIL_THEME.positive,
      eyebrow: "conversão",
    },
    {
      label: "Leads ativos no funil",
      value: ativos,
      pct: (ativos / total) * 100,
      tone: FUNIL_THEME.accent,
      eyebrow: "em andamento",
    },
    {
      label: "Taxa de desqualificação",
      value: desq,
      pct: (desq / total) * 100,
      tone: FUNIL_THEME.alert,
      eyebrow: "perdas",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {items.map((it) => (
        <FunilCard key={it.label} className="p-5">
          <Eyebrow>{it.eyebrow}</Eyebrow>
          <h4
            className="mt-1 text-base"
            style={{ color: FUNIL_THEME.textPrimary, fontFamily: '"Newsreader", serif', fontWeight: 500 }}
          >
            {it.label}
          </h4>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className="text-3xl font-semibold tabular-nums"
              style={{ color: it.tone, fontFamily: '"IBM Plex Sans", sans-serif' }}
            >
              {fmt.format(it.value)}
            </span>
            <span className="text-sm tabular-nums" style={{ color: FUNIL_THEME.textSecondary }}>
              {fmtPct(it.pct, 1)}%
            </span>
          </div>
        </FunilCard>
      ))}
    </div>
  );
}
