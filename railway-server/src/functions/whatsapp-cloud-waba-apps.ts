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
 *  - users       : lista os usuários atribuídos e as TASKS de cada um
 *  - assign_user : grava as tasks de um usuário na WABA
 *
 * Sobre as tasks: `MANAGE` dá administração (ler contas, números, templates) e
 * `DEVELOP` é a que autoriza ENVIAR pela API. "Acesso total" na tela de ativos
 * grava só MANAGE — daí gestão funcionar e envio devolver (#200).
 *
 * `subscribe` é aditivo: uma WABA aceita vários Apps inscritos e a inscrição de
 * terceiros não é removida. Efeito colateral a considerar antes de rodar: o
 * inbound daquela WABA passa a chegar TAMBÉM no nosso webhook.
 */

import { RequestHandler } from 'express';

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
// Token de ADMIN humano, opcional e temporario. Conceder DEVELOP e escalada de
// privilegio: a Meta responde 403 quando o proprio System User tenta se elevar.
// Usado EXCLUSIVAMENTE em assign_user - nunca para enviar, listar ou inscrever.
// Deve ser removido do Railway assim que a atribuicao estiver feita.
const ADMIN_TOKEN = process.env.META_ADMIN_TOKEN || '';
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

    const business = String(body.business_id || '1511538834012071');
    const usersUrl = `${GRAPH}/${API_VERSION}/${wabaId}/assigned_users?business=${business}&fields=id,name,tasks&limit=50`;
    const listUsers = async () => {
      const r = await fetch(usersUrl, { headers: auth });
      const out: any = await r.json();
      if (out?.error) return { error: out.error.message, code: out.error.code };
      return (out?.data || []).map((u: any) => ({ id: u.id, name: u.name, tasks: u.tasks }));
    };

    if (action === 'users') {
      res.status(200).json({ success: true, action, waba_id: wabaId, users: await listUsers() });
      return;
    }

    if (action === 'assign_user') {
      const user = String(body.user || '').trim();
      const tasks: string[] = Array.isArray(body.tasks) ? body.tasks : ['MANAGE', 'DEVELOP'];
      if (!user) {
        res.status(400).json({ success: false, error: 'user obrigatório (id do system user)' });
        return;
      }
      const before = await listUsers();
      const params = new URLSearchParams({ user, tasks: JSON.stringify(tasks) });
      // So aqui o ADMIN_TOKEN entra, e so se existir.
      const writeToken = ADMIN_TOKEN || TOKEN;
      const r = await fetch(`${GRAPH}/${API_VERSION}/${wabaId}/assigned_users?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${writeToken}` },
      });
      const out: any = await r.json();
      const after = await listUsers();
      res.status(200).json({
        success: r.status < 400 && !out?.error,
        action,
        waba_id: wabaId,
        user,
        tasks,
        graph_status: r.status,
        graph: out,
        // Qual token assinou a escrita, sem revelar nenhum dos dois.
        usou_admin_token: Boolean(ADMIN_TOKEN),
        users_antes: before,
        users_depois: after,
      });
      return;
    }

    res.status(400).json({ success: false, error: `ação desconhecida: ${action}` });
  } catch (err) {
    res.status(200).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
};
