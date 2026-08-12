// =============================================================================
// O que abre DENTRO do card do sino: os eventos do tribunal e o próximo passo.
//
// O card respondia "caiu movimentação" e parava aí. Quem lia precisava sair,
// abrir a aba E-mail do processo e procurar o e-mail para saber O QUE tinha
// acontecido — e depois abrir o POP para saber o que fazer. Aqui as duas
// respostas ficam no mesmo lugar, sem tirar ninguém de onde está (nada de aba
// nova, nada de navigate).
//
// Dois níveis, nesta ordem:
//   1. EVENTOS — o que o tribunal escreveu, data e hora, do e-mail de push.
//   2. PRÓXIMO PASSO — o passo em aberto do POP (de graça, do banco) e, sob
//      clique, a redação da IA a partir dos eventos + POP (activity-from-movement).
//
// A IA é botão, não automático: 100 cards por abertura do sino seriam 100
// chamadas para movimentação que ninguém foi ler.
// =============================================================================
import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, ListTree, Loader2, Route, Sparkles, ClipboardPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProcessUpdate } from '@/hooks/useProcessUpdates';

/** Passo em aberto do POP daquele processo — o que a equipe precisa fazer agora. */
export interface PassoDoPop {
  phaseLabel: string | null;
  objectiveLabel: string | null;
  stepLabel: string | null;
  /** Primeiro passo não concluído DEPOIS do atual. */
  proximoLabel: string | null;
  /** Fallback de quem não tem POP: a fase da régua de marcos do processo. */
  faseProcessual: string | null;
  /** Nome de quem responde pelo passo, quando a cascata resolveu. */
  responsavelNome: string | null;
}

/** Rascunho que a IA devolve para virar atividade. */
export interface SugestaoIA {
  title: string;
  next_steps: string;
  what_was_done: string;
  current_status: string;
  activity_type: string;
  clarifying_question?: string;
}

function fmtDataCurta(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

export function UpdateDetalhe({
  update, aberto, onToggle, carregarPasso, sugerirComIA, criarAtividade,
}: {
  update: ProcessUpdate;
  aberto: boolean;
  onToggle: () => void;
  carregarPasso: (u: ProcessUpdate) => Promise<PassoDoPop | null>;
  sugerirComIA: (u: ProcessUpdate, passo: PassoDoPop | null) => Promise<SugestaoIA | null>;
  /** Sem rascunho = atividade padrão da movimentação; com rascunho = texto da IA. */
  criarAtividade: (u: ProcessUpdate, rascunho?: SugestaoIA) => Promise<void>;
}) {
  const eventos = update.eventos || [];
  const [passo, setPasso] = useState<PassoDoPop | null>(null);
  const [carregandoPasso, setCarregandoPasso] = useState(false);
  const [sugestao, setSugestao] = useState<SugestaoIA | null>(null);
  const [pensando, setPensando] = useState(false);
  const [criando, setCriando] = useState(false);

  // O passo só é buscado quando o card abre: são 4 consultas por movimentação
  // (board, instâncias do checklist, lead e links), e o sino carrega 100 cards.
  const abrir = useCallback(async () => {
    onToggle();
    if (aberto || passo || carregandoPasso) return;
    setCarregandoPasso(true);
    try {
      setPasso(await carregarPasso(update));
    } finally {
      setCarregandoPasso(false);
    }
  }, [aberto, passo, carregandoPasso, onToggle, carregarPasso, update]);

  const pedirSugestao = useCallback(async () => {
    setPensando(true);
    try {
      setSugestao(await sugerirComIA(update, passo));
    } finally {
      setPensando(false);
    }
  }, [sugerirComIA, update, passo]);

  const criar = useCallback(async (rascunho?: SugestaoIA) => {
    setCriando(true);
    try {
      await criarAtividade(update, rascunho);
    } finally {
      setCriando(false);
    }
  }, [criarAtividade, update]);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void abrir(); }}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {aberto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {eventos.length > 0 ? (
          <>
            <ListTree className="h-3 w-3" />
            {eventos.length} {eventos.length === 1 ? 'evento' : 'eventos'} · próximo passo
          </>
        ) : (
          <>
            <Route className="h-3 w-3" />
            Próximo passo
          </>
        )}
      </button>

      {aberto && (
        <div className="mt-1.5 space-y-2 rounded-md border bg-muted/30 p-2" onClick={(e) => e.stopPropagation()}>
          {eventos.length > 0 && (
            <ul className="space-y-1">
              {eventos.map((ev, i) => (
                <li key={i} className="flex gap-2 text-[11px] leading-snug">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground pt-px w-[68px]">
                    {fmtDataCurta(ev.data)} {ev.hora || ''}
                  </span>
                  <span className="flex-1 text-foreground/90">{ev.texto}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t pt-2 space-y-1.5">
            {carregandoPasso ? (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando o passo no POP…
              </p>
            ) : passo?.stepLabel ? (
              <>
                <p className="text-[11px]">
                  <span className="text-muted-foreground">Passo em aberto: </span>
                  <span className="font-medium">{passo.stepLabel}</span>
                  {passo.responsavelNome && (
                    <span className="text-muted-foreground"> · {passo.responsavelNome}</span>
                  )}
                </p>
                {(passo.phaseLabel || passo.objectiveLabel) && (
                  <p className="text-[10px] text-muted-foreground">
                    {[passo.phaseLabel, passo.objectiveLabel].filter(Boolean).join(' › ')}
                  </p>
                )}
                {passo.proximoLabel && (
                  <p className="text-[10px] text-muted-foreground">
                    Depois dele: {passo.proximoLabel}
                  </p>
                )}
              </>
            ) : passo?.faseProcessual ? (
              // Sem POP a régua de marcos ainda diz em que pé o processo está —
              // é menos que o passo, mas é melhor que "não sei".
              <p className="text-[11px]">
                <span className="text-muted-foreground">Sem POP · fase do processo: </span>
                <span className="font-medium">{passo.faseProcessual}</span>
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Este caso não tem POP nem marco — a dica sai só da IA.
              </p>
            )}

            {sugestao && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-primary font-medium flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Dica da IA
                </p>
                {sugestao.title && <p className="text-[11px] font-medium">{sugestao.title}</p>}
                {sugestao.next_steps && (
                  <p className="text-[11px] leading-snug whitespace-pre-wrap">{sugestao.next_steps}</p>
                )}
                {sugestao.clarifying_question && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Dúvida da IA: {sugestao.clarifying_question}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-1 pt-0.5">
              <Button
                variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                disabled={pensando}
                onClick={() => void pedirSugestao()}
                title="A IA lê os eventos e o POP e escreve o próximo passo"
              >
                {pensando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {sugestao ? 'Refazer dica' : 'Sugerir com IA'}
              </Button>
              <Button
                variant={sugestao ? 'default' : 'outline'}
                size="sm"
                className={cn('h-6 px-2 text-[10px] gap-1')}
                disabled={criando}
                onClick={() => void criar(sugestao || undefined)}
                title={sugestao ? 'Cria a atividade já com o texto da IA' : 'Cria a atividade desta movimentação'}
              >
                {criando ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardPlus className="h-3 w-3" />}
                {sugestao ? 'Criar atv com a dica' : 'Criar atv do passo'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
