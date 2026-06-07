/**
 * check-whatsapp-cloud-token — verifica saúde do WHATSAPP_CLOUD_TOKEN antes de envios.
 *
 * Estratégia: chama Graph API /debug_token (auto-introspecção) + /{phone_number_id}
 * pra confirmar acesso ao número configurado. Retorna 200 sempre, com payload
 * de status (igual à política de edge function do projeto).
 *
 * Retornos possíveis em `status`:
 *  - 'valid'           — token ok, expira em N segundos (ou nunca p/ system user)
 *  - 'expired'         — token expirou (graph_code 190 / data_access_expired)
 *  - 'invalid'         — token malformado/revogado
 *  - 'missing'         — WHATSAPP_CLOUD_TOKEN ausente no Railway
 *  - 'no_config'       — sem phone_number_id ativo em whatsapp_cloud_config
 *  - 'graph_error'     — erro genérico Graph (devolve message/code)
 *  - 'unreachable'     — fetch falhou
 */

import { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';

export const handler: RequestHandler = async (_req, res) => {
  if (!TOKEN) {
    return res.status(200).json({
      success: false,
      status: 'missing',
      message: 'WHATSAPP_CLOUD_TOKEN ausente no Railway',
    });
  }

  // 1) Lookup phone_number_id ativo
  let phoneNumberId: string | null = null;
  let displayPhone: string | null = null;
  try {
    const { data: cfg } = await supabase
      .from('whatsapp_cloud_config')
      .select('phone_number_id, display_phone, display_name, waba_id')
      .eq('is_active', true)
      .maybeSingle();
    phoneNumberId = (cfg as any)?.phone_number_id || null;
    displayPhone = (cfg as any)?.display_phone || null;
  } catch (e) {
    // segue mesmo sem config — checa só o token
  }

  // 2) debug_token (self-introspect)
  let debug: any = null;
  let debugHttp = 0;
  try {
    const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`;
    const r = await fetch(url);
    debugHttp = r.status;
    debug = await r.json();
  } catch (err) {
    return res.status(200).json({
      success: false,
      status: 'unreachable',
      message: 'Graph API indisponível',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const dataNode = debug?.data;
  const errNode = debug?.error || dataNode?.error;
  const graphCode = errNode?.code ?? dataNode?.error?.code;

  // Token inválido/expirado
  if (errNode || dataNode?.is_valid === false) {
    const subcode = errNode?.error_subcode ?? dataNode?.error?.subcode;
    const isExpired = graphCode === 190 && (
      subcode === 463 || subcode === 467 ||
      /expired/i.test(errNode?.message || dataNode?.error?.message || '')
    );
    return res.status(200).json({
      success: false,
      status: isExpired ? 'expired' : (graphCode === 190 ? 'invalid' : 'graph_error'),
      message: errNode?.message || dataNode?.error?.message || 'Token inválido',
      graph_code: graphCode,
      graph_subcode: subcode,
      http_status: debugHttp,
    });
  }

  // Calcula vencimento
  const expiresAt: number | null = dataNode?.expires_at ?? dataNode?.data_access_expires_at ?? null;
  const nowSec = Math.floor(Date.now() / 1000);
  const secondsLeft = expiresAt && expiresAt > 0 ? expiresAt - nowSec : null;
  const neverExpires = expiresAt === 0 || expiresAt === null;

  // 3) Confere acesso ao phone_number_id (se houver config)
  let phoneCheck: { ok: boolean; error?: string; display_phone?: string } | null = null;
  if (phoneNumberId) {
    try {
      const url = `${GRAPH}/${API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const body: any = await r.json();
      if (r.status >= 400) {
        phoneCheck = { ok: false, error: body?.error?.message || `HTTP ${r.status}` };
      } else {
        phoneCheck = { ok: true, display_phone: body?.display_phone_number };
      }
    } catch (e) {
      phoneCheck = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return res.status(200).json({
    success: true,
    status: 'valid',
    app_id: dataNode?.app_id || null,
    application: dataNode?.application || null,
    type: dataNode?.type || null,
    scopes: dataNode?.scopes || [],
    expires_at: expiresAt,
    seconds_left: secondsLeft,
    never_expires: neverExpires,
    phone_number_id: phoneNumberId,
    display_phone: displayPhone,
    phone_check: phoneCheck,
    checked_at: new Date().toISOString(),
  });
};
