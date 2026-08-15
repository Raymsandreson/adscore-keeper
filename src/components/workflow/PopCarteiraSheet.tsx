// =============================================================================
// Carteira do POP — aba lateral (Sheet) aberta de dentro do editor de POP.
//
// Mostra a régua de marcos com o dinheiro em cima: por marco, a relação dos
// processos e há quantos dias cada um está ali; por estágio financeiro, o valor
// da carteira; e no topo os agregados — média de tempo, índice de sucesso,
// custo de aquisição (CAC dos leads) e rentabilidade.
//
// Regras de UI da casa: Sheet por cima do editor (nada de redirecionar), fechar
// devolve exatamente onde estava. Regra de vocabulário: o valor exibido é o do
// PROCESSO (última decisão por cliente), não o caixa do escritório — o aviso
// fica visível na tela, não em tooltip.
//
// Clicar na linha abre a FICHA do processo (ProcessDetailSheet); o botão de
// escudo abre a CONFERÊNCIA — de onde saiu aquele valor e aquele marco. Os dois
// sheets são IRMÃOS deste, nunca filhos: dois Dialogs do Radix aninhados brigam
// por foco (mesma solução do TeamMarcoProcessosSheet).
// =============================================================================
import { Suspense, lazy, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, Copy, Handshake, Loader2, PauseCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { useCarteiraDoPop, ESTAGIO_ORDEM, type GrupoMarco, type ProcessoDoMarco } from '@/hooks/useCarteiraDoPop';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { ProcessoConferenciaSheet } from './ProcessoConferenciaSheet';
import type { AlvoConferencia } from '@/hooks/useConferenciaProcesso';

// A ficha do processo é pesada: entra sob demanda, como no TeamMarcoProcessosSheet.
const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));

interface Props {
  boardId: string | null;
  boardName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dias = (d: number | null) => (d == null ? '—' : d === 0 ? 'hoje' : `${d} d`);

/** "2026-07-01" -> "jul/2026". A data limite da correção vai sempre junto do número. */
const INDICE_CURTO: Record<string, string> = {
  SELIC_SIMPLES_JT: 'SELIC',
  TCM_ESTADUAL: 'TCM',
};

const mesAno = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m[2]) - 1]}/${m[1]}`;
};

function EstagioChips({ porEstagio, compact }: { porEstagio: Record<string, number>; compact?: boolean }) {
  const presentes = ESTAGIO_ORDEM.filter(e => (porEstagio[e] || 0) > 0);
  if (!presentes.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {presentes.map(e => (
        <span
          key={e}
          className={`rounded bg-muted px-1.5 py-0.5 ${compact ? 'text-[10px]' : 'text-xs'} text-muted-foreground`}
        >
          {ESTAGIO_LABEL[e] || e}: <span className="font-medium text-foreground">{brl(porEstagio[e])}</span>
        </span>
      ))}
    </div>
  );
}

interface AcoesProcesso {
  onAbrirFicha: (processId: string) => void;
  onConferir: (p: ProcessoDoMarco, foco?: 'valores') => void;
  abrindoId: string | null;
}

function GrupoDoMarco({ grupo, acoes }: { grupo: GrupoMarco; acoes: AcoesProcesso }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2.5 text-left hover:bg-muted/40"
        onClick={() => setAberto(v => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{grupo.rotulo}</span>
        <Badge variant="secondary" className="shrink-0">{grupo.processos.length}</Badge>
        {grupo.diasMedio != null && (
          <span className="shrink-0 text-xs text-muted-foreground">média {dias(grupo.diasMedio)}</span>
        )}
        {grupo.valor > 0 && (
          <span className="flex shrink-0 flex-col items-end leading-tight">
            <span className="text-xs font-semibold">{brl(grupo.valor)}</span>
            {grupo.valorAtualizado > grupo.valor + 0.01 && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                {brl(grupo.valorAtualizado)} corrigido
              </span>
            )}
          </span>
        )}
      </button>
      {aberto && (
        <div className="space-y-1 border-t p-2">
          <EstagioChips porEstagio={grupo.porEstagio} compact />
          {grupo.processos.map(p => (
            <div key={p.processId} className="flex items-center gap-1 rounded pr-1 text-xs hover:bg-muted/40">
              {/* Clique na linha = ficha do processo, em aba lateral por cima desta. */}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left"
                onClick={() => acoes.onAbrirFicha(p.processId)}
                title="Abrir a ficha do processo"
              >
                <span className="min-w-0 flex-1">
                  {/* De quem é o processo vem primeiro: o título é o que a equipe
                      digitou ("Processo", "PA M") e muitas vezes não identifica ninguém. */}
                  <span className="block truncate font-medium">
                    {p.leadNome || <span className="italic text-muted-foreground">sem lead vinculado</span>}
                    {p.leadsNomes.length > 1 && (
                      <span className="ml-1 font-normal text-amber-600 dark:text-amber-400">
                        +{p.leadsNomes.length - 1}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.cnj}</span>
                    {p.titulo ? <span className="ml-1.5">{p.titulo}</span> : null}
                  </span>
                </span>
                {p.temAcordo && <Handshake className="h-3 w-3 shrink-0 text-emerald-500" aria-label="acordo homologado" />}
                {p.suspenso && <PauseCircle className="h-3 w-3 shrink-0 text-amber-500" aria-label="suspenso" />}
                {p.cadastros > 1 && (
                  <Copy
                    className="h-3 w-3 shrink-0 text-amber-500"
                    aria-label={`CNJ com ${p.cadastros} cadastros`}
                  />
                )}
              </button>

              {/* O valor é a SOMA DAS PARTES: clicar abre a abertura por parte. */}
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 rounded px-1 py-1 text-right hover:bg-muted"
                onClick={() => acoes.onConferir(p, 'valores')}
                title={p.partes.length
                  ? `Ver o valor de cada parte (${p.partes.length})`
                  : 'Conferir o valor'}
              >
                {p.clientes > 1 && (
                  <span className="text-muted-foreground">{p.clientes} partes</span>
                )}
                {p.valor > 0 && (
                  <span className="flex flex-col items-end leading-tight">
                    <span className="font-medium">{brl(p.valor)}</span>
                    {p.valorAtualizado > p.valor + 0.01 && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        {brl(p.valorAtualizado)} corrigido
                      </span>
                    )}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="w-14 shrink-0 rounded px-1 py-1 text-right text-muted-foreground hover:bg-muted"
                onClick={() => acoes.onAbrirFicha(p.processId)}
                title="tempo neste marco"
              >
                {dias(p.diasNoMarco)}
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => acoes.onConferir(p)}
                title="Conferir de onde saiu o valor e o marco"
                aria-label={`Conferir ${p.cnj}`}
              >
                {acoes.abrindoId === p.processId
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ShieldCheck className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PopCarteiraSheet({ boardId, boardName, open, onOpenChange }: Props) {
  const { grupos, totais, loading, erro } = useCarteiraDoPop(open ? boardId : null);
  /** Linha inteira de lead_processes — o ProcessDetailSheet espera o registro. */
  const [fichaAberta, setFichaAberta] = useState<Record<string, unknown> | null>(null);
  const [abrindoId, setAbrindoId] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState<AlvoConferencia | null>(null);

  const abrirFicha = async (processId: string) => {
    setAbrindoId(processId);
    try {
      await ensureExternalSession();
      const { data, error } = await db
        .from('lead_processes')
        .select('*')
        .eq('id', processId)
        .maybeSingle();
      if (error) throw error;
      if (!data) { toast.error('Processo não encontrado'); return; }
      setFichaAberta(data as Record<string, unknown>);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir o processo');
    } finally {
      setAbrindoId(null);
    }
  };

  const conferir = (p: ProcessoDoMarco, foco?: 'valores') => {
    if (!boardId) return;
    setConferindo({
      processId: p.processId,
      boardId,
      cnj: p.cnj,
      titulo: p.titulo,
      leadNome: p.leadNome,
      valorNaCarteira: p.valor,
      foco,
    });
  };

  const acoes: AcoesProcesso = { onAbrirFicha: abrirFicha, onConferir: conferir, abrindoId };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-base">Carteira · {boardName || 'POP'}</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : totais.processos === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum processo com CNJ vinculado a este POP.
          </p>
        ) : (
          <>
            {/* Agregados da carteira */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Carteira</div>
                <div className="text-lg font-semibold">{brl(totais.valor)}</div>
                {totais.valorAtualizado > totais.valor + 0.01 && (
                  <div className="text-xs">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {brl(totais.valorAtualizado)}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}com juros e correção{totais.corrigidoAte ? ` (até ${mesAno(totais.corrigidoAte)})` : ''}
                    </span>
                  </div>
                )}
                {/* Índices com cadências diferentes: a SELIC vem do Bacen todo dia,
                    a TCM ainda é manual. Dizer só a mais nova enganaria. */}
                {Object.keys(totais.referenciasPorIndice).length > 1 && (
                  <div className="text-[11px] text-muted-foreground">
                    {Object.entries(totais.referenciasPorIndice)
                      .map(([i, r]) => `${INDICE_CURTO[i] || i} até ${mesAno(r)}`)
                      .join(' · ')}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {totais.processos} processos · {totais.partes} partes · pago {brl(totais.pago)}
                </div>
                {totais.partesSemCorrecao > 0 && (
                  <div className="mt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                    {totais.partesSemCorrecao} parte(s) sem índice para o ramo — entram no atualizado
                    pelo valor nominal, então o corrigido está subestimado.
                  </div>
                )}
                {totais.cnjsComFichaRepetida > 0 && (
                  <div className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                    <Copy className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      {totais.cnjsComFichaRepetida} CNJ(s) com ficha repetida. O total acima já conta
                      cada um uma vez só — mas vale limpar o cadastro duplicado.
                    </span>
                  </div>
                )}
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tempo médio</div>
                <div className="text-lg font-semibold">{dias(totais.mediaDiasNoMarco)}</div>
                <div className="text-xs text-muted-foreground">
                  no marco atual · idade média {totais.mediaIdadeDias != null ? `${Math.round(totais.mediaIdadeDias / 30)} meses` : '—'}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Índice de sucesso</div>
                <div className="text-lg font-semibold">
                  {totais.indiceSucesso != null ? `${totais.indiceSucesso}%` : '—'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {totais.avaliaveis > 0
                    ? `${totais.sucessos} de ${totais.avaliaveis} decididos avaliáveis`
                    : 'nenhum decidido com leitura de decisão ainda'}
                  {totais.semLeitura > 0 ? ` · ${totais.semLeitura} sem leitura de decisão` : ''}
                </div>
              </div>
              <div className="rounded-lg border p-2.5 sm:col-span-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Custo e rentabilidade</div>
                {totais.custo > 0 ? (
                  <div className="text-sm">
                    <span className="font-semibold">{brl(totais.custo)}</span>
                    <span className="text-muted-foreground"> de aquisição ({totais.leadsComCusto} de {totais.leadsTotal} leads com custo) · </span>
                    <span className="font-semibold">realizado − custo: {brl(totais.resultadoRealizado)}</span>
                    {totais.multiploPotencial != null && (
                      <span className="text-muted-foreground"> · carteira ÷ custo: {totais.multiploPotencial.toFixed(1)}x</span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Nenhum lead deste POP tem custo de aquisição (CAC) registrado — a rentabilidade
                    aparece aqui quando o custo do lead estiver preenchido.
                  </div>
                )}
              </div>
            </div>

            {/* Carteira toda por estágio financeiro */}
            <div className="rounded-lg border p-2.5">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Carteira por estágio financeiro
              </div>
              <EstagioChips porEstagio={totais.porEstagio} />
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              Valores = quanto o processo vale (última decisão de cada PARTE, somadas), não o caixa
              do escritório — cota do cliente e honorário ainda não são separados. Clique no valor
              de um processo para ver quanto é de cada parte. O valor CORRIGIDO (em verde) aplica
              juros e correção do termo inicial de cada decisão até a data da tabela de índices —
              SELIC simples nos trabalhistas (buscada no Bacen todo dia), TCM nos estaduais (ainda
              carregada à mão, por isso pode ficar para trás); a carteira continua somando o
              nominal. Índice de sucesso:
              entre os decididos com leitura de decisão (ou acordo), quantos saíram com valor
              fixado ou acordo homologado — decidido sem leitura é buraco de captura e fica fora
              da conta.
            </p>

            {/* Por marco */}
            <div className="space-y-1.5">
              {grupos.map(g => <GrupoDoMarco key={g.chave} grupo={g} acoes={acoes} />)}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>

    {/* Conferência e ficha: irmãs do sheet da carteira, não filhas. */}
    <ProcessoConferenciaSheet
      alvo={conferindo}
      onClose={() => setConferindo(null)}
      onAbrirFicha={id => void abrirFicha(id)}
    />

    <Suspense fallback={null}>
      {fichaAberta && (
        <ProcessDetailSheet
          open={!!fichaAberta}
          onOpenChange={aberto => { if (!aberto) setFichaAberta(null); }}
          process={fichaAberta}
          mode="sheet"
        />
      )}
    </Suspense>
    </>
  );
}
