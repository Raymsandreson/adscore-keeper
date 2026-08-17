/**
 * daily-team-report — Relatório diário de gestão por time.
 *
 * Para cada time com gestor definido em team_managers:
 *   1. Coleta as mensagens do chat interno (últimas 24h) dos membros + gestor
 *   2. Coleta estatísticas de atividades (abertas, atrasadas, concluídas 24h)
 *   2b. Lê o FOCO do gestor no mês (RPC manager_focus_status): % do que ele
 *       concluiu dentro da própria área e, na carteira processual, quantos
 *       processos saíram por acordo ou execução. Entra no parecer de gestão e
 *       vira uma seção do relatório de diretoria.
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
import { aiChat } from '../lib/gemini';

// Fallback se org_directors estiver vazia
const FALLBACK_DIRECTOR_ID = process.env.REPORT_DIRECTOR_USER_ID || '79c5c9d1-8629-4831-83cf-c86a7178521c';
const REPORT_SENDER_NAME = '🤖 Relatório Diário';
// aiChat roteia por prefixo: google/* → Gemini (GOOGLE_AI_API_KEY, com crédito),
// claude-* → Anthropic (sem crédito em jul/2026). Trocar = setar REPORT_MODEL.
const REPORT_MODEL = process.env.REPORT_MODEL || 'google/gemini-3.6-flash';
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

/** Linha da RPC manager_focus_status (ver migration 20260817120000). */
interface ManagerFocus {
  manager_user_id: string;
  nome: string | null;
  configurado: boolean;
  focus_label: string | null;
  min_percent: number | null;
  concluidas: number;
  no_foco: number;
  pct: number | null;
  atingiu: boolean | null;
  fora: { tipo: string; label: string; n: number }[];
  resgatadas_pelo_texto: number;
  track_process_exits: boolean;
  exit_target: number | null;
  min_exit_percent: number | null;
  processos_carteira: number;
  entradas: number;
  saidas: number;
  saidas_por_acordo: number;
  saidas_por_execucao: number;
  pct_saida_carteira: number | null;
  vazao_pct: number | null;
}

/**
 * Foco dos gerentes no MÊS corrente, por Cloud UUID (a mesma chave de
 * team_managers.manager_user_id). Mês, e não 24h: foco é padrão de alocação —
 * um dia atípico não diz nada, e com 24h a conta oscilaria a cada manhã.
 */
async function fetchManagerFocus(): Promise<Map<string, ManagerFocus>> {
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const { data, error } = await supabase.rpc('manager_focus_status', {
    p_since: since.toISOString(),
    p_until: new Date().toISOString(),
  });
  if (error) {
    // Relatório não pode cair por causa do foco — segue sem o bloco.
    console.error('[daily-team-report] manager_focus_status falhou:', error.message);
    return new Map();
  }
  return new Map(((data as ManagerFocus[]) || []).map((f) => [f.manager_user_id, f]));
}

/** Bloco de texto do foco para o prompt. Vazio quando não há o que dizer. */
function focusLines(focus: ManagerFocus | undefined): string[] {
  if (!focus) return [];
  const out: string[] = [];
  if (focus.configurado && focus.pct !== null) {
    const veredito = focus.atingiu ? 'dentro do piso' : 'ABAIXO DO PISO';
    out.push(
      `FOCO DO GESTOR (mês): ${focus.pct}% do que ele concluiu foi da área "${focus.focus_label}" ` +
      `— piso ${focus.min_percent}%, ${veredito} (${focus.no_foco} de ${focus.concluidas} atividades).`,
    );
    const fora = (focus.fora || []).slice(0, 3);
    if (!focus.atingiu && fora.length) {
      out.push(`ONDE O FOCO VAZOU: ${fora.map((f) => `${f.label} (${f.n})`).join(', ')}.`);
    }
  } else if (focus.configurado) {
    out.push(`FOCO DO GESTOR (mês): nenhuma atividade concluída na área "${focus.focus_label}".`);
  }
  if (focus.track_process_exits) {
    out.push(
      `ENTRADA E SAÍDA DE PROCESSO (mês, carteira de ${focus.processos_carteira}): ` +
      `entraram ${focus.entradas}, saíram ${focus.saidas}` +
      (focus.exit_target ? ` de uma meta de ${focus.exit_target}` : '') +
      ` — ${focus.saidas_por_acordo} por acordo, ${focus.saidas_por_execucao} por execução.` +
      (focus.vazao_pct !== null
        ? ` Vazão ${focus.vazao_pct}% (saiu ÷ entrou): ${
            focus.vazao_pct >= 100 ? 'a fila diminuiu' : `a fila cresceu em ${focus.entradas - focus.saidas}`
          }.`
        : ''),
    );
    if (focus.min_exit_percent !== null && focus.pct_saida_carteira !== null) {
      out.push(
        `PISO DE SAÍDA: ${focus.pct_saida_carteira}% da carteira saiu no mês, ` +
        `piso ${focus.min_exit_percent}% — ${
          focus.pct_saida_carteira >= focus.min_exit_percent ? 'dentro' : 'ABAIXO'
        }.`,
      );
    }
  }
  return out;
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

    // Diretoria — gere os gestores; entra em todos os grupos de relatório
    const { data: directorRows } = await supabase.from('org_directors').select('user_id, name');
    const directorIds = (directorRows || []).map((d) => d.user_id);
    if (!directorIds.length) directorIds.push(FALLBACK_DIRECTOR_ID);
    const reportSenderId = directorIds[0];

    // Foco de cada gerente na área dele (uma chamada para todos).
    const focusByManager = await fetchManagerFocus();

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
        // Fonte preferida: grupo "👥 {time}" sincronizado pela aba Times (dados atuais).
        // Fallback: team_members do Externo (pode estar defasado vs Cloud).
        let rawMemberIds: string[] = [];
        const { data: memberConv } = await supabase
          .from('team_conversations').select('id')
          .eq('type', 'group').eq('name', `👥 ${teamLabel}`).maybeSingle();
        if (memberConv?.id) {
          const { data: convMembers } = await supabase
            .from('team_conversation_members').select('user_id')
            .eq('conversation_id', memberConv.id);
          rawMemberIds = (convMembers || []).map((m) => m.user_id);
        }
        if (!rawMemberIds.length) {
          rawMemberIds = (allTeamMembers || [])
            .filter((tm) => team && tm.team_id === team.id)
            .map((tm) => tm.user_id);
        }
        const members = await resolveMembers([...new Set([...rawMemberIds, mgr.manager_user_id])]);

        // Cargos (quem faz o quê)
        const { data: cargoRows } = await supabase
          .from('team_member_cargos').select('user_id, cargo').eq('team_name', teamLabel);
        const cargoFor = (m: MemberIdentity) =>
          (cargoRows || []).find((c) => m.anyIds.includes(c.user_id))?.cargo || null;
        const memberNames = members.map((m) => m.name);
        const memberNamesWithCargo = members.map((m) => {
          const cargo = cargoFor(m);
          return cargo ? `${m.name} (${cargo})` : m.name;
        });
        const anyIds = [...new Set(members.flatMap((m) => m.anyIds))];
        const authIds = [...new Set(members.map((m) => m.authId).filter(Boolean))] as string[];

        const teamMsgs = (allMessages || [])
          .filter((m) => anyIds.includes(m.sender_id))
          .slice(-MAX_MSGS_PER_TEAM)
          .map((m) => `[${convLabel.get(m.conversation_id) || 'conversa'}] ${m.sender_name}${m.is_urgent ? ' (URGENTE)' : ''}: ${(m.content || `(${m.message_type})`).slice(0, 300)}`);

        const stats = await activityStats(anyIds, memberNames);
        const focus = focusByManager.get(mgr.manager_user_id);
        const focusBlock = focusLines(focus);

        const prompt = [
          `TIME: ${teamLabel}${team?.description ? ` — ${team.description}` : ''}`,
          `GESTOR: ${mgr.manager_name || mgr.manager_user_id}`,
          `MEMBROS (cargo): ${memberNamesWithCargo.join(', ')}`,
          ``,
          ...(focusBlock.length ? [...focusBlock, ``] : []),
          `ATIVIDADES: ${stats.abertas} abertas, ${stats.atrasadas} atrasadas, ${stats.concluidas24h} concluídas nas últimas 24h.`,
          `ATRASADAS MAIS ANTIGAS:`,
          ...stats.topAtrasadas.map((a: any) => `- ${a.title} (${a.assigned_to_name}, venceu ${a.deadline})`),
          ``,
          `MENSAGENS DO CHAT INTERNO (últimas 24h) enviadas por pessoas do time:`,
          ...(teamMsgs.length ? teamMsgs : ['(nenhuma mensagem nas últimas 24h)']),
        ].join('\n');

        const completion = await aiChat({
          model: REPORT_MODEL,
          max_tokens: 1500,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: `Você gera o relatório diário de gestão de um time de escritório jurídico brasileiro. Responda em português do Brasil, texto puro (sem markdown de cabeçalho #), máximo ~450 palavras, direto e sem floreio. Estrutura obrigatória:\n📊 RELATÓRIO DIÁRIO — {nome do time} ({data de hoje})\n\n1️⃣ RESUMO DO DIA (o que aconteceu no chat e nas atividades)\n2️⃣ PROBLEMAS: ESTRUTURAIS vs PONTUAIS (classifique cada um)\n3️⃣ PENDÊNCIAS (o que ficou sem resposta ou sem conclusão)\n4️⃣ PRÓXIMOS PASSOS (acionáveis, com responsável)\n5️⃣ PARECER SOBRE A GESTÃO (avalie objetivamente a atuação do gestor: cobrou? respondeu? registrou? atividades de monitoramento em dia?)\nSe os dados trouxerem FOCO DO GESTOR, o parecer TEM que dizer se ele está dentro ou abaixo do piso da área dele e, quando abaixo, apontar onde o foco vazou. Se trouxerem ENTRADA E SAÍDA DE PROCESSO, trate isso como o resultado principal do gestor processual: quantos entraram, quantos saíram (por acordo e por execução) e o que a vazão diz — abaixo de 100% a fila cresce, e processo que não sai trava a entrada de caso novo.\nSe não houve mensagens, diga isso explicitamente e avalie só pelas atividades. Não invente fatos que não estejam nos dados.`,
            },
            { role: 'user', content: prompt },
          ],
        });

        const report = completion?.choices?.[0]?.message?.content?.trim();
        if (!report) throw new Error('LLM não retornou conteúdo');

        // Modelo plano: grupo do relatório = gestor do time + diretoria.
        const convId = await ensureGroupConversation(
          `📊 ${teamLabel}`,
          [mgr.manager_user_id, ...directorIds],
        );

        if (!force && (await alreadyPostedToday(convId))) {
          results[teamLabel] = 'já postado hoje (use force pra repostar)';
        } else {
          await postReport(convId, reportSenderId, report);
          results[teamLabel] = 'ok';
        }

        directorSummaries.push(
          `TIME ${teamLabel} (gestor: ${mgr.manager_name}): ${stats.atrasadas} atividades atrasadas, ` +
          `${stats.concluidas24h} concluídas 24h, ${teamMsgs.length} mensagens no chat. ` +
          `Mensagens do gestor: ${teamMsgs.filter((m) => m.includes(mgr.manager_name || '###')).length}.` +
          (focusBlock.length ? `\n${focusBlock.join(' ')}` : '') +
          `\n${report.slice(0, 800)}`
        );
      } catch (err) {
        console.error(`[daily-team-report] Time ${teamLabel} falhou:`, err);
        results[teamLabel] = `erro: ${err instanceof Error ? err.message : 'desconhecido'}`;
      }
    }

    // Relatório de diretoria — avaliação dos gestores
    try {
      const completion = await aiChat({
        model: REPORT_MODEL,
        max_tokens: 1800,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `Você assessora o diretor de um escritório jurídico brasileiro que gere diretamente os gestores de time. Com base nos relatórios de cada time abaixo, escreva o RELATÓRIO DE DIRETORIA do dia, em português do Brasil, texto puro, máximo ~500 palavras:\n📊 DIRETORIA — GESTORES ({data de hoje})\n\n• VISÃO GERAL (1-2 linhas: situação do dia entre os times)\n• RANKING DOS GESTORES do dia (melhor → pior, com 1 linha de justificativa cada)\n• FOCO E VAZÃO DOS GESTORES (só com os dados de FOCO DO GESTOR / ENTRADA E SAÍDA DE PROCESSO recebidos: quem está abaixo do piso da própria área, com o número, e o entrou × saiu da carteira com a vazão. Gestor sem esses dados fica de fora desta seção.)\n• ALERTAS (times sem gestão ativa, atrasos crescendo, riscos)\n• ONDE O DIRETOR DEVE AGIR AMANHÃ (máx. 3 itens, específicos)\nSem floreio, sem repetir os relatórios inteiros.`,
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
