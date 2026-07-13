/**
 * daily-team-report — Relatório diário de gestão por time.
 *
 * Para cada time com gestor definido em team_managers:
 *   1. Coleta as mensagens do chat interno (últimas 24h) dos membros + gestor
 *   2. Coleta estatísticas de atividades (abertas, atrasadas, concluídas 24h)
 *   3. Gera relatório via Claude (estrutural vs pontual, pendências, próximos passos, parecer)
 *   4. Posta num grupo "📊 {time}" (gestor + diretor)
 * Ao final, gera o relatório de diretoria (avaliação dos gestores) e posta
 * em "📊 Diretoria — Gestores" (só o diretor).
 *
 * Idempotente por dia (não reposta se já houver relatório nas últimas 20h).
 * Body: { force?: boolean } — força repostagem.
 * Custo: 1 chamada claude-sonnet por time + 1 da diretoria (~centavos/dia).
 */
import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { anthropicChat } from '../lib/anthropic';

// Fallback se org_directors estiver vazia
const FALLBACK_DIRECTOR_ID = process.env.REPORT_DIRECTOR_USER_ID || '79c5c9d1-8629-4831-83cf-c86a7178521c';
const REPORT_SENDER_NAME = '🤖 Relatório Diário';
const REPORT_MODEL = process.env.REPORT_MODEL || 'claude-sonnet-4-6';
const MAX_MSGS_PER_TEAM = 120;

interface MemberIdentity {
  authId: string | null;
  anyIds: string[]; // auth user_id + profile id (lead_activities usa os dois)
  name: string;
}

async function resolveMembers(rawIds: string[]): Promise<MemberIdentity[]> {
  if (!rawIds.length) return [];
  const { data: byUserId } = await supabase
    .from('profiles').select('id, user_id, full_name').in('user_id', rawIds);
  const { data: byId } = await supabase
    .from('profiles').select('id, user_id, full_name').in('id', rawIds);
  const profiles = [...(byUserId || []), ...(byId || [])];

  return rawIds.map((raw) => {
    const p = profiles.find((x) => x.user_id === raw || x.id === raw);
    return {
      authId: p?.user_id || raw,
      anyIds: [...new Set([raw, p?.user_id, p?.id].filter(Boolean))] as string[],
      name: p?.full_name || raw.slice(0, 8),
    };
  });
}

async function ensureGroupConversation(name: string, memberIds: string[]): Promise<string> {
  const { data: existing } = await supabase
    .from('team_conversations').select('id').eq('type', 'group').eq('name', name).maybeSingle();

  let convId: string = existing?.id;
  if (!convId) {
    const { data: created, error } = await supabase
      .from('team_conversations').insert({ type: 'group', name }).select('id').single();
    if (error) throw error;
    convId = created.id;
  }

  const { data: current } = await supabase
    .from('team_conversation_members').select('user_id').eq('conversation_id', convId);
  const have = new Set((current || []).map((m) => m.user_id));
  const toAdd = [...new Set(memberIds)].filter((id) => id && !have.has(id));
  if (toAdd.length) {
    await supabase.from('team_conversation_members')
      .insert(toAdd.map((user_id) => ({ conversation_id: convId, user_id })));
  }
  return convId;
}

async function alreadyPostedToday(convId: string): Promise<boolean> {
  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from('team_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', convId)
    .eq('sender_name', REPORT_SENDER_NAME)
    .gt('created_at', since);
  return (count || 0) > 0;
}

async function postReport(convId: string, senderId: string, content: string) {
  const { error } = await supabase.from('team_messages').insert({
    conversation_id: convId,
    sender_id: senderId,
    sender_name: REPORT_SENDER_NAME,
    content,
    message_type: 'text',
  });
  if (error) throw error;
  await supabase.from('team_conversations')
    .update({ updated_at: new Date().toISOString() }).eq('id', convId);
}

async function activityStats(anyIds: string[], names: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const base = () => supabase.from('lead_activities')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .or(`assigned_to.in.(${anyIds.join(',')}),assigned_to_name.in.("${names.map(n => n.replace(/"/g, '')).join('","')}")`);

  const [{ count: abertas }, { count: atrasadas }, { count: concluidas24h }] = await Promise.all([
    base().is('completed_at', null),
    base().is('completed_at', null).lt('deadline', today),
    supabase.from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .or(`assigned_to.in.(${anyIds.join(',')}),assigned_to_name.in.("${names.map(n => n.replace(/"/g, '')).join('","')}")`)
      .gt('completed_at', since24h),
  ]);

  const { data: topAtrasadas } = await supabase.from('lead_activities')
    .select('title, assigned_to_name, deadline')
    .is('deleted_at', null)
    .is('completed_at', null)
    .lt('deadline', today)
    .or(`assigned_to.in.(${anyIds.join(',')}),assigned_to_name.in.("${names.map(n => n.replace(/"/g, '')).join('","')}")`)
    .order('deadline', { ascending: true })
    .limit(10);

  return { abertas: abertas || 0, atrasadas: atrasadas || 0, concluidas24h: concluidas24h || 0, topAtrasadas: topAtrasadas || [] };
}

export const handler = async (req: Request, res: Response) => {
  const force = Boolean(req.body?.force);
  const results: Record<string, string> = {};

  try {
    const { data: managerRows, error: mgrError } = await supabase
      .from('team_managers').select('*');
    if (mgrError) throw mgrError;
    // Linhas podem existir só pelo setor — relatório exige gestor definido
    const managers = (managerRows || []).filter((m) => m.manager_user_id);
    if (!managers.length) {
      return res.json({ success: true, message: 'Nenhum time com gestor definido em team_managers.' });
    }

    // Setores — gerente do setor entra no grupo de relatório dos times dele
    const { data: sectorRows } = await supabase
      .from('org_sectors').select('name, manager_user_id, manager_name');
    const sectorByName = new Map((sectorRows || []).map((s) => [s.name, s]));

    // Diretoria — gere os gestores; entra em todos os grupos de relatório
    const { data: directorRows } = await supabase.from('org_directors').select('user_id, name');
    const directorIds = (directorRows || []).map((d) => d.user_id);
    if (!directorIds.length) directorIds.push(FALLBACK_DIRECTOR_ID);
    const reportSenderId = directorIds[0];

    const { data: teams } = await supabase.from('teams').select('id, name, description');
    const { data: allTeamMembers } = await supabase.from('team_members').select('team_id, user_id');

    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: allMessages } = await supabase
      .from('team_messages')
      .select('conversation_id, sender_id, sender_name, content, message_type, is_urgent, created_at')
      .gt('created_at', since24h)
      .order('created_at', { ascending: true })
      .limit(1000);

    const convIds = [...new Set((allMessages || []).map((m) => m.conversation_id))];
    const { data: convs } = convIds.length
      ? await supabase.from('team_conversations').select('id, type, name').in('id', convIds)
      : { data: [] as any[] };
    const convLabel = new Map((convs || []).map((c) => [c.id, c.type === 'group' ? (c.name || 'grupo') : 'direta']));

    const directorSummaries: string[] = [];

    for (const mgr of managers) {
      const team = (teams || []).find((t) => t.name === mgr.team_name || t.id === mgr.team_id);
      const teamLabel = mgr.team_name;
      try {
        const rawMemberIds = (allTeamMembers || [])
          .filter((tm) => team && tm.team_id === team.id)
          .map((tm) => tm.user_id);
        const members = await resolveMembers([...new Set([...rawMemberIds, mgr.manager_user_id])]);
        const memberNames = members.map((m) => m.name);
        const anyIds = [...new Set(members.flatMap((m) => m.anyIds))];
        const authIds = [...new Set(members.map((m) => m.authId).filter(Boolean))] as string[];

        const teamMsgs = (allMessages || [])
          .filter((m) => anyIds.includes(m.sender_id))
          .slice(-MAX_MSGS_PER_TEAM)
          .map((m) => `[${convLabel.get(m.conversation_id) || 'conversa'}] ${m.sender_name}${m.is_urgent ? ' (URGENTE)' : ''}: ${(m.content || `(${m.message_type})`).slice(0, 300)}`);

        const stats = await activityStats(anyIds, memberNames);

        const prompt = [
          `TIME: ${teamLabel}${team?.description ? ` — ${team.description}` : ''}`,
          `GESTOR: ${mgr.manager_name || mgr.manager_user_id}`,
          `MEMBROS: ${memberNames.join(', ')}`,
          ``,
          `ATIVIDADES: ${stats.abertas} abertas, ${stats.atrasadas} atrasadas, ${stats.concluidas24h} concluídas nas últimas 24h.`,
          `ATRASADAS MAIS ANTIGAS:`,
          ...stats.topAtrasadas.map((a: any) => `- ${a.title} (${a.assigned_to_name}, venceu ${a.deadline})`),
          ``,
          `MENSAGENS DO CHAT INTERNO (últimas 24h) enviadas por pessoas do time:`,
          ...(teamMsgs.length ? teamMsgs : ['(nenhuma mensagem nas últimas 24h)']),
        ].join('\n');

        const completion = await anthropicChat({
          model: REPORT_MODEL,
          max_tokens: 1500,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: `Você gera o relatório diário de gestão de um time de escritório jurídico brasileiro. Responda em português do Brasil, texto puro (sem markdown de cabeçalho #), máximo ~450 palavras, direto e sem floreio. Estrutura obrigatória:\n📊 RELATÓRIO DIÁRIO — {nome do time} ({data de hoje})\n\n1️⃣ RESUMO DO DIA (o que aconteceu no chat e nas atividades)\n2️⃣ PROBLEMAS: ESTRUTURAIS vs PONTUAIS (classifique cada um)\n3️⃣ PENDÊNCIAS (o que ficou sem resposta ou sem conclusão)\n4️⃣ PRÓXIMOS PASSOS (acionáveis, com responsável)\n5️⃣ PARECER SOBRE A GESTÃO (avalie objetivamente a atuação do gestor: cobrou? respondeu? registrou? atividades de monitoramento em dia?)\nSe não houve mensagens, diga isso explicitamente e avalie só pelas atividades. Não invente fatos que não estejam nos dados.`,
            },
            { role: 'user', content: prompt },
          ],
        });

        const report = completion?.choices?.[0]?.message?.content?.trim();
        if (!report) throw new Error('LLM não retornou conteúdo');

        const sector = mgr.sector_name ? sectorByName.get(mgr.sector_name) : null;
        const convId = await ensureGroupConversation(
          `📊 ${teamLabel}`,
          [mgr.manager_user_id, ...(sector?.manager_user_id ? [sector.manager_user_id] : []), ...directorIds],
        );

        if (!force && (await alreadyPostedToday(convId))) {
          results[teamLabel] = 'já postado hoje (use force pra repostar)';
        } else {
          await postReport(convId, reportSenderId, report);
          results[teamLabel] = 'ok';
        }

        directorSummaries.push(
          `SETOR ${mgr.sector_name || 'Sem setor'} | TIME ${teamLabel} (gestor: ${mgr.manager_name}): ${stats.atrasadas} atividades atrasadas, ` +
          `${stats.concluidas24h} concluídas 24h, ${teamMsgs.length} mensagens no chat. ` +
          `Mensagens do gestor: ${teamMsgs.filter((m) => m.includes(mgr.manager_name || '###')).length}.\n${report.slice(0, 800)}`
        );
      } catch (err) {
        console.error(`[daily-team-report] Time ${teamLabel} falhou:`, err);
        results[teamLabel] = `erro: ${err instanceof Error ? err.message : 'desconhecido'}`;
      }
    }

    // Relatório de diretoria — avaliação dos gestores
    try {
      const completion = await anthropicChat({
        model: REPORT_MODEL,
        max_tokens: 1800,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `Você assessora o diretor de um escritório jurídico brasileiro que gere os gestores de time. Com base nos relatórios de cada time abaixo (cada um indica o SETOR a que o time pertence), escreva o RELATÓRIO DE DIRETORIA do dia, em português do Brasil, texto puro, máximo ~500 palavras:\n📊 DIRETORIA — GESTORES ({data de hoje})\n\n• VISÃO POR SETOR (1-2 linhas por setor: situação geral)\n• RANKING DOS GESTORES do dia (melhor → pior, com 1 linha de justificativa cada)\n• ALERTAS (times sem gestão ativa, atrasos crescendo, riscos)\n• ONDE O DIRETOR DEVE AGIR AMANHÃ (máx. 3 itens, específicos)\nSem floreio, sem repetir os relatórios inteiros.`,
          },
          { role: 'user', content: directorSummaries.join('\n\n---\n\n') || 'Nenhum dado de time disponível.' },
        ],
      });
      const directorReport = completion?.choices?.[0]?.message?.content?.trim();
      if (directorReport) {
        const convId = await ensureGroupConversation('📊 Diretoria — Gestores', directorIds);
        if (force || !(await alreadyPostedToday(convId))) {
          await postReport(convId, reportSenderId, directorReport);
          results['__diretoria__'] = 'ok';
        } else {
          results['__diretoria__'] = 'já postado hoje';
        }
      }
    } catch (err) {
      console.error('[daily-team-report] Relatório de diretoria falhou:', err);
      results['__diretoria__'] = `erro: ${err instanceof Error ? err.message : 'desconhecido'}`;
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('[daily-team-report] Error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      results,
    });
  }
};
