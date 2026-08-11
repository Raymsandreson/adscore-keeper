/**
 * Pendências do cliente de VÁRIOS contatos numa consulta só.
 *
 * "Pendência" aqui é `lead_client_commitments` — o que o CLIENTE ficou de
 * fazer (ver `src/lib/clientCommitments.ts`). Até então ela só aparecia dentro
 * da conversa do WhatsApp: quem olhava a ficha ou uma lista de contatos não
 * tinha como saber que havia algo em aberto com aquela pessoa.
 *
 * O casamento é por `contact_id` OU por telefone, porque a pendência costuma
 * nascer numa conversa que ainda não tinha contato vinculado. O telefone é
 * comparado em todas as formas que o banco guarda (com e sem DDI 55).
 */
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import {
  OPEN_COMMITMENT_STATUSES,
  isCommitmentOverdue,
  type CommitmentStatus,
} from '@/lib/clientCommitments';

export interface PendencySummary {
  /** Em aberto (combinado + cobrado). */
  open: number;
  /** Subconjunto do aberto que já passou do prazo. */
  overdue: number;
}

export interface PendencyTarget {
  id: string;
  phone?: string | null;
}

/** Formas em que o mesmo número aparece gravado (com e sem DDI). */
export function phoneVariants(raw: string | null | undefined): string[] {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return [];
  const out = new Set<string>([digits]);
  if (digits.startsWith('55') && digits.length > 10) out.add(digits.slice(2));
  else out.add(`55${digits}`);
  return Array.from(out);
}

export function useContactsPendencies(targets: PendencyTarget[]) {
  const [byContact, setByContact] = useState<Record<string, PendencySummary>>({});
  const [loading, setLoading] = useState(false);

  // Assinatura estável: o array chega recriado a cada render da lista, e sem
  // isto a consulta refazia sozinha em loop.
  const key = useMemo(
    () =>
      targets
        .filter((t) => t?.id)
        .map((t) => `${t.id}:${String(t.phone || '').replace(/\D/g, '')}`)
        .sort()
        .join('|'),
    [targets]
  );

  useEffect(() => {
    if (!key) {
      setByContact({});
      return;
    }
    // Lê da própria chave em vez de fechar sobre `targets` — evita closure velha.
    const pairs = key.split('|').map((s) => {
      const [id, phone] = s.split(':');
      return { id, phone };
    });

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids = pairs.map((p) => p.id);
        const phoneToContact = new Map<string, string>();
        for (const p of pairs) {
          for (const v of phoneVariants(p.phone)) {
            if (!phoneToContact.has(v)) phoneToContact.set(v, p.id);
          }
        }
        const phones = Array.from(phoneToContact.keys());

        const filters: string[] = [];
        if (ids.length) filters.push(`contact_id.in.(${ids.join(',')})`);
        if (phones.length) filters.push(`phone.in.(${phones.join(',')})`);
        if (!filters.length) {
          if (!cancelled) setByContact({});
          return;
        }

        const { data, error } = await (db as any)
          .from('lead_client_commitments')
          .select('contact_id, phone, status, due_date')
          .in('status', OPEN_COMMITMENT_STATUSES)
          .or(filters.join(','));
        if (error) throw error;
        if (cancelled) return;

        const idSet = new Set(ids);
        const acc: Record<string, PendencySummary> = {};
        const rows = (data || []) as {
          contact_id: string | null;
          phone: string | null;
          status: CommitmentStatus;
          due_date: string | null;
        }[];
        for (const row of rows) {
          const target =
            row.contact_id && idSet.has(row.contact_id)
              ? row.contact_id
              : phoneToContact.get(String(row.phone || '').replace(/\D/g, ''));
          if (!target) continue;
          const cur = acc[target] || { open: 0, overdue: 0 };
          cur.open += 1;
          if (isCommitmentOverdue(row)) cur.overdue += 1;
          acc[target] = cur;
        }
        setByContact(acc);
      } catch {
        console.warn('[useContactsPendencies] falha ao contar pendências');
        if (!cancelled) setByContact({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { byContact, loading };
}
