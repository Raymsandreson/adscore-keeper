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
import { createHash } from 'crypto';
import { supabase } from '../lib/supabase';

// Mesma leitura que o webhook faz — se divergir, o diagnóstico mente.
const SECRETS = (process.env.WHATSAPP_CLOUD_APP_SECRET || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const API_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const GRAPH = 'https://graph.facebook.com';

export const handler: RequestHandler = async (req, res) => {
  if (!TOKEN) {
    return res.status(200).json({
      success: false,
      status: 'missing',
      message: 'WHATSAPP_CLOUD_TOKEN ausente no Railway',
    });
  }

  // 1) Lookup das linhas ativas. maybeSingle() aqui devolvia erro (e config
  // nenhuma) assim que existisse mais de um número — o diagnóstico perdia o
  // número justamente quando havia mais coisa pra diagnosticar.
  let phoneNumberId: string | null = null;
  let displayPhone: string | null = null;
  let linhas: Array<{ instance_name: string | null; phone_number_id: string; display_phone: string | null }> = [];
  try {
    const { data: cfgs } = await supabase
      .from('whatsapp_cloud_config')
      .select('instance_name, phone_number_id, display_phone, display_name, waba_id')
      .eq('is_active', true)
      .order('instance_name');
    linhas = ((cfgs as any[]) || []).map((c) => ({
      instance_name: c.instance_name || null,
      phone_number_id: c.phone_number_id,
      display_phone: c.display_phone || null,
    }));
    phoneNumberId = linhas[0]?.phone_number_id || null;
    displayPhone = linhas[0]?.display_phone || null;
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

  // 4) Sonda opcional de PROPRIEDADE da WABA. `owned_` sao as contas que o
  // portfolio POSSUI; `client_` sao as que so foram COMPARTILHADAS com ele por
  // outra BM. A tela de ativos mostra as duas iguais ("Atribuicao ja feita"),
  // entao so essa chamada separa uma coisa da outra. Exige business_management.
  let businessProbe: any = null;
  const probeBusiness = (req.body || {}).probe_business;
  if (probeBusiness) {
    businessProbe = { business_id: String(probeBusiness) };
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      try {
        const url = `${GRAPH}/${API_VERSION}/${probeBusiness}/${edge}?fields=id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,quality_rating}&limit=100`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const body: any = await r.json();
        businessProbe[edge] = body?.error
          ? { error: body.error.message, code: body.error.code }
          : (body?.data || []).map((w: any) => ({
              id: w.id,
              name: w.name,
              phone_numbers: w.phone_numbers?.data || [],
            }));
      } catch (e) {
        businessProbe[edge] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  // 5) Sonda opcional de uma WABA especifica: quais Apps estao INSCRITOS nela.
  // Enviar pela Cloud API exige que o App do token esteja em subscribed_apps da
  // WABA. Sem isso a Graph responde (#200) igualzinho a falta de permissao.
  let wabaProbe: any = null;
  const probeWaba = (req.body || {}).probe_waba;
  if (probeWaba) {
    // Default: portfolio WhatsJudd. Sobrescrevivel por probe_business no body.
    const probeBusinessForWaba = String((req.body || {}).probe_business || '1511538834012071');
    wabaProbe = { waba_id: String(probeWaba), business_id: probeBusinessForWaba };
    const calls: Record<string, string> = {
      subscribed_apps: `${probeWaba}/subscribed_apps`,
      info: `${probeWaba}?fields=id,name,owner_business_info,on_behalf_of_business_info,account_review_status`,
      // assigned_users devolve as TASKS de cada usuario na WABA. A tela escreve
      // "Acesso total", mas quem alimenta granular_scopes.target_ids e essa lista.
      // `business` e obrigatorio nessa edge (sem ele a Graph devolve (#100)).
      assigned_users: `${probeWaba}/assigned_users?business=${probeBusinessForWaba}&fields=id,name,tasks&limit=50`,
    };
    for (const [key, path] of Object.entries(calls)) {
      try {
        const r = await fetch(`${GRAPH}/${API_VERSION}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const body: any = await r.json();
        wabaProbe[key] = body?.error ? { error: body.error.message, code: body.error.code } : (body?.data ?? body);
      } catch (e) {
        wabaProbe[key] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return res.status(200).json({
    success: true,
    status: 'valid',
    waba_probe: wabaProbe,
    business_probe: businessProbe,
    app_id: dataNode?.app_id || null,
    application: dataNode?.application || null,
    type: dataNode?.type || null,
    // user_id + granular_scopes vêm do /debug_token e são o que distingue UM system
    // user do outro quando dois tokens do mesmo app têm a mesma lista de escopos.
    // `target_ids` do whatsapp_business_messaging diz em NOME DE QUAIS WABAs o token
    // pode enviar — é o que separa um (#200) de permissão de um (#200) de propriedade.
    user_id: dataNode?.user_id || null,
    // issued_at = quando a Meta emitiu ESTE token; token_fingerprint = sha256 dos
    // 12 primeiros hex do token. Nenhum dos dois revela o segredo, e juntos provam
    // se o valor da env var trocou de verdade — o `user_id` sozinho não prova, porque
    // o mesmo system user gerando um token novo repete o user_id.
    issued_at: dataNode?.issued_at ?? null,
    token_fingerprint: createHash('sha256').update(TOKEN).digest('hex').slice(0, 12),
    // App secrets do webhook. Uma WABA por App = um secret por App, e a lista é
    // separada por vírgula. Trocar o valor em vez de somar derruba o inbound da
    // outra WABA com 401 — que a Meta não reporta em lugar nenhum daqui, então
    // sem esta contagem a única forma de descobrir é mensagem que não chega.
    // Só o fingerprint sai: o valor nunca.
    app_secrets: {
      quantos: SECRETS.length,
      fingerprints: SECRETS.map((sec) => createHash('sha256').update(sec).digest('hex').slice(0, 12)),
      // Comprimento ajuda a pegar o erro clássico de colar o App ID no lugar do
      // secret: App Secret da Meta tem 32 caracteres hex.
      tamanhos: SECRETS.map((sec) => sec.length),
      parece_hex32: SECRETS.map((sec) => /^[0-9a-f]{32}$/i.test(sec)),
      verify_token_definido: Boolean(process.env.WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN),
    },
    granular_scopes: (dataNode?.granular_scopes || []).filter(
      (g: any) => typeof g?.scope === 'string' && g.scope.includes('whatsapp'),
    ),
    scopes: dataNode?.scopes || [],
    expires_at: expiresAt,
    seconds_left: secondsLeft,
    never_expires: neverExpires,
    phone_number_id: phoneNumberId,
    display_phone: displayPhone,
    linhas,
    phone_check: phoneCheck,
    checked_at: new Date().toISOString(),
  });
};
