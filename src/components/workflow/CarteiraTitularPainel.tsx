// =============================================================================
// A carteira aberta por DONO do dinheiro — o topo do sheet da carteira.
//
// Pedido do Raym (26/08/2026): "dizer o que é do cliente, o que é honorários e
// o estágio de cada uma separada e somados... modo de visualização tipo só
// honorários, só parte líquida do cliente, honorários e parte do cliente
// juntos... se inspire no design do Banco Inter, do app deles e do site."
//
// ── O QUE VEIO DO INTER
//
//    Um número grande por vez. O app do Inter não empilha seis totais na mesma
//    dobra: mostra o saldo, e o resto é escolha de quem olha. Aqui o seletor
//    troca o número — não acrescenta mais um ao lado.
//
//    Linha limpa com o valor à direita, alinhado em tabular-nums, e uma barra
//    fina de proporção em vez de gráfico. Cor só onde muda decisão.
//
//    Tudo que é lista é clicável e leva a algum lugar: cada estágio abre a
//    relação daquele estágio, no modo que está selecionado.
//
// ── O QUE NÃO VEIO
//
//    O Inter mostra saldo, que é um fato fechado. Isto aqui é carteira em
//    formação, com 84% do valor ainda sem dono atribuído no banco. Esconder
//    isso atrás de um número bonito seria o band-aid de sempre — por isso a
//    faixa de cobertura fica na dobra, não num tooltip, e leva à conferência.
//    Ver a skill `conserto-estrutural-nao-pontual`.
// =============================================================================
import { AlertTriangle, ChevronRight, Copy } from 'lucide-react';
import {
  MODOS, MODO_LABEL, MODO_DESCRICAO, composicao, fatiaDoModo,
  type CarteiraPorTitular, type ModoCarteira,
} from '@/lib/carteiraPorTitular';
import { ESTAGIO_ORDEM } from '@/hooks/useCarteiraDoPop';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor grande: sem centavos, que a essa altura são ruído. */
const brlCurto = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

interface Props {
  porTitular: CarteiraPorTitular;
  modo: ModoCarteira;
  onModo: (m: ModoCarteira) => void;
  /** Carteira inteira com juros e correção — só existe no modo JUNTOS. */
  valorAtualizado: number;
  corrigidoAte: string | null;
  referenciasPorIndice: Record<string, string>;
  processos: number;
  pago: number;
  partesSemCorrecao: number;
  cnjsComFichaRepetida: number;
  /** Abre a relação clicável. `estagio` nulo = a fatia inteira do modo. */
  onAbrirRelacao: (estagio: string | null) => void;
  /** Manda os processos com cota zerada para a fila de conferência. */
  onAbrirConferencia?: () => void;
  mesAno: (iso: string) => string;
  indiceCurto: Record<string, string>;
}

/** Seletor em pílula, como o do extrato do Inter. Três botões, um ativo. */
function SeletorModo({ modo, onModo }: { modo: ModoCarteira; onModo: (m: ModoCarteira) => void }) {
  return (
    <div role="tablist" aria-label="Modo de visualização da carteira"
         className="inline-flex w-full rounded-full bg-muted p-0.5">
      {MODOS.map(m => (
        <button
          key={m}
          role="tab"
          aria-selected={modo === m}
          type="button"
          onClick={() => onModo(m)}
          className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            modo === m
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {MODO_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/** Barra de proporção: cliente | escritório | sem dono. Fina, sem legenda
 *  flutuante — a legenda é a linha de texto logo abaixo. */
function BarraComposicao({ c }: { c: CarteiraPorTitular }) {
  const p = composicao(c);
  if (c.cobertura.comSeparacao <= 0) return null;
  const semDono = Math.max(0, p.semDono);
  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-foreground/80" style={{ width: `${p.cliente}%` }} />
        <div className="bg-emerald-500" style={{ width: `${p.escritorio}%` }} />
        <div className="bg-amber-500/60" style={{ width: `${semDono}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/80" />
          cliente {pct(p.cliente)}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          honorários {pct(p.escritorio)}
        </span>
        {semDono > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500/60" />
            sem dono {pct(semDono)}
          </span>
        )}
      </div>
    </div>
  );
}

export function CarteiraTitularPainel({
  porTitular, modo, onModo, valorAtualizado, corrigidoAte, referenciasPorIndice,
  processos, pago, partesSemCorrecao, cnjsComFichaRepetida,
  onAbrirRelacao, onAbrirConferencia, mesAno, indiceCurto,
}: Props) {
  const f = fatiaDoModo(porTitular, modo);
  const cob = porTitular.cobertura;
  const maior = f.porEstagio.reduce((m, e) => Math.max(m, e.valor), 0);
  // A régua manda na ordem, não o tamanho: PROJETADO → ... → PAGO conta a
  // história do dinheiro. Ordenar por valor embaralharia a leitura.
  const estagios = ESTAGIO_ORDEM
    .map(chave => f.porEstagio.find(e => e.estagio === chave))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .concat(f.porEstagio.filter(e => !ESTAGIO_ORDEM.includes(e.estagio)));

  return (
    <div className="rounded-xl border bg-card">
      <div className="space-y-3 p-4">
        <SeletorModo modo={modo} onModo={onModo} />

        {/* O número grande. Um por vez. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {modo === 'JUNTOS' ? 'Carteira' : modo === 'CLIENTE' ? 'Cota dos clientes' : 'Honorários'}
          </div>
          <div className="text-3xl font-semibold leading-tight tabular-nums">{brlCurto(f.total)}</div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            {MODO_DESCRICAO[modo]}
          </div>
        </div>

        {/* Correção só onde ela existe de verdade. */}
        {modo === 'JUNTOS' ? (
          <div className="space-y-0.5">
            {valorAtualizado > f.total + 0.01 && (
              <div className="text-xs">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {brl(valorAtualizado)}
                </span>
                <span className="text-muted-foreground">
                  {' '}com juros e correção{corrigidoAte ? ` (até ${mesAno(corrigidoAte)})` : ''}
                </span>
              </div>
            )}
            {Object.keys(referenciasPorIndice).length > 1 && (
              <div className="text-[11px] text-muted-foreground">
                {Object.entries(referenciasPorIndice)
                  .map(([i, r]) => `${indiceCurto[i] || i} até ${mesAno(r)}`)
                  .join(' · ')}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {processos} processos · {f.partes} partes com valor · pago {brl(pago)}
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <div className="text-xs text-muted-foreground">
              {f.partes} parte{f.partes === 1 ? '' : 's'} com valor neste titular
            </div>
            <div className="text-[11px] leading-snug text-muted-foreground">
              Sem juros e correção: o coeficiente é calculado sobre a condenação da parte e
              ninguém repartiu ele entre cota e honorário ainda. O corrigido está no modo
              <span className="font-medium text-foreground"> Tudo</span>.
            </div>
          </div>
        )}

        <BarraComposicao c={porTitular} />
      </div>

      {/* Estágios: uma linha cada, clicável, valor à direita. */}
      {estagios.length > 0 && (
        <div className="border-t">
          <div className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            Por estágio financeiro
          </div>
          <div>
            {estagios.map(e => (
              <button
                key={e.estagio}
                type="button"
                onClick={() => onAbrirRelacao(e.estagio)}
                className="group flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50"
                title={`Ver a relação de ${ESTAGIO_LABEL[e.estagio] || e.estagio}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{ESTAGIO_LABEL[e.estagio] || e.estagio}</span>
                  {/* A barrinha é a proporção dentro da fatia, não do total —
                      no modo honorários "PAGO" tem que se medir com os outros
                      honorários, não com a carteira inteira. */}
                  <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-foreground/30"
                      style={{ width: maior > 0 ? `${(e.valor / maior) * 100}%` : '0%' }}
                    />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium tabular-nums">{brl(e.valor)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {e.partes} parte{e.partes === 1 ? '' : 's'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onAbrirRelacao(null)}
            className="flex w-full items-center justify-center gap-1 border-t px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            Ver a relação completa
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Cobertura: quanto da carteira sabe dizer de quem é o dinheiro. Fica na
          dobra de propósito — é o que decide se o número acima serve. */}
      <div className="space-y-2 border-t p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          De quem é este dinheiro
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">separação conhecida</span>
          <span className="text-right font-medium tabular-nums">
            {brl(cob.comSeparacao)}
            <span className="ml-1 font-normal text-muted-foreground">
              ({cob.partesComSeparacao} partes)
            </span>
          </span>
          <span className="text-muted-foreground">a decisão não separa</span>
          <span className="text-right font-medium tabular-nums">
            {brl(cob.semSeparacao)}
            <span className="ml-1 font-normal text-muted-foreground">
              ({cob.partesSemSeparacao} partes)
            </span>
          </span>
          {cob.semDono !== 0 && (
            <>
              <span className="text-amber-700 dark:text-amber-400">sem dono atribuído</span>
              <span className="text-right font-medium tabular-nums text-amber-700 dark:text-amber-400">
                {brl(cob.semDono)}
              </span>
            </>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          A carteira soma a condenação de cada parte, sempre. Quando a fonte do valor é a
          decisão, ela fixa quanto o processo vale sem dizer quanto é de quem — esse pedaço
          entra em <span className="font-medium text-foreground">Tudo</span> e fica fora dos
          outros dois modos. Por isso cota + honorários é menor que a carteira, e a diferença
          está escrita acima em vez de sumir da conta.
        </p>

        {cob.partesCotaZerada > 0 && (
          <button
            type="button"
            onClick={onAbrirConferencia}
            disabled={!onAbrirConferencia}
            className="flex w-full items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-left transition-colors enabled:hover:bg-amber-500/10"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1 text-[11px] leading-snug">
              <span className="block font-medium text-amber-700 dark:text-amber-400">
                {cob.partesCotaZerada} parte{cob.partesCotaZerada === 1 ? '' : 's'} com a cota
                zerada e honorário lançado — {brl(cob.valorCotaZerada)} de condenação.
              </span>
              <span className="block text-muted-foreground">
                Cota zero com honorário do lado não existe: o contratual sai de dentro da cota.
                A importação da Tab. Aux. gravou zero em vez do valor. O número continua somando
                aqui; quem conserta é a conferência, anexando a peça que traz o valor por parte.
              </span>
            </span>
            {onAbrirConferencia && (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </button>
        )}

        {partesSemCorrecao > 0 && (
          <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            {partesSemCorrecao} parte(s) sem índice para o ramo — entram no atualizado pelo valor
            nominal, então o corrigido está subestimado.
          </p>
        )}
        {cnjsComFichaRepetida > 0 && (
          <p className="flex items-start gap-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <Copy className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {cnjsComFichaRepetida} CNJ(s) com ficha repetida. O total acima já conta cada um
              uma vez só — mas vale limpar o cadastro duplicado.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
