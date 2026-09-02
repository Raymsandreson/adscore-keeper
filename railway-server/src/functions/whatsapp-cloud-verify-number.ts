/**
 * whatsapp-cloud-verify-number — revalidação de número na WhatsApp Cloud API.
 *
 * Existe porque `code_verification_status` volta EXPIRED e a única forma de
 * consertar é o par request_code → verify_code da Graph API. O código de 6
 * dígitos é enviado pela Meta ao CHIP FÍSICO do número, não pra cá — quem tem o
 * chip digita o código e devolve pela action `verify_code`.
 *
 * Ações:
 *  - status       : lê a situação atual do número (não muda nada)
 *  - request_code : pede à Meta que dispare o código (SMS ou VOICE)
 *  - verify_code  : confirma o código de 6 dígitos
 *  - register     : registra na Cloud API (exige PIN de 6 dígitos da verificação
 *                   em duas etapas). É o passo que faz `platform_type` sair de
 *                   NOT_APPLICABLE para CLOUD_API — antes disso o número existe
 *                   na WABA e não envia, não recebe e nem aceita foto de perfil.
 *  - deregister   : desfaz o register. É a rota de volta, e existe por isso.
 *
 * ATENÇÃO ao registrar: o número sai do aplicativo WhatsApp Business do celular.
 * Rodar nos dois ao mesmo tempo exige Coexistence, que a Meta só oferece a
 * Solution Partner/Tech Provider via Embedded Signup — não a integração direta
 * como a nossa. Confirmar que ninguém usa o chip no app ANTES de registrar.
 *
 * O PIN nunca é logado nem devolvido na resposta. Guardar fora daqui: sem ele,
 * reregistrar o número depois vira chamado com a Meta.
 */

import { RequestHandler } from 'express';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';

const FIELDS = 'display_phone_number,verified_name,code_verification_status,quality_rating,platform_type';

export const handler: RequestHandler = async (req, res) => {
  if (!TOKEN) {
    res.status(200).json({ success: false, error: 'WHATSAPP_CLOUD_TOKEN ausente no Railway' });
    return;
  }

  const body = req.body || {};
  const action: string = body.action || 'status';
  const phoneNumberId: string = String(body.phone_number_id || '').trim();

  if (!phoneNumberId) {
    res.status(400).json({ success: false, error: 'phone_number_id obrigatório' });
    return;
  }

  const auth = { Authorization: `Bearer ${TOKEN}` };

  // Situação atual — serve de baseline antes de mexer e de verificação depois.
  const readStatus = async () => {
    const r = await fetch(`${GRAPH}/${API_VERSION}/${phoneNumberId}?fields=${FIELDS}`, { headers: auth });
    return { http: r.status, body: await r.json() };
  };

  try {
    if (action === 'status') {
      const cur = await readStatus();
      res.status(200).json({ success: cur.http < 400, action, number: cur.body });
      return;
    }

    if (action === 'request_code') {
      // code_method: SMS (padrão) ou VOICE. language no formato pt_BR.
      const method = String(body.code_method || 'SMS').toUpperCase();
      const language = String(body.language || 'pt_BR');
      const params = new URLSearchParams({ code_method: method, language });
      const r = await fetch(`${GRAPH}/${API_VERSION}/${phoneNumberId}/request_code`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const out: any = await r.json();
      res.status(200).json({
        success: r.status < 400 && !out?.error,
        action,
        code_method: method,
        graph_status: r.status,
        graph: out,
        nota: 'O código vai para o chip físico do número, não para esta resposta.',
      });
      return;
    }

    if (action === 'verify_code') {
      const code = String(body.code || '').trim();
      if (!code) {
        res.status(400).json({ success: false, error: 'code obrigatório (6 dígitos recebidos no chip)' });
        return;
      }
      const r = await fetch(`${GRAPH}/${API_VERSION}/${phoneNumberId}/verify_code`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code }).toString(),
      });
      const out: any = await r.json();
      // Relê o número: só o code_verification_status confirma que pegou.
      const cur = await readStatus();
      res.status(200).json({
        success: r.status < 400 && !out?.error,
        action,
        graph_status: r.status,
        graph: out,
        number: cur.body,
      });
      return;
    }

    if (action === 'register' || action === 'deregister') {
      const corpo: Record<string, string> = { messaging_product: 'whatsapp' };
      if (action === 'register') {
        const pin = String(body.pin || '').trim();
        if (!/^\d{6}$/.test(pin)) {
          res.status(400).json({ success: false, error: 'pin obrigatório: exatamente 6 dígitos' });
          return;
        }
        corpo.pin = pin;
      }

      const antes = await readStatus();
      const r = await fetch(`${GRAPH}/${API_VERSION}/${phoneNumberId}/${action}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const out: any = await r.json();
      // A resposta é só {success:true}: quem prova é o platform_type na releitura.
      const depois = await readStatus();
      res.status(200).json({
        success: r.status < 400 && !out?.error,
        action,
        graph_status: r.status,
        graph: out,
        platform_type_antes: (antes.body as any)?.platform_type,
        platform_type_depois: (depois.body as any)?.platform_type,
        number: depois.body,
      });
      return;
    }

    res.status(400).json({ success: false, error: `ação desconhecida: ${action}` });
  } catch (err) {
    res.status(200).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
