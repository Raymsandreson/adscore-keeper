/**
 * whatsapp-cloud-waba-apps — inscrição de App em WABA (subscribed_apps).
 *
 * Enviar pela Cloud API exige que o App dono do token esteja inscrito na WABA.
 * Quando não está, a Graph devolve `(#200) You do not have the necessary
 * permissions to send messages on behalf of this WhatsApp Business Account` —
 * texto idêntico ao de falta de permissão, o que torna os dois indistinguíveis
 * sem consultar subscribed_apps.
 *
 * Ações:
 *  - list        : lista os Apps inscritos na WABA (não muda nada)
 *  - subscribe   : inscreve o App do token na WABA
 *  - unsubscribe : desfaz — é o rollback do subscribe
 *
 * `subscribe` é aditivo: uma WABA aceita vários Apps inscritos e a inscrição de
 * terceiros não é removida. Efeito colateral a considerar antes de rodar: o
 * inbound daquela WABA passa a chegar TAMBÉM no nosso webhook.
 */

import { RequestHandler } from 'express';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';

export const handler: RequestHandler = async (req, res) => {
  if (!TOKEN) {
    res.status(200).json({ success: false, error: 'WHATSAPP_CLOUD_TOKEN ausente no Railway' });
    return;
  }

  const body = req.body || {};
  const action: string = body.action || 'list';
  const wabaId: string = String(body.waba_id || '').trim();

  if (!wabaId) {
    res.status(400).json({ success: false, error: 'waba_id obrigatório' });
    return;
  }

  const auth = { Authorization: `Bearer ${TOKEN}` };
  const url = `${GRAPH}/${API_VERSION}/${wabaId}/subscribed_apps`;

  // Lista sempre: serve de baseline antes e de confirmação depois. A resposta do
  // POST é só {success:true} — só a releitura prova que o App entrou.
  const listApps = async () => {
    const r = await fetch(url, { headers: auth });
    const out: any = await r.json();
    if (out?.error) return { error: out.error.message, code: out.error.code };
    return (out?.data || []).map((a: any) => {
      const w = a.whatsapp_business_api_data || a;
      return { id: w.id, name: w.name };
    });
  };

  try {
    if (action === 'list') {
      res.status(200).json({ success: true, action, waba_id: wabaId, apps: await listApps() });
      return;
    }

    if (action === 'subscribe' || action === 'unsubscribe') {
      const before = await listApps();
      const r = await fetch(url, { method: action === 'subscribe' ? 'POST' : 'DELETE', headers: auth });
      const out: any = await r.json();
      const after = await listApps();
      res.status(200).json({
        success: r.status < 400 && !out?.error,
        action,
        waba_id: wabaId,
        graph_status: r.status,
        graph: out,
        apps_antes: before,
        apps_depois: after,
      });
      return;
    }

    res.status(400).json({ success: false, error: `ação desconhecida: ${action}` });
  } catch (err) {
    res.status(200).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};
