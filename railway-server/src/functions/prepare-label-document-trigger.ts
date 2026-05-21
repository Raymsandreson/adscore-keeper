// Dispara extração de dados quando uma etiqueta-gatilho é aplicada no WhatsApp.
//
// Fluxo:
// 1. Recebe { chatId, phone, instance, labelName, templateId, triggerId, createdBy? }
// 2. Reaproveita a função `extract-conversation-data` (no mesmo processo Railway)
//    para extrair campos estruturados das últimas mensagens já gravadas em
//    `whatsapp_messages` no Externo.
// 3. Coleta últimas N URLs de mídia (imagens/PDFs) pra revisão.
// 4. Grava em `pending_label_documents` (status='pending').
// 5. Notifica via toast no chat interno (best-effort).
//
// Body: { chatId, phone, instance, labelName, templateId, triggerId, createdBy? }
// Retorno HTTP 200 sempre: { success, pending_id?, error? }
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { handler as extractHandler } from './extract-conversation-data';

function normalizeInstance(name: string): string {
  return String(name || '').trim();
}

function normalizePhone(p: string): string {
  return String(p || '').replace(/\D/g, '');
}

// Invoca extract-conversation-data localmente (sem HTTP) reusando o handler.
async function callExtract(phone: string, instance: string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let captured: any = null;
    const fakeReq: any = {
      body: { phone, instance_name: instance, targetType: 'contact' },
      method: 'POST',
    };
    const fakeRes: any = {
      json: (data: any) => { captured = data; return fakeRes; },
      status: () => fakeRes,
      setHeader: () => fakeRes,
    };
    Promise.resolve(extractHandler(fakeReq, fakeRes, () => {}))
      .then(() => resolve(captured?.data || {}))
      .catch((e) => {
        console.warn('[prepare-label-document-trigger] extract failed:', e?.message);
        resolve({});
      });
  });
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

async function notifyInternalChat(payload: {
  instance: string;
  phone: string;
  labelName: string;
  pendingId: string;
  createdBy?: string | null;
}) {
  try {
    // Procura uma conversa "geral" e grava uma mensagem do sistema.
    // Best-effort — se falhar, não bloqueia.
    const { data: conv } = await ext
      .from('team_conversations')
      .select('id')
      .eq('type', 'group')
      .ilike('name', '%Geral%')
      .limit(1)
      .maybeSingle();
    if (!conv?.id) return;
    await ext.from('team_chat_messages').insert({
      conversation_id: conv.id,
      sender_user_id: payload.createdBy || null,
      content: `📄 Procuração pronta pra revisão (etiqueta "${payload.labelName}" no número ${payload.phone} — instância ${payload.instance}). Abra a extensão Chrome ou veja em pendentes.`,
      message_type: 'system',
    });
  } catch (e: any) {
    console.warn('[prepare-label-document-trigger] notify skipped:', e?.message);
  }
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const { chatId, phone, instance, labelName, templateId, triggerId, createdBy } = (req.body || {}) as {
      chatId?: string;
      phone?: string;
      instance?: string;
      labelName?: string;
      templateId?: string;
      triggerId?: string;
      createdBy?: string;
    };

    if (!chatId || !phone || !instance || !labelName) {
      return res.json({ success: false, error: 'chatId, phone, instance, labelName são obrigatórios' });
    }

    const normPhone = normalizePhone(phone);
    const normInstance = normalizeInstance(instance);

    // 1. Anti-duplicação: já existe pending pra esse chat+label?
    const { data: existing } = await ext
      .from('pending_label_documents')
      .select('id, status, created_at')
      .eq('chat_id', chatId)
      .ilike('label_name', labelName)
      .ilike('instance_name', normInstance)
      .eq('status', 'pending')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.log('[prepare-label-document-trigger] already pending:', existing.id);
      return res.json({ success: true, pending_id: existing.id, reused: true });
    }

    // 2. Roda extração via IA (best-effort)
    console.log('[prepare-label-document-trigger] extracting for', { phone: normPhone, instance: normInstance });
    const extracted = await callExtract(normPhone, normInstance);

    // 3. Coleta mídias recentes pra revisão
    const mediaUrls = await fetchRecentMediaUrls(normPhone, normInstance, 20);

    // 4. Conta mensagens
    const { count: msgCount } = await ext
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', normPhone)
      .ilike('instance_name', normInstance);

    // 5. Insere pending
    const { data: inserted, error: insErr } = await ext
      .from('pending_label_documents')
      .insert({
        chat_id: chatId,
        phone: normPhone,
        instance_name: normInstance,
        label_name: labelName,
        template_id: templateId || null,
        trigger_id: triggerId || null,
        extracted_fields: extracted || {},
        media_urls: mediaUrls,
        message_count: msgCount || 0,
        status: 'pending',
        created_by: createdBy || null,
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[prepare-label-document-trigger] insert error:', insErr);
      return res.json({ success: false, error: insErr.message });
    }

    // 6. Notifica (best-effort)
    await notifyInternalChat({
      instance: normInstance,
      phone: normPhone,
      labelName,
      pendingId: inserted!.id,
      createdBy,
    });

    return res.json({
      success: true,
      pending_id: inserted!.id,
      extracted_keys: Object.keys(extracted || {}),
      media_count: mediaUrls.length,
    });
  } catch (err: any) {
    console.error('[prepare-label-document-trigger] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
