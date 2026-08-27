// =============================================================================
// A relação da carteira, linha a linha, para conferir.
//
// Pedido do Raym (26/08/2026): "uma tabela da relação para ser conferida ao
// clicar". Abre a partir de um estágio do painel por titular, ou da fatia
// inteira, sempre no modo que está selecionado lá.
//
// A unidade da linha é a PARTE (processo × cliente), não o processo: é ela que
// tem cota, honorário e estágio próprios. Um processo com quatro clientes vira
// quatro linhas, e a soma do rodapé bate com o card de onde a pessoa veio.
//
// Sheet IRMÃO do da carteira, nunca filho — dois Dialogs do Radix aninhados
// brigam por foco (mesma solução do ProcessoConferenciaSheet).
// =============================================================================
import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowDownUp, Search, X } from 'lucide-react';
import { MODO_LABEL, type ModoCarteira } from '@/lib/carteiraPorTitular';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { normalizarBusca, type GrupoMarco, type ProcessoDoMarco } from '@/hooks/useCarteiraDoPop';
import { formatCnj } from '@/lib/cnj';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface AlvoRelacao {
  modo: ModoCarteira;
  /** null = a fatia inteira do modo. */
  estagio: string | null;
  /**
   * Só as partes com a cota zerada e honorário lançado. É por aqui que o aviso
   * do painel vira ação: a relação lista os processos, e a linha abre a
   * conferência para anexar a peça que traz o valor por parte.
   */
  soCotaZerada?: boolean;
}

interface LinhaRelacao {
  processId: string;
  cnj: string;
  titulo: string | null;
  leadNome: string | null;
  cliente: string;
  estagio: string;
  /** O valor do modo escolhido. */
  valor: number;
  /** Condenação da parte — a referência de "quanto o processo vale". */
  condenacao: number;
  /** A fonte deste valor não separa titular. */
  semTitular: boolean;
  /** Cota zerada com honorário lançado — precisa da peça certa. */
  cotaZerada: boolean;
  busca: string;
}

/** Achata os grupos em linhas de PARTE, já no modo pedido. */
function montarLinhas(grupos: GrupoMarco[], modo: ModoCarteira): LinhaRelacao[] {
  const linhas: LinhaRelacao[] = [];
  for (const g of grupos) {
    for (const p of g.processos as ProcessoDoMarco[]) {
      for (const parte of p.partes) {
        const semTitular = parte.cota == null && parte.honorario == null;
        const valor = modo === 'CLIENTE' ? (parte.cota ?? 0)
          : modo === 'ESCRITORIO' ? (parte.honorario ?? 0)
          : parte.valor;
        linhas.push({
          processId: p.processId,
          cnj: p.cnj,
          titulo: p.titulo,
          leadNome: p.leadNome,
          cliente: parte.cliente,
          estagio: parte.estagio,
          valor,
          condenacao: parte.valor,
          semTitular,
          cotaZerada: parte.cota === 0 && (parte.honorario ?? 0) > 0,
          busca: normalizarBusca([
            parte.cliente, p.leadNome || '', p.cnj, p.cnj.replace(/\D/g, ''), p.titulo || '',
          ].join(' ')),
        });
      }
    }
  }
  return linhas;
}

interface Props {
  alvo: AlvoRelacao | null;
  grupos: GrupoMarco[];
  onClose: () => void;
  /** Clique na linha: abre a conferência daquele processo, focada nos valores. */
  onConferir: (p: { processId: string; cnj: string; titulo: string | null; leadNome: string | null }) => void;
}

type Ordem = 'valor' | 'cliente';

export function CarteiraRelacaoSheet({ alvo, grupos, onClose, onConferir }: Props) {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('valor');

  const modo = alvo?.modo ?? 'JUNTOS';
  const estagio = alvo?.estagio ?? null;
  const soCotaZerada = Boolean(alvo?.soCotaZerada);

  // 1.660 partes × cada tecla digitada: sem memo a tabela recalcula tudo a
  // cada render. Mesma razão do `busca` pré-normalizado no hook.
  const linhas = useMemo(() => {
    if (!alvo) return [];
    let l = montarLinhas(grupos, modo);
    if (estagio) l = l.filter(x => x.estagio === estagio);
    if (soCotaZerada) l = l.filter(x => x.cotaZerada);
    // Valor zero no modo escolhido não é linha da relação: no modo honorários,
    // as 563 partes que a decisão não separa entrariam todas como R$ 0,00 e
    // afogariam as que têm valor. Elas aparecem contadas no rodapé.
    l = l.filter(x => x.valor !== 0);
    const q = normalizarBusca(busca.trim());
    if (q) l = l.filter(x => x.busca.includes(q));
    return l.sort(ordem === 'valor'
      ? (a, b) => b.valor - a.valor
      : (a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'));
  }, [alvo, grupos, modo, estagio, soCotaZerada, busca, ordem]);

  const total = useMemo(() => linhas.reduce((s, l) => s + l.valor, 0), [linhas]);
  /** Quantas partes ficaram de fora por não terem valor neste modo. */
  const semValorNoModo = useMemo(() => {
    if (!alvo || modo === 'JUNTOS') return 0;
    let l = montarLinhas(grupos, modo);
    if (estagio) l = l.filter(x => x.estagio === estagio);
    if (soCotaZerada) l = l.filter(x => x.cotaZerada);
    return l.filter(x => x.valor === 0 && x.condenacao > 0).length;
  }, [alvo, grupos, modo, estagio, soCotaZerada]);

  const titulo = soCotaZerada
    ? 'Projeção sem cota'
    : estagio
      ? `${ESTAGIO_LABEL[estagio] || estagio} · ${MODO_LABEL[modo]}`
      : `Relação completa · ${MODO_LABEL[modo]}`;

  return (
    <Sheet open={!!alvo} onOpenChange={aberto => { if (!aberto) { setBusca(''); onClose(); } }}>
      <SheetContent side="left" className="flex w-full flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">{titulo}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {soCotaZerada
              ? 'Processos sem decisão (PROJETADO na Tab. Aux.): o honorário foi projetado e a cota ficou em zero. Sai daqui quando a decisão sair e for lida — não é peça que falta, é decisão.'
              : 'Uma linha por parte (processo × cliente). Clique para conferir de onde saiu o valor.'}
          </p>
        </SheetHeader>

        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar cliente, caso ou CNJ"
              className="h-9 pl-8 pr-8 text-sm"
            />
            {busca && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setBusca('')}
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOrdem(o => (o === 'valor' ? 'cliente' : 'valor'))}
            className="flex h-9 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Alternar a ordem"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            {ordem === 'valor' ? 'maior valor' : 'A–Z'}
          </button>
        </div>

        {/* A tabela rola sozinha; o rodapé com a soma fica preso embaixo, senão
            quem desce 300 linhas perde a referência do total. */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {linhas.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {busca ? 'Nenhuma parte com esse texto.' : 'Nenhuma parte com valor neste recorte.'}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2.5 py-1.5 font-medium">Cliente e processo</th>
                  <th className="px-2.5 py-1.5 font-medium">Estágio</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">
                    {modo === 'CLIENTE' ? 'Cota' : modo === 'ESCRITORIO' ? 'Honorário' : 'Condenação'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr
                    key={`${l.processId}-${l.cliente}-${i}`}
                    className="cursor-pointer border-t hover:bg-muted/50"
                    onClick={() => onConferir(l)}
                    title="Abrir a conferência deste processo"
                  >
                    <td className="min-w-0 px-2.5 py-1.5">
                      <span className="block truncate font-medium">{l.cliente}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        <span className="font-mono">{formatCnj(l.cnj)}</span>
                        {l.leadNome ? <span className="ml-1.5">{l.leadNome}</span> : null}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge variant="outline" className="text-[9px]">
                        {ESTAGIO_LABEL[l.estagio] || l.estagio}
                      </Badge>
                      {l.cotaZerada && (
                        <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                          projeção sem cota
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                      <span className="block font-medium tabular-nums">{brl(l.valor)}</span>
                      {modo !== 'JUNTOS' && (
                        <span className="block text-[10px] text-muted-foreground tabular-nums">
                          de {brl(l.condenacao)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="shrink-0 space-y-1 pb-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {linhas.length} parte{linhas.length === 1 ? '' : 's'}
            </span>
            <span className="font-semibold tabular-nums">{brl(total)}</span>
          </div>
          {semValorNoModo > 0 && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {semValorNoModo} parte(s) com condenação ficaram fora desta relação porque a fonte do
              valor não separa titular — elas aparecem no modo{' '}
              <span className="font-medium text-foreground">Tudo</span> e estão contadas na
              cobertura do painel.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
