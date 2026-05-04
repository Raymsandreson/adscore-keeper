// zapsign-webhook-v2
// Recebe eventos do ZapSign, grava payload bruto em zapsign_document_events
// e atualiza zapsign_documents. Escreve direto no Externo (kmedldlepwiityjsdahz).
//
// Eventos cobertos (ZapSign):
//   doc_created, doc_signed, doc_refused, doc_deleted,
//   signer_signed, signer_viewed, signer_refused, signer_new_attempt,
//   created_signer, deleted_signer
//
// Política: nunca devolver erro pra ZapSign — sempre HTTP 200, payload é
// gravado primeiro (raw insert) pra não perder evento mesmo se update falhar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normPhone(s?: string | null): string {
  return (s || '').replace(/\D/g, '');
}

function pickFirstSigner(signers: any[]): any {
  if (!Array.isArray(signers) || signers.length === 0) return {};
  return signers.find((s) => s?.status === 'signed') || signers[0];
}

function mapEventType(body: any): string {
  // ZapSign envia o tipo em "event_type" ou inferimos pelo status do doc
  const t = body?.event_type || body?.event || body?.type;
  if (typeof t === 'string' && t.trim()) return t.trim();
  if (body?.status === 'signed') return 'doc_signed';
  if (body?.status === 'refused') return 'doc_refused';
  return 'unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = Deno.env.get('EXTERNAL_SUPABASE_URL') || 'https://kmedldlepwiityjsdahz.supabase.co';
  const key = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '';

  // Sempre tenta ler corpo
  let raw: any = null;
  try { raw = await req.json(); } catch { raw = null; }

  if (!key) {
    console.error('[zapsign-webhook-v2] missing EXTERNAL_SUPABASE_SERVICE_ROLE_KEY');
    return new Response(JSON.stringify({ success: false, error: 'env_missing' }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (!raw || typeof raw !== 'object') {
    return new Response(JSON.stringify({ success: false, error: 'invalid_payload' }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const eventType = mapEventType(raw);
  const docToken: string | null =
    raw.token || raw.doc_token || raw.open_id_token || raw?.doc?.token || null;
  const signers: any[] = Array.isArray(raw.signers) ? raw.signers : (raw?.doc?.signers || []);
  const signer = raw.signer || pickFirstSigner(signers);
  const signerPhone = normPhone((signer?.phone_country || '') + (signer?.phone_number || ''));

  // 1) INSERT cru — nunca falha o webhook por isso
  let documentId: string | null = null;
  if (docToken) {
    const { data: doc } = await sb
      .from('zapsign_documents')
      .select('id')
      .eq('doc_token', docToken)
      .maybeSingle();
    documentId = doc?.id || null;
  }

  const eventInsert = {
    doc_token: docToken,
    document_id: documentId,
    event_type: eventType,
    status: raw.status || raw?.doc?.status || null,
    signer_token: signer?.token || null,
    signer_name: signer?.name || null,
    signer_email: signer?.email || null,
    signer_phone: signerPhone || null,
    signer_status: signer?.status || null,
    signed_at: signer?.signed_at || raw?.signed_at || null,
    raw_payload: raw,
    source: 'webhook',
    processed_at: new Date().toISOString(),
  };

  const { error: insErr } = await sb.from('zapsign_document_events').insert(eventInsert);
  if (insErr) console.error('[zapsign-webhook-v2] event insert error:', insErr.message);

  // 2) UPDATE em zapsign_documents conforme o evento
  if (docToken) {
    const update: any = { updated_at: new Date().toISOString() };

    // Status do documento
    if (raw.status) update.status = raw.status;
    else if (raw?.doc?.status) update.status = raw.doc.status;

    // Arquivos
    if (raw.signed_file || raw?.doc?.signed_file) {
      update.signed_file_url = raw.signed_file || raw.doc.signed_file;
    }
    if (raw.original_file || raw?.doc?.original_file) {
      update.original_file_url = raw.original_file || raw.doc.original_file;
    }

    // Nome
    if (raw.name || raw?.doc?.name) {
      update.document_name = raw.name || raw.doc.name;
    }

    // Por evento
    switch (eventType) {
      case 'doc_signed':
        update.status = 'signed';
        update.signed_at = raw?.signed_at || new Date().toISOString();
        break;
      case 'doc_refused':
        update.status = 'refused';
        break;
      case 'doc_deleted':
        update.status = 'deleted';
        update.deleted_at = new Date().toISOString();
        break;
      case 'signer_signed':
        update.signer_status = 'signed';
        if (signer?.signed_at) update.signed_at = signer.signed_at;
        if (signer?.name) update.signer_name = signer.name;
        if (signer?.email) update.signer_email = signer.email;
        if (signerPhone) update.signer_phone = signerPhone;
        if (signer?.token) update.signer_token = signer.token;
        break;
      case 'signer_viewed':
        update.signer_status = signer?.status || 'viewed';
        update.last_viewed_at = new Date().toISOString();
        break;
      case 'signer_refused':
        update.signer_status = 'refused';
        break;
      default:
        // mantém só o que veio acima
        break;
    }

    // Atualiza signers se vier lista completa
    if (Array.isArray(signers) && signers.length > 0) {
      const first = pickFirstSigner(signers);
      if (first?.name && !update.signer_name) update.signer_name = first.name;
      if (first?.email && !update.signer_email) update.signer_email = first.email;
      if (first?.token && !update.signer_token) update.signer_token = first.token;
      const fp = normPhone((first?.phone_country || '') + (first?.phone_number || ''));
      if (fp && !update.signer_phone) update.signer_phone = fp;
      if (!update.signer_status) update.signer_status = first?.status || null;
    }

    // Strip null/undefined que não deve sobrescrever
    Object.keys(update).forEach((k) => (update[k] === undefined) && delete update[k]);

    if (Object.keys(update).length > 1) {
      const { error: updErr } = await sb
        .from('zapsign_documents')
        .update(update)
        .eq('doc_token', docToken);
      if (updErr) console.error('[zapsign-webhook-v2] update error:', updErr.message);
    }
  }

  return new Response(
    JSON.stringify({ success: true, event_type: eventType, doc_token: docToken }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
});
