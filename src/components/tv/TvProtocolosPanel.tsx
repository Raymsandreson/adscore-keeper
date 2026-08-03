// Vista "Protocolos do dia" do telão — entra no rodízio como pseudo-item,
// no mesmo padrão do GRUPO_GERENCIAL (ver TvAtividadesPage).
//
// Por que esta vista NÃO tem ranking por pessoa: nada registra quem protocolou.
// O dado chega por e-mail do INSS, que não identifica o operador. Levantado em
// 03/08/2026 — a melhor atribuição automática disponível cobria 24% dos casos,
// o que faria o pódio mentir. Enquanto não houver captura no ato, esta tela
// mostra volume, não pessoas.
//
// Contraste visual com o ranking: fundo escuro, número gigante, legível de
// longe numa TV de sala.

import { FileCheck2, AlertTriangle, TrendingUp } from "lucide-react";

import {
  useProtocolosDia,
  syncEstaAtrasado,
  horasDesdeSync,
  type ProtocolosDiaData,
} from "@/lib/protocolosDia";
import { cn } from "@/lib/utils";

/** Telão fica ligado o dia todo sem ninguém olhando — recarrega sozinho. */
const REFRESH_MS = 60_000;

function Bloco({
  valor,
  label,
  sub,
  destaque,
}: {
  valor: number | string;
  label: string;
  sub?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl px-6 py-5 flex flex-col items-center justify-center text-center",
        destaque ? "bg-emerald-500/15 ring-1 ring-emerald-400/30" : "bg-white/5",
      )}
    >
      <span
        className={cn(
          "font-black tabular-nums leading-none",
          destaque ? "text-6xl md:text-8xl text-emerald-300" : "text-4xl md:text-5xl text-white",
        )}
      >
        {valor}
      </span>
      <span className="mt-2 text-xs md:text-sm font-bold uppercase tracking-wider text-white/60">
        {label}
      </span>
      {sub && <span className="mt-1 text-[10px] md:text-xs text-white/40">{sub}</span>}
    </div>
  );
}

/**
 * Série por DATA DE PROTOCOLO (não por chegada do comprovante) — é a produção
 * real de cada dia. Por data de chegada o gráfico teria picos artificiais de
 * quando alguém rodou o sync na mão: 30/07/2026 tem 174 numa rodada só.
 *
 * Barra tracejada = dia dentro da janela de atraso, ainda vai subir.
 */
function Serie({ data }: { data: ProtocolosDiaData }) {
  const max = Math.max(1, ...data.serie.map((p) => p.protocolados));
  const corteParcial = (() => {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(data.lagMedianoDias, 1));
    return d.toISOString().slice(0, 10);
  })();

  if (!data.serie.length) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-white/40" />
        <span className="text-xs font-bold uppercase tracking-wider text-white/50">
          Últimos 14 dias — por data do protocolo
        </span>
        <span className="text-[10px] text-white/30 normal-case">
          tracejado = ainda chegando
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-32">
        {data.serie.map((p) => {
          const parcial = p.dia > corteParcial;
          return (
            <div key={p.dia} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <span className="text-[10px] md:text-xs font-bold tabular-nums text-white/70">
                {p.protocolados || ""}
              </span>
              <div className="w-full flex-1 flex items-end">
                <div
                  className={cn(
                    "w-full rounded-t-md transition-all",
                    p.protocolados === 0
                      ? "bg-white/10"
                      : parcial
                        ? "bg-sky-400/25 border border-dashed border-sky-300/50"
                        : "bg-sky-400/70",
                  )}
                  style={{ height: `${Math.max((p.protocolados / max) * 100, 4)}%` }}
                />
              </div>
              <span className="text-[9px] md:text-[11px] tabular-nums text-white/40">
                {p.dia.slice(8, 10)}/{p.dia.slice(5, 7)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TvProtocolosPanel() {
  const { data, loading, error } = useProtocolosDia(14, REFRESH_MS);
  const atrasado = syncEstaAtrasado(data.ultimoSync);
  const h = horasDesdeSync(data.ultimoSync);

  if (error) {
    return (
      <div className="py-24 text-center text-red-300 text-lg flex flex-col items-center gap-3">
        <AlertTriangle className="h-10 w-10" />
        Falha ao carregar protocolos: {error}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-11 w-11 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
          <FileCheck2 className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl md:text-2xl font-black text-white leading-tight">
            Protocolos administrativos INSS
          </h2>
          <p className="text-xs md:text-sm text-white/50">
            Comprovantes recebidos do INSS por e-mail
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="col-span-2">
          <Bloco
            destaque
            valor={loading ? "—" : data.hoje.registrados}
            label="Hoje"
            sub="comprovantes recebidos"
          />
        </div>
        <Bloco valor={loading ? "—" : data.ontem.registrados} label="Ontem" />
        <Bloco valor={loading ? "—" : data.semana.registrados} label="Semana" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 mt-3 md:mt-4">
        <Bloco
          valor={loading ? "—" : data.mes.registrados}
          label="No mês"
        />
        <Bloco
          valor={loading ? "—" : data.hoje.protocolados}
          label="Com data de hoje"
          sub={`sobe nos próximos dias — comprovante demora ~${data.lagMedianoDias}d`}
        />
      </div>

      <Serie data={data} />

      {atrasado && !loading && (
        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-amber-300 bg-amber-500/10 rounded-xl px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {h === null
              ? "A sincronização com o e-mail do INSS nunca rodou — número não confiável."
              : `Sincronização parada há ${h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)} dias`} — número pode estar defasado.`}
          </span>
        </div>
      )}
    </div>
  );
}
