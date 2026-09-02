import { useCallback, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuthContext } from '@/contexts/AuthContext';
import { useExternalUserId } from '@/hooks/useExternalUserId';
import { STATUS_ATIVIDADE, statusAtividadeDef, type StatusAtividade } from '@/lib/activityStatus';
import {
  lerSituacaoAtual, alterarSituacaoAtividade,
  type SituacaoAtual, type ResultadoMudanca,
} from '@/lib/activityStatusChange';

/** `deadline`/`rescheduled_to` são DATE no banco, mas nem toda tela guarda só a data. */
const soData = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

/**
 * "A situação da atividade continua essa?" — pergunta depois de avaliar um
 * feedback.
 *
 * Avaliar um retorno como Incompleto/Insatisfeito e deixar a atividade em
 * "Concluída" é a contradição que motivou isto: o funil cobrava o que faltava e
 * o quadro de atividades dizia que estava pronta. Agora, ao avaliar, aparece a
 * situação ATUAL e a pergunta de para qual mudar — com a data junto, porque
 * reabrir sem prazo novo só empurra o problema.
 *
 * Mesma mecânica do useKeepAsObserverPrompt: `perguntarSituacao()` devolve uma
 * Promise que só resolve quando a pessoa decide, então quem chamou fica parado
 * no meio do fluxo sem duplicar payload. Resolve com o que foi gravado, ou
 * `null` quando manteve como está (ou quando a situação nem pôde ser lida —
 * pergunta que não dá pra responder não trava avaliação nenhuma).
 */
export function useStatusChangePrompt() {
  const { user } = useAuthContext();
  const extId = useExternalUserId();

  const [open, setOpen] = useState(false);
  const [atual, setAtual] = useState<SituacaoAtual | null>(null);
  const [contexto, setContexto] = useState<string>('');
  const [escolhido, setEscolhido] = useState<StatusAtividade>('pendente');
  const [data, setData] = useState('');
  const [salvando, setSalvando] = useState(false);
  const resolveRef = useRef<((r: ResultadoMudanca | null) => void) | null>(null);

  const fechar = useCallback((r: ResultadoMudanca | null) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(r);
  }, []);

  /**
   * @param activityId  atividade a conferir.
   * @param contexto    o que acabou de acontecer ("Avaliado como ⚠️ Incompleto").
   * @param sugestao    situação já marcada quando o diálogo abre.
   * @param situacao    situação atual, quando quem chama já tem a linha em mãos
   *                    (o funil tem; o telão só tem o id e ela é buscada aqui).
   */
  const perguntarSituacao = useCallback(async (params: {
    activityId: string;
    contexto?: string;
    sugestao?: StatusAtividade;
    situacao?: SituacaoAtual | null;
  }): Promise<ResultadoMudanca | null> => {
    const situacao = params.situacao ?? await lerSituacaoAtual(params.activityId);
    if (!situacao) return null;

    const sugestao = params.sugestao || situacao.status;
    setAtual(situacao);
    setContexto(params.contexto || '');
    setEscolhido(sugestao);
    // Reagendar pede data nova de propósito (em branco); nas outras a data que
    // já vale aparece preenchida, pra confirmar ou trocar.
    setData(sugestao === 'reagendada' ? '' : soData(situacao.deadline));
    setOpen(true);

    return new Promise<ResultadoMudanca | null>((resolve) => { resolveRef.current = resolve; });
  }, []);

  const aplicar = useCallback(async () => {
    if (!atual || salvando) return;
    if (escolhido === 'reagendada' && !data) {
      toast.error('Reagendada precisa da nova data.');
      return;
    }
    setSalvando(true);
    try {
      const res = await alterarSituacaoAtividade({
        atual,
        mudanca: { status: escolhido, data: data || null },
        extId,
        cloudUserId: user?.id,
      });
      toast.success(`Situação atualizada para ${statusAtividadeDef(escolhido).label}.`);
      fechar(res);
    } catch (e) {
      console.error('[useStatusChangePrompt] aplicar:', e);
      toast.error('Erro ao alterar a situação da atividade.');
    } finally {
      setSalvando(false);
    }
  }, [atual, escolhido, data, extId, user?.id, salvando, fechar]);

  const defAtual = statusAtividadeDef(atual?.status);
  const nadaMudou = !!atual
    && escolhido === atual.status
    && (escolhido === 'reagendada'
      ? (data || '') === soData(atual.rescheduled_to)
      : (data || '') === soData(atual.deadline));

  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && !salvando) fechar(null); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">A situação da atividade continua essa?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            {contexto ? `${contexto} ` : ''}
            {atual?.title ? `“${atual.title}”` : 'Confira antes de seguir.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground shrink-0">Situação atual:</span>
            <span className={cn('rounded px-2 py-1 font-bold', defAtual.className)}>
              {defAtual.icon} {defAtual.label}
            </span>
            {atual?.status === 'reagendada' && atual?.rescheduled_to && (
              <span className="text-[11px] text-muted-foreground">p/ {soData(atual.rescheduled_to).slice(8, 10)}/{soData(atual.rescheduled_to).slice(5, 7)}</span>
            )}
            {atual?.status !== 'reagendada' && atual?.deadline && (
              <span className="text-[11px] text-muted-foreground">prazo {soData(atual.deadline).slice(8, 10)}/{soData(atual.deadline).slice(5, 7)}</span>
            )}
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mudar para</span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {STATUS_ATIVIDADE.map(s => {
                const ativo = escolhido === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    disabled={salvando}
                    onClick={() => {
                      setEscolhido(s.value);
                      setData(s.value === 'reagendada' ? soData(atual?.rescheduled_to) : soData(atual?.deadline));
                    }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border-2 px-2 py-2 text-xs font-semibold transition disabled:opacity-50',
                      ativo ? cn(s.className, s.border) : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <span>{s.icon}</span>
                    <span className="truncate">{s.label}</span>
                    {s.value === atual?.status && (
                      <span className="ml-auto text-[9px] uppercase tracking-wider opacity-70">atual</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {escolhido === 'reagendada' ? 'Reagendada para *' : 'Prazo de execução'}
            </span>
            <Input
              type="date"
              value={data}
              disabled={salvando}
              onChange={e => setData(e.target.value)}
              className="mt-0.5 h-9 text-xs"
            />
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              {escolhido === 'reagendada'
                ? 'A data do reagendamento é o que o funil e o calendário passam a cobrar.'
                : 'Em branco, o prazo atual continua valendo.'}
            </p>
          </div>
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={salvando} onClick={() => fechar(null)} className="h-9 text-xs">
            Manter {defAtual.label}
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={salvando || nadaMudou}
            onClick={aplicar}
            className="h-9 text-xs gap-1"
            title={nadaMudou ? 'Escolha outra situação ou outra data' : undefined}
          >
            {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Alterar situação
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { perguntarSituacao, dialog };
}
