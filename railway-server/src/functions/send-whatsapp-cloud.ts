/**
 * send-whatsapp-cloud — envio outbound via WhatsApp Business Cloud API (Meta oficial).
 *
 * Recebe payload do proxy local (supabase/functions/send-whatsapp) quando o canal
 * for `cloud_gerencia`. v1 só suporta `text`. Mídia/template ficam pra v2.
 *
 * Fluxo:
 *  1. Valida WHATSAPP_CLOUD_TOKEN + body (phone, message).
 *  2. Busca phone_number_id do registro ativo em whatsapp_cloud_config.
 *  3. POST Graph API v21.0/{phone_number_id}/messages.
 *  4. Trata erros conhecidos (token, janela 24h, recipient).
 *  5. INSERT outbound em whatsapp_messages com instance_name='cloud_gerencia'.
 *  6. Responde {success, message_id, external_message_id, instance_name}.
 */

import { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';
const INSTANCE_NAME = 'cloud_gerencia';

interface SendBody {
  phone?: string;
  message?: string;
  contact_id?: string | null;
  lead_id?: string | null;
}

function normalizePhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  // Mobile BR sem o 9 (12 díg, 55+DDD+8d, primeiro díg do assinante >= 6).
  // Meta exige E.164 atual (com 9) no envio, mesmo que o wa_id histórico
  // que chega no webhook não tenha. Fixos (assinante 2-5) não levam 9.
  if (d.length === 12 && d.startsWith('55') && d[4] >= '6') {
    return d.slice(0, 4) + '9' + d.slice(4);
  }
  return d;
}

function mapGraphError(code: number | undefined, subcode: number | undefined): string {
  if (code === 190) return 'INVALID_TOKEN';
  if (code === 131047 || subcode === 2018278) return 'OUTSIDE_24H_WINDOW';
  if (code === 131026) return 'RECIPIENT_REFUSED';
  if (code === 131056) return 'RECIPIENT_NOT_VERIFIED';
  if (code === 100) return 'INVALID_PARAMETER';
  return 'GRAPH_ERROR';
}

export const handler: RequestHandler = async (req, res) => {
  const rid = (req.headers['x-request-id'] as string) || 'no-rid';

  if (!TOKEN) {
    console.error(`[send-cloud ${rid}] WHATSAPP_CLOUD_TOKEN ausente no Railway`);
    res.status(500).json({
      success: false,
      error: 'WHATSAPP_CLOUD_TOKEN não configurado no Railway',
      error_code: 'MISSING_TOKEN',
    });
    return;
  }

  const body: SendBody = req.body || {};
  const phone = normalizePhone(body.phone || '');
  const text = (body.message || '').trim();

  if (!phone) {
    res.status(400).json({ success: false, error: 'phone obrigatório', error_code: 'MISSING_PHONE' });
    return;
  }
  if (!text) {
    res.status(400).json({ success: false, error: 'message obrigatório', error_code: 'MISSING_MESSAGE' });
    return;
  }

  // Lookup do phone_number_id ativo
  const { data: cfg, error: cfgErr } = await supabase
    .from('whatsapp_cloud_config')
    .select('phone_number_id')
    .eq('is_active', true)
    .maybeSingle();

  if (cfgErr) {
    console.error(`[send-cloud ${rid}] erro lendo whatsapp_cloud_config:`, cfgErr);
    res.status(500).json({ success: false, error: 'Falha lendo config Cloud', error_code: 'CONFIG_READ_ERROR' });
    return;
  }

  const phoneNumberId = (cfg as any)?.phone_number_id;
  if (!phoneNumberId) {
    console.error(`[send-cloud ${rid}] whatsapp_cloud_config sem registro ativo`);
    res.status(412).json({
      success: false,
      error: 'Cloud API não configurada — salve phone_number_id pela tela WhatsApp Cloud',
      error_code: 'NO_PHONE_NUMBER_ID',
    });
    return;
  }

  // Chamada Graph API
  const url = `${GRAPH}/${API_VERSION}/${phoneNumberId}/messages`;
  console.log(`[send-cloud ${rid}] → Graph to=***${phone.slice(-4)} chars=${text.length} pnid=${phoneNumberId}`);

  let httpStatus = 0;
  let graphResp: any = null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    httpStatus = resp.status;
    graphResp = await resp.json();
  } catch (err) {
    console.error(`[send-cloud ${rid}] fetch falhou:`, err);
    res.status(502).json({ success: false, error: 'Graph API indisponível', error_code: 'GRAPH_UNREACHABLE' });
    return;
  }

  const externalId: string | null = graphResp?.messages?.[0]?.id || null;

  if (httpStatus >= 400 || !externalId) {
    const code = graphResp?.error?.code;
    const subcode = graphResp?.error?.error_subcode;
    const msg = graphResp?.error?.message || `HTTP ${httpStatus}`;
    const mappedCode = mapGraphError(code, subcode);
    console.error(`[send-cloud ${rid}] Graph erro http=${httpStatus} code=${code} sub=${subcode} mapped=${mappedCode}: ${msg}`);
    res.status(httpStatus || 502).json({
      success: false,
      error: msg,
      error_code: mappedCode,
      graph_code: code,
      graph_subcode: subcode,
    });
    return;
  }

  // INSERT outbound em whatsapp_messages
  let dbId: string | null = null;
  try {
    const { data: inserted, error: insErr } = await supabase
      .from('whatsapp_messages')
      .insert({
        phone,
        instance_name: INSTANCE_NAME,
        message_text: text,
        message_type: 'text',
        direction: 'outbound',
        status: 'sent',
        external_message_id: externalId,
        contact_id: body.contact_id || null,
        lead_id: body.lead_id || null,
        action_source: 'cloud_api',
        action_source_detail: 'outbound',
      } as any)
      .select('id')
      .single();
    if (insErr) {
      console.error(`[send-cloud ${rid}] insert falhou (msg JÁ foi enviada via Graph):`, insErr);
    } else {
      dbId = (inserted as any)?.id || null;
    }
  } catch (err) {
    console.error(`[send-cloud ${rid}] insert exceção (msg JÁ foi enviada via Graph):`, err);
  }

  console.log(`[send-cloud ${rid}] OK wamid=...${externalId.slice(-12)} db=${dbId || 'fail'}`);
  res.status(200).json({
    success: true,
    message_id: dbId,
    external_message_id: externalId,
    instance_name: INSTANCE_NAME,
  });
};
