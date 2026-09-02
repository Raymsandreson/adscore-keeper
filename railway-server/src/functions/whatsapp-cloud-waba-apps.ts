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
 *  - templates   : lista os templates da WABA e o status de aprovação de cada um
 *  - create_template : cria template (é o único jeito de INICIAR conversa fora da
 *                  janela de 24h — texto livre volta 131047 no recibo)
 *  - users       : lista os usuários atribuídos e as TASKS de cada um
 *  - assign_user : grava as tasks de um usuário na WABA
 *  - phones      : estado completo de cada número da WABA (registro, verificação,
 *                  qualidade, nome) + o perfil de negócio de um número. Só LÊ.
 *  - webhook_status : para cada App, diz se existe callback de webhook, para
 *                  onde ele aponta e quais campos estão assinados. É a única
 *                  forma de responder "o webhook está configurado?" sem
 *                  depender de alguém achar a tela certa no painel da Meta.
 *                  Não exige waba_id (é config de App, não de WABA).
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
// Mesma lista do webhook: um App Secret por App, separados por vírgula.
const APP_SECRETS = (process.env.WHATSAPP_CLOUD_APP_SECRET || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
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

  // webhook_status é config de App, não de WABA: passa antes da exigência de waba_id.
  //
  // Consultar /{app-id}/subscriptions exige app access token (`app_id|app_secret`).
  // Como efeito, provar qual secret abre qual App separa App Secret de Token de
  // Cliente — os dois são 32 hex e o diagnóstico de tamanho não distingue um do
  // outro. O valor do secret NUNCA sai daqui: só o índice dele na lista.
  if (action === 'webhook_status') {
    const appIds: string[] = Array.isArray(body.app_ids) && body.app_ids.length
      ? body.app_ids.map(String)
      : ['1921976208531040', '1356890262959552'];

    const apps: any[] = [];
    for (const appId of appIds) {
      let casou = false;
      for (let i = 0; i < APP_SECRETS.length; i++) {
        const r = await fetch(
          `${GRAPH}/${API_VERSION}/${appId}/subscriptions?access_token=${encodeURIComponent(`${appId}|${APP_SECRETS[i]}`)}`,
        );
        const out: any = await r.json();
        if (out?.error) continue;
        casou = true;
        apps.push({
          app_id: appId,
          secret_indice: i,
          assinaturas: (out?.data || []).map((sub: any) => ({
            objeto: sub.object,
            callback_url: sub.callback_url,
            ativo: sub.active,
            campos: (sub.fields || []).map((f: any) => f.name),
          })),
        });
        break;
      }
      if (!casou) {
        apps.push({
          app_id: appId,
          secret_indice: null,
          erro: 'nenhum secret da lista abre este App (secret errado, ou é Token de Cliente)',
        });
      }
    }

    res.status(200).json({ success: true, action, secrets_na_lista: APP_SECRETS.length, apps });
    return;
  }

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

    // Só leitura. `platform_type` é o campo que diz se o número está de fato
    // registrado na Cloud API: NOT_APPLICABLE = existe na WABA mas não envia.
    if (action === 'phones') {
      const campos = [
        'id', 'display_phone_number', 'verified_name', 'name_status',
        'code_verification_status', 'quality_rating', 'platform_type',
        'status', 'messaging_limit_tier', 'is_official_business_account',
      ].join(',');
      const r = await fetch(`${GRAPH}/${API_VERSION}/${wabaId}/phone_numbers?fields=${campos}`, { headers: auth });
      const out: any = await r.json();
      if (out?.error) {
        res.status(200).json({ success: false, error: out.error.message, code: out.error.code });
        return;
      }
      const numeros = out?.data || [];

      // Perfil de negócio é por número, não por WABA — busca um a um.
      const perfis: Record<string, unknown> = {};
      for (const n of numeros) {
        const pr = await fetch(
          `${GRAPH}/${API_VERSION}/${n.id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
          { headers: auth },
        );
        const pj: any = await pr.json();
        perfis[n.id] = pj?.error ? { erro: pj.error.message } : (pj?.data || [])[0] || null;
      }

      res.status(200).json({ success: true, action, waba_id: wabaId, numeros, perfis });
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

    if (action === 'templates') {
      // So template APPROVED pode ser enviado. Fora da janela de 24h e o unico
      // caminho — texto livre volta 131047 no recibo de entrega.
      const r = await fetch(
        `${GRAPH}/${API_VERSION}/${wabaId}/message_templates?fields=name,status,language,category,components&limit=100`,
        { headers: auth },
      );
      const out: any = await r.json();
      if (out?.error) {
        res.status(200).json({ success: false, action, error: out.error.message, code: out.error.code });
        return;
      }
      res.status(200).json({
        success: true,
        action,
        waba_id: wabaId,
        templates: (out?.data || []).map((t: any) => ({
          name: t.name,
          status: t.status,
          language: t.language,
          category: t.category,
          // quantos {{n}} o corpo espera — e o tamanho de template_params no envio
          body_params: (((t.components || []).find((c: any) => c.type === 'BODY')?.text || '')
            .match(/\{\{\d+\}\}/g) || []).length,
        })),
      });
      return;
    }

    if (action === 'create_template') {
      // POST /{waba_id}/message_templates. A Meta valida nome (minusculo+underline),
      // idioma, categoria e — quando o corpo tem {{n}} — exige `example` com um
      // valor por variavel, senao rejeita com 100/2388023.
      const name = String(body.name || '').trim();
      const language = String(body.language || 'pt_BR').trim();
      const category = String(body.category || 'UTILITY').trim().toUpperCase();
      const bodyText = String(body.body_text || '').trim();
      const footerText = String(body.footer_text || '').trim();
      const examples: string[] = Array.isArray(body.body_example) ? body.body_example.map(String) : [];

      if (!name || (!bodyText && !Array.isArray(body.components))) {
        res.status(400).json({ success: false, error: 'name e body_text obrigatórios' });
        return;
      }
      if (!/^[a-z0-9_]+$/.test(name)) {
        res.status(400).json({ success: false, error: `nome inválido: "${name}" — só minúsculas, dígitos e _` });
        return;
      }

      const varCount = (bodyText.match(/\{\{\d+\}\}/g) || []).length;
      if (!Array.isArray(body.components) && varCount !== examples.length) {
        res.status(400).json({
          success: false,
          error: `corpo tem ${varCount} variável(is) mas vieram ${examples.length} exemplo(s) — a Meta rejeita`,
        });
        return;
      }

      // Idempotencia: a Graph devolve erro opaco quando o par nome+idioma ja existe.
      const existentes = await fetch(
        `${GRAPH}/${API_VERSION}/${wabaId}/message_templates?fields=name,language,status&limit=200`,
        { headers: auth },
      ).then((r) => r.json() as any).catch(() => null);
      const jaExiste = (existentes?.data || []).find(
        (t: any) => t.name === name && t.language === language,
      );
      if (jaExiste) {
        res.status(200).json({
          success: true,
          action,
          ja_existia: true,
          template: { name: jaExiste.name, language: jaExiste.language, status: jaExiste.status },
        });
        return;
      }

      const components = Array.isArray(body.components)
        ? body.components
        : [
            {
              type: 'BODY',
              text: bodyText,
              ...(examples.length ? { example: { body_text: [examples] } } : {}),
            },
            ...(footerText ? [{ type: 'FOOTER', text: footerText }] : []),
          ];

      const payload: Record<string, unknown> = {
        name,
        language,
        category,
        components,
        // Deixa a Meta reclassificar em vez de REJEITAR quando discorda da
        // categoria. A categoria que valeu volta na resposta — sem isso, a
        // recusa vira um erro sem recurso.
        allow_category_change: body.allow_category_change !== false,
      };

      const r = await fetch(`${GRAPH}/${API_VERSION}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const out: any = await r.json();
      res.status(200).json({
        success: r.status < 400 && !out?.error,
        action,
        waba_id: wabaId,
        enviado: { name, language, category, variaveis: varCount, tem_rodape: Boolean(footerText) },
        graph_status: r.status,
        graph: out,
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
