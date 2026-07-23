// Estado do lembrete "mensagem pra todos" (telão + popup do shell).
// Regra: o lembrete das 11h e 16h fica PENDURADO até o gestor DISPARAR de
// fato as mensagens do time — não some só por ser dispensado. "Depois" apenas
// adia (soneca); o envio real (marcado por markSent) é o que zera o horário.

export const SLOTS = [11, 16] as const; // horas-alvo (hora local do device)
export const END_HOUR = 21;             // depois disso não cobra mais no dia
export const SNOOZE_MIN = 30;           // "Depois" adia por este tempo
export const CLOSE_SNOOZE_MIN = 15;     // fechar sem enviar adia um pouco

const SENT_KEY = 'team_broadcast_reminder_sent_v1';
const SNOOZE_KEY = 'team_broadcast_reminder_snooze_v2';

export function dayKey(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA'); // AAAA-MM-DD local
}
function keyFor(userId: string, hour: number, now: Date): string {
  return `${dayKey(now)}:${hour}:${userId}`;
}
function readMap(storageKey: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
}
/** Grava podando chaves de outros dias (não cresce sem fim). */
function writeMap(storageKey: string, map: Record<string, number>, now: Date) {
  const keep = dayKey(now);
  const pruned: Record<string, number> = {};
  for (const k of Object.keys(map)) if (k.startsWith(keep)) pruned[k] = map[k];
  try { localStorage.setItem(storageKey, JSON.stringify(pruned)); } catch { /* noop */ }
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Slot que um envio AGORA atende: antes do 1º horário → o 1º; senão o maior já iniciado. */
export function slotForSend(now: Date = new Date()): number {
  const mins = minutesNow(now);
  if (mins < SLOTS[0] * 60) return SLOTS[0];
  let slot = SLOTS[0];
  for (const h of SLOTS) if (mins >= h * 60) slot = h;
  return slot;
}

export function isSent(userId: string, hour: number, now: Date = new Date()): boolean {
  return !!readMap(SENT_KEY)[keyFor(userId, hour, now)];
}

/** Marca como atendido o horário que um envio agora cobre. Chamado ao disparar de fato. */
export function markSent(userId: string, now: Date = new Date()): void {
  const map = readMap(SENT_KEY);
  map[keyFor(userId, slotForSend(now), now)] = now.getTime();
  writeMap(SENT_KEY, map, now);
}

function isSnoozed(userId: string, hour: number, now: Date): boolean {
  const until = readMap(SNOOZE_KEY)[keyFor(userId, hour, now)] || 0;
  return until > now.getTime();
}

export function snooze(userId: string, hour: number, minutes: number, now: Date = new Date()): void {
  const map = readMap(SNOOZE_KEY);
  map[keyFor(userId, hour, now)] = now.getTime() + minutes * 60_000;
  writeMap(SNOOZE_KEY, map, now);
}

/**
 * Horário pendente a exibir AGORA: maior slot já iniciado, ainda NÃO enviado e
 * fora de soneca. Persiste do horário até o envio (ou até END_HOUR). null = nada.
 */
export function pendingSlot(userId: string, now: Date = new Date()): number | null {
  if (now.getHours() >= END_HOUR) return null;
  const mins = minutesNow(now);
  const candidates = SLOTS.filter((h) => mins >= h * 60 && !isSent(userId, h, now));
  if (!candidates.length) return null;
  const slot = Math.max(...candidates);
  if (isSnoozed(userId, slot, now)) return null;
  return slot;
}
