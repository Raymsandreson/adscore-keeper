/**
 * report-query — Analista de dados por IA (seção Relatórios).
 *
 * Não é mais um "gerador de tabela": é uma CONVERSA. A IA consulta o banco,
 * OLHA o resultado e responde em português — o que achou, o que está estranho
 * no dado e o que dá pra fazer a seguir. A tabela vem junto, não no lugar dela.
 *
 * Fluxo:
 *   1. Valida o JWT do Cloud (/auth/v1/user) → identidade real do usuário.
 *   2. Autoriza: só diretoria (org_directors), gestores (team_managers),
 *      quem estiver em ai_user_roles, ou os e-mails admin (bootstrap).
 *   3. Respeita ai_user_limits (bloqueio + teto diário de consultas).
 *   4. Carrega/cria a conversa (report_conversations + report_messages): o
 *      histórico não some no F5 e cada pessoa pode ter várias conversas.
 *   5. Loop de até MAX_SQL_STEPS consultas — a IA chama run_sql, recebe de
 *      volta uma amostra do resultado e decide se cruza mais alguma coisa ou
 *      se já pode responder. A última rodada vai SEM ferramenta, o que obriga
 *      o modelo a escrever a resposta em texto.
 *   6. Cada SQL roda via RPC ai_safe_query (transação READ ONLY, timeout 15s).
 *   7. Mascara campos sensíveis (CPF, RG, conta) ANTES de mostrar e de gravar —
 *      o modelo também só enxerga o dado já mascarado.
 *   8. Grava pergunta e resposta na conversa + auditoria em ai_query_log.
 *
 * REGRA DURA (CLAUDE.md, "solução estrutural, nunca band-aid na tela"): a IA
 * aponta o dado estranho no texto, mas NUNCA filtra nem esconde linha do
 * resultado. A tabela mostra o que está no banco; o conserto é na origem.
 *
 * Só devolve dados pra tela — não há geração de arquivo/download.
 * Custo: 2 a 4 chamadas Claude Opus 5 por pergunta (1 por consulta + a resposta).
 * Ordem de grandeza por pergunta: ~30k tokens de entrada (o catálogo de schema
 * repete a cada passo, mas vai cacheado) + ~4k de saída ≈ US$ 0,15–0,25.
 */
import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { aiChat } from '../lib/gemini';

/**
 * Chama o LLM. Tenta o modelo primário e, em qualquer falha, cai no fallback —
 * aiChat roteia por prefixo do modelo e propaga o erro real do provider.
 *
 * withTools=false na última rodada: sem ferramenta declarada o modelo não tem
 * como pedir "mais uma consulta", então a conversa sempre termina em texto.
 *
 * thinking_budget: 0 → thinkingLevel mínimo. Só vale pro fallback Gemini: sem
 * isso o Gemini 3.x roda com thinking dinâmico (alto) quando há tools e, em
 * perguntas complexas, consome todo o max_tokens no raciocínio ANTES de emitir
 * o functionCall — a resposta volta vazia. No Claude quem controla isso é
 * `effort`, e o `temperature` é descartado pelo lib/anthropic (modelo novo
 * devolve 400 se receber sampling). max_tokens folgado porque no Claude o
 * raciocínio também sai do mesmo teto.
 *
 * cache_system: o SYSTEM_PROMPT (catálogo de schema, ~4k tokens) volta inteiro
 * a cada passo da mesma pergunta — cacheado, os passos 2..4 custam ~10% disso.
 */
async function callLLM(messages: any[], withTools = true): Promise<{ completion: any; engine: string }> {
  const base: any = {
    max_tokens: 8000, temperature: 0, messages, thinking_budget: 0,
    effort: REPORT_EFFORT, cache_system: true,
  };
  if (withTools) base.tools = [runSqlTool];
  try {
    const completion = await aiChat({ ...base, model: PRIMARY_MODEL });
    return { completion, engine: PRIMARY_MODEL };
  } catch (primaryErr) {
    console.warn(`[report-query] primário (${PRIMARY_MODEL}) falhou, tentando fallback ${FALLBACK_MODEL}:`,
      primaryErr instanceof Error ? primaryErr.message : primaryErr);
    const completion = await aiChat({ ...base, model: FALLBACK_MODEL });
    return { completion, engine: FALLBACK_MODEL };
  }
}

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Primário = Claude Opus 5 (set/2026): o analista precisa escrever SQL correta
// no primeiro tiro e depois LER o resultado com ceticismo — foi aí que o Gemini
// escorregou (inventava diagnóstico que a consulta não sustentava).
// Fallback = Gemini Flash, que continua respondendo se a chave Anthropic estiver
// sem crédito/limite. Trocar qualquer um dos dois = REPORT_QUERY_MODEL /
// REPORT_QUERY_FALLBACK_MODEL, sem mexer em código.
const PRIMARY_MODEL = process.env.REPORT_QUERY_MODEL || 'anthropic/claude-opus-5';
const FALLBACK_MODEL = process.env.REPORT_QUERY_FALLBACK_MODEL || 'google/gemini-3.6-flash';
// Profundidade do raciocínio do Claude. 'medium' responde pergunta de relatório
// sem gastar o dobro de token; subir pra 'high' se a análise vier rasa.
const REPORT_EFFORT = process.env.REPORT_QUERY_EFFORT || 'medium';
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
  acolhedor (texto), board_id (uuid→kanban_boards: O FUNIL onde o lead está), lead_number.
  IMPORTANTE: o responsável processual do escritório fica AQUI, no lead (processual_responsible_id),
  e é herdado pelos processos e casos daquele lead (via lead_id). Sempre junte por profiles.user_id.
  FUNIL/PIPELINE: "funil X" ou "pipeline X" = leads cujo board_id aponta pra um kanban_boards
    com aquele nome. Ex.: "funil BPC" = leads JOIN kanban_boards b ON b.id=l.board_id WHERE b.name ILIKE '%bpc%'.
  lead_status (VOCABULÁRIO REAL, em inglês — use estes valores exatos, não invente):
    'closed' = FECHADO (o que o usuário chama de "fechado"/"ganho"/"cliente fechado");
    'no_response' = sem resposta;  'refused' = recusou;  'inviavel' = inviável;
    'cancelled' = cancelado;  'in_progress' = em andamento.
    Para "fechados" use l.lead_status = 'closed'.
  status (texto) = a COLUNA atual do lead dentro do funil/kanban (nomes gerados, ex.:
    'procuracao_assinada', 'prospecção_e_triagem_...'). NÃO é o mesmo que lead_status. Para "fechado"
    prefira lead_status='closed'; para etapa específica do funil, filtre status ILIKE '%termo%'.
  became_client_date = data em que virou cliente (preenchida quando fechou contrato).

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

inss_admin_processes (600) — PROCESSOS/REQUERIMENTOS ADMINISTRATIVOS no INSS. tem deleted_at.
  id, requerimento_number, benefit_number, current_status, benefit_type,
  nome_segurado, cpf_segurado, protocol_date, case_id, lead_id, last_email_at, created_at.
  ESTA é a fonte da verdade de "protocolo administrativo".
  "protocolado administrativamente" = protocol_date IS NOT NULL.
  "NÃO protocolado / sem protocolo administrativo" = NÃO existir aqui um registro do lead com protocol_date
    preenchido. Padrão: NOT EXISTS (SELECT 1 FROM inss_admin_processes i WHERE i.lead_id = l.id
    AND i.deleted_at IS NULL AND i.protocol_date IS NOT NULL). Junte por lead_id (ou case_id).
  current_status (vocabulário real): 'Exigência', 'Concluída', 'Em análise'/'Em Análise', 'Cancelada', 'Pendente'.

hearings (500) — AUDIÊNCIAS. tem deleted_at.
  id, process_number, hearing_type, category, hearing_date, hearing_time, status, location,
  assigned_user_id (texto), lead_id, legal_case_id, created_at.

case_process_tracking (2k) — planilha LEGADA importada. USO LIMITADO.
  id, cliente, caso, cpf, tipo, acolhedor, numero_processo, pendencia, status_processo,
  data_protocolo_cancelamento, protocolado, tempo_dias, data_decisao_final, pago_acolhedor, created_at.
  (não tem deleted_at)
  ATENÇÃO: colunas status_processo, protocolado e tipo estão QUASE SEMPRE NULAS (dados nunca migrados).
  NÃO use esta tabela para responder "fechado", "protocolado" ou "tipo/funil BPC" — daria 0 resultados.
  Para status do cliente use leads.lead_status; para funil use kanban_boards; para protocolo
  administrativo use inss_admin_processes.protocol_date. Só use case_process_tracking se o pedido citar
  explicitamente acolhedor/pagamento de acolhedor (pago_acolhedor) ou tempo_dias.

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
kanban_boards — FUNIS/quadros do CRM. id, name, board_type ('funnel' = funil de captação, 'workflow' = fluxo operacional).
  É a tabela dos FUNIS. Leads se ligam por leads.board_id. Para "funil BPC/LOAS" filtre name ILIKE '%bpc%'
  (existem "BPC - Autismo" e "Fluxo BPC - Administrativo"). Para outros: name ILIKE '%acidente%', '%maternidade%' etc.
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
- Leads de um FUNIL fechados e SEM protocolo administrativo (ex.: "funil BPC fechados não protocolados"):
    SELECT l.lead_name, l.lead_phone, b.name AS funil, l.became_client_date,
           pr.full_name AS responsavel
    FROM leads l
    JOIN kanban_boards b ON b.id = l.board_id
    LEFT JOIN profiles pr ON pr.user_id = l.processual_responsible_id
    WHERE l.deleted_at IS NULL
      AND b.name ILIKE '%bpc%'
      AND l.lead_status = 'closed'
      AND NOT EXISTS (
        SELECT 1 FROM inss_admin_processes i
        WHERE i.lead_id = l.id AND i.deleted_at IS NULL AND i.protocol_date IS NOT NULL)
    ORDER BY l.became_client_date DESC NULLS LAST LIMIT 500;
`.trim();

// Quantas consultas a IA pode rodar numa mesma pergunta. Definido ANTES do
// SYSTEM_PROMPT porque o prompt interpola esse número (TDZ se vier depois).
const MAX_SQL_STEPS = Number(process.env.REPORT_MAX_SQL_STEPS || 3);

/** Fuso do escritório — é o "hoje" que vale pra quem lê o relatório. */
const TIMEZONE = process.env.REPORT_TIMEZONE || 'America/Sao_Paulo';

/**
 * Bloco de tempo do prompt — montado A CADA pergunta, nunca no load do módulo
 * (senão o processo do Railway congela a data do último deploy).
 *
 * Sem isto o modelo cai no ano do próprio treinamento e trata data do ano
 * corrente como "futura/mockada": foi exatamente o que apareceu no painel, um
 * registro do mês atual descrito como "falha de parseamento na importação".
 */
function contextoDeTempo(): string {
  const agora = new Date();
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(agora);
  const ano = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, year: 'numeric' }).format(agora);
  return [
    'QUANDO É AGORA (leia antes de julgar qualquer data)',
    `- Hoje é ${dia} — fuso ${TIMEZONE}. O ano corrente é ${ano}.`,
    `- Logo, data de ${ano} é PRESENTE, não futuro. Só é futura a data POSTERIOR a hoje.`,
    '- Nunca use o ano que você "lembra" do treinamento: use a data acima, ou CURRENT_DATE dentro da SQL.',
    '- Não chame dado de "mockado", "de teste" ou "erro de importação" sem consulta que sustente. Desconfiou? Meça (quantos registros, qual o intervalo de datas) e mostre o número — suspeita sem consulta é chute, e chute aqui vira decisão errada da diretoria.',
  ].join('\n');
}

const SYSTEM_PROMPT = `Você é o analista de dados do escritório, conversando com a diretoria dentro do sistema WhatsJUD.
Você tem acesso SOMENTE LEITURA ao banco e a ferramenta run_sql para consultar.

COMO VOCÊ TRABALHA
- Português brasileiro, direto, sem floreio. Escreva como quem senta do lado e explica — não como relatório formal.
- Para qualquer pergunta sobre dados, rode run_sql ANTES de afirmar qualquer coisa. Nunca invente número: só afirme o que voltou da consulta.
- Você pode rodar até ${MAX_SQL_STEPS} consultas na mesma pergunta. Use a segunda ou a terceira quando ela responder algo que a primeira levantou (apareceu coluna vazia demais → meça quantos registros estão assim; apareceu valor fora de escala → veja de onde ele veio; o total não bateu → cruze com a outra tabela).
- Depois de ver o resultado, responda em até três partes — pule a parte que não tiver o que dizer, não force seção vazia:
  1. O que os dados dizem: o número que responde a pergunta, em uma ou duas frases.
  2. O que está estranho no dado, se estiver: campo obrigatório nulo, registro órfão, duplicidade, data impossível, valor fora de escala, tabela que deveria bater com outra e não bate.
  3. O que dá pra fazer com isso: o próximo recorte que vale a pena, ou o conserto na origem.
- Pergunta ambígua: escolha a leitura mais útil, rode assim mesmo e diga qual suposição fez. Não devolva a pergunta sem dado.
- Pergunta que não é sobre dados ("o que dá pra perguntar aqui?", "esse número está certo?", "como você chegou nisso?"): responda direto, sem consultar.
- Consulta vazia não termina em "nenhum registro encontrado": diga o que isso significa e o que testar em seguida — filtro errado, vocabulário diferente do banco, ou campo que nunca foi preenchido.
- Consulta que deu erro: explique em uma linha o que o banco recusou e tente de novo com a SQL corrigida.

REGRA DURA — NUNCA ESCONDA DADO
A tabela mostra exatamente o que está no banco. É PROIBIDO filtrar, zerar, capar ou omitir linha só porque o valor parece errado ou absurdo. Valor improvável CONTINUA no resultado e você APONTA no texto: qual registro, por que parece errado e qual é o conserto na origem (que campo/peça precisa ser preenchido e por quem). Filtrar troca um número errado por outro número errado e ainda esconde o registro que precisa de conserto.

FORMATO DA RESPOSTA
- Texto curto ou bullets. Sem título de relatório, sem tabela em markdown — a tabela do resultado já aparece sozinha na tela, logo abaixo da sua resposta.
- Não transcreva a tabela em texto. Cite no máximo 3 exemplos concretos quando ajudar (nome do cliente, número do processo).
- CPF, RG e conta bancária chegam até você já mascarados — mantenha assim, nunca tente reconstruir.

${SCHEMA_CATALOG}

Nunca use INSERT/UPDATE/DELETE/DDL. Nunca acesse auth, vault, pg_catalog, information_schema, whatsapp_messages.`;

/** Prompt do turno: contexto de tempo do momento da pergunta + o prompt fixo. */
function buildSystemPrompt(): string {
  return `${contextoDeTempo()}\n\n${SYSTEM_PROMPT}`;
}

const runSqlTool = {
  type: 'function' as const,
  function: {
    name: 'run_sql',
    description: 'Roda uma consulta SELECT no banco (somente leitura) e devolve as linhas para você analisar antes de responder.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A consulta SQL (SELECT/WITH) completa, pronta para rodar.' },
        purpose: { type: 'string', description: 'Em uma linha, em português: o que esta consulta responde. Vira o rótulo da tabela na tela (ex: "Processos da Gisele por status").' },
      },
      required: ['sql', 'purpose'],
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
export async function verifyCloudJwt(authHeader: string | undefined): Promise<{ id: string; email: string } | null> {
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

export async function isAuthorized(userId: string, email: string): Promise<boolean> {
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
// Conversa — execução das consultas e memória
// ============================================================
/** Linhas que ficam GRAVADAS na conversa (a tela do turno atual recebe todas). */
const STORED_ROWS_PER_QUERY = 200;
/** Quanto do resultado a IA enxerga pra analisar (não manda 1000 linhas ao modelo). */
const PREVIEW_ROWS = 20;
const PREVIEW_CHARS = 6000;

interface QueryRun {
  sql: string;
  purpose: string;
  columns: string[];
  rows: any[];
  count: number;
  truncated: boolean;
  error?: string;
}

/** Roda a SQL no executor read-only e já devolve as linhas mascaradas. */
async function execSql(sql: string): Promise<{ rows: any[]; count: number; error?: string }> {
  const exec = await supabase.rpc('ai_safe_query', { p_sql: sql });
  if (exec.error) return { rows: [], count: 0, error: exec.error.message };
  const result: any = exec.data;
  if (result?.error) return { rows: [], count: 0, error: result.message || result.error };
  const rows = maskRows(Array.isArray(result?.rows) ? result.rows : []);
  return { rows, count: result?.count ?? rows.length };
}

/** Amostra do resultado devolvida ao modelo (é isto que ele "vê" pra analisar). */
function previewForModel(run: QueryRun): string {
  if (run.error) {
    return `A consulta FALHOU: ${run.error}\nCorrija a SQL e chame run_sql de novo, ou explique em texto o que faltou.`;
  }
  let json = JSON.stringify(run.rows.slice(0, PREVIEW_ROWS));
  if (json.length > PREVIEW_CHARS) json = `${json.slice(0, PREVIEW_CHARS)}…(cortado)`;
  return [
    `Linhas retornadas: ${run.count}${run.truncated ? ' (teto de 1000 do executor — pode haver mais)' : ''}.`,
    `Colunas: ${run.columns.join(', ') || '(nenhuma)'}.`,
    `Amostra (até ${PREVIEW_ROWS} linhas, JSON): ${json}`,
  ].join('\n');
}

function titleFromQuestion(q: string): string {
  const t = q.replace(/\s+/g, ' ').trim();
  if (!t) return 'Nova conversa';
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/** Confere que a conversa existe E é do próprio usuário (conversa é privada). */
async function loadOwnConversation(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('report_conversations')
    .select('id, user_id')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .maybeSingle();
  return !!data && data.user_id === userId;
}

/**
 * Histórico da conversa no formato de mensagens do modelo. Nas respostas da IA
 * vai junto um resumo das SQLs usadas — é o que permite follow-up ("e desses,
 * quantos fecharam?") sem refazer o raciocínio do zero.
 */
async function loadHistory(conversationId: string): Promise<Array<{ role: string; content: string }>> {
  const { data } = await supabase
    .from('report_messages')
    .select('role, content, queries')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(40);
  const msgs = (data || []).slice(-12);
  return msgs.map((m: any) => {
    if (m.role !== 'assistant') return { role: 'user', content: m.content || '' };
    const queries: any[] = Array.isArray(m.queries) ? m.queries : [];
    const sqlNote = queries.length
      ? `\n\nConsultas que rodei nessa resposta:\n${queries.map((q) => `-- ${q.purpose} (${q.count} linhas)\n${q.sql}`).join('\n')}`
      : '';
    return { role: 'assistant', content: `${m.content || ''}${sqlNote}` };
  });
}

// ============================================================
// Handler
// ============================================================
export const handler = async (req: Request, res: Response) => {
  const started = Date.now();
  const question: string = (req.body?.question || '').toString().trim();
  const conversationIdIn: string = (req.body?.conversation_id || '').toString().trim();

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
    return res.status(400).json({ success: false, error: 'empty_question', message: 'Escreva o que você quer saber.' });
  }

  const limitMsg = await checkLimits(user.id, user.email);
  if (limitMsg) {
    return res.status(429).json({ success: false, error: 'rate_limited', message: limitMsg });
  }

  // ---- Conversa: abre a existente (só se for do próprio usuário) ou cria uma.
  let conversationId = conversationIdIn;
  if (conversationId) {
    const owns = await loadOwnConversation(conversationId, user.id);
    if (!owns) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Conversa não encontrada.' });
    }
  } else {
    const { data: conv, error: convErr } = await supabase
      .from('report_conversations')
      .insert({ user_id: user.id, user_email: user.email, title: titleFromQuestion(question) })
      .select('id')
      .single();
    if (convErr || !conv) {
      console.error('[report-query] falha ao criar conversa:', convErr?.message);
      return res.status(200).json({ success: false, error: 'internal', message: 'Não consegui abrir a conversa. Tente de novo.' });
    }
    conversationId = conv.id;
  }

  const priorMessages = await loadHistory(conversationId);

  // Grava a pergunta ANTES de chamar a IA — se der erro no meio, a pergunta do
  // usuário não some da conversa.
  const { data: userMsg } = await supabase
    .from('report_messages')
    .insert({ conversation_id: conversationId, user_id: user.id, role: 'user', content: question })
    .select('id, created_at')
    .single();

  const runs: QueryRun[] = [];
  let engineUsed = PRIMARY_MODEL;

  try {
    const messages: any[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...priorMessages,
      { role: 'user', content: question },
    ];

    let answer = '';
    // MAX_SQL_STEPS rodadas com ferramenta + 1 rodada final sem ferramenta —
    // essa última garante que sempre sai uma resposta em texto.
    for (let step = 0; step <= MAX_SQL_STEPS; step++) {
      const withTools = step < MAX_SQL_STEPS;
      const gen = await callLLM(messages, withTools);
      engineUsed = gen.engine;

      const msg = gen.completion?.choices?.[0]?.message;
      const call = msg?.tool_calls?.[0];
      if (!call) {
        answer = (msg?.content || '').toString().trim();
        break;
      }

      let args: any = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }
      const sql = (args.sql || '').toString().trim();
      const purpose = (args.purpose || '').toString().trim() || 'Consulta ao banco';
      if (!sql) {
        messages.push({ role: 'user', content: 'Você chamou run_sql sem SQL. Escreva a consulta ou responda em texto.' });
        continue;
      }

      const exec = await execSql(sql);
      const run: QueryRun = {
        sql, purpose,
        columns: exec.rows.length ? Object.keys(exec.rows[0]) : [],
        rows: exec.rows,
        count: exec.count,
        truncated: exec.count >= 1000,
        error: exec.error,
      };
      runs.push(run);

      // O conversor do gemini.ts só entende papéis user/assistant (não existe
      // papel "tool"), então o resultado volta como texto de usuário — funciona
      // igual nos dois providers.
      messages.push({ role: 'assistant', content: `Rodei esta consulta (${purpose}):\n${sql}` });
      messages.push({
        role: 'user',
        content: `[resultado da consulta]\n${previewForModel(run)}\n\nAgora responda ao pedido original em português. Rode outra consulta só se ainda faltar dado.`,
      });
    }

    if (!answer) {
      answer = runs.length
        ? 'Consultei o banco — o resultado está na tabela abaixo.'
        : 'Não consegui montar uma resposta pra isso. Pode reformular o pedido?';
    }

    const storedQueries = runs.map((r) => ({
      sql: r.sql,
      purpose: r.purpose,
      columns: r.columns,
      rows: r.rows.slice(0, STORED_ROWS_PER_QUERY),
      count: r.count,
      truncated: r.truncated,
      stored_rows: Math.min(r.rows.length, STORED_ROWS_PER_QUERY),
      error: r.error || null,
    }));

    const { data: aiMsg } = await supabase
      .from('report_messages')
      .insert({
        conversation_id: conversationId, user_id: user.id, role: 'assistant',
        content: answer, queries: storedQueries, engine: engineUsed, status: 'ok',
      })
      .select('id, created_at')
      .single();

    await supabase.from('report_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    await logQuery({
      user_id: user.id, user_email: user.email, channel: 'reports', question,
      answer, tool_calls: { conversation_id: conversationId, queries: runs.map((r) => ({ sql: r.sql, count: r.count })) },
      model: engineUsed, duration_ms: Date.now() - started, status: 'ok',
    });

    return res.status(200).json({
      success: true,
      conversation_id: conversationId,
      user_message: { id: userMsg?.id, role: 'user', content: question, created_at: userMsg?.created_at },
      message: {
        id: aiMsg?.id, role: 'assistant', content: answer,
        queries: runs, engine: engineUsed, created_at: aiMsg?.created_at,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[report-query] erro:', message);

    // A falha também vira mensagem na conversa: reabrindo depois, a pessoa vê o
    // que aconteceu em vez de um buraco entre a pergunta e o nada.
    await supabase.from('report_messages').insert({
      conversation_id: conversationId, user_id: user.id, role: 'assistant',
      content: `Não consegui responder essa: ${message}`,
      queries: runs.map((r) => ({
        sql: r.sql, purpose: r.purpose, columns: r.columns,
        rows: r.rows.slice(0, STORED_ROWS_PER_QUERY), count: r.count,
        truncated: r.truncated, stored_rows: Math.min(r.rows.length, STORED_ROWS_PER_QUERY),
        error: r.error || null,
      })),
      engine: engineUsed, status: 'error', error_message: message,
    });

    await logQuery({
      user_id: user.id, user_email: user.email, channel: 'reports', question,
      answer: null, model: engineUsed, duration_ms: Date.now() - started,
      status: 'error', error_message: message,
    });

    return res.status(200).json({ success: false, error: 'internal', conversation_id: conversationId, message });
  }
};