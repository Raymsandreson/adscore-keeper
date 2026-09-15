/**
 * O que os clientes pedem, e o que o atendente virtual fez com cada pedido.
 *
 * O painel ao lado já filtrava por intenção, mas só dentro da FILA CARREGADA:
 * contava o que está pendente AGORA. Isso responde "o que falta fazer" e não
 * responde "o que entrou" — nem "reclamação aumentou esta semana?", nem
 * "quantos falaram em desistir no mês?". Duas perguntas diferentes, e a
 * segunda não tinha onde ser feita.
 *
 * A fonte é `dom_decisoes`, que registra TODA decisão do agente, inclusive o
 * silêncio. Quem olha só a fila vê o que sobrou; quem olha as decisões vê o
 * que chegou.
 *
 * POR QUE A CONTA VEM DO BANCO
 *
 * `dom_intencoes_resumo` e `dom_intencoes_por_dia` devolvem uma linha por
 * intenção e uma por dia. São 1.292 decisões hoje e entram ~200 por dia com o
 * Dom ligado: baixar tudo para somar aqui funciona neste mês e mente no
 * terceiro, quando o teto de linhas cortar a janela sem avisar.
 *
 * O GRÁFICO É POR FAMÍLIA, A TABELA É POR CÓDIGO
 *
 * Vinte e três séries num gráfico não se leem. A visualização usa as seis
 * famílias; quem precisa do código exato tem a tabela embaixo, que é onde a
 * pergunta fica específica ("quantos E20 esta semana?").
 *
 * TRÊS DECISÕES DE LEITURA (15/09/2026)
 *
 * A primeira versão despejava as 23 intenções abertas, em seis colunas, com
 * sete cores de família disputando a mesma atenção. Cabia tudo na tela e não
 * se lia nada. O conserto foi tirar peso, não tirar dado:
 *
 * 1. COR SÓ ONDE DÓI. Vermelho para o que custa cliente se demorar, verde da
 *    marca para o que o Dom resolveu, cinza para o resto (ver `../intencoes`).
 * 2. A TABELA NASCE DOBRADA. Uma seção por família, e só "precisa de gente" e
 *    "cobrança" abrem sozinhas — as outras ficam com o total à vista e o
 *    detalhe a um clique. Quem procura E20 abre "precisa de gente"; quem só
 *    quer saber se tem fogo lê as duas primeiras linhas e vai embora.
 * 3. TRÊS COLUNAS, NÃO SEIS. "Grupos", "Dom respondeu" e "Calou" saíram da
 *    grade e entraram no cabeçalho da aba lateral, que é onde a pergunta deixa
 *    de ser "quanto" e passa a ser "quais".
 *
 * E a linha virou clicável: abre `DecisoesDaIntencaoSheet` com as decisões
 * daquela intenção, por cima do relatório, sem tirar ninguém da tela.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ChevronRight, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COR, FAMILIA_DE, ORDEM_FAMILIAS, rotuloDaIntencao } from '../intencoes';
import { DecisoesDaIntencaoSheet, SEM_CLASSIFICACAO, type ResumoDaIntencao } from './DecisoesDaIntencaoSheet';

const dbAny = db as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * As que abrem sozinhas. São as duas em que demorar custa dinheiro — e as
 * únicas que alguém precisa ver sem pedir. O resto abre com um clique e some
 * com outro.
 */
const FAMILIAS_ABERTAS = new Set(['precisa de gente', 'cobrança']);

const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];

interface LinhaResumo {
  intencao: string;
  total: number;
  respondeu: number;
  precisou_gente: number;
  calou: number;
  pulou: number;
  virou_fila: number;
  grupos: number;
  ultima: string | null;
}

interface LinhaDia { dia: string; familia: string; total: number }

export function RelatorioDeIntencoes() {
  const [dias, setDias] = useState(7);
  const [resumo, setResumo] = useState<LinhaResumo[]>([]);
  const [serie, setSerie] = useState<LinhaDia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [alternadas, setAlternadas] = useState<Set<string>>(new Set());
  const [intencaoAberta, setIntencaoAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const [r, s] = await Promise.all([
        dbAny.rpc('dom_intencoes_resumo', { p_dias: dias }),
        dbAny.rpc('dom_intencoes_por_dia', { p_dias: dias }),
      ]);
      if (r.error) throw r.error;
      if (s.error) throw s.error;
      setResumo((r.data as LinhaResumo[]) || []);
      setSerie((s.data as LinhaDia[]) || []);
    } catch (e) {
      // Dizer o que falhou. "Sem dados" faria alguém procurar cliente quieto
      // quando o problema é a consulta.
      setErro((e as Error)?.message || 'não consegui carregar o relatório');
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => { carregar(); }, [carregar]);

  /** Uma linha por dia, com uma coluna por família — o formato do recharts. */
  const dadosDoGrafico = useMemo(() => {
    const porDia = new Map<string, Record<string, number | string>>();
    for (const l of serie) {
      const atual = porDia.get(l.dia) || { dia: l.dia };
      atual[l.familia] = Number(l.total);
      porDia.set(l.dia, atual);
    }
    return [...porDia.values()].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  }, [serie]);

  /** Só as famílias que aparecem no período — barra vazia vira legenda morta. */
  const familiasPresentes = useMemo(
    () => ORDEM_FAMILIAS.filter(f => serie.some(l => l.familia === f)),
    [serie],
  );

  const totais = useMemo(() => {
    const t = { total: 0, precisouGente: 0, respondeu: 0, calou: 0 };
    for (const l of resumo) {
      t.total += Number(l.total);
      t.precisouGente += Number(l.precisou_gente);
      t.respondeu += Number(l.respondeu);
      t.calou += Number(l.calou);
    }
    return t;
  }, [resumo]);

  /**
   * A tabela em seções: uma por família, na ordem fixa, e dentro dela as
   * intenções por volume. É a leitura de quem age — o que exige gente em cima.
   */
  const secoes = useMemo(() => {
    const porFamilia = new Map<string, LinhaResumo[]>();
    for (const l of resumo) {
      const f = FAMILIA_DE(l.intencao);
      const atual = porFamilia.get(f) || [];
      atual.push(l);
      porFamilia.set(f, atual);
    }
    return ORDEM_FAMILIAS
      .filter(f => porFamilia.has(f))
      .map(familia => {
        const linhas = [...(porFamilia.get(familia) || [])]
          .sort((a, b) => Number(b.total) - Number(a.total));
        return {
          familia,
          linhas,
          vezes: linhas.reduce((s, l) => s + Number(l.total), 0),
          gente: linhas.reduce((s, l) => s + Number(l.precisou_gente), 0),
        };
      });
  }, [resumo]);

  /** O cabeçalho da aba lateral sem recarregar o que a tabela já sabe. */
  const resumoDaAberta = useMemo<ResumoDaIntencao | null>(() => {
    const l = resumo.find(x => x.intencao === intencaoAberta);
    if (!l) return null;
    return {
      total: Number(l.total),
      grupos: Number(l.grupos),
      precisou_gente: Number(l.precisou_gente),
      respondeu: Number(l.respondeu),
      calou: Number(l.calou),
    };
  }, [resumo, intencaoAberta]);

  const alternar = (familia: string) => {
    setAlternadas(atual => {
      const novo = new Set(atual);
      if (novo.has(familia)) novo.delete(familia);
      else novo.add(familia);
      return novo;
    });
  };

  /** Aberta por decisão de quem clicou, ou por nascer assim. */
  const estaAberta = (familia: string) =>
    alternadas.has(familia) ? !FAMILIAS_ABERTAS.has(familia) : FAMILIAS_ABERTAS.has(familia);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-medium">O que os clientes pediram</h3>
        </div>
        <div className="flex items-center gap-1">
          {PERIODOS.map(p => (
            <Button
              key={p.dias}
              size="sm"
              variant={dias === p.dias ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px]"
              onClick={() => setDias(p.dias)}
            >
              {p.rotulo}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={carregar} disabled={carregando}>
            <RefreshCw className={cn('h-3 w-3', carregando && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {carregando && resumo.length === 0 && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> carregando…
        </div>
      )}

      {!carregando && resumo.length === 0 && !erro && (
        <p className="py-6 text-center text-[11px] text-muted-foreground">
          Nenhuma decisão registrada nos últimos {dias} dias.
        </p>
      )}

      {resumo.length > 0 && (
        <>
          {/* Quatro números que resumem o período. Só um é vermelho: o que
              vira trabalho da equipe. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { rotulo: 'mensagens lidas', valor: totais.total, cor: '' },
              { rotulo: 'precisou de gente', valor: totais.precisouGente, cor: 'text-destructive' },
              { rotulo: 'o Dom respondeu', valor: totais.respondeu, cor: 'text-primary' },
              { rotulo: 'não pediam resposta', valor: totais.calou, cor: 'text-muted-foreground' },
            ].map(c => (
              <div key={c.rotulo} className="rounded-md border bg-card p-2">
                <p className={cn('text-lg font-semibold leading-none tabular-nums', c.cor)}>{c.valor}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{c.rotulo}</p>
              </div>
            ))}
          </div>

          {/* A visualização: volume por dia, empilhado por família. */}
          <div className="rounded-md border p-2">
            <p className="text-[10px] text-muted-foreground mb-1">
              Por dia, agrupado por tipo de pedido
            </p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosDoGrafico} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis
                    dataKey="dia"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d: string) => format(parseISO(d), 'dd/MM', { locale: ptBR })}
                  />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    labelFormatter={(d: string) => format(parseISO(d), "dd 'de' MMMM", { locale: ptBR })}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {familiasPresentes.map(f => (
                    <Bar key={f} dataKey={f} stackId="a" fill={COR[f]} radius={[0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* O relatório: uma seção por família, dobrável, e dentro dela uma
              linha por intenção. Clicar na linha abre o detalhe ao lado. */}
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-normal">Pedido do cliente</th>
                  <th className="px-2 py-1.5 font-normal text-right w-16">Vezes</th>
                  <th className="px-2 py-1.5 font-normal text-right w-32">Precisou de gente</th>
                </tr>
              </thead>
              {secoes.map(s => {
                const aberta = estaAberta(s.familia);
                return (
                  <tbody key={s.familia} className="border-t">
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={aberta}
                      className="cursor-pointer select-none hover:bg-muted/40 transition-colors"
                      onClick={() => alternar(s.familia)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          alternar(s.familia);
                        }
                      }}
                    >
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <ChevronRight
                            className={cn('h-3 w-3 text-muted-foreground transition-transform', aberta && 'rotate-90')}
                            aria-hidden
                          />
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: COR[s.familia] }}
                            aria-hidden
                          />
                          <span className="font-medium">{s.familia}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.linhas.length} {s.linhas.length === 1 ? 'tipo' : 'tipos'}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{s.vezes}</td>
                      <td className={cn(
                        'px-2 py-1.5 text-right tabular-nums',
                        s.gente > 0 ? 'text-destructive font-medium' : 'text-muted-foreground',
                      )}>
                        {s.gente || '—'}
                      </td>
                    </tr>

                    {aberta && s.linhas.map(l => (
                      <tr
                        key={l.intencao}
                        role="button"
                        tabIndex={0}
                        title="ver as conversas aqui do lado"
                        className="cursor-pointer border-t border-border/50 hover:bg-muted/40 transition-colors"
                        onClick={() => setIntencaoAberta(l.intencao)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIntencaoAberta(l.intencao);
                          }
                        }}
                      >
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5 pl-[18px] min-w-[180px]">
                            <span className="truncate">{rotuloDaIntencao(l.intencao)}</span>
                            {l.intencao !== SEM_CLASSIFICACAO && (
                              <span className="text-[9px] text-muted-foreground shrink-0">{l.intencao}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.total}</td>
                        <td className={cn(
                          'px-2 py-1.5 text-right tabular-nums',
                          Number(l.precisou_gente) > 0 ? 'text-destructive' : 'text-muted-foreground',
                        )}>
                          {Number(l.precisou_gente) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Conta toda decisão do atendente virtual, inclusive quando ele escolheu
            calar. Dia no fuso de Teresina. "Precisou de gente" é o que virou
            pendência para a equipe responder. Clique num pedido para ver as
            conversas aqui do lado.
          </p>
        </>
      )}

      <DecisoesDaIntencaoSheet
        intencao={intencaoAberta}
        dias={dias}
        resumo={resumoDaAberta}
        onClose={() => setIntencaoAberta(null)}
      />
    </div>
  );
}
