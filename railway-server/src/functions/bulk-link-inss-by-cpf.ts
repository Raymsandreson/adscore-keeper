import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { applyInssMatch } from '../lib/inss-matcher';

/**
 * Varre órfãos do INSS e vincula em lote quando o CPF do segurado bate
 * com leads.cpf OU contacts.cpf -> contact_leads. Diferente do
 * match-inss-orphans (que tenta 7 caminhos por órfão), aqui o foco é
 * volume: carregamos todos os CPFs de leads/contatos em RAM e fazemos
 * um JOIN em memória, evitando 11k queries quando há 11k órfãos.
 *
 * Body opcional:
 *   { dry_run?: boolean } — não aplica, só conta.
 */
export const handler: RequestHandler = async (req, res) => {
  const dryRun = Boolean((req.body || {}).dry_run);
  try {
    const { data: orphans, error } = await supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number, cpf_segurado')
      .is('case_id', null)
      .is('lead_id', null)
      .is('deleted_at', null)
      .not('cpf_segurado', 'is', null);
    if (error) return res.json({ success: false, error: error.message });

    const orphanList = (orphans || []).filter((o: any) => {
      const d = String(o.cpf_segurado || '').replace(/\D/g, '');
      return d.length === 11;
    });

    // Carrega CPFs de leads e contacts em RAM (paginado, pra não estourar 1k)
    const cpfsNeeded = new Set(orphanList.map((o: any) => String(o.cpf_segurado).replace(/\D/g, '')));

    const leadCpfMap = new Map<string, string>(); // cpf -> leadId
    {
      const { data } = await supabase
        .from('leads')
        .select('id, cpf')
        .not('cpf', 'is', null)
        .is('deleted_at', null)
        .limit(50000);
      for (const l of (data || []) as any[]) {
        const c = String(l.cpf || '').replace(/\D/g, '');
        if (c.length === 11 && cpfsNeeded.has(c) && !leadCpfMap.has(c)) {
          leadCpfMap.set(c, l.id);
        }
      }
    }

    const contactCpfLeadMap = new Map<string, string>(); // cpf -> leadId via contact
    {
      const { data: contactsRows } = await supabase
        .from('contacts')
        .select('id, cpf, lead_id')
        .not('cpf', 'is', null)
        .limit(50000);
      const contactsByCpf = new Map<string, any[]>();
      for (const ct of (contactsRows || []) as any[]) {
        const c = String(ct.cpf || '').replace(/\D/g, '');
        if (c.length !== 11 || !cpfsNeeded.has(c)) continue;
        const arr = contactsByCpf.get(c) || [];
        arr.push(ct);
        contactsByCpf.set(c, arr);
      }
      // Resolve lead via contacts.lead_id direto
      for (const [cpf, list] of contactsByCpf.entries()) {
        for (const ct of list) {
          if (ct.lead_id) { contactCpfLeadMap.set(cpf, ct.lead_id); break; }
        }
      }
      // Restantes: via contact_leads
      const pending = Array.from(contactsByCpf.entries())
        .filter(([cpf]) => !contactCpfLeadMap.has(cpf));
      if (pending.length > 0) {
        const allContactIds = pending.flatMap(([, list]) => list.map((c: any) => c.id));
        const { data: cls } = await supabase
          .from('contact_leads')
          .select('contact_id, lead_id')
          .in('contact_id', allContactIds);
        const leadByContact = new Map<string, string>();
        for (const cl of (cls || []) as any[]) {
          if (!leadByContact.has(cl.contact_id)) leadByContact.set(cl.contact_id, cl.lead_id);
        }
        for (const [cpf, list] of pending) {
          for (const ct of list) {
            const lid = leadByContact.get(ct.id);
            if (lid) { contactCpfLeadMap.set(cpf, lid); break; }
          }
        }
      }
    }

    let linked = 0;
    let no_match = 0;
    const errors: string[] = [];

    for (const o of orphanList as any[]) {
      const cpf = String(o.cpf_segurado).replace(/\D/g, '');
      const leadId = leadCpfMap.get(cpf) || contactCpfLeadMap.get(cpf) || null;
      if (!leadId) { no_match++; continue; }
      if (dryRun) { linked++; continue; }
      try {
        await applyInssMatch({
          processId: o.id,
          requerimento: o.requerimento_number,
          match: {
            leadId,
            caseId: null,
            source: leadCpfMap.has(cpf) ? 'cpf_lead' : 'cpf_contact',
          },
        });
        linked++;
      } catch (e: any) {
        errors.push(`${o.requerimento_number}: ${e?.message || 'unknown'}`);
      }
    }

    return res.json({
      success: true,
      dry_run: dryRun,
      stats: { scanned: orphanList.length, linked, no_match, errors: errors.length },
      errors: errors.slice(0, 20),
    });
  } catch (e: any) {
    return res.json({ success: false, error: e?.message || 'unknown' });
  }
};
