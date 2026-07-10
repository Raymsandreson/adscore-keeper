import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cloudFunctions } from '@/lib/functionRouter';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Star, CheckCircle2, Scale } from 'lucide-react';
import { toast } from 'sonner';

type Phase = 'loading' | 'form' | 'done' | 'already' | 'invalid';

export default function AvaliacaoPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [assessorName, setAssessorName] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    (async () => {
      try {
        const { data, error } = await cloudFunctions.invoke('service-rating', { body: { action: 'get', token } });
        if (error || !data?.success) { setPhase('invalid'); return; }
        setAssessorName(data.assessor_name || null);
        setPhase(data.already ? 'already' : 'form');
      } catch {
        setPhase('invalid');
      }
    })();
  }, [token]);

  const submit = async () => {
    if (rating < 1) { toast.error('Escolha de 1 a 5 estrelas.'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await cloudFunctions.invoke('service-rating', {
        body: { action: 'submit', token, rating, reason },
      });
      if (error || !data?.success) throw new Error(data?.error || 'Falha ao enviar');
      setPhase('done');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível enviar sua avaliação.');
    } finally {
      setSubmitting(false);
    }
  };

  const shown = hover || rating;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-1">
            <span className="text-2xl font-light">whats</span>
            <span className="text-2xl font-bold text-primary-foreground bg-primary px-1.5 rounded">JUD</span>
          </div>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Carregando…</span>
          </div>
        )}

        {phase === 'invalid' && (
          <div className="text-center py-8 space-y-2">
            <Scale className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Link inválido</h1>
            <p className="text-sm text-muted-foreground">Este link de avaliação não é válido ou expirou.</p>
          </div>
        )}

        {phase === 'already' && (
          <div className="text-center py-8 space-y-2">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
            <h1 className="text-lg font-semibold">Avaliação já registrada</h1>
            <p className="text-sm text-muted-foreground">Obrigado! Você já avaliou este atendimento.</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="text-center py-8 space-y-2">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
            <h1 className="text-lg font-semibold">Obrigado pela sua avaliação!</h1>
            <p className="text-sm text-muted-foreground">Seu retorno nos ajuda a melhorar o atendimento.</p>
          </div>
        )}

        {phase === 'form' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-lg font-semibold">Como foi seu atendimento?</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {assessorName ? `Avalie o atendimento de ${assessorName}.` : 'Sua opinião é muito importante para nós.'}
              </p>
            </div>

            <div className="flex items-center justify-center gap-1.5 py-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  className="p-1 transition-transform hover:scale-110"
                  aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
                >
                  <Star className={`h-9 w-9 ${n <= shown ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40'}`} />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <p className="text-center text-sm font-medium -mt-2">
                {['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'][rating]}
              </p>
            )}

            <div>
              <label className="text-sm font-medium">Por quê? (opcional)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Conte o que achou do atendimento…"
                rows={4}
                className="mt-1"
              />
            </div>

            <Button className="w-full h-11" onClick={submit} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Enviando…</> : 'Enviar avaliação'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
