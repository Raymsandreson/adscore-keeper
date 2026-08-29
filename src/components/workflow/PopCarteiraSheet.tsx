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
// O topo é o painel por titular (CarteiraTitularPainel): um número grande por
// vez, trocado por um seletor de três posições — tudo, só a cota do cliente, só
// honorários. Cada estágio abre a relação clicável (CarteiraRelacaoSheet), e
// dali cada linha vai para a conferência.
//
// Clicar na linha abre a FICHA do processo (ProcessDetailSheet); o botão de
// escudo abre a CONFERÊNCIA — de onde saiu aquele valor e aquele marco. Os dois
// sheets são IRMÃOS deste, nunca filhos: dois Dialogs do Radix aninhados brigam
// por foco (mesma solução do TeamMarcoProcessosSheet).
// =============================================================================
import { Suspense, lazy, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CalendarDays, ChevronDown, ChevronRight, Copy, Handshake, Loader2, PauseCircle, Search, ShieldCheck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { db, ensureExternalSession } from '@/integrations/supabase';
import {
  useCarteiraDoPop, ESTAGIO_ORDEM, MARCO_ATUAL,
  type GrupoMarco, type ProcessoDoMarco,
} from '@/hooks/useCarteiraDoPop';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { duracaoLegivel } from '@/lib/duracaoLegivel';
import { ProcessoConferenciaSheet } from './ProcessoConferenciaSheet';
import { ConferenciaConteudo } from './PopConferenciaSheet';
import { CarteiraTitularPainel } from './CarteiraTitularPainel';
import { CarteiraRelacaoSheet, type AlvoRelacao } from './CarteiraRelacaoSheet';
import type { ModoCarteira } from '@/lib/carteiraPorTitular';
import type { AlvoConferencia } from '@/hooks/useConferenciaProcesso';

// A ficha do processo é pesada: entra sob demanda, como no TeamMarcoProcessosSheet.
const ProcessDetailSheet = lazy(() => import('@/components/cases/ProcessDetailSheet'));
const LeadPainelPorId = lazy(() => import('@/components/leads/LeadPainelPorId'));

interface Props {
  boardId: string | null;
  boardName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abrir já na aba "Conferência" do seletor — o atalho "Conferência" do
   *  card de POP cai aqui dentro em vez de abrir um sheet separado. */
  conferenciaInicial?: boolean;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ano/mês/dia com o total de meses entre parênteses — "782 d" não dá noção a
 *  ninguém, e quem negocia deságio raciocina em meses. Ver duracaoLegivel.ts. */
const dias = (d: number | null) => duracaoLegivel(d);
/** Nas linhas estreitas os parênteses não cabem; a decomposição basta. */
const diasCurto = (d: number | null) => duracaoLegivel(d, { comTotal: false });

/** "2026-07-01" -> "jul/2026". A data limite da correção vai sempre junto do número. */
const INDICE_CURTO: Record<string, string> = {
  SELIC_SIMPLES_JT: 'SELIC',
  TCM_ESTADUAL: 'TCM',
};

/** Presets do período, na régua dos prints da Jurimetria. Qual data eles
 *  recortam é o outro seletor que decide — como nos prints, que separam
 *  "Data de distribuição" (o campo) de "Últimos 90 dias" (a janela). */
const PERIODOS: { valor: string; rotulo: string }[] = [
  { valor: 'tudo', rotulo: 'qualquer data' },
  { valor: '30', rotulo: 'últimos 30 dias' },
  { valor: '90', rotulo: 'últimos 90 dias' },
  { valor: '120', rotulo: 'últimos 120 dias' },
  { valor: '365', rotulo: 'últimos 365 dias' },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Traduz o preset escolhido na janela [de, até] que o hook entende. */
function janelaDoPeriodo(periodo: string, de: string, ate: string): { de: string | null; ate: string | null } {
  if (periodo === 'tudo') return { de: null, ate: null };
  if (periodo === 'personalizado') return { de: de || null, ate: ate || null };
  if (periodo.startsWith('ano:')) {
    const ano = periodo.slice(4);
    return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
  }
  const dias = Number(periodo);
  if (!Number.isFinite(dias)) return { de: null, ate: null };
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - dias);
  return { de: iso(inicio), ate: null };
}

const mesAno = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m[2]) - 1]}/${m[1]}`;
};

/** Vencimento pede dia, não só mês: "venceu em 03/2024" esconde quanto atrasou. */
const dataBR = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
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

function GrupoDoMarco({ grupo, acoes, abrirSempre }: {
  grupo: GrupoMarco;
  acoes: AcoesProcesso;
  /** Busca ativa: o marco já abre mostrando o que sobrou do filtro. Sem isso a
   *  pessoa digita, o grupo continua fechado e parece que não achou nada. */
  abrirSempre?: boolean;
}) {
  const [manual, setManual] = useState(false);
  const aberto = abrirSempre || manual;
  const setAberto = (fn: (v: boolean) => boolean) => setManual(v => fn(abrirSempre || v));
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
          <span className="shrink-0 text-xs text-muted-foreground">média {diasCurto(grupo.diasMedio)}</span>
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
                    {(p.local.cidade || p.local.uf) && (
                      <span className="ml-1.5">
                        · {[p.local.cidade, p.local.uf].filter(Boolean).join('/')}
                      </span>
                    )}
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
                {diasCurto(p.diasNoMarco)}
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

export function PopCarteiraSheet({ boardId, boardName, open, onOpenChange, conferenciaInicial = false }: Props) {
  const [busca, setBusca] = useState('');
  const [campoData, setCampoData] = useState<string>('ajuizamento');
  const [periodo, setPeriodo] = useState<string>('tudo');
  /** Só usados quando o período é "personalizado". */
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  const janela = janelaDoPeriodo(periodo, de, ate);
  // O filtro vive no hook: os agregados do topo têm que sair do MESMO recorte
  // que a lista, senão a carteira mostra um valor que não é o que está listado.
  const {
    grupos, totais, totaisCarteira, camposDeData, anosDisponiveis,
    semADataEscolhida, honorarios, filtrando, loading, erro,
  } = useCarteiraDoPop(open ? boardId : null, {
    busca, campoData, de: janela.de, ate: janela.ate,
  });
  /** Linha inteira de lead_processes — o ProcessDetailSheet espera o registro. */
  const [fichaAberta, setFichaAberta] = useState<Record<string, unknown> | null>(null);
  const [abrindoId, setAbrindoId] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState<AlvoConferencia | null>(null);
  /** O caso aberto a partir da conferência — irmão da ficha, não filho dela. */
  const [leadAberto, setLeadAberto] = useState<string | null>(null);
  /** Qual titular a tela está mostrando: tudo, só a cota, só o honorário. */
  const [modo, setModo] = useState<ModoCarteira>('JUNTOS');
  /** A quarta aba do seletor: conferência de valores no lugar do dinheiro. */
  const [abaConferencia, setAbaConferencia] = useState(conferenciaInicial);
  const [relacao, setRelacao] = useState<AlvoRelacao | null>(null);

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

  const limparFiltros = () => { setBusca(''); setPeriodo('tudo'); setDe(''); setAte(''); };

  /** Rótulo do campo escolhido, para as frases da tela falarem a mesma língua
   *  do seletor ("34 sem data de Trânsito em julgado"). */
  const rotuloDoCampo =
    campoData === MARCO_ATUAL
      ? 'entrada no marco atual'
      : (camposDeData.find(c => c.chave === campoData)?.rotulo || 'protocolo');

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
        ) : totaisCarteira.processos === 0 ? (
          // A carteira INTEIRA vazia é o estado vazio de verdade. Busca sem
          // resultado não pode cair aqui: sumiria com o campo e prenderia a
          // pessoa numa tela vazia, sem como limpar o que digitou.
          <p className="text-sm text-muted-foreground">
            Nenhum processo com CNJ vinculado a este POP.
          </p>
        ) : (
          <>
            {/* O dinheiro, aberto por dono. Um número grande por vez — o
                seletor troca o número em vez de somar outro card na tela. */}
            <CarteiraTitularPainel
              porTitular={totais.porTitular}
              modo={modo}
              onModo={setModo}
              valorAtualizado={totais.valorAtualizado}
              corrigidoAte={totais.corrigidoAte}
              referenciasPorIndice={totais.referenciasPorIndice}
              processos={totais.processos}
              pago={totais.pago}
              partesSemCorrecao={totais.partesSemCorrecao}
              cnjsComFichaRepetida={totais.cnjsComFichaRepetida}
              onAbrirRelacao={estagio => setRelacao({ modo, estagio })}
              onAbrirConferencia={() => setRelacao({ modo: 'JUNTOS', estagio: null, soCotaZerada: true })}
              mesAno={mesAno}
              indiceCurto={INDICE_CURTO}
              conferencia={{
                ativa: abaConferencia,
                onSelecionar: setAbaConferencia,
                conteudo: <ConferenciaConteudo boardId={boardId} onConferir={setConferindo} />,
              }}
            />

            {/* Na aba Conferência o resto da carteira sai de cena — é a régua
                de "um assunto por vez" do seletor, não conteúdo perdido: voltar
                para Tudo/Do cliente/Honorários traz tudo de volta. */}
            {abaConferencia ? null : (
            <>
            {/* Operação: tempo, sucesso e custo. Fica embaixo do dinheiro. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tempo médio</div>
                <div className="text-lg font-semibold">{dias(totais.mediaDiasNoMarco)}</div>
                <div className="text-xs text-muted-foreground">
                  no marco atual · idade média {dias(totais.mediaIdadeDias)}
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
                {/* A perda é o complemento do sucesso, mas ler "88%" e calcular
                    "12%" de cabeça é trabalho que a tela pode poupar — e é a
                    perda, não o acerto, que dimensiona risco de carteira. */}
                {totais.avaliaveis > 0 && totais.indiceSucesso != null && (
                  <div className="mt-0.5 text-xs text-destructive">
                    {100 - totais.indiceSucesso}% de perdas ·{' '}
                    {totais.avaliaveis - totais.sucessos} de {totais.avaliaveis}
                  </div>
                )}
              </div>
              <div className="rounded-lg border p-2.5 col-span-2">
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

            {/* Honorário que ENTROU — a planilha, não a carteira. Fica FORA dos
                chips de estágio de propósito: o chip PAGO mede a condenação dos
                processos com pagamento registrado (3 de 475 hoje), enquanto isto
                aqui é o caixa de honorário lançado. Somar os dois misturaria a
                fatia do escritório com o processo inteiro. */}
            <div className="rounded-lg border p-2.5">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Honorários recebidos (caixa)
              </div>
              {totais.honorarioRecebido > 0 ? (
                <div className="space-y-1">
                  <div className="text-sm">
                    <span className="font-semibold">{brl(totais.honorarioRecebido)}</span>
                    <span className="text-muted-foreground">
                      {' '}em {totais.honorarioLancamentos} lançamento{totais.honorarioLancamentos === 1 ? '' : 's'}
                      {' '}de {totais.honorarioCnjs} processo{totais.honorarioCnjs === 1 ? '' : 's'}
                      {totais.honorarioUltimo ? ` · último em ${mesAno(totais.honorarioUltimo)}` : ''}
                    </span>
                  </div>
                  {(honorarios.foraDaCarteira > 0 || honorarios.semCnj > 0) && (
                    <div className="text-[11px] leading-snug text-muted-foreground">
                      A planilha tem {brl(honorarios.total)} em honorários no total
                      {honorarios.foraDaCarteira > 0 && (
                        <> · {brl(honorarios.foraDaCarteira)} em {honorarios.cnjsForaDaCarteira} CNJ(s)
                          que não estão nesta carteira</>
                      )}
                      {honorarios.semCnj > 0 && <> · {brl(honorarios.semCnj)} sem CNJ no lançamento</>}
                      {honorarios.ultimo && <> · lançamento mais novo: {mesAno(honorarios.ultimo)}</>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Nenhum lançamento de honorário da planilha bate com os CNJs desta carteira
                  {honorarios.total > 0 ? ` — a planilha tem ${brl(honorarios.total)} em honorários, mas em outros processos ou sem CNJ.` : '.'}
                </div>
              )}
            </div>

            {/* O que AINDA VAI entrar de honorário. Três réguas que não se
                somam: a vencer é o descontável; vencido é risco de crédito OU
                baixa não feita na planilha; condenação tem valor mas não tem
                data. Junto, o "a receber" deste POP inflava ~10x. */}
            {(totais.honorarioAVencer > 0 || totais.honorarioVencido > 0 || totais.honorarioCondenacao > 0) && (
              <div className="rounded-lg border p-2.5">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Honorários que ainda vão entrar
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                    A vencer: <span className="font-medium">{brl(totais.honorarioAVencer)}</span>
                  </span>
                  {totais.honorarioVencido > 0 && (
                    <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                      Vencido: <span className="font-medium">{brl(totais.honorarioVencido)}</span>
                      {totais.honorarioLinhasVencidas > 0 && (
                        <span className="opacity-80">
                          {' '}· {totais.honorarioLinhasVencidas} parcela{totais.honorarioLinhasVencidas === 1 ? '' : 's'}
                          {' '}em {totais.honorarioCnjsVencidos} processo{totais.honorarioCnjsVencidos === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  )}
                  {totais.honorarioCondenacao > 0 && (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                      Condenação (sem data): <span className="font-medium">{brl(totais.honorarioCondenacao)}</span>
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Só <span className="font-medium text-foreground">a vencer</span> tem valor e data no
                  prazo — é o que a gestora antecipa. <span className="font-medium text-foreground">Condenação</span>
                  {' '}tem valor fixado mas nenhuma data de pagamento, então não entra na mesma conta.
                  {totais.honorarioVencido > 0 && (
                    <>
                      {' '}O <span className="font-medium text-foreground">vencido</span> pode ser calote
                      ou parcela que foi paga e não teve a baixa lançada na planilha — pela base não dá
                      para saber qual dos dois
                      {totais.honorarioVencidoMaisAntigo && (
                        <>, e o mais antigo venceu em {dataBR(totais.honorarioVencidoMaisAntigo)}</>
                      )}.
                    </>
                  )}
                </p>
              </div>
            )}

            <p className="text-[11px] leading-snug text-muted-foreground">
              Valores = quanto o processo vale (última decisão de cada PARTE, somadas), não o caixa
              do escritório. A separação entre cota do cliente e honorário existe só nas partes
              cuja fonte a traz — o painel do topo diz quanto da carteira é isso e quanto ainda não
              tem dono atribuído. Clique no valor
              de um processo para ver quanto é de cada parte. O valor CORRIGIDO (em verde) aplica
              juros e correção do termo inicial de cada decisão até a data da tabela de índices —
              SELIC simples nos trabalhistas (buscada no Bacen todo dia), TCM nos estaduais (ainda
              carregada à mão, por isso pode ficar para trás); a carteira continua somando o
              nominal. O chip PAGO não é dinheiro recebido: é a condenação dos processos que já
              têm pagamento registrado em <code>jm_pagamentos</code>, que hoje cobre 3 dos 475 —
              o caixa de honorário está na linha de cima, vindo da planilha de lançamentos, e as
              duas contas não se somam (honorário é a fatia do escritório, a carteira é o
              processo inteiro). Índice de sucesso:
              entre os decididos com leitura de decisão (ou acordo), quantos saíram com valor
              fixado ou acordo homologado — decidido sem leitura é buraco de captura e fica fora
              da conta.
            </p>

            {/* Busca da lista por marco — caso, cliente, CNJ, cidade/UF */}
            <div className="space-y-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar caso, cliente, processo, CNJ, cidade ou UF"
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
              {/* Período do protocolo — a régua dos presets veio da Jurimetria,
                  mas num Select só: no Sheet não cabe menu dentro de menu. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {/* QUAL data — a lista sai dos marcos que este POP realmente tem,
                    com quantos processos têm cada uma. POP diferente, datas
                    diferentes: lista chumbada ofereceria marco de outro fluxo. */}
                <Select value={campoData} onValueChange={setCampoData}>
                  <SelectTrigger className="h-8 w-auto min-w-[12rem] text-xs">
                    <CalendarDays className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MARCO_ATUAL} className="text-xs">
                      Data de entrada no marco atual
                    </SelectItem>
                    {camposDeData.map(c => (
                      <SelectItem key={c.chave} value={c.chave} className="text-xs">
                        Data de {c.rotulo.toLowerCase()}
                        <span className="ml-1 text-muted-foreground">({c.processos})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* A JANELA sobre a data escolhida. */}
                <Select value={periodo} onValueChange={setPeriodo}>
                  <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODOS.map(p => (
                      <SelectItem key={p.valor} value={p.valor} className="text-xs">{p.rotulo}</SelectItem>
                    ))}
                    {anosDisponiveis.map(a => (
                      <SelectItem key={a} value={`ano:${a}`} className="text-xs">em {a}</SelectItem>
                    ))}
                    <SelectItem value="personalizado" className="text-xs">personalizado</SelectItem>
                  </SelectContent>
                </Select>

                {periodo === 'personalizado' && (
                  <>
                    <Input
                      type="date" value={de} onChange={e => setDe(e.target.value)}
                      className="h-8 w-auto text-xs" aria-label="Protocolo a partir de"
                    />
                    <span className="text-xs text-muted-foreground">até</span>
                    <Input
                      type="date" value={ate} onChange={e => setAte(e.target.value)}
                      className="h-8 w-auto text-xs" aria-label="Protocolo até"
                    />
                  </>
                )}

                {filtrando && (
                  <button
                    type="button"
                    className="rounded px-1.5 py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={limparFiltros}
                  >
                    Limpar
                  </button>
                )}
              </div>

              {filtrando && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {totais.processos === 0
                    ? 'Nenhum processo com esse filtro.'
                    : `${totais.processos} de ${totaisCarteira.processos} processos · os valores acima são só destes.`}
                  {/* Filtrar por data esconde quem não tem data. Dizer quantos são
                      evita a leitura errada de que eles sumiram da carteira. */}
                  {(janela.de || janela.ate) && semADataEscolhida > 0 && (
                    <> · {semADataEscolhida} processo(s) sem data de {rotuloDoCampo.toLowerCase()} ficam de fora.</>
                  )}
                </p>
              )}
            </div>

            {/* Por marco */}
            <div className="space-y-1.5">
              {grupos.map(g => (
                <GrupoDoMarco key={g.chave} grupo={g} acoes={acoes} abrirSempre={filtrando} />
              ))}
            </div>
            </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>

    {/* Relação, conferência e ficha: irmãs do sheet da carteira, não filhas. */}
    <CarteiraRelacaoSheet
      alvo={relacao}
      grupos={grupos}
      onClose={() => setRelacao(null)}
      onConferir={p => {
        if (!boardId) return;
        setConferindo({
          processId: p.processId, boardId, cnj: p.cnj,
          titulo: p.titulo, leadNome: p.leadNome, foco: 'valores',
        });
      }}
    />

    <ProcessoConferenciaSheet
      alvo={conferindo}
      onClose={() => setConferindo(null)}
      onAbrirFicha={id => void abrirFicha(id)}
      onAbrirLead={id => setLeadAberto(id)}
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
      {leadAberto && (
        <LeadPainelPorId leadId={leadAberto} onClose={() => setLeadAberto(null)} />
      )}
    </Suspense>
    </>
  );
}
