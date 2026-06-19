// send-whatsapp v22 (projeto externo kmedldlepwiityjsdahz)
// FIX v22: envio 1:1 (não-grupo) com instância explícita que NÃO resolve agora FALHA
// com erro claro, em vez de rerotear calado pra outra instância (mandava do número
// errado quando o instance_name da conversa não casava com o cadastro). Grupos e
// chamadas sem instância explícita seguem com o fallback de instância-membro. Rollback: index.v21.rollback.ts
// FIX v21: fallback de envio em grupo também dispara quando a instância escolhida
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
function getTarget(p, c) {
  return typeof c === 'string' && c.trim() ? c.trim() : typeof p === 'string' && p.trim() ? p.trim() : '';
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
      'send_text'
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
        // as_ptt: enviar como nota de voz (bolha de áudio gravado) em vez de anexo com player.
        sb.type = body.as_ptt ? 'ptt' : 'audio';
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
        phone: target,
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
          instance_name: inst.instance_name,
          backup_only: true
        });
      }
      return jsonResp({
        success: true,
        message_id: sm.id,
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
        phone: target,
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
      phone: target,
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
        instance_name: usedInst.instance_name,
        backup_only: true
      });
    }
    return jsonResp({
      success: true,
      message_id: sm.id,
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
