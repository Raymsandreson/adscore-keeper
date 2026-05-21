// Disparo automático quando uma etiqueta-gatilho é aplicada no WhatsApp.
//
// Fluxo NOVO (auto-envio via ZapSign API):
// 1. Busca template no ZapSign (via Cloud zapsign-api action=get_template) p/ saber os campos.
// 2. Lê últimas 50 mensagens da conversa (whatsapp_messages no Externo).
// 3. Chama zapsign-api action=extract_data → recebe [{de, para}] já mapeado p/ os campos do template.
// 4. Se vier ao menos 1 campo preenchido:
//    a. Cria o documento na ZapSign via zapsign-api action=create_doc com signer_has_incomplete_fields=true.
//       O signatário vê o form pré-preenchido na própria ZapSign e completa/corrige o que faltar antes de assinar.
//    b. Envia o link de assinatura pelo WhatsApp (UazAPI /send/text) automaticamente.
//    c. Grava em pending_label_documents com status='auto_generated' + sign_url + doc_token + whatsapp_sent_at.
// 5. Se extração falhar/vier vazia → grava status='pending' (fallback p/ revisão manual via extensão).
//
// Body: { chatId, phone, instance, labelName, templateId, triggerId, createdBy? }
// Retorno HTTP 200 sempre: { success, pending_id?, auto_generated?, sign_url?, error? }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

function normalizeInstance(name: string): string {
  return String(name || '').trim();
}
function normalizePhone(p: string): string {
  return String(p || '').replace(/\D/g, '');
}

async function callZapSign(action: string, body: Record<string, any>): Promise<any> {
  const r = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/zapsign-api`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLOUD_ANON_KEY}`,
      apikey: CLOUD_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  return await r.json().catch(() => ({}));
}

async function fetchRecentMessages(phone: string, instance: string, limit = 50): Promise<any[]> {
  const { data } = await ext
    .from('whatsapp_messages')
    .select('direction, message_text, media_url, media_type, message_type, created_at, transcription')
    .eq('phone', phone)
    .ilike('instance_name', instance)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function fetchRecentMediaUrls(phone: string, instance: string, limit = 20): Promise<any[]> {
  const { data } = await ext
    .from('whatsapp_messages')
    .select('id, media_url, media_type, message_type, created_at, message_text')
    .eq('phone', phone)
    .ilike('instance_name', instance)
    .not('media_url', 'is', null)
    .in('message_type', ['image', 'document', 'audio'])
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).map((m: any) => ({
    id: m.id,
    url: m.media_url,
    type: m.media_type || m.message_type,
    caption: m.message_text || null,
    created_at: m.created_at,
  }));
}

async function fetchContactAndLead(phone: string): Promise<{ contact: any; lead: any; signerName: string }> {
  const { data: contact } = await ext
    .from('contacts')
    .select('id, full_name, phone, email, cpf, street, neighborhood, city, state, cep, profession')
    .eq('phone', phone)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  let lead: any = null;
  if (contact?.id) {
    const { data: lc } = await ext
      .from('leads')
      .select('id, lead_name, phone, email, cpf')
      .eq('contact_id', contact.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = lc;
  }
  const signerName = lead?.lead_name || contact?.full_name || `Cliente ${phone.slice(-4)}`;
  return { contact, lead, signerName };
}

async function getInstanceCreds(instance: string): Promise<{ token?: string; baseUrl?: string }> {
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
  if (!creds.token || !creds.baseUrl) {
    console.warn('[prepare-label-document-trigger] no creds for instance', instance);
    return false;
  }
  try {
    const r = await fetch(`${creds.baseUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: creds.token },
      body: JSON.stringify({ number: phone, text }),
    });
    return r.ok;
  } catch (e: any) {
    console.error('[prepare-label-document-trigger] send-text error:', e?.message);
    return false;
  }
}

function countFilled(extracted: any[]): number {
  if (!Array.isArray(extracted)) return 0;
  return extracted.filter((f) => f?.para && String(f.para).trim() !== '').length;
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { chatId, phone, instance, labelName, templateId, triggerId, createdBy } = (req.body || {}) as any;
    if (!chatId || !phone || !instance || !labelName) {
      return res.json({ success: false, error: 'chatId, phone, instance, labelName são obrigatórios' });
    }

    const normPhone = normalizePhone(phone);
    const normInstance = normalizeInstance(instance);

    // Anti-duplicação: já existe pending/auto_generated recente?
    const { data: existing } = await ext
      .from('pending_label_documents')
      .select('id, status, sign_url')
      .eq('chat_id', chatId)
      .ilike('label_name', labelName)
      .ilike('instance_name', normInstance)
      .in('status', ['pending', 'auto_generated'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log('[prepare-label-document-trigger] already exists:', existing.id, existing.status);
      return res.json({ success: true, pending_id: existing.id, reused: true, status: existing.status });
    }

    // Coleta contexto
    const [messages, mediaUrls, ctx] = await Promise.all([
      fetchRecentMessages(normPhone, normInstance, 50),
      fetchRecentMediaUrls(normPhone, normInstance, 20),
      fetchContactAndLead(normPhone),
    ]);

    let extractedArr: any[] = [];
    let templateFields: any[] = [];
    let signerTemplate: any = null;

    // 1. Busca campos do template (se templateId existir)
    if (templateId) {
      try {
        const tmpl = await callZapSign('get_template', { template_token: templateId });
        if (tmpl?.success) {
          templateFields = tmpl.fields || [];
          signerTemplate = tmpl.signer_template || null;
        } else {
          console.warn('[prepare-label-document-trigger] get_template falhou:', tmpl?.error);
        }
      } catch (e: any) {
        console.warn('[prepare-label-document-trigger] get_template exception:', e?.message);
      }
    }

    // 2. Extrai dados via IA usando template_fields
    if (templateFields.length > 0) {
      try {
        const extractRes = await callZapSign('extract_data', {
          messages,
          template_fields: templateFields,
          lead_data: ctx.lead || {},
          contact_data: ctx.contact || {},
          uploaded_documents: [],
        });
        if (extractRes?.success) {
          extractedArr = extractRes.extracted_data || [];
        }
      } catch (e: any) {
        console.warn('[prepare-label-document-trigger] extract_data exception:', e?.message);
      }
    }

    const filledCount = countFilled(extractedArr);
    console.log(`[prepare-label-document-trigger] extracted ${filledCount}/${templateFields.length} fields`);

    // 3. Conta mensagens p/ stats
    const { count: msgCount } = await ext
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', normPhone)
      .ilike('instance_name', normInstance);

    // 4. Decide: auto-gera ou cai no fallback
    const shouldAutoGenerate = templateId && filledCount > 0;

    if (shouldAutoGenerate) {
      try {
        // 4a. Cria documento na ZapSign já pré-preenchido
        const signerPhone55 = normPhone.startsWith('55') ? normPhone : `55${normPhone}`;
        const createRes = await callZapSign('create_doc', {
          template_id: templateId,
          signer_name: ctx.signerName,
          signer_email: ctx.contact?.email || ctx.lead?.email || undefined,
          signer_phone: signerPhone55,
          data: extractedArr,
          document_name: `${labelName} - ${ctx.signerName}`,
          lead_id: ctx.lead?.id || null,
          contact_id: ctx.contact?.id || null,
          created_by: createdBy || null,
          instance_name: normInstance,
          send_via_whatsapp: true,
          whatsapp_phone: signerPhone55,
          // CRÍTICO: faz o ZapSign mostrar o formulário pro signatário completar/corrigir
          signer_has_incomplete_fields: true,
        });

        if (!createRes?.success) {
          throw new Error(createRes?.error || 'create_doc retornou erro');
        }

        const signUrl: string | null = createRes.sign_url || null;
        const docToken: string | null = createRes.document?.token || null;

        // 4b. Envia link pelo WhatsApp
        let wasSent = false;
        if (signUrl) {
          const msg = `Olá! 👋\n\nPreparei o documento *${labelName}* pra você. Os dados que conversamos já estão pré-preenchidos — só preciso que confira, complete o que faltar e assine:\n\n${signUrl}\n\nQualquer dúvida, é só chamar aqui. 🙏`;
          wasSent = await sendWhatsAppText(normInstance, normPhone, msg);
        }

        // 4c. Grava registro auto_generated
        const { data: inserted, error: insErr } = await ext
          .from('pending_label_documents')
          .insert({
            chat_id: chatId,
            phone: normPhone,
            instance_name: normInstance,
            contact_name: ctx.signerName,
            label_name: labelName,
            zapsign_template_id: templateId || null,
            trigger_id: triggerId || null,
            extracted_fields: { fields: extractedArr, filled_count: filledCount },
            extracted_documents: mediaUrls,
            message_count: msgCount || 0,
            status: 'auto_generated',
            sign_url: signUrl,
            zapsign_document_token: docToken,
            whatsapp_sent_at: wasSent ? new Date().toISOString() : null,
            triggered_by_user_id: createdBy || null,
          })
          .select('id')
          .single();

        if (insErr) console.warn('[prepare-label-document-trigger] insert auto_generated falhou:', insErr.message);

        return res.json({
          success: true,
          auto_generated: true,
          pending_id: inserted?.id || null,
          sign_url: signUrl,
          doc_token: docToken,
          whatsapp_sent: wasSent,
          filled_count: filledCount,
        });
      } catch (autoErr: any) {
        console.error('[prepare-label-document-trigger] auto-generate falhou, caindo pra pending:', autoErr?.message);
        // segue pro fallback abaixo
      }
    }

    // 5. Fallback: grava como pending (extensão Chrome assume a revisão)
    const { data: inserted, error: insErr } = await ext
      .from('pending_label_documents')
      .insert({
        chat_id: chatId,
        phone: normPhone,
        instance_name: normInstance,
        contact_name: ctx.signerName,
        label_name: labelName,
        zapsign_template_id: templateId || null,
        trigger_id: triggerId || null,
        extracted_fields: { fields: extractedArr, filled_count: filledCount },
        extracted_documents: mediaUrls,
        message_count: msgCount || 0,
        status: 'pending',
        triggered_by_user_id: createdBy || null,
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[prepare-label-document-trigger] insert pending falhou:', insErr);
      return res.json({ success: false, error: insErr.message });
    }

    return res.json({
      success: true,
      auto_generated: false,
      pending_id: inserted!.id,
      filled_count: filledCount,
      reason: templateId ? 'extracao_vazia' : 'sem_template_id',
    });
  } catch (err: any) {
    console.error('[prepare-label-document-trigger] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
