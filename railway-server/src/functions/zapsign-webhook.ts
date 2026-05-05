import type { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

// ZapSign webhook → grava raw em zapsign_document_events e atualiza zapsign_documents.
// Sempre retorna 200 (ZapSign não deve reenviar). Raw insert primeiro, update best-effort.

function normPhone(s?: string | null): string {
  return (s || '').replace(/\D/g, '');
}

function pickFirstSigner(signers: any[]): any {
  if (!Array.isArray(signers) || signers.length === 0) return {};
  return signers.find((s) => s?.status === 'signed') || signers[0];
}

function mapEventType(body: any): string {
  const t = body?.event_type || body?.event || body?.type;
  if (typeof t === 'string' && t.trim()) return t.trim();
  if (body?.status === 'signed') return 'doc_signed';
  if (body?.status === 'refused') return 'doc_refused';
  return 'unknown';
}

export const handler = async (req: Request, res: Response) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object') {
    return res.status(200).json({ success: false, error: 'invalid_payload' });
  }

  const eventType = mapEventType(raw);
  const docToken: string | null =
    raw.token || raw.doc_token || raw.open_id_token || raw?.doc?.token || null;
  const signers: any[] = Array.isArray(raw.signers) ? raw.signers : (raw?.doc?.signers || []);
  const signer = raw.signer || pickFirstSigner(signers);
  const signerPhone = normPhone((signer?.phone_country || '') + (signer?.phone_number || ''));

  // 1) lookup document_id (best effort) + INSERT cru
  let documentId: string | null = null;
  if (docToken) {
    const { data: doc } = await supabase
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

  const { error: insErr } = await supabase.from('zapsign_document_events').insert(eventInsert);
  if (insErr) console.error('[zapsign-webhook] event insert error:', insErr.message);

  // 2) UPDATE em zapsign_documents
  if (docToken) {
    const update: any = { updated_at: new Date().toISOString() };

    if (raw.status) update.status = raw.status;
    else if (raw?.doc?.status) update.status = raw.doc.status;

    if (raw.signed_file || raw?.doc?.signed_file) {
      update.signed_file_url = raw.signed_file || raw.doc.signed_file;
    }
    if (raw.original_file || raw?.doc?.original_file) {
      update.original_file_url = raw.original_file || raw.doc.original_file;
    }
    if (raw.name || raw?.doc?.name) {
      update.document_name = raw.name || raw.doc.name;
    }

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
        break;
    }

    if (Array.isArray(signers) && signers.length > 0) {
      const first = pickFirstSigner(signers);
      if (first?.name && !update.signer_name) update.signer_name = first.name;
      if (first?.email && !update.signer_email) update.signer_email = first.email;
      if (first?.token && !update.signer_token) update.signer_token = first.token;
      const fp = normPhone((first?.phone_country || '') + (first?.phone_number || ''));
      if (fp && !update.signer_phone) update.signer_phone = fp;
      if (!update.signer_status) update.signer_status = first?.status || null;
    }

    Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

    if (Object.keys(update).length > 1) {
      const { error: updErr } = await supabase
        .from('zapsign_documents')
        .update(update)
        .eq('doc_token', docToken);
      if (updErr) console.error('[zapsign-webhook] update error:', updErr.message);
    }
  }

  return res.status(200).json({ success: true, event_type: eventType, doc_token: docToken });
};
