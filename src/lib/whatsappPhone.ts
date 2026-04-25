/**
 * Canonicaliza um identificador de chat WhatsApp para o formato esperado pela
 * edge `send-whatsapp`. JIDs de grupo (`@g.us`) precisam ser preservados — a
 * UazAPI exige o JID completo como `number`. JIDs de contato individual
 * (`@s.whatsapp.net`, `@c.us`, `@lid`) viram dígitos puros, porque é assim
 * que o webhook de inbound grava `phone` em `whatsapp_messages`; manter o
 * JID cru em outbound cria conversas duplicadas na sidebar.
 */
export function canonicalizeChatTarget(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('@g.us')) return trimmed;
  return trimmed.replace(/@[^@]+$/, '').replace(/\D/g, '') || undefined;
}

/**
 * Detecta se um identificador é um JID de grupo WhatsApp.
 * Grupos têm sufixo `@g.us` ou IDs numéricos com 18+ dígitos
 * (tipicamente iniciados em `1203...`).
 */
export function isWhatsAppGroupId(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  if (trimmed.includes('@g.us')) return true;
  const digits = trimmed.replace(/\D/g, '');
  // JIDs de grupo são longos (>=18 dígitos); telefones individuais ficam <=15
  return digits.length >= 17;
}
