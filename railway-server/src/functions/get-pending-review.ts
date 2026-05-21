// GET dados do pending pra página pública de revisão.
// Body: { review_token }
// Retorno: { success, pending: {...}, template_fields: [...] }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || process.env.SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

async function callZapSign(action: string, body: Record<string, any>): Promise<any> {
  const r = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/zapsign-api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLOUD_ANON_KEY}`, apikey: CLOUD_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return await r.json().catch(() => ({}));
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const token = (req.body?.review_token || req.query?.review_token || '').toString().trim();
    if (!token) return res.json({ success: false, error: 'review_token obrigatório' });

    const { data: pending, error } = await ext
      .from('pending_label_documents')
      .select('*')
      .eq('review_token', token)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !pending) return res.json({ success: false, error: 'token inválido ou expirado' });

    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
      return res.json({ success: false, error: 'expirado', expired: true });
    }

    if (pending.status === 'sent_after_review') {
      return res.json({ success: false, error: 'já enviado', already_sent: true, sign_url: pending.sign_url });
    }

    if (pending.status === 'discarded') {
      return res.json({ success: false, error: 'descartado' });
    }

    let templateFields: any[] = [];
    if (pending.zapsign_template_id) {
      try {
        const tmpl = await callZapSign('get_template', { template_token: pending.zapsign_template_id });
        if (tmpl?.success) templateFields = tmpl.fields || [];
      } catch {}
    }

    return res.json({
      success: true,
      pending: {
        id: pending.id,
        contact_name: pending.contact_name,
        phone: pending.phone,
        instance_name: pending.instance_name,
        label_name: pending.label_name,
        status: pending.status,
        extracted_fields: pending.extracted_fields,
        extracted_documents: pending.extracted_documents,
        message_count: pending.message_count,
        expires_at: pending.expires_at,
        created_at: pending.created_at,
        zapsign_template_id: pending.zapsign_template_id,
      },
      template_fields: templateFields,
    });
  } catch (err: any) {
    console.error('[get-pending-review] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
