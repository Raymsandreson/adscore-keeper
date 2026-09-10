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
 * O mapa do banco que vai no prompt NÃO é escrito à mão: vem de
 * lib/schemaCatalog, que lê as colunas do próprio banco (cache de 1h) e junta
 * com a curadoria de vocabulário/joins. Catálogo à mão envelhece e a IA passa a
 * dizer que campo existente "não existe" — foi o que aconteceu em 09/09/2026.
 *
 * REGRA DURA (CLAUDE.md, "solução estrutural, nunca band-aid na tela"): a IA
 * aponta o dado estranho no texto, mas NUNCA filtra nem esconde linha do
 * resultado. A tabela mostra o que está no banco; o conserto é na origem.
 *
 * Só devolve dados pra tela — não há geração de arquivo/download.
 * Custo: 2 a 4 chamadas Claude Opus 5 por pergunta (1 por consulta + a resposta).
 * Ordem de grandeza por pergunta: ~35k tokens de entrada (o catálogo de schema
 * repete a cada passo, mas vai cacheado) + ~4k de saída ≈ US$ 0,15–0,30.
 */
import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { aiChat } from '../lib/gemini';
import { catalogoDeSchema } from '../lib/schemaCatalog';

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

QUANDO A PERGUNTA VEM COM ANEXO (print, foto, PDF) OU FOI DITADA
- O arquivo anexado é FONTE do que a pessoa está perguntando: leia o que está nele (número, nome, data, valor) e trate como o material que ela tem em mãos.
- Anexo NÃO substitui o banco. Se a pergunta encosta em dado nosso, consulte também e compare: onde bate, onde não bate, e qual dos dois lados está desatualizado. Diga qual número veio do arquivo e qual veio do banco — nunca misture os dois como se fossem a mesma fonte.
- Divergiu? A conclusão é o conserto na origem (qual campo/registro precisa ser atualizado e por quem), não "considere o valor do print".
- Arquivo ilegível, cortado ou que não mostra o que a pergunta pede: diga isso em uma linha e peça o que falta, sem adivinhar o que estaria escrito.
- Pergunta ditada por voz chega transcrita e pode ter palavra trocada. Siga a leitura mais provável, resolva e diga a suposição — não devolva a pergunta por causa de uma palavra.

FORMATO DA RESPOSTA
- Texto curto ou bullets. Sem título de relatório, sem tabela em markdown — a tabela do resultado já aparece sozinha na tela, logo abaixo da sua resposta.
- Não transcreva a tabela em texto. Cite no máximo 3 exemplos concretos quando ajudar (nome do cliente, número do processo).
- CPF, RG e conta bancária chegam até você já mascarados — mantenha assim, nunca tente reconstruir.
- NUNCA escreva SQL na resposta. Nada de SELECT, JOIN, WHERE, nome de tabela ou de coluna crua, e nada de "rodei esta consulta: ...". Quem lê é a diretoria, não quer ver código, e a consulta já fica registrada sozinha no botão "Ver a consulta usada" embaixo da tabela. Fale do dado em português: "olhei os 229 BPC concluídos", não "rodei um COUNT(*) em inss_admin_processes".
- Se quiser um recorte que você ainda não mediu, não escreva a consulta dele: ou rode (se ainda tiver rodada disponível), ou diga em uma linha, em português, qual pergunta valeria a próxima consulta.

QUANDO PEDIR GRÁFICO
O run_sql aceita um campo opcional "chart". Preenchido, a tela desenha o gráfico ao lado da tabela — a tabela NUNCA some, o gráfico é leitura em cima dela.
- Peça gráfico quando a consulta for CONTAGEM ou SOMA agrupada e couber em até ~25 grupos: por status, por responsável, por núcleo, por mês, por funil, por tipo de benefício.
- NÃO peça gráfico para relação/listagem de registros (uma linha por processo, por cliente, por atividade). Gráfico de 229 nomes não se lê — ali a tabela é a resposta.
- NÃO peça gráfico para resultado de uma linha só, nem quando o número já cabe na frase.
- type: use "bar" por padrão; "line" só quando o eixo x for data ou mês em ordem; "pie" só para composição de um todo e no máximo 6 fatias.
- x e y têm que ser o nome EXATO de colunas que a sua SELECT devolve, e o y tem que ser numérico. Se você agrupou, dê apelido claro na SELECT (ex: COUNT(*) AS total) e use esse apelido.
- Se estiver na dúvida se vale gráfico, não mande o campo. Tabela sem gráfico é melhor que gráfico que confunde.

CAMPO QUE VOCÊ NÃO ENCONTRA
O catálogo abaixo é o mapa das tabelas — as colunas nele são lidas do banco na hora, não escritas à mão.
- "Não está no catálogo" e "não existe no sistema" são coisas DIFERENTES. Você pode dizer a primeira; a segunda, só se a consulta tiver recusado a coluna.
- Nunca conclua que "ninguém preenche isso" / "o escritório não registra isso" sem MEDIR: conte quantos registros estão nulos e mostre o número. Ausência de campo no seu mapa não é ausência de dado no banco.
- Achou plausível que exista um campo que você não vê (resultado, decisão, valor)? Diga em uma linha qual seria a próxima consulta em vez de afirmar que o dado não existe.

Nunca use INSERT/UPDATE/DELETE/DDL. Nunca acesse auth, vault, pg_catalog, information_schema, whatsapp_messages.`;

/**
 * Prompt do turno: contexto de tempo do momento da pergunta + instruções fixas
 * + o catálogo de schema LIDO DO BANCO (lib/schemaCatalog, cache de 1h).
 *
 * É async por causa do catálogo. Antes ele era uma constante escrita à mão e
 * envelheceu: colunas que existiam no banco ficaram de fora e a IA respondeu
 * que o campo "não existe" — obedecendo o mapa. Ver o cabeçalho de schemaCatalog.ts.
 */
async function buildSystemPrompt(): Promise<string> {
  return `${contextoDeTempo()}\n\n${SYSTEM_PROMPT}\n\n${await catalogoDeSchema()}`;
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
        chart: {
          type: 'object',
          description: 'OPCIONAL. Preencha só quando o resultado for de CONTAGEM/SOMA agrupada e o gráfico ler melhor que a tabela (até ~25 grupos). Relação/listagem de registros NÃO vira gráfico — deixe fora. A tabela continua aparecendo do lado do gráfico de qualquer jeito.',
          properties: {
            type: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'bar = comparar categorias (o padrão). line = série ao longo do tempo, só quando o eixo x for data/mês. pie = composição de um todo, no máximo 6 fatias.' },
            x: { type: 'string', description: 'Nome EXATO da coluna do resultado que vira o rótulo de cada barra/fatia/ponto (ex: "status", "mes").' },
            y: { type: 'string', description: 'Nome EXATO da coluna NUMÉRICA do resultado que vira a altura/tamanho (ex: "total", "quantidade").' },
            label: { type: 'string', description: 'Título curto do gráfico em português (ex: "BPC concluídos por acolhedor").' },
          },
          required: ['type', 'x', 'y'],
        },
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

/** Gráfico que a IA pediu pra este resultado. Ausente = só tabela. */
interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  x: string;
  y: string;
  label?: string;
}

interface QueryRun {
  sql: string;
  purpose: string;
  columns: string[];
  rows: any[];
  count: number;
  truncated: boolean;
  chart?: ChartSpec | null;
  error?: string;
}

/**
 * Valida o `chart` que a IA mandou contra o resultado REAL da consulta.
 *
 * O modelo às vezes cita coluna que não existe no SELECT ou aponta o y pra uma
 * coluna de texto — aí o gráfico sairia vazio ou mentindo. Não passando na
 * validação, devolve null e a tela mostra só a tabela. Isso não esconde dado
 * nenhum: a tabela vem completa dos dois jeitos, o gráfico é leitura em cima.
 */
function validarChart(raw: any, run: { columns: string[]; rows: any[] }): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (type !== 'bar' && type !== 'line' && type !== 'pie') return null;

  const x = String(raw.x || '');
  const y = String(raw.y || '');
  if (!run.columns.includes(x) || !run.columns.includes(y)) return null;
  if (x === y) return null;
  if (!run.rows.length) return null;

  // y tem que ser numérico de verdade em pelo menos uma linha, senão o gráfico
  // desenha zero pra tudo e parece que não há dado.
  const temNumero = run.rows.some((r) => {
    const v = r?.[y];
    return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  });
  if (!temNumero) return null;

  const label = raw.label ? String(raw.label).slice(0, 120) : undefined;
  return { type: type as ChartSpec['type'], x, y, label };
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

// ============================================================
// Anexos da pergunta — print, foto e PDF que vêm COM o pedido
// ============================================================
/**
 * A pergunta pode chegar com material: print de planilha, foto de um extrato,
 * PDF de uma peça. A IA LÊ o anexo e cruza com o banco ("esse extrato bate com
 * o que está lançado?"). O anexo é FONTE, não substitui a consulta: a regra dura
 * de não esconder dado continua valendo igual.
 *
 * O front sobe o arquivo no bucket e manda só a URL; quem baixa é aqui, pra
 * manter o payload do request pequeno (mesmo desenho de transcribe-team-audio e
 * de extract-activity-from-document).
 */
const MAX_ANEXOS = 4;
const MAX_ANEXO_BYTES = 10 * 1024 * 1024;
const MAX_ANEXOS_BYTES = 20 * 1024 * 1024;
/** Só o que os DOIS providers leem: Opus (image/document) e Gemini (inlineData). */
const MIMES_ANEXO = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
const EXT_MIME_ANEXO: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
};

interface AnexoDaPergunta {
  url: string;
  name: string;
  mime: string;
  size: number;
  /** 'audio' é o ditado: o texto transcrito já é a pergunta, o áudio fica como prova. */
  kind: 'image' | 'pdf' | 'audio';
}

/**
 * De onde é aceitável baixar. A URL vem do cliente, e baixar URL arbitrária
 * dentro do Railway é porta aberta pra rede interna (SSRF) — então só passa o
 * Storage dos nossos dois projetos Supabase.
 */
function hostDeStorageConfiavel(url: string): boolean {
  const permitidos = [
    process.env.CLOUD_SUPABASE_URL || '',
    CLOUD_FUNCTIONS_URL,
    process.env.EXTERNAL_SUPABASE_URL || '',
    process.env.REPORT_ANEXO_ORIGENS || '',
  ]
    .flatMap((v) => v.split(','))
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  let host = '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.host.toLowerCase();
  } catch {
    return false;
  }
  return permitidos.some((base) => {
    try { return new URL(base).host.toLowerCase() === host; } catch { return false; }
  });
}

function mimeDoAnexo(url: string, informado: string): string {
  const ext = (url.toLowerCase().split('?')[0].split('.').pop() || '');
  // A extensão manda: o Storage devolve octet-stream pra print colado.
  return EXT_MIME_ANEXO[ext] || (informado || '').toLowerCase().split(';')[0];
}

/**
 * Baixa os anexos e devolve as partes multimodais + a ficha do que foi anexado.
 * Anexo problemático NÃO derruba a pergunta: entra em `recusados` e a IA é
 * avisada em texto de que aquele arquivo não pôde ser lido — melhor responder o
 * que dá do que perder a pergunta inteira por causa de um arquivo.
 */
async function carregarAnexos(brutos: unknown): Promise<{
  anexos: AnexoDaPergunta[];
  partes: any[];
  recusados: string[];
}> {
  const lista = Array.isArray(brutos) ? brutos.slice(0, MAX_ANEXOS) : [];
  const anexos: AnexoDaPergunta[] = [];
  const partes: any[] = [];
  const recusados: string[] = [];
  let total = 0;

  for (const bruto of lista) {
    const b: any = bruto || {};
    const url = (b.url || '').toString().trim();
    const name = (b.name || 'arquivo').toString().slice(0, 200);
    if (!url) continue;

    if (!hostDeStorageConfiavel(url)) {
      recusados.push(`${name} (origem não permitida)`);
      continue;
    }

    // Ditado: o áudio só fica registrado. O texto dele já virou a pergunta, e
    // reenviar o áudio ao modelo custaria de novo pelo mesmo conteúdo.
    if (b.kind === 'audio' || (b.mime || '').toString().startsWith('audio/')) {
      anexos.push({
        url, name,
        mime: (b.mime || 'audio/webm').toString(),
        size: Number(b.size) || 0,
        kind: 'audio',
      });
      continue;
    }

    const mime = mimeDoAnexo(url, (b.mime || '').toString());
    if (!MIMES_ANEXO.has(mime)) {
      recusados.push(`${name} (tipo ${mime || 'desconhecido'} não é lido aqui — mande PNG, JPG, WEBP ou PDF)`);
      continue;
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        recusados.push(`${name} (não baixou, HTTP ${resp.status})`);
        continue;
      }
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > MAX_ANEXO_BYTES) {
        recusados.push(`${name} (acima de ${Math.round(MAX_ANEXO_BYTES / 1024 / 1024)} MB)`);
        continue;
      }
      total += buffer.byteLength;
      if (total > MAX_ANEXOS_BYTES) {
        recusados.push(`${name} (os anexos somados passaram de ${Math.round(MAX_ANEXOS_BYTES / 1024 / 1024)} MB)`);
        continue;
      }
      partes.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${Buffer.from(buffer).toString('base64')}` },
      });
      anexos.push({
        url, name, mime,
        size: buffer.byteLength,
        kind: mime === 'application/pdf' ? 'pdf' : 'image',
      });
    } catch (e) {
      recusados.push(`${name} (${e instanceof Error ? e.message : 'falha ao baixar'})`);
    }
  }

  return { anexos, partes, recusados };
}

/** Como o anexo é apresentado ao modelo, junto com a pergunta. */
function textoDosAnexos(anexos: AnexoDaPergunta[], recusados: string[]): string {
  const lidos = anexos.filter((a) => a.kind !== 'audio');
  const linhas: string[] = [];
  if (lidos.length) {
    linhas.push(
      `[MATERIAL ANEXADO À PERGUNTA — ${lidos.length} arquivo(s): ${lidos.map((a) => `${a.name} (${a.kind === 'pdf' ? 'PDF' : 'imagem'})`).join(', ')}]`,
      'Leia o que está no arquivo e use como FONTE do que a pessoa está perguntando. Ele não substitui a consulta: se a pergunta envolve o que o banco tem, consulte o banco e compare com o arquivo, dizendo onde bate e onde não bate.',
    );
  }
  if (anexos.some((a) => a.kind === 'audio')) {
    linhas.push('[A pergunta foi DITADA por voz — o texto acima é a transcrição. Se alguma palavra parecer transcrita errada, siga a leitura mais provável e diga qual suposição fez.]');
  }
  if (recusados.length) {
    linhas.push(`[Anexo que NÃO deu pra ler: ${recusados.join('; ')}. Responda com o que sobrou e avise em uma linha que esse arquivo não foi lido.]`);
  }
  return linhas.join('\n');
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
  const buscar = (colunas: string) => supabase
    .from('report_messages')
    .select(colunas)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(40);
  // A coluna attachments é nova (migration 20260909130000). O código sobe no
  // merge e a migration é passo manual, então a conversa não pode deixar de
  // abrir se o banco ainda estiver sem ela.
  let { data, error } = await buscar('role, content, queries, attachments');
  if (error) ({ data } = await buscar('role, content, queries'));
  const msgs = (data || []).slice(-12);
  return msgs.map((m: any) => {
    if (m.role !== 'assistant') {
      // O arquivo antigo NÃO é reenviado ao modelo (custaria de novo a cada
      // pergunta da conversa); fica a menção de que existiu, que é o que
      // sustenta o follow-up ("e no print que te mandei?" → peça de novo).
      const antigos: any[] = Array.isArray(m.attachments) ? m.attachments : [];
      const lidos = antigos.filter((a) => a?.kind && a.kind !== 'audio');
      const nota = lidos.length
        ? `\n\n[nesta pergunta a pessoa anexou ${lidos.map((a) => a.name || 'arquivo').join(', ')} — o conteúdo do arquivo não está mais nesta janela; se precisar dele de novo, peça pra reanexar]`
        : '';
      return { role: 'user', content: `${m.content || ''}${nota}` };
    }
    const queries: any[] = Array.isArray(m.queries) ? m.queries : [];
    // A SQL fica no histórico porque é ela que sustenta o follow-up ("e desses,
    // quantos fecharam?") sem refazer o raciocínio. Mas ela vem ROTULADA como
    // bastidor: sem o rótulo, o modelo lê a própria fala anterior como exemplo
    // de formato e passa a escrever SELECT na resposta que a diretoria vê.
    const sqlNote = queries.length
      ? `\n\n[bastidor — isto não aparece na tela e NUNCA se repete em resposta; é só a sua memória do filtro que você usou]\n${queries.map((q) => `-- ${q.purpose} (${q.count} linhas)\n${q.sql}`).join('\n')}`
      : '';
    return { role: 'assistant', content: `${m.content || ''}${sqlNote}` };
  });
}

// ============================================================
// Handler
// ============================================================
export const handler = async (req: Request, res: Response) => {
  const started = Date.now();
  const perguntaDigitada: string = (req.body?.question || '').toString().trim();
  const conversationIdIn: string = (req.body?.conversation_id || '').toString().trim();
  const anexosBrutos = req.body?.attachments;
  const temAnexo = Array.isArray(anexosBrutos) && anexosBrutos.length > 0;
  // Anexo sozinho já é um pedido ("olha isso aqui"): a pergunta em branco não
  // pode barrar o envio, senão o botão de anexo vira enfeite.
  const question: string = perguntaDigitada
    || (temAnexo ? 'Olhe o material que eu anexei e me diga o que ele mostra e o que ele bate (ou não bate) com o que está no banco.' : '');

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
    return res.status(400).json({ success: false, error: 'empty_question', message: 'Escreva (ou dite) o que você quer saber, ou anexe o material.' });
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

  // Baixa o material anexado antes de gravar: o que não deu pra ler não entra
  // na conversa como se tivesse entrado.
  const { anexos, partes: partesDoAnexo, recusados } = await carregarAnexos(anexosBrutos);

  // Grava a pergunta ANTES de chamar a IA — se der erro no meio, a pergunta do
  // usuário não some da conversa.
  //
  // O attachments vai no insert, mas com queda pro insert sem ele: a coluna é
  // nova (migration 20260909130000) e o código sobe no merge, então um deploy
  // antes da migration não pode fazer a pergunta se perder.
  const gravarPergunta = async (comAnexo: boolean) => supabase
    .from('report_messages')
    .insert({
      conversation_id: conversationId, user_id: user.id, role: 'user', content: question,
      ...(comAnexo ? { attachments: anexos } : {}),
    })
    .select('id, created_at')
    .single();
  let { data: userMsg, error: userMsgErr } = await gravarPergunta(anexos.length > 0);
  if (userMsgErr && anexos.length > 0) {
    console.warn('[report-query] insert com attachments falhou, gravando sem:', userMsgErr.message);
    ({ data: userMsg } = await gravarPergunta(false));
  }

  const runs: QueryRun[] = [];
  let engineUsed = PRIMARY_MODEL;

  try {
    const notaDoAnexo = textoDosAnexos(anexos, recusados);
    // Com anexo a mensagem vira multimodal (texto + partes); sem anexo continua
    // string, exatamente como era — os dois providers aceitam as duas formas.
    const conteudoDaPergunta = partesDoAnexo.length || notaDoAnexo
      ? [
          { type: 'text', text: notaDoAnexo ? `${question}\n\n${notaDoAnexo}` : question },
          ...partesDoAnexo,
        ]
      : question;

    const messages: any[] = [
      { role: 'system', content: await buildSystemPrompt() },
      ...priorMessages,
      { role: 'user', content: conteudoDaPergunta },
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
      const colunas = exec.rows.length ? Object.keys(exec.rows[0]) : [];
      const run: QueryRun = {
        sql, purpose,
        columns: colunas,
        rows: exec.rows,
        count: exec.count,
        truncated: exec.count >= 1000,
        chart: validarChart(args.chart, { columns: colunas, rows: exec.rows }),
        error: exec.error,
      };
      runs.push(run);

      // O conversor do gemini.ts só entende papéis user/assistant (não existe
      // papel "tool"), então o resultado volta como texto de usuário — funciona
      // igual nos dois providers.
      //
      // O eco NÃO repete a SQL. O modelo lê o próprio histórico como exemplo de
      // como se fala aqui: com a SQL nesta linha ele copiava o formato e
      // escrevia "Rodei esta consulta (...): SELECT ..." na resposta final —
      // SQL cru na tela da diretoria. Ele não precisa reler a própria consulta,
      // só saber que ela rodou e o que voltou. A SQL fica gravada no QueryRun
      // (bloco "Ver a consulta usada"), que é onde ela pertence.
      messages.push({
        role: 'assistant',
        content: `Rodei a consulta "${purpose}" — voltaram ${run.count} linha${run.count === 1 ? '' : 's'}. A tabela já apareceu na tela para quem perguntou.`,
      });
      // Na última rodada com ferramenta o modelo precisa SABER que acabou. Sem
      // isso ele tenta a próxima consulta na rodada seguinte, não encontra a
      // ferramenta, e escreve a SQL em texto como se estivesse rodando.
      const acabaramAsConsultas = step >= MAX_SQL_STEPS - 1;
      const fecho = acabaramAsConsultas
        ? 'Esta foi a última consulta disponível nesta pergunta — não há mais rodada. Responda agora em português com o que você já tem em mãos. Se ficou faltando um recorte, diga em uma linha qual pergunta ele responderia, sem escrever a SQL dele.'
        : 'Agora responda ao pedido original em português. Rode outra consulta só se ainda faltar dado.';
      messages.push({
        role: 'user',
        content: `[resultado da consulta]\n${previewForModel(run)}\n\n${fecho}`,
      });
    }

    if (!answer) {
      answer = runs.length
        ? 'Consultei o banco — o resultado está na tabela abaixo.'
        : 'Não consegui montar uma resposta pra isso. Pode reformular o pedido?';
    }

    const storedQueries = runs.map((r) => {
      const gravadas = Math.min(r.rows.length, STORED_ROWS_PER_QUERY);
      // O gráfico só sobrevive ao F5 se TODAS as linhas couberam na gravação.
      // Desenhar em cima de resultado cortado dá um gráfico que soma parte do
      // dado e parece o total — número errado com cara de certo. Faltou linha,
      // reabrir a conversa mostra a tabela (que já se anuncia parcial) e ponto.
      const completo = gravadas >= r.count && !r.truncated;
      return {
        sql: r.sql,
        purpose: r.purpose,
        columns: r.columns,
        rows: r.rows.slice(0, STORED_ROWS_PER_QUERY),
        count: r.count,
        truncated: r.truncated,
        stored_rows: gravadas,
        chart: completo ? r.chart || null : null,
        error: r.error || null,
      };
    });

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
      user_message: {
        id: userMsg?.id, role: 'user', content: question,
        attachments: anexos, created_at: userMsg?.created_at,
      },
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