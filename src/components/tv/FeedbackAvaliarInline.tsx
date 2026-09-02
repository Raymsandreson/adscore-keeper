import { useState } from 'react';
import { Star, Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuthContext } from '@/contexts/AuthContext';
import { useExternalUserId } from '@/hooks/useExternalUserId';
import {
  validarAvaliacao,
  salvarAvaliacao,
  type FeedbackAlvo,
  type FeedbackOutcome,
} from '@/lib/feedbackEvaluation';
import { useStatusChangePrompt } from '@/components/activities/useStatusChangePrompt';

// Como o desfecho aparece na pergunta de situação que vem logo depois de avaliar.
const ROTULO_DESFECHO: Record<FeedbackOutcome, string> = {
  satisfeito: '✅ Satisfeito',
  incompleto: '⚠️ Incompleto',
  insatisfeito: '❌ Insatisfeito',
};

// Avaliar o feedback SEM sair de onde se está — usado no painel "Feedbacks sem
// avaliar" do telão. Mesmas regras do funil de Atividades (nota obrigatória,
// justificativa no 5 e no <=2, sanduíche no insatisfeito, aviso ao responsável):
// tudo vem de src/lib/feedbackEvaluation.ts, que é a fonte única.
//
// Visual escuro de propósito — nasce dentro dos sheets do telão (bg-slate-950).

export default function FeedbackAvaliarInline({
  alvo, onAvaliado,
}: {
  alvo: FeedbackAlvo;
  /** Chamado depois de gravar, pra lista sumir com o item avaliado. */
  onAvaliado?: (outcome: FeedbackOutcome, rating: number) => void;
}) {
  const { user } = useAuthContext();
  const extId = useExternalUserId();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [justification, setJustification] = useState('');
  const [praise, setPraise] = useState('');
  const [salvando, setSalvando] = useState<FeedbackOutcome | null>(null);
  const [pronto, setPronto] = useState<FeedbackOutcome | null>(null);
  // Mesma pergunta do funil das Atividades: avaliou, confere a situação da
  // atividade. Aqui o painel só tem o id — a situação atual é lida pelo hook.
  const { perguntarSituacao, dialog: dialogSituacao } = useStatusChangePrompt();

  const shown = hover || rating;
  // Campos que a regra exige aparecem sozinhos, na hora que passam a ser
  // obrigatórios — ninguém precisa decorar quando preencher o quê.
  const precisaJustificar = rating === 5 || (rating > 0 && rating <= 2);

  const avaliar = async (outcome: FeedbackOutcome) => {
    const draft = { rating, justification, praise };
    const erro = validarAvaliacao(draft, outcome);
    if (erro) { toast.error(erro); return; }
    setSalvando(outcome);
    try {
      const res = await salvarAvaliacao({ alvo, outcome, draft, extId, cloudUserId: user?.id });
      toast.success(res.mensagem);
      setPronto(outcome);
      onAvaliado?.(outcome, rating);
      await perguntarSituacao({
        activityId: alvo.id,
        contexto: `Avaliado como ${ROTULO_DESFECHO[outcome]}.`,
        sugestao: outcome === 'satisfeito' ? undefined : 'em_andamento',
      });
    } catch (e) {
      console.error('[FeedbackAvaliarInline] avaliar:', e);
      toast.error('Erro ao salvar a avaliação.');
    } finally {
      setSalvando(null);
    }
  };

  if (pronto) {
    return (
      <>
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-400/10 px-2.5 py-2 text-xs font-bold text-emerald-300">
          <Check className="h-3.5 w-3.5 shrink-0" />
          Avaliado como {pronto} · {rating}⭐ — o responsável foi avisado.
        </div>
        {dialogSituacao}
      </>
    );
  }

  return (
    // stopPropagation: este bloco costuma viver dentro de um card/linha que tem
    // clique próprio. Dar nota não pode disparar a ação do card em volta.
    <div
      className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-white/40">Avaliar</span>
        <span className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="p-0.5 transition-transform hover:scale-110"
              aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
            >
              <Star className={cn('h-5 w-5', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-white/25')} />
            </button>
          ))}
        </span>
        {rating > 0 && (
          <span className="text-xs font-bold text-amber-300">
            {['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'][rating]}
          </span>
        )}
      </div>

      {rating > 0 && (
        <>
          <textarea
            value={justification}
            onChange={e => setJustification(e.target.value)}
            rows={2}
            placeholder={precisaJustificar
              ? (rating === 5 ? 'O que motivou a nota máxima? (obrigatório)' : 'O que faltou? Seja construtivo. (obrigatório)')
              : 'Por quê? (opcional)'}
            className={cn(
              'mt-2 w-full resize-y rounded-md border bg-slate-900/70 px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none',
              precisaJustificar && !justification.trim() ? 'border-amber-400/50' : 'border-white/10',
            )}
          />
          <textarea
            value={praise}
            onChange={e => setPraise(e.target.value)}
            rows={2}
            placeholder="1 coisa que ficou boa (obrigatório só p/ Insatisfeito)"
            className="mt-1.5 w-full resize-y rounded-md border border-white/10 bg-slate-900/70 px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none"
          />

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <BotaoDesfecho
              label="Satisfeito" icon={<Check className="h-3.5 w-3.5" />} cor="emerald"
              carregando={salvando === 'satisfeito'} disabled={!!salvando}
              onClick={() => avaliar('satisfeito')}
            />
            <BotaoDesfecho
              label="Incompleto" icon={<AlertTriangle className="h-3.5 w-3.5" />} cor="amber"
              carregando={salvando === 'incompleto'} disabled={!!salvando}
              onClick={() => avaliar('incompleto')}
            />
            <BotaoDesfecho
              label="Insatisf." icon={<X className="h-3.5 w-3.5" />} cor="rose"
              carregando={salvando === 'insatisfeito'} disabled={!!salvando}
              onClick={() => avaliar('insatisfeito')}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-white/30">
            Insatisfeito abre uma atividade de melhoria na aba Avaliar das Atividades —
            aqui o responsável só recebe o aviso com o que melhorar.
          </p>
        </>
      )}
    </div>
  );
}

function BotaoDesfecho({
  label, icon, cor, carregando, disabled, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  cor: 'emerald' | 'amber' | 'rose';
  carregando: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const cores = {
    emerald: 'border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/15',
    amber: 'border-amber-400/40 text-amber-300 hover:bg-amber-400/15',
    rose: 'border-rose-400/40 text-rose-300 hover:bg-rose-400/15',
  }[cor];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[11px] font-bold transition disabled:opacity-40',
        cores,
      )}
    >
      {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}
