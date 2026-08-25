// send-whatsapp v27 (projeto externo kmedldlepwiityjsdahz)
//
// v27: action `send_menu` — o balão de escolha ("Pode continuar" / "Não tenho
// interesse") via /send/menu da UazAPI, endpoint confirmado por chamada real em
// 25/08/2026. Passa pelo mesmo gate de opt-out da v26. O rótulo do botão de
// saída é casado de propósito com o reconhecedor da trigger do banco: tocar no
// botão devolve o rótulo como texto, a trigger lê e registra o opt-out sozinha
// — sem depender de redeploy do webhook.
// ROLLBACK: apagar o bloco `action === 'send_menu'` e tirar 'send_menu' do
// array useTarget; a v26 fica intacta.
//
// v26: GATE DE OPT-OUT. Envio 1:1 para número com opt-out ativo em
// `whatsapp_optouts` é recusado com error_code RECIPIENT_OPTED_OUT (não
// retryable), em vez de sair. É a primeira vez que "não me manda mais" vale
// alguma coisa no sistema: `leads.is_blocked` existia e estava em 0 de 21.439
// leads porque nenhuma das ~40 chamadas de envio consultava. Grupos e links de
// convite não passam pelo gate; `ignore_optout: true` no body pula (aviso
// processual a cliente ativo) e fica no log.
// ROLLBACK: apagar o bloco marcado "v26: GATE DE OPT-OUT" e redeployar — o
// resto da função fica idêntico à v25.
//
// v25: `phone` gravado em whatsapp_messages sempre em dígitos (`storagePhone`),
// mesmo quando o envio vai para o JID do grupo. Antes gravava o JID cru e a
// mensagem sumia do menu "Grupo WA" das atividades.
// ROLLBACK: trocar os três `phone: storagePhone(target)` de volta por
// `phone: target` e redeployar.
//
// ATENÇÃO: esta é a fonte REAL do envio (o `supabase/functions/send-whatsapp`
// do Cloud é só um proxy). Até a v23 ela não estava versionada aqui — este
// arquivo é o espelho fiel do que está deployado, para que dê para reverter.
//
// v24: `replyid` — quando o body traz o id do WhatsApp de uma mensagem, o texto
// sai CITANDO ela (o "responder" do WhatsApp). É o que faz a cobrança de uma
// pendência sair colada na mensagem em que o cliente prometeu. A resposta
// passou a devolver `external_message_id` para quem precisa vincular a bolha
// enviada a outro registro (histórico de cobrança).
// ROLLBACK: apagar os dois blocos marcados com "v24" abaixo e redeployar.
//
// v23: send_media respeita body.ptt/is_voice → UazAPI type 'ptt' (nota de voz).
// Opus/ogg enviado como 'audio' comum não toca no WhatsApp iOS.
// v22: envio 1:1 (não-grupo) com instância explícita que NÃO resolve agora FALHA
// com erro claro, em vez de rerotear calado pra outra instância (mandava do
// número errado quando o instance_name da conversa não casava com o cadastro).
// Grupos e chamadas sem instância explícita seguem com o fallback de
// instância-membro.
// v21: fallback de envio em grupo também dispara quando a instância escolhida
// está DESCONECTADA (antes só disparava em "not participating").
// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2';
const EXT_URL = Deno.env.get('SUPABASE_URL') ?? '';
const EXT_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUD_URL = Deno.env.get('CLOUD_FUNCTIONS_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON = Deno.env.get('CLOUD_ANON_KEY') || '';
const CLOUD_SVC = Deno.env.get('CLOUD_SERVICE_ROLE_KEY') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
function isInviteLink(r) {
  return typeof r === 'string' && /chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(r);
}
function isJid(r) {
  return typeof r === 'string' && /@(g\.us|s\.whatsapp\.net|c\.us|lid)$/i.test(r.trim());
}
function isGroupJid(r) {
  return typeof r === 'string' && /@g\.us$/i.test(r.trim());
}
function extractInvite(l) {
  return l.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i)?.[1] || null;
}
function normalizePhone(r) {
  const t = r.trim();
  if (!t || isInviteLink(t) || isGroupJid(t)) return t;
  const d = t.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length >= 10 && d.length <= 11) return '55' + d;
  return d;
}
/**
 * v25: forma canônica do `phone` gravado em `whatsapp_messages`.
 *
 * O alvo do ENVIO pode ser o JID do grupo (`120…@g.us`) — a UazAPI aceita as
 * duas formas —, mas a COLUNA tem de guardar só dígitos: é assim que o webhook
 * grava e é por essa forma que as telas procuram a conversa. Gravar o JID cru
 * fazia a mensagem enviada sumir do menu "Grupo WA" das atividades (que busca
 * `phone = <dígitos>`): 1.505 linhas assim entre 09/04 e 18/08/2026, todas
 * nossas. Link de convite e alvo vazio ficam como estão.
 */
function storagePhone(t) {
  if (typeof t !== 'string' || isInviteLink(t)) return t;
  const d = t.replace(/@.*$/, '').replace(/\D/g, '');
  // Alvo sem dígitos suficientes não é telefone nem grupo — devolve intacto.
  return d.length >= 8 ? d : t;
}
function getTarget(p, c) {
  return typeof c === 'string' && c.trim() ? c.trim() : typeof p === 'string' && p.trim() ? p.trim() : '';
}
/**
 * v26: chave canônica do telefone para o gate de opt-out — 55 + DDD + 8 últimos
 * dígitos. Espelha `public.wa_optout_key(text)` e a edge whatsapp-optout;
 * mudar aqui exige mudar nos dois. Existe porque o mesmo número aparece nas
 * duas formas no banco (1.372 números com 12 dígitos e 729 com 13 nos últimos
 * 30 dias) — sem normalizar, quem pediu para sair por uma forma continuaria
 * recebendo pela outra.
 */
function optoutKey(raw) {
  let v = String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
  if (!v) return null;
  if (v.length >= 10 && v.length <= 11) v = '55' + v;
  if (v.startsWith('55') && v.length === 13 && v[4] === '9') v = v.slice(0, 4) + v.slice(5);
  return v || null;
}
function jsonResp(p, s = 200) {
  return new Response(JSON.stringify(p), {
    status: s,
    headers: {
      ...cors,
      'Content-Type': 'application/json'
    }
  });
}
async function readSafe(r) {
  try {
    return await r.text();
  } catch  {
    return '';
  }
}
function isDisc(s, e) {
  return s === 503 && /whatsapp disconnected|websocket disconnected/i.test(e);
}
function discPayload(n, d) {
  return {
    success: false,
    error: 'WhatsApp instance is disconnected.',
    error_code: 'INSTANCE_DISCONNECTED',
    instance_name: n || null,
    retryable: true,
    details: d || null
  };
}
async function getInstance(cloudClient, extClient, instance_id, target, instance_name) {
  // 1) instance_id explícito vence sempre
  if (instance_id) {
    const { data: d1 } = await cloudClient.from('whatsapp_instances').select('*').eq('id', instance_id).eq('is_active', true).maybeSingle();
    if (d1) return d1;
    const { data: d2 } = await extClient.from('whatsapp_instances').select('*').eq('id', instance_id).eq('is_active', true).maybeSingle();
    if (d2) return d2;
  }
  // 1b) instance_name explícito (vem da conversa no client) — usa service_role, ignora RLS
  if (typeof instance_name === 'string' && instance_name.trim()) {
    const n = instance_name.trim();
    const { data: n1 } = await cloudClient.from('whatsapp_instances').select('*').ilike('instance_name', n).eq('is_active', true).maybeSingle();
    if (n1) return n1;
    const { data: n2 } = await extClient.from('whatsapp_instances').select('*').ilike('instance_name', n).eq('is_active', true).maybeSingle();
    if (n2) return n2;
    console.warn(`getInstance: instance_name="${n}" não encontrada ou inativa — caindo pra fallback`);
  }
  // 1c) SAFETY (v22): instância explícita foi pedida (id ou nome) mas não resolveu acima,
  //     e o alvo é uma PESSOA (não-grupo). NÃO substituir por outra instância — isso mandaria
  //     do número errado (vazamento/confusão p/ o cliente). Aborta → caller devolve erro claro.
  //     Grupos seguem pro fallback de instância-membro abaixo; chamadas sem alvo-pessoa
  //     (ops de grupo, target=null) ou sem instância explícita mantêm o comportamento legado.
  const explicitRequested = !!instance_id || (typeof instance_name === 'string' && !!instance_name.trim());
  const hasPersonTarget = typeof target === 'string' && !!target.trim()
    && !isGroupJid(target) && target.replace(/\D/g, '').length <= 15;
  if (explicitRequested && hasPersonTarget) {
    console.warn(`getInstance: instância explícita não resolvida (id=${instance_id || '-'}, name="${instance_name || '-'}") e alvo é pessoa — abortando SEM rerotear`);
    return null;
  }
  // 2) Se temos target (phone/jid), tenta usar a instância que MAIS RECENTEMENTE
  //    teve mensagem nesse phone — garante que ela é membro do grupo / tem histórico.
  //    Crítico pra grupos: evita "you're not participating in that group".
  if (typeof target === 'string' && target.trim()) {
    const phoneClean = target.replace(/@.*$/, '').trim();
    try {
      const { data: lastMsgs } = await cloudClient.from('whatsapp_messages').select('instance_name').eq('phone', phoneClean).order('created_at', {
        ascending: false
      }).limit(20);
      const tried = new Set();
      for (const row of lastMsgs || []){
        const name = row?.instance_name;
        if (!name || tried.has(name.toLowerCase())) continue;
        tried.add(name.toLowerCase());
        const { data: inst } = await cloudClient.from('whatsapp_instances').select('*').ilike('instance_name', name).eq('is_active', true).maybeSingle();
        if (inst) return inst;
        const { data: instExt } = await extClient.from('whatsapp_instances').select('*').ilike('instance_name', name).eq('is_active', true).maybeSingle();
        if (instExt) return instExt;
      }
    } catch (e) {
      console.warn('getInstance target lookup failed:', e?.message);
    }
  }
  // 3) Fallback genérico (mantém comportamento legado)
  const { data: d1 } = await cloudClient.from('whatsapp_instances').select('*').eq('is_active', true).order('created_at', {
    ascending: true
  }).limit(1).maybeSingle();
  if (d1) return d1;
  const { data: d2 } = await extClient.from('whatsapp_instances').select('*').eq('is_active', true).order('created_at', {
    ascending: true
  }).limit(1).maybeSingle();
  return d2 || null;
}
async function saveMsg(cloudClient, extClient, row) {
  // Salva no Cloud (PRIMARY - frontend lê aqui)
  const { data, error } = await cloudClient.from('whatsapp_messages').insert(row).select('id,created_at').single();
  if (error) {
    if (error.code !== '23505') console.error('Cloud insert error:', error.code, error.message);
    return null;
  }
  // Espelha no backup sem metadata
  const m = {
    ...row
  };
  delete m.metadata;
  if (data?.created_at) m.created_at = data.created_at;
  extClient.from('whatsapp_messages').upsert(m, {
    onConflict: 'external_message_id',
    ignoreDuplicates: true
  }).then(()=>{}, ()=>{});
  return data;
}
async function resolveGroupLink(inst, link) {
  const code = extractInvite(link);
  if (!code) throw new Error('Link inválido');
  const base = inst.base_url || 'https://abraci.uazapi.com';
  let gd = null, lastErr = '';
  for (const url of [
    `${base}/group/inviteInfo`,
    `${base}/group/acceptInvite`,
    `${base}/group/getInviteInfo`
  ]){
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: inst.instance_token
        },
        body: JSON.stringify({
          invitecode: code
        })
      });
      if (r.ok) {
        gd = await r.json();
        break;
      } else lastErr = `${url}:${r.status}`;
    } catch (e) {
      lastErr = `${url}:${e.message}`;
    }
  }
  if (!gd) throw new Error(`Não foi possível resolver: ${lastErr}`);
  const d = gd?.group || gd?.data || gd;
  const id = d?.JID || d?.jid || d?.id || gd?.JID || gd?.jid || gd?.id;
  if (!id) throw new Error('Sem ID do grupo');
  return {
    groupId: id,
    groupName: d?.Name || d?.name || d?.subject || ''
  };
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: cors
  });
  try {
    // cloudClient com service role para DB operations
    const cloudClient = createClient(CLOUD_URL, CLOUD_SVC || CLOUD_ANON);
    const extClient = createClient(EXT_URL, EXT_KEY);
    const body = await req.json();
    // === GUARD: Canal Cloud API (Meta) ===
    // Quando body.channel === 'cloud', reroteia pra Railway send-whatsapp-cloud.
    // Tudo abaixo continua sendo UazAPI legado, intocado.
    if (body?.channel === 'cloud') {
      const RAILWAY_URL = Deno.env.get('RAILWAY_URL') || 'https://adscore-keeper-production.up.railway.app';
      const RAILWAY_API_KEY = Deno.env.get('RAILWAY_API_KEY') || '';
      const headers = {
        'Content-Type': 'application/json'
      };
      if (RAILWAY_API_KEY) headers['x-api-key'] = RAILWAY_API_KEY;
      const r = await fetch(`${RAILWAY_URL}/functions/send-whatsapp-cloud`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: {
          ...cors,
          'Content-Type': r.headers.get('content-type') || 'application/json'
        }
      });
    }
    // === END GUARD ===
    if (body.phone && typeof body.phone === 'string') body.phone = normalizePhone(body.phone);
    if (body.chat_id && typeof body.chat_id === 'string') body.chat_id = normalizePhone(body.chat_id);
    const { action } = body;
    const useTarget = action === undefined || [
      'send_media',
      'send_location',
      'send_text',
      // v27: send_menu entra aqui para passar pelo gate de opt-out logo abaixo.
      // Um balão perguntando "quer continuar?" enviado a quem já pediu para sair
      // seria a pior versão da funcionalidade.
      'send_menu'
    ].includes(action);
    const tgt = getTarget(body.phone, body.chat_id);
    if (useTarget && isInviteLink(tgt)) {
      const inst = await getInstance(cloudClient, extClient, body.instance_id, null, body.instance_name);
      if (!inst) return jsonResp({
        success: false,
        error: 'No active instance'
      });
      try {
        const { groupId } = await resolveGroupLink(inst, tgt);
        body.phone = groupId;
        body.chat_id = groupId;
      } catch (e) {
        return jsonResp({
          success: false,
          error: e.message
        });
      }
    }
    // === v26: GATE DE OPT-OUT ===
    // Quem pediu para não receber mais não recebe — e é aqui que isso vale,
    // porque este arquivo é a fonte REAL do envio: são ~40 pontos de chamada
    // espalhados pelo sistema e nenhum deles checava nada. Antes desta versão,
    // `leads.is_blocked` existia e estava em 0 de 21.439 leads, sem nenhum
    // consumidor — marcar alguém como bloqueado não impedia envio nenhum.
    //
    // Só vale para 1:1: grupo e link de convite passam direto (opt-out é do
    // indivíduo, não do grupo). `ignore_optout: true` é a válvula para o caso
    // legítimo — cliente ativo com processo em andamento que precisa de aviso
    // processual — e fica registrada no log de quem usou.
    //
    // Falha de consulta NÃO bloqueia envio: banco fora do ar não pode virar
    // parada de atendimento. O gate é conservador para o lado de entregar.
    if (useTarget && tgt && !isGroupJid(tgt) && !isInviteLink(tgt) && body.ignore_optout === true) {
      // Bypass sempre deixa rastro: se um dia voltarmos a receber denúncia, é
      // por aqui que se descobre quem furou a fila.
      console.warn('[send-whatsapp] GATE DE OPT-OUT IGNORADO (ignore_optout=true):', {
        phone: `***${String(tgt).replace(/\D/g, '').slice(-4)}`,
        instance_name: body.instance_name || null,
        motivo: body.ignore_optout_reason || 'não informado'
      });
    }
    if (useTarget && tgt && !isGroupJid(tgt) && !isInviteLink(tgt) && body.ignore_optout !== true) {
      const key = optoutKey(tgt);
      if (key) {
        try {
          const { data: optout } = await extClient.from('whatsapp_optouts').select('id, created_at, source').eq('phone_key', key).is('revoked_at', null).maybeSingle();
          if (optout) {
            console.log('[send-whatsapp] envio barrado por opt-out:', {
              phone: `***${key.slice(-4)}`,
              optout_id: optout.id,
              desde: optout.created_at,
              origem: optout.source
            });
            return jsonResp({
              success: false,
              error: 'Este número pediu para não receber mais mensagens. Envio bloqueado.',
              error_code: 'RECIPIENT_OPTED_OUT',
              retryable: false,
              opted_out_at: optout.created_at
            });
          }
        } catch (e) {
          console.warn('[send-whatsapp] consulta de opt-out falhou, seguindo com o envio:', e?.message);
        }
      }
    }
    // === END GATE DE OPT-OUT ===
    if (action === 'resolve_group_link') {
      if (!body.group_link) return jsonResp({
        success: false,
        error: 'group_link required'
      });
      const inst = await getInstance(cloudClient, extClient, body.instance_id, null, body.instance_name);
      if (!inst) return jsonResp({
        success: false,
        error: 'No active instance'
      });
      try {
        const { groupId, groupName } = await resolveGroupLink(inst, body.group_link);
        return jsonResp({
          success: true,
          group_id: groupId,
          group_name: groupName
        });
      } catch (e) {
        return jsonResp({
          success: false,
          error: e.message
        });
      }
    }
    if (action === 'fetch_group_participants') {
      if (!body.group_id) return jsonResp({
        success: false,
        error: 'group_id required'
      });
      const inst = await getInstance(cloudClient, extClient, body.instance_id, null, body.instance_name);
      if (!inst) return jsonResp({
        success: false,
        error: 'No active instance'
      });
      const base = inst.base_url || 'https://abraci.uazapi.com';
      const jid = body.group_id.includes('@g.us') ? body.group_id : `${body.group_id}@g.us`;
      const r = await fetch(`${base}/group/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: inst.instance_token
        },
        body: JSON.stringify({
          id: jid
        })
      });
      if (!r.ok) return jsonResp({
        success: false,
        error: `API error: ${r.status}`
      });
      const gd = await r.json();
      return jsonResp({
        success: true,
        participants: gd?.participants || gd?.data?.participants || [],
        group_name: gd?.subject || gd?.name || ''
      });
    }
    if (action === 'delete_message') {
      if (!body.message_id) return jsonResp({
        success: false,
        error: 'message_id required'
      });
      if (body.external_message_id && body.instance_id) {
        const inst = await getInstance(cloudClient, extClient, body.instance_id, null, body.instance_name);
        if (inst) {
          const base = inst.base_url || 'https://abraci.uazapi.com';
          await fetch(`${base}/message/delete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              token: inst.instance_token
            },
            body: JSON.stringify({
              id: body.external_message_id
            })
          }).catch(()=>{});
        }
      }
      await Promise.all([
        cloudClient.from('whatsapp_messages').delete().eq('id', body.message_id),
        extClient.from('whatsapp_messages').delete().eq('id', body.message_id).then(()=>{}, ()=>{})
      ]);
      return jsonResp({
        success: true
      });
    }
    if (action === 'clear_conversation') {
      if (!body.phone) return jsonResp({
        success: false,
        error: 'phone required'
      });
      let q1 = cloudClient.from('whatsapp_messages').delete().eq('phone', body.phone);
      let q2 = extClient.from('whatsapp_messages').delete().eq('phone', body.phone);
      if (body.instance_name) {
        q1 = q1.eq('instance_name', body.instance_name);
        q2 = q2.eq('instance_name', body.instance_name);
      }
      const [{ error, count }] = await Promise.all([
        q1,
        q2.then(()=>{}, ()=>{})
      ]);
      if (error) throw error;
      return jsonResp({
        success: true,
        deleted: count
      });
    }
    // v27: BALÃO DE ESCOLHA (menu com botões).
    //
    // Confirmado contra a UazAPI em 25/08/2026 (chamada real, instância viva):
    // `/send/menu` existe, aceita type "button" e devolve 200 com um
    // NativeFlowMessage de quick_reply. Detalhe do formato que só aparece
    // testando: a PRIMEIRA LINHA de `text` vira o cabeçalho (header.title) e o
    // resto vira o corpo — por isso o texto padrão abaixo começa com uma linha
    // curta de identificação.
    //
    // POR QUE ISTO EXISTE: medido em 90 dias de mensagens recebidas, ninguém
    // escreve "sair" ou "pare" — zero ocorrências em 66.253 mensagens. Quem não
    // quer simplesmente some (e envenena a instância) ou denuncia (e mata a
    // instância). O botão é a saída barata que falta.
    //
    // O RÓTULO DO BOTÃO DE SAÍDA NÃO É LIVRE: ao tocar nele, o WhatsApp devolve
    // o rótulo como mensagem de texto comum, e é a trigger
    // `trg_wa_optout_detecta_inbound` que lê esse texto para registrar o opt-out
    // e fechar o lead. "Não tenho interesse" casa com o reconhecedor — que é a
    // forma nº 1 de recusa real nesta base (16 ocorrências em 90 dias). Mudar
    // este texto sem mudar os padrões quebra o balão em silêncio; o teste em
    // src/lib/__tests__/whatsappOptout.test.ts trava isso.
    if (action === 'send_menu') {
      const target = getTarget(body.phone, body.chat_id);
      if (!target || !body.message) return jsonResp({
        success: false,
        error: 'phone/chat_id and message required'
      });
      const inst = await getInstance(cloudClient, extClient, body.instance_id, target, body.instance_name);
      if (!inst) return jsonResp({
        success: false,
        error: 'Instância da conversa indisponível.',
        error_code: 'INSTANCE_UNRESOLVED',
        instance_name: body.instance_name || null
      });
      const base = inst.base_url || 'https://abraci.uazapi.com';
      const choices = Array.isArray(body.choices) && body.choices.length
        ? body.choices.map((c)=>String(c))
        : ['Pode continuar', 'Não tenho interesse'];
      const ur = await fetch(`${base}/send/menu`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: inst.instance_token
        },
        body: JSON.stringify({
          number: target,
          type: body.menu_type || 'button',
          text: body.message,
          choices,
          footerText: body.footer || ''
        })
      });
      if (!ur.ok) {
        const et = await readSafe(ur);
        if (isDisc(ur.status, et)) return jsonResp(discPayload(inst.instance_name, et));
        return jsonResp({
          success: false,
          error: `Erro menu: ${et || ur.status}`,
          error_code: 'SEND_FAILED',
          instance_name: inst.instance_name
        });
      }
      const ud = await ur.json().catch(()=>({}));
      const eid = ud?.key?.id || ud?.id || null;
      // Grava como texto para a conversa na tela ficar legível — a bolha do
      // WhatsApp mostra pergunta e botões, e aqui fica pergunta + opções.
      const row = {
        phone: storagePhone(target),
        message_text: `${body.message}\n\n[ ${choices.join(' ] [ ')} ]`,
        message_type: 'text',
        direction: 'outbound',
        status: 'sent',
        contact_id: body.contact_id || null,
        lead_id: body.lead_id || null,
        instance_name: inst.instance_name,
        instance_token: inst.instance_token,
        external_message_id: eid,
        metadata: {
          menu: true,
          choices
        }
      };
      const sm = await saveMsg(cloudClient, extClient, row);
      return jsonResp({
        success: true,
        message_id: sm?.id || null,
        external_message_id: eid,
        instance_name: inst.instance_name,
        choices
      });
    }
    if (action === 'send_media') {
      const target = getTarget(body.phone, body.chat_id);
      if (!target || !body.media_url) return jsonResp({
        success: false,
        error: 'phone/chat_id and media_url required'
      });
      const inst = await getInstance(cloudClient, extClient, body.instance_id, target, body.instance_name);
      if (!inst) return jsonResp({
        success: false,
        error: 'No active instance'
      });
      const base = inst.base_url || 'https://abraci.uazapi.com';
      const mt = body.media_type || '';
      const sb = {
        number: target,
        file: body.media_url
      };
      let mtype = 'image';
      if (mt.startsWith('audio')) {
        // ptt/is_voice → nota de voz (type 'ptt' na UazAPI). Opus/ogg enviado como
        // 'audio' comum não toca no WhatsApp iOS ("áudio não está mais disponível").
        sb.type = (body.ptt === true || body.is_voice === true) ? 'ptt' : 'audio';
        mtype = 'audio';
      } else if (mt.startsWith('video')) {
        sb.type = 'video';
        mtype = 'video';
      } else if (mt.startsWith('image')) {
        sb.type = 'image';
      } else {
        sb.type = 'document';
        mtype = 'document';
      }
      if (body.caption && sb.type !== 'audio') sb.caption = body.caption;
      // v24: mídia também pode sair citando uma mensagem.
      if (typeof body.replyid === 'string' && body.replyid.trim()) sb.replyid = body.replyid.trim();
      const ur = await fetch(`${base}/send/media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: inst.instance_token
        },
        body: JSON.stringify(sb)
      });
      if (!ur.ok) {
        const et = await readSafe(ur);
        if (isDisc(ur.status, et)) return jsonResp(discPayload(inst.instance_name, et));
        return jsonResp({
          success: false,
          error: `Erro mídia: ${et || ur.status}`,
          error_code: /not participating/i.test(et) ? 'NOT_IN_GROUP' : 'SEND_FAILED',
          instance_name: inst.instance_name
        });
      }
      const ud = await ur.json().catch(()=>({}));
      const eid = ud?.key?.id || ud?.id || null;
      const row = {
        phone: storagePhone(target),
        message_text: body.caption || null,
        message_type: mtype,
        media_url: body.media_url,
        media_type: mt || null,
        direction: 'outbound',
        status: 'sent',
        contact_id: body.contact_id || null,
        lead_id: body.lead_id || null,
        instance_name: inst.instance_name,
        instance_token: inst.instance_token,
        external_message_id: eid
      };
      const sm = await saveMsg(cloudClient, extClient, row);
      if (!sm) {
        const { data: em } = await extClient.from('whatsapp_messages').insert(row).select('id').single();
        return jsonResp({
          success: true,
          message_id: em?.id,
          external_message_id: eid,
          instance_name: inst.instance_name,
          backup_only: true
        });
      }
      return jsonResp({
        success: true,
        message_id: sm.id,
        external_message_id: eid,
        instance_name: inst.instance_name
      });
    }
    if (action === 'send_location') {
      const target = getTarget(body.phone, body.chat_id);
      if (!target || body.latitude === undefined || body.longitude === undefined) return jsonResp({
        success: false,
        error: 'phone, lat, lng required'
      });
      const inst = await getInstance(cloudClient, extClient, body.instance_id, target, body.instance_name);
      if (!inst) return jsonResp({
        success: false,
        error: 'No active instance'
      });
      const base = inst.base_url || 'https://abraci.uazapi.com';
      const ur = await fetch(`${base}/send/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: inst.instance_token
        },
        body: JSON.stringify({
          number: target,
          lat: body.latitude,
          lng: body.longitude,
          title: body.name || '',
          address: body.address || ''
        })
      });
      if (!ur.ok) {
        const et = await readSafe(ur);
        if (isDisc(ur.status, et)) return jsonResp(discPayload(inst.instance_name, et));
        throw new Error(`UazAPI ${ur.status}: ${et}`);
      }
      const lt = `📍 ${body.name || 'Localização'}${body.address ? '\n' + body.address : ''}`;
      const row = {
        phone: storagePhone(target),
        message_text: lt,
        message_type: 'location',
        direction: 'outbound',
        status: 'sent',
        contact_id: body.contact_id || null,
        lead_id: body.lead_id || null,
        instance_name: inst.instance_name,
        instance_token: inst.instance_token,
        metadata: {
          latitude: body.latitude,
          longitude: body.longitude
        }
      };
      const sm = await saveMsg(cloudClient, extClient, row);
      return jsonResp({
        success: true,
        message_id: sm?.id,
        instance_name: inst.instance_name
      });
    }
    // SEND TEXT
    const target = getTarget(body.phone, body.chat_id);
    if (!target || !body.message) return jsonResp({
      success: false,
      error: 'phone/chat_id and message required'
    });
    const inst = await getInstance(cloudClient, extClient, body.instance_id, target, body.instance_name);
    if (!inst) return jsonResp({
      success: false,
      error: 'Instância da conversa indisponível (descadastrada/renomeada, ou nenhuma ativa). A mensagem NÃO foi enviada de outro número — reconecte ou selecione outra instância.',
      error_code: 'INSTANCE_UNRESOLVED',
      instance_name: body.instance_name || null
    });
    const base = inst.base_url || 'https://abraci.uazapi.com';
    const sendBody = {
      number: target,
      text: body.message
    };
    const rawMentions = Array.isArray(body.mentions) ? body.mentions : typeof body.mentions === 'string' && body.mentions ? body.mentions.split(',') : [];
    const cleanMentions = rawMentions.map((m)=>String(m).replace(/\D/g, '')).filter((m)=>m.length >= 8);
    if (cleanMentions.length) sendBody.mentions = cleanMentions.join(',');
    // v24: `replyid` = id do WhatsApp (external_message_id) da mensagem citada.
    // É o que faz a cobrança de uma pendência sair colada na mensagem em que o
    // cliente prometeu. Sem o campo, o envio é exatamente o de antes.
    if (typeof body.replyid === 'string' && body.replyid.trim()) sendBody.replyid = body.replyid.trim();
    let usedInst = inst;
    let ur = await fetch(`${base}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: inst.instance_token
      },
      body: JSON.stringify(sendBody)
    });
    // Retry com instâncias alternativas se a primeira não estiver no grupo OU estiver desconectada
    const discRe = /disconnect|not reconnectable|session is not|websocket/i;
    if (!ur.ok) {
      const et0 = await readSafe(ur);
      const isGroup = isGroupJid(target) || target.replace(/\D/g, '').length > 15;
      const notInGroup = /not participating/i.test(et0);
      const disconnected = discRe.test(et0) || isDisc(ur.status, et0);
      if (isGroup && (notInGroup || disconnected)) {
        console.warn(`[send-whatsapp] ${inst.instance_name} falhou no grupo ${target} (${notInGroup ? 'not-in-group' : 'disconnected'}), tentando fallbacks`);
        const phoneClean = target.replace(/@.*$/, '').trim();
        const { data: hist } = await cloudClient.from('whatsapp_messages').select('instance_name').eq('phone', phoneClean).order('created_at', {
          ascending: false
        }).limit(30);
        const tried = new Set([
          inst.instance_name?.toLowerCase()
        ]);
        for (const h of hist || []){
          const nm = h?.instance_name;
          if (!nm || tried.has(nm.toLowerCase())) continue;
          tried.add(nm.toLowerCase());
          const { data: alt } = await cloudClient.from('whatsapp_instances').select('*').ilike('instance_name', nm).eq('is_active', true).maybeSingle();
          if (!alt?.instance_token) continue;
          const altBase = alt.base_url || 'https://abraci.uazapi.com';
          const r2 = await fetch(`${altBase}/send/text`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              token: alt.instance_token
            },
            body: JSON.stringify(sendBody)
          });
          if (r2.ok) {
            console.log(`[send-whatsapp] fallback success via ${alt.instance_name}`);
            usedInst = alt;
            ur = r2;
            break;
          }
        }
      }
      if (!ur.ok) {
        const et = await readSafe(ur).catch(()=>et0);
        if (isDisc(ur.status, et) || discRe.test(et || et0)) return jsonResp(discPayload(usedInst.instance_name, et || et0));
        return jsonResp({
          success: false,
          error: `Erro: ${et || et0 || ur.status}`,
          error_code: /not participating/i.test(et || et0) ? 'NOT_IN_GROUP' : 'SEND_FAILED',
          instance_name: usedInst.instance_name
        });
      }
    }
    const ud = await ur.json().catch(()=>({}));
    const eid = ud?.key?.id || ud?.id || null;
    const row = {
      phone: storagePhone(target),
      message_text: body.message,
      message_type: 'text',
      direction: 'outbound',
      status: 'sent',
      contact_id: body.contact_id || null,
      lead_id: body.lead_id || null,
      instance_name: usedInst.instance_name,
      instance_token: usedInst.instance_token,
      external_message_id: eid
    };
    const sm = await saveMsg(cloudClient, extClient, row);
    if (!sm) {
      console.warn('Cloud save failed, saving to ext backup');
      const { data: em } = await extClient.from('whatsapp_messages').insert(row).select('id').single();
      return jsonResp({
        success: true,
        message_id: em?.id,
        external_message_id: eid,
        instance_name: usedInst.instance_name,
        backup_only: true
      });
    }
    return jsonResp({
      success: true,
      message_id: sm.id,
      external_message_id: eid,
      instance_name: usedInst.instance_name
    });
  } catch (e) {
    console.error('send-whatsapp fatal:', e?.message);
    return jsonResp({
      success: false,
      error: e?.message
    }, /INSTANCE_DISCONNECTED/i.test(e?.message || '') ? 200 : 500);
  }
});
