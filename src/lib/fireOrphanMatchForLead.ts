import { toast } from 'sonner';

/**
 * Dispara o matcher reverso no Railway: dado um lead recém-criado/atualizado,
 * tenta vincular processos órfãos do INSS Administrativo que combinam com ele.
 *
 * Background, fire-and-forget. Mostra toast só quando casa pelo menos 1.
 */
const RAILWAY_BASE =
  (import.meta as any).env?.VITE_RAILWAY_BASE_URL ||
  'https://adscore-keeper-production.up.railway.app';

export function fireOrphanMatchForLead(leadId: string | null | undefined) {
  if (!leadId) return;
  try {
    fetch(`${RAILWAY_BASE}/functions/match-orphans-for-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': (import.meta as any).env?.VITE_RAILWAY_API_KEY || '',
      },
      body: JSON.stringify({ lead_id: leadId }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && (j.linked || 0) > 0) {
          toast.success(
            `${j.linked} processo${j.linked > 1 ? 's' : ''} INSS vinculado${j.linked > 1 ? 's' : ''} a este lead`,
          );
        }
      })
      .catch(() => {});
  } catch {
    // silencioso
  }
}
