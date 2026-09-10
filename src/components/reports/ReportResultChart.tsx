/**
 * ReportResultChart — o gráfico do resultado de uma consulta dos Relatórios.
 *
 * Quem decide se existe gráfico é a IA: o run_sql aceita um campo `chart`
 * ({type, x, y, label}) e o backend só deixa passar depois de conferir que as
 * colunas existem no resultado e que o eixo do valor é numérico de verdade
 * (report-query.ts → validarChart). Aqui a gente só desenha o que chegou.
 *
 * O gráfico NUNCA substitui a tabela — ele é uma leitura em cima dela. A tabela
 * continua a um clique, com todas as linhas que vieram do banco, porque nenhuma
 * linha pode sumir da tela por parecer estranha (CLAUDE.md, "solução estrutural,
 * nunca band-aid na tela"). Nada aqui filtra, capa ou zera valor: o que o banco
 * devolveu é o que é desenhado, inclusive o valor absurdo que precisa aparecer
 * pra ser consertado na origem.
 */
import React, { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  x: string;
  y: string;
  label?: string;
}

/**
 * Paleta categórica. Validada pelos seis checks (banda de lightness, piso de
 * croma, separação para daltonismo, piso de visão normal, contraste com a
 * superfície) — não mexa nos valores sem revalidar, e mantenha a ORDEM: a cor
 * segue a fatia, nunca a posição no ranking.
 *
 * O sistema hoje é light-only (ThemeContext força `light`). Se o modo escuro
 * voltar, a paleta dele NÃO é esta clareada — são estes steps, já validados
 * contra a superfície #1c1c1c:
 * #16A34A, #3B82F6, #EF4444, #8B5CF6, #D97706, #EC4899
 */
const PALETA = ['#00875A', '#2563EB', '#DC2626', '#7C3AED', '#B45309', '#DB2777'];

/** Série única (barra e linha) usa o verde da marca — sem legenda, o título nomeia. */
const COR_UNICA = PALETA[0];

const TINTA_SUAVE = 'hsl(0 0% 45%)';   // --muted-foreground
const GRADE = 'hsl(0 0% 90%)';

/**
 * Sem animação de entrada — e isto NÃO é preferência de estilo.
 *
 * Medido no navegador (09/09/2026) com recharts 2.15 puro, sem nada nosso no
 * meio: com a animação padrão, `Pie` desenha ZERO setores (a pizza aparece só
 * com a legenda, o desenho vazio do lado) e a `Line` não desenha ponto nenhum;
 * com `isAnimationActive={false}`, os 3 setores e os 3 pontos aparecem na hora.
 * A animação de entrada não termina nesta base, e o que sobra na tela é gráfico
 * vazio. `Bar` desenha dos dois jeitos, mas fica desligada junto: relatório não
 * precisa de animação e não vale manter um caminho que já falhou nos vizinhos.
 *
 * Só religar depois de conferir NO NAVEGADOR (jsdom não desenha, o teste passa
 * verde com a pizza vazia) que setor e ponto aparecem.
 */
const ANIMA = false;

const fmtNum = new Intl.NumberFormat('pt-BR');

function rotulo(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(sem valor)';
  const s = String(v);
  // Data ISO no eixo vira dd/mm; mês (2026-04) vira 04/2026.
  const dia = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dia) return `${dia[3]}/${dia[2]}`;
  const mes = s.match(/^(\d{4})-(\d{2})$/);
  if (mes) return `${mes[2]}/${mes[1]}`;
  return s;
}

function humano(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function corta(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  chart: ChartSpec;
  rows: Record<string, unknown>[];
  /** Quantas linhas o resultado tem no banco — se for além das que chegaram, o gráfico se anuncia parcial. */
  count?: number;
}

function Dica({ active, payload, nomeValor }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const nome = p?.payload?.nome ?? p?.name;
  return (
    <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium text-foreground">{nome}</div>
      <div className="text-muted-foreground">
        {nomeValor}: <span className="font-semibold text-foreground">{fmtNum.format(Number(p.value) || 0)}</span>
      </div>
    </div>
  );
}

export default function ReportResultChart({ chart, rows, count }: Props) {
  const nomeValor = humano(chart.y);

  const dados = useMemo(() => {
    const base = rows.map((r) => ({
      nome: rotulo(r[chart.x]),
      valor: Number(r[chart.y]) || 0,
    }));
    // Barra e pizza leem melhor do maior pro menor. Linha NÃO se ordena por
    // valor — ali a ordem é o tempo, e reordenar destruiria a leitura.
    if (chart.type === 'line') return base;
    return [...base].sort((a, b) => b.valor - a.valor);
  }, [rows, chart.x, chart.y, chart.type]);

  // Pizza só se sustenta em poucas fatias. Com mais que isso vira barra em vez
  // de agrupar em "Outros" — juntar categoria esconderia quem é quem.
  const tipo = chart.type === 'pie' && dados.length > 6 ? 'bar' : chart.type;

  if (!dados.length) return null;

  const parcial = typeof count === 'number' && count > rows.length;
  const titulo = chart.label || `${nomeValor} por ${humano(chart.x)}`;

  // Barra é horizontal: nome de pessoa, status e núcleo em português são longos
  // e no eixo de baixo virariam texto inclinado ilegível.
  const alturaBarra = Math.min(Math.max(dados.length * 30 + 40, 180), 520);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{titulo}</span>
        {parcial && (
          <span className="text-[11px] text-muted-foreground">
            desenhando {fmtNum.format(rows.length)} de {fmtNum.format(count!)} linhas
          </span>
        )}
      </div>

      {tipo === 'bar' && (
        <div style={{ height: alturaBarra }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
              <CartesianGrid horizontal={false} stroke={GRADE} />
              <XAxis
                type="number" tick={{ fontSize: 11, fill: TINTA_SUAVE }}
                axisLine={false} tickLine={false} tickFormatter={(v) => fmtNum.format(v)}
              />
              <YAxis
                type="category" dataKey="nome" width={150}
                tick={{ fontSize: 11, fill: TINTA_SUAVE }} axisLine={false} tickLine={false}
                tickFormatter={(v) => corta(String(v), 24)}
              />
              <Tooltip cursor={{ fill: 'hsl(0 0% 96%)' }} content={<Dica nomeValor={nomeValor} />} />
              <Bar dataKey="valor" fill={COR_UNICA} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={ANIMA} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {tipo === 'line' && (
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid vertical={false} stroke={GRADE} />
              <XAxis dataKey="nome" tick={{ fontSize: 11, fill: TINTA_SUAVE }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: TINTA_SUAVE }} axisLine={false} tickLine={false}
                width={48} tickFormatter={(v) => fmtNum.format(v)}
              />
              <Tooltip content={<Dica nomeValor={nomeValor} />} />
              <Line
                type="monotone" dataKey="valor" stroke={COR_UNICA} strokeWidth={2} isAnimationActive={ANIMA}
                dot={{ r: 4, fill: COR_UNICA, strokeWidth: 0 }} activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {tipo === 'pie' && (
        <div className="flex flex-wrap items-center gap-4">
          <div style={{ height: 220, width: 220 }} className="shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<Dica nomeValor={nomeValor} />} />
                <Pie
                  data={dados} dataKey="valor" nameKey="nome"
                  innerRadius={48} outerRadius={88} paddingAngle={2}
                  isAnimationActive={ANIMA}
                >
                  {dados.map((d, i) => (
                    <Cell key={d.nome} fill={PALETA[i % PALETA.length]} stroke="hsl(0 0% 100%)" strokeWidth={2} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legenda com o valor escrito: a identidade da fatia nunca depende só da cor. */}
          <ul className="space-y-1.5 text-xs min-w-0">
            {dados.map((d, i) => (
              <li key={d.nome} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: PALETA[i % PALETA.length] }}
                />
                <span className="text-muted-foreground truncate" title={d.nome}>{corta(d.nome, 32)}</span>
                <span className="font-semibold text-foreground tabular-nums">{fmtNum.format(d.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
