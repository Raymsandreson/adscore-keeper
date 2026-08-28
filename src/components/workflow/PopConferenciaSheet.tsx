// =============================================================================
// Conferência dos acordos do POP — "o que foi lançado bate com o acordo?".
//
// Abre por cima da lista de POPs (Sheet lateral; fechar devolve onde estava).
//
// A régua: o contratual é SEMPRE 30% do bruto, então HC esperado = cota × 3/7.
// O SUCUMBENCIAL NÃO ENTRA na régua — varia de 5% a 15% conforme o juiz, pode
// ser majorado no cumprimento de sentença e pode ser dispensado. Ele aparece
// como observação, nunca como acusação.
//
// ── O SUCUMBENCIAL IMPOSSÍVEL
//
//    `hs > cota da própria parte` não pode existir: o sucumbencial sai de dentro
//    da cota. Esses processos ENTRAM na fila de conferência com o motivo escrito
//    e o caminho da peça que conserta — e o valor continua somando na carteira
//    exatamente como está no banco. Tela não desconta dado; tela mostra o dado e
//    aponta o conserto. Ver a skill `conserto-estrutural-nao-pontual`.
// =============================================================================
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, RefreshCw, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useConferenciaAcordos, ESTAGIO_LABEL } from '@/hooks/useConferenciaAcordos';
import type { AcordoConferido } from '@/hooks/useConferenciaAcordos';
import { totalizarConferencia } from '@/lib/conferenciaAcordo';
import { formatCnj } from '@/lib/cnj';
import { ProcessoConferenciaSheet } from './ProcessoConferenciaSheet';
import type { AlvoConferencia } from '@/hooks/useConferenciaProcesso';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { toast } from 'sonner';
import { lazy, Suspense, useMemo, useState } from 'react';

const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const dataBR = (d: string | null) => {
  const m = (d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

/** Busca sem acento e sem caixa — "jose" acha "José". */
const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function Card({ titulo, valor, detalhe, tom, className = '' }: {
  titulo: string; valor: string; detalhe?: string;
  tom: 'ok' | 'falta' | 'sobra' | 'neutro' | 'multa'; className?: string;
}) {
  const cores = {
    ok: 'border-emerald-500/30 bg-emerald-500/5',
    falta: 'border-destructive/30 bg-destructive/5',
    sobra: 'border-amber-500/30 bg-amber-500/5',
    multa: 'border-sky-500/30 bg-sky-500/5',
    neutro: 'border-border bg-muted/30',
  }[tom];
  return (
    <div className={`rounded-2xl border p-3.5 ${cores} ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</div>
      <div className="mt-1 text-lg font-bold leading-tight tracking-tight">{valor}</div>
      {detalhe && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

/**
 * Progresso da conferência: quanto da fila já confere exato. Sem cota e
 * divergente aparecem na barra como trabalho que falta — nada é descontado,
 * é só a mesma fila lida como caminho andado.
 */
function ProgressoConferencia({ conferem, divergem, semCota }: {
  conferem: number; divergem: number; semCota: number;
}) {
  const total = conferem + divergem + semCota;
  if (total === 0) return null;
  const pct = Math.round((conferem / total) * 100);
  const larg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Progresso da conferência
          </div>
          <div className="mt-0.5 text-2xl font-bold tracking-tight text-orange-500">{pct}%</div>
        </div>
        <div className="text-right text-[11px] leading-snug text-muted-foreground">
          {conferem} de {total} conferem exatos
        </div>
      </div>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {conferem > 0 && <div className="bg-emerald-500" style={{ width: larg(conferem) }} />}
        {divergem > 0 && <div className="bg-orange-500" style={{ width: larg(divergem) }} />}
        {semCota > 0 && <div className="bg-muted-foreground/25" style={{ width: larg(semCota) }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> conferem ({conferem})
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> divergem ({divergem})
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" /> sem cota ({semCota})
        </span>
      </div>
    </div>
  );
}

/**
 * Grupo recolhível. O que pede ação fica aberto; o resto se abre por escolha.
 * Com busca ativa, tudo abre — recolhido esconderia o resultado encontrado.
 */
function Secao({ titulo, itens, render, aberta, setAberta, buscando = false }: {
  titulo: string; itens: AcordoConferido[];
  render: (a: AcordoConferido) => React.ReactNode;
  aberta: boolean; setAberta: (v: boolean) => void; buscando?: boolean;
}) {
  if (itens.length === 0) return null;
  const fixa = titulo.startsWith('Divergem');
  const aberto = fixa || aberta || buscando;
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => { if (!fixa) setAberta(!aberta); }}
        className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {!fixa && (aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
        {titulo}
        <Badge className="rounded-full border-transparent bg-orange-500/10 px-1.5 py-0 text-[10px] font-semibold text-orange-600 hover:bg-orange-500/10 dark:text-orange-400">
          {itens.length}
        </Badge>
      </button>
      {aberto && <div className="space-y-2">{itens.map(render)}</div>}
    </section>
  );
}

interface Props {
  board: { id: string; name: string } | null;
  onOpenChange: (aberto: boolean) => void;
}

export function PopConferenciaSheet({ board, onOpenChange }: Props) {
  const { acordos, loading, erro, recarregar } = useConferenciaAcordos(board?.id ?? null);
  // Conferência e ficha são IRMÃS deste sheet, não filhas: empilhar por cima é o
  // padrão da casa, e o fechar devolve exatamente para a conferência.
  const [conferindo, setConferindo] = useState<AlvoConferencia | null>(null);
  const [ficha, setFicha] = useState<Record<string, unknown> | null>(null);

  const abrirFicha = async (processId: string) => {
    try {
      await ensureExternalSession();
      const { data, error } = await db.from('lead_processes').select('*').eq('id', processId).maybeSingle();
      if (error) throw error;
      if (!data) { toast.error('Processo não encontrado'); return; }
      setFicha(data as Record<string, unknown>);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir o processo');
    }
  };
  const t = totalizarConferencia(acordos.map(a => a.conferencia));

  // Três trabalhos diferentes, três seções. Misturados, os "sem cota" — que são
  // maioria e mostram R$ 0,00 de diferença — empurram para baixo justamente os
  // que pedem ação.
  //
  // O sucumbencial maior que a cota da parte entra aqui junto com a divergência
  // de contratual: é um dado impossível, e o lugar dele é a fila de conserto —
  // não um filtro que sumiria com o valor da carteira.
  const precisaConferir = (a: AcordoConferido) =>
    a.conferencia.situacao === 'HC_FALTANDO' || a.conferencia.situacao === 'HC_SOBRANDO'
    || a.hsSuspeito > 0;
  const peso = (a: AcordoConferido) => Math.max(Math.abs(a.conferencia.faltaHc), a.hsSuspeito);
  const divergentes = [...acordos.filter(precisaConferir)].sort((a, b) => peso(b) - peso(a));
  const semCota = acordos.filter(a => a.conferencia.situacao === 'SEM_CLIENTE' && !precisaConferir(a));
  const conferem = acordos.filter(a => a.conferencia.situacao === 'OK' && !precisaConferir(a));
  const hsSuspeitoTotal = acordos.reduce((soma, a) => soma + a.hsSuspeito, 0);
  const processosSuspeitos = acordos.filter(a => a.hsSuspeito > 0).length;
  const [abrirSemCota, setAbrirSemCota] = useState(false);
  const [abrirConferem, setAbrirConferem] = useState(false);

  // Busca por caso (título), processo (CNJ com ou sem máscara) e parte (nome).
  // Filtra só o que a lista MOSTRA — os totais e o progresso seguem somando a
  // fila inteira, porque busca é navegação, não régua.
  const [busca, setBusca] = useState('');
  const casaBusca = useMemo(() => {
    const texto = semAcento(busca.trim());
    const digitos = busca.replace(/\D/g, '');
    if (!texto) return null;
    return (a: AcordoConferido) =>
      semAcento(a.titulo ?? '').includes(texto)
      || a.partes.some(p => semAcento(p).includes(texto))
      || (digitos.length >= 3 && a.cnj.replace(/\D/g, '').includes(digitos));
  }, [busca]);
  const buscando = casaBusca != null;
  const vDivergentes = buscando ? divergentes.filter(casaBusca) : divergentes;
  const vSemCota = buscando ? semCota.filter(casaBusca) : semCota;
  const vConferem = buscando ? conferem.filter(casaBusca) : conferem;
  const encontrados = vDivergentes.length + vSemCota.length + vConferem.length;

  const linha = (a: AcordoConferido) => {
    const c = a.conferencia;
    const Icone = c.situacao === 'OK' ? CheckCircle2
      : c.situacao === 'SEM_CLIENTE' ? HelpCircle
      : c.faltaHc > 0 ? TrendingDown : TrendingUp;
    const cor = c.situacao === 'OK' ? 'text-emerald-600 dark:text-emerald-400'
      : c.situacao === 'SEM_CLIENTE' ? 'text-muted-foreground'
      : c.faltaHc > 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400';
    return (
      <button
        key={a.processId}
        type="button"
        onClick={() => board && setConferindo({
          processId: a.processId, boardId: board.id, cnj: a.cnj,
          titulo: a.titulo, foco: 'valores',
        })}
        className="w-full rounded-2xl border p-3 text-left transition-colors hover:border-orange-500/40 hover:bg-orange-500/[0.04]"
        title="Abrir a conferência: ver a trilha, anexar ou trocar a peça, e corrigir o valor"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{a.titulo || 'Processo sem título'}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {formatCnj(a.cnj)} · {dataBR(a.dataAcordo)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="text-[9px]">{ESTAGIO_LABEL[a.estagio]}</Badge>
            <span className={`flex items-center gap-1.5 text-sm font-semibold ${cor}`}>
              <Icone className="h-4 w-4" />
              {c.situacao === 'OK' ? 'confere'
                : c.situacao === 'SEM_CLIENTE' ? 'sem cota'
                : brl(Math.abs(c.faltaHc))}
            </span>
          </span>
        </div>

        {c.situacao !== 'SEM_CLIENTE' && (
          <div className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px]">
            <span className="text-muted-foreground">cota do cliente</span>
            <span className="text-muted-foreground">honorário lançado</span>
            <span className="text-muted-foreground">honorário devido (30%)</span>
            <span className="font-medium">{brl(c.cliente)}</span>
            <span className="font-medium">{brl(c.hc)}</span>
            <span className="font-medium">{brl(c.hcEsperado)}</span>
          </div>
        )}

        {/* Sucumbencial: comentário, nunca acusação — varia de 5% a 15%. */}
        {c.hs > 0 && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Sucumbencial lançado: {brl(c.hs)}
            {c.hsPctDoBruto != null && <> ({(c.hsPctDoBruto * 100).toFixed(1)}% do bruto)</>}
            {c.hsForaDaFaixa && (
              <Badge variant="outline" className="ml-1.5 border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                fora do usual de 5% a 15%
              </Badge>
            )}
          </div>
        )}

        {a.hsSuspeito > 0 && (
          <div className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-snug">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              Sucumbencial maior que a cota em {a.partesSuspeitas}{' '}
              {a.partesSuspeitas === 1 ? 'parte' : 'partes'} — {brl(a.hsSuspeito)}.
            </span>{' '}
            Isso não pode acontecer: o sucumbencial sai de dentro da cota da parte, então algum
            lançamento está no titular errado ou no valor errado. O número{' '}
            <strong>continua somando na carteira</strong> como está no banco. Para consertar de
            verdade, anexe aqui a peça que traz o valor por parte — planilha de liquidação
            homologada, termo de acordo ou cálculo da execução — e a leitura grava os valores
            certos por cima destes.
          </div>
        )}

        {c.multa > 0 && (
          <div className="mt-1 text-[11px] text-sky-700 dark:text-sky-400">
            Multa por descumprimento: {brl(c.multa)} — devida, mas fora da conta do acordo.
          </div>
        )}

        {c.situacao === 'SEM_CLIENTE' && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3" />
            Nenhuma indenização lançada — sem cota não há régua de 30%. Anexe a peça de valor
            para a leitura preencher.
          </div>
        )}
      </button>
    );
  };

  return (
    <>
    <Sheet open={!!board} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-lg font-bold tracking-tight">Conferência de valores</SheetTitle>
          <p className="text-xs text-muted-foreground">{board?.name}</p>
        </SheetHeader>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : erro ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : acordos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum processo com valor a conferir neste POP.</p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por caso, processo ou parte…"
                className="h-11 w-full rounded-full border border-border bg-muted/40 pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-orange-500 focus:bg-background focus:ring-2 focus:ring-orange-500/20 [&::-webkit-search-cancel-button]:hidden"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca('')}
                  aria-label="Limpar busca"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <ProgressoConferencia
              conferem={conferem.length}
              divergem={divergentes.length}
              semCota={semCota.length}
            />

            <div className="grid grid-cols-2 gap-2">
              <Card titulo="Processos na fila" valor={String(t.acordos)}
                detalhe={`${t.ok} conferem exatos${t.semCliente ? ` · ${t.semCliente} sem cota` : ''}`} tom="neutro" />
              <Card titulo="Honorário faltando" valor={brl(t.hcFaltando)}
                detalhe="lançado a menos que os 30% do contrato" tom="falta" />
              <Card titulo="Honorário sobrando" valor={brl(t.hcSobrando)}
                detalhe="lançado a mais que os 30%" tom="sobra" />
              <Card titulo="Multa por descumprimento" valor={brl(t.multa)}
                detalhe="devida, mas fora da conta do acordo" tom="multa" />
              {hsSuspeitoTotal > 0 && (
                <Card
                  className="col-span-2"
                  titulo="Sucumbencial maior que a cota da parte"
                  valor={brl(hsSuspeitoTotal)}
                  detalhe={`${processosSuspeitos} ${processosSuspeitos === 1 ? 'processo' : 'processos'} — impossível, mas somando na carteira do jeito que está no banco. Abra cada um e anexe a peça de valor por parte.`}
                  tom="sobra"
                />
              )}
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              Entram processos com <strong>acordo homologado</strong>, <strong>liquidação</strong>,{' '}
              <strong>trânsito em julgado</strong> ou <strong>execução iniciada</strong> — nesses o
              valor por parte já existe nos autos, quase sempre em peça restrita que o Escavador não
              traz. A régua é o contratual de <strong>30%</strong>: sobre o bruto, o cliente fica com 70% e o
              escritório com 30%, então o honorário devido é a cota do cliente × 3/7. O{' '}
              <strong>sucumbencial não entra na régua</strong> — ele varia de 5% a 15% conforme o juiz
              arbitrou, pode ser majorado no cumprimento de sentença e pode ser dispensado. O que
              o sucumbencial <strong>não pode</strong> é passar da cota da própria parte — quando
              passa, o processo entra na fila com o motivo escrito e o valor segue somando na
              carteira até a peça certa corrigir o banco.
            </p>

            {buscando && (
              <p className="text-[11px] text-muted-foreground">
                {encontrados === 0 ? <>Nenhum processo encontrado para “{busca.trim()}”.</>
                  : <>{encontrados} de {acordos.length} {encontrados === 1 ? 'processo' : 'processos'} para “{busca.trim()}”.</>}
              </p>
            )}

            <Secao titulo="Divergem — anexar a peça certa" itens={vDivergentes} render={linha}
                   aberta setAberta={() => {}} buscando={buscando} />
            <Secao titulo="Sem cota lançada — não dá para conferir" itens={vSemCota} render={linha}
                   aberta={abrirSemCota} setAberta={setAbrirSemCota} buscando={buscando} />
            <Secao titulo="Conferem" itens={vConferem} render={linha}
                   aberta={abrirConferem} setAberta={setAbrirConferem} buscando={buscando} />

            <div className="flex justify-end pb-2">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void recarregar()}>
                <RefreshCw className="h-3 w-3" /> Recarregar
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>

    <ProcessoConferenciaSheet
      alvo={conferindo}
      onClose={() => setConferindo(null)}
      onAbrirFicha={id => void abrirFicha(id)}
    />

    <Suspense fallback={null}>
      {ficha && (
        <ProcessDetailSheet
          open={!!ficha}
          onOpenChange={aberto => { if (!aberto) setFicha(null); }}
          process={ficha}
          mode="sheet"
        />
      )}
    </Suspense>
    </>
  );
}
