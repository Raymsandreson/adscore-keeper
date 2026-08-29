import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2, Milestone, Filter, TrainFront, GitMerge, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { usePecasDoProcesso } from '@/hooks/usePecasDoProcesso';
import { useAnexosDeMarco } from '@/hooks/useAnexosDeMarco';
import { melhorPeca, rotuloDaPeca } from '@/lib/pecasDoProcesso';
import { useProcessMovements, type MarcoTipo } from '@/hooks/useProcessMovements';
import { estacoesDoProcesso } from '@/lib/processStations';
import { useEstacaoEvidencia } from '@/hooks/useEstacaoEvidencia';
import EstacaoEvidencia from '@/components/cases/EstacaoEvidencia';
import InssMarcosProcesso from '@/components/cases/InssMarcosProcesso';
import { ehNumeroCnj } from '@/lib/inssRegua';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

/** Número CNJ compacto pro chip de origem: "3013153-02…8.06" */
function shortCnj(numero: string | null): string {
  if (!numero) return '';
  const m = numero.match(/^(\d{7}-\d{2})\.\d{4}\.(\d\.\d{2})/);
  return m ? `${m[1]}…${m[2]}` : numero.slice(0, 14);
}

const MARCO_LABEL: Record<MarcoTipo, string> = {
  peticao_inicial: 'Petição Inicial',
  audiencia_conciliacao: 'Audiência de Conciliação',
  pericia: 'Perícia',
  audiencia_instrucao: 'Audiência de Instrução',
  sentenca_1grau: 'Sentença (1º Grau)',
  acordo: 'Acordo',
  acordao_2grau: 'Acórdão (2º Grau)',
  acordao_superior: 'Acórdão (Superior)',
  transito_julgado: 'Trânsito em Julgado',
  cumprimento_sentenca: 'Cumprimento de Sentença',
  precatorio_rpv: 'Precatório / RPV',
  pagamento: 'Pagamento',
};

/**
 * De onde o marco veio, em português. São as fontes que process_movements tem
 * hoje (medido em 26/08/2026: escavador 1002, compromissos 251, audiências 55).
 * Fonte desconhecida aparece crua — inventar rótulo esconde origem nova.
 */
const FONTE_MARCO_LABEL: Record<string, string> = {
  escavador: 'Escavador',
  escavador_compromissos: 'intimação',
  escavador_audiencias: 'pauta de audiência',
  datajud: 'DataJud',
  documento: 'documento do processo',
};

const MARCO_COLOR: Record<MarcoTipo, string> = {
  peticao_inicial: 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300',
  audiencia_conciliacao: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  pericia: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  audiencia_instrucao: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  sentenca_1grau: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  acordo: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  acordao_2grau: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  acordao_superior: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  transito_julgado: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  cumprimento_sentenca: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  precatorio_rpv: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  pagamento: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

function formatDate(v: string): string {
  if (!v) return '';
  // aceita 'YYYY-MM-DD' (append 'T00:00:00' pra não deslocar fuso) ou ISO completo
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
}

function formatValor(v: number | null): string | null {
  if (v == null) return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? null : d;
}

/** "3 dias", "2 meses e 10 dias", "1 ano e 4 meses" */
function humanizeDias(dias: number): string {
  if (dias < 1) return 'mesmo dia';
  if (dias < 60) return `${dias} dia${dias > 1 ? 's' : ''}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) {
    const resto = dias % 30;
    return resto >= 5 ? `${meses} meses e ${resto} dias` : `${meses} meses`;
  }
  const anos = Math.floor(meses / 12);
  const mesesResto = meses % 12;
  return mesesResto > 0
    ? `${anos} ano${anos > 1 ? 's' : ''} e ${mesesResto} ${mesesResto > 1 ? 'meses' : 'mês'}`
    : `${anos} ano${anos > 1 ? 's' : ''}`;
}

interface Estacao {
  tipo: MarcoTipo;
  status: 'concluida' | 'atual' | 'pulada' | 'futura';
  data: Date | null;
  valor: string | null;
  /** CNJ do processo de origem do marco (chip "via …" quando não é o processo aberto). */
  origemCnj: string | null;
  origemProcessId: string | null;
}

/**
 * Linha do trem: estações do ciclo de vida (a lista varia por perfil do caso —
 * conciliação/perícia/instrução só entram quando previstas ou com evidência),
 * com o trem na estação atual, o trecho percorrido preenchido (com o tempo
 * entre estações), o futuro tracejado e as estações puladas atenuadas.
 */
function MarcosTrainLine({
  movements,
  currentProcessId,
  estacoesLista,
  onEstacaoClick,
  resumoProva,
  acoesDaEstacao,
}: {
  movements: ReturnType<typeof useProcessMovements>['movements'];
  currentProcessId?: string;
  estacoesLista: MarcoTipo[];
  /** Abre o detalhe da estação. Só recebe estação já alcançada. */
  onEstacaoClick?: (tipo: MarcoTipo) => void;
  /** Códigos TPU e nº de peças que sustentam a estação (null = sem prova). */
  resumoProva?: (tipo: MarcoTipo, data: Date | null) => { codigos: number[]; docs: number } | null;
  /**
   * Linha de ações da estação: de que fonte veio o marco, a peça que o sustenta
   * e o botão de anexar. Montada pelo pai porque depende de estado que a linha
   * do trem não tem (peças dos autos, upload, visualizador).
   */
  acoesDaEstacao?: (tipo: MarcoTipo, data: Date | null, status: Estacao['status']) => React.ReactNode;
}) {
  const estacoes = useMemo<Estacao[]>(() => {
    // Primeira data e valor de cada marco alcançado (+ processo de origem).
    const porTipo = new Map<MarcoTipo, { data: Date | null; valor: string | null; origemCnj: string | null; origemProcessId: string | null }>();
    for (const m of movements) {
      const tipo = m.tipo_movimentacao as MarcoTipo;
      const data = parseDate(m.data_movimentacao);
      const atual = porTipo.get(tipo);
      if (!atual || (data && atual.data && data < atual.data)) {
        porTipo.set(tipo, {
          data,
          valor: formatValor(m.valor_indenizacao_fixado) || atual?.valor || null,
          origemCnj: m.numero_cnj,
          origemProcessId: m.process_id,
        });
      } else if (atual && !atual.valor) {
        atual.valor = formatValor(m.valor_indenizacao_fixado);
      }
    }

    const idxAtual = estacoesLista.reduce((acc, t, i) => (porTipo.has(t) ? i : acc), -1);

    return estacoesLista.map((tipo, i) => {
      const alcancada = porTipo.get(tipo);
      const status: Estacao['status'] = alcancada
        ? (i === idxAtual ? 'atual' : 'concluida')
        : (i < idxAtual ? 'pulada' : 'futura');
      return {
        tipo,
        status,
        data: alcancada?.data ?? null,
        valor: alcancada?.valor ?? null,
        origemCnj: alcancada?.origemCnj ?? null,
        origemProcessId: alcancada?.origemProcessId ?? null,
      };
    });
  }, [movements, estacoesLista]);

  // Duração entre uma estação alcançada e a PRÓXIMA alcançada (pra rotular o trecho).
  const duracaoAposEstacao = (i: number): string | null => {
    const de = estacoes[i];
    if (!de.data || (de.status !== 'concluida' && de.status !== 'atual')) return null;
    for (let j = i + 1; j < estacoes.length; j++) {
      const ate = estacoes[j];
      if (ate.data && (ate.status === 'concluida' || ate.status === 'atual')) {
        const dias = Math.round((ate.data.getTime() - de.data.getTime()) / 86400000);
        return humanizeDias(Math.max(0, dias));
      }
    }
    return null;
  };

  const diasNaAtual = useMemo(() => {
    const atual = estacoes.find((e) => e.status === 'atual');
    if (!atual?.data) return null;
    return humanizeDias(Math.max(0, Math.round((Date.now() - atual.data.getTime()) / 86400000)));
  }, [estacoes]);

  const idxAtual = estacoes.findIndex((e) => e.status === 'atual');

  return (
    <div className="border rounded-lg p-3 bg-muted/20">
      {estacoes.map((e, i) => {
        const isUltima = i === estacoes.length - 1;
        const duracao = duracaoAposEstacao(i);
        // Trilho sólido = o trem já passou por este trecho (está antes da estação atual).
        const trechoPercorrido = idxAtual >= 0 && i < idxAtual;
        // Só estação alcançada abre detalhe: futura e pulada não têm o que mostrar.
        const clicavel = !!onEstacaoClick && (e.status === 'atual' || e.status === 'concluida');
        return (
          <div key={e.tipo}>
            <div
              className={cn(
                'flex items-center gap-2.5 rounded',
                clicavel && 'cursor-pointer hover:bg-muted/70 -mx-1 px-1 py-0.5 transition-colors',
              )}
              onClick={clicavel ? () => onEstacaoClick!(e.tipo) : undefined}
              role={clicavel ? 'button' : undefined}
              tabIndex={clicavel ? 0 : undefined}
              onKeyDown={clicavel ? (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onEstacaoClick!(e.tipo); }
              } : undefined}
              title={clicavel ? 'Ver o que foi publicado nesta estação' : undefined}
            >
              {/* estação */}
              <div className="w-5 flex justify-center shrink-0">
                {e.status === 'atual' ? (
                  <span className="relative flex h-5 w-5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary/30 animate-ping" />
                    <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <TrainFront className="h-3 w-3" />
                    </span>
                  </span>
                ) : e.status === 'concluida' ? (
                  <span className="h-3.5 w-3.5 rounded-full bg-primary border-2 border-primary" />
                ) : e.status === 'pulada' ? (
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/30 bg-background" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-muted-foreground/40 bg-background" />
                )}
              </div>
              <div className="flex items-baseline justify-between gap-2 flex-1 min-w-0">
                <span className={cn(
                  'text-xs',
                  e.status === 'atual' && 'font-semibold text-primary',
                  e.status === 'concluida' && 'font-medium',
                  e.status === 'pulada' && 'text-muted-foreground/50 text-[11px]',
                  e.status === 'futura' && 'text-muted-foreground/70',
                )}>
                  {MARCO_LABEL[e.tipo]}
                  {e.status === 'pulada' && <span className="text-[9px] ml-1">(não houve)</span>}
                  {e.status === 'atual' && diasNaAtual && (
                    <span className="block text-[9px] font-normal text-muted-foreground">há {diasNaAtual} nesta fase</span>
                  )}
                  {e.origemProcessId && currentProcessId && e.origemProcessId !== currentProcessId && (
                    <span className="block text-[8px] font-mono text-muted-foreground/80">via {shortCnj(e.origemCnj)}</span>
                  )}
                  {e.valor && <span className="block text-[10px] font-medium text-green-700 dark:text-green-400">{e.valor}</span>}
                  {(() => {
                    // Prova resumida: o que sustenta a estação sem precisar abrir.
                    if (e.status !== 'atual' && e.status !== 'concluida') return null;
                    const p = resumoProva?.(e.tipo, e.data);
                    if (!p || (!p.codigos.length && !p.docs)) return null;
                    return (
                      <span className="block text-[9px] font-normal text-muted-foreground">
                        {p.codigos.length > 0 && (
                          <span className="font-mono">TPU {p.codigos.slice(0, 3).join(', ')}</span>
                        )}
                        {p.codigos.length > 0 && p.docs > 0 && ' · '}
                        {p.docs > 0 && `${p.docs} peça${p.docs > 1 ? 's' : ''}`}
                      </span>
                    );
                  })()}
                  {/* Fonte do marco + a peça que o sustenta. O clique aqui não
                      pode abrir o detalhe da estação — cada botão para o evento. */}
                  {acoesDaEstacao && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {acoesDaEstacao(e.tipo, e.data, e.status)}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {e.data ? e.data.toLocaleDateString('pt-BR') : e.status === 'futura' ? 'falta' : ''}
                </span>
              </div>
            </div>
            {/* trecho até a próxima estação */}
            {!isUltima && (
              <div className="flex items-center gap-2.5">
                <div className="w-5 flex justify-center shrink-0">
                  <div className={cn(
                    'w-0.5 min-h-5',
                    trechoPercorrido ? 'bg-primary' : 'border-l-2 border-dashed border-muted-foreground/30',
                  )} />
                </div>
                {duracao && (
                  <span className="text-[9px] text-muted-foreground italic py-0.5">⏱ {duracao}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Timeline de marcos processuais (histórico append-only).
 * Por padrão mostra só o status atual (marco mais recente); o toggle
 * expande pro histórico completo, do mais recente ao mais antigo.
 */
export function ProcessMovementsTimeline({
  processId,
  refreshKey,
  caseId,
  processNumber,
  caseType,
  periciaPrevista,
}: {
  processId: string;
  refreshKey?: number;
  /** Habilita a "Linha do caso": marcos de todos os processos conexos do mesmo caso. */
  caseId?: string | null;
  /** Nº CNJ — define o ramo (trabalhista/previdenciário) pras estações previstas. */
  processNumber?: string | null;
  /** case_type do lead vinculado — refina a previsão (fatal, pensão por morte, rural…). */
  caseType?: string | null;
  /** Override manual da perícia (null = automático). */
  periciaPrevista?: boolean | null;
}) {
  const [escopo, setEscopo] = useState<'processo' | 'caso'>('processo');
  const { movements, loading, refetch } = useProcessMovements(processId, { escopo, caseId });
  const [onlyCurrent, setOnlyCurrent] = useState(true);
  /** Estação aberta no detalhe (null = diálogo fechado). */
  const [estacaoDetalhe, setEstacaoDetalhe] = useState<MarcoTipo | null>(null);

  // Publicações da estação aberta, da mais recente para a mais antiga.
  const detalheMovs = useMemo(() => {
    if (!estacaoDetalhe) return [];
    return movements
      .filter((m) => m.tipo_movimentacao === estacaoDetalhe)
      .sort((a, b) => (b.data_movimentacao || '').localeCompare(a.data_movimentacao || ''));
  }, [movements, estacaoDetalhe]);

  // A prova de cada estação: código TPU do DataJud e peça publicada no processo.
  // A régua dizia "houve Sentença" sem deixar conferir de onde isso saiu.
  const cnjsDaLinha = useMemo(
    () => Array.from(new Set(movements.map((m) => m.numero_cnj).filter(Boolean))) as string[],
    [movements],
  );
  const evidencia = useEstacaoEvidencia(cnjsDaLinha);

  // Data do marco = a PRIMEIRA publicação da estação (mesma regra da linha do
  // trem); é ela que define a janela em que uma peça prova aquele marco.
  const dataDoMarco = useCallback((tipo: MarcoTipo): string | null => {
    const datas = movements
      .filter((m) => m.tipo_movimentacao === tipo)
      .map((m) => m.data_movimentacao)
      .filter(Boolean)
      .sort();
    return datas[0] ?? null;
  }, [movements]);

  const resumoProva = useCallback((tipo: MarcoTipo, data: Date | null) => {
    const p = evidencia.provaDaEstacao(tipo, data ? data.toISOString() : dataDoMarco(tipo));
    const codigos = Array.from(new Set(p.datajud.map((m) => m.codigo)));
    return { codigos, docs: p.documentos.length };
  }, [evidencia, dataDoMarco]);

  // ---------------------------------------------------------------------------
  // A peça que sustenta cada marco — ver e anexar, sem sair da tela.
  //
  // Duas origens: os autos baixados (jm_documentos, casados por data) e o que
  // alguém do escritório anexou à mão. O anexo ganha do casamento por data:
  // quem anexou disse QUAL é a peça, o casamento só deduziu.
  // ---------------------------------------------------------------------------
  const { pecas, assinar: assinarPeca } = usePecasDoProcesso(processNumber);
  const { anexos, anexar, assinar: assinarAnexo, enviando } = useAnexosDeMarco(processId, refreshKey);
  const [pecaAberta, setPecaAberta] = useState<{ url: string; titulo: string } | null>(null);
  const inputAnexo = useRef<HTMLInputElement | null>(null);
  const alvoDoAnexo = useRef<{ tipo: MarcoTipo; data: string | null } | null>(null);

  /** De onde veio o marco desta estação — a primeira publicação que o produziu. */
  const fonteDoMarco = useCallback((tipo: MarcoTipo): string | null => {
    const m = movements
      .filter((x) => x.tipo_movimentacao === tipo)
      .sort((a, b) => (a.data_movimentacao || '').localeCompare(b.data_movimentacao || ''))[0];
    if (!m?.fonte) return null;
    return FONTE_MARCO_LABEL[m.fonte] || m.fonte;
  }, [movements]);

  const abrirPeca = useCallback(async (path: string | null, titulo: string, anexada: boolean) => {
    const url = anexada ? await assinarAnexo(path) : await assinarPeca(path);
    if (!url) { toast.error(`Não consegui abrir "${titulo}"`); return; }
    setPecaAberta({ url, titulo });
  }, [assinarAnexo, assinarPeca]);

  const escolherArquivo = useCallback((tipo: MarcoTipo, data: Date | null) => {
    alvoDoAnexo.current = { tipo, data: data ? data.toISOString().slice(0, 10) : dataDoMarco(tipo) };
    inputAnexo.current?.click();
  }, [dataDoMarco]);

  const receberArquivo = useCallback(async (arquivo: File | null) => {
    const alvo = alvoDoAnexo.current;
    if (!arquivo || !alvo) return;
    try {
      await anexar(arquivo, {
        marcoTipo: alvo.tipo,
        dataMarco: alvo.data,
        caseId: caseId || null,
      });
      toast.success(`Peça anexada a ${MARCO_LABEL[alvo.tipo]}`);
    } catch (e) {
      toast.error('Não consegui anexar a peça', { description: String((e as Error)?.message || e) });
    } finally {
      alvoDoAnexo.current = null;
      if (inputAnexo.current) inputAnexo.current.value = '';
    }
  }, [anexar, caseId]);

  /** Linha de fonte + peça de cada estação alcançada. Estação futura não tem prova a mostrar. */
  const acoesDaEstacao = useCallback((tipo: MarcoTipo, data: Date | null, status: string) => {
    if (status !== 'atual' && status !== 'concluida') return null;
    const fonte = fonteDoMarco(tipo);
    const anexo = anexos.find((a) => a.marcoTipo === tipo) || null;
    const dosAutos = anexo ? null : melhorPeca(pecas, data ? data.toISOString() : dataDoMarco(tipo), { assunto: 'MARCO' });
    const parar = (ev: React.MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };

    return (
      <>
        {fonte && (
          <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-muted-foreground">
            {fonte}
          </Badge>
        )}
        {anexo ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[9px] underline underline-offset-2 hover:text-foreground"
            onClick={(ev) => { parar(ev); void abrirPeca(anexo.storagePath, anexo.titulo, true); }}
            title={`${anexo.titulo} — anexada por alguém do escritório`}
          >
            <Paperclip className="h-2.5 w-2.5" /> ver a peça
            <Badge variant="outline" className="ml-0.5 h-3 px-0.5 text-[8px]">anexada</Badge>
          </button>
        ) : dosAutos ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[9px] underline underline-offset-2 hover:text-foreground"
            onClick={(ev) => { parar(ev); void abrirPeca(dosAutos.storagePath, rotuloDaPeca(dosAutos), false); }}
            title={rotuloDaPeca(dosAutos)}
          >
            <Paperclip className="h-2.5 w-2.5" /> ver a peça
            {dosAutos.tipo === 'RESTRITO' && (
              <Badge variant="outline" className="ml-0.5 h-3 px-0.5 text-[8px]">restrita</Badge>
            )}
            {!dosAutos.exata && <span className="text-muted-foreground">(+{dosAutos.distanciaDias}d)</span>}
          </button>
        ) : (
          <button
            type="button"
            disabled={enviando}
            className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            onClick={(ev) => { parar(ev); escolherArquivo(tipo, data); }}
            title="Sem peça casada nos autos — anexe o documento que prova este marco"
          >
            {enviando ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
            anexar peça
          </button>
        )}
      </>
    );
  }, [anexos, pecas, dataDoMarco, fonteDoMarco, abrirPeca, escolherArquivo, enviando]);

  // Estações a exibir: ordem canônica com as intermediárias (conciliação/
  // perícia/instrução) entrando por evidência (marco existe) ou previsão (perfil).
  const estacoesLista = useMemo(() => {
    const tiposComMarco = new Set(movements.map((m) => m.tipo_movimentacao));
    return estacoesDoProcesso({ tiposComMarco, processNumber, caseType, periciaPrevista });
  }, [movements, processNumber, caseType, periciaPrevista]);

  // Re-busca quando o pai sinaliza um novo sync (ex.: "buscar no Escavador").
  // refreshKey inicia em 0 (falsy) → não dispara no mount, só após incremento.
  useEffect(() => {
    if (refreshKey) refetch();
  }, [refreshKey, refetch]);

  // Status atual = marco mais AVANÇADO na ordem canônica, não o mais recente por
  // data. Movimentação de redistribuição ("Distribuído por sorteio" no 2º grau)
  // vira peticao_inicial com data recente e fazia o processo aparecer no começo
  // da linha estando no acórdão (0000657-98.2025.5.11.0012, 30/07/2026).
  // Empate de ordem → a data mais recente. Mesmo critério das RPCs de metas.
  const visible = useMemo(() => {
    if (!onlyCurrent) return movements;
    if (movements.length === 0) return movements;
    const atual = movements.reduce((melhor, m) => {
      const ordem = m.marco_ordem ?? 0;
      const ordemMelhor = melhor.marco_ordem ?? 0;
      if (ordem !== ordemMelhor) return ordem > ordemMelhor ? m : melhor;
      return m.data_movimentacao > melhor.data_movimentacao ? m : melhor;
    }, movements[0]);
    return [atual];
  }, [movements, onlyCurrent]);

  if (loading) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
        Carregando marcos...
      </div>
    );
  }

  // Processo ADMINISTRATIVO: o número não é CNJ, o Escavador não atende, e a
  // régua é outra (2 etapas, ancorada no resultado). Dizer "os marcos vêm do
  // Escavador" aqui seria mentira — nunca viriam. São 236 processos assim.
  if (!ehNumeroCnj(processNumber) && processNumber) {
    return <InssMarcosProcesso processNumber={processNumber} />;
  }

  if (movements.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Milestone className="h-6 w-6 mx-auto mb-1 opacity-50" />
        <p className="text-xs">Nenhum marco processual detectado ainda.</p>
        <p className="text-[10px] mt-1 opacity-70">
          Os marcos são extraídos das movimentações do Escavador ao cadastrar/atualizar o processo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {caseId && (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant={escopo === 'caso' ? 'default' : 'outline'}
            className="h-6 text-[10px] gap-1"
            onClick={() => setEscopo((v) => (v === 'caso' ? 'processo' : 'caso'))}
            title="Junta os marcos de todos os processos conexos do mesmo caso (principal, agravos, recursos, execução)"
          >
            <GitMerge className="h-3 w-3" />
            {escopo === 'caso' ? 'Linha do caso (conexos)' : 'Ver linha do caso'}
          </Button>
        </div>
      )}
      <MarcosTrainLine
        movements={movements}
        currentProcessId={processId}
        estacoesLista={estacoesLista}
        onEstacaoClick={setEstacaoDetalhe}
        resumoProva={resumoProva}
        acoesDaEstacao={acoesDaEstacao}
      />

      {/* Um input para todas as estações: o alvo do anexo fica na ref. */}
      <input
        ref={inputAnexo}
        type="file"
        accept="application/pdf,image/*,.doc,.docx"
        className="hidden"
        onChange={(ev) => void receberArquivo(ev.target.files?.[0] || null)}
      />

      {/* Peça sempre por cima da tela, nunca em aba nova — mesmo visualizador
          do WhatsApp, com o mesmo botão de baixar. */}
      <MediaLightbox
        url={pecaAberta?.url ?? null}
        title={pecaAberta?.titulo ?? 'Peça do processo'}
        onClose={() => setPecaAberta(null)}
      />

      {/* Detalhe da estação: o teor publicado que produziu o marco. Sem isto,
          a régua diz "houve sentença" e não deixa ver o que a sentença disse. */}
      <Dialog open={!!estacaoDetalhe} onOpenChange={(o) => !o && setEstacaoDetalhe(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {estacaoDetalhe && (
                <Badge className={MARCO_COLOR[estacaoDetalhe]}>{MARCO_LABEL[estacaoDetalhe]}</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {detalheMovs.length === 1
                ? '1 publicação gerou este marco'
                : `${detalheMovs.length} publicações neste marco`}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto space-y-3 pr-1">
            <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Publicação que gerou o marco
            </h5>
            {detalheMovs.map((m) => (
              <div key={m.id} className="border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {m.data_movimentacao ? formatDate(m.data_movimentacao) : 'sem data'}
                  </span>
                  <div className="flex items-center gap-2">
                    {formatValor(m.valor_indenizacao_fixado) && (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                        {formatValor(m.valor_indenizacao_fixado)}
                      </Badge>
                    )}
                    {m.numero_cnj && m.process_id !== processId && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        via {shortCnj(m.numero_cnj)}
                      </span>
                    )}
                  </div>
                </div>

                {m.descricao ? (
                  <p className="text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {m.descricao}
                  </p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    Sem teor salvo — o provedor não devolveu o conteúdo desta movimentação.
                  </p>
                )}

                {m.link_decisao && (
                  <a
                    href={m.link_decisao}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Abrir documento
                  </a>
                )}
              </div>
            ))}
            {!detalheMovs.length && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhuma publicação registrada nesta estação.
              </p>
            )}

            {estacaoDetalhe && (
              <div className="border-t pt-3">
                <EstacaoEvidencia
                  prova={evidencia.provaDaEstacao(estacaoDetalhe, dataDoMarco(estacaoDetalhe))}
                  dataMarco={dataDoMarco(estacaoDetalhe)}
                  loading={evidencia.loading}
                  semDatajud={evidencia.semDatajud}
                  semAcervo={evidencia.semAcervo}
                  onAbrirPeca={(url, titulo) => setPecaAberta({ url, titulo })}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between pt-1">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Milestone className="h-3.5 w-3.5 text-primary" />
          {onlyCurrent ? 'Detalhe do status atual' : `Histórico completo (${movements.length})`}
        </h4>
        {movements.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => setOnlyCurrent((v) => !v)}
          >
            <Filter className="h-3 w-3 mr-1" />
            {onlyCurrent ? 'Ver histórico completo' : 'Só status atual'}
          </Button>
        )}
      </div>

      {visible.map((m, idx) => {
        const tipo = m.tipo_movimentacao as MarcoTipo;
        const valor = formatValor(m.valor_indenizacao_fixado);
        return (
          <div
            key={m.id}
            className={`border rounded-lg p-3 space-y-1.5 ${idx === 0 ? 'border-primary/40' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-[9px] ${MARCO_COLOR[tipo] ?? ''}`}>
                  {MARCO_LABEL[tipo] ?? tipo}
                </Badge>
                {idx === 0 && <span className="text-[9px] text-primary font-medium">atual</span>}
                {escopo === 'caso' && m.process_id !== processId && (
                  <span className="text-[8px] font-mono text-muted-foreground/80">via {shortCnj(m.numero_cnj)}</span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {formatDate(m.data_movimentacao)}
              </span>
            </div>
            {valor && <p className="text-[11px] font-medium pl-0.5">Valor fixado: {valor}</p>}
            {m.descricao && (
              <p className="text-[10px] text-muted-foreground line-clamp-3">{m.descricao}</p>
            )}
            {m.link_decisao && (
              <a
                href={m.link_decisao}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Ver decisão
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
