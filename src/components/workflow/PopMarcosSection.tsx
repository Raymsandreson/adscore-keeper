// =============================================================================
// O que sobra de "Marcos do POP" depois que a fase VIROU o marco.
//
// A seção antiga listava os marcos um a um — e isso repetia, logo abaixo, a
// mesma lista de fases que já está acima no editor (correção do usuário,
// 08/08/2026: "não precisa ter essa parte de marcos separada da fase, agora
// marco é a mesma fase"). O estágio financeiro e o sinal de reconhecimento
// passaram para a própria linha da fase, no WorkflowBuilder.
//
// Aqui fica só o que NÃO é fase e por isso não teria onde aparecer:
//   1. marcos que atravessam a régua (acordo, suspensão);
//   2. a revisão do que a IA leu nos documentos dos processos deste POP.
// =============================================================================
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AcordoRevisaoSheet } from '@/components/processual/AcordoRevisaoSheet';
import { useAcordoExtracoes, type AcordoProcesso } from '@/hooks/useAcordoExtracoes';
import { usePopMarcos, ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { AlertTriangle, PanelRightOpen, Handshake } from 'lucide-react';

interface Props {
  boardId: string;
}

export function PopMarcosSection({ boardId }: Props) {
  const { atravessam, sinais, loading } = usePopMarcos(boardId);
  const { pendentes, aprovados, semPop, revisar, recarregar } = useAcordoExtracoes(boardId);
  const [aberto, setAberto] = useState<AcordoProcesso | null>(null);

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border p-3">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const temRevisao = pendentes.length > 0 || aprovados.length > 0;
  if (atravessam.length === 0 && !temRevisao && semPop === 0) return null;

  return (
    <div className="mt-4 rounded-lg border p-3 space-y-3">
      {atravessam.length > 0 ? (
        <>
          <div className="text-sm font-semibold">🚩 Marcos que atravessam as fases</div>
          <p className="text-xs text-muted-foreground">
            Cada fase acima <b>é um marco</b>. Estes aqui são a exceção: acontecem em
            qualquer ponto da régua — um acordo pode ser homologado antes da audiência
            ou já no TST — então não viram fase e aparecem como <b>resultado</b> do POP.
          </p>
          <div className="space-y-1.5">
            {atravessam.map((m) => {
              const s = sinais[m.id] || { tpu: 0, documento: 0 };
              const total = s.tpu + s.documento;
              return (
                <div key={m.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{m.rotulo}</span>
                      {m.estagio_financeiro_sugerido ? (
                        <Badge className="text-[10px]">
                          {ESTAGIO_LABEL[m.estagio_financeiro_sugerido] || m.estagio_financeiro_sugerido}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">herda o estágio anterior</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {total === 0
                        ? 'sem sinal — nunca vai disparar sozinho'
                        : `${s.tpu} movimentação · ${s.documento} documento`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {temRevisao ? (
        <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Handshake className="h-4 w-4" /> Acordos lidos nas atas
          </div>
          <p className="text-xs text-muted-foreground">
            A IA achou acordo homologado dentro da ata de audiência. Não vira marco
            enquanto alguém não confirmar — acordo errado move o processo de fase e
            reclassifica dinheiro.
          </p>
          {pendentes.map((p) => (
            <button
              key={p.processo_cnj}
              type="button"
              onClick={() => setAberto(p)}
              title="abrir aqui do lado"
              className="flex w-full items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1 truncate">
                {p.processo_cnj}
                {p.principal.dados?.parcial ? (
                  <Badge variant="destructive" className="ml-2 text-[10px]">parcial</Badge>
                ) : null}
              </span>
              <PanelRightOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {pendentes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tudo revisado ({aprovados.length} confirmado(s)).
            </p>
          ) : null}
        </div>
      ) : null}

      {semPop > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Há <b>{semPop}</b> processo(s) com acordo lido na ata que não estão
            cadastrados em nenhum POP — existem só na base de jurimetria. Enquanto o
            processo não for cadastrado, o acordo não tem POP a que pertencer.
          </span>
        </div>
      ) : null}

      <AcordoRevisaoSheet
        acordo={aberto}
        onOpenChange={(open) => { if (!open) { setAberto(null); void recarregar(); } }}
        onRevisado={revisar}
      />
    </div>
  );
}
