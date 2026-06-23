import { useEffect, useState } from "react";
import { DATASET, Periodo } from "@/lib/data";
import { FUNIL_THEME } from "./shared";
import { PeriodFilter } from "./PeriodFilter";
import { KpiStrip } from "./KpiStrip";
import { InsightBanner } from "./InsightBanner";
import { FunnelBars } from "./FunnelBars";
import { CompositionDonut } from "./CompositionDonut";
import { DerivedIndicators } from "./DerivedIndicators";
import { AcolhedorRanking } from "./AcolhedorRanking";
import { StageTimeTable } from "./StageTimeTable";
import { StageChangesTable } from "./StageChangesTable";

const STORAGE_KEY = "funil:periodo";

export function FunilDashboard() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Periodo | null;
      if (saved && (saved === "hoje" || saved === "semana" || saved === "mes")) {
        setPeriodo(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, periodo);
    } catch {}
    setFadeKey((k) => k + 1);
  }, [periodo]);

  const data = DATASET[periodo];
  const assinada = data.etapas.find((e) => e.key === "assinada");
  const protocolo = data.etapas.find((e) => e.key === "protocolo");

  return (
    <div
      className="rounded-[20px] p-5 md:p-7"
      style={{
        background: FUNIL_THEME.pageBg,
        border: `1px solid ${FUNIL_THEME.cardBorder}`,
        fontFamily: '"IBM Plex Sans", sans-serif',
      }}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-5">
        <div>
          <div
            style={{
              fontFamily: '"Newsreader", serif',
              fontStyle: "italic",
              color: FUNIL_THEME.eyebrow,
              fontSize: 13,
              letterSpacing: 0.2,
            }}
          >
            painel analítico
          </div>
          <h2
            className="text-2xl md:text-[26px] leading-tight mt-1"
            style={{
              fontFamily: '"Newsreader", serif',
              color: FUNIL_THEME.textPrimary,
              fontWeight: 500,
              letterSpacing: -0.3,
            }}
          >
            Funil de Conversão · BPC-LOAS
          </h2>
          <p className="text-sm mt-1" style={{ color: FUNIL_THEME.textSecondary }}>
            Leads e do histórico de etapas · horário de Brasília
          </p>
        </div>
        <PeriodFilter value={periodo} onChange={setPeriodo} />
      </div>

      <div key={fadeKey} className="space-y-5 animate-in fade-in duration-500">
        <KpiStrip kpis={data.kpis} />

        <InsightBanner noResponse={data.noResponseCount} total={data.mudancasTotal} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <FunnelBars etapas={data.etapas} />
          <CompositionDonut etapas={data.etapas} />
        </div>

        <DerivedIndicators data={data} />

        <AcolhedorRanking acolhedores={data.acolhedores} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {assinada && (
            <StageTimeTable
              titulo="Tempo na etapa — Procuração Assinada"
              eyebrow="tempo de permanência"
              cor={assinada.cor}
              leads={data.procuracaoAssinada}
              total={data.procuracaoAssinadaTotal}
            />
          )}
          {protocolo && (
            <StageTimeTable
              titulo="Tempo na etapa — Documentos p/ Protocolo"
              eyebrow="tempo de permanência"
              cor={protocolo.cor}
              leads={data.documentosProtocolo}
              total={data.documentosProtocoloTotal}
            />
          )}
        </div>

        <StageChangesTable mudancas={data.mudancas} total={data.mudancasTotal} />
      </div>
    </div>
  );
}
