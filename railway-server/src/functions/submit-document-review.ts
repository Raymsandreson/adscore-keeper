// Operador confirmou revisão → cria documento ZapSign + envia link pro cliente.
// Body: { review_token, fields: [{de, para}], reviewed_by_user_id?, action: 'send'|'discard' }
// Retorno HTTP 200: { success, sign_url?, error? }
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

async function getInstanceCreds(instance: string) {
  const { data } = await ext
    .from('whatsapp_instances')
    .select('instance_token, base_url')
    .ilike('instance_name', instance)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return { token: data?.instance_token, baseUrl: data?.base_url };
}

async function sendWhatsAppText(instance: string, phone: string, text: string): Promise<boolean> {
  const creds = await getInstanceCreds(instance);
  if (!creds.token || !creds.baseUrl) return false;
  try {
    const r = await fetch(`${creds.baseUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: creds.token },
      body: JSON.stringify({ number: phone, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function normPhone(p: string): string {
  return String(p || '').replace(/\D/g, '');
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { review_token, fields, action, reviewed_by_user_id } = (req.body || {}) as any;
    if (!review_token) return res.json({ success: false, error: 'review_token obrigatório' });

    const { data: pending } = await ext
      .from('pending_label_documents')
      .select('*')
      .eq('review_token', review_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (!pending) return res.json({ success: false, error: 'token inválido' });
    if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
      return res.json({ success: false, error: 'expirado' });
    }
    if (pending.status === 'sent_after_review') {
      return res.json({ success: false, error: 'já enviado', sign_url: pending.sign_url });
    }

    // Descartar
    if (action === 'discard') {
      await ext
        .from('pending_label_documents')
        .update({
          status: 'discarded',
          deleted_at: new Date().toISOString(),
          reviewed_by_user_id: reviewed_by_user_id || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', pending.id);
      return res.json({ success: true, discarded: true });
    }

    // Enviar
    const cleanFields: Array<{ de: string; para: string }> = Array.isArray(fields)
      ? fields
          .filter((f: any) => f?.de)
          .map((f: any) => ({ de: String(f.de), para: String(f.para ?? '').trim() }))
      : [];

    const phone = normPhone(pending.phone);
    const signerPhone55 = phone.startsWith('55') ? phone : `55${phone}`;

    const createRes = await callZapSign('create_doc', {
      template_id: pending.zapsign_template_id,
      signer_name: pending.contact_name,
      signer_phone: signerPhone55,
      data: cleanFields,
      document_name: `${pending.label_name} - ${pending.contact_name}`,
      instance_name: pending.instance_name,
      send_via_whatsapp: true,
      whatsapp_phone: signerPhone55,
      signer_has_incomplete_fields: true,
    });

    if (!createRes?.success) {
      return res.json({ success: false, error: createRes?.error || 'create_doc falhou' });
    }

    const signUrl: string | null = createRes.sign_url || null;
    const docToken: string | null = createRes.document?.token || null;

    // Envia link pro cliente
    let wasSent = false;
    if (signUrl) {
      const msg = `Olá! 👋\n\nPreparei o documento *${pending.label_name}* pra você. Confira, complete e assine:\n\n${signUrl}\n\nQualquer dúvida, é só chamar. 🙏`;
      wasSent = await sendWhatsAppText(pending.instance_name, phone, msg);
    }

    await ext
      .from('pending_label_documents')
      .update({
        status: 'sent_after_review',
        sign_url: signUrl,
        zapsign_document_token: docToken,
        whatsapp_sent_at: wasSent ? new Date().toISOString() : null,
        reviewed_by_user_id: reviewed_by_user_id || null,
        reviewed_at: new Date().toISOString(),
        extracted_fields: { ...(pending.extracted_fields || {}), final_fields: cleanFields },
      })
      .eq('id', pending.id);

    return res.json({
      success: true,
      sign_url: signUrl,
      whatsapp_sent_to_client: wasSent,
    });
  } catch (err: any) {
    console.error('[submit-document-review] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
