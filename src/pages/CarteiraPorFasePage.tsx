// =============================================================================
// Carteira por fase do POP: onde os processos estão hoje e quanto vale cada fase.
//
// Responde três perguntas na mesma tela:
//   1. em que fase/marco cada processo está;
//   2. quanto de dinheiro está parado em cada fase;
//   3. em que estágio financeiro esse dinheiro se encontra.
//
// O NÚMERO AQUI NÃO É A SOMA DE jm_valores. Aquela tabela tem uma linha por
// (decisão x cliente), e o mesmo cliente aparece de novo a cada decisão que
// confirma o valor — somar direto dá R$ 83,2 mi contra R$ 31,6 mi reais.
// A view usa a última decisão de cada cliente. Ver vw_pop_carteira_por_fase.
// =============================================================================
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useCarteiraPorFase, type Periodo, type GrupoFase } from '@/hooks/useCarteiraPorFase';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { Wallet, RefreshCw, PanelRightOpen, Handshake, PauseCircle } from 'lucide-react';

const PERIODOS: { v: Periodo; label: string }[] = [
  { v: 'tudo', label: 'Tudo' },
  { v: '12m', label: '12 meses' },
  { v: '90d', label: '90 dias' },
  { v: '30d', label: '30 dias' },
];

const CORES: Record<string, string> = {
  PROJETADO: 'bg-slate-500',
  CONDENACAO: 'bg-blue-500',
  A_RECEBER: 'bg-emerald-500',
  VENCIDO: 'bg-red-500',
  EM_EXECUCAO: 'bg-amber-500',
  DEPOSITADO_EM_JUIZO: 'bg-violet-500',
  PAGO: 'bg-teal-600',
  INDEFERIDO: 'bg-muted-foreground',
};

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export default function CarteiraPorFasePage() {
  const [periodo, setPeriodo] = useState<Periodo>('tudo');
  const { linhas, grupos, totais, loading, erro, recarregar } = useCarteiraPorFase(periodo);
  const [aberta, setAberta] = useState<GrupoFase | null>(null);

  const doGrupo = aberta
    ? linhas.filter((l) => (l.marco_rotulo || 'Sem marco detectado') === aberta.fase)
    : [];

  return (
    <div className="container mx-auto max-w-5xl space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Carteira por fase do POP
            </CardTitle>
            <CardDescription>
              Onde cada processo está hoje e quanto vale ali. O valor é a condenação
              fixada na <b>última decisão de cada cliente</b> — somar todas as decisões
              contaria o mesmo dinheiro várias vezes.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => void recarregar()}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1">
            {PERIODOS.map((p) => (
              <button
                key={p.v}
                onClick={() => setPeriodo(p.v)}
                title="Filtra pela data em que o processo entrou na fase"
                className={`rounded-full border px-3 py-0.5 text-xs transition-colors ${
                  periodo === p.v ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {erro ? (
            <p className="text-sm text-destructive">Erro: {erro}</p>
          ) : loading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Resumo rotulo="Processos" valor={String(totais.processos)} />
                <Resumo rotulo="Valor em carteira" valor={moeda(totais.valor)} />
                <Resumo rotulo="Já recebido" valor={moeda(totais.pago)} />
                <Resumo rotulo="Fases com processo" valor={String(grupos.length)} />
              </div>

              <div className="space-y-2">
                {grupos.map((g) => {
                  const pctValor = totais.valor > 0 ? Math.round((g.valor / totais.valor) * 100) : 0;
                  return (
                    <button
                      key={g.fase}
                      type="button"
                      onClick={() => setAberta(g)}
                      title="abrir a lista aqui do lado"
                      className="flex w-full items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">{g.ordem === 99 ? '—' : g.ordem}</span>
                          <span className="font-medium">{g.fase}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {g.processos} processo{g.processos > 1 ? 's' : ''}
                          </Badge>
                          {g.comAcordo > 0 ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <Handshake className="h-3 w-3" /> {g.comAcordo} com acordo
                            </Badge>
                          ) : null}
                          {g.suspensos > 0 ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <PauseCircle className="h-3 w-3" /> {g.suspensos} suspenso
                            </Badge>
                          ) : null}
                        </div>

                        {/* Barra por estágio financeiro: mostra em que estado está
                            o dinheiro parado nesta fase. */}
                        {g.valor > 0 ? (
                          <>
                            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted">
                              {Object.entries(g.porEstagio)
                                .filter(([, v]) => v > 0)
                                .map(([est, v]) => (
                                  <div
                                    key={est}
                                    className={CORES[est] || 'bg-muted-foreground'}
                                    style={{ width: `${(v / g.valor) * 100}%` }}
                                    title={`${ESTAGIO_LABEL[est] || est}: ${moeda(v)}`}
                                  />
                                ))}
                            </div>
                            <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                              {Object.entries(g.porEstagio)
                                .filter(([, v]) => v > 0)
                                .map(([est, v]) => (
                                  <span key={est}>
                                    <span className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${CORES[est] || ''}`} />
                                    {ESTAGIO_LABEL[est] || est} {moeda(v)}
                                  </span>
                                ))}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            sem valor fixado ainda
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">{moeda(g.valor)}</p>
                        <p className="text-[11px] text-muted-foreground">{pctValor}% da carteira</p>
                        <PanelRightOpen className="ml-auto mt-1 h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!aberta} onOpenChange={(o) => { if (!o) setAberta(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="text-left">
            <SheetTitle>{aberta?.fase}</SheetTitle>
            <SheetDescription>
              {aberta?.processos} processo(s) · {moeda(aberta?.valor || 0)}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {doGrupo.map((l, i) => (
              <div key={`${l.processo_cnj}-${l.cliente}-${i}`} className="rounded-md border p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-medium">{l.processo_cnj}</span>
                  {l.tem_acordo ? <Badge variant="secondary" className="text-[10px]">acordo</Badge> : null}
                  {l.suspenso ? <Badge variant="secondary" className="text-[10px]">suspenso</Badge> : null}
                  <Badge className={`text-[10px] ${CORES[l.estagio_financeiro] || ''} text-white`}>
                    {ESTAGIO_LABEL[l.estagio_financeiro] || l.estagio_financeiro}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {l.cliente || 'sem cliente vinculado'}
                  {l.valor_condenacao ? ` · ${moeda(Number(l.valor_condenacao))}` : ''}
                  {Number(l.valor_pago) > 0 ? ` · recebido ${moeda(Number(l.valor_pago))}` : ''}
                </p>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
