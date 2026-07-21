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
const COACH_MODEL = process.env.COACH_MODEL || 'google/gemini-3.6-flash';

// Base dos links curtos de atividade (rota /atv/:code no front resolve o prefixo).
const APP_URL = (process.env.COACH_APP_URL || 'https://adscore-keeper.lovable.app').replace(/\/$/, '');

interface RankRow {
  nome: string;
  passos: number;
  concluidas: number;
  atrasadas: number;
  aprov_pct: number | null;
  chat_resp_seg: number | null;
  ativo_seg: number;
  ocioso_seg: number;
  home_office?: boolean;
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

function whoFilter(anyIds: string[], nome: string): string {
  const safeName = nome.replace(/"/g, '');
  return anyIds.length
    ? `assigned_to.in.(${anyIds.join(',')}),assigned_to_name.eq."${safeName}"`
    : `assigned_to_name.eq."${safeName}"`;
}

async function personActivities(anyIds: string[], nome: string, sinceIso: string) {
  const today = new Date().toISOString().slice(0, 10);
  const who = whoFilter(anyIds, nome);

  const [{ data: atrasadas }, { data: concluidas }, { count: abertas }] = await Promise.all([
    supabase.from('lead_activities')
      .select('id, title, deadline, priority, lead_id, lead_name, case_id, case_title, process_id, process_title')
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
  await fillVinculoNames(atrasadas || []);
  return { atrasadas: atrasadas || [], concluidas: concluidas || [], abertas: abertas || 0 };
}

/**
 * ~5% das atividades têm lead_id/case_id/process_id mas o nome desnormalizado
 * (lead_name/case_title/process_title) nulo — preenche por lookup em lote.
 */
async function fillVinculoNames(rows: any[]): Promise<void> {
  const leadIds = [...new Set(rows.filter((r) => !r.lead_name && r.lead_id).map((r) => r.lead_id))];
  const caseIds = [...new Set(rows.filter((r) => !r.case_title && r.case_id).map((r) => r.case_id))];
  const procIds = [...new Set(rows.filter((r) => !r.process_title && r.process_id).map((r) => r.process_id))];
  if (!leadIds.length && !caseIds.length && !procIds.length) return;

  const [{ data: leads }, { data: cases }, { data: procs }] = await Promise.all([
    leadIds.length
      ? supabase.from('leads').select('id, lead_name').in('id', leadIds)
      : Promise.resolve({ data: [] } as any),
    caseIds.length
      ? supabase.from('legal_cases').select('id, title').in('id', caseIds)
      : Promise.resolve({ data: [] } as any),
    procIds.length
      ? supabase.from('lead_processes').select('id, title, process_number').in('id', procIds)
      : Promise.resolve({ data: [] } as any),
  ]);
  const leadMap = new Map((leads || []).map((l: any) => [l.id, l.lead_name]));
  const caseMap = new Map((cases || []).map((c: any) => [c.id, c.title]));
  const procMap = new Map((procs || []).map((p: any) => [p.id, p.title || p.process_number]));
  rows.forEach((r) => {
    if (!r.lead_name && r.lead_id) r.lead_name = leadMap.get(r.lead_id) || null;
    if (!r.case_title && r.case_id) r.case_title = caseMap.get(r.case_id) || null;
    if (!r.process_title && r.process_id) r.process_title = procMap.get(r.process_id) || null;
  });
}

/** IDs equivalentes da pessoa no Externo (auth_uuid_mapping cobre os dois sentidos). */
async function expandIds(anyIds: string[]): Promise<string[]> {
  if (!anyIds.length) return anyIds;
  const { data } = await supabase
    .from('auth_uuid_mapping').select('cloud_uuid, ext_uuid')
    .or(`cloud_uuid.in.(${anyIds.join(',')}),ext_uuid.in.(${anyIds.join(',')})`);
  const all = new Set(anyIds);
  (data || []).forEach((m) => { if (m.cloud_uuid) all.add(m.cloud_uuid); if (m.ext_uuid) all.add(m.ext_uuid); });
  return [...all];
}

/** Traduz um id do Externo pro UUID do Cloud — o chat interno guarda membros com Cloud UUID. */
async function toCloudUuid(id: string): Promise<string> {
  const { data } = await supabase
    .from('auth_uuid_mapping').select('cloud_uuid').eq('ext_uuid', id).maybeSingle();
  return data?.cloud_uuid || id;
}

interface PrevMetrics { passos: number; concluidas: number; ativo_seg: number; ocioso_seg: number }

/**
 * Métricas da pessoa no MESMO PONTO do período anterior (ex.: terça 12h da
 * semana passada), pra comparação dela com ela mesma — não só com os outros.
 */
async function personPrevMetrics(allIds: string[], nome: string, prevStart: Date, prevEnd: Date): Promise<PrevMetrics> {
  const who = whoFilter(allIds, nome);
  const [{ count: passos }, { count: concluidas }, { data: tempos }] = await Promise.all([
    allIds.length
      ? supabase.from('user_activity_log')
          .select('id', { count: 'exact', head: true })
          .eq('action_type', 'checklist_item_checked')
          .in('user_id', allIds)
          .gte('created_at', prevStart.toISOString()).lt('created_at', prevEnd.toISOString())
      : Promise.resolve({ count: 0 } as any),
    supabase.from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null).or(who)
      .gte('completed_at', prevStart.toISOString()).lt('completed_at', prevEnd.toISOString()),
    allIds.length
      ? supabase.from('activity_time_entries')
          .select('active_seconds, idle_seconds')
          .in('user_id', allIds)
          .gte('started_at', prevStart.toISOString()).lt('started_at', prevEnd.toISOString())
          .limit(2000)
      : Promise.resolve({ data: [] } as any),
  ]);
  const ativo = (tempos || []).reduce((s: number, t: any) => s + (t.active_seconds || 0), 0);
  const ocioso = (tempos || []).reduce((s: number, t: any) => s + (t.idle_seconds || 0), 0);
  return { passos: passos || 0, concluidas: concluidas || 0, ativo_seg: ativo, ocioso_seg: ocioso };
}

function diasAtraso(deadline: string): number {
  return Math.max(1, Math.round((Date.now() - new Date(deadline).getTime()) / 86400000));
}

/** A que a atividade está vinculada: caso/processo + lead, ou interna. */
function vinculo(a: { lead_name?: string | null; case_title?: string | null; process_title?: string | null }): string {
  const partes: string[] = [];
  if (a.case_title) partes.push(`caso "${a.case_title}"`);
  else if (a.process_title) partes.push(`processo "${a.process_title}"`);
  if (a.lead_name) partes.push(`lead ${a.lead_name}`);
  return partes.length ? partes.join(' do ') : 'atividade interna (sem lead/caso)';
}

/** Link curto clicável — /atv/:code resolve o prefixo do UUID no front. */
function atvLink(id: string): string {
  return `${APP_URL}/atv/${String(id).replace(/-/g, '').slice(0, 8)}`;
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
  const allIds = await expandIds(person.anyIds);
  const acts = await personActivities(allIds, nome, p_since);

  // Mesmo ponto do período anterior: [início anterior, início anterior + tempo já decorrido].
  const periodMs = period_label === 'hoje' ? 86400000
    : period_label === 'mês' || period_label === 'mes' ? 30 * 86400000
    : 7 * 86400000;
  const sinceDate = new Date(p_since);
  const elapsed = Math.max(0, Date.now() - sinceDate.getTime());
  const prevStart = new Date(sinceDate.getTime() - periodMs);
  const prevEnd = new Date(prevStart.getTime() + elapsed);
  const prevLabel = period_label === 'hoje' ? 'ontem no mesmo horário'
    : period_label === 'mês' || period_label === 'mes' ? 'mesmo ponto do mês passado'
    : 'mesmo ponto da semana passada';
  const prev = await personPrevMetrics(allIds, nome, prevStart, prevEnd);

  const prompt = [
    `PERÍODO: ${period_label || 'semana'} (desde ${p_since.slice(0, 10)})`,
    `PESSOA: ${nome} — posição ${idx + 1} de ${ranking.length} no ranking — regime: ${row.home_office ? 'home office' : 'escritório'}`,
    `NÚMEROS DELA AGORA: ${rowLine(row)}`,
    `ELA MESMA NO ${prevLabel.toUpperCase()}: ${prev.passos} passos, ${prev.concluidas} concluídas, ` +
      `tempo ativo ${seg(prev.ativo_seg)}, ocioso ${seg(prev.ocioso_seg)}`,
    ahead ? `NA FRENTE (posição ${idx}): ${ahead.nome} — ${rowLine(ahead)}` : `Ela é a LÍDER do ranking.`,
    behind ? `ATRÁS (posição ${idx + 2}): ${behind.nome} — ${rowLine(behind)}` : `Ela é a ÚLTIMA do ranking.`,
    ``,
    `ATIVIDADES DELA: ${acts.abertas} abertas no total.`,
    `ATRASADAS MAIS ANTIGAS (em ordem de urgência):`,
    ...(acts.atrasadas.length
      ? acts.atrasadas.map((a: any) =>
          `- ${a.title} — ${vinculo(a)} (${diasAtraso(a.deadline)} dias de atraso${a.priority ? `, prioridade ${a.priority}` : ''}) | link: ${atvLink(a.id)}`)
      : ['(nenhuma)']),
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

"analise" (para o diretor): responda a pergunta dele com base APENAS nos dados fornecidos, em português do Brasil, direto, máx ~120 palavras. Aponte qual critério está puxando a pessoa pra cima ou pra baixo e compare a pessoa COM ELA MESMA no período anterior (melhorou ou piorou, em quê). Se os dados não permitirem concluir a causa, diga o que os dados mostram e o que vale perguntar à pessoa. Não invente fatos.

"mensagem" (para enviar À PESSOA no chat interno e WhatsApp): escreva como escreveria o melhor gestor de um escritório jurídico de alta performance — direto, específico, respeitoso e com energia, SEM genérico motivacional. Fale diretamente com a pessoa (você).
FORMATO: a mensagem é lida de relance no celular. Seções curtas separadas por UMA linha em branco, cada seção começando com cabeçalho próprio: emoji + título em MAIÚSCULAS. De uma passada de olho a pessoa já deve saber do que se trata. Estrutura obrigatória, nesta ordem:
1. Primeira linha (sem cabeçalho): saudação de 1 frase reconhecendo algo REAL dos dados (uma atividade concluída pelo nome, uma melhora vs o período anterior). Se não houver nada, vá direto ao ponto sem elogio falso.
2. "📊 VOCÊ × VOCÊ MESMO" — números de agora vs o mesmo ponto do período anterior (passos, concluídas, tempo ativo), dizendo se evoluiu ou caiu (use ▲ e ▼).
3. "🏁 CORRIDA" — uma linha só: posição e quem está logo na frente/atrás — tempero, não o tema.
4. "🚨 PRIORIDADES DE HOJE" — lista numerada com as 2 ou 3 atividades atrasadas mais antigas, em ordem de urgência. Cada item traz: o nome da atividade, A QUEM ela está vinculada COPIADO dos dados (lead, caso, processo ou "interna" — nunca invente), os dias de atraso e, na linha logo abaixo do item, o link fornecido nos dados copiado LITERALMENTE (nunca crie, encurte ou altere um link). Isso é o coração da mensagem.
5. "⚙️ HÁBITO" — o hábito operacional a corrigir (marcar os passos do checklist ao concluir cada etapa / usar o cronômetro), em 1-2 frases, com o porquê de contar no ranking.
6. "🤝" + fechamento de 1 frase colocando-se à disposição pra destravar qualquer coisa.
Máx ~180 palavras (links não contam no limite). Emojis só nos cabeçalhos das seções (no máximo 1 extra no corpo do texto).`,
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
    // Ela × ela mesma no mesmo ponto do período anterior (pro telão exibir).
    prev,
    prev_label: prevLabel,
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

/** Normaliza BR pra comparação: 55 + DDD + últimos 8 dígitos (ignora o nono dígito). */
function phoneKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const local = d.startsWith('55') ? d.slice(2) : d;
  return `55${local.slice(0, 2)}${local.slice(-8)}`;
}

/**
 * Manda texto pro WhatsApp pessoal do membro via UazAPI.
 * A instância de saída é a do PRÓPRIO remetente (owner_phone bate com o telefone
 * do perfil dele) ou a definida em COACH_WHATSAPP_INSTANCE — nunca uma instância
 * aleatória: a mensagem fala em nome do diretor.
 */
async function sendWhatsAppToMember(toUserId: string, text: string, senderId: string): Promise<{ ok: boolean; error?: string }> {
  const memberIds = await expandIds([toUserId]);
  const { data: memberProfiles } = await supabase
    .from('profiles').select('phone').in('user_id', memberIds);
  const phone = (memberProfiles || []).map((p) => (p.phone || '').replace(/\D/g, '')).find(Boolean) || '';
  if (!phone) return { ok: false, error: 'membro sem telefone cadastrado no perfil' };

  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url, owner_phone')
    .eq('is_active', true);
  const envName = process.env.COACH_WHATSAPP_INSTANCE;
  let inst = envName ? (instances || []).find((i) => i.instance_name === envName) : undefined;
  if (!inst) {
    const senderIds = await expandIds([senderId]);
    const { data: senderProfiles } = await supabase
      .from('profiles').select('phone').in('user_id', senderIds);
    const senderKey = (senderProfiles || []).map((p) => phoneKey(p.phone)).find(Boolean);
    if (senderKey) inst = (instances || []).find((i) => phoneKey(i.owner_phone) === senderKey);
  }
  if (!inst) {
    return {
      ok: false,
      error: 'instância do remetente não encontrada — cadastre o owner_phone da sua instância ou defina COACH_WHATSAPP_INSTANCE',
    };
  }

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
      // O chat interno guarda membros com o UUID do Cloud; to_user_id pode vir
      // do profiles do Externo (foi o bug que mandava a msg pra conversa invisível).
      const chatSenderId = await toCloudUuid(sender_id);
      const chatToId = await toCloudUuid(to_user_id);
      const convId = await findOrCreateDirectConversation(chatSenderId, chatToId);
      const { error } = await supabase.from('team_messages').insert({
        conversation_id: convId,
        sender_id: chatSenderId,
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
      results.whatsapp = await sendWhatsAppToMember(to_user_id, message, sender_id);
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
