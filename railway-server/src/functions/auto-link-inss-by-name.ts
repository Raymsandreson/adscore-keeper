import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { applyInssMatch, INSS_REQUERIMENTO_FIELD_ID } from '../lib/inss-matcher';

/**
 * Vincula órfãos do INSS por NOME usando matcher tokenizado + unaccent.
 *
 * Estratégia (alta precisão):
 *   - Normaliza nome do segurado (unaccent + upper, sem stopwords DA/DE/DO/E…)
 *   - Extrai PRIMEIRO e ÚLTIMO token significativos (>=3 letras)
 *   - Procura leads cujo `victim_name` OU `contacts.full_name` (via contact_leads)
 *     contenham AMBOS os tokens. Isso casa "LIDIANE SOARES MENDONCA" com
 *     "Lidiane Soares Mendonça" mesmo que `lead_name` seja só "Lidiane".
 *   - 1 único candidato distinto → vincula
 *   - >1 → ambíguo (cai na revisão manual)
 *
 * Body opcional:
 *   { dry_run?: boolean, only_ids?: string[] }
 */

const STOPWORDS = new Set([
  'DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU',
  'JR', 'JUNIOR', 'NETO', 'FILHO', 'FILHA',
]);

function normalize(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function containsAll(haystackNorm: string, tokens: string[]): boolean {
  const padded = ` ${haystackNorm} `;
  return tokens.every((t) => padded.includes(` ${t} `) || padded.includes(`${t} `) || padded.includes(` ${t}`) || padded.includes(t));
}

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
      const tokens = significantTokens(nome);
      if (tokens.length < 2) { stats.no_name++; continue; }

      const first = tokens[0];
      const last = tokens[tokens.length - 1];
      const required = [first, last];

      // Candidato = leadId -> via
      const candidates = new Map<string, string>();

      // 1) victim_name contém ambos tokens (busca ILIKE pelo mais raro = último)
      const { data: leadsByVictim } = await supabase
        .from('leads')
        .select('id, victim_name')
        .ilike('victim_name', `%${last}%`)
        .is('deleted_at', null)
        .limit(50);
      for (const l of (leadsByVictim || []) as any[]) {
        const vn = normalize(l.victim_name || '');
        if (containsAll(vn, required)) {
          if (!candidates.has(l.id)) candidates.set(l.id, `victim_name "${l.victim_name}"`);
        }
      }

      // 2) contacts.full_name contém ambos tokens → leads via contact_leads
      const { data: contactsByName } = await supabase
        .from('contacts')
        .select('id, full_name, lead_id')
        .ilike('full_name', `%${last}%`)
        .limit(50);
      const matchedContacts: Array<{ id: string; full_name: string; lead_id: string | null }> = [];
      for (const c of (contactsByName || []) as any[]) {
        const cn = normalize(c.full_name || '');
        if (containsAll(cn, required)) {
          matchedContacts.push({ id: c.id, full_name: c.full_name, lead_id: c.lead_id || null });
        }
      }
      for (const c of matchedContacts) {
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

      // 3) Fallback: lead_name (apelido) == primeiro token E contacts NÃO foram checados ainda
      //    Só usa se ainda 0 candidato — evita explodir ambiguidade em "Maria", "Ana" etc.
      if (candidates.size === 0) {
        const { data: leadsByFirst } = await supabase
          .from('leads')
          .select('id, lead_name, victim_name')
          .ilike('lead_name', first)
          .is('deleted_at', null)
          .limit(10);
        // Só vincula se houver EXATAMENTE 1 lead com esse primeiro nome (raríssimo)
        if ((leadsByFirst || []).length === 1) {
          const l = (leadsByFirst as any[])[0];
          candidates.set(l.id, `lead_name="${l.lead_name}" (único)`);
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

      const [leadId, via] = candidates.entries().next().value as [string, string];
      if (!dryRun) {
        try {
          await applyInssMatch({
            processId: o.id,
            requerimento: o.requerimento_number,
            match: { leadId, caseId: null, source: 'name_lead' },
          });
        } catch {
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
      linked: linked.slice(0, 100),
      ambiguous: ambiguous.slice(0, 100),
      _custom_field_id: INSS_REQUERIMENTO_FIELD_ID,
      _matcher_version: 'v2-tokenized',
    });
  } catch (err: any) {
    return res.json({ success: false, error: err?.message || String(err) });
  }
};
