import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Filter as FilterIcon,
  Gavel,
  Scale,
  Tag,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ETIQUETAS,
  PERIODO_PROC_LABEL,
  PeriodoProc,
  RESPONSAVEIS,
  fmtDec,
  fmtInt,
  slaStatus,
  slaTone,
} from "@/lib/processualDashboardData";
import { useProcessualDashboard } from "@/hooks/useProcessualDashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RefreshCw, FileText } from "lucide-react";
import { RelatorioDiarioUsuariosSheet } from "@/components/processual/RelatorioDiarioUsuariosSheet";

const ACOES = [
  { id: "all", nome: "Todas as ações" },
  { id: "peticao", nome: "Petições" },
  { id: "audiencia", nome: "Audiências" },
  { id: "despacho", nome: "Despachos" },
  { id: "publicacao", nome: "Publicações" },
];

export default function AcompanhamentoProcessualPage() {
  const [periodo, setPeriodo] = useState<PeriodoProc>("mes");
  const [responsavel, setResponsavel] = useState("all");
  const [acao, setAcao] = useState("all");
  const [etiqueta, setEtiqueta] = useState("all");
  const [relatorioOpen, setRelatorioOpen] = useState(false);

  const { data, loading, isMock, refresh } = useProcessualDashboard(periodo);

  const totaisProtocolo = useMemo(() => {
    const fechados = data.categorias.reduce((s, c) => s + c.fechadosNoPeriodo, 0);
    const protocolados = data.categorias.reduce((s, c) => s + c.protocoladosNoPeriodo, 0);
    const pendentes = data.categorias.reduce((s, c) => s + c.pendentes, 0);
    return { fechados, protocolados, pendentes, taxa: fechados > 0 ? (protocolados / fechados) * 100 : 0 };
  }, [data]);

  const latenciaMedia = useMemo(() => {
    if (!data.latencia.length) return 0;
    return data.latencia.reduce((s, p) => s + p.horas, 0) / data.latencia.length;
  }, [data]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/40 backdrop-blur">
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Scale className="h-3.5 w-3.5" />
                <span>Processual</span>
                <span>/</span>
                <span>Acompanhamento Processual</span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Dashboard de Acompanhamento Processual
              </h1>
              <p className="text-sm text-muted-foreground">
                Monitora gargalos, tempos de transição e eficiência do fluxo jurídico — dados do WhatsJUD.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRelatorioOpen(true)}>
                <FileText className="h-3.5 w-3.5" />
                Relatório Diário
              </Button>
              <Tabs value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoProc)}>
                <TabsList>
                  <TabsTrigger value="dia">Hoje</TabsTrigger>
                  <TabsTrigger value="semana">Semana</TabsTrigger>
                  <TabsTrigger value="mes">Mês</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Filtros globais */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FilterIcon className="h-3.5 w-3.5" />
              Filtros:
            </div>
            <FilterSelect
              icon={<Users className="h-3.5 w-3.5" />}
              value={responsavel}
              onChange={setResponsavel}
              options={RESPONSAVEIS.map((r) => ({ value: r.id, label: r.nome }))}
            />
            <FilterSelect
              icon={<Activity className="h-3.5 w-3.5" />}
              value={acao}
              onChange={setAcao}
              options={ACOES.map((a) => ({ value: a.id, label: a.nome }))}
            />
            <FilterSelect
              icon={<Tag className="h-3.5 w-3.5" />}
              value={etiqueta}
              onChange={setEtiqueta}
              options={ETIQUETAS.map((e) => ({ value: e.id, label: e.nome }))}
            />
            <div className="ml-auto flex items-center gap-2">
              <Badge variant={isMock ? "outline" : "secondary"} className="gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    loading ? "bg-amber-500 animate-pulse" : isMock ? "bg-zinc-400" : "bg-emerald-500",
                  )}
                />
                {loading
                  ? "Carregando..."
                  : isMock
                    ? "Sem dados no período — exibindo amostra"
                    : `${PERIODO_PROC_LABEL[periodo]} · ${fmtInt.format(data.resumo.atualizacoesPeriodo)} atualizações`}
              </Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto space-y-6 px-6 py-6">
        {/* 1. SLA Cards */}
        <section>
          <SectionTitle
            icon={<Gavel className="h-4 w-4" />}
            title="Tempo médio de tramitação"
            subtitle="Fases macro do processo judicial — média em dias corridos"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.sla.map((s) => {
              const status = slaStatus(s.tempoMedio, s.slaIdeal);
              const tone = slaTone(status);
              const TrendIcon = s.tendencia <= 0 ? ArrowDownRight : ArrowUpRight;
              const trendGood = s.tendencia <= 0;
              return (
                <Card key={s.key} className={cn("relative overflow-hidden border", tone.border)}>
                  <div className={cn("absolute inset-x-0 top-0 h-1", tone.dot)} />
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center justify-between">
                      <span>{s.label}</span>
                      <span className={cn("flex items-center gap-0.5 text-[11px] font-medium", trendGood ? "text-emerald-600" : "text-red-600")}>
                        <TrendIcon className="h-3 w-3" />
                        {fmtDec(Math.abs(s.tendencia))}%
                      </span>
                    </CardDescription>
                    <CardTitle className="flex items-baseline gap-2 text-3xl font-semibold">
                      {fmtInt.format(s.tempoMedio)}
                      <span className="text-xs font-normal text-muted-foreground">dias</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">SLA ideal: {s.slaIdeal}d</span>
                      <span className={cn("rounded-full px-1.5 py-0.5 font-medium", tone.bg, tone.text)}>
                        {tone.label}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full transition-all", tone.dot)}
                        style={{ width: `${Math.min(100, (s.slaIdeal / s.tempoMedio) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Amostra: {fmtInt.format(s.amostra)} processos
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* 2. Eficiência de Fluxo */}
        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Latência de atualizações</CardTitle>
                  <CardDescription>
                    Tempo médio entre atualizações dentro de um mesmo processo (horas)
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-2xl font-semibold">
                    <Timer className="h-4 w-4 text-muted-foreground" />
                    {fmtDec(latenciaMedia, 0)}h
                  </div>
                  <p className="text-[11px] text-muted-foreground">média do período</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.latencia} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="data"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(d) => {
                      const date = new Date(d);
                      return `${date.getDate()}/${date.getMonth() + 1}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="h" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v}h`, "Latência"]}
                    labelFormatter={(d) => new Date(d).toLocaleDateString("pt-BR")}
                  />
                  <ReferenceLine y={48} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: "SLA 48h", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Line
                    type="monotone"
                    dataKey="horas"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Transição de status</CardTitle>
              <CardDescription>Tempo entre mudanças de fase (passagem de bastão)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {data.transicoes.map((t) => {
                const status = slaStatus(t.tempoMedioDias, t.slaIdealDias);
                const tone = slaTone(status);
                const pct = Math.min(100, (t.tempoMedioDias / Math.max(t.slaIdealDias * 1.5, 1)) * 100);
                return (
                  <div key={`${t.de}-${t.para}`} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        {t.de} <span className="text-muted-foreground">→</span> {t.para}
                      </span>
                      <span className={cn("font-semibold tabular-nums", tone.text)}>
                        {t.tempoMedioDias}d
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full", tone.dot)} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Ideal: {t.slaIdealDias}d</span>
                      <span>{fmtInt.format(t.amostra)} casos</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>

        {/* 3. Fechamento → Protocolo */}
        <section>
          <SectionTitle
            icon={<Clock className="h-4 w-4" />}
            title="Fechamento do caso → Protocolo"
            subtitle="Gargalo inicial entre conclusão do atendimento e protocolo de fato, por tipo de demanda"
            extra={
              <div className="flex items-center gap-3 text-xs">
                <Metric label="Fechados" value={fmtInt.format(totaisProtocolo.fechados)} />
                <Metric label="Protocolados" value={fmtInt.format(totaisProtocolo.protocolados)} />
                <Metric label="Pendentes" value={fmtInt.format(totaisProtocolo.pendentes)} tone="warn" />
                <Metric label="Taxa" value={`${fmtDec(totaisProtocolo.taxa, 1)}%`} tone="ok" />
              </div>
            }
          />

          <div className="mt-3 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tempo médio até protocolo (dias) — por categoria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.categorias} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="categoria"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="d" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number, n: string) => [`${fmtDec(Number(v))} dias`, n === "tempoMedioDias" ? "Tempo médio" : "SLA ideal"]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(v) => (v === "tempoMedioDias" ? "Tempo médio" : "SLA ideal")}
                    />
                    <Bar dataKey="slaIdealDias" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="tempoMedioDias" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Detalhamento por categoria</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.categorias.map((c) => {
                  const status = slaStatus(c.tempoMedioDias, c.slaIdealDias);
                  const tone = slaTone(status);
                  return (
                    <div
                      key={c.categoria}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-2.5 transition-colors",
                        tone.border,
                        tone.bg,
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="h-8 w-1 rounded-full" style={{ background: c.cor }} />
                        <div>
                          <p className="text-xs font-medium">{c.categoria}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {fmtInt.format(c.protocoladosNoPeriodo)}/{fmtInt.format(c.fechadosNoPeriodo)} protocolados
                            {c.pendentes > 0 && (
                              <span className="ml-1 text-amber-600">
                                · {c.pendentes} pendentes
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("flex items-center justify-end gap-1 text-sm font-semibold tabular-nums", tone.text)}>
                          {status === "critico" && <AlertTriangle className="h-3 w-3" />}
                          {status === "ok" && <CheckCircle2 className="h-3 w-3" />}
                          {fmtDec(c.tempoMedioDias)}d
                        </div>
                        <p className="text-[10px] text-muted-foreground">ideal {c.slaIdealDias}d</p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 4. Insights rodapé */}
        <section className="grid gap-3 md:grid-cols-3">
          <InsightCard
            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
            title="Gargalo crítico"
            description="Benefício INSS está 84% acima do SLA ideal de protocolo. 47 casos pendentes."
            tone="critico"
          />
          <InsightCard
            icon={<TrendingUp className="h-4 w-4 text-amber-500" />}
            title="Audiência → Sentença"
            description="Transição 18% acima do ideal (71d vs 60d). Concentra-se em TRT da 1ª e 5ª regiões."
            tone="alerta"
          />
          <InsightCard
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            title="Onboarding saudável"
            description="124 de 132 casos protocolados (94%). Tempo médio próximo ao SLA."
            tone="ok"
          />
        </section>
      </div>

      <RelatorioDiarioUsuariosSheet open={relatorioOpen} onOpenChange={setRelatorioOpen} />
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-md border bg-card p-1.5 text-muted-foreground">{icon}</div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {extra}
    </div>
  );
}

function FilterSelect({
  icon,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto gap-2 border-dashed text-xs">
        <span className="text-muted-foreground">{icon}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function InsightCard({
  icon,
  title,
  description,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "ok" | "alerta" | "critico";
}) {
  const t = slaTone(tone);
  return (
    <Card className={cn("border", t.border, t.bg)}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-md border bg-card p-1.5">{icon}</div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
