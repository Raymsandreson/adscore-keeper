/**
 * report-query — Gerador de relatórios por IA (seção Relatórios).
 *
 * Fluxo:
 *   1. Valida o JWT do Cloud (/auth/v1/user) → identidade real do usuário.
 *   2. Autoriza: só diretoria (org_directors), gestores (team_managers),
 *      quem estiver em ai_user_roles, ou os e-mails admin (bootstrap).
 *   3. Respeita ai_user_limits (bloqueio + teto diário de consultas).
 *   4. Claude (Sonnet) traduz a pergunta em PT → um SELECT, usando um catálogo
 *      curado das tabelas de negócio (só leitura, whitelist).
 *   5. Executa via RPC ai_safe_query (transação READ ONLY, timeout 15s).
 *   6. Mascara campos sensíveis (CPF, RG, conta, etc.) antes de devolver.
 *   7. Registra tudo em ai_query_log (auditoria).
 *
 * Só devolve dados pra tela — não há geração de arquivo/download.
 * Custo: ~1 chamada Sonnet por pergunta (+1 retry se a SQL falhar).
 */
import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { anthropicChat } from '../lib/anthropic';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const REPORT_MODEL = process.env.REPORT_QUERY_MODEL || 'claude-sonnet-4-6';
// Bootstrap: e-mails que sempre têm acesso (dono/diretoria), separados por vírgula.
const ADMIN_EMAILS = (process.env.REPORT_ADMIN_EMAILS || 'processual@rprudencioadv.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const DEFAULT_DAILY_LIMIT = Number(process.env.REPORT_DAILY_LIMIT || 100);

// ============================================================
// Catálogo de schema — SÓ tabelas de negócio, colunas curadas.
// A IA só conhece o que está aqui. Nada de auth/whatsapp_messages/etc.
// ============================================================
const SCHEMA_CATALOG = `
Banco Postgres (Supabase) de um escritório de advocacia brasileiro. Todas as tabelas no schema public.
Regras de ouro:
- SOMENTE SELECT. Nunca escreva. A conexão é read-only.
- SEMPRE filtre "deleted_at IS NULL" nas tabelas que têm essa coluna (registros apagados).
- Para filtrar por NOME de pessoa (responsável, cliente, acolhedor), use ILIKE '%termo%' (case-insensitive). Seja tolerante a acento e nome parcial.
- Datas em português: "hoje", "essa semana", "esse mês", "atrasado" (deadline < CURRENT_DATE). Use CURRENT_DATE / date_trunc.
- Sempre inclua colunas legíveis (nomes, títulos, datas, status) — evite despejar só IDs.
- Ordene por algo útil (data desc, deadline asc) e use LIMIT razoável (ex: 500). Para "relação completa/todos", use LIMIT 5000.
- Nunca invente coluna. Use só as listadas abaixo.

== TABELAS ==

leads (16k) — leads do CRM / clientes captados. tem deleted_at.
  id, lead_name, lead_phone, lead_email, status, lead_status, source, city, state,
  case_type, victim_name, accident_date, cpf, rg, created_at, became_client_date,
  processual_responsible_id (uuid → profiles.user_id: O RESPONSÁVEL PROCESSUAL do cliente/lead),
  acolhedor (texto), board_id (uuid→kanban_boards), lead_number.
  IMPORTANTE: o responsável processual do escritório fica AQUI, no lead (processual_responsible_id),
  e é herdado pelos processos e casos daquele lead (via lead_id). Sempre junte por profiles.user_id.

lead_activities (30k) — ATIVIDADES/tarefas. tem deleted_at.
  id, title, description, activity_type, status, priority, deadline, notification_date,
  completed_at, completed_by_name, what_was_done, next_steps,
  assigned_to (uuid→profiles), assigned_to_name (texto: RESPONSÁVEL principal),
  assigned_to_names (text[]: responsáveis quando em grupo), lead_name, case_title, process_title,
  created_at, is_management. Responsável = assigned_to_name (ou algum de assigned_to_names).
  "atrasada" = completed_at IS NULL AND deadline < CURRENT_DATE.

legal_cases (1.5k) — CASOS jurídicos. tem deleted_at.
  id, case_number, title, description, status, outcome, outcome_date, benefit_type,
  acolhedor, lead_id (→leads), nucleus_id (→specialized_nuclei), created_at, closed_at.
  RESPONSÁVEL: assigned_to está vazio; use o responsável do LEAD
  (legal_cases.lead_id → leads.processual_responsible_id → profiles.user_id).

lead_processes (1.5k) — PROCESSOS judiciais vinculados a lead. tem deleted_at.
  id, process_number, title, status, process_type, tribunal, tribunal_sigla, grau, classe, area,
  valor_causa, valor_causa_formatado, polo_ativo, polo_passivo, cliente_polo, fee_percentage,
  lead_id (→leads), case_id, data_ultima_movimentacao, quantidade_movimentacoes,
  arquivado, segredo_justica, created_at, started_at.
  RESPONSÁVEL: NÃO use responsible_user_id (quase sempre nulo). O responsável vem do LEAD:
  junte lead_processes.lead_id → leads.id → leads.processual_responsible_id → profiles.user_id.

inss_admin_processes (600) — PROCESSOS ADMINISTRATIVOS INSS. tem deleted_at.
  id, requerimento_number, benefit_number, current_status, benefit_type,
  nome_segurado, cpf_segurado, protocol_date, case_id, lead_id, last_email_at, created_at.

hearings (500) — AUDIÊNCIAS. tem deleted_at.
  id, process_number, hearing_type, category, hearing_date, hearing_time, status, location,
  assigned_user_id (texto), lead_id, legal_case_id, created_at.

case_process_tracking (2k) — controle de processos BPC/acolhimento (planilha importada).
  id, cliente, caso, cpf, tipo, acolhedor, numero_processo, pendencia, status_processo,
  data_protocolo_cancelamento, protocolado, tempo_dias, data_decisao_final, pago_acolhedor, created_at.
  (não tem deleted_at)

process_movements (250) — marcos/movimentações processuais (append-only).
  id, process_id (→lead_processes), lead_id, numero_cnj, tipo_movimentacao, marco_ordem,
  data_movimentacao, valor_indenizacao_fixado, descricao, fonte, created_at. (sem deleted_at)

contacts (26k) — CONTATOS (agenda ampla, redes). tem deleted_at.
  id, full_name, phone, email, city, state, classification, profession, cpf, rg,
  lead_id, converted_to_lead_at, created_at. (não confundir com leads)

profiles (2.7k) — USUÁRIOS/equipe (para resolver responsáveis por nome).
  id, user_id, full_name, email, oab_number, oab_uf, treatment_title.
  Para achar um responsável por nome: filtre profiles.full_name ILIKE '%nome%' e junte pelo id
  correspondente (assigned_to / responsible_user_id / assigned_to em legal_cases costumam referenciar profiles.id;
  quando não casar por id, tente também a coluna de texto *_name).

specialized_nuclei — núcleos. id, name.
kanban_boards — funis/quadros. id, name, board_type.
activity_types — tipos de atividade. id, key, label.

== DICAS DE JOIN P/ RESPONSÁVEL (padrões testados neste banco) ==
- Processos de um responsável (ex: Gisele) — responsável vem do LEAD via profiles.user_id:
    SELECT p.process_number, p.title, p.status, p.tribunal, l.lead_name AS cliente, pr.full_name AS responsavel
    FROM lead_processes p
    JOIN leads l ON l.id = p.lead_id
    JOIN profiles pr ON pr.user_id = l.processual_responsible_id
    WHERE p.deleted_at IS NULL AND l.deleted_at IS NULL AND pr.full_name ILIKE '%gisele%'
    ORDER BY p.created_at DESC LIMIT 500;
- Casos de um responsável — mesmo padrão via lead:
    SELECT c.case_number, c.title, c.status, l.lead_name AS cliente, pr.full_name AS responsavel
    FROM legal_cases c
    JOIN leads l ON l.id = c.lead_id
    JOIN profiles pr ON pr.user_id = l.processual_responsible_id
    WHERE c.deleted_at IS NULL AND l.deleted_at IS NULL AND pr.full_name ILIKE '%nome%'
    ORDER BY c.created_at DESC LIMIT 500;
- Atividades de um responsável (ex: João Manoel) — o nome já está no texto da própria atividade:
    SELECT a.title, a.status, a.deadline, a.assigned_to_name, a.lead_name
    FROM lead_activities a
    WHERE a.deleted_at IS NULL
      AND (a.assigned_to_name ILIKE '%joão manoel%' OR EXISTS (
            SELECT 1 FROM unnest(a.assigned_to_names) n WHERE n ILIKE '%joão manoel%'))
    ORDER BY a.deadline ASC NULLS LAST LIMIT 500;
- Clientes/leads de um responsável: leads l JOIN profiles pr ON pr.user_id = l.processual_responsible_id WHERE pr.full_name ILIKE '%nome%'.
`.trim();

const SYSTEM_PROMPT = `Você é um gerador de relatórios SQL para um escritório de advocacia brasileiro.
Recebe uma pergunta em português e devolve UMA consulta SQL (SELECT) que responde exatamente ao pedido,
usando apenas o catálogo de schema fornecido. Chame sempre a ferramenta emit_sql.

${SCHEMA_CATALOG}

Nunca use INSERT/UPDATE/DELETE/DDL. Nunca acesse auth, vault, pg_catalog, information_schema, whatsapp_messages.
Se o pedido for ambíguo, faça a interpretação mais útil e explique a suposição no campo explanation.`;

const emitSqlTool = {
  type: 'function' as const,
  function: {
    name: 'emit_sql',
    description: 'Emite a consulta SQL (SELECT) que responde ao pedido do usuário.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título curto do relatório em português (ex: "Processos da Gisele").' },
        sql: { type: 'string', description: 'A consulta SQL (SELECT/WITH) completa, pronta para rodar.' },
        explanation: { type: 'string', description: 'Explicação curta em português do que a consulta faz e suposições feitas.' },
      },
      required: ['title', 'sql', 'explanation'],
    },
  },
};

// ============================================================
// Máscara de dados sensíveis (LGPD) — aplicada em qualquer coluna
// cujo NOME sugira dado sensível, seja qual for a SQL gerada.
// ============================================================
const SENSITIVE_COL = /(^|_)(cpf|cnpj|cpf_cnpj|rg|senha|senha_gov|password|token|pix|iban|conta|agencia|cartao|card|documento|doc_numero)($|_)/i;

function maskValue(v: unknown): string {
  const s = String(v ?? '');
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 4) {
    // mostra só os 2 últimos dígitos
    return s.replace(/\d(?=\d{2})/g, '*');
  }
  if (s.length <= 2) return s ? '***' : s;
  return s.slice(0, 1) + '***';
}

function maskRows(rows: any[]): any[] {
  if (!Array.isArray(rows) || !rows.length) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(row)) {
      out[k] = SENSITIVE_COL.test(k) && val != null && val !== '' ? maskValue(val) : val;
    }
    return out;
  });
}

// ============================================================
// Auth
// ============================================================
async function verifyCloudJwt(authHeader: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token === CLOUD_ANON_KEY) return null;
  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
    });
    if (!r.ok) return null;
    const u: any = await r.json().catch(() => null);
    if (!u?.id) return null;
    return { id: u.id, email: (u.email || '').toLowerCase() };
  } catch {
    return null;
  }
}

async function isAuthorized(userId: string, email: string): Promise<boolean> {
  if (email && ADMIN_EMAILS.includes(email)) return true;
  // diretoria
  const { data: dir } = await supabase.from('org_directors').select('user_id').eq('user_id', userId).limit(1);
  if (dir && dir.length) return true;
  // gestores
  const { data: mgr } = await supabase
    .from('team_managers').select('manager_user_id').eq('manager_user_id', userId).limit(1);
  if (mgr && mgr.length) return true;
  // adicionados manualmente
  const orClauses = [`user_id.eq.${userId}`];
  if (email) orClauses.push(`user_email.eq.${email}`);
  const { data: role } = await supabase
    .from('ai_user_roles').select('role').or(orClauses.join(',')).limit(1);
  if (role && role.length) return true;
  return false;
}

/** Checa bloqueio + teto diário. Retorna motivo se barrado, senão null. */
async function checkLimits(userId: string, email: string): Promise<string | null> {
  const orClauses = [`user_id.eq.${userId}`];
  if (email) orClauses.push(`user_email.eq.${email}`);
  const { data: lim } = await supabase
    .from('ai_user_limits').select('is_blocked, daily_query_limit').or(orClauses.join(',')).maybeSingle();
  if (lim?.is_blocked) return 'Seu acesso ao gerador de relatórios está bloqueado. Fale com a diretoria.';
  const dailyLimit = lim?.daily_query_limit ?? DEFAULT_DAILY_LIMIT;
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('ai_query_log').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since.toISOString());
  if ((count || 0) >= dailyLimit) {
    return `Você atingiu o limite de ${dailyLimit} relatórios por dia.`;
  }
  return null;
}

async function logQuery(entry: Record<string, unknown>) {
  try {
    await supabase.from('ai_query_log').insert(entry);
  } catch (e) {
    console.warn('[report-query] falha ao gravar ai_query_log:', e instanceof Error ? e.message : e);
  }
}

// ============================================================
// Handler
// ============================================================
export const handler = async (req: Request, res: Response) => {
  const started = Date.now();
  const question: string = (req.body?.question || '').toString().trim();
  const history: Array<{ role: string; content: string }> = Array.isArray(req.body?.history) ? req.body.history : [];

  const user = await verifyCloudJwt(req.headers['authorization'] as string | undefined);
  if (!user) {
    return res.status(401).json({ success: false, error: 'unauthorized', message: 'Sessão inválida. Faça login novamente.' });
  }

  const authorized = await isAuthorized(user.id, user.email);
  if (!authorized) {
    return res.status(403).json({
      success: false, error: 'forbidden',
      message: 'Você não tem acesso ao gerador de relatórios. Ele é restrito à diretoria e gestores.',
    });
  }

  if (!question) {
    return res.status(400).json({ success: false, error: 'empty_question', message: 'Digite o que você quer no relatório.' });
  }

  const limitMsg = await checkLimits(user.id, user.email);
  if (limitMsg) {
    return res.status(429).json({ success: false, error: 'rate_limited', message: limitMsg });
  }

  try {
    // Contexto de follow-up: perguntas + SQLs anteriores desta conversa.
    const priorMessages = history.slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    // 1) Gera a SQL
    const gen = await anthropicChat({
      model: REPORT_MODEL,
      max_tokens: 1200,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...priorMessages,
        { role: 'user', content: question },
      ],
      tools: [emitSqlTool],
      tool_choice: { function: { name: 'emit_sql' } },
    });

    const rawArgs = gen?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) throw new Error('IA não retornou uma consulta.');
    let parsed: { title?: string; sql?: string; explanation?: string };
    try { parsed = JSON.parse(rawArgs); } catch { throw new Error('IA retornou consulta em formato inválido.'); }
    let sql = (parsed.sql || '').trim();
    if (!sql) throw new Error('IA não gerou SQL.');

    // 2) Executa (com 1 retry se a SQL falhar)
    let exec = await supabase.rpc('ai_safe_query', { p_sql: sql });
    let result: any = exec.data;

    const needsRetry = exec.error || (result && result.error);
    if (needsRetry) {
      const errMsg = exec.error?.message || result?.message || 'erro desconhecido';
      const retry = await anthropicChat({
        model: REPORT_MODEL,
        max_tokens: 1200,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question },
          { role: 'assistant', content: `SQL gerada:\n${sql}` },
          { role: 'user', content: `Essa SQL falhou com o erro: "${errMsg}". Corrija e chame emit_sql de novo com uma SQL válida.` },
        ],
        tools: [emitSqlTool],
        tool_choice: { function: { name: 'emit_sql' } },
      });
      const retryArgs = retry?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (retryArgs) {
        try {
          const rp = JSON.parse(retryArgs);
          if (rp.sql) {
            sql = rp.sql.trim();
            parsed.title = rp.title || parsed.title;
            parsed.explanation = rp.explanation || parsed.explanation;
            exec = await supabase.rpc('ai_safe_query', { p_sql: sql });
            result = exec.data;
          }
        } catch { /* mantém erro original */ }
      }
    }

    if (exec.error) throw new Error(`Erro no banco: ${exec.error.message}`);
    if (result?.error) {
      await logQuery({
        user_id: user.id, user_email: user.email, channel: 'reports', question,
        answer: null, tool_calls: { sql }, model: REPORT_MODEL,
        duration_ms: Date.now() - started, status: 'sql_error', error_message: result.message || result.error,
      });
      return res.status(200).json({
        success: false, error: 'sql_error',
        message: `Não consegui montar uma consulta válida: ${result.message || result.error}`,
        sql,
      });
    }

    const rawRows: any[] = Array.isArray(result?.rows) ? result.rows : [];
    const rows = maskRows(rawRows);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const count = result?.count ?? rows.length;
    const truncated = count >= 1000; // LIMIT de segurança do ai_safe_query

    await logQuery({
      user_id: user.id, user_email: user.email, channel: 'reports', question,
      answer: parsed.explanation || null, tool_calls: { sql, title: parsed.title, count },
      model: REPORT_MODEL, duration_ms: Date.now() - started, status: 'ok',
    });

    return res.status(200).json({
      success: true,
      title: parsed.title || 'Relatório',
      explanation: parsed.explanation || '',
      sql,
      columns,
      rows,
      count,
      truncated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[report-query] erro:', message);
    await logQuery({
      user_id: user.id, user_email: user.email, channel: 'reports', question,
      answer: null, model: REPORT_MODEL, duration_ms: Date.now() - started,
      status: 'error', error_message: message,
    });
    return res.status(200).json({ success: false, error: 'internal', message });
  }
};
