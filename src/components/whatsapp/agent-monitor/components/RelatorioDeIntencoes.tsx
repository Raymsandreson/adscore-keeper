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
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const dbAny = db as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * As 23 intenções em português. O código é o que o modelo devolve; o rótulo é
 * o que a pessoa lê. Manter os dois juntos evita a tela pedir que alguém
 * decore "E20".
 *
 * Esta lista tem um par na `dom-rascunho` (o prompt de classificação). Intenção
 * nova lá precisa entrar aqui, senão aparece como o código cru — que é feio,
 * mas não quebra: o fallback é mostrar o próprio código.
 */
const ROTULOS: Record<string, string> = {
  A1: 'Andamento do processo',
  A2: 'Explicar algo já dito',
  A3: 'Problema prático (app, acesso)',
  A4: 'O que ELE precisa fazer',
  B5: 'Desabafo, ansiedade',
  B6: 'Notícia boa',
  B7: 'Notícia ruim, dificuldade',
  B23: 'Elogio',
  C8: 'Entregando dado pedido',
  C9: 'Mandando documento',
  C10: 'Agendamento',
  C11: 'Fato novo do caso',
  D12: 'Só cumprimento',
  D13: 'Agradecimento, fechamento',
  D14: 'Assunto fora do caso',
  D15: 'Mensagem da equipe',
  E16: 'Reclamação',
  E17: 'Dinheiro ou prazo',
  E18: 'Quer falar com alguém',
  E19: 'Assunto jurídico novo',
  E20: 'Fala em desistir',
  E21: 'Pede dinheiro adiantado',
  E22: 'Indica cliente novo',
  COBRANCA: 'Cobrança',
};

/** A letra do código é a família. Serve para cor, ordem e para o gráfico. */
const FAMILIA_DE = (codigo: string): string => {
  if (codigo === 'COBRANCA') return 'cobrança';
  if (codigo.startsWith('A')) return 'perguntou algo';
  if (codigo.startsWith('B')) return 'desabafo';
  if (codigo.startsWith('C')) return 'entregou algo';
  if (codigo.startsWith('D')) return 'não pede resposta';
  if (codigo.startsWith('E')) return 'precisa de gente';
  return 'sem classificação';
};

/**
 * Cores por família. "Precisa de gente" é o vermelho porque é a única em que
 * demorar custa cliente; "não pede resposta" é o cinza porque é ruído saudável
 * (bom-dia, obrigado) e não deve competir por atenção no gráfico.
 */
const COR: Record<string, string> = {
  'precisa de gente': '#dc2626',
  'cobrança': '#ea580c',
  'perguntou algo': '#2563eb',
  'entregou algo': '#0d9488',
  'desabafo': '#7c3aed',
  'não pede resposta': '#94a3b8',
  'sem classificação': '#cbd5e1',
};

/** Ordem fixa no gráfico: o que exige gente em cima, o ruído embaixo. */
const ORDEM_FAMILIAS = [
  'precisa de gente', 'cobrança', 'perguntou algo',
  'entregou algo', 'desabafo', 'não pede resposta', 'sem classificação',
];

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

  /** As de gente primeiro, e dentro delas o volume. É a leitura de quem age. */
  const linhasOrdenadas = useMemo(() => {
    return [...resumo].sort((a, b) => {
      const ga = FAMILIA_DE(a.intencao) === 'precisa de gente' ? 0 : 1;
      const gb = FAMILIA_DE(b.intencao) === 'precisa de gente' ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return Number(b.total) - Number(a.total);
    });
  }, [resumo]);

  const maiorTotal = useMemo(
    () => Math.max(1, ...resumo.map(l => Number(l.total))),
    [resumo],
  );

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
          {/* Quatro números que resumem o período. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { rotulo: 'mensagens lidas', valor: totais.total, cor: '' },
              { rotulo: 'precisou de gente', valor: totais.precisouGente, cor: 'text-destructive' },
              { rotulo: 'o Dom respondeu', valor: totais.respondeu, cor: 'text-emerald-600 dark:text-emerald-400' },
              { rotulo: 'não pediam resposta', valor: totais.calou, cor: 'text-muted-foreground' },
            ].map(c => (
              <div key={c.rotulo} className="rounded-md border bg-muted/30 p-2">
                <p className={cn('text-lg font-semibold leading-none', c.cor)}>{c.valor}</p>
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

          {/* O relatório: uma linha por intenção, com o desfecho. */}
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-medium">Pedido do cliente</th>
                  <th className="px-2 py-1.5 font-medium text-right">Vezes</th>
                  <th className="px-2 py-1.5 font-medium text-right">Grupos</th>
                  <th className="px-2 py-1.5 font-medium text-right">Precisou de gente</th>
                  <th className="px-2 py-1.5 font-medium text-right">Dom respondeu</th>
                  <th className="px-2 py-1.5 font-medium text-right">Calou</th>
                </tr>
              </thead>
              <tbody>
                {linhasOrdenadas.map(l => {
                  const familia = FAMILIA_DE(l.intencao);
                  const deGente = familia === 'precisa de gente';
                  return (
                    <tr key={l.intencao} className="border-t">
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-[180px]">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: COR[familia] }}
                            aria-hidden
                          />
                          <span className={cn('truncate', deGente && 'font-medium')}>
                            {ROTULOS[l.intencao] || l.intencao}
                          </span>
                          <span className="text-[9px] text-muted-foreground shrink-0">{l.intencao}</span>
                        </div>
                        {/* Barra proporcional: o olho compara volume sem ler número. */}
                        <div className="mt-1 h-1 w-full rounded bg-muted overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${(Number(l.total) / maiorTotal) * 100}%`,
                              backgroundColor: COR[familia],
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{l.total}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{l.grupos}</td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums', Number(l.precisou_gente) > 0 && 'text-destructive font-medium')}>
                        {Number(l.precisou_gente) || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {Number(l.respondeu) || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {Number(l.calou) || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Conta toda decisão do atendente virtual, inclusive quando ele escolheu
            calar. Dia no fuso de Teresina. "Precisou de gente" é o que virou
            pendência para a equipe responder.
          </p>
        </>
      )}
    </div>
  );
}
