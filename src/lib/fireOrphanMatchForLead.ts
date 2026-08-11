import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/functionRouter';

/**
 * Dispara o matcher reverso no Railway: dado um lead recém-criado/atualizado,
 * tenta vincular processos órfãos do INSS Administrativo que combinam com ele.
 *
 * Background, fire-and-forget. Mostra toast só quando casa pelo menos 1.
 *
 * Vai pelo functionRouter, não por fetch cru: é o router que injeta o JWT da
 * sessão Cloud. A versão anterior montava a URL do Railway na mão e mandava só
 * `x-api-key: VITE_RAILWAY_API_KEY` — variável que está VAZIA em produção, então
 * a chamada chegava sem credencial nenhuma (2 ocorrências no placar de
 * /health.auth.observado em 11/08/2026, e o motivo de o enforce ainda não poder
 * ser ligado).
 */
export function fireOrphanMatchForLead(leadId: string | null | undefined) {
  if (!leadId) return;
  try {
    void cloudFunctions
      .invoke<{ success?: boolean; linked?: number }>('match-orphans-for-lead', {
        body: { lead_id: leadId },
      })
      .then(({ data }) => {
        const linked = data?.linked || 0;
        if (data?.success && linked > 0) {
          toast.success(
            `${linked} processo${linked > 1 ? 's' : ''} INSS vinculado${linked > 1 ? 's' : ''} a este lead`,
          );
        }
      })
      .catch(() => {});
  } catch {
    // silencioso
  }
}
