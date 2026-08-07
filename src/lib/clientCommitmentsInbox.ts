/**
 * Regras da caixa de pendências do cliente (a visão de TODAS as conversas).
 *
 * A ideia é não depender de ninguém lembrar de abrir a conversa: a pendência
 * aparece numa lista por data, como o funil de feedbacks.
 *
 * Puro de propósito — sem banco e sem React, para poder testar.
 */
import { isCommitmentOpen, isCommitmentOverdue, type ClientCommitment } from './clientCommitments';

export interface InboxCommitment extends ClientCommitment {
  /** Dono resolvido pela view `vw_client_commitments_owner`. */
  owner_user_id: string | null;
  lead_name: string | null;
}

/**
 * Data que posiciona a pendência no tempo.
 *
 * Prazo quando existe; senão o dia em que foi combinada. Sem esse fallback a
 * lista por data ficaria quase vazia — a maioria das promessas de WhatsApp não
 * tem data marcada ("depois eu te mando").
 */
export function commitmentDate(item: Pick<ClientCommitment, 'due_date' | 'promised_at'>): string {
  if (item.due_date) return item.due_date;
  return (item.promised_at || '').slice(0, 10);
}

export type CommitmentBucket = 'vencidas' | 'hoje' | 'amanha' | 'semana' | 'depois' | 'sem_data';

export const BUCKET_LABEL: Record<CommitmentBucket, string> = {
  vencidas: 'Vencidas',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  semana: 'Próximos 7 dias',
  depois: 'Mais para frente',
  sem_data: 'Sem data',
};

/** Ordem em que os grupos aparecem — o que está atrasado vem primeiro. */
export const BUCKET_ORDER: CommitmentBucket[] = [
  'vencidas', 'hoje', 'amanha', 'semana', 'depois', 'sem_data',
];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Em que grupo a pendência cai. Só vale para pendência em aberto — resolvida
 * não tem urgência e sai da caixa.
 */
export function bucketOf(
  item: Pick<ClientCommitment, 'due_date' | 'promised_at' | 'status'>,
  today = new Date().toISOString().slice(0, 10)
): CommitmentBucket {
  const data = commitmentDate(item);
  if (!data) return 'sem_data';
  if (data < today) return 'vencidas';
  if (data === today) return 'hoje';
  if (data === addDays(today, 1)) return 'amanha';
  if (data <= addDays(today, 7)) return 'semana';
  return 'depois';
}

/** Agrupa as pendências em aberto por urgência, na ordem de BUCKET_ORDER. */
export function groupByBucket(
  items: InboxCommitment[],
  today = new Date().toISOString().slice(0, 10)
): Array<{ bucket: CommitmentBucket; items: InboxCommitment[] }> {
  const mapa = new Map<CommitmentBucket, InboxCommitment[]>();
  for (const i of items) {
    if (!isCommitmentOpen(i.status)) continue;
    const b = bucketOf(i, today);
    if (!mapa.has(b)) mapa.set(b, []);
    mapa.get(b)!.push(i);
  }
  return BUCKET_ORDER
    .filter((b) => (mapa.get(b) || []).length > 0)
    .map((b) => ({
      bucket: b,
      // Dentro do grupo, a mais antiga primeiro: é a que está esperando há mais tempo.
      items: (mapa.get(b) || []).sort((x, y) => commitmentDate(x).localeCompare(commitmentDate(y))),
    }));
}

export interface OwnerCount {
  /** `owner_user_id` do Externo. `null` = pendência sem responsável definido. */
  ownerId: string | null;
  total: number;
  vencidas: number;
}

/**
 * Quantas pendências em aberto cada responsável tem — alimenta o filtro por
 * membro e responde "quem está devendo o quê" sem abrir uma a uma.
 *
 * Conta sempre sobre a lista INTEIRA (só a busca por texto deve afetar), nunca
 * sobre o resultado do próprio filtro: senão, ao escolher um membro, todos os
 * outros apareceriam com zero.
 *
 * Ordem: quem tem mais pendências primeiro, empate resolvido pelo id para a
 * lista não dançar entre renders.
 */
export function countByOwner(
  items: InboxCommitment[],
  today = new Date().toISOString().slice(0, 10)
): OwnerCount[] {
  const mapa = new Map<string | null, OwnerCount>();
  for (const i of items) {
    if (!isCommitmentOpen(i.status)) continue;
    const key = i.owner_user_id || null;
    let atual = mapa.get(key);
    if (!atual) {
      atual = { ownerId: key, total: 0, vencidas: 0 };
      mapa.set(key, atual);
    }
    atual.total++;
    if (isCommitmentOverdue(i, today)) atual.vencidas++;
  }
  return [...mapa.values()].sort(
    (a, b) => b.total - a.total || (a.ownerId || '').localeCompare(b.ownerId || '')
  );
}

/** Quantas pendências em aberto caem em cada dia — alimenta o calendário. */
export function countByDay(items: InboxCommitment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    if (!isCommitmentOpen(i.status)) continue;
    const d = commitmentDate(i);
    if (!d) continue;
    out[d] = (out[d] || 0) + 1;
  }
  return out;
}
