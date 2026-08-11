// =============================================================================
// Revisão dos acordos que a IA leu nas atas dos processos deste POP.
//
// Já se chamou "Marcos do POP" e listava a régua inteira — o que repetia, logo
// abaixo, a mesma lista de fases que está acima no editor. Duas correções do
// usuário (08/08/2026) esvaziaram a seção até sobrar só isto:
//
//   1. "não precisa ter essa parte de marcos separada da fase, agora marco é a
//      mesma fase" — o estágio financeiro e o sinal foram para a linha da fase;
//   2. "marco pela etimologia da palavra não pode ser um estado" — acordo e
//      suspensão deixaram de ser exibidos como marco e vivem onde sempre
//      deveriam: na lista de RESULTADOS do POP. Continuam em pop_marcos apenas
//      como regra de detecção, que é assunto de máquina, não de tela.
//
// Sobrou o que não cabe em nenhum dos dois lugares: conferir o que a IA leu
// dentro dos documentos.
// =============================================================================
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AcordoRevisaoSheet } from '@/components/processual/AcordoRevisaoSheet';
import { useAcordoExtracoes, type AcordoProcesso } from '@/hooks/useAcordoExtracoes';
import { AlertTriangle, PanelRightOpen, Handshake } from 'lucide-react';

interface Props {
  boardId: string;
}

export function PopMarcosSection({ boardId }: Props) {
  const { pendentes, aprovados, semPop, loading, revisar, recarregar } = useAcordoExtracoes(boardId);
  const [aberto, setAberto] = useState<AcordoProcesso | null>(null);

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border p-3">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const temRevisao = pendentes.length > 0 || aprovados.length > 0;
  if (!temRevisao && semPop === 0) return null;

  return (
    <div className="mt-4 rounded-lg border p-3 space-y-3">
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
