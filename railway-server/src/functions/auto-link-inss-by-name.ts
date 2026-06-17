import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { applyInssMatch, INSS_REQUERIMENTO_FIELD_ID } from '../lib/inss-matcher';

/**
 * Vincula órfãos por NOME (fuzzy ILIKE) — só quando o nome bate em UM único
 * lead distinto (entre leads.lead_name, leads.victim_name, contacts.full_name
 * → contact_leads). Múltiplos candidatos = pula e devolve em `ambiguous` pra
 * revisão manual.
 *
 * Body opcional:
 *   { dry_run?: boolean }  → não aplica, só retorna o que faria.
 *   { only_ids?: string[] } → restringe aos process_ids informados.
 */
export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as any;
  const dryRun = Boolean(body.dry_run);
  const onlyIds: string[] | null = Array.isArray(body.only_ids) && body.only_ids.length > 0
    ? body.only_ids
    : null;

  try {
    let q = supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number, nome_segurado')
      .is('case_id', null)
      .is('lead_id', null)
      .is('deleted_at', null)
      .not('nome_segurado', 'is', null);
    if (onlyIds) q = q.in('id', onlyIds);
    const { data: orphans, error } = await q;
    if (error) throw error;

    const stats = {
      scanned: 0,
      linked: 0,
      ambiguous: 0,
      no_match: 0,
      no_name: 0,
    };
    const linked: Array<{ processId: string; leadId: string; via: string; nome: string }> = [];
    const ambiguous: Array<{ processId: string; nome: string; candidates: string[] }> = [];

    for (const o of (orphans || []) as any[]) {
      stats.scanned++;
      const nome = String(o.nome_segurado || '').trim();
      if (nome.length < 6) { stats.no_name++; continue; }

      const candidates = new Map<string, string>(); // leadId -> via

      // a) leads.lead_name ilike %nome%
      const { data: leadsByName } = await supabase
        .from('leads')
        .select('id, lead_name')
        .ilike('lead_name', `%${nome}%`)
        .is('deleted_at', null)
        .limit(5);
      for (const l of (leadsByName || []) as any[]) {
        if (!candidates.has(l.id)) candidates.set(l.id, `lead_name~"${nome}"`);
      }

      // b) leads.victim_name ilike %nome%
      const { data: leadsByVictim } = await supabase
        .from('leads')
        .select('id, victim_name')
        .ilike('victim_name', `%${nome}%`)
        .is('deleted_at', null)
        .limit(5);
      for (const l of (leadsByVictim || []) as any[]) {
        if (!candidates.has(l.id)) candidates.set(l.id, `victim_name~"${nome}"`);
      }

      // c) contacts.full_name ilike %nome% → contact_leads.lead_id
      if (candidates.size <= 1) {
        const { data: contactsByName } = await supabase
          .from('contacts')
          .select('id, full_name, lead_id')
          .ilike('full_name', `%${nome}%`)
          .is('deleted_at', null)
          .limit(5);
        for (const c of (contactsByName || []) as any[]) {
          if (c.lead_id && !candidates.has(c.lead_id)) {
            candidates.set(c.lead_id, `contato "${c.full_name}"`);
          }
          const { data: cl } = await supabase
            .from('contact_leads')
            .select('lead_id')
            .eq('contact_id', c.id);
          for (const link of (cl || []) as any[]) {
            if (link.lead_id && !candidates.has(link.lead_id)) {
              candidates.set(link.lead_id, `contato "${c.full_name}"`);
            }
          }
        }
      }

      if (candidates.size === 0) { stats.no_match++; continue; }
      if (candidates.size > 1) {
        stats.ambiguous++;
        ambiguous.push({
          processId: o.id,
          nome,
          candidates: Array.from(candidates.keys()),
        });
        continue;
      }

      // exatamente 1 candidato — aplica
      const [leadId, via] = candidates.entries().next().value as [string, string];
      if (!dryRun) {
        try {
          await applyInssMatch({
            processId: o.id,
            requerimento: o.requerimento_number,
            match: { leadId, caseId: null, source: 'name_lead' },
          });
        } catch (e: any) {
          continue;
        }
      }
      stats.linked++;
      linked.push({ processId: o.id, leadId, via, nome });
    }

    return res.json({
      success: true,
      dry_run: dryRun,
      stats,
      linked: linked.slice(0, 50),
      ambiguous: ambiguous.slice(0, 50),
      _custom_field_id: INSS_REQUERIMENTO_FIELD_ID,
    });
  } catch (err: any) {
    return res.json({ success: false, error: err?.message || String(err) });
  }
};
