// Pequeno registry global de leads com onboarding pendente.
// Atualizado pelo OnboardingCheckpointHost e consultado pelo WhatsAppInbox
// para perguntar antes de trocar de conversa.

const norm = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-8);

let pendingPhones = new Set<string>();
let pendingLeadIdByPhone = new Map<string, string>();
const listeners = new Set<() => void>();

export function setOnboardingPending(entries: Array<{ phone: string; lead_id: string }>) {
  pendingPhones = new Set(entries.map((e) => norm(e.phone)).filter(Boolean));
  pendingLeadIdByPhone = new Map(
    entries
      .map((e) => [norm(e.phone), e.lead_id] as [string, string])
      .filter(([p]) => !!p),
  );
  listeners.forEach((l) => l());
}

export function hasOnboardingPending(phone: string | null | undefined): boolean {
  const k = norm(phone);
  if (!k) return false;
  return pendingPhones.has(k);
}

export function getPendingLeadId(phone: string | null | undefined): string | null {
  return pendingLeadIdByPhone.get(norm(phone)) || null;
}

export function subscribeOnboardingPending(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
