/**
 * Lead(s) e caso(s) vinculados a VÁRIOS contatos numa consulta só.
 *
 * As listas de contato (sugestão por cidade, busca, etc.) mostravam só nome e
 * telefone — quem olhava não sabia se aquela pessoa já era de um caso nosso e
 * precisava abrir a ficha para descobrir. Aqui vem o vínculo pronto para virar
 * etiqueta com atalho.
 *
 * Lead: `contact_leads` → `leads`. Caso: `process_parties` → `lead_processes`
 * (→ `legal_cases`), a mesma origem que a aba "Leads" da ficha do contato usa.
 */
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';

export interface ContactLinkLead {
  id: string;
  name: string;
  status: string | null;
}

export interface ContactLinkCase {
  processId: string;
  caseId: string | null;
  /** Rótulo curto já pronto para a etiqueta (nº do caso, título ou nº do processo). */
  label: string;
  role: string | null;
}

export interface ContactLinks {
  leads: ContactLinkLead[];
  cases: ContactLinkCase[];
}

export const EMPTY_CONTACT_LINKS: ContactLinks = { leads: [], cases: [] };

export function useContactsLinks(contactIds: string[]) {
  const [byContact, setByContact] = useState<Record<string, ContactLinks>>({});
  const [loading, setLoading] = useState(false);

  const key = useMemo(
    () => Array.from(new Set(contactIds.filter(Boolean))).sort().join(','),
    [contactIds]
  );

  useEffect(() => {
    if (!key) {
      setByContact({});
      return;
    }
    const ids = key.split(',');
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [{ data: linkRows }, { data: partyRows }] = await Promise.all([
          (db as any).from('contact_leads').select('contact_id, lead_id').in('contact_id', ids),
          (db as any)
            .from('process_parties')
            .select('contact_id, role, lead_processes(id, process_number, case_id, legal_cases(case_number, title))')
            .in('contact_id', ids),
        ]);
        if (cancelled) return;

        const links = (linkRows || []) as { contact_id: string; lead_id: string }[];
        const leadIds = Array.from(new Set(links.map((l) => l.lead_id).filter(Boolean)));
        let leadsById = new Map<string, { id: string; lead_name: string | null; status: string | null }>();
        if (leadIds.length) {
          const { data: leadRows } = await (db as any)
            .from('leads')
            .select('id, lead_name, status')
            .in('id', leadIds);
          if (cancelled) return;
          leadsById = new Map(((leadRows || []) as any[]).map((l) => [l.id, l]));
        }

        const acc: Record<string, ContactLinks> = {};
        const bucket = (id: string) => (acc[id] ||= { leads: [], cases: [] });

        for (const link of links) {
          const lead = leadsById.get(link.lead_id);
          if (!lead) continue;
          bucket(link.contact_id).leads.push({
            id: lead.id,
            name: lead.lead_name || 'Lead sem nome',
            status: lead.status || null,
          });
        }

        for (const party of ((partyRows || []) as any[])) {
          const proc = party.lead_processes;
          if (!proc || !party.contact_id) continue;
          const legal = proc.legal_cases;
          const label = legal?.case_number || legal?.title || proc.process_number || 'Caso';
          bucket(party.contact_id).cases.push({
            processId: proc.id,
            caseId: proc.case_id || null,
            label: String(label),
            role: party.role || null,
          });
        }

        setByContact(acc);
      } catch {
        console.warn('[useContactsLinks] falha ao carregar vínculos dos contatos');
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
