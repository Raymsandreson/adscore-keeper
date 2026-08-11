// Card de protocolos administrativos INSS do dia.
//
// Duas variantes da MESMA fonte, pra não divergirem com o tempo:
//   compact → faixa no topo da Visão Geral
//   full    → bloco no Acompanhamento Processual (inclui série de 14 dias)
//
// Decisão de apresentação que vale explicar: o número grande é "registrados
// hoje" (comprovantes que chegaram), não "protocolados hoje" (data do
// protocolo). Os dois estão na tela, com rótulo, porque medem coisas
// diferentes — ver comentário em src/lib/protocolosDia.ts. "Protocolados hoje"
// é quase sempre 0 no próprio dia; se fosse ele em destaque, o painel diria
// que a equipe não protocolou nada.

import { useMemo, useState } from "react";
import { FileCheck2, AlertTriangle, Clock, ListFilter } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ProtocolosListaSheet from "@/components/protocolos/ProtocolosListaSheet";
import { cn } from "@/lib/utils";
import {
  useProtocolosDia,
  syncEstaAtrasado,
  horasDesdeSync,
  type ProtocolosDiaData,
} from "@/lib/protocolosDia";

interface Props {
  variant?: "compact" | "full";
  className?: string;
}

function fmtHorasSync(ultimoSync: string | null): string {
  const h = horasDesdeSync(ultimoSync);
  if (h === null) return "o sync nunca rodou";
  if (h < 1) return `sincronizado há ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `sincronizado há ${Math.round(h)}h`;
  return `sincronizado há ${Math.round(h / 24)} dias`;
}

/**
 * Série por DATA DE PROTOCOLO, não por data de registro.
 *
 * Motivo: "registrados" mede quando o comprovante chegou, e enquanto o sync
 * rodava só por clique isso virava pico artificial (30/07/2026 tem 174 numa
 * rodada de backfill). Uma barra dessas esmaga o resto do gráfico e sugere um
 * dia de produção recorde que não existiu. Por data de protocolo a série é a
 * produção real — inclusive os zeros de fim de semana.
 *
 * Contrapartida: os dias mais recentes ainda estão incompletos, porque o
 * comprovante demora a chegar. Eles vão hachurados em vez de sólidos.
 */
function SerieBarras({ data }: { data: ProtocolosDiaData }) {
  const max = useMemo(
    () => Math.max(1, ...data.serie.map((p) => p.protocolados)),
    [data.serie],
  );
  // Dentro da janela de atraso típico, o dia ainda vai receber protocolos.
  const corteParcial = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(data.lagMedianoDias, 1));
    return d.toISOString().slice(0, 10);
  }, [data.lagMedianoDias]);

  if (!data.serie.length) return null;

  return (
    <div className="flex items-end gap-1 h-16" role="img" aria-label="Protocolos por data de protocolo nos últimos 14 dias">
      {data.serie.map((p) => {
        const alturaPct = (p.protocolados / max) * 100;
        const parcial = p.dia > corteParcial;
        return (
          <div key={p.dia} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full flex-1 flex items-end">
              <div
                className={cn(
                  "w-full rounded-sm transition-all",
                  p.protocolados === 0
                    ? "bg-muted"
                    : parcial
                      ? "bg-primary/30 border border-dashed border-primary/50"
                      : "bg-primary/70",
                )}
                style={{ height: `${Math.max(alturaPct, 3)}%` }}
                title={
                  `${p.dia}: ${p.protocolados} protocolo(s)` +
                  (parcial ? " — ainda incompleto, comprovantes a caminho" : "")
                }
              />
            </div>
            <span className="text-[9px] text-muted-foreground tabular-nums">{p.dia.slice(8, 10)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ProtocolosDiaCard({ variant = "compact", className }: Props) {
  const { data, loading, error } = useProtocolosDia(14);
  const atrasado = syncEstaAtrasado(data.ultimoSync);
  // A lista fica atrás de um clique de propósito: ela mostra nome de segurado,
  // o card não. Nada de PII aparece sem alguém pedir.
  const [listaAberta, setListaAberta] = useState(false);

  if (error) {
    return (
      <Card className={cn("border-destructive/40", className)}>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Falha ao carregar protocolos: {error}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card className={className}>
      <CardContent className={cn("p-4", variant === "full" && "p-5 space-y-4")}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <FileCheck2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums leading-none">
                  {loading ? "—" : data.hoje.registrados}
                </span>
                <span className="text-sm text-muted-foreground">
                  {data.hoje.registrados === 1 ? "protocolo registrado hoje" : "protocolos registrados hoje"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Comprovantes INSS que chegaram hoje por e-mail
              </p>
            </div>
          </div>

          <div className="flex items-center gap-5 text-sm">
            <div>
              <div className="font-semibold tabular-nums">{loading ? "—" : data.semana.registrados}</div>
              <div className="text-xs text-muted-foreground">na semana</div>
            </div>
            <div>
              <div className="font-semibold tabular-nums">{loading ? "—" : data.mes.registrados}</div>
              <div className="text-xs text-muted-foreground">no mês</div>
            </div>
            <div>
              <div className="font-semibold tabular-nums">{loading ? "—" : data.hoje.protocolados}</div>
              <div className="text-xs text-muted-foreground">com data de hoje</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setListaAberta(true)}
              title="Abrir a lista de protocolos, com filtro por data"
            >
              <ListFilter className="h-3.5 w-3.5" />
              Ver protocolos
            </Button>
          </div>
        </div>

        {atrasado && !loading && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-2.5 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Número pode estar defasado — {fmtHorasSync(data.ultimoSync)}. O esperado é a cada 20 min.
            </span>
          </div>
        )}

        {variant === "full" && (
          <>
            <div className="pt-1">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Protocolos por data de protocolo — últimos 14 dias{" "}
                <span className="font-normal">(barra tracejada = dia ainda incompleto)</span>
              </div>
              <SerieBarras data={data} />
            </div>

            <div className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-3">
              <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Todo protocolo entra no sistema pelo e-mail do INSS, nunca no ato. O comprovante
                costuma chegar <strong>{data.lagMedianoDias} dia(s)</strong> depois do protocolo (mediana
                dos últimos 60 dias), então <em>&ldquo;com data de hoje&rdquo;</em> começa baixo e sobe nos dias
                seguintes. Para medir a produção do dia em tempo real seria preciso registrar o
                protocolo no momento em que acontece.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>

    <ProtocolosListaSheet open={listaAberta} onOpenChange={setListaAberta} />
    </>
  );
}
