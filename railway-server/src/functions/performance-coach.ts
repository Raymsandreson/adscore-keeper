/**
 * performance-coach — Coach de desempenho do telão /tv/atividades.
 *
 * mode "analyze" (default): recebe o nome de um assessor do ranking e uma
 * pergunta opcional do diretor ("por que fulano está assim?"). Coleta o
 * ranking (RPC tv_atividades_ranking), as atividades da pessoa e gera via
 * Claude: (a) análise respondendo a pergunta com base só nos dados e
 * (b) mensagem sugerida no estilo locutor de Corrida Maluca — posição,
 * quem está na frente/atrás, parabéns ou alerta + 1 dica acionável.
 * Nada é enviado nesse modo; a mensagem volta pro diretor aprovar.
 *
 * mode "send": posta a mensagem aprovada na conversa DIRETA do chat interno
 * entre o remetente (diretor) e a pessoa, criando a conversa se não existir.
 *
 * Custo: 1 chamada claude-sonnet por análise (~centavos).
 */
import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { aiChat } from '../lib/gemini';

// aiChat roteia pelo prefixo: google/* → Gemini (GOOGLE_AI_API_KEY, que já tem
// crédito), claude-* → Anthropic. Trocar de provider = setar COACH_MODEL no Railway.
const COACH_MODEL = process.env.COACH_MODEL || 'google/gemini-2.5-flash';

interface RankRow {
  nome: string;
  passos: number;
  concluidas: number;
  atrasadas: number;
  aprov_pct: number | null;
  chat_resp_seg: number | null;
  ativo_seg: number;
  ocioso_seg: number;
}

function seg(s: number | null | undefined): string {
  if (s == null || s === 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}

function rowLine(r: RankRow): string {
  return `${r.passos} passos, ${r.concluidas} concluídas, ${r.atrasadas} atrasadas, ` +
    `aprovação ${r.aprov_pct != null ? r.aprov_pct + '%' : '—'}, ` +
    `tempo ativo ${seg(r.ativo_seg)}, ocioso ${seg(r.ocioso_seg)}, ` +
    `resposta no chat ${seg(r.chat_resp_seg)}`;
}

/** Extrai o primeiro objeto JSON de um texto (Claude às vezes cerca com prosa/```). */
function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function resolvePerson(nome: string): Promise<{ userId: string | null; anyIds: string[]; phone: string | null }> {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, full_name, phone')
    .ilike('full_name', `%${nome}%`)
    .limit(5);
  const exact = (profiles || []).find((p) => (p.full_name || '').trim().toLowerCase() === nome.trim().toLowerCase());
  let p = exact || (profiles || [])[0];

  // No grupo gerencial o nome do ranking vem de org_directors/team_managers,
  // que nem sempre bate com profiles.full_name (ex.: perfil com username).
  if (!p) {
    const [{ data: dirs }, { data: mgrs }] = await Promise.all([
      supabase.from('org_directors').select('user_id, name').ilike('name', `%${nome}%`).limit(1),
      supabase.from('team_managers').select('manager_user_id, manager_name').ilike('manager_name', `%${nome}%`).limit(1),
    ]);
    const userId = dirs?.[0]?.user_id || mgrs?.[0]?.manager_user_id;
    if (userId) {
      const { data: byId } = await supabase
        .from('profiles').select('id, user_id, full_name, phone').eq('user_id', userId).maybeSingle();
      p = byId || { id: userId, user_id: userId, full_name: nome, phone: null };
    }
  }

  if (!p) return { userId: null, anyIds: [], phone: null };
  const phone = (p.phone || '').replace(/\D/g, '') || null;
  return { userId: p.user_id, anyIds: [...new Set([p.user_id, p.id].filter(Boolean))] as string[], phone };
}

async function personActivities(anyIds: string[], nome: string, sinceIso: string) {
  const today = new Date().toISOString().slice(0, 10);
  const safeName = nome.replace(/"/g, '');
  const who = anyIds.length
    ? `assigned_to.in.(${anyIds.join(',')}),assigned_to_name.eq."${safeName}"`
    : `assigned_to_name.eq."${safeName}"`;

  const [{ data: atrasadas }, { data: concluidas }, { count: abertas }] = await Promise.all([
    supabase.from('lead_activities')
      .select('title, deadline')
      .is('deleted_at', null).is('completed_at', null).lt('deadline', today)
      .or(who).order('deadline', { ascending: true }).limit(10),
    supabase.from('lead_activities')
      .select('title, completed_at')
      .is('deleted_at', null).gte('completed_at', sinceIso)
      .or(who).order('completed_at', { ascending: false }).limit(10),
    supabase.from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null).is('completed_at', null).or(who),
  ]);
  return { atrasadas: atrasadas || [], concluidas: concluidas || [], abertas: abertas || 0 };
}

async function analyze(req: Request, res: Response) {
  const { nome, p_since, p_team_id, p_grupo, question, period_label } = req.body || {};
  if (!nome || !p_since) {
    return res.status(400).json({ success: false, error: 'nome e p_since são obrigatórios' });
  }

  const { data: payload, error: rpcError } = await supabase.rpc('tv_atividades_ranking', {
    p_since,
    p_team_id: p_team_id || null,
    p_grupo: p_grupo || null,
  });
  if (rpcError) throw rpcError;

  const ranking: RankRow[] = payload?.ranking || [];
  const idx = ranking.findIndex((r) => r.nome === nome);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: `"${nome}" não está no ranking do período` });
  }
  const row = ranking[idx];
  const ahead = idx > 0 ? ranking[idx - 1] : null;
  const behind = idx < ranking.length - 1 ? ranking[idx + 1] : null;

  const person = await resolvePerson(nome);
  const acts = await personActivities(person.anyIds, nome, p_since);

  const prompt = [
    `PERÍODO: ${period_label || 'semana'} (desde ${p_since.slice(0, 10)})`,
    `PESSOA: ${nome} — posição ${idx + 1} de ${ranking.length} no ranking`,
    `NÚMEROS DELA: ${rowLine(row)}`,
    ahead ? `NA FRENTE (posição ${idx}): ${ahead.nome} — ${rowLine(ahead)}` : `Ela é a LÍDER do ranking.`,
    behind ? `ATRÁS (posição ${idx + 2}): ${behind.nome} — ${rowLine(behind)}` : `Ela é a ÚLTIMA do ranking.`,
    ``,
    `ATIVIDADES DELA: ${acts.abertas} abertas no total.`,
    `ATRASADAS MAIS ANTIGAS:`,
    ...(acts.atrasadas.length ? acts.atrasadas.map((a: any) => `- ${a.title} (venceu ${a.deadline})`) : ['(nenhuma)']),
    `CONCLUÍDAS NO PERÍODO:`,
    ...(acts.concluidas.length ? acts.concluidas.map((a: any) => `- ${a.title}`) : ['(nenhuma)']),
    ``,
    `PERGUNTA DO DIRETOR: ${question || 'Por que essa pessoa está com esse desempenho no ranking?'}`,
  ].join('\n');

  const completion = await aiChat({
    model: COACH_MODEL,
    max_tokens: 1200,
    temperature: 0.5,
    messages: [
      {
        role: 'system',
        content: `Você assessora o diretor de um escritório jurídico brasileiro analisando o ranking de produtividade do time (critérios em ordem: passos de checklist marcados, atividades concluídas, menos atrasadas, mais tempo ativo no cronômetro, menos ocioso, resposta mais rápida no chat interno).

Responda SOMENTE um JSON válido com duas chaves:
{"analise": "...", "mensagem": "..."}

"analise" (para o diretor): responda a pergunta dele com base APENAS nos dados fornecidos, em português do Brasil, direto, máx ~120 palavras. Aponte qual critério está puxando a pessoa pra cima ou pra baixo (ex.: 0 passos = não marca checklist; muito ocioso no cronômetro; atrasadas acumuladas). Se os dados não permitirem concluir a causa, diga o que os dados mostram e o que vale perguntar à pessoa. Não invente fatos.

"mensagem" (para enviar À PESSOA no chat interno): estilo locutor de Corrida Maluca 🏁 — animado, curto (máx ~90 palavras), diz a posição dela na corrida da ${'semana'}, quem está logo na frente/atrás e por qual diferença. Se está bem (pódio/subindo), dê os parabéns com energia; se está mal, alerte com bom humor e SEM humilhar — é mensagem de chefe pra colaborador, respeitosa. Feche com 1 dica concreta tirada dos dados (ex.: "marca os passos do checklist", "conclui as 3 atrasadas mais antigas"). Use emojis de corrida (🏁🏎️💨🏆) com moderação. Fale diretamente com a pessoa (você).`,
      },
      { role: 'user', content: prompt },
    ],
  });

  const text = completion?.choices?.[0]?.message?.content?.trim() || '';
  const parsed = extractJson(text);
  if (!parsed?.analise || !parsed?.mensagem) {
    throw new Error('LLM não retornou JSON com analise/mensagem');
  }

  return res.json({
    success: true,
    position: idx + 1,
    total: ranking.length,
    row,
    ahead: ahead ? { nome: ahead.nome, passos: ahead.passos } : null,
    behind: behind ? { nome: behind.nome, passos: behind.passos } : null,
    analise: parsed.analise,
    mensagem: parsed.mensagem,
    to_user_id: person.userId,
    // Só o indicador — o número em si não vai pro telão.
    has_whatsapp: !!person.phone,
  });
}

async function findOrCreateDirectConversation(a: string, b: string): Promise<string> {
  const { data: aMemberships } = await supabase
    .from('team_conversation_members').select('conversation_id').eq('user_id', a);
  const aConvIds = (aMemberships || []).map((m) => m.conversation_id);

  if (aConvIds.length) {
    const { data: shared } = await supabase
      .from('team_conversation_members').select('conversation_id')
      .eq('user_id', b).in('conversation_id', aConvIds);
    const sharedIds = (shared || []).map((m) => m.conversation_id);
    if (sharedIds.length) {
      const { data: direct } = await supabase
        .from('team_conversations').select('id')
        .eq('type', 'direct').in('id', sharedIds).limit(1);
      if (direct?.[0]?.id) return direct[0].id;
    }
  }

  const { data: created, error } = await supabase
    .from('team_conversations').insert({ type: 'direct' }).select('id').single();
  if (error) throw error;
  await supabase.from('team_conversation_members')
    .insert([a, b].map((user_id) => ({ conversation_id: created.id, user_id })));
  return created.id;
}

/** Manda texto pro WhatsApp pessoal do membro via UazAPI (1ª instância ativa). */
async function sendWhatsAppToMember(toUserId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const { data: profile } = await supabase
    .from('profiles').select('phone').eq('user_id', toUserId).maybeSingle();
  const phone = (profile?.phone || '').replace(/\D/g, '');
  if (!phone) return { ok: false, error: 'membro sem telefone cadastrado no perfil' };

  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('instance_token, base_url')
    .eq('is_active', true)
    .limit(1);
  const inst = instances?.[0];
  if (!inst) return { ok: false, error: 'nenhuma instância de WhatsApp ativa' };

  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  const resp = await fetch(`${base}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { ok: false, error: `UazAPI ${resp.status}: ${body.slice(0, 150)}` };
  }
  return { ok: true };
}

async function send(req: Request, res: Response) {
  const { to_user_id, message, sender_id, sender_name, via_chat = true, via_whatsapp = false } = req.body || {};
  if (!to_user_id || !message || !sender_id) {
    return res.status(400).json({ success: false, error: 'to_user_id, message e sender_id são obrigatórios' });
  }
  if (!via_chat && !via_whatsapp) {
    return res.status(400).json({ success: false, error: 'escolha ao menos um canal (via_chat/via_whatsapp)' });
  }

  const results: { chat?: { ok: boolean; error?: string }; whatsapp?: { ok: boolean; error?: string } } = {};

  if (via_chat) {
    try {
      const convId = await findOrCreateDirectConversation(sender_id, to_user_id);
      const { error } = await supabase.from('team_messages').insert({
        conversation_id: convId,
        sender_id,
        sender_name: sender_name || null,
        content: message,
        message_type: 'text',
      });
      if (error) throw error;
      await supabase.from('team_conversations')
        .update({ updated_at: new Date().toISOString() }).eq('id', convId);
      results.chat = { ok: true };
    } catch (err) {
      results.chat = { ok: false, error: err instanceof Error ? err.message : 'falha no chat' };
    }
  }

  if (via_whatsapp) {
    try {
      results.whatsapp = await sendWhatsAppToMember(to_user_id, message);
    } catch (err) {
      results.whatsapp = { ok: false, error: err instanceof Error ? err.message : 'falha no WhatsApp' };
    }
  }

  const allOk = Object.values(results).every((r) => r.ok);
  return res.json({ success: allOk, results });
}

/** Cadastra o WhatsApp do membro direto do painel (atalho quando não há número). */
async function setPhone(req: Request, res: Response) {
  const { to_user_id, phone } = req.body || {};
  if (!to_user_id || !phone) {
    return res.status(400).json({ success: false, error: 'to_user_id e phone são obrigatórios' });
  }
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`; // DDD + número → +55
  if (digits.length < 12 || digits.length > 13) {
    return res.status(400).json({ success: false, error: 'telefone inválido — informe DDD + número' });
  }

  const { data: updated, error } = await supabase
    .from('profiles').update({ phone: digits }).eq('user_id', to_user_id).select('user_id');
  if (error) throw error;
  if (!updated?.length) {
    return res.status(404).json({ success: false, error: 'perfil do membro não encontrado' });
  }
  return res.json({ success: true, phone_masked: `…${digits.slice(-4)}` });
}

export const handler = async (req: Request, res: Response) => {
  try {
    if (req.body?.mode === 'send') return await send(req, res);
    if (req.body?.mode === 'set-phone') return await setPhone(req, res);
    return await analyze(req, res);
  } catch (err) {
    console.error('[performance-coach] Error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};
