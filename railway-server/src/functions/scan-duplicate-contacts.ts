// Varre contatos e agrupa duplicados.
// Modos:
//  - 'dry-run'   : só retorna { safe, ambiguous } sem alterar nada
//  - 'merge-safe': executa mescla automática dos casos seguros e retorna o restante ambíguo
//
// Critério de duplicidade:
//   chave = últimos 10 dígitos do telefone normalizado (ignora DDI 55 e o 9 extra)
//   ou, quando sem telefone, nome normalizado (lowercase + sem acentos + sem espaços).
//
// Classificação:
//   SAFE       = mesmo telefone normalizado E (mesmo nome normalizado OU um nome contido no outro)
//   AMBIGUOUS  = mesmo telefone com nomes diferentes/ não contidos, OU só nomes parecidos sem telefone
//
// Política de mescla SAFE:
//   Mantém o contato mais antigo (created_at ASC, fallback id ASC).
//   Preenche campos vazios do "vencedor" com valor não-vazio do "perdedor".
//   Re-aponta contact_leads.contact_id e contacts.lead_id legado para o vencedor.
//   Soft-delete dos perdedores (deleted_at = now()) com snapshot em notes.
//
// Sempre HTTP 200 com { success, ... }.

import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

type Mode = 'dry-run' | 'merge-safe';

interface Contact {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  classification: string | null;
  notes: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  street: string | null;
  cep: string | null;
  profession: string | null;
  lead_id: string | null;
  whatsapp_group_id: string | null;
  created_at: string | null;
  deleted_at: string | null;
}

const MERGEABLE_FIELDS: (keyof Contact)[] = [
  'full_name', 'phone', 'email', 'instagram_username', 'classification',
  'notes', 'city', 'state', 'neighborhood', 'street', 'cep', 'profession',
];

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normName(s: string | null): string {
  if (!s) return '';
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function nameKey(s: string | null): string {
  return normName(s).replace(/\s+/g, '');
}

function normPhone(p: string | null): string {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  if (!digits) return '';
  // Drop 55 country code if leading
  let d = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  // Drop 9 prefix after 2-digit DDD when length is 11 (mobile)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  // Canonical key = last 10 digits (DDD + 8)
  return d.slice(-10);
}

function isGroupContact(c: Contact): boolean {
  return !!(c.whatsapp_group_id || (c.full_name || '').toLowerCase().startsWith('grupo'));
}

function namesCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = a.replace(/\s+/g, ' ');
  const B = b.replace(/\s+/g, ' ');
  if (A === B) return true;
  // contém: "Joao" dentro de "Joao Silva"
  if (A.length >= 3 && B.includes(A)) return true;
  if (B.length >= 3 && A.includes(B)) return true;
  return false;
}

async function fetchAllContacts(): Promise<Contact[]> {
  const all: Contact[] = [];
  const pageSize = 1000;
  let from = 0;
  // Loop until empty page
  while (true) {
    const { data, error } = await ext
      .from('contacts')
      .select('id, full_name, phone, email, instagram_username, classification, notes, city, state, neighborhood, street, cep, profession, lead_id, whatsapp_group_id, created_at, deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as Contact[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

interface Group {
  key: string;
  reason: 'phone' | 'name';
  contacts: Contact[];
}

function buildGroups(contacts: Contact[]): Group[] {
  const byPhone = new Map<string, Contact[]>();
  const byName = new Map<string, Contact[]>();
  for (const c of contacts) {
    if (isGroupContact(c)) continue;
    const p = normPhone(c.phone);
    if (p && p.length >= 10) {
      if (!byPhone.has(p)) byPhone.set(p, []);
      byPhone.get(p)!.push(c);
    } else {
      const n = nameKey(c.full_name);
      if (n && n.length >= 4) {
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n)!.push(c);
      }
    }
  }
  const groups: Group[] = [];
  for (const [key, list] of byPhone) {
    if (list.length > 1) groups.push({ key, reason: 'phone', contacts: list });
  }
  for (const [key, list] of byName) {
    if (list.length > 1) groups.push({ key, reason: 'name', contacts: list });
  }
  return groups;
}

function classifyGroup(g: Group): 'safe' | 'ambiguous' {
  if (g.reason === 'name') return 'ambiguous'; // só nome batendo nunca é seguro
  // phone match: seguro se TODOS os nomes forem compatíveis 2 a 2
  const names = g.contacts.map((c) => normName(c.full_name));
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (!namesCompatible(names[i], names[j])) return 'ambiguous';
    }
  }
  return 'safe';
}

function pickWinner(list: Contact[]): Contact {
  const sorted = [...list].sort((a, b) => {
    const aT = a.created_at ? Date.parse(a.created_at) : Infinity;
    const bT = b.created_at ? Date.parse(b.created_at) : Infinity;
    if (aT !== bT) return aT - bT;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

function buildMergedPayload(winner: Contact, losers: Contact[]): Partial<Contact> {
  const merged: Partial<Contact> = {};
  for (const f of MERGEABLE_FIELDS) {
    const cur = (winner as any)[f];
    if (cur && String(cur).trim()) continue;
    // procura primeiro perdedor com valor
    for (const l of losers) {
      const v = (l as any)[f];
      if (v && String(v).trim()) {
        (merged as any)[f] = v;
        break;
      }
    }
  }
  // nome: se vencedor tem nome curto e algum perdedor tem nome maior compatível, usa o maior
  const wName = winner.full_name || '';
  for (const l of losers) {
    const lName = l.full_name || '';
    if (lName.length > wName.length && namesCompatible(normName(wName), normName(lName))) {
      merged.full_name = lName;
    }
  }
  return merged;
}

async function mergeSafeGroup(g: Group): Promise<{ winner: string; merged: number; error?: string }> {
  try {
    const winner = pickWinner(g.contacts);
    const losers = g.contacts.filter((c) => c.id !== winner.id);
    const payload = buildMergedPayload(winner, losers);

    // 1. Atualizar vencedor com campos preenchidos
    if (Object.keys(payload).length > 0) {
      const { error } = await ext.from('contacts').update(payload).eq('id', winner.id);
      if (error) return { winner: winner.id, merged: 0, error: `update winner: ${error.message}` };
    }

    // 2. Re-apontar contact_leads dos perdedores → vencedor (ignora conflitos)
    for (const l of losers) {
      const { data: links } = await ext
        .from('contact_leads')
        .select('lead_id')
        .eq('contact_id', l.id);
      for (const link of links || []) {
        // tenta inserir vínculo no vencedor; ignora se já existe
        await ext.from('contact_leads').insert({
          contact_id: winner.id,
          lead_id: (link as any).lead_id,
        }).then(() => {}, () => {});
      }
      // remove vínculos do perdedor
      await ext.from('contact_leads').delete().eq('contact_id', l.id);

      // 3. Re-apontar contacts.lead_id legado (se vencedor não tem)
      if (l.lead_id && !winner.lead_id) {
        await ext.from('contacts').update({ lead_id: l.lead_id }).eq('id', winner.id);
      }
    }

    // 4. Soft-delete dos perdedores com snapshot em notes
    for (const l of losers) {
      const snapshot = `[Mesclado em ${new Date().toISOString()} no contato ${winner.id}]\nSnapshot: ${JSON.stringify({
        full_name: l.full_name, phone: l.phone, email: l.email, city: l.city, state: l.state,
      })}\n${l.notes || ''}`;
      await ext.from('contacts')
        .update({ deleted_at: new Date().toISOString(), notes: snapshot.slice(0, 4000) } as any)
        .eq('id', l.id);
    }

    return { winner: winner.id, merged: losers.length };
  } catch (err: any) {
    return { winner: '', merged: 0, error: err?.message || String(err) };
  }
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const body = req.body || {};
    const mode = (body.mode as Mode | 'merge-selected') || 'dry-run';
    const contacts = await fetchAllContacts();
    const groups = buildGroups(contacts);

    // Modo merge-selected: recebe array de keys e mescla só esses grupos
    if (mode === 'merge-selected') {
      const selectedKeys: string[] = Array.isArray(body.keys) ? body.keys : [];
      const target = groups.filter((g) => selectedKeys.includes(g.key));
      let merged_count = 0;
      const merge_errors: string[] = [];
      for (const g of target) {
        const r = await mergeSafeGroup(g);
        if (r.error) merge_errors.push(`${g.key}: ${r.error}`);
        else merged_count += r.merged;
      }
      return ok({ success: true, merged_count, merge_errors, groups_processed: target.length });
    }

    // Modo dry-run (default): lista TODOS os grupos com classificação
    const listed = groups.map((g) => ({
      key: g.key,
      reason: g.reason,
      classification: classifyGroup(g),
      contacts: g.contacts,
    }));

    return ok({
      success: true,
      total_contacts: contacts.length,
      total_groups: groups.length,
      safe_count: listed.filter((g) => g.classification === 'safe').length,
      ambiguous_count: listed.filter((g) => g.classification === 'ambiguous').length,
      groups: listed,
    });
  } catch (err: any) {
    return ok({ success: false, error: err?.message || 'unknown' });
  }
};
