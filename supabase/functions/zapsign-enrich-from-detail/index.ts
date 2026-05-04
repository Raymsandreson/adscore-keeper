// Enriquece zapsign_documents via GET /api/v1/docs/{token}/
// Cria também registro em zapsign_document_events para trilha de auditoria.
// Roda no Externo (kmedldlepwiityjsdahz) — política de novas funções.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

const ZAPSIGN_BASE = 'https://api.zapsign.com.br/api/v1';

function normPhone(s?: string | null): string {
  return (s || '').replace(/\D/g, '');
}

function phoneVariants(p: string): string[] {
  const digits = normPhone(p);
  if (!digits) return [];
  const set = new Set<string>([digits]);
  // remove DDI 55 if present
  const withoutDdi = digits.startsWith('55') ? digits.slice(2) : digits;
  set.add(withoutDdi);
  set.add('55' + withoutDdi);
  // 9th digit toggle (BR cellphones): DDD + [9]+8digitos
  if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
    const without9 = withoutDdi.slice(0, 2) + withoutDdi.slice(3);
    set.add(without9); set.add('55' + without9);
  } else if (withoutDdi.length === 10) {
    const with9 = withoutDdi.slice(0, 2) + '9' + withoutDdi.slice(2);
    set.add(with9); set.add('55' + with9);
  }
  return [...set];
}

async function fetchDoc(token: string, apiKey: string) {
  const r = await fetch(`${ZAPSIGN_BASE}/docs/${token}/`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { ok: r.ok, status: r.status, json, raw: text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const url = Deno.env.get('EXTERNAL_SUPABASE_URL') || 'https://kmedldlepwiityjsdahz.supabase.co';
    const key = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '';
    const apiKey = Deno.env.get('ZAPSIGN_API_TOKEN') || '';
    if (!key || !apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'missing env (EXTERNAL_SUPABASE_SERVICE_ROLE_KEY/ZAPSIGN_API_TOKEN)' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const sb = createClient(url, key, { auth: { persistSession: false } });

    let body: any = {};
    if (req.method !== 'GET') {
      try { body = await req.json(); } catch { body = {}; }
    }
    const dryRun: boolean = !!body.dry_run;
    const limit: number = Math.min(Number(body.limit) || 5, 200);
    const onlyMissing: boolean = body.only_missing !== false; // default true
    let tokens: string[] = Array.isArray(body.doc_tokens) ? body.doc_tokens.filter((x: any) => typeof x === 'string') : [];

    if (tokens.length === 0) {
      let q = sb.from('zapsign_documents').select('doc_token').order('created_at', { ascending: false }).limit(limit);
      if (onlyMissing) q = q.is('lead_id', null).is('contact_id', null);
      const { data: rows, error } = await q;
      if (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }),
          { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      tokens = (rows || []).map((r: any) => r.doc_token).filter(Boolean);
    }

    const results: any[] = [];
    let enriched = 0, linkedContact = 0, linkedLead = 0, errors = 0;

    for (const token of tokens) {
      try {
        const { ok, status, json, raw } = await fetchDoc(token, apiKey);
        if (!ok || !json) {
          errors++;
          results.push({ token, ok: false, status, error: raw?.slice(0, 200) });
          await sb.from('zapsign_document_events').insert({
            doc_token: token, event_type: 'detail_fetch_failed', status: String(status),
            raw_payload: { error: raw?.slice(0, 500) }, source: 'enrich-from-detail',
          });
          await new Promise(r => setTimeout(r, 250));
          continue;
        }

        const signers = Array.isArray(json.signers) ? json.signers : [];
        const firstSigned = signers.find((s: any) => s.status === 'signed') || signers[0] || {};
        const phone = normPhone((firstSigned.phone_country || '') + (firstSigned.phone_number || ''));
        const answers = Array.isArray(json.answers) ? json.answers : [];

        // Resolve contact / lead
        let contactId: string | null = null;
        let leadId: string | null = null;
        if (phone) {
          const variants = phoneVariants(phone);
          const { data: c } = await sb.from('contacts')
            .select('id').in('whatsapp_phone', variants).is('deleted_at', null).limit(1).maybeSingle();
          contactId = c?.id || null;
          if (contactId) {
            const { data: lk } = await sb.from('contact_leads')
              .select('lead_id').eq('contact_id', contactId).limit(1).maybeSingle();
            leadId = lk?.lead_id || null;
          }
        }

        const updatePayload: any = {
          document_name: json.name || undefined,
          status: json.status,
          original_file_url: json.original_file || null,
          signed_file_url: json.signed_file || null,
          signer_name: firstSigned.name || null,
          signer_token: firstSigned.token || null,
          signer_email: firstSigned.email || null,
          signer_phone: phone || null,
          signer_status: firstSigned.status || null,
          signed_at: firstSigned.signed_at || null,
          template_data: answers,
          whatsapp_phone: phone || null,
        };
        if (contactId) updatePayload.contact_id = contactId;
        if (leadId) updatePayload.lead_id = leadId;

        // Strip undefined
        Object.keys(updatePayload).forEach(k => updatePayload[k] === undefined && delete updatePayload[k]);

        let updatedDoc: any = null;
        if (!dryRun) {
          const { data: upd, error: updErr } = await sb.from('zapsign_documents')
            .update(updatePayload).eq('doc_token', token).select('id, lead_id, contact_id').maybeSingle();
          if (updErr) throw new Error(updErr.message);
          updatedDoc = upd;
          if (contactId) linkedContact++;
          if (leadId) linkedLead++;
          enriched++;

          await sb.from('zapsign_document_events').insert({
            doc_token: token,
            document_id: updatedDoc?.id || null,
            event_type: 'detail_synced',
            status: json.status,
            signer_token: firstSigned.token || null,
            signer_name: firstSigned.name || null,
            signer_email: firstSigned.email || null,
            signer_phone: phone || null,
            signer_status: firstSigned.status || null,
            signed_at: firstSigned.signed_at || null,
            raw_payload: { name: json.name, status: json.status, signers, answers, extra_docs: json.extra_docs || [] },
            source: 'enrich-from-detail',
            processed_at: new Date().toISOString(),
          });
        }

        results.push({
          token,
          ok: true,
          status: json.status,
          name: json.name,
          signer_name: firstSigned.name,
          signer_phone: phone,
          signer_email: firstSigned.email,
          signer_status: firstSigned.status,
          answers_count: answers.length,
          extra_docs: (json.extra_docs || []).length,
          contact_id: contactId,
          lead_id: leadId,
          dry_run: dryRun,
        });
      } catch (e: any) {
        errors++;
        results.push({ token, ok: false, error: e?.message || String(e) });
      }

      await new Promise(r => setTimeout(r, 220)); // ~4.5 req/s
    }

    return new Response(JSON.stringify({
      success: true,
      processed: tokens.length,
      enriched,
      linked_to_contact: linkedContact,
      linked_to_lead: linkedLead,
      errors,
      dry_run: dryRun,
      results,
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
