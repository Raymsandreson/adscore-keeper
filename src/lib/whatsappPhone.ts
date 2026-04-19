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
