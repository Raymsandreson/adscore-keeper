// Webhook da Callface (Public Integration API) — roda no Supabase EXTERNO.
//
// A Callface chama esta URL quando uma chamada é encerrada. O payload está
// documentado em https://callface.io (Public Integration API) e chega assim:
//   { deal_id, contact_id, summarization, user_email, user_name,
//     destination_number, call_audio_url, call_link, call_date,
//     call_duration, credentials: [{name, value}] }
//
// Histórico: até a v33 (abr/2026) esta função existia SÓ no deploy — não estava
// versionada. Baixada com `supabase functions download` e corrigida em 20/08/2026.
// Rollback: o índice v33 está em scratchpad/cf-dl/ — redeploy dele desfaz tudo.
//
// Defeitos corrigidos nesta versão (medidos nas 46 chamadas de agosto/2026):
//   1. ATRIBUIÇÃO — resolvia o usuário com auth.admin.listUsers() SEM paginação,
//      que só varre os 50 primeiros de milhares. Nunca achava ninguém e caía num
//      fallback `user_roles role=admin limit 1`: 46 de 46 chamadas foram parar no
//      nome da mesma pessoa, sendo que quem ligou foi Edilan (25), Analyne (10),
//      João Pedro (3) e duas contas compartilhadas (8). Agora é cascata explícita
//      e SEM fallback para admin — sem match, grava sentinela e vai para triagem.
//      Registro órfão é melhor que registro mentiroso.
//   2. ESPELHO — gravava no Cloud o uuid do EXTERNO, mas o front filtra
//      call_records por uuid do CLOUD (useCallRecords.ts:88). Agora traduz pelo
//      auth_uuid_mapping antes do upsert, e o erro do espelho não é mais engolido.
//   3. ORIGEM — qualquer um forjava chamada (POST anônimo respondia normalmente).
//      A Callface não assina o payload, então a trava é token na URL. Sobe com
//      CALLFACE_WEBHOOK_ENFORCE desligado e só passa a barrar depois que a URL
//      for re-registrada — mesmo padrão do RAILWAY_AUTH_ENFORCE.
//   4. LOG — logava o body cru, que carrega telefone do cliente e o resumo da
//      conversa. Agora mascara (princípio de log do CLAUDE.md).
// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXT_URL = Deno.env.get('SUPABASE_URL') ?? '';
const EXT_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUD_URL = Deno.env.get('CLOUD_FUNCTIONS_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_SVC = Deno.env.get('CLOUD_SERVICE_ROLE_KEY') || '';
const CLOUD_ANON = Deno.env.get('CLOUD_ANON_KEY') || '';

const WEBHOOK_TOKEN = Deno.env.get('CALLFACE_WEBHOOK_TOKEN') || '';
const ENFORCE_ORIGIN = Deno.env.get('CALLFACE_WEBHOOK_ENFORCE') === '1';

// user_id é NOT NULL em call_records. Quando não dá para saber quem ligou, a
// linha nasce com esta sentinela + tag 'sem-atribuicao' em vez de chutar um dono.
const SENTINELA = '00000000-0000-0000-0000-000000000000';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-callface-token',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Telefone mascarado para log: 5586981812709 -> 55869*****709 */
function mascara(tel: string): string {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length < 8) return '***';
  return d.slice(0, 5) + '*'.repeat(Math.max(0, d.length - 8)) + d.slice(-3);
}

/**
 * ilike do PostgREST não enxerga acento — 'peric' não acha 'Perícia'. O '_' casa
 * com qualquer caractere único, então trocar todo não-ASCII por '_' faz
 * 'João Pedro' virar 'Jo_o Pedro' e casar. '%' e '_' do próprio nome viram '_'
 * para não injetar curinga extra.
 */
function padraoSemAcento(nome: string): string {
  return nome.trim().replace(/[^\x20-\x7E]/g, '_').replace(/[%_]/g, '_');
}

const ehUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());

/**
 * Descobre quem fez a ligação. Ordem do mais confiável para o menos:
 *   1. credentials.user_id — é o campo declarado em needed_credentials no
 *      registro do app; aceita tanto uuid do Externo quanto do Cloud.
 *   2. user_email contra profiles.email (fonte de verdade do Externo).
 *   3. user_name contra profiles.full_name, e só se casar com EXATAMENTE uma
 *      pessoa — nome ambíguo não vira palpite.
 * Nome de conta compartilhada ('Atendimento Previdenciário', 'Processual') é
 * nome de INSTÂNCIA, não de pessoa: a instância tem 38-41 usuários com acesso,
 * então não dá para atribuir. Cai na sentinela de propósito.
 */
async function resolverUsuario(
  ext: any,
  credentials: Array<{ name?: string; value?: string }>,
  userEmail: string | null,
  userName: string | null,
): Promise<{ userId: string | null; via: string }> {
  // 1) credential
  const cred = (credentials || []).find((c) => c?.name === 'user_id')?.value;
  if (ehUuid(cred)) {
    const { data: p } = await ext.from('profiles').select('user_id').eq('user_id', cred).maybeSingle();
    if (p?.user_id) return { userId: p.user_id, via: 'credential' };
    // pode ter sido cadastrado com o uuid do Cloud
    const { data: m } = await ext.from('auth_uuid_mapping').select('ext_uuid').eq('cloud_uuid', cred).maybeSingle();
    if (m?.ext_uuid) return { userId: m.ext_uuid, via: 'credential_cloud' };
  }

  // 2) e-mail
  const email = (userEmail || '').trim();
  if (email) {
    const { data: p } = await ext.from('profiles').select('user_id').ilike('email', email).limit(2);
    if (p?.length === 1) return { userId: p[0].user_id, via: 'email' };
    const { data: m } = await ext.from('auth_uuid_mapping').select('ext_uuid').ilike('email', email).limit(2);
    if (m?.length === 1) return { userId: m[0].ext_uuid, via: 'email_mapping' };
  }

  // 3) nome. A Callface manda o nome curto ('Edilan Santos') e o profile guarda o
  // completo ('Edilan da Silva Santos'), então ilike de substring contígua não
  // casa: o padrão é primeiro%último. Se nem isso casar, tenta só o primeiro
  // nome — resolve quem tem full_name derivado do e-mail ('analyne.sousa71').
  // Em qualquer tentativa, mais de um candidato = null. Nome ambíguo não vira
  // palpite; a chamada vai para a triagem com dono em branco.
  const nome = (userName || '').trim();
  if (nome.length >= 4) {
    // Partículas e tokens curtos ficam de fora: 'SÁ' vira 'S_' pelo tratamento de
    // acento e um padrão '%JO_O%S_%' casa com meio cadastro. Com o filtro,
    // 'JOÃO PEDRO ALVARENGA PEREIRA DE SÁ' vira '%JO_O%PEREIRA%'.
    const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del']);
    const tokens = padraoSemAcento(nome)
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !PARTICULAS.has(t.toLowerCase()));
    const tentativas: Array<{ padrao: string; via: string }> = [];
    if (tokens.length >= 2) {
      tentativas.push({ padrao: `%${tokens[0]}%${tokens[tokens.length - 1]}%`, via: 'nome' });
      tentativas.push({ padrao: `%${tokens[0]}%`, via: 'nome_primeiro' });
    } else if (tokens.length === 1) {
      tentativas.push({ padrao: `%${tokens[0]}%`, via: 'nome_unico' });
    }
    for (const t of tentativas) {
      const { data: p } = await ext.from('profiles').select('user_id, full_name').ilike('full_name', t.padrao).limit(3);
      if (p?.length === 1) return { userId: p[0].user_id, via: t.via };
      if ((p?.length ?? 0) > 1) return { userId: null, via: 'nome_ambiguo' };
    }
  }

  return { userId: null, via: 'nao_resolvido' };
}

/** Traduz uuid do Externo para o do Cloud (o front filtra pelo do Cloud). */
async function paraUuidDoCloud(ext: any, extUuid: string): Promise<string> {
  if (!ehUuid(extUuid) || extUuid === SENTINELA) return extUuid;
  const { data } = await ext.from('auth_uuid_mapping').select('cloud_uuid').eq('ext_uuid', extUuid).maybeSingle();
  return data?.cloud_uuid || extUuid;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // --- Gate de origem -------------------------------------------------------
  const url = new URL(req.url);
  const tokenRecebido = url.searchParams.get('k') || req.headers.get('x-callface-token') || '';
  const origemOk = !WEBHOOK_TOKEN || tokenRecebido === WEBHOOK_TOKEN;
  if (!origemOk) {
    if (ENFORCE_ORIGIN) {
      console.warn(`[callface] BARRADO origem inválida (token ${tokenRecebido ? 'errado' : 'ausente'})`);
      return json({ success: false, error: 'unauthorized' }, 401);
    }
    console.warn(`[callface] origem sem token válido — ACEITO porque ENFORCE=0 (token ${tokenRecebido ? 'errado' : 'ausente'})`);
  }

  try {
    const ext = createClient(EXT_URL, EXT_KEY);
    const cloud = createClient(CLOUD_URL, CLOUD_SVC || CLOUD_ANON);

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return json({ success: false, error: 'invalid_json' }, 400);
    }

    const {
      deal_id,
      summarization,
      user_email,
      user_name,
      destination_number,
      call_audio_url,
      call_link,
      call_duration,
      credentials = [],
    } = body;

    if (!destination_number) return json({ success: false, error: 'missing destination_number' }, 400);

    // Log sem telefone cru e sem o resumo (conteúdo de conversa de cliente).
    console.log(
      `[callface] recebido tel=${mascara(destination_number)} dur=${call_duration}s ` +
        `user_name=${user_name || '-'} tem_email=${!!user_email} creds=${(credentials || []).length} ` +
        `tem_audio=${!!call_audio_url} tem_resumo=${!!summarization}`,
    );

    const phone = String(destination_number).replace(/\D/g, '');
    const durationSec = Number(call_duration) || 0;
    const callResult = durationSec > 0 ? 'atendeu' : 'nao_atendeu';

    // --- Quem ligou ---------------------------------------------------------
    const { userId: resolvedUserId, via } = await resolverUsuario(ext, credentials, user_email, user_name);
    console.log(`[callface] atribuição via=${via} user=${resolvedUserId ? resolvedUserId.slice(0, 8) : 'SENTINELA'}`);

    // --- Para quem ligou ----------------------------------------------------
    const phoneVariants = Array.from(
      new Set([phone, `+${phone}`, phone.replace(/^55/, ''), phone.slice(-8)].filter(Boolean)),
    );

    let contactId: string | null = null;
    let leadId: string | null = null;
    let contactName: string | null = null;

    for (const v of phoneVariants) {
      const { data: c } = await ext.from('contacts').select('id, lead_id, full_name').ilike('phone', `%${v}`).limit(1);
      if (c?.length) {
        contactId = c[0].id;
        leadId = c[0].lead_id;
        contactName = c[0].full_name;
        break;
      }
    }
    if (!leadId) {
      for (const v of phoneVariants) {
        const { data: l } = await ext.from('leads').select('id, lead_name').ilike('lead_phone', `%${v}`).limit(1);
        if (l?.length) {
          leadId = l[0].id;
          contactName = l[0].lead_name;
          break;
        }
      }
    }

    // --- Tags: a fila de triagem é o que não encostou em ninguém -------------
    // Nada vira lead ou contato automaticamente. A atendente é quem classifica.
    const tags = ['callface', 'telefone'];
    if (!leadId && !contactId) tags.push('triagem');
    if (!resolvedUserId) tags.push('sem-atribuicao');

    const notes = [
      `Callface | ${user_name || user_email || 'Agente'} | Duração: ${durationSec}s`,
      user_email && user_name ? `E-mail: ${user_email}` : '',
      deal_id ? `Deal: ${deal_id}` : '',
      call_link ? `Link: ${call_link}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    // Completa um registro que já existia (softphone abriu a linha e a Callface
    // fecha com áudio+resumo). Restrito a linha 'em_andamento' OU já marcada como
    // callface: antes pegava QUALQUER registro do mesmo telefone na última hora,
    // e podia sobrescrever anotação manual de outra pessoa.
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: existing } = await ext
      .from('call_records')
      .select('id, tags, call_result')
      .or(`contact_phone.eq.${phone},contact_phone.eq.+${phone}`)
      .gte('created_at', umaHoraAtras)
      .order('created_at', { ascending: false })
      .limit(5);

    const alvo = (existing || []).find(
      (r: any) => r.call_result === 'em_andamento' || (r.tags || []).includes('callface'),
    );

    let recordId: string | null = null;

    if (alvo?.id) {
      const { data: updated, error: errUpd } = await ext
        .from('call_records')
        .update({
          call_result: callResult,
          duration_seconds: durationSec,
          audio_url: call_audio_url || null,
          audio_file_name: call_audio_url ? call_audio_url.split('/').pop()?.split('?')[0] || null : null,
          ai_summary: summarization || null,
          notes,
          contact_id: contactId || undefined,
          lead_id: leadId || undefined,
          contact_name: contactName || undefined,
          contact_phone: phone,
          tags,
        })
        .eq('id', alvo.id)
        .select('id')
        .single();
      if (errUpd) console.error('[callface] update falhou:', errUpd.message);
      recordId = updated?.id || alvo.id;
      console.log(`[callface] atualizou call_record ${recordId}`);
    } else {
      const { data: created, error: errIns } = await ext
        .from('call_records')
        .insert({
          user_id: resolvedUserId || SENTINELA,
          call_type: 'realizada',
          call_result: callResult,
          duration_seconds: durationSec,
          contact_id: contactId || null,
          lead_id: leadId || null,
          contact_name: contactName || null,
          contact_phone: phone,
          phone_used: user_name || user_email || 'callface',
          audio_url: call_audio_url || null,
          ai_summary: summarization || null,
          notes,
          tags,
        })
        .select('id')
        .single();
      if (errIns) {
        console.error('[callface] insert falhou:', errIns.message);
        return json({ success: false, error: 'insert_failed' }, 500);
      }
      recordId = created?.id || null;
      console.log(`[callface] criou call_record ${recordId}`);
    }

    // --- Espelho no Cloud ---------------------------------------------------
    // O resultado volta na resposta porque não há como auditar o Cloud daqui:
    // o PAT da Management API está morto e a conta do CLI não enxerga o projeto.
    let espelho = 'skip';
    if (recordId) {
      const { data: full } = await ext.from('call_records').select('*').eq('id', recordId).single();
      if (full) {
        // lead_id/contact_id são ids do EXTERNO. No Cloud eles ou violam a FK
        // call_records_lead_id_fkey — e aí o espelho da chamada MAIS importante
        // (a que encostou num lead) era rejeitado e o erro sumia no safe() — ou,
        // pior, apontam para outro lead. O front filtra por user_id e telefone.
        const linhaEspelho = {
          ...full,
          user_id: await paraUuidDoCloud(ext, full.user_id),
          lead_id: null,
          contact_id: null,
        };
        const { error: errEsp } = await cloud
          .from('call_records')
          .upsert(linhaEspelho, { onConflict: 'id', ignoreDuplicates: false });
        if (errEsp) {
          espelho = `erro: ${errEsp.message}`;
          console.error(`[callface] espelho no Cloud FALHOU (${recordId}):`, errEsp.message);
        } else {
          espelho = 'ok';
          console.log(`[callface] espelhado no Cloud ${recordId} user=${linhaEspelho.user_id.slice(0, 8)}`);
        }
      }
    }

    return json({ success: true, record_id: recordId, atribuicao: via, triagem: tags.includes('triagem'), espelho });
  } catch (e) {
    console.error('[callface] erro:', (e as Error)?.message);
    return json({ success: false, error: (e as Error)?.message }, 500);
  }
});
