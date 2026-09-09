// Painel de métricas: investimento ao vivo + funil, num lugar só.
//
// Tudo vem de UMA chamada (`metricas-painel`, no Railway). O token da Meta nunca
// chega aqui, e `meta_capi_events` tem RLS sem policy — o navegador não alcança
// essas tabelas nem se quisesse.
//
// REGRA DESTA TELA: número que não pode ser calculado com honestidade aparece
// como "—" com o motivo do lado. Nunca como zero, nunca como estimativa.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, TrendingUp, Users, Handshake, Wallet, AlertTriangle, Send, Check, X, Link2,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cloudFunctions } from '@/lib/functionRouter';

const ATUALIZA_MS = 60_000;

const brl = (v: number | null | undefined) =>
  typeof v === 'number'
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
    : '—';
const num = (v: number | null | undefined) =>
  typeof v === 'number' ? new Intl.NumberFormat('pt-BR').format(v) : '—';
const diaCurto = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

interface Painel {
  gerado_em: string;
  janela: { de: string; ate: string };
  investimento: {
    disponivel: boolean;
    erro?: string;
    total_hoje: number; total_7d: number; total_30d: number;
    contas: Array<{ conta: string; id: string; moeda?: string; ativa?: boolean; hoje?: number; ultimos_7d?: number; ultimos_30d?: number; erro?: string }>;
  };
  leads: { hoje: number; pagos_hoje: number; ultimos_7d: number; pagos_7d: number; ultimos_30d: number; pagos_30d: number; entraram_no_funil_hoje: number; entraram_no_funil_7d: number; por_fonte: Array<{ nome: string; qtd: number }>; por_board: Array<{ nome: string; qtd: number }> };
  fechamentos: { hoje: number; ultimos_7d: number; ultimos_30d: number; por_fonte: Array<{ nome: string; qtd: number }>; por_board: Array<{ nome: string; qtd: number }> };
  serie: Array<{ dia: string; leads: number; fechamentos: number; investido: number }>;
  capi: Record<string, any>;
  funil_por_status: Record<string, number>;
  integracao: {
    disponivel: boolean;
    erro?: string;
    dataset_id?: string;
    conjuntos_ativos?: number;
    conjuntos_otimizando_conversao?: number;
    conjuntos_usando_dataset?: number;
    detalhe?: Array<{ nome: string; conta: string; otimizacao: string; usa_dataset: boolean }>;
  };
  custo: {
    leads_pagos_7d: number; leads_pagos_30d: number;
    por_lead_pago_7d: number | null; por_lead_pago_30d: number | null;
    por_fechamento_pago_30d: number | null;
    cobertura_pagos_desde: string | null; cobertura_completa_30d: boolean; aviso_30d: string | null;
  };
}

function Kpi({
  titulo, valor, sub, rodape, icone, destaque, aviso,
}: { titulo: string; valor: string; sub?: string; rodape?: string; icone: React.ReactNode; destaque?: boolean; aviso?: string | null }) {
  return (
    <Card className={destaque ? 'border-primary/40' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          {icone}
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`font-bold tabular-nums ${destaque ? 'text-3xl text-primary' : 'text-2xl'}`}>{valor}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        {rodape && <p className="text-[11px] text-muted-foreground/70 mt-1.5 border-t pt-1.5">{rodape}</p>}
        {aviso && (
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 flex items-start gap-1">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{aviso}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}


const ROTULO_STATUS: Record<string, string> = {
  no_response: 'Sem resposta',
  in_progress: 'Em atendimento',
  closed: 'Fechado',
  inviavel: 'Inviável',
  cancelled: 'Cancelado',
  refused: 'Recusado',
};

/** Linha do checklist: o que precisa estar feito para a otimização por conversão valer. */
function Passo({ ok, texto, detalhe }: { ok: boolean; texto: string; detalhe?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <span className={ok ? '' : 'text-muted-foreground'}>{texto}</span>
        {detalhe && <span className="text-xs text-muted-foreground block">{detalhe}</span>}
      </div>
    </div>
  );
}

function Ranking({ titulo, itens }: { titulo: string; itens: Array<{ nome: string; qtd: number }> }) {
  const maior = itens[0]?.qtd || 1;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">{titulo}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {itens.length === 0 && <p className="text-sm text-muted-foreground">Nada na janela.</p>}
        {itens.map((i) => (
          <div key={i.nome} className="space-y-1">
            <div className="flex justify-between text-sm gap-2">
              <span className="truncate" title={i.nome}>{i.nome}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">{num(i.qtd)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary/60" style={{ width: `${Math.max(2, (i.qtd / maior) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function MetricasPage() {
  const [dados, setDados] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const buscar = useCallback(async () => {
    try {
      const { data, error } = await cloudFunctions.invoke('metricas-painel', { body: {} });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setDados(data as Painel);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha ao carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    buscar();
    const t = setInterval(buscar, ATUALIZA_MS);
    return () => clearInterval(t);
  }, [buscar]);

  const inv = dados?.investimento;
  const custo = dados?.custo;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />Voltar</Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-primary" />Métricas
              </h1>
              <p className="text-sm text-muted-foreground truncate">
                {dados ? `Janela de ${diaCurto(dados.janela.de)} a ${diaCurto(dados.janela.ate)} · atualiza sozinho a cada minuto` : 'Investimento, leads e fechamentos'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={buscar} disabled={carregando} className="gap-2 shrink-0">
            <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />Atualizar
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {erro && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Não consegui carregar as métricas: {erro}</span>
            </CardContent>
          </Card>
        )}

        {carregando && !dados && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        )}

        {dados && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                destaque
                titulo="Investido hoje"
                valor={inv?.disponivel ? brl(inv.total_hoje) : '—'}
                sub={inv?.disponivel ? `${brl(inv.total_7d)} em 7 dias · ${brl(inv.total_30d)} em 30` : inv?.erro || 'sem acesso à conta de anúncios'}
                icone={<Wallet className="h-3.5 w-3.5" />}
              />
              <Kpi
                titulo="Leads de anúncio hoje"
                valor={num(dados.leads.pagos_hoje)}
                sub={`${num(dados.leads.pagos_7d)} em 7 dias · ${num(dados.leads.pagos_30d)} em 30`}
                rodape={
                  `${num(dados.leads.hoje)} no total hoje (o resto é notícia e orgânico) · ` +
                  `${num(dados.leads.entraram_no_funil_hoje)} entraram no funil hoje`
                }
                icone={<Users className="h-3.5 w-3.5" />}
              />
              <Kpi
                titulo="Fechamentos hoje"
                valor={num(dados.fechamentos.hoje)}
                sub={`${num(dados.fechamentos.ultimos_7d)} em 7 dias · ${num(dados.fechamentos.ultimos_30d)} em 30`}
                icone={<Handshake className="h-3.5 w-3.5" />}
              />
              <Kpi
                titulo="Custo por lead pago (7d)"
                valor={brl(custo?.por_lead_pago_7d)}
                sub={`${num(custo?.leads_pagos_7d)} leads de anúncio em 7 dias`}
                icone={<TrendingUp className="h-3.5 w-3.5" />}
                aviso={custo?.cobertura_completa_30d ? null : custo?.aviso_30d}
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Últimos 30 dias</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Barras: leads e fechamentos por dia. Linha: investimento do dia.
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dados.serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="dia" tickFormatter={diaCurto} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis yAxisId="q" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                      <Tooltip
                        formatter={(v: any, nome: any) => (nome === 'Investido' ? brl(Number(v)) : num(Number(v)))}
                        labelFormatter={(l) => `Dia ${diaCurto(String(l))}`}
                      />
                      <Legend />
                      <Bar yAxisId="q" dataKey="leads" name="Leads" fill="hsl(var(--primary))" fillOpacity={0.55} radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="q" dataKey="fechamentos" name="Fechamentos" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="investido" name="Investido" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Link2 className="h-4 w-4" />Saúde da integração com a Meta
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    O que ainda falta para o anúncio otimizar por cliente fechado, e não por volume de lead.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {!dados.integracao?.disponivel ? (
                    <p className="text-sm text-muted-foreground">
                      Não consegui ler a conta de anúncio agora{dados.integracao?.erro ? `: ${dados.integracao.erro}` : '.'}
                    </p>
                  ) : (
                    <>
                      <Passo
                        ok={(dados.capi.sent || 0) > 0}
                        texto="Conversões chegando à Meta"
                        detalhe={`${num(dados.capi.sent || 0)} aceitas`}
                      />
                      <Passo
                        ok={(dados.capi.aceitos_com_lead_id || 0) > 0}
                        texto="Conversões com o id do lead da Meta"
                        detalhe={`${num(dados.capi.aceitos_com_lead_id || 0)} de ${num(dados.capi.sent || 0)} — é o que casa a venda com o formulário do anúncio`}
                      />
                      <Passo
                        ok={(dados.integracao.conjuntos_otimizando_conversao || 0) > 0}
                        texto="Conjuntos otimizando por conversão"
                        detalhe={`${num(dados.integracao.conjuntos_otimizando_conversao || 0)} de ${num(dados.integracao.conjuntos_ativos || 0)} ativos — trocar em "Leads com conversão" no Gerenciador`}
                      />
                      <p className="text-xs text-muted-foreground pt-2 border-t">
                        Enquanto o último item não estiver marcado, a Meta recebe as conversões mas continua
                        comprando lead por volume, não por quem fecha contrato.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Funil por status</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {Object.entries(dados.funil_por_status || {})
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{ROTULO_STATUS[k] || k}</span>
                        <span className="tabular-nums">{num(v)}</span>
                      </div>
                    ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4" />Conversões enviadas à Meta</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    ['sent', 'Aceitas pela Meta'],
                    ['pending', 'Na fila'],
                    ['skipped', 'Ignoradas (sem contato ou sem valor)'],
                    ['failed', 'Recusadas'],
                  ].map(([k, rot]) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{rot}</span>
                      <Badge variant={k === 'failed' && (dados.capi[k] || 0) > 0 ? 'destructive' : 'secondary'} className="tabular-nums">
                        {num(dados.capi[k] || 0)}
                      </Badge>
                    </div>
                  ))}
                  <div className="pt-2 border-t space-y-1">
                    {Object.entries(dados.capi.motivos_ignorado || {}).map(([motivo, qtd]) => (
                      <p key={motivo} className="text-xs text-muted-foreground">
                        {num(qtd as number)} — {motivo}
                      </p>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Ignorada não é erro de envio: é lead fechado que a Meta descartaria. É lista de conserto.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Ranking titulo="Leads por origem (30 dias)" itens={dados.leads.por_fonte.slice(0, 8)} />
              <Ranking titulo="Leads por funil (30 dias)" itens={dados.leads.por_board.slice(0, 8)} />
            </div>

            {inv?.disponivel && inv.contas.length > 0 && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Contas de anúncio</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b">
                          <th className="pb-2 font-medium">Conta</th>
                          <th className="pb-2 font-medium text-right">Hoje</th>
                          <th className="pb-2 font-medium text-right">7 dias</th>
                          <th className="pb-2 font-medium text-right">30 dias</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.contas.map((c) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="py-2">
                              {c.conta}
                              {c.erro && <span className="text-xs text-destructive ml-2">{c.erro}</span>}
                            </td>
                            <td className="py-2 text-right tabular-nums">{brl(c.hoje)}</td>
                            <td className="py-2 text-right tabular-nums">{brl(c.ultimos_7d)}</td>
                            <td className="py-2 text-right tabular-nums">{brl(c.ultimos_30d)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Gerado em {new Date(dados.gerado_em).toLocaleString('pt-BR')}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
