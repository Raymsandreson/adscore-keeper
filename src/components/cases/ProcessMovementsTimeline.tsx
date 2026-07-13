import { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2, Milestone, Filter, TrainFront, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProcessMovements, type MarcoTipo } from '@/hooks/useProcessMovements';

/** Número CNJ compacto pro chip de origem: "3013153-02…8.06" */
function shortCnj(numero: string | null): string {
  if (!numero) return '';
  const m = numero.match(/^(\d{7}-\d{2})\.\d{4}\.(\d\.\d{2})/);
  return m ? `${m[1]}…${m[2]}` : numero.slice(0, 14);
}

const MARCO_LABEL: Record<MarcoTipo, string> = {
  peticao_inicial: 'Petição Inicial',
  sentenca_1grau: 'Sentença (1º Grau)',
  acordo: 'Acordo',
  acordao_2grau: 'Acórdão (2º Grau)',
  acordao_superior: 'Acórdão (Superior)',
  transito_julgado: 'Trânsito em Julgado',
  pagamento: 'Pagamento',
};

const MARCO_COLOR: Record<MarcoTipo, string> = {
  peticao_inicial: 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300',
  sentenca_1grau: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  acordo: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  acordao_2grau: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  acordao_superior: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  transito_julgado: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
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

// Ordem canônica das "estações" no ciclo de vida do processo.
const ESTACOES: MarcoTipo[] = [
  'peticao_inicial', 'sentenca_1grau', 'acordo', 'acordao_2grau',
  'acordao_superior', 'transito_julgado', 'pagamento',
];

// Estações que nem todo processo percorre (acordo/recursos) — quando o trem já
// passou do ponto sem parar nelas, mostram "não houve" em vez de "falta".
const ESTACOES_OPCIONAIS = new Set<MarcoTipo>(['acordo', 'acordao_2grau', 'acordao_superior']);

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
 * Linha do trem: as 7 estações do ciclo de vida, com o trem na estação atual,
 * o trecho percorrido preenchido (com o tempo entre estações), o futuro
 * tracejado e as estações puladas (acordo/recursos que não houve) atenuadas.
 */
function MarcosTrainLine({
  movements,
  currentProcessId,
}: {
  movements: ReturnType<typeof useProcessMovements>['movements'];
  currentProcessId?: string;
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

    const idxAtual = ESTACOES.reduce((acc, t, i) => (porTipo.has(t) ? i : acc), -1);

    return ESTACOES.map((tipo, i) => {
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
  }, [movements]);

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
        return (
          <div key={e.tipo}>
            <div className="flex items-center gap-2.5">
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
}: {
  processId: string;
  refreshKey?: number;
  /** Habilita a "Linha do caso": marcos de todos os processos conexos do mesmo caso. */
  caseId?: string | null;
}) {
  const [escopo, setEscopo] = useState<'processo' | 'caso'>('processo');
  const { movements, loading, refetch } = useProcessMovements(processId, { escopo, caseId });
  const [onlyCurrent, setOnlyCurrent] = useState(true);

  // Re-busca quando o pai sinaliza um novo sync (ex.: "buscar no Escavador").
  // refreshKey inicia em 0 (falsy) → não dispara no mount, só após incremento.
  useEffect(() => {
    if (refreshKey) refetch();
  }, [refreshKey, refetch]);

  // movements já vem ordenado por data DESC — o [0] é o status atual.
  const visible = useMemo(
    () => (onlyCurrent ? movements.slice(0, 1) : movements),
    [movements, onlyCurrent],
  );

  if (loading) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
        Carregando marcos...
      </div>
    );
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
      <MarcosTrainLine movements={movements} currentProcessId={processId} />

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
