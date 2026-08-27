// =============================================================================
// A LINHA DO TREM DA RÉGUA DO POP — o componente único de marcos.
//
// Pedido do usuário (27/08/2026): a "Trilha detectada" da Conferência, a aba
// "Marcos" da ficha e as fases do POP eram três telas do MESMO fato (o marco
// detectado) que não se falavam — vocabulários e layouts diferentes. Este
// componente unifica: a fonte é a régua do POP (pop_marcos +
// process_pop_marcos, a mesma que move a fase do POP e o percentual), e o
// layout é a linha do trem da aba Marcos.
//
// Regras de exibição (as mesmas do percentual em pop_processo_regua):
//   - FASE entra na linha se é obrigatória OU se aconteceu (eventual atingido).
//     Degrau eventual pendente não polui a linha de quem nunca vai passar por
//     ele — é assim que "trânsito a qualquer momento" funciona: sem recurso,
//     nenhum degrau recursal aparece e o trânsito vem logo após a sentença.
//   - ESTADO (atravessa_fases: acordo, suspensão, inadimplência…) não é
//     posição: vira badge no topo, com a data.
//   - presumido = obrigatório anterior ao marco atual que a janela de
//     movimentações não mostrou; aparece atenuado, sem fingir prova.
// =============================================================================
import { ReactNode, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { TrainFront } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FONTE_LABEL } from '@/hooks/useProcessoMarcos';

export interface MarcoDaRegua {
  chave: string;
  rotulo: string;
  ordem: number;
  estado: 'atingido' | 'presumido' | 'pendente';
  eventual: boolean;
  terminal: boolean;
  atravessaFases: boolean;
  /** 'YYYY-MM-DD' da detecção; null em pendente/presumido. */
  data: string | null;
  fonte: string | null;
  temProvaDocumental: boolean;
  atual: boolean;
  /** Nome da fase do POP ligada ao marco (stage do board). */
  stageNome?: string | null;
}

/** Cor do badge de estado por chave — o resto cai no neutro. */
const ESTADO_BADGE: Record<string, string> = {
  acordo_homologado: 'bg-emerald-600 hover:bg-emerald-600',
  suspensao: 'bg-amber-500 hover:bg-amber-500',
  inadimplencia: 'bg-red-600 hover:bg-red-600',
  recuperacao_judicial: 'bg-red-600 hover:bg-red-600',
  sem_bens: 'bg-red-600 hover:bg-red-600',
};

function dataBR(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
}

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

/** Fases que a linha exibe: obrigatórias sempre; eventuais só se aconteceram. */
export function fasesVisiveis(marcos: MarcoDaRegua[]): MarcoDaRegua[] {
  return marcos
    .filter(m => !m.atravessaFases && (!m.eventual || m.estado === 'atingido'))
    .sort((a, b) => a.ordem - b.ordem);
}

export function ReguaMarcosDoPop({
  marcos,
  renderDireita,
}: {
  marcos: MarcoDaRegua[];
  /** Slot à direita de cada linha (ex.: botões de peça na Conferência). */
  renderDireita?: (m: MarcoDaRegua) => ReactNode;
}) {
  const fases = useMemo(() => fasesVisiveis(marcos), [marcos]);
  const estados = useMemo(
    () => marcos.filter(m => m.atravessaFases && m.estado === 'atingido'),
    [marcos],
  );
  const idxAtual = fases.findIndex(m => m.atual);

  const diasNaAtual = useMemo(() => {
    const atual = fases[idxAtual];
    if (!atual?.data) return null;
    const d = new Date(`${atual.data.slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    return humanizeDias(Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000)));
  }, [fases, idxAtual]);

  if (fases.length === 0 && estados.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      {estados.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {estados.map(e => (
            <Badge
              key={e.chave}
              className={cn('text-[10px]', ESTADO_BADGE[e.chave] || 'bg-slate-500 hover:bg-slate-500')}
              title={e.fonte ? `Detectado por ${FONTE_LABEL[e.fonte] || e.fonte}` : undefined}
            >
              {e.rotulo}{e.data ? ` · ${dataBR(e.data)}` : ''}
            </Badge>
          ))}
          <span className="text-[9px] text-muted-foreground">
            estado — atravessa fases, não disputa a posição
          </span>
        </div>
      )}

      {fases.map((m, i) => {
        const isUltima = i === fases.length - 1;
        const trechoPercorrido = idxAtual >= 0 && i < idxAtual;
        return (
          <div key={m.chave}>
            <div className="flex items-center gap-2.5">
              {/* estação */}
              <div className="w-5 flex justify-center shrink-0">
                {m.atual ? (
                  <span className="relative flex h-5 w-5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary/30 animate-ping" />
                    <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <TrainFront className="h-3 w-3" />
                    </span>
                  </span>
                ) : m.estado === 'atingido' ? (
                  <span className="h-3.5 w-3.5 rounded-full bg-primary border-2 border-primary" />
                ) : m.estado === 'presumido' ? (
                  <span className="h-3.5 w-3.5 rounded-full bg-primary/40 border-2 border-primary/40" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-muted-foreground/40 bg-background" />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                <span className={cn(
                  'min-w-0 text-xs',
                  m.atual && 'font-semibold text-primary',
                  !m.atual && m.estado === 'atingido' && 'font-medium',
                  m.estado === 'presumido' && 'text-muted-foreground',
                  m.estado === 'pendente' && 'text-muted-foreground/70',
                )}>
                  <span className="block truncate">
                    {m.rotulo}
                    {m.estado === 'presumido' && (
                      <span className="ml-1 text-[9px] font-normal text-muted-foreground" title="Obrigatório anterior ao marco atual — a movimentação antiga já saiu da janela de captura.">
                        (presumido)
                      </span>
                    )}
                  </span>
                  {m.atual && (
                    <span className="block text-[9px] font-normal text-muted-foreground">
                      {diasNaAtual && <>há {diasNaAtual} nesta fase</>}
                      {diasNaAtual && m.stageNome && ' · '}
                      {m.stageNome && <>fase do POP: {m.stageNome}</>}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {m.estado === 'atingido' && m.fonte && (
                    <span className="text-[9px] text-muted-foreground">
                      {FONTE_LABEL[m.fonte] || m.fonte}
                    </span>
                  )}
                  {renderDireita?.(m)}
                  <span className="w-16 text-right text-[10px] text-muted-foreground whitespace-nowrap">
                    {m.data ? dataBR(m.data) : m.estado === 'pendente' ? 'falta' : ''}
                  </span>
                </span>
              </div>
            </div>
            {/* trecho até a próxima estação */}
            {!isUltima && (
              <div className="flex items-center gap-2.5">
                <div className="w-5 flex justify-center shrink-0">
                  <div className={cn(
                    'w-0.5 min-h-4',
                    trechoPercorrido ? 'bg-primary' : 'border-l-2 border-dashed border-muted-foreground/30',
                  )} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
