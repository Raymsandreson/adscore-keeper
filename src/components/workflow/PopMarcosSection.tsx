// =============================================================================
// Seção "Marcos do POP" dentro do editor do POP.
//
// POR QUE AQUI E NÃO NUMA TELA PRÓPRIA (decisão do usuário, 08/08/2026):
// marco pertence ao POP, do mesmo jeito que fase, objetivo e passo. Mais que
// isso — no desenho novo, cada FASE É UM MARCO: a fase diz onde o processo
// está, e os objetivos e passos dentro dela dizem o que a equipe faz para
// chegar lá. Um lado é automático (vem da fonte cadastrada), o outro é o
// procedimento.
//
// O acordo é a exceção deliberada: ele acontece em qualquer ponto — antes da
// audiência, depois do acórdão, no TST. Virar fase obrigaria a representar um
// acordo no TST como passo atrás no fluxo. Por isso é RESULTADO do POP e marco
// que atravessa a régua (pop_marcos.atravessa_fases).
// =============================================================================
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AcordoRevisaoSheet } from '@/components/processual/AcordoRevisaoSheet';
import { useAcordoExtracoes, type AcordoProcesso } from '@/hooks/useAcordoExtracoes';
import { usePopMarcos, ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { AlertTriangle, PanelRightOpen, Handshake, FileText, Radio } from 'lucide-react';

interface Props {
  boardId: string;
  /** Rótulo da fase por stage_id, para o marco mostrar a que fase pertence. */
  faseLabel?: Record<string, string>;
}

export function PopMarcosSection({ boardId, faseLabel }: Props) {
  const { fases, atravessam, sinais, loading } = usePopMarcos(boardId);
  const { pendentes, aprovados, semPop, revisar, recarregar } = useAcordoExtracoes(boardId);
  const [aberto, setAberto] = useState<AcordoProcesso | null>(null);

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border p-3 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const linhaMarco = (m: (typeof fases)[number]) => {
    const s = sinais[m.id] || { tpu: 0, documento: 0 };
    const total = s.tpu + s.documento;
    return (
      <div key={m.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-sm">
        <span className="mt-0.5 w-5 shrink-0 text-xs text-muted-foreground">{m.ordem}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{m.rotulo}</span>
            {m.terminal ? <Badge variant="secondary" className="text-[10px]">encerra</Badge> : null}
            {m.atravessa_fases ? <Badge variant="outline" className="text-[10px]">atravessa as fases</Badge> : null}
            {m.estagio_financeiro_sugerido ? (
              <Badge className="text-[10px]">
                {ESTAGIO_LABEL[m.estagio_financeiro_sugerido] || m.estagio_financeiro_sugerido}
              </Badge>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {m.stage_id ? (faseLabel?.[m.stage_id] || m.stage_id) : 'sem fase'}
            <span>·</span>
            {total === 0 ? (
              <span className="text-amber-600 dark:text-amber-500">
                sem sinal — nunca vai disparar sozinho
              </span>
            ) : (
              <>
                {s.tpu > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Radio className="h-3 w-3" /> {s.tpu} movimentação
                  </span>
                ) : null}
                {s.documento > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {s.documento} documento
                  </span>
                ) : null}
              </>
            )}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 rounded-lg border p-3 space-y-3">
      <div className="text-sm font-semibold">🚩 Marcos do POP</div>
      <p className="text-xs text-muted-foreground">
        Cada fase acima <b>é um marco</b>: ela diz <b>onde o processo está</b>, e vem
        sozinha da fonte cadastrada (movimentação, documento ou e-mail). Os objetivos e
        passos dentro da fase dizem <b>o que a equipe faz</b> para chegar até ela.
      </p>

      {fases.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Este POP ainda não tem régua de marcos cadastrada.
        </p>
      ) : (
        <div className="space-y-1.5">{fases.map(linhaMarco)}</div>
      )}

      {atravessam.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Marcos que atravessam as fases</p>
          <p className="text-xs text-muted-foreground">
            Podem acontecer em qualquer ponto da régua, por isso não são fase —
            aparecem como <b>resultado</b> do POP.
          </p>
          {atravessam.map(linhaMarco)}
        </div>
      ) : null}

      {/* Revisão do que a IA leu nos documentos dos processos DESTE POP. */}
      {(pendentes.length > 0 || aprovados.length > 0) && (
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
      )}

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
